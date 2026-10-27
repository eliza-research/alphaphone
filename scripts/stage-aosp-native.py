#!/usr/bin/env python3
"""Stage ABI-bound JNI files for an already admitted Alpha system APK."""
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
# Explicit image targets, never infer the installation ABI from a fat APK.
TARGETS = {
    'stallion': {'abi': 'arm64-v8a', 'arch': 'arm64', 'bunArch': 'aarch64', 'machine': b'\xb7\x00',
                 'modes': RUNTIME_MODES, 'assets': RUNTIME_ASSETS},
    'cuttlefish': {'abi': 'x86_64', 'arch': 'x86_64', 'bunArch': 'x64', 'machine': b'\x3e\x00',
                  'modes': {n.replace('aarch64', 'x86_64'): m for n, m in RUNTIME_MODES.items()},
                  'assets': {n.replace('aarch64', 'x86_64'): a.replace('aarch64', 'x86_64')
                             for n, a in RUNTIME_ASSETS.items()}},
}

CLOUD_OMITTED_MODEL = {
    'path': 'assets/agent/models/bge-small-en-v1.5-f16.gguf',
    'sha256': 'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999',
}
REQUIRED_AGENT_ASSETS = {
    'agent-bundle.js', 'pglite.wasm', 'pglite.data', 'initdb.wasm',
    'plugins-manifest.json', 'launch.sh', 'launch-child.sh',
    'vector.tar', 'fuzzystrmatch.tar', 'pg_trgm.tar',
    'models/bge-small-en-v1.5-f16.gguf',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sha_stream(stream):
    """Hash archive bytes with at most a 1 MiB read buffer on Python 3.10+."""
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


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


def runtime_profile(archive):
    names = set(archive.namelist())
    marker = 'assets/agent/alpha-runtime-profile.json'
    profile = read_json(archive, marker) if marker in names else {'version': 1, 'runtimeProfile': 'native'}
    native = {'version': 1, 'runtimeProfile': 'native'}
    cloud = {'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': [CLOUD_OMITTED_MODEL]}
    if not isinstance(profile, dict) or type(profile.get('version')) is not int or profile not in (native, cloud):
        raise ValueError('Unknown or malformed runtime profile')
    kind = profile['runtimeProfile']
    flags_path = 'assets/public/build-flags.json'
    flags = read_json(archive, flags_path) if flags_path in names else {}
    if not isinstance(flags, dict) or flags.get('runtimeProfile', 'native') != kind:
        raise ValueError('Renderer and resident runtime profiles differ')
    if kind == 'cloud':
        if flags.get('testMocks') is not False:
            raise ValueError('Cloud requires flag-off renderer admission')
        for name in names:
            if (name.startswith('assets/paradee-voice/')
                    or re.search(r'\.(gguf|onnx|safetensors|pt|pth)$', name)
                    or re.match(r'^(lib(?:elizainference|elizavoicejni|paradeevoicejni|llama|ggml|omnivoice)|llama-server)', Path(name).name)):
                raise ValueError('Cloud APK includes local inference or speech')
    return kind


def verify_runtime(archive, runtime_names, profile='native', target='stallion'):
    config = TARGETS[target]
    abi, modes, assets = config['abi'], config['modes'], config['assets']
    if runtime_names != set(modes):
        raise ValueError('Incomplete or unknown ' + abi + ' resident runtime')
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
        if not isinstance(item.get('size_bytes'), int) or isinstance(item['size_bytes'], bool) or not 0 < item['size_bytes'] <= 1024 ** 3:
            raise ValueError('Invalid runtime size: ' + name)
        if profile == 'cloud' and name == CLOUD_OMITTED_MODEL['path']:
            if expected != CLOUD_OMITTED_MODEL['sha256'] or name in archive.namelist():
                raise ValueError('Cloud model omission differs from original provenance')
            continue
        entry = archive.getinfo(name)
        if entry.file_size != item['size_bytes'] or not 0 < entry.file_size <= 1024 ** 3:
            raise ValueError('Runtime size mismatch: ' + name)
        with archive.open(entry) as stream:
            if sha_stream(stream) != expected:
                raise ValueError('Runtime hash mismatch: ' + name)
    required = {*('assets/agent/' + n for n in REQUIRED_AGENT_ASSETS),
                *('lib/' + abi + '/' + n for n in modes),
                *('assets/agent/' + abi + '/' + n for n in assets.values())}
    if not required <= seen:
        raise ValueError('Runtime provenance omits required files')
    indexed = {item['path']: item for item in records}
    stdcpp = [n for n in seen if re.fullmatch(rf'assets/agent/{re.escape(abi)}/libstdc\+\+\.so\.6\.[0-9.]+', n)]
    if len(stdcpp) != 1:
        raise ValueError('Expected exactly one ' + abi + ' libstdc++ asset')
    counterparts = {**{n: 'assets/agent/' + abi + '/' + p for n, p in assets.items()},
                    'libeliza_stdcpp.so': stdcpp[0]}
    for name, asset in counterparts.items():
        if indexed['lib/' + abi + '/' + name]['sha256'] != indexed[asset]['sha256']:
            raise ValueError('JNI and asset runtime copies differ: ' + name)
    bun_lock = json.loads((ROOT / 'vendor/eliza/packages/app/scripts/lib/android-bun-artifacts.lock.json').read_text())['channels']['stable']
    bun = provenance.get('bun', {})
    if any(bun.get(k) != bun_lock[k] for k in ('version', 'revision')) or bun.get('channel') != 'stable':
        raise ValueError('Runtime Bun identity differs from pinned stable release')
    bun_record = next(item for item in records if item['path'] == 'lib/' + abi + '/libeliza_bun.so')
    if bun_record['sha256'] != bun_lock['artifacts'][config['bunArch']]['binarySha256']:
        raise ValueError('Packaged ' + abi + ' Bun differs from pinned binary')
    stamp_path = 'assets/agent/alpha-source.json'
    stamp = read_json(archive, stamp_path)
    lock_bytes = (ROOT / 'upstream.lock.json').read_bytes()
    expected_stamp = {
        'lockSha256': sha(lock_bytes),
        'preparerSha256': sha((ROOT / 'scripts/prepare-local-agent.mjs').read_bytes()),
        'guardSha256': sha((ROOT / 'scripts/local-agent-source.mjs').read_bytes()),
        'copySha256': sha((ROOT / 'scripts/copy-file-clone.mjs').read_bytes()),
        'base': json.loads(lock_bytes)['commit'], 'patches': [],
    }
    if stamp != expected_stamp:
        raise ValueError('Runtime source stamp differs from admitted Alpha source')
    if archive.getinfo('assets/agent/native-view-declarations.json').file_size > 1024 * 1024:
        raise ValueError('Oversized native view declarations')
    declarations = archive.read('assets/agent/native-view-declarations.json')
    if declarations != (ROOT / 'config/native-view-declarations.json').read_bytes():
        raise ValueError('Native view declarations differ from product policy')
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
            if sha_stream(stream) != expected:
                raise ValueError('Workflow worker hash mismatch: ' + name)
    index_files = {**files, 'manifest.json': sha(archive.read(prefix + 'manifest.json'))}
    if archive.getinfo(prefix + 'files.sha256').file_size > 1024 * 1024:
        raise ValueError('Oversized workflow extraction index')
    index = archive.read(prefix + 'files.sha256').decode().splitlines()
    if len(index) != len(index_files) or set(index) != {digest + '\t' + name for name, digest in index_files.items()}:
        raise ValueError('Workflow extraction index mismatch')
    return {'runtimeFilesVerified': len(records), 'workerFilesVerified': len(files),
            'sourceCommit': stamp['base'], 'bunVersion': bun['version'],
            'runtimeProfile': profile, 'omittedLocalModels': [CLOUD_OMITTED_MODEL] if profile == 'cloud' else []}


def stage(apk, output, module, target='stallion'):
    if target not in TARGETS:
        raise ValueError('Unsupported Alpha image target')
    config = TARGETS[target]
    abi, arch, modes = config['abi'], config['arch'], config['modes']
    prefix = 'lib/' + abi + '/'
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', module):
        raise ValueError('Invalid module name')
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate APK entries')
        profile = runtime_profile(archive)
        selected = [e for e in archive.infolist() if e.filename.startswith(prefix)]
        payloads = []
        for entry in selected:
            name = entry.filename.removeprefix(prefix)
            if not re.fullmatch(r'lib[A-Za-z0-9_.+-]+\.so', name):
                raise ValueError('Unexpected native path: ' + entry.filename)
            if entry.compress_type != zipfile.ZIP_STORED or entry.file_size > 1024 ** 3:
                raise ValueError('Native library is compressed or oversized: ' + name)
            data = archive.read(entry)
            if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01' or data[18:20] != config['machine']:
                raise ValueError('Expected little-endian ELF64 ' + abi + ': ' + name)
            payloads.append((name, data))
        if not payloads:
            raise ValueError('No ' + abi + ' native libraries')
        runtime_names = {name for name, _ in payloads if name.startswith('libeliza_') or name == 'libsigsys-handler.so'}
        runtime = verify_runtime(archive, runtime_names, profile, target) if target == 'cuttlefish' or runtime_names or 'assets/agent/agent-bundle.js' in names or profile == 'cloud' else None
    expected_bp = ('// Generated from a hash- and signer-verified downstream launcher.\n'
                   'android_app_import {\n' + f'    name: "{module}",\n' +
                   '    apk: "Launcher.apk",\n    presigned: true,\n'
                   '    preprocessed: true,\n    product_specific: true,\n'
                   '    dex_preopt: { enabled: false },\n}\n')
    if ((output / 'Android.bp').read_text() != expected_bp
            or any((output / name).exists() for name in ['Android.mk', 'config.fs', 'native-libraries.json'])):
        raise ValueError('Expected a fresh, exact upstream launcher overlay')
    native_name = 'native-' + arch
    native = output / native_name
    native.mkdir(exist_ok=False)
    records = []
    for index, (name, data) in enumerate(payloads):
        (native / name).write_bytes(data)
        destination = f'app/{module}/lib/{arch}'
        records.append({'apkEntry': prefix + name,
                        'path': native_name + '/' + name,
                        'installPath': '/product/' + destination + '/' + name,
                        'mode': modes.get(name, '0644'),
                        'sha256': hashlib.sha256(data).hexdigest()})
    (output / 'config.fs').write_text(''.join(
        f'[{record["installPath"].lstrip("/")}]\nmode: {record["mode"]}\nuser: AID_ROOT\ngroup: AID_ROOT\ncaps: 0\n\n'
        for record in records))
    # Modern image products ignore Android.mk. Keep the APK byte-identical and
    # require explicit Soong modules for its admitted native payloads. The recorded
    # soong-app-native patch supplies the app-relative installation rule.
    native_modules = [f'{module}_native_{index}' for index in range(len(records))]
    app_bp = expected_bp.replace('    dex_preopt:',
        '    required: ' + json.dumps(native_modules) + ',\n    dex_preopt:')
    library_bp = []
    for name, record in zip(native_modules, records):
        library_bp.append('prebuilt_app_native {\n' +
            f'    name: "{name}",\n' +
            f'    src: "{record["path"]}",\n' +
            f'    filename: "{Path(record["path"]).name}",\n' +
            f'    relative_install_path: "{module}/lib/{arch}",\n' +
            '    product_specific: true,\n}\n')
    (output / 'Android.bp').write_text(app_bp + '\n' + '\n'.join(library_bp))
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
    parser.add_argument('--target', choices=tuple(TARGETS), default='stallion')
    args = parser.parse_args()
    print(json.dumps(stage(args.apk, args.output, args.module, args.target), indent=2))
