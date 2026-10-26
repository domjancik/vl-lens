"""Safe, bounded file snapshots for read-only Git comparisons."""
import hashlib
from pathlib import PurePosixPath

MAX_TEXT_CHARS=128000

def validate_git_path(path):
    if not isinstance(path,str) or not path or len(path)>1024 or '\x00' in path or '\\' in path or ':' in path:
        raise ValueError('Choose a repository-relative file.')
    if PurePosixPath(path).is_absolute() or any(p in ('','.', '..') or p.casefold()=='.git' for p in path.split('/')):
        raise ValueError('The file leaves the repository or accesses Git metadata.')
    return path

def describe_file(path, data, **metadata):
    result={'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),**metadata}
    encoding='utf-8'
    if data.startswith((b'\xff\xfe\x00\x00',b'\x00\x00\xfe\xff')):encoding='utf-32'
    elif data.startswith((b'\xff\xfe',b'\xfe\xff')):encoding='utf-16'
    elif data.startswith(b'\xef\xbb\xbf'):encoding='utf-8-sig'
    try:
        if encoding=='utf-8' and b'\x00' in data:raise UnicodeError()
        source=data.decode(encoding)
    except UnicodeError:
        return {**result,'kind':'binary'}
    limit=len(source) if path.lower().endswith('.vl') else MAX_TEXT_CHARS
    newline='CRLF' if '\r\n' in source and '\n' not in source.replace('\r\n','') else 'LF' if '\n' in source and '\r' not in source else 'mixed' if '\r' in source else 'none'
    return {**result,'kind':metadata.get('kind','text'),'encoding':encoding,'newline':newline,
            'endsWithNewline':source.endswith(('\n','\r')),'source':source[:limit],'sourceTruncated':len(source)>limit}
