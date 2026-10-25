#!/usr/bin/env python3
"""Stage ARM64 JNI files for an already admitted Pixel system APK."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_MODES = {
    'libeliza_bun.so': '0755',
    'libeliza_ld_musl_aarch64.so': '0755',
    'libeliza_ld_musl_aarch64_real.so': '0755',
    'libeliza_stdcpp.so': '0644',
    'libeliza_gcc_s.so': '0644',
    'libsigsys-handler.so': '0644',
}
RUNTIME_ASSETS = {
    'libeliza_bun.so': 'bun',
    'libeliza_ld_musl_aarch64.so': 'ld-musl-aarch64.so.1',
    'libeliza_ld_musl_aarch64_real.so': 'ld-musl-aarch64.so.1.real',
    'libeliza_gcc_s.so': 'libgcc_s.so.1',
    'libsigsys-handler.so': 'libsigsys-handler.so',
}
REQUIRED_AGENT_ASSETS = {
    'agent-bundle.js', 'pglite.wasm', 'pglite.data', 'initdb.wasm',
    'plugins-manifest.json', 'launch.sh', 'launch-child.sh',
    'vector.tar', 'fuzzystrmatch.tar', 'pg_trgm.tar',
    'models/bge-small-en-v1.5-f16.gguf',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: ' + key)
        result[key] = value
    return result


def read_json(archive, path):
    if archive.getinfo(path).file_size > 1024 * 1024:
        raise ValueError('Oversized runtime manifest: ' + path)
    return json.loads(archive.read(path), object_pairs_hook=unique_object)


def verify_runtime(archive, runtime_names):
    if runtime_names != set(RUNTIME_MODES):
        raise ValueError('Incomplete or unknown ARM64 resident runtime')
    provenance = read_json(archive, 'assets/agent/android-agent-runtime-provenance.json')
    if provenance.get('schema') != 'eliza.android_agent_runtime_provenance.v1':
        raise ValueError('Unknown runtime provenance schema')
    records = provenance.get('files')
    if not isinstance(records, list) or not 1 <= len(records) <= 256:
        raise ValueError('Invalid runtime file inventory')
    seen = set()
    for item in records:
        name, expected = item['path'], item['sha256']
        if (name in seen or not re.fullmatch(r'(assets/agent/|lib/)[A-Za-z0-9_.+/-]+', name)
                or any(p in ('', '.', '..') for p in name.split('/'))
                or not re.fullmatch(r'[a-f0-9]{64}', expected)):
            raise ValueError('Invalid runtime provenance entry')
        seen.add(name)
        entry = archive.getinfo(name)
        if entry.file_size != item['size_bytes'] or not 0 < entry.file_size <= 1024 ** 3:
            raise ValueError('Runtime size mismatch: ' + name)
        with archive.open(entry) as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                raise ValueError('Runtime hash mismatch: ' + name)
    required = {*('assets/agent/' + n for n in REQUIRED_AGENT_ASSETS),
                *('lib/arm64-v8a/' + n for n in RUNTIME_MODES),
                *('assets/agent/arm64-v8a/' + n for n in RUNTIME_ASSETS.values())}
    if not required <= seen:
        raise ValueError('Runtime provenance omits required files')
    indexed = {item['path']: item for item in records}
    stdcpp = [n for n in seen if re.fullmatch(r'assets/agent/arm64-v8a/libstdc\+\+\.so\.6\.[0-9.]+', n)]
    if len(stdcpp) != 1:
        raise ValueError('Expected exactly one ARM64 libstdc++ asset')
    counterparts = {**{n: 'assets/agent/arm64-v8a/' + p for n, p in RUNTIME_ASSETS.items()},
                    'libeliza_stdcpp.so': stdcpp[0]}
    for name, asset in counterparts.items():
        if indexed['lib/arm64-v8a/' + name]['sha256'] != indexed[asset]['sha256']:
            raise ValueError('JNI and asset runtime copies differ: ' + name)
    bun_lock = json.loads((ROOT / 'vendor/eliza/packages/app/scripts/lib/android-bun-artifacts.lock.json').read_text())['channels']['stable']
    bun = provenance.get('bun', {})
    if any(bun.get(k) != bun_lock[k] for k in ('version', 'revision')) or bun.get('channel') != 'stable':
        raise ValueError('Runtime Bun identity differs from pinned stable release')
    bun_record = next(item for item in records if item['path'] == 'lib/arm64-v8a/libeliza_bun.so')
    if bun_record['sha256'] != bun_lock['artifacts']['aarch64']['binarySha256']:
        raise ValueError('Packaged ARM64 Bun differs from pinned binary')
    stamp_path = 'assets/agent/alpha-source.json'
    stamp = read_json(archive, stamp_path)
    lock_bytes = (ROOT / 'upstream.lock.json').read_bytes()
    expected_stamp = {
        'lockSha256': sha(lock_bytes),
        'preparerSha256': sha((ROOT / 'scripts/prepare-local-agent.mjs').read_bytes()),
        'guardSha256': sha((ROOT / 'scripts/local-agent-source.mjs').read_bytes()),
        'base': json.loads(lock_bytes)['commit'], 'patches': [],
    }
    if stamp != expected_stamp:
        raise ValueError('Runtime source stamp differs from admitted Alpha source')
    prefix = 'assets/agent/workflow-worker/'
    worker = read_json(archive, prefix + 'manifest.json')
    if (worker.get('version') != 1 or worker.get('sourceStampSha256') != sha(archive.read(stamp_path))
            or worker.get('lockSha256') != sha((ROOT / 'vendor/eliza/bun.lock').read_bytes())):
        raise ValueError('Workflow worker provenance mismatch')
    files = worker.get('files')
    if not isinstance(files, dict) or not 1 <= len(files) <= 4095:
        raise ValueError('Invalid workflow worker inventory')
    required_worker = {'node_modules/smthrs/package.json', 'node_modules/zod/package.json',
                       'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json',
                       'dependencies.json'}
    if not required_worker <= files.keys():
        raise ValueError('Workflow dependencies missing')
    actual = {n[len(prefix):] for n in archive.namelist() if n.startswith(prefix) and not n.endswith('/')}
    if actual != set(files) | {'manifest.json', 'files.sha256'}:
        raise ValueError('Workflow worker file closure differs')
    total = archive.getinfo(prefix + 'manifest.json').file_size
    for name, expected in files.items():
        if (not re.fullmatch(r'[A-Za-z0-9@_.+/-]+', name)
                or any(p in ('', '.', '..') for p in name.split('/'))
                or name in ('manifest.json', 'files.sha256')
                or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected)):
            raise ValueError('Invalid workflow worker entry')
        entry = archive.getinfo(prefix + name)
        total += entry.file_size
        if total > 64 * 1024 * 1024:
            raise ValueError('Workflow worker exceeds 64 MiB')
        with archive.open(entry) as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                raise ValueError('Workflow worker hash mismatch: ' + name)
    index_files = {**files, 'manifest.json': sha(archive.read(prefix + 'manifest.json'))}
    if archive.getinfo(prefix + 'files.sha256').file_size > 1024 * 1024:
        raise ValueError('Oversized workflow extraction index')
    index = archive.read(prefix + 'files.sha256').decode().splitlines()
    if len(index) != len(index_files) or set(index) != {digest + '\t' + name for name, digest in index_files.items()}:
        raise ValueError('Workflow extraction index mismatch')
    return {'runtimeFilesVerified': len(records), 'workerFilesVerified': len(files),
            'sourceCommit': stamp['base'], 'bunVersion': bun['version']}


def stage(apk, output, module, target='grizzly'):
    if target not in ('grizzly', 'stallion'):
        raise ValueError('Unsupported Pixel target')
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', module):
        raise ValueError('Invalid module name')
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate APK entries')
        selected = [e for e in archive.infolist() if e.filename.startswith('lib/arm64-v8a/')]
        payloads = []
        for entry in selected:
            name = entry.filename.removeprefix('lib/arm64-v8a/')
            if not re.fullmatch(r'lib[A-Za-z0-9_.+-]+\.so', name):
                raise ValueError('Unexpected native path: ' + entry.filename)
            if entry.compress_type != zipfile.ZIP_STORED or entry.file_size > 1024 ** 3:
                raise ValueError('Native library is compressed or oversized: ' + name)
            data = archive.read(entry)
            if data[:6] != b'\x7fELF\x02\x01' or data[18:20] != b'\xb7\x00':
                raise ValueError('Expected little-endian ELF64 AArch64: ' + name)
            payloads.append((name, data))
        if not payloads:
            raise ValueError('No ARM64 native libraries')
        runtime_names = {name for name, _ in payloads if name.startswith('libeliza_') or name == 'libsigsys-handler.so'}
        runtime = verify_runtime(archive, runtime_names) if runtime_names or 'assets/agent/agent-bundle.js' in names else None
    expected_bp = ('// Generated from a hash- and signer-verified downstream launcher.\n'
                   'android_app_import {\n' + f'    name: "{module}",\n' +
                   '    apk: "Launcher.apk",\n    presigned: true,\n'
                   '    preprocessed: true,\n    product_specific: true,\n'
                   '    dex_preopt: { enabled: false },\n}\n')
    if ((output / 'Android.bp').read_text() != expected_bp
            or any((output / name).exists() for name in ['Android.mk', 'config.fs', 'native-libraries.json'])):
        raise ValueError('Expected a fresh, exact upstream launcher overlay')
    native = output / 'native-arm64'
    native.mkdir(exist_ok=False)
    records = []
    for index, (name, data) in enumerate(payloads):
        (native / name).write_bytes(data)
        destination = f'app/{module}/lib/arm64'
        records.append({'apkEntry': 'lib/arm64-v8a/' + name,
                        'path': 'native-arm64/' + name,
                        'installPath': '/product/' + destination + '/' + name,
                        'mode': RUNTIME_MODES.get(name, '0644'),
                        'sha256': hashlib.sha256(data).hexdigest()})
    (output / 'config.fs').write_text(''.join(
        f'[{record["installPath"].lstrip("/")}]\nmode: {record["mode"]}\nuser: AID_ROOT\ngroup: AID_ROOT\ncaps: 0\n\n'
        for record in records))
    # AOSP's supported prebuilt app rule installs LOCAL_PREBUILT_JNI_LIBS beside
    # the APK. SDK >= 30 + PRESIGNED preserves the APK and checks compression and
    # alignment. Do not use prebuilt_any: that type is reserved for generated rules.
    (output / 'Android.mk').write_text(
        f'# Generated Alpha {target} APK and bundled JNI installation.\n'
        'LOCAL_PATH := $(call my-dir)\ninclude $(CLEAR_VARS)\n' +
        f'LOCAL_MODULE := {module}\n' +
        'LOCAL_MODULE_CLASS := APPS\nLOCAL_MODULE_SUFFIX := .apk\n'
        'LOCAL_SRC_FILES := Launcher.apk\nLOCAL_CERTIFICATE := PRESIGNED\n'
        'LOCAL_SDK_VERSION := 36\nLOCAL_PRODUCT_MODULE := true\n'
        'LOCAL_MULTILIB := 64\nLOCAL_MODULE_TARGET_ARCH := arm64\n'
        'LOCAL_DEX_PREOPT := false\nLOCAL_PREBUILT_JNI_LIBS := ' +
        ' '.join('native-arm64/' + name for name, _ in payloads) +
        '\ninclude $(BUILD_PREBUILT)\n')
    (output / 'Android.bp').write_text('// AlphaPhone is defined in Android.mk for bundled JNI installation.\n')
    report = {'schemaVersion': 1, 'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
              'target': target, 'libraries': records, 'residentAgentIncluded': runtime is not None,
              'runtimeAdmission': runtime, 'fsConfigRequired': True,
              'runtimeVerified': False, 'deployReady': False}
    (output / 'native-libraries.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--module', required=True)
    parser.add_argument('--target', choices=('grizzly', 'stallion'), default='grizzly')
    args = parser.parse_args()
    print(json.dumps(stage(args.apk, args.output, args.module, args.target), indent=2))
