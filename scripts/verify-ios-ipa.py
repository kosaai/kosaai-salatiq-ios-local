"""Inspect real IPA contents, device Mach-O, bundled offline runtime assets."""
import argparse
import hashlib
import plistlib
import re
import struct
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('ipa', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
with zipfile.ZipFile(args.ipa) as archive:
    names = archive.namelist()
    applications = {n.split('/')[1] for n in names if n.startswith('Payload/') and len(n.split('/')) > 2 and n.split('/')[1].endswith('.app')}
    assert len(applications) == 1, 'Expected exactly one device app under Payload/'
    app = f'Payload/{applications.pop()}/'
    info = plistlib.loads(archive.read(app + 'Info.plist'))
    assert info['CFBundleIdentifier'] == 'com.kosaai.salatiq'
    assert info['DTPlatformName'] == 'iphoneos'
    assert info['CFBundleSupportedPlatforms'] == ['iPhoneOS']
    assert info['CFBundleDisplayName'] == 'Salatiq'
    assert info['CFBundleName'] == 'Salatiq'
    assert info['CFBundleExecutable'] == 'Salatiq'
    assert app == 'Payload/Salatiq.app/'
    localized_data = archive.read(app + 'ar.lproj/InfoPlist.strings')
    # Xcode can compile .strings into binary plists or retain UTF-8/UTF-16 text.
    if localized_data.startswith((b'bplist00', b'<?xml')):
        localized = plistlib.loads(localized_data)
        assert localized['CFBundleDisplayName'] == 'صلاتك'
    else:
        encoding = 'utf-16' if localized_data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
        localized_text = localized_data.decode(encoding)
        assert re.fullmatch(r'\s*"CFBundleDisplayName"\s*=\s*"صلاتك"\s*;\s*', localized_text), 'Arabic Home Screen name missing or incorrect'
    assert info['NSCameraUsageDescription']
    binary = archive.read(app + info['CFBundleExecutable'])
    magic, cpu = struct.unpack_from('<II', binary)
    assert magic == 0xFEEDFACF and cpu == 0x0100000C, 'Expected ARM64 Mach-O'
    # LC_BUILD_VERSION platform 2 is iOS device; platform 7 is Simulator.
    commands = struct.unpack_from('<I', binary, 16)[0]
    offset = 32
    device = False
    dynamic_libraries = []
    for _ in range(commands):
        command, size = struct.unpack_from('<II', binary, offset)
        if command == 0x32:
            assert struct.unpack_from('<I', binary, offset + 8)[0] == 2
            device = True
        if command == 0x25: device = True  # older LC_VERSION_MIN_IPHONEOS
        if command & 0x7FFFFFFF in (0x0C, 0x18, 0x1F, 0x23):
            name_offset = struct.unpack_from('<I', binary, offset + 8)[0]
            name = binary[offset + name_offset:offset + size].split(b'\0', 1)[0].decode()
            dynamic_libraries.append(name)
        offset += size
    assert device, 'No iOS device platform command'
    for symbol in (b'LocalClassificationModule', b'LocalClassificationView', b'PoseClassifier'):
        assert symbol in binary, f'Native local classification implementation missing: {symbol.decode()}'
    for framework in ('AVFoundation.framework/', 'CoreML.framework/'):
        assert any(framework in library for library in dynamic_libraries), f'Missing native dependency: {framework}'
    js = archive.read(app + 'main.jsbundle')
    assert len(js) > 100_000
    assert any('/best.mlmodelc/' in n for n in names), 'Compiled Core ML model missing'
    # RN SDK 57 uses hermesvm.framework; other versions can use hermes.framework.
    # React/Expo can be statically linked, so their absence as separate frameworks
    # is not an error. Inspect the binary's actual non-system loader dependencies.
    for library in dynamic_libraries:
        if library.startswith('@rpath/'):
            relative = library[len('@rpath/'):]
            if relative.startswith('libswift'):
                continue  # Swift runtime also ships in supported iPhoneOS versions
            assert app + 'Frameworks/' + relative in names, f'Missing embedded native dependency: {library}'
        elif library.startswith('@executable_path/'):
            assert app + library[len('@executable_path/'):] in names, library
    sounds = [n for n in names if n.startswith(app) and n.endswith('/subhan_allah.mp3')]
    assert sounds
    expected = (root / 'assets/audio/subhan_allah.mp3').read_bytes()
    assert all(archive.read(n) == expected for n in sounds)
    assert any(n.endswith('/Assets.car') for n in names)
    assert any('SplashScreen' in n for n in names)
    assert not info.get('UIBackgroundModes')
    assert app + 'ip.txt' not in names, 'Debug Metro host file must not be bundled'
    expo = plistlib.loads(archive.read(app + 'Expo.plist'))
    assert expo.get('EXUpdatesEnabled') is False, 'Remote updates must remain disabled'
print('PASS: real ARM64 iPhone binary, native AVFoundation/Core ML classification, bundled JS/Hermes, model, sound, frameworks and icon/splash; remote updates disabled.')
print('Identity:', {key: info[key] for key in ('CFBundleDisplayName', 'CFBundleName', 'CFBundleIdentifier', 'CFBundleExecutable')})
print('Arabic localized display name: صلاتك')
print('Size:', args.ipa.stat().st_size, 'bytes')
print('SHA-256:', hashlib.sha256(args.ipa.read_bytes()).hexdigest())
