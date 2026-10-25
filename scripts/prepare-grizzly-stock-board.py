#!/usr/bin/env python3
"""Prepare a reviewed B1 BoardConfig replacement without modifying an AOSP tree.

Only the exact audited generated board and pinned inherited configurations are
accepted. Installation, source re-admission, image rebuild and boot are separate.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOARD = 'vendor/google_devices/grizzly/BoardConfig.mk'
INPUTS = {
    BOARD: '533bf35c78f073958e82b3138eec378ae7f6f5c25545aa23de1173aa03d1545e',
    'vendor/google_devices/grizzly/grizzly.mk':
        'e40cc4daa8845ed800ff5c89a06ee0e75bd74f82e493267b31a7054f1104fc8d',
    'vendor/adevtool/config/mk/google_devices/common/BoardConfig-armv9.mk':
        'eab0f44a7b6f299b633b3bfd215181bc8b60e192c3f3640c4c04cc04bb045bfc',
    'vendor/adevtool/config/mk/google_devices/platform/malibu/BoardConfig-common.mk':
        '11db3973cae9f79ef8cbb340a672bc742b8defc7194de110fab96e521faffca4',
}
FRAGMENT = ROOT / 'android/aosp/grizzly/stock-boot-policy.mk'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(source, output):
    if '..' in source.parts or '..' in output.parts:
        raise ValueError('Parent traversal is not allowed in board preparation paths')
    source, output = source.absolute(), output.absolute()
    if output == source or source in output.parents:
        raise ValueError('Output must be outside the AOSP source tree')
    if any(p.is_symlink() for p in [output, *output.parents]):
        raise ValueError('Redirected output path')
    inputs = {}
    for name, expected in INPUTS.items():
        path = source / name
        # Reject redirected input files/directories, including the supplied root.
        if any(p.is_symlink() for p in [path, *path.parents]) or not path.is_file():
            raise ValueError('Redirected board input: ' + name)
        data = path.read_bytes()
        if sha(data) != expected:
            raise ValueError('Board input differs from audited B1 configuration: ' + name)
        inputs[name] = data
    fragment = FRAGMENT.read_bytes()
    replacement = inputs[BOARD].rstrip(b'\n') + b'\n\n' + fragment
    output.mkdir(parents=True, exist_ok=False)
    (output / 'BoardConfig.mk').write_bytes(replacement)
    report = {
        'schemaVersion': 1,
        'targetProduct': 'alpha_grizzly_phone',
        'stockBaseline': 'CD1A.260905.001.B1',
        'factorySha256': '4ce23ec89002abdff0d9b7f3fb32d9efe5741355f4280ee573217dcf426211d3',
        'inputs': INPUTS,
        'fragmentSha256': sha(fragment),
        'outputSha256': sha(replacement),
        'aospTreeModified': False,
        'imageRebuilt': False,
        'mteQualified': False,
        'physicalBootVerified': False,
        'deployReady': False,
    }
    (output / 'preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aosp-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='Fresh output directory')
    args = parser.parse_args()
    print(json.dumps(prepare(args.aosp_root.absolute(), args.output.absolute()), indent=2))
