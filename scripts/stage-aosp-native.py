#!/usr/bin/env python3
"""Alpha's trusted source and policy adapter for upstream native APK admission."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Reading the pinned checkout must not create ignored bytecode beside its sources.
sys.dont_write_bytecode = True
SHARED = ROOT / 'vendor/eliza/packages/os/scripts/android/stage-android-native.py'
spec = importlib.util.spec_from_file_location('eliza_android_native', SHARED)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
RUNTIME_MODES = shared.RUNTIME_MODES
TARGETS = shared.TARGETS
CLOUD_OMITTED_MODEL = shared.CLOUD_OMITTED_MODEL
REQUIRED_AGENT_ASSETS = shared.REQUIRED_AGENT_ASSETS


def admission(root):
    digest = lambda data: hashlib.sha256(data).hexdigest()
    lock_bytes = (root / 'upstream.lock.json').read_bytes()
    stamp = {
        'lockSha256': digest(lock_bytes),
        'preparerSha256': digest((root / 'scripts/prepare-local-agent.mjs').read_bytes()),
        'guardSha256': digest((root / 'scripts/local-agent-source.mjs').read_bytes()),
        'copySha256': digest((root / 'scripts/copy-file-clone.mjs').read_bytes()),
        'base': json.loads(lock_bytes)['commit'], 'patches': [],
    }
    return {
        'schemaVersion': 1,
        'bunTarget': 'linux-musl',
        'bunPin': json.loads((root / 'vendor/eliza/packages/app/scripts/lib/android-bun-artifacts.lock.json').read_text())['channels']['stable'],
        'profileEntry': 'assets/agent/alpha-runtime-profile.json',
        'rendererFlagsEntry': 'assets/public/build-flags.json',
        'source': {'kind': 'exact-json', 'entry': 'assets/agent/alpha-source.json', 'commit': stamp['base'], 'commitField': 'base', 'expected': stamp},
        'fileBindings': {'assets/agent/native-view-declarations.json': digest((root / 'config/native-view-declarations.json').read_bytes())},
        'worker': {'prefix': 'assets/agent/workflow-worker/', 'lockSha256': digest((root / 'vendor/eliza/bun.lock').read_bytes())},
    }


def stage(apk, output, module, target='stallion'):
    return shared.stage(apk, output, module, target, admission(ROOT))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--module', required=True)
    parser.add_argument('--target', choices=tuple(TARGETS), default='stallion')
    args = parser.parse_args()
    print(json.dumps(stage(args.apk, args.output, args.module, args.target), indent=2))
