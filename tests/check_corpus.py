"""Parse every repository patch and pipe it through the browser's real scene model.

Read-only; no browser, network, generated exports, or gamma invocation.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

BASE = Path(__file__).resolve().parents[1]
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else BASE/'examples'
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('viewer_server', BASE / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

process = subprocess.Popen(['node', str(BASE / 'tests/check_corpus.mjs')], stdin=subprocess.PIPE,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
try:
    from project import Project
    for item in Project(ROOT).catalog():
        path = ROOT / item['path']
        document = server.parse_vl(path.read_text(encoding='utf-8-sig'), item['path'])
        process.stdin.write(json.dumps(document, ensure_ascii=True) + '\n')
    process.stdin.close()
    result = process.stdout.read()
    errors = process.stderr.read()
    code = process.wait()
    if code:
        raise RuntimeError(errors)
    print(result.strip())
finally:
    if process.poll() is None:
        process.terminate()
