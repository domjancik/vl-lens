"""Shared local/desktop router and filesystem-free serverless handler."""
from collections import deque, OrderedDict
import json
import mimetypes
import threading
import time
from urllib.parse import parse_qs, urlsplit

import server
from github_repository import GitHubRepository

HOSTED_INPUT_BYTES = 3 * 1024 * 1024
HOSTED_OUTPUT_BYTES = 4 * 1024 * 1024
_requests = OrderedDict()
_rate_lock = threading.Lock()


def parse_upload(data, hosted=False):
    if not isinstance(data, dict) or not isinstance(data.get('path'), str) or len(data['path']) > 512 or not data['path'].lower().endswith('.vl'):
        raise ValueError('Choose a .vl file.')
    source = data.get('source')
    if hosted and (not isinstance(source, str) or len(source.encode()) > HOSTED_INPUT_BYTES):
        raise ValueError('Hosted uploads are limited to 3 MB. Use the desktop app for larger files.')
    return server.parse_vl(source, data['path'])


class WebHandler(server.Handler):
    hosted = False

    def limited(self):
        # Per-instance protection; use Vercel Firewall for deployment-wide limits.
        address = self.client_address[0]
        now = time.monotonic()
        with _rate_lock:
            history = _requests.setdefault(address, deque())
            while history and history[0] < now - 60:
                history.popleft()
            if len(history) >= 90:
                self.send_data({'error': 'Too many requests. Wait a minute before retrying.'}, status=429)
                return True
            history.append(now)
            _requests.move_to_end(address)
            while len(_requests) > 2048:
                _requests.popitem(last=False)
        return False

    def do_GET(self):
        if not self.allowed_request():
            return
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        route = query.get('_route', [url.path])[0] if self.hosted else url.path
        try:
            if route.startswith('/api/'):
                if self.limited():
                    return
                if route == '/api/config':
                    self.send_data({'hosted': self.hosted, 'repositoryAccess': 'public',
                                    'maxUploadBytes': HOSTED_INPUT_BYTES if self.hosted else server.MAX_BYTES})
                    return
                slug = query.get('repo', [''])[0]
                if slug:
                    self.remote(route, query, GitHubRepository(slug))
                elif self.hosted:
                    if route == '/api/documents':
                        self.send_data({'documents': [], 'workspace': {'id': 'hosted', 'name': 'Choose a repository',
                                        'gitAvailable': False, 'exportsAvailable': False}})
                    else:
                        raise ValueError('Connect a public GitHub repository first.')
                else:
                    super().do_GET()
                return
            name = {'/': 'landing.html', '/viewer': 'index.html', '/viewer/': 'index.html'}.get(route)
            if not name:
                candidate = route.removeprefix('/')
                if '/' not in candidate and candidate in {p.name for p in server.STATIC.iterdir() if p.is_file()}:
                    name = candidate
            if not name:
                self.send_data({'error': 'Not found.'}, status=404)
                return
            types = {'.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html'}
            file = server.STATIC / name
            self.send_data(file.read_bytes(), (types.get(file.suffix) or mimetypes.guess_type(name)[0] or 'application/octet-stream') + '; charset=utf-8')
        except (ValueError, TypeError, KeyError, UnicodeError, OSError) as error:
            self.send_data({'error': str(error) if isinstance(error, ValueError) else 'The requested resource is unavailable.'}, status=400)

    def remote(self, route, query, repository):
        get = lambda key, default='': query.get(key, [default])[0]
        if route == '/api/documents':
            revision = repository.resolve(get('ref'))
            self.send_data({'documents': repository.catalog(revision['id']), 'workspace': repository.describe(revision['id'])})
        elif route == '/api/document':
            data = repository.read(get('ref'), get('path'))
            if data is None:
                raise ValueError('File is absent from this snapshot.')
            self.send_data({**server.parse_vl(data['source'], data['path']), 'revision': data['revision']})
        elif route == '/api/exports':
            self.send_data({'hits': []})
        elif route == '/api/git/revisions':
            self.send_data(repository.revisions())
        elif route == '/api/git/changes':
            base, target = repository.resolve(get('base')), repository.resolve(get('target'))
            before, after = set(repository.documents(base['id'])), set(repository.documents(target['id']))
            self.send_data({'provider': 'github', 'base': base, 'target': target,
                            'changes': repository.changes(base['id'], target['id']),
                            'documents': [{'path': p, 'existsBefore': p in before, 'existsAfter': p in after}
                                          for p in sorted(before | after)]})
        elif route == '/api/git/compare':
            path = get('path')
            data = server.compare_snapshots(repository, get('base'), get('target'), get('oldPath', path) or None, get('newPath', path) or None)
            self.send_data({**data, 'provider': 'github'})
        else:
            self.send_data({'error': 'Not found.'}, status=404)

    def do_POST(self):
        if not self.allowed_request() or self.limited():
            return
        url = urlsplit(self.path)
        route = parse_qs(url.query).get('_route', [url.path])[0] if self.hosted else url.path
        if route != '/api/parse':
            self.send_data({'error': 'This viewer has no write endpoints.'}, status=405)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            limit = HOSTED_INPUT_BYTES if self.hosted else server.MAX_BYTES * 2
            if not 0 < size <= limit:
                raise ValueError('Upload payload is too large or empty. Use the desktop app for larger files.')
            data = json.loads(self.rfile.read(size))
            self.send_data(parse_upload(data, self.hosted))
        except (ValueError, TypeError, UnicodeError) as error:
            self.send_data({'error': str(error)}, status=400)


class HostedHandler(WebHandler):
    hosted = True

    def allowed_request(self):
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.send_data({'error': 'Cross-site API requests are not supported.'}, status=403)
            return False
        return True

    def send_data(self, data, content_type='application/json; charset=utf-8', status=200):
        body = json.dumps(data, ensure_ascii=True).encode() if isinstance(data, (dict, list)) else data
        if len(body) > HOSTED_OUTPUT_BYTES:
            body = json.dumps({'error': 'Parsed result exceeds the hosted response limit. Open this file in the desktop app.'}).encode()
            status = 413
        super().send_data(body, content_type, status)
