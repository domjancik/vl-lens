import importlib.util
import sys
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE))
spec = importlib.util.spec_from_file_location('viewer_repository', BASE / 'repository.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RepositoryTests(unittest.TestCase):
    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.PIPE).decode().strip()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='git-test-', dir=BASE / 'tests')
        self.root = Path(self.directory.name).resolve()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Viewer test')
        self.git('config', 'user.email', 'viewer@example.invalid')
        self.path = 'Main/vl/A.vl'
        file = self.root / self.path
        file.parent.mkdir(parents=True)
        file.write_text('<Document Id="d" Version="1"/>', encoding='utf-8')
        self.git('add', '.')
        self.git('commit', '-qm', 'Baseline')
        self.commit = self.git('rev-parse', 'HEAD')
        self.repo = module.LocalGitRepository(self.root)

    def tearDown(self):
        # Verify the disposable repository stays inside this tool's tests directory.
        assert self.root.is_relative_to((BASE / 'tests').resolve())
        for attempt in range(20):
            try:
                self.directory.cleanup()
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.1)

    def test_worktree_index_and_commit_are_distinct_snapshots(self):
        file = self.root / self.path
        file.write_text('<Document Id="d" Version="2"/>', encoding='utf-8')
        self.git('add', self.path)
        file.write_text('<Document Id="d" Version="3"/>', encoding='utf-8')
        self.assertIsNotNone(self.repo.read('HEAD', self.path))
        self.assertIn('Version="1"', self.repo.read('HEAD', self.path)['source'])
        self.assertIn('Version="2"', self.repo.read('INDEX', self.path)['source'])
        self.assertIn('Version="3"', self.repo.read('WORKTREE', self.path)['source'])
        self.assertEqual(self.repo.changes('INDEX', 'WORKTREE')[0]['status'], 'modified')
        self.assertEqual(self.repo.changes('HEAD', 'INDEX')[0]['status'], 'modified')

    def test_untracked_and_deleted_patches_have_a_missing_side(self):
        (self.root / self.path).unlink()
        new = 'Main/vl/New patch.vl'
        (self.root / new).write_text('<Document Id="new"/>', encoding='utf-8')
        changes = {entry['path']: entry for entry in self.repo.changes()}
        self.assertIn(self.path, changes)
        self.assertEqual(changes[self.path]['status'], 'removed')
        self.assertEqual(changes[new]['status'], 'added')
        self.assertTrue(changes[new]['untracked'])
        self.assertIsNone(self.repo.read('HEAD', new))
        self.assertIsNone(self.repo.read('WORKTREE', self.path))

    def test_rename_preserves_old_and_new_paths_in_commit_comparison(self):
        self.git('mv', self.path, 'Main/vl/Renamed.vl')
        self.git('commit', '-qm', 'Rename')
        entries = self.repo.changes(self.commit, 'HEAD')
        self.assertTrue(entries)
        self.assertEqual(entries[0]['status'], 'renamed')
        self.assertEqual(entries[0]['oldPath'], self.path)
        self.assertEqual(entries[0]['newPath'], 'Main/vl/Renamed.vl')
        self.assertEqual(self.repo.read(self.commit, self.path)['source'], self.repo.read('HEAD', 'Main/vl/Renamed.vl')['source'])

    def test_ref_and_path_input_cannot_become_git_options_or_escape_scope(self):
        for revision in ['--help', '-c core.pager=evil', 'HEAD:Main/vl/A.vl', 'HEAD\x00bad', 'not-a-ref']:
            with self.subTest(revision=revision), self.assertRaises(ValueError):
                self.repo.read(revision, self.path)
        for path in ['../.git/config', '.git/config', 'Main/vl/../../secret.vl', '/Main/vl/A.vl', 'Main/vl/A.vl\x00']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.repo.read('HEAD', path)

    def test_revision_menu_reports_resolved_commits(self):
        menu = self.repo.revisions()
        self.assertIn('head', menu)
        self.assertEqual(menu['head'], self.commit)
        self.assertEqual(menu['commits'][0]['oid'], self.commit)
        self.assertTrue(any(ref['name'] == 'HEAD' for ref in menu['refs']))

    def test_history_keeps_merge_parents_branch_labels_and_pinned_pagination(self):
        self.assertTrue(hasattr(self.repo, 'history'), 'Visual Git history provider is missing')
        self.git('branch', '-M', 'main')
        self.git('checkout', '-qb', 'feature')
        (self.root/'Feature.vl').write_text('<Document Id="feature"/>')
        self.git('add', '.'); self.git('commit', '-qm', 'Feature')
        self.git('checkout', '-q', 'main')
        (self.root/'Main.vl').write_text('<Document Id="main"/>')
        self.git('add', '.'); self.git('commit', '-qm', 'Main')
        self.git('merge', '--no-ff', 'feature', '-m', 'Merge feature')
        page = self.repo.history('*', limit=2)
        self.assertEqual(len(page['commits'][0]['parents']), 2)
        self.assertEqual(page['commits'][0]['author'], 'Viewer test')
        self.assertTrue(page['hasMore'])
        self.assertTrue(any(r['name']=='feature' and r['kind']=='branch' for r in page['refs']))
        older = self.repo.history(page['anchor'], page=2, limit=2)
        self.assertEqual(len(older['commits']), 2)
        self.assertEqual(older['commits'][-1]['parents'], [])
        for value in ['--all', '-1', 'WORKTREE']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.repo.history(value)

    def test_snapshot_document_list_includes_historical_files_and_excludes_deleted_worktree_files(self):
        (self.root / self.path).unlink()
        self.assertEqual(self.repo.documents('HEAD'), [self.path])
        self.assertEqual(self.repo.documents('INDEX'), [self.path])
        self.assertEqual(self.repo.documents('WORKTREE'), [])

    def test_arbitrary_project_paths_and_repository_subfolders_work(self):
        file=self.root/'Library/Generic.VL';file.parent.mkdir();file.write_text('<Document Id="generic"/>')
        self.git('add','.');self.git('commit','-qm','Add generic patch')
        self.assertIn('Library/Generic.VL',self.repo.documents('HEAD'))
        nested=module.LocalGitRepository(self.root/'Library')
        self.assertEqual(nested.documents('HEAD'),['Generic.VL'])
        self.assertIn('generic',nested.read('HEAD','Generic.VL')['source'])
        file.write_text('<Document Id="edited"/>')
        self.assertEqual(nested.changes()[0]['path'],'Generic.VL')


if __name__ == '__main__':
    unittest.main()
