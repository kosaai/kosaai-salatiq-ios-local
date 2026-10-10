"""Read-only check against the baseline recorded before iOS work started."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = Path('/home/opc/Desktop/kosaai-salatiq-android-local')
baseline = json.loads((root / '.ios-tools/android-source-baseline.json').read_text())
current = {}
for directory, _, files in os.walk(source):
    for name in files:
        file = Path(directory) / name
        stat = file.lstat()
        current[str(file.relative_to(source))] = {'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns, 'mode': stat.st_mode, 'link': os.readlink(file) if file.is_symlink() else None}
assert current == baseline, f'Android metadata changed: {[n for n in set(current) | set(baseline) if current.get(n) != baseline.get(n)][:20]}'
hashes = json.loads((root / '.ios-tools/android-source-hashes.json').read_text())
for name, expected in hashes.items():
    assert hashlib.sha256((source / name).read_bytes()).hexdigest() == expected, name
env = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}
status = subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, env=env).decode()
assert not status, status
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, env=env).decode().strip() == '8da8a5553836b4b341450f2ca57e46e5e8b1459a'
report = {'status': 'PASS', 'source': str(source), 'file_metadata_count': len(current), 'tracked_sha256_count': len(hashes), 'head': '8da8a5553836b4b341450f2ca57e46e5e8b1459a', 'git_status': 'clean'}
destination = root / 'validation-output/android-unchanged.json'
destination.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
