"""Build a portable Windows distribution; run in the desktop dependency venv."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    if sys.platform != 'win32':
        raise SystemExit('This release target is Windows x64. Build it on Windows.')
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--windowed',
                    '--name', 'VL-Lens', '--distpath', str(ROOT / 'dist'),
                    '--workpath', str(ROOT / 'build'), '--specpath', str(ROOT / 'build'),
                    '--add-data', f'{ROOT / "static"}{os.pathsep}static',
                    '--add-data', f'{ROOT / "examples"}{os.pathsep}examples',
                    '--collect-all', 'webview', '--hidden-import', 'clr_loader',
                    '--exclude-module', 'PyQt5', '--exclude-module', 'PyQt6',
                    '--exclude-module', 'PySide2', '--exclude-module', 'PySide6',
                    str(ROOT / 'desktop.py')], cwd=ROOT, check=True)
    shutil.copy2(ROOT / 'LICENSE', ROOT / 'dist/VL-Lens/LICENSE.txt')
    shutil.copy2(ROOT / 'docs/DESKTOP.md', ROOT / 'dist/VL-Lens/README.txt')
    archive = shutil.make_archive(str(ROOT / 'dist/VL-Lens-Windows-x64'), 'zip', ROOT / 'dist', 'VL-Lens')
    print(archive)


if __name__ == '__main__':
    main()
