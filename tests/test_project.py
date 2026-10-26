import importlib.util
from pathlib import Path
import tempfile
import unittest

BASE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('viewer_project',BASE/'project.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='project-test-',dir=BASE/'tests')
        self.root=Path(self.temp.name).resolve()
        for name in ['Example.vl','Library/Thing.VL','Other/Thing.vl','node_modules/Dependency.vl','.git/Hidden.vl','build/Excluded.vl']:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('<Document Id="d"/>')
        self.project=module.Project(self.root,excludes=('build',))

    def tearDown(self):
        assert self.root.is_relative_to((BASE/'tests').resolve());self.temp.cleanup()

    def test_catalog_is_generic_and_preserves_folder_paths(self):
        paths={file['path'] for file in self.project.catalog()}
        self.assertEqual(paths,{'Example.vl','Library/Thing.VL','Other/Thing.vl'})
        self.assertEqual(self.project.document_path('Example.vl'),self.root/'Example.vl')

    def test_paths_cannot_leave_project_or_enter_excluded_folders(self):
        for path in ['../outside.vl','.git/Hidden.vl','node_modules/Dependency.vl','build/Excluded.vl','/Example.vl','C:/Example.vl']:
            with self.subTest(path=path),self.assertRaises(ValueError):self.project.document_path(path)
        self.assertEqual(self.project.document_path('Removed.vl',must_exist=False),self.root/'Removed.vl')

    def test_workspace_identity_is_stable_and_specific_to_root(self):
        meta=self.project.describe();self.assertIn('id',meta);self.assertIn('name',meta)
        self.assertEqual(meta['id'],module.Project(self.root).describe()['id'])
        self.assertNotEqual(meta['id'],module.Project(self.root/'Library').describe()['id'])


if __name__=='__main__':unittest.main()
