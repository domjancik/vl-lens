"""Snapshot-provider boundary for the viewer. Local Git implementation is read-only."""
import os
from pathlib import Path
import re
import subprocess

MAX_BYTES = 12 * 1024 * 1024
PATCH_ROOTS = ('.',)
try:
    from .project import Project
except ImportError:
    from project import Project


class LocalGitRepository:
    def __init__(self, root, project=None):
        self.root = Path(root).resolve()
        self.project = project or Project(self.root)

    def _git(self, *args):
        environment = {k: v for k, v in os.environ.items() if k not in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE')}
        environment['GIT_OPTIONAL_LOCKS'] = '0'
        try:
            result = subprocess.run(['git', '--no-pager', '-c', 'core.fsmonitor=false', '-C', str(self.root), *args],
                                    capture_output=True, timeout=20, env=environment,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError('Local Git is unavailable or the repository operation timed out.') from error
        if result.returncode:
            raise ValueError('Git could not read the requested revision or repository state.')
        return result.stdout

    def resolve(self, revision):
        if revision in ('INDEX', 'WORKTREE'):
            return {'id': revision, 'label': revision, 'kind': revision.lower()}
        if not isinstance(revision, str) or not re.fullmatch(r'[\w][\w./@~^{}-]{0,199}', revision):
            raise ValueError('Choose a commit, branch, tag, INDEX, or WORKTREE.')
        oid = self._git('rev-parse', '--verify', '--end-of-options', revision + '^{commit}').decode().strip()
        if not re.fullmatch(r'[a-f0-9]{40,64}', oid):
            raise ValueError('The revision did not resolve to a commit.')
        return {'id': oid, 'label': revision, 'kind': 'commit'}

    def _path(self, path):
        self.project.document_path(path,must_exist=False)
        return path

    def revisions(self):
        head = self.resolve('HEAD')['id']
        log = self._git('log', '-30', '--format=%H%x00%h%x00%s%x00%cI').decode('utf-8', errors='replace')
        commits = []
        for line in log.splitlines():
            fields = line.split('\0')
            if len(fields) == 4:
                commits.append(dict(zip(('oid', 'short', 'subject', 'date'), fields)))
        refs = [{'name': 'HEAD', 'oid': head}]
        raw = self._git('for-each-ref', '--count=200', '--format=%(refname:short)%00%(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags')
        for line in raw.decode('utf-8', errors='replace').splitlines():
            name, _, oid = line.partition('\0')
            refs.append({'name': name, 'oid': oid})
        return {'provider': 'local-git', 'repository': {'id': 'local', 'name': self.root.name},
                'head': head, 'commits': commits, 'refs': refs,
                'defaults': {'base': 'HEAD', 'target': 'WORKTREE'},
                'specialRevisions': [{'id': 'INDEX', 'baseAllowed': True}, {'id': 'WORKTREE', 'baseAllowed': False}]}

    def documents(self, revision):
        resolved = self.resolve(revision)
        if resolved['kind'] == 'commit':
            raw = self._git('ls-tree', '-r', '--name-only', '-z', resolved['id'], '--', *PATCH_ROOTS)
        else:
            options = ['--cached'] + (['--others', '--exclude-standard'] if resolved['kind'] == 'worktree' else [])
            raw = self._git('ls-files', *options, '-z', '--', *PATCH_ROOTS)
        paths = set()
        for path in raw.decode('utf-8', errors='replace').split('\0'):
            if not path.lower().endswith('.vl') or self.project.excluded(path):
                continue
            self._path(path)
            if resolved['kind'] != 'worktree' or (self.root / path).is_file():
                paths.add(path)
        return sorted(paths)

    def history(self, ref='HEAD', page=1, limit=50):
        try:
            page, limit = int(page), int(limit)
        except (ValueError, TypeError):
            raise ValueError('Invalid history page size.') from None
        if not 1 <= page <= 20 or not 1 <= limit <= 100:
            raise ValueError('History supports pages 1–20 and up to 100 commits per page.')
        if ref in ('INDEX', 'WORKTREE'):
            raise ValueError('Choose a commit or branch to browse history.')
        menu = self.revisions()
        anchor = menu['head'] if ref == '*' else self.resolve(ref or 'HEAD')['id']
        revision = ['--all', 'HEAD'] if ref == '*' else [anchor]
        raw = self._git('log', '--topo-order', '-n', str(limit+1), '--skip='+str((page-1)*limit),
                        '--format=%H%x00%h%x00%s%x00%cI%x00%P%x00%an%x1e', *revision).decode('utf-8', errors='replace')
        commits = []
        for record in raw.split('\x1e'):
            fields = record.strip('\r\n').split('\0')
            if len(fields) == 6:
                commit = dict(zip(('oid', 'short', 'subject', 'date', 'parents', 'author'), fields))
                commit['parents'] = commit['parents'].split()
                commits.append(commit)
        refs = []
        raw_refs = self._git('for-each-ref', '--count=200',
                             '--format=%(refname:short)%00%(objectname)%00%(*objectname)%00%(refname)',
                             'refs/heads', 'refs/remotes', 'refs/tags').decode('utf-8', errors='replace')
        for line in raw_refs.splitlines():
            name, oid, peeled, full = line.split('\0')
            refs.append({'name': name, 'oid': peeled or oid,
                         'kind': 'tag' if full.startswith('refs/tags/') else 'remote' if full.startswith('refs/remotes/') else 'branch'})
        return {'provider': 'local-git', 'repository': menu['repository'], 'head': menu['head'],
                'ref': ref, 'anchor': anchor, 'page': page, 'hasMore': len(commits)>limit,
                'commits': commits[:limit], 'refs': refs, 'specialRevisions': menu['specialRevisions'],
                'notice': 'Local refs are read without fetching. All-branch history is refreshed from current local tips.' if ref == '*' else ''}

    def changes(self, base='HEAD', target='WORKTREE'):
        before, after = self.resolve(base), self.resolve(target)
        if before['kind'] == 'worktree':
            raise ValueError('Choose a commit or INDEX as the base revision.')
        if before['id'] == after['id']:
            return []
        args = ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames']
        if before['kind'] == 'index':
            if after['kind'] == 'commit':
                args += ['--cached', '-R', after['id']]
        elif after['kind'] == 'index':
            args += ['--cached', before['id']]
        elif after['kind'] == 'worktree':
            args += [before['id']]
        else:
            args += [before['id'], after['id']]
        tokens = self._git(*args, '--', *PATCH_ROOTS).decode('utf-8', errors='replace').split('\0')
        entries = []
        index = 0
        while index < len(tokens) and tokens[index]:
            status = tokens[index]; old = tokens[index + 1]; index += 2
            new = old
            if status[0] in ('R', 'C'):
                new = tokens[index]; index += 1
            old = old if status[0] != 'A' and old.lower().endswith('.vl') and not self.project.excluded(old) else None
            new = new if status[0] != 'D' and new.lower().endswith('.vl') and not self.project.excluded(new) else None
            if not old and not new:
                continue
            for path in filter(None, (old, new)):
                self._path(path)
            entries.append({'path': new or old, 'oldPath': old, 'newPath': new,
                            'status': 'added' if not old else 'removed' if not new else 'renamed' if old != new else 'modified',
                            'untracked': False})
        if after['kind'] == 'worktree':
            for path in self._git('ls-files', '--others', '--exclude-standard', '-z', '--', *PATCH_ROOTS).decode('utf-8', errors='replace').split('\0'):
                if path and path.lower().endswith('.vl') and not self.project.excluded(path):
                    self._path(path)
                    entries.append({'path': path, 'oldPath': None, 'newPath': path, 'status': 'added', 'untracked': True})
        return sorted(entries, key=lambda entry: entry['path'])

    def read(self, revision, path):
        path = self._path(path)
        resolved = self.resolve(revision)
        if resolved['kind'] == 'worktree':
            file = self.root / path
            if not file.is_file():
                return None
            if file.stat().st_size > MAX_BYTES:
                raise ValueError('Document exceeds 12 MB.')
            data = file.read_bytes()
        else:
            if resolved['kind'] == 'index':
                entries = self._git('ls-files', '--stage', '-z', '--', path).split(b'\0')
                entries = [e for e in entries if e and e.split(b'\t', 1)[1].decode('utf-8') == path]
                if entries and not any(e.split(b'\t', 1)[0].endswith(b' 0') for e in entries):
                    raise ValueError('This file has an unmerged index. Choose a commit or the working tree.')
                metadata = next((e.split(b'\t', 1)[0].split() for e in entries if e.split(b'\t', 1)[0].endswith(b' 0')), None)
            else:
                entries = self._git('ls-tree', '-z', resolved['id'], '--', path).split(b'\0')
                metadata = next((e.split(b'\t', 1)[0].split() for e in entries if e and e.split(b'\t', 1)[1].decode('utf-8') == path), None)
            if not metadata:
                return None
            # Index metadata: mode oid stage. Tree metadata: mode type oid.
            oid = metadata[1 if resolved['kind'] == 'index' else 2].decode()
            if int(self._git('cat-file', '-s', oid)) > MAX_BYTES:
                raise ValueError('Document exceeds 12 MB.')
            data = self._git('cat-file', 'blob', oid)
        try:
            source = data.decode('utf-8-sig')
        except UnicodeError as error:
            raise ValueError('The revision is not a UTF-8 VL document.') from error
        return {'path': path, 'revision': resolved, 'source': source}
