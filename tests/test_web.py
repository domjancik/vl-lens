import io
import json
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
        for route in ['/api/document?path=examples/Hello.vl', '/api/git/revisions', '/api/exports']:
            data, status = self.request(route)
            self.assertGreaterEqual(status, 400)

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


if __name__ == '__main__':
    unittest.main()
