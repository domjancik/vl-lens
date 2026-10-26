"""Read-only, loopback-only VL viewer. Standard library; never invokes gamma."""
import argparse
from collections import Counter
import difflib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit
import xml.etree.ElementTree as ET
try:
    from .repository import LocalGitRepository
    from .project import Project
except ImportError:
    from repository import LocalGitRepository
    from project import Project

ROOT = Path.cwd().resolve()
STATIC = Path(__file__).parent / 'static'
PROJECT = Project(ROOT)
EXPORT_ROOT = None
MAX_BYTES = 12 * 1024 * 1024


def walk(element):
    yield element
    for child in element.get('children', []):
        yield from walk(child)


def parse_vl(source, path):
    if not isinstance(source, str) or len(source.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Choose a VL document smaller than 12 MB.')
    if re.search(r'<!\s*(DOCTYPE|ENTITY)\b', source, re.I):
        raise ValueError('DTD and entity declarations are not supported.')
    try:
        root = ET.fromstring(source)
    except ET.ParseError as error:
        raise ValueError(f'Invalid XML: {error}') from error
    if root.tag != 'Document' or not root.get('Id'):
        raise ValueError('Expected a VL Document root with an Id.')
    # Linear scan: the large core/editor files contain tens of thousands of IDs.
    lines = {m[1]: number for number, line in enumerate(source.splitlines(), 1)
             for m in re.finditer(r'\bId="([^"]+)"', line)}

    def qualified(name):
        return name.replace('{property}', 'p:').replace('{reflection}', 'r:')

    count = 0

    def convert(element, depth=0):
        nonlocal count
        count += 1
        if depth > 160 or count > 200000:
            raise ValueError('This document is too deeply nested or too large to display.')
        return {'tag': qualified(element.tag),
                'attrs': {qualified(k): v for k, v in element.attrib.items()},
                'line': lines.get(element.get('Id'), 0),
                'text': element.text or '',
                'children': [convert(c, depth + 1) for c in element]}

    tree = convert(root)
    elements = list(walk(tree))
    counts = Counter(e['attrs']['Id'] for e in elements if 'Id' in e['attrs'])
    warnings = [{'kind': 'duplicate-id', 'id': identity, 'message': f'ID occurs {count} times: {identity}'}
                for identity, count in counts.items() if count > 1]
    for element in elements:
        attrs = element['attrs']
        refs = []
        if element['tag'] == 'Link':
            refs.extend(attrs.get('Ids', '').split(','))
        if element['tag'] == 'Fragment':
            refs.append(attrs.get('Patch', ''))
        refs.extend(attrs.get('ParticipatingElements', '').split(','))
        for target in filter(None, refs):
            if target not in counts:
                warnings.append({'kind': 'missing-reference', 'id': attrs.get('Id', ''),
                                 'message': f'Missing local target: {target}'})
    dependencies = []
    for e in elements:
        if e['tag'] in ('DocumentDependency', 'NugetDependency'):
            dependencies.append({'kind': e['tag'], **e['attrs']})
    return {'path': str(path), 'documentId': root.get('Id'), 'tree': tree,
            'source': source, 'warnings': warnings, 'dependencies': dependencies,
            'compiled': False, 'elementCount': count}


def safe_document_path(path):
    return PROJECT.document_path(path)


def find_exports(path, document_id, identity):
    if EXPORT_ROOT is None:
        return []
    source_path = safe_document_path(path)
    if not re.fullmatch(r'[\w-]{1,120}', identity):
        raise ValueError('Invalid element identity.')
    source = source_path.read_text(encoding='utf-8-sig')
    header = re.search(r'<Document\b[^>]*\bId="([^"]+)"', source)
    if not header or header[1] != document_id:
        return []
    exports = EXPORT_ROOT
    directory = exports / source_path.name
    if not directory.is_dir():
        directory = exports / source_path.stem
    if not directory.is_dir():
        return []
    hits = []
    for file in sorted(directory.glob('*.cs')):
        lines = file.read_text(encoding='utf-8-sig').splitlines()
        for index, line in enumerate(lines):
            attribute = f'DocumentId = @"{document_id}"' in line and f'PersistentId = @"{identity}"' in line
            context = f'@"{document_id}", @"{identity}"' in line
            if attribute or context:
                start = max(0, index - 2)
                hits.append({'path': file.relative_to(ROOT).as_posix() if file.is_relative_to(ROOT) else file.relative_to(exports).as_posix(), 'line': index + 1,
                             'startLine': start + 1, 'match': 'attribute' if attribute else 'context',
                             'text': '\n'.join(lines[start:index + 13])[:16000]})
            if len(hits) == 12:
                return hits
    return hits


def compare_snapshots(repository, base, target, old_path, new_path):
    before_revision, after_revision = repository.resolve(base), repository.resolve(target)
    if before_revision['kind'] == 'worktree':
        raise ValueError('Choose a commit or INDEX as the base revision.')

    def snapshot(revision, path):
        if not path:
            return None
        data = repository.read(revision['id'], path)
        if data is None:
            return None
        try:
            return {**parse_vl(data['source'], path), 'revision': revision}
        except ValueError as error:
            return {**data, 'revision': revision, 'parseError': str(error)}

    before, after = snapshot(before_revision, old_path), snapshot(after_revision, new_path)
    if before is None and after is None:
        raise ValueError('This file is absent from both selected snapshots.')
    lines = difflib.unified_diff((before or {}).get('source', '').splitlines(),
                                 (after or {}).get('source', '').splitlines(),
                                 fromfile=f'{old_path or "/dev/null"} ({base})',
                                 tofile=f'{new_path or "/dev/null"} ({target})', lineterm='')
    text = '\n'.join(lines)
    return {'provider': 'local-git', 'base': before_revision, 'target': after_revision,
            'oldPath': old_path, 'newPath': new_path, 'before': before, 'after': after,
            'textDiff': text[:512000], 'textDiffTruncated': len(text) > 512000}


class Handler(BaseHTTPRequestHandler):
    def send_data(self, data, content_type='application/json; charset=utf-8', status=200):
        body = json.dumps(data, ensure_ascii=True).encode() if isinstance(data, (dict, list)) else data
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def allowed_request(self):
        port = self.server.server_port
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in hosts:
            self.send_data({'error': 'Use the loopback URL printed by the server.'}, status=403)
            return False
        origin = self.headers.get('Origin')
        if (origin and origin not in {f'http://{h}' for h in hosts}) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.send_data({'error': 'Cross-origin requests are not allowed.'}, status=403)
            return False
        return True

    def do_GET(self):
        if not self.allowed_request():
            return
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == '/api/documents':
                self.send_data({'documents': PROJECT.catalog(), 'workspace': {**PROJECT.describe(),'exportsAvailable':EXPORT_ROOT is not None}})
            elif parsed.path == '/api/document':
                path = safe_document_path(query.get('path', [''])[0])
                if path.stat().st_size > MAX_BYTES:
                    raise ValueError('Document exceeds 12 MB.')
                self.send_data(parse_vl(path.read_text(encoding='utf-8-sig'), path.relative_to(ROOT).as_posix()))
            elif parsed.path == '/api/exports':
                self.send_data({'hits': find_exports(query.get('path', [''])[0], query.get('document', [''])[0], query.get('id', [''])[0])})
            elif parsed.path == '/api/git/revisions':
                self.send_data(LocalGitRepository(ROOT,project=PROJECT).revisions())
            elif parsed.path == '/api/git/history':
                self.send_data(LocalGitRepository(ROOT,project=PROJECT).history(query.get('ref',['HEAD'])[0],
                    query.get('page',[1])[0],query.get('limit',[50])[0]))
            elif parsed.path == '/api/git/changes':
                repository = LocalGitRepository(ROOT,project=PROJECT)
                base = repository.resolve(query.get('base', ['HEAD'])[0])
                target = repository.resolve(query.get('target', ['WORKTREE'])[0])
                before_paths = set(repository.documents(base['id']))
                after_paths = set(repository.documents(target['id']))
                self.send_data({'provider': 'local-git', 'base': base, 'target': target,
                                'changes': repository.changes(base['id'], target['id']),
                                'documents': [{'path': p, 'existsBefore': p in before_paths, 'existsAfter': p in after_paths}
                                              for p in sorted(before_paths | after_paths)]})
            elif parsed.path == '/api/git/compare':
                path = query.get('path', [''])[0]
                self.send_data(compare_snapshots(LocalGitRepository(ROOT,project=PROJECT), query.get('base', ['HEAD'])[0],
                    query.get('target', ['WORKTREE'])[0], query.get('oldPath', [path])[0] or None,
                    query.get('newPath', [path])[0] or None))
            else:
                names = {'/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css',
                         '/app.mjs': 'app.mjs', '/model.mjs': 'model.mjs', '/diff.mjs': 'diff.mjs', '/files.mjs': 'files.mjs', '/file-browser.mjs':'file-browser.mjs'}
                name = names.get(parsed.path)
                if not name:
                    self.send_data({'error': 'Not found.'}, status=404)
                    return
                types = {'.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript'}
                file = STATIC / name
                self.send_data(file.read_bytes(), types[file.suffix] + '; charset=utf-8')
        except (ValueError, OSError, KeyError) as error:
            message = str(error) if isinstance(error, ValueError) else 'The requested file is unavailable.'
            self.send_data({'error': message}, status=400)

    def do_POST(self):
        if not self.allowed_request():
            return
        if self.path != '/api/parse':
            self.send_data({'error': 'This viewer has no write endpoints.'}, status=405)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_BYTES * 2:
                raise ValueError('File payload is too large or empty.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not isinstance(data.get('path'), str) or len(data['path']) > 512 or not data['path'].lower().endswith('.vl'):
                raise ValueError('Choose a .vl file.')
            self.send_data(parse_vl(data.get('source'), data['path']))
        except (ValueError, TypeError, UnicodeError) as error:
            self.send_data({'error': str(error)}, status=400)


def main():
    global ROOT, PROJECT, EXPORT_ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--root', type=Path, default=Path.cwd(),help='Project folder to browse (default: current directory).')
    parser.add_argument('--exports', type=Path, help='Optional generated C# export source directory.')
    parser.add_argument('--exclude', action='append', default=[],help='Additional directory name to exclude; repeat as needed.')
    args = parser.parse_args()
    ROOT=args.root.resolve()
    if not ROOT.is_dir():parser.error('--root must be an existing directory')
    PROJECT=Project(ROOT,args.exclude)
    EXPORT_ROOT=args.exports.resolve() if args.exports else None
    if EXPORT_ROOT is not None and not EXPORT_ROOT.is_dir():parser.error('--exports must be an existing directory')
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as http:
        print(f'VL Lens: http://127.0.0.1:{http.server_port} (read-only, Ctrl+C to stop)', flush=True)
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
