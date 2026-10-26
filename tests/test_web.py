import io
import json
import re
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from web import HostedHandler, WebHandler, parse_upload
except ImportError:
    HostedHandler = WebHandler = parse_upload = None


class WebTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(WebHandler, 'Standalone web routes are missing')

    def request(self, path, method='GET', source=None):
        instance = object.__new__(HostedHandler)
        instance.path = path
        instance.headers = {}
        instance.client_address = ('127.0.0.1', 1)
        instance.rfile = io.BytesIO()
        replies = []
        instance.send_data = lambda data, content_type='', status=200: replies.append((data, status))
        if source is not None:
            data = json.dumps(source).encode()
            instance.rfile = io.BytesIO(data)
            instance.headers = {'Content-Length': str(len(data))}
        getattr(instance, 'do_' + method)()
        return replies[-1]

    def test_hosted_mode_starts_empty_and_never_reads_host_filesystem(self):
        data, status = self.request('/api/documents')
        self.assertEqual(status, 200)
        self.assertEqual(data['documents'], [])
        self.assertFalse(data['workspace']['gitAvailable'])
        for route in ['/api/document?path=examples/Hello.vl', '/api/git/revisions', '/api/git/history', '/api/exports']:
            data, status = self.request(route)
            self.assertGreaterEqual(status, 400)

    def test_history_endpoint_preserves_selected_branch_and_page(self):
        from unittest.mock import patch
        class Provider:
            def __init__(self, slug):self.slug=slug
            def history(self, ref, page, limit):
                return {'repository':self.slug,'ref':ref,'page':int(page),'commits':[]}
        with patch('web.GitHubRepository',Provider):
            data,status=self.request('/api/git/history?repo=person/library&ref=feature%2Fmerge&page=2&limit=50')
        self.assertEqual(status,200)
        self.assertEqual(data['ref'],'feature/merge')
        self.assertEqual(data['page'],2)

    def test_hosted_parser_validates_uploads_and_rejects_entities(self):
        data, status = self.request('/api/parse', 'POST', {'path': 'A.vl', 'source': '<Document Id="d"/>'})
        self.assertEqual(status, 200)
        self.assertEqual(data['documentId'], 'd')
        for source in ['<!DOCTYPE Document><Document Id="d"/>', '<Document>']:
            _, status = self.request('/api/parse', 'POST', {'path': 'A.vl', 'source': source})
            self.assertEqual(status, 400)
        with self.assertRaises(ValueError):
            parse_upload({'path': 'A.txt', 'source': '<Document Id="d"/>'}, hosted=True)

    def test_remote_repository_does_not_accept_arbitrary_network_hosts(self):
        _, status = self.request('/api/documents?repo=https://localhost/private')
        self.assertEqual(status, 400)

    def test_config_explains_hosted_limits_and_public_repository_scope(self):
        data, status = self.request('/api/config')
        self.assertEqual(status, 200)
        self.assertTrue(data['hosted'])
        self.assertEqual(data['repositoryAccess'], 'public')
        self.assertLess(data['maxUploadBytes'], 4_500_000)

    def test_serverless_rewrites_preserve_api_route(self):
        data, status = self.request('/api/index.py?_route=/api/config')
        self.assertEqual(status, 200)
        self.assertTrue(data['hosted'])

    def test_vercel_entrypoint_exports_a_named_handler_class(self):
        from api.index import handler
        self.assertEqual(handler.__name__, 'handler')
        self.assertTrue(issubclass(handler, HostedHandler))

    def test_static_output_has_a_landing_index_and_distinct_viewer(self):
        static = Path(__file__).resolve().parents[1] / 'static'
        self.assertIn('See the patch.', (static/'index.html').read_text(encoding='utf-8'))
        self.assertIn('id="graph"', (static/'viewer.html').read_text(encoding='utf-8'))

    def test_vercel_route_captures_do_not_shadow_document_parameters(self):
        config = json.loads((Path(__file__).resolve().parents[1]/'vercel.json').read_text())
        api_route = next(r for r in config['rewrites'] if r['source'].startswith('/api/'))
        captures = set(re.findall(r':(\w+)', api_route['source']))
        self.assertFalse(captures & {'path', 'repo', 'ref', 'base', 'target', 'oldPath', 'newPath'})


if __name__ == '__main__':
    unittest.main()
