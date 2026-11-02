"""One Linux-hosted compile. No model, APK, signing or device execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git(root, *args):
    result = subprocess.run(['git', '--no-replace-objects', '-c', 'core.hooksPath=/dev/null',
                             '-C', str(root), *args], capture_output=True, timeout=30, check=True)
    assert len(result.stdout) < 4 * 1024**2
    return result.stdout.decode().strip()


def verify(source, manifest):
    assert source.is_dir() and not source.is_symlink()
    sdk = source / 'vendor/eliza'
    engine = sdk / 'plugins/plugin-local-inference/native/llama.cpp'
    for root, expected in [(source, manifest['Alpha']), (sdk, manifest['SDK']), (engine, manifest['native'])]:
        assert git(root, 'rev-parse', 'HEAD') == expected
        assert not git(root, 'for-each-ref', '--format=%(refname)', 'refs/replace')
        assert not git(root, 'diff', '--name-only', 'HEAD')
    assert git(source, 'ls-tree', 'HEAD', '--', 'vendor/eliza').split()[2] == manifest['SDK']
    assert git(sdk, 'ls-tree', 'HEAD', '--', 'plugins/plugin-local-inference/native/llama.cpp').split()[2] == manifest['native']
    assert not any(line[:1] in '-+U' for line in git(engine, 'submodule', 'status', '--recursive').splitlines())
    for root, rows in [(source, manifest['productFiles']), (sdk, manifest['sdkFiles'])]:
        for row in rows:
            file = root / row['path']
            assert file.resolve().is_relative_to(root.resolve())
            assert not file.is_symlink() and file.is_file()
            assert file.stat().st_size == row['bytes'] and digest(file) == row['sha256']
    if manifest.get('requireExplicitNinjaJobs'):
        builder = (sdk / 'packages/app/scripts/stage-elizavoice-lib.ts').read_text()
        calls = builder.count('run("ninja", ["-j", String(process.env.CMAKE_BUILD_PARALLEL_LEVEL || 2),')
        assert calls == 2, 'Reviewed explicit Ninja parallelism fix is not in the bound SDK'
    return engine


def compile_component(source, engine, output, manifest):
    limits = manifest['limits']
    assert os.statvfs(output.parent).f_bavail * os.statvfs(output.parent).f_frsize >= limits['entryFreeBytes']
    assert not output.exists()
    output.mkdir(mode=0o700)
    component = output / 'component'
    env = {**os.environ, 'ELIZA_NDK_VERSION': manifest['NDK'], 'CMAKE_BUILD_PARALLEL_LEVEL': '2'}
    cmd = ['node', str(source / 'scripts/prepare-embedding-host.mjs'), '--fork', str(engine),
           '--output', str(component), '--abi', manifest['abi'], '--build', '--remap-build-path']
    (output / 'INTENT.json').write_text(json.dumps({'command': cmd, 'source': manifest['Alpha'],
        'SDK': manifest['SDK'], 'native': manifest['native'], 'compileOnly': True}, indent=2))
    temporary = output / 'tmp'
    temporary.mkdir()
    env['TMPDIR'] = str(temporary)
    # The reviewed external supervisor owns process groups and all limits.
    # This worker waits normally; it never signals a PID or process group.
    subprocess.run(cmd, env=env, check=True)
    verify(source, manifest)
    receipt = json.loads((component / 'PREPARATION.json').read_text())
    assert receipt['built'] is True and receipt['packaged'] is False
    assert receipt['pin'] == manifest['SDK'] and receipt['forkPin'] == manifest['native']
    assert receipt['abi'] == manifest['abi'] and receipt['identity'] == manifest['identity']
    libraries = receipt['libraries']
    assert {Path(r['path']).name for r in libraries} == {'libelizainference.so', 'libelizavoicejni.so', 'libc++_shared.so'}
    export = output / 'export'
    export.mkdir()
    import shutil
    for row in libraries:
        file = Path(row['path'])
        assert file.resolve().is_relative_to(component.resolve())
        assert file.stat().st_size == row['bytes'] and digest(file) == row['sha256']
        shutil.copyfile(file, export / file.name)
    shutil.copyfile(component / 'PREPARATION.json', export / 'PREPARATION.json')
    (export / 'QUALIFICATION-BOUNDARY.json').write_text(json.dumps({
        'compiled': True, 'modelIncluded': False, 'APKBuilt': False,
        'ARM64Executed': False, 'qualifiedAt': None, 'deviceExecuted': False}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
    manifest = json.loads(args.manifest.read_text())
    guard = args.manifest.parent / 'check_source.py'
    assert digest(guard) == manifest['sourceGuard']['sha256']
    for kind, root, pin in [('product', args.source, manifest['Alpha']), ('sdk', args.source / 'vendor/eliza', manifest['SDK'])]:
        subprocess.run(['python3', str(guard), '--kind', kind, '--repo', str(root), '--expected-head', pin], check=True)

    engine = verify(args.source.resolve(), manifest)
    assert subprocess.check_output(['node', '--version'], text=True).strip() == manifest['node']
    assert ('cmake version ' + manifest['CMake']) in subprocess.check_output(['cmake', '--version'], text=True)
    compile_component(args.source.resolve(), engine, args.output.resolve(), manifest)


if __name__ == '__main__':
    main()
