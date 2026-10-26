import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


class DocumentTests(unittest.TestCase):
    def test_example_preserves_namespaces_ids_and_source(self):
        path = ROOT / 'examples/Hello.vl'
        source = path.read_text(encoding='utf-8-sig')
        doc = server.parse_vl(source, 'examples/Hello.vl')
        self.assertEqual(doc['documentId'], 'demo-document')
        elements = list(server.walk(doc['tree']))
        node = next(e for e in elements if e['attrs'].get('Id') == 'multiply')
        self.assertGreater(node['line'], 0)
        reference = next(e for e in node['children'] if e['tag'] == 'p:NodeReference')
        self.assertEqual(reference['attrs']['LastDependency'], 'builtin')
        self.assertEqual(doc['source'], source)
        self.assertEqual(doc['warnings'], [])

    def test_structural_findings_do_not_pretend_to_be_compilation(self):
        doc = server.parse_vl('<Document Id="d"><Pin Id="a"/><Pin Id="a"/><Link Id="l" Ids="a,absent"/><Fragment Id="f" Patch="lost"/></Document>', 'one.vl')
        self.assertEqual({w['kind'] for w in doc['warnings']}, {'duplicate-id', 'missing-reference'})
        self.assertFalse(doc['compiled'])

    def test_text_literals_are_preserved_for_structural_diff(self):
        doc = server.parse_vl('<Document xmlns:p="property" Id="d"><Pad Id="p"><p:Value>alpha</p:Value></Pad></Document>', 'A.vl')
        self.assertEqual(doc['tree']['children'][0]['children'][0]['text'], 'alpha')
        spaces = server.parse_vl('<Document xmlns:p="property" Id="d"><Pad Id="p"><p:Value>  </p:Value></Pad></Document>', 'A.vl')
        self.assertEqual(spaces['tree']['children'][0]['children'][0]['text'], '  ')

    def test_malformed_snapshot_retains_a_raw_diff_instead_of_losing_both_sides(self):
        class Provider:
            def resolve(self, revision):
                return {'id': revision, 'label': revision, 'kind': 'commit'}
            def read(self, revision, path):
                return {'path': path, 'source': '<Document>' if revision == 'old' else '<Document Id="d"/>'}
        comparison = server.compare_snapshots(Provider(), 'old', 'new', 'A.vl', 'A.vl')
        self.assertIn('parseError', comparison['before'])
        self.assertEqual(comparison['after']['documentId'], 'd')
        self.assertIn('-<Document>', comparison['textDiff'])

    def test_malformed_and_entity_documents_are_rejected(self):
        for xml in ['<Document>', '<notVL/>', '<!DOCTYPE Document [<!ENTITY x "hello">]><Document Id="d">&x;</Document>']:
            with self.subTest(xml=xml), self.assertRaises(ValueError):
                server.parse_vl(xml, 'bad.vl')

    def test_path_resolution_cannot_escape_patch_roots(self):
        self.assertEqual(server.safe_document_path('examples/Hello.vl'), ROOT / 'examples/Hello.vl')
        for path in ['../../secret.vl', '../outside.vl', '.git/config.vl', 'C:/Windows/win.ini', 'server.py']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                server.safe_document_path(path)

    def test_export_lookup_requires_explicit_directory_and_document_identity(self):
        import tempfile
        from project import Project
        with tempfile.TemporaryDirectory(dir=ROOT/'tests') as directory:
            root = Path(directory)
            (root/'A.vl').write_text('<Document Id="d"/>')
            exports = root/'Exports'
            (exports/'A.vl').mkdir(parents=True)
            (exports/'A.vl/Node.cs').write_text('[DocumentId = @"d", PersistentId = @"node"]')
            with patch.object(server, 'ROOT', root), patch.object(server, 'PROJECT', Project(root)), patch.object(server, 'EXPORT_ROOT', exports):
                hits = server.find_exports('A.vl', 'd', 'node')
                self.assertEqual(len(hits), 1)
                self.assertEqual(server.find_exports('A.vl', 'wrong', 'node'), [])
        with patch.object(server, 'EXPORT_ROOT', None):
            self.assertEqual(server.find_exports('examples/Hello.vl', 'd', 'node'), [])

    def test_server_rejects_rebinding_hosts_and_cross_origin_requests(self):
        handler = object.__new__(server.Handler)
        handler.server = SimpleNamespace(server_port=8766)
        replies = []
        handler.send_data = lambda data, **kwargs: replies.append((data, kwargs))
        for headers in [{'Host':'evil.example:8766'},
                        {'Host':'127.0.0.1:8766','Origin':'https://evil.example'},
                        {'Host':'127.0.0.1:8766','Sec-Fetch-Site':'cross-site'}]:
            handler.headers = headers
            self.assertFalse(handler.allowed_request())
            self.assertEqual(replies[-1][1]['status'], 403)
        handler.headers = {'Host':'127.0.0.1:8766','Origin':'http://127.0.0.1:8766'}
        self.assertTrue(handler.allowed_request())


if __name__ == '__main__':
    unittest.main()
