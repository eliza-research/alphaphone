#!/usr/bin/env python3
"""Prepare an unsigned APK for subsequent signing and presigned AOSP import.

Only ZIP storage/alignment changes. Signing and device installation are separate.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import zipfile


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(archive):
    result = {}
    for entry in archive.infolist():
        name = entry.filename
        parts = PurePosixPath(name).parts
        if name in result or name.startswith('/') or '\\' in name or '..' in parts:
            raise ValueError('Duplicate or unsafe APK entry: ' + name)
        if entry.flag_bits & 1 or entry.file_size > 1024 ** 3:
            raise ValueError('Encrypted or oversized APK entry: ' + name)
        with archive.open(entry) as stream:
            result[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    if 'AndroidManifest.xml' not in result or 'classes.dex' not in result:
        raise ValueError('Input is not a complete APK')
    return result


def prepare(source, output, zipalign):
    with zipfile.ZipFile(source) as original:
        before = inventory(original)
        if any(n.upper().startswith('META-INF/') and n.upper().endswith(
                ('.RSA', '.DSA', '.EC', '.SF')) for n in before):
            raise ValueError('Input must be unsigned; refusing to discard signatures')
        with source.open('rb') as stream:
            stream.seek(max(0, original.start_dir - 16))
            if stream.read(16) == b'APK Sig Block 42':
                raise ValueError('Input contains an APK signing block; use unsigned build output')
        output.mkdir(parents=True, exist_ok=False)
        packed = output / 'unaligned-unsigned.apk'
        with zipfile.ZipFile(packed, 'x') as archive:
            for entry in original.infolist():
                replacement = copy.copy(entry)
                replacement.extra = b''  # alignment is rebuilt below
                if (entry.filename.startswith('lib/') and entry.filename.endswith('.so')) or entry.filename.endswith('.dex'):
                    replacement.compress_type = zipfile.ZIP_STORED
                with original.open(entry) as reader, archive.open(replacement, 'w') as writer:
                    shutil.copyfileobj(reader, writer)
    aligned = output / 'launcher-aosp-unsigned.apk'
    subprocess.run([str(zipalign), '-P', '16', '4', str(packed), str(aligned)], check=True)
    subprocess.run([str(zipalign), '-c', '-P', '16', '4', str(aligned)], check=True,
                   stdout=subprocess.DEVNULL)
    with zipfile.ZipFile(aligned) as archive:
        if inventory(archive) != before:
            raise ValueError('APK payload changed during preparation')
        native = [e for e in archive.infolist()
                  if e.filename.startswith('lib/') and e.filename.endswith('.so')]
        if not native or any(e.compress_type != zipfile.ZIP_STORED for e in native):
            raise ValueError('Missing or compressed native libraries')
        dex = [e for e in archive.infolist() if e.filename.endswith('.dex')]
        if not dex or any(e.compress_type != zipfile.ZIP_STORED for e in dex):
            raise ValueError('Missing or compressed DEX entries')
    report = {'schemaVersion': 1, 'inputSha256': digest(source),
              'outputSha256': digest(aligned), 'payloadEntries': before,
              'payloadUnchanged': True, 'nativeEntries': len(native),
              'nativeLibrariesStored': True, 'dexEntriesStored': True,
              'zipAlignmentBytes': 16384,
              'signed': False, 'deployReady': False,
              'remaining': ['sign prepared APK', 'AOSP presigned check',
                            'stage bundled native executables', 'image and runtime validation']}
    (output / 'preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    packed.unlink()
    return aligned


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New output directory')
    parser.add_argument('--zipalign', type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.input, args.output, args.zipalign))
