from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
try:
    from filetypes import describe_file, validate_git_path
except ImportError:
    describe_file=validate_git_path=None

class FileDiffTests(unittest.TestCase):
    def test_vl_named_symlink_is_compared_as_a_target_string(self):
        self.assertIsNotNone(describe_file)
        class Provider:
            def resolve(self,r):return {'id':r,'kind':'commit','label':r}
            def read_file(self,r,p):return describe_file(p,b'../outside',kind='symlink')
        result=server.compare_snapshots(Provider(),'old','new','Link.vl','Link.vl')
        self.assertEqual(result['kind'],'text')
        self.assertNotIn('parseError',result['before'])

    def test_text_encodings_binary_detection_and_path_confinement(self):
        self.assertIsNotNone(describe_file,'Generic file snapshots are missing')
        self.assertEqual(describe_file('A.txt','hello'.encode('utf-16'))['source'],'hello')
        self.assertEqual(describe_file('image.bin',b'\x00\xffdata')['kind'],'binary')
        self.assertEqual(validate_git_path('.github/workflows/ci.yml'),'.github/workflows/ci.yml')
        for path in ['../secret','/etc/passwd','.git/config','A/../B','C:/secret','A\\B']:
            with self.subTest(path=path),self.assertRaises(ValueError):validate_git_path(path)

    def test_non_vl_comparison_returns_numbered_text_hunks(self):
        self.assertIsNotNone(describe_file)
        class Provider:
            def resolve(self,revision):return {'id':revision,'kind':'commit','label':revision}
            def read_file(self,revision,path):
                return describe_file(path,b'first\nold\n' if revision=='old' else b'first\nnew\n')
        result=server.compare_snapshots(Provider(),'old','new','README.md','README.md')
        self.assertEqual(result['kind'],'text')
        self.assertEqual(result['lineStats'],{'added':1,'removed':1})
        self.assertTrue(any(r['kind']=='remove' and r['oldLine']==2 for r in result['lines']))
        self.assertNotIn('parseError',result['before'])

    def test_binary_comparisons_and_missing_sides_preserve_metadata(self):
        self.assertIsNotNone(describe_file)
        class Provider:
            def resolve(self,r):return {'id':r,'kind':'commit','label':r}
            def read_file(self,r,p):return describe_file(p,b'\x00old' if r=='old' else b'\x00new')
        result=server.compare_snapshots(Provider(),'old','new',None,'image.bin')
        self.assertEqual(result['kind'],'binary')
        self.assertIsNone(result['before'])
        self.assertEqual(result['after']['bytes'],4)
        self.assertNotIn('source',result['after'])
