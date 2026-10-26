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
                         [('Edit.vl', 'modified'), ('New.VL', 'renamed')])
        self.assertEqual(changes[1]['oldPath'], 'Old.vl')
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
