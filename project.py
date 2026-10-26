"""Generic VL workspace discovery and path confinement."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import subprocess

DEFAULT_EXCLUDES = {'node_modules', 'bin', 'obj', '__pycache__', 'venv'}


class Project:
    def __init__(self, root, excludes=()):
        self.root = Path(root).resolve()
        self.excludes = DEFAULT_EXCLUDES | {name.casefold() for name in excludes}

    def excluded(self, path):
        return any(part.startswith('.') or part.casefold() in self.excludes for part in PurePosixPath(path).parts)

    def document_path(self, path, must_exist=True):
        if not isinstance(path, str) or not path or len(path)>1024 or '\x00' in path or '\\' in path:
            raise ValueError('Invalid project path.')
        parts = PurePosixPath(path)
        if parts.is_absolute() or '..' in parts.parts or ':' in path or parts.suffix.lower() != '.vl' or self.excluded(path):
            raise ValueError('Choose a VL file inside the configured project.')
        candidate = (self.root / path).resolve()
        if not candidate.is_relative_to(self.root):
            raise ValueError('The file leaves the configured project.')
        if must_exist and not candidate.is_file():
            raise ValueError('Document not found. Refresh the project or choose another snapshot.')
        return candidate

    def catalog(self):
        files = []
        for directory, folders, names in os.walk(self.root, followlinks=False):
            folders[:] = sorted(name for name in folders if not name.startswith('.') and name.casefold() not in self.excludes)
            for name in sorted(names):
                path = Path(directory) / name
                relative = path.relative_to(self.root).as_posix()
                if path.suffix.lower() != '.vl' or self.excluded(relative):
                    continue
                try:
                    file = self.document_path(relative)
                    stat = file.stat()
                    files.append({'path':relative,'name':name,'bytes':stat.st_size,'modified':stat.st_mtime})
                except (OSError, ValueError):
                    continue
        return sorted(files,key=lambda f:f['path'].casefold())

    def describe(self):
        try:
            result = subprocess.run(['git','-c','core.fsmonitor=false','-C',str(self.root),'rev-parse','--is-inside-work-tree'],capture_output=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            has_git = result.returncode == 0 and result.stdout.strip() == b'true'
        except (OSError, subprocess.TimeoutExpired):
            has_git = False
        return {'id':hashlib.sha256(str(self.root).encode()).hexdigest()[:20], 'name':self.root.name, 'gitAvailable':has_git}
