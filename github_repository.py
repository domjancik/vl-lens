"""Read-only public GitHub snapshots. No checkout, arbitrary URLs or user tokens."""
import base64
from collections import OrderedDict
import json
import os
from pathlib import PurePosixPath
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

MAX_SOURCE_BYTES = 3 * 1024 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
_cache = OrderedDict()
_cache_lock = threading.Lock()
_cache_bytes = 0
_CACHE_BUDGET = 32 * 1024 * 1024


def normalize_repository(value):
    value = str(value).strip()
    if value.startswith('https://'):
        url = urlsplit(value)
        if url.netloc != 'github.com' or url.query or url.fragment:
            raise ValueError('Enter a public GitHub repository as owner/name or a github.com URL.')
        value = url.path.strip('/')
    value = value.removesuffix('.git')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}', value):
        raise ValueError('Enter a public GitHub repository as owner/name.')
    if value.split('/')[1] in ('.', '..'):
        raise ValueError('Invalid repository name.')
    return value


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def github_json(path):
    """Bounded, short-lived cache; all requests go to a fixed GitHub API host."""
    global _cache_bytes
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(path)
        if cached and cached[0] > now:
            _cache.move_to_end(path)
            return json.loads(cached[1])
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'VL-Lens',
               'X-GitHub-Api-Version': '2022-11-28'}
    token = os.environ.get('VL_LENS_GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    try:
        with build_opener(NoRedirects()).open(Request('https://api.github.com' + path, headers=headers), timeout=20) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValueError('GitHub response is too large. Use the desktop viewer for this repository.')
    except HTTPError as error:
        if error.code in (403, 429):
            raise ValueError('GitHub API limit reached. Wait before retrying; the host can configure VL_LENS_GITHUB_TOKEN.') from None
        if error.code == 404:
            raise ValueError('Public repository, revision or file not found.') from None
        if error.code == 401:
            raise ValueError('The host GitHub token is invalid. Contact the site owner.') from None
        raise ValueError('GitHub could not read this repository. Check its current owner and name.') from None
    except (URLError, TimeoutError, OSError):
        raise ValueError('GitHub is unavailable or timed out. Please retry.') from None
    data = json.loads(raw)
    with _cache_lock:
        previous = _cache.pop(path, None)
        if previous:
            _cache_bytes -= len(previous[1])
        _cache[path] = (now + 30, raw)
        _cache_bytes += len(raw)
        while _cache_bytes > _CACHE_BUDGET or len(_cache) > 256:
            _, (_, evicted) = _cache.popitem(last=False)
            _cache_bytes -= len(evicted)
    return data


class GitHubRepository:
    def __init__(self, repository, fetch=None):
        self.slug = normalize_repository(repository)
        self.prefix = '/repos/' + self.slug
        self.fetch = fetch or github_json
        self._info = None
        self._resolved = {}
        self._trees = {}

    def info(self):
        if self._info is None:
            metadata = self.fetch(self.prefix)
            if metadata.get('private') is not False or metadata.get('visibility', 'public') != 'public':
                raise ValueError('Only public GitHub repositories are supported.')
            self._info = metadata
        return self._info

    def resolve(self, revision):
        self.info()
        revision = revision or self.info()['default_branch']
        if revision in ('INDEX', 'WORKTREE') or not re.fullmatch(r'[\w][\w./@~-]{0,199}', revision):
            raise ValueError('Choose a GitHub commit, branch or tag. Local snapshots are unavailable.')
        if revision not in self._resolved:
            commit = self.fetch(self.prefix + '/commits/' + quote(revision, safe=''))
            sha = commit['sha']
            if not re.fullmatch(r'[a-f0-9]{40,64}', sha):
                raise ValueError('GitHub did not return a commit ID.')
            self._resolved[revision] = {'id': sha, 'label': revision, 'kind': 'commit'}
            self._resolved[sha] = {'id': sha, 'label': sha, 'kind': 'commit'}
        return self._resolved[revision]

    def tree(self, revision):
        sha = self.resolve(revision)['id']
        if sha not in self._trees:
            data = self.fetch(self.prefix + '/git/trees/' + sha + '?recursive=1')
            if data.get('truncated'):
                raise ValueError('Repository tree is too large or incomplete. Use a local clone in the desktop viewer.')
            self._trees[sha] = {item['path']: item for item in data['tree']
                                if item['type'] == 'blob' and item.get('mode') in ('100644', '100755')
                                and item['path'].lower().endswith('.vl')}
        return self._trees[sha]

    def documents(self, revision):
        return sorted(self.tree(revision))

    def catalog(self, revision):
        return [{'path': path, 'name': PurePosixPath(path).name, 'bytes': item.get('size', 0)}
                for path, item in sorted(self.tree(revision).items())]

    def describe(self, revision):
        resolved = self.resolve(revision)
        return {'id': 'github:' + self.slug.casefold(), 'name': self.slug,
                'gitAvailable': True, 'exportsAvailable': False, 'provider': 'github',
                'revision': resolved['id']}

    def revisions(self):
        branch = self.info()['default_branch']
        commits = self.fetch(self.prefix + '/commits?per_page=30')
        if not commits:
            raise ValueError('This repository has no commits.')
        head = commits[0]['sha']
        branches = self.fetch(self.prefix + '/branches?per_page=100')
        return {'provider': 'github', 'repository': {'id': self.slug, 'name': self.slug},
                'head': head, 'specialRevisions': [],
                'defaults': {'base': commits[0].get('parents', [{}])[0].get('sha', head) if commits[0].get('parents') else head,
                             'target': head},
                'refs': [{'name': item['name'], 'oid': item['commit']['sha']} for item in branches],
                'commits': [{'oid': item['sha'], 'short': item['sha'][:8],
                             'subject': item['commit']['message'].split('\n')[0],
                             'date': item['commit']['committer']['date']} for item in commits]}

    def read(self, revision, path):
        parts = PurePosixPath(path)
        if not path or len(path) > 1024 or '\\' in path or '\x00' in path or parts.is_absolute() or '..' in parts.parts or ':' in path or parts.suffix.lower() != '.vl':
            raise ValueError('Choose a repository-relative VL file.')
        resolved = self.resolve(revision)
        item = self.tree(resolved['id']).get(path)
        if item is None:
            return None
        if item.get('size', 0) > MAX_SOURCE_BYTES:
            raise ValueError('Hosted VL files are limited to 3 MB. Use the desktop viewer for larger files.')
        blob = self.fetch(self.prefix + '/git/blobs/' + item['sha'])
        if blob.get('size', 0) > MAX_SOURCE_BYTES or blob.get('encoding') != 'base64':
            raise ValueError('The hosted file is too large or uses an unsupported encoding.')
        try:
            content = base64.b64decode(blob['content'])
            if len(content) > MAX_SOURCE_BYTES:
                raise ValueError('Hosted VL files are limited to 3 MB.')
            source = content.decode('utf-8-sig')
        except (UnicodeError, KeyError):
            raise ValueError('The file is not a UTF-8 VL document.') from None
        return {'path': path, 'source': source, 'revision': resolved}

    def history(self, ref='', page=1, limit=50):
        try:
            page, limit = int(page), int(limit)
        except (ValueError, TypeError):
            raise ValueError('Invalid history page size.') from None
        if not 1 <= page <= 20 or not 1 <= limit <= 100:
            raise ValueError('History supports pages 1–20 and up to 100 commits per page.')
        info = self.info()
        ref = ref or info['default_branch']
        if ref != '*' and (ref in ('INDEX','WORKTREE') or not re.fullmatch(r'[\w][\w./@~-]{0,199}', ref)):
            raise ValueError('Choose a GitHub commit, branch or tag.')
        branches = self.fetch(self.prefix + '/branches?per_page=100')
        refs = [{'name': b['name'], 'oid': b['commit']['sha'], 'kind': 'branch'} for b in branches]
        default = next((r['oid'] for r in refs if r['name']==info['default_branch']), '')
        if not default:
            default = self.resolve(info['default_branch'])['id']
            refs.insert(0,{'name':info['default_branch'],'oid':default,'kind':'branch'})
        selected = [ref] if ref != '*' else [r['oid'] for r in sorted(refs,key=lambda r:(r['name']!=info['default_branch'],r['name']))[:6]]
        if ref == '*' and page != 1:
            raise ValueError('Select a branch to load older commits.')
        commits = {}
        more = False
        for tip in selected:
            data = self.fetch(self.prefix + '/commits?sha=' + quote(tip, safe='') + '&per_page=' + str(limit) + '&page=' + str(page))
            more = more or len(data)==limit
            for item in data:
                details = item['commit']
                commits[item['sha']] = {'oid':item['sha'], 'short':item['sha'][:8],
                    'subject':details['message'].split('\n')[0], 'parents':[p['sha'] for p in item.get('parents',[])],
                    'author':(details.get('author') or {}).get('name','Unknown'),
                    'date':(details.get('committer') or {}).get('date','')}
        values = list(commits.values())
        notice = ''
        if ref == '*':
            notice = 'Branch overview: up to 6 branch tips, '+str(limit)+' commits per tip. Select a branch to load older history.'
        if len(branches)==100:
            notice += ' Showing the first 100 branches; enter another branch or tag by name.'
        return {'provider':'github', 'repository':{'id':self.slug,'name':self.slug}, 'head':default,
                'defaultBranch':info['default_branch'], 'ref':ref,
                'anchor':ref if re.fullmatch(r'[a-f0-9]{40,64}',ref) else values[0]['oid'] if values else ref, 'page':page,
                'hasMore':more and ref!='*', 'commits':values, 'refs':refs,
                'specialRevisions':[], 'notice':notice.strip()}

    def changes(self, base, target):
        before, after = self.tree(base), self.tree(target)
        removed, added = set(before) - set(after), set(after) - set(before)
        changes = []
        # Only identical blobs are called renames. Edited moves stay delete/add.
        for old in sorted(removed):
            new = next((p for p in sorted(added) if after[p]['sha'] == before[old]['sha']), None)
            if new:
                changes.append({'path': new, 'oldPath': old, 'newPath': new, 'status': 'renamed'})
                added.remove(new)
            else:
                changes.append({'path': old, 'oldPath': old, 'newPath': None, 'status': 'removed'})
        for new in sorted(added):
            changes.append({'path': new, 'oldPath': None, 'newPath': new, 'status': 'added'})
        for path in sorted(set(before) & set(after)):
            if before[path]['sha'] != after[path]['sha']:
                changes.append({'path': path, 'oldPath': path, 'newPath': path, 'status': 'modified'})
        return sorted(changes, key=lambda c: c['path'])
