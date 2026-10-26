"""Run the standalone site and viewer on loopback."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import server
from project import Project
from web import HostedHandler, WebHandler


def configure(root, exports=None):
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError('Project folder must exist.')
    server.ROOT = root
    server.PROJECT = Project(root)
    server.EXPORT_ROOT = Path(exports).resolve() if exports else None
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--exports', type=Path)
    parser.add_argument('--port', type=int, default=8768)
    parser.add_argument('--hosted', action='store_true', help='Preview the Vercel handler without local filesystem access.')
    args = parser.parse_args()
    configure(args.root, args.exports)
    with ThreadingHTTPServer(('127.0.0.1', args.port), HostedHandler if args.hosted else WebHandler) as http:
        print(f'VL Lens: http://127.0.0.1:{http.server_port}', flush=True)
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
