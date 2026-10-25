"""Offline admission regressions; fixtures do not prove APK or image execution."""
import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare = load('prepare_apk', 'prepare-aosp-apk.py')
native = load('stage_native', 'stage-aosp-native.py')
ELF = b'\x7fELF\x02\x01' + bytes(12) + b'\xb7\x00' + bytes(44)
BP = '''// Generated from a hash- and signer-verified downstream launcher.
android_app_import {
    name: "AlphaPhone",
    apk: "Launcher.apk",
    presigned: true,
    preprocessed: true,
    product_specific: true,
    dex_preopt: { enabled: false },
}
'''


class Packaging(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.apk = self.root / 'input.apk'
        self.output = self.root / 'output'

    def archive(self, extra=None, compression=zipfile.ZIP_STORED):
        entries = [('AndroidManifest.xml', b'manifest fixture'), ('classes.dex', b'dex fixture')]
        entries += extra if extra is not None else [('lib/arm64-v8a/libcamera.so', ELF)]
        with warnings.catch_warnings(), zipfile.ZipFile(self.apk, 'w', compression=compression) as z:
            warnings.simplefilter('ignore', UserWarning)
            for name, payload in entries:
                z.writestr(name, payload)

    def rejected_before_output(self):
        with patch.object(prepare.subprocess, 'run') as command:
            with self.assertRaises(ValueError):
                prepare.prepare(self.apk, self.output, Path('/unused/zipalign'))
            command.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_signed_v1_is_not_rewritten(self):
        self.archive([('META-INF/CERT.RSA', b'signature fixture')])
        self.rejected_before_output()

    def test_apk_signing_block_is_not_discarded(self):
        self.archive()
        data = self.apk.read_bytes()
        eocd = data.rfind(b'PK\x05\x06')
        central = struct.unpack_from('<I', data, eocd + 16)[0]
        block = struct.pack('<Q', 24) + struct.pack('<Q', 24) + b'APK Sig Block 42'
        rebuilt = bytearray(data[:central] + block + data[central:])
        struct.pack_into('<I', rebuilt, eocd + len(block) + 16, central + len(block))
        self.apk.write_bytes(rebuilt)
        self.rejected_before_output()

    def test_duplicate_and_unsafe_entries_are_rejected(self):
        for name in ['classes.dex', '../escape', '/absolute', 'lib\\escape']:
            with self.subTest(name=name):
                self.archive([(name, b'bad')])
                self.rejected_before_output()

    def test_existing_output_is_preserved(self):
        self.archive()
        self.output.mkdir()
        sentinel = self.output / 'keep'
        sentinel.write_bytes(b'untouched')
        with self.assertRaises(FileExistsError):
            prepare.prepare(self.apk, self.output, Path('/unused/zipalign'))
        self.assertEqual(sentinel.read_bytes(), b'untouched')
        self.assertEqual(list(self.output.iterdir()), [sentinel])

    def test_storage_rewrite_preserves_payload(self):
        self.archive(compression=zipfile.ZIP_DEFLATED)
        # Stub alignment only: actual SDK zipalign is checked on the built APK.
        def alignment_stub(args, **kwargs):
            if '-c' not in args:
                shutil.copyfile(args[-2], args[-1])
        with patch.object(prepare.subprocess, 'run', side_effect=alignment_stub):
            result = prepare.prepare(self.apk, self.output, Path('/stub/zipalign'))
        with zipfile.ZipFile(self.apk) as source, zipfile.ZipFile(result) as target:
            self.assertEqual({n: source.read(n) for n in source.namelist()},
                             {n: target.read(n) for n in target.namelist()})
            self.assertTrue(all(e.compress_type == zipfile.ZIP_STORED
                                for e in target.infolist() if e.filename.endswith(('.so', '.dex'))))

    def overlay(self):
        self.output.mkdir()
        (self.output / 'Android.bp').write_text(BP)

    def test_aligner_must_preserve_payload_and_dex_storage(self):
        self.archive()
        for corruption in ['payload', 'dex-compression']:
            with self.subTest(corruption=corruption):
                destination = self.root / corruption
                def bad_aligner(args, **kwargs):
                    if '-c' in args:
                        return
                    with zipfile.ZipFile(args[-2]) as source, zipfile.ZipFile(args[-1], 'w') as target:
                        for entry in source.infolist():
                            data = source.read(entry)
                            if entry.filename == 'classes.dex':
                                if corruption == 'payload':
                                    data += b'changed'
                                else:
                                    entry.compress_type = zipfile.ZIP_DEFLATED
                            target.writestr(entry, data)
                with patch.object(prepare.subprocess, 'run', side_effect=bad_aligner):
                    with self.assertRaises(ValueError):
                        prepare.prepare(self.apk, destination, Path('/stub/zipalign'))
                self.assertFalse((destination / 'preparation.json').exists())

    def test_native_rejections_preserve_overlay(self):
        self.overlay()
        cases = [([('lib/arm64-v8a/libcamera.so', ELF)], zipfile.ZIP_DEFLATED),
                 ([('lib/arm64-v8a/libcamera.so', b'not elf')], zipfile.ZIP_STORED),
                 ([('lib/arm64-v8a/../libcamera.so', ELF)], zipfile.ZIP_STORED),
                 ([('lib/arm64-v8a/libeliza_bun.so', ELF)], zipfile.ZIP_STORED),
                 ([('lib/x86_64/libcamera.so', ELF)], zipfile.ZIP_STORED)]
        for entries, compression in cases:
            with self.subTest(entries=entries):
                self.archive(entries, compression)
                with self.assertRaises(ValueError):
                    native.stage(self.apk, self.output, 'AlphaPhone')
                self.assertEqual((self.output / 'Android.bp').read_text(), BP)
                self.assertEqual(len(list(self.output.iterdir())), 1)

    def test_changed_overlay_is_not_overwritten(self):
        self.archive()
        self.overlay()
        (self.output / 'Android.bp').write_text('user-owned module')
        with self.assertRaises(ValueError):
            native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual((self.output / 'Android.bp').read_text(), 'user-owned module')
        self.assertFalse((self.output / 'native-arm64').exists())

    def test_native_payload_is_installed_byte_exact_without_enabling_runtime(self):
        self.archive()
        self.overlay()
        report = native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual((self.output / 'native-arm64/libcamera.so').read_bytes(), ELF)
        self.assertEqual(report['libraries'][0]['installPath'], '/product/app/AlphaPhone/lib/arm64/libcamera.so')
        for flag in ['residentAgentIncluded', 'runtimeVerified', 'deployReady']:
            self.assertFalse(report[flag])
        self.assertEqual(json.loads((self.output / 'native-libraries.json').read_text()), report)

    def resident_fixture(self):
        # Synthetic source and binary pins keep these tests offline; actual APK
        # provenance and executable loading require their separate checks.
        trust = self.root / 'trust'
        pin_files = {
            'upstream.lock.json': json.dumps({'commit': '1' * 40}).encode(),
            'scripts/prepare-local-agent.mjs': b'preparer fixture',
            'scripts/local-agent-source.mjs': b'guard fixture',
            'vendor/eliza/bun.lock': b'dependency lock fixture',
        }
        digest = lambda data: hashlib.sha256(data).hexdigest()
        bun = {'version': '1.4.2', 'revision': '2' * 40,
               'artifacts': {'aarch64': {'binarySha256': digest(ELF)}}}
        pin_files['vendor/eliza/packages/app/scripts/lib/android-bun-artifacts.lock.json'] = json.dumps({'channels': {'stable': bun}}).encode()
        for name, data in pin_files.items():
            target = trust / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        stamp = {'lockSha256': digest(pin_files['upstream.lock.json']),
                 'preparerSha256': digest(pin_files['scripts/prepare-local-agent.mjs']),
                 'guardSha256': digest(pin_files['scripts/local-agent-source.mjs']),
                 'base': '1' * 40, 'patches': []}
        stamp_bytes = json.dumps(stamp).encode()
        entries = {'lib/arm64-v8a/' + name: ELF for name in native.RUNTIME_MODES}
        entries.update({'assets/agent/' + name: b'fixture asset' for name in native.REQUIRED_AGENT_ASSETS})
        entries.update({'assets/agent/arm64-v8a/' + name: ELF for name in native.RUNTIME_ASSETS.values()})
        entries['assets/agent/arm64-v8a/libstdc++.so.6.0.33'] = ELF
        provenance = {'schema': 'eliza.android_agent_runtime_provenance.v1',
                      'bun': {'version': bun['version'], 'revision': bun['revision'], 'channel': 'stable'},
                      'files': [{'path': n, 'size_bytes': len(data), 'sha256': digest(data)} for n, data in entries.items()]}
        entries['assets/agent/android-agent-runtime-provenance.json'] = json.dumps(provenance).encode()
        entries['assets/agent/alpha-source.json'] = stamp_bytes
        prefix = 'assets/agent/workflow-worker/'
        worker_files = {name: b'{}' for name in ['node_modules/smthrs/package.json', 'node_modules/zod/package.json',
                         'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json', 'dependencies.json']}
        manifest = {'version': 1, 'sourceStampSha256': digest(stamp_bytes),
                    'lockSha256': digest(pin_files['vendor/eliza/bun.lock']),
                    'files': {n: digest(data) for n, data in worker_files.items()}}
        worker_files['manifest.json'] = json.dumps(manifest).encode()
        index = ''.join(digest(data) + '\t' + n + '\n' for n, data in worker_files.items()).encode()
        worker_files['files.sha256'] = index
        entries.update({prefix + n: data for n, data in worker_files.items()})
        return trust, entries

    def test_complete_resident_payload_gets_explicit_modes_without_execution_claim(self):
        trust, entries = self.resident_fixture()
        self.archive(list(entries.items()))
        self.overlay()
        with patch.object(native, 'ROOT', trust):
            report = native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertTrue(report['residentAgentIncluded'])
        self.assertFalse(report['runtimeVerified'])
        self.assertFalse(report['deployReady'])
        import configparser
        config = configparser.ConfigParser()
        config.read(self.output / 'config.fs')
        for name, mode in native.RUNTIME_MODES.items():
            entry = config['product/app/AlphaPhone/lib/arm64/' + name]
            self.assertEqual(entry['mode'], mode)
            self.assertEqual(entry['user'], 'AID_ROOT')
            self.assertEqual(entry['group'], 'AID_ROOT')
            self.assertEqual(entry['caps'], '0')

    def test_resident_provenance_corruptions_refuse_before_overlay_mutation(self):
        trust, original = self.resident_fixture()
        self.overlay()
        for name in ['assets/agent/agent-bundle.js', 'assets/agent/alpha-source.json',
                     'assets/agent/workflow-worker/dependencies.json', 'assets/agent/workflow-worker/files.sha256']:
            with self.subTest(name=name):
                entries = {**original, name: original[name] + b'changed'}
                self.archive(list(entries.items()))
                with patch.object(native, 'ROOT', trust), self.assertRaises(ValueError):
                    native.stage(self.apk, self.output, 'AlphaPhone')
                self.assertEqual((self.output / 'Android.bp').read_text(), BP)
                self.assertEqual(len(list(self.output.iterdir())), 1)

    def test_self_consistent_bun_substitution_still_refuses_pinned_binary_mismatch(self):
        trust, entries = self.resident_fixture()
        name = 'lib/arm64-v8a/libeliza_bun.so'
        entries[name] += b'changed'
        entries['assets/agent/arm64-v8a/bun'] = entries[name]
        path = 'assets/agent/android-agent-runtime-provenance.json'
        provenance = json.loads(entries[path])
        for entry in provenance['files']:
            if entry['path'] in [name, 'assets/agent/arm64-v8a/bun']:
                entry.update(size_bytes=len(entries[name]), sha256=hashlib.sha256(entries[name]).hexdigest())
        entries[path] = json.dumps(provenance).encode()
        self.archive(list(entries.items()))
        self.overlay()
        with patch.object(native, 'ROOT', trust), self.assertRaisesRegex(ValueError, 'pinned binary'):
            native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual(len(list(self.output.iterdir())), 1)


if __name__ == '__main__':
    unittest.main()
