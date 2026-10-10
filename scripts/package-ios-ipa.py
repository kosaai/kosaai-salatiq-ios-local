"""Package only a verified iPhone DEVICE application as Payload/Salatiq.app."""
import argparse
import os
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('app', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
assert args.app.is_dir() and args.app.suffix == '.app'
info = plistlib.loads((args.app / 'Info.plist').read_bytes())
assert info['DTPlatformName'] == 'iphoneos', 'Simulator app cannot be packaged for iPhone'
assert info['CFBundleSupportedPlatforms'] == ['iPhoneOS']
assert 'arm64' in subprocess.check_output(['lipo', '-archs', str(args.app / info['CFBundleExecutable'])], text=True)
assert (args.app / 'main.jsbundle').stat().st_size > 100_000, 'Release JS/Hermes bundle is missing'
assert list(args.app.rglob('best.mlmodelc')), 'Compiled Core ML model missing'
assert list(args.app.rglob('subhan_allah.mp3')), 'Alert sound missing'
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=args.output.parent, prefix='salatiq-ipa-') as temporary:
    payload = Path(temporary) / 'Payload'
    payload.mkdir()
    shutil.copytree(args.app, payload / 'Salatiq.app', symlinks=True)
    # ditto preserves Mach-O framework symlinks and executable permissions.
    archive = Path(temporary) / 'Salatiq.ipa'
    subprocess.run(['ditto', '-c', '-k', '--keepParent', str(payload), str(archive)], check=True)
    os.replace(archive, args.output)
print(args.output)
