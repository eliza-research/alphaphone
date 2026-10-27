"""Verify packaged runtime bytes; this does not execute or qualify a runtime.

Usage: verify-packaged-runtime.py [--allow-unpackaged-runtime] [--release APK]... [APK]...

APKs passed with --release are distribution releases: without a packaged,
authenticated runtime they are not distributable and the script exits 3
(after printing every result) unless --allow-unpackaged-runtime is given, in
which case those entries are reported with "distributable": false. Debug and
other positional APKs keep the original semantics: NOT_PACKAGED is reported,
not rejected. Byte mismatches always raise (exit 1).
"""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def digest(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return digest(stream)


def verify(apk, release=False, runtime_profile="native"):
    staged = ROOT / 'android/app/src/main/assets/agent'
    stamp_file = staged / 'alpha-source.json'
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        runtime_names = [name for name in names if name.startswith('assets/agent/') or name.endswith('/libeliza_bun.so')]
        if not stamp_file.exists():
            if runtime_names:
                raise ValueError('Packaged runtime has no authenticated staged source')
            return {'apk': str(apk), 'runtime': 'NOT_PACKAGED', 'runtimeExecution': False}
        if len(names) != len(set(names)):
            raise ValueError('Duplicate APK entries')
        stamp = json.loads(stamp_file.read_text())
        pin = json.loads((ROOT / 'upstream.lock.json').read_text())['commit']
        if stamp.get('base') != pin or stamp.get('patches') != []:
            raise ValueError('Staged runtime does not match patchless pin')
        for field, source in [('lockSha256', 'upstream.lock.json'), ('preparerSha256', 'scripts/prepare-local-agent.mjs'), ('guardSha256', 'scripts/local-agent-source.mjs')]:
            if stamp.get(field) != file_hash(ROOT / source):
                raise ValueError('Staged source manifest mismatch')
        checks = {}
        if runtime_profile == 'cloud':
            profile_entry = 'assets/agent/alpha-runtime-profile.json'
            if hashlib.sha256(archive.read(profile_entry)).hexdigest() != file_hash(staged / 'alpha-runtime-profile.json'):
                raise ValueError('Cloud profile differs from staged profile')
            provenance_entry = 'assets/agent/android-agent-runtime-provenance.json'
            if hashlib.sha256(archive.read(provenance_entry)).hexdigest() != file_hash(staged / 'android-agent-runtime-provenance.json'):
                raise ValueError('Cloud provenance differs from admitted staged provenance')
            profile = json.loads(archive.read(profile_entry))
            omitted = {'path': 'assets/agent/models/bge-small-en-v1.5-f16.gguf', 'sha256': 'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999'}
            if profile != {'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': [omitted]}:
                raise ValueError('Packaged Cloud profile mismatch')
            provenance = json.loads(archive.read('assets/agent/android-agent-runtime-provenance.json'))
            if provenance.get('schema') != 'eliza.android_agent_runtime_provenance.v1':
                raise ValueError('Runtime provenance missing')
            for row in provenance['files']:
                entry = row['path']
                if entry == omitted['path']:
                    if row['sha256'] != omitted['sha256'] or entry in names:
                        raise ValueError('Cloud local-model omission differs')
                    continue
                if release and entry.startswith(('lib/x86_64/', 'assets/agent/x86_64/')) and entry not in names:
                    continue
                if not entry.startswith(('assets/agent/', 'lib/')) or '..' in PurePosixPath(entry).parts:
                    raise ValueError('Invalid runtime provenance path')
                with archive.open(entry) as stream:
                    if digest(stream) != row['sha256']:
                        raise ValueError('Packaged Cloud runtime provenance mismatch: ' + entry)
            if any((re.match(r'^(lib(?:elizainference|elizavoicejni|paradeevoicejni|llama|ggml|omnivoice)|llama-server)', PurePosixPath(name).name) or name.startswith('assets/paradee-voice/') or re.search(r'\.(gguf|onnx|safetensors|pt|pth)$', name)) for name in names):
                raise ValueError('Cloud APK includes local inference')

        def check(entry, local, expected=None):
            with archive.open(entry) as stream:
                observed = digest(stream)
            if observed != file_hash(local) or (expected is not None and observed != expected):
                raise ValueError(f'Packaged runtime mismatch: {entry}')
            checks[entry] = observed

        for name in ['alpha-source.json', 'agent-bundle.js', 'agent-bundle-dependencies.json', 'workflow-worker/files.sha256', 'workflow-worker/manifest.json']:
            check('assets/agent/' + name, staged / name)
        bundle_dependencies = json.loads(archive.read('assets/agent/agent-bundle-dependencies.json'))
        if (bundle_dependencies.get('version') != 1 or
                bundle_dependencies.get('bundleSha256') != checks['assets/agent/agent-bundle.js'] or
                not isinstance(bundle_dependencies.get('packages'), list) or not bundle_dependencies['packages']):
            raise ValueError('Packaged agent dependency inventory does not match bundle')
        check('assets/agent/native-view-declarations.json', staged / 'native-view-declarations.json', file_hash(ROOT / 'config/native-view-declarations.json'))
        worker_manifest = json.loads((staged / 'workflow-worker/manifest.json').read_text())
        worker_files = worker_manifest.get('files')
        if worker_manifest.get('version') != 1 or not isinstance(worker_files, dict) or not worker_files:
            raise ValueError('Invalid staged worker manifest')
        if worker_manifest.get('sourceStampSha256') != file_hash(stamp_file):
            raise ValueError('Worker belongs to a different prepared runtime')
        expected_worker_files = dict(worker_files)
        expected_worker_files['manifest.json'] = file_hash(staged / 'workflow-worker/manifest.json')
        inventory = set()
        for line in (staged / 'workflow-worker/files.sha256').read_text().splitlines():
            expected, name = line.split('\t', 1)
            relative = PurePosixPath(name)
            if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected) or relative.is_absolute() or '..' in relative.parts or name in inventory:
                raise ValueError('Invalid worker inventory')
            if expected_worker_files.get(name) != expected:
                raise ValueError('Worker index differs from manifest')
            inventory.add(name)
            check('assets/agent/workflow-worker/' + name, staged / 'workflow-worker' / name, expected)
        if inventory != set(expected_worker_files):
            raise ValueError('Incomplete worker index')
        packaged_worker = {name.removeprefix('assets/agent/workflow-worker/') for name in names if name.startswith('assets/agent/workflow-worker/') and not name.endswith('/')}
        if packaged_worker != inventory | {'files.sha256', 'manifest.json'}:
            raise ValueError('Unexpected packaged worker inventory')
        # Debug/test APKs carry both ABIs. Releases may filter to the shipping
        # arm64-v8a ABI; every packaged ABI must carry the runtime.
        packaged_abis = {name.split('/')[1] for name in names if name.startswith('lib/') and name.count('/') >= 2}
        abis = sorted(packaged_abis | ({'arm64-v8a'} if release else {'arm64-v8a', 'x86_64'}))
        for abi in abis:
            if abi not in ('arm64-v8a', 'x86_64'):
                raise ValueError(f'Unexpected packaged ABI: {abi}')
            name = f'lib/{abi}/libeliza_bun.so'
            check(name, ROOT / 'android/app/src/main/jniLibs' / abi / 'libeliza_bun.so')
        return {'apk': str(apk), 'runtime': 'PACKAGED', 'runtimeProfile': runtime_profile, 'upstreamCommit': pin, 'verifiedEntries': len(checks), 'runtimeExecution': False}


