import base64
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from github_repository import GitHubRepository, normalize_repository
except ImportError:
    GitHubRepository = normalize_repository = None

A, B = 'a' * 40, 'b' * 40


class GitHubTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(GitHubRepository, 'The GitHub snapshot provider is missing')
        self.calls = []
        self.metadata = {'full_name': 'person/library', 'private': False, 'default_branch': 'main'}
        self.trees = {
            A: [{'path': 'Old.vl', 'sha': '1' * 40, 'type': 'blob', 'mode': '100644'},
                {'path': 'Edit.vl', 'sha': '2' * 40, 'type': 'blob', 'mode': '100644'},
                {'path': 'Link.vl', 'sha': '3' * 40, 'type': 'blob', 'mode': '120000'}],
            B: [{'path': 'New.VL', 'sha': '1' * 40, 'type': 'blob', 'mode': '100644'},
                {'path': 'Edit.vl', 'sha': '4' * 40, 'type': 'blob', 'mode': '100644'}]}
        self.truncated = False

        def fetch(path):
            self.calls.append(path)
            if path == '/repos/person/library':
                return self.metadata
            if '/commits/' in path:
                sha = A if path.endswith('/old') or path.endswith('/' + A) else B
                return {'sha': sha, 'commit': {'tree': {'sha': sha}}, 'parents': [{'sha': A}]}
            if '/git/trees/' in path:
                sha = path.split('/git/trees/')[1].split('?')[0]
                return {'tree': self.trees[sha], 'truncated': self.truncated}
            if '/git/blobs/' in path:
                return {'size': 20, 'encoding': 'base64',
                        'content': base64.b64encode(b'<Document Id="d"/>').decode()}
            raise AssertionError(path)
        self.repo = GitHubRepository('person/library', fetch=fetch)

    def test_accepts_only_github_repository_identifiers(self):
        self.assertEqual(normalize_repository('https://github.com/person/library.git'), 'person/library')
        for value in ['https://evil.test/person/library', 'person/../secret', 'a/b/c', 'a/b?token=secret', 'https://u:p@github.com/a/b']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_repository(value)

    def test_public_history_returns_parents_branches_and_bounded_pages(self):
        self.assertTrue(hasattr(self.repo, 'history'), 'GitHub history provider is missing')
        from urllib.parse import urlsplit, parse_qs
        def commit(oid, parents):
            return {'sha':oid,'parents':[{'sha':p} for p in parents],
                    'commit':{'message':'A commit','author':{'name':'Author'},
                              'committer':{'date':'2026-01-01T00:00:00Z'}}}
        def fetch(path):
            if path == '/repos/person/library':return self.metadata
            if '/branches?' in path:return [{'name':'main','commit':{'sha':B}},{'name':'feature','commit':{'sha':A}}]
            if '/commits?' in path:
                query=parse_qs(urlsplit(path).query)
                self.assertLessEqual(int(query['per_page'][0]),100)
                return [commit(B,[A]),commit(A,[])] if query.get('page',['1'])[0]=='1' else [commit(A,[])]
            raise AssertionError(path)
        repo=GitHubRepository('person/library',fetch=fetch)
        page=repo.history('main',limit=2)
        self.assertEqual(page['anchor'],B)
        self.assertEqual(page['commits'][0]['parents'],[A])
        self.assertEqual(page['commits'][0]['author'],'Author')
        self.assertTrue(page['hasMore'])
        self.assertEqual(page['refs'][1]['name'],'feature')
        older=repo.history(B,page=2,limit=2)
        self.assertFalse(older['hasMore'])
        self.assertEqual(older['anchor'],B)
        with self.assertRaises(ValueError):repo.history('main',page=0)

    def test_history_rejects_private_repository_before_fetching_refs(self):
        self.metadata['private']=True
        with self.assertRaisesRegex(ValueError,'public'):
            self.repo.history()
        self.assertEqual(self.calls,['/repos/person/library'])

    def test_generic_github_files_are_listed_without_changing_vl_catalog(self):
        self.assertTrue(hasattr(self.repo,'read_file'))
        self.trees[A].append({'path':'README.md','sha':'5'*40,'type':'blob','mode':'100644'})
        self.trees[A].append({'path':'image.bin','sha':'6'*40,'type':'blob','mode':'100644'})
        original=self.repo.fetch
        def fetch(path):
            if path.endswith('/git/blobs/'+'6'*40):
                return {'size':3,'encoding':'base64','content':base64.b64encode(b'\x00\xffB').decode()}
            return original(path)
        self.repo.fetch=fetch
        self.assertIn('README.md',self.repo.files(A))
        self.assertNotIn('README.md',self.repo.documents(A))
        self.assertEqual(self.repo.read_file(A,'README.md')['kind'],'text')
        self.assertEqual(self.repo.read_file(A,'image.bin')['kind'],'binary')
        self.assertEqual(self.repo.read_file(A,'Link.vl')['kind'],'symlink')

    def test_branch_overview_always_includes_default_branch_beyond_first_page(self):
        from urllib.parse import urlsplit,parse_qs
        self.assertTrue(hasattr(self.repo,'history'))
        selected=[]
        def fetch(path):
            if path=='/repos/person/library':return self.metadata
            if '/branches?' in path:
                return [{'name':'feature-'+str(i),'commit':{'sha':format(i,'040x')}} for i in range(100)]
            if path.endswith('/commits/main'):return {'sha':B}
            if '/commits?' in path:
                sha=parse_qs(urlsplit(path).query)['sha'][0];selected.append(sha)
                return [{'sha':sha,'parents':[],'commit':{'message':'Tip','author':{'name':'A'},'committer':{'date':''}}}]
            raise AssertionError(path)
        repo=GitHubRepository('person/library',fetch=fetch)
        overview=repo.history('*')
        self.assertEqual(overview['head'],B)
        self.assertTrue(any(r['name']=='main' for r in overview['refs']))
        self.assertIn(B,selected)
        self.assertLessEqual(len(selected),6)
        self.assertIn('100',overview['notice'])

    def test_resolves_refs_to_immutable_commits_and_reads_by_blob(self):
        self.assertEqual(self.repo.resolve('old')['id'], A)
        self.assertEqual(self.repo.documents(A), ['Edit.vl', 'Old.vl'])
        self.assertEqual(self.repo.read(A, 'Old.vl')['source'], '<Document Id="d"/>')
        self.assertIsNone(self.repo.read(B, 'Old.vl'))
        with self.assertRaises(ValueError):
            self.repo.read(A, '../secret.vl')
        with self.assertRaises(ValueError):
            self.repo.resolve('WORKTREE')

    def test_compares_exact_trees_including_divergent_refs_and_exact_renames(self):
        changes = self.repo.changes('old', 'new')
        self.assertEqual([(c['path'], c['status']) for c in changes],
                         [('Edit.vl', 'modified'), ('Link.vl','removed'), ('New.VL', 'renamed')])
        self.assertEqual(changes[-1]['oldPath'], 'Old.vl')
        self.assertFalse(any('/compare/' in c for c in self.calls))

    def test_refuses_private_repos_even_with_server_credentials(self):
        self.metadata['private'] = True
        with self.assertRaisesRegex(ValueError, 'public'):
            self.repo.documents(A)
        self.assertEqual(self.calls, ['/repos/person/library'])

    def test_refuses_incomplete_trees_instead_of_silently_hiding_files(self):
        self.truncated = True
        with self.assertRaisesRegex(ValueError, 'large|incomplete'):
            self.repo.documents(A)


if __name__ == '__main__':
    unittest.main()
