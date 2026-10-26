"""Native desktop window around the same loopback-only viewer."""
import argparse
import json
import os
from pathlib import Path
import sys
import threading
import time
from http.server import ThreadingHTTPServer

import webview
from webview.menu import Menu, MenuAction

from run import configure
from web import WebHandler


def main():
    parser = argparse.ArgumentParser(description='VL Lens desktop viewer')
    parser.add_argument('--root', type=Path, help='Local project folder')
    parser.add_argument('--smoke-report', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    bundled = Path(__file__).resolve().parent
    configure(args.root or bundled / 'examples')
    http = ThreadingHTTPServer(('127.0.0.1', 0), WebHandler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{http.server_port}'
    window = webview.create_window('VL Lens', origin + '/viewer', width=1440, height=960, min_size=(900, 650))

    def open_project():
        folders = window.create_file_dialog(webview.FileDialog.FOLDER)
        if folders:
            configure(folders[0])
            window.load_url(origin + '/viewer')

    def smoke():
        report = {}
        try:
            for attempt in range(30):
                time.sleep(0.4)
                report = window.evaluate_js("({title:document.title,ready:!!document.getElementById('fileTree'),workspace:document.getElementById('workspaceName')?.textContent,error:document.getElementById('errorText')?.textContent})") or {}
                if report.get('workspace') == (args.root or bundled / 'examples').name:
                    break
            report['nativeWindow'] = True
            report['passed'] = bool(report.get('ready') and report.get('workspace') and not report.get('error'))
        except Exception as error:
            report = {'passed': False, 'error': str(error)}
        finally:
            args.smoke_report.write_text(json.dumps(report, indent=2), encoding='utf-8')
            window.destroy()

    menu = [Menu('File', [MenuAction('Open project folder…', open_project),
                         MenuAction('Viewer', lambda: window.load_url(origin + '/viewer')),
                         MenuAction('Home', lambda: window.load_url(origin + '/')),
                         MenuAction('Quit', window.destroy)])]
    storage = Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local/share')) / 'VL Lens'
    storage.mkdir(parents=True, exist_ok=True)
    try:
        webview.start(smoke if args.smoke_report else None, menu=menu,
                      gui='edgechromium' if sys.platform == 'win32' else None,
                      private_mode=False, storage_path=str(storage))
    finally:
        http.shutdown()
        http.server_close()


if __name__ == '__main__':
    main()