NOT_DISTRIBUTABLE = 3


def main(argv):
    parser = argparse.ArgumentParser(description='Verify packaged runtime bytes in APKs.')
    parser.add_argument('--runtime-profile', choices=['native', 'cloud'], default='native')
    parser.add_argument('--release', action='append', default=[], metavar='APK', help='distribution release APK; requires a packaged runtime')
    parser.add_argument('--allow-unpackaged-runtime', action='store_true', help='developer option: report unpackaged releases as distributable=false instead of failing')
    parser.add_argument('apks', nargs='*', metavar='APK')
    args = parser.parse_args(argv)
    if not args.release and not args.apks:
        parser.error('no APKs supplied')
    results = []
    refused = []
    for apk in args.release:
        result = verify(Path(apk), release=True, runtime_profile=args.runtime_profile)
        result['release'] = True
        result['distributable'] = result['runtime'] == 'PACKAGED'
        if not result['distributable']:
            refused.append(apk)
        results.append(result)
    results.extend(verify(Path(apk), runtime_profile=args.runtime_profile) for apk in args.apks)
    print(json.dumps(results, indent=2))
    if refused and not args.allow_unpackaged_runtime:
        print('Release APKs without a packaged resident runtime are not distributable: ' + ', '.join(refused)
              + '. Stage it with npm run android:build:local, or pass --allow-unpackaged-runtime for a non-distributable developer build.', file=sys.stderr)
        return NOT_DISTRIBUTABLE
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
