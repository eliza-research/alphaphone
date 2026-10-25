import hashlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).resolve().parents[1] / 'scripts/verify-pixel11-recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'factory.zip'

    def fixture(self, *, omit=None, wrong_firmware=False, duplicate=False, corrupt=False):
        content = io.BytesIO()
        with zipfile.ZipFile(content, 'w') as images:
            names = ['boot', 'init_boot', 'vendor_boot', 'vendor_kernel_boot', 'dtbo', 'pvmfw', 'vbmeta', 'vbmeta_system', 'vbmeta_vendor', 'super_empty', 'system', 'system_dlkm', 'system_ext', 'product', 'vendor', 'vendor_dlkm', 'system_other']
            for name in names:
                if name != omit:
                    images.writestr(name + '.img', 'fixture-' + name)
            images.writestr('android-info.txt', 'require board=cubs|grizzly\nrequire version-bootloader=' + ('different' if wrong_firmware else 'expected') + '\nrequire version-baseband=radio\n')
            images.writestr('fastboot-info.txt', 'version 1\nflash boot\n')
            if duplicate:
                images.writestr('boot.img', 'duplicate')
        data = content.getvalue()
        if corrupt:
            data = data.replace(b'fixture-boot', b'damaged-boot', 1)
        with zipfile.ZipFile(self.file, 'w') as outer:
            outer.writestr('grizzly/image-grizzly-test.zip', data)
        return {'rollbackFactoryImage': {'buildId': 'TEST', 'sizeBytes': self.file.stat().st_size, 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}, 'generatedVendor': {'requiredTextFiles': [{'path': 'firmware/android-info.txt', 'includes': ['require board=grizzly', 'require version-bootloader=expected', 'require version-baseband=radio', 'require partition-exists=vendor_kernel_boot']}]}}

    def test_valid_contents_are_not_deployment_or_restore_acceptance(self):
        result = recovery.verify_factory(self.file, self.fixture())
        self.assertTrue(result['outerAndInnerCrcVerified'])
        self.assertFalse(result['deployReady'])
        self.assertFalse(result['restorationTested'])

    def test_missing_image(self):
        lock = self.fixture(omit='vbmeta_vendor')
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            recovery.verify_factory(self.file, lock)

    def test_wrong_firmware(self):
        lock = self.fixture(wrong_firmware=True)
        with self.assertRaisesRegex(ValueError, 'firmware'):
            recovery.verify_factory(self.file, lock)

    def test_duplicate_entry(self):
        lock = self.fixture(duplicate=True)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            recovery.verify_factory(self.file, lock)

    def test_inner_corruption_despite_matching_outer_digest(self):
        lock = self.fixture(corrupt=True)
        with self.assertRaisesRegex(ValueError, 'CRC'):
            recovery.verify_factory(self.file, lock)

    def test_tamper_and_symlink(self):
        lock = self.fixture()
        data = self.file.read_bytes()
        self.file.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            recovery.verify_factory(self.file, lock)
        link = self.file.with_name('link')
        link.symlink_to(self.file)
        with self.assertRaises(OSError):
            recovery.verify_factory(link, lock)

    def test_replaced_path_with_identical_bytes(self):
        lock = self.fixture()
        original_open = os.open

        def swapped_open(*args, **kwargs):
            fd = original_open(*args, **kwargs)
            data = self.file.read_bytes()
            self.file.rename(self.file.with_suffix('.original'))
            self.file.write_bytes(data)
            return fd

        with patch.object(recovery.os, 'open', side_effect=swapped_open):
            with self.assertRaisesRegex(ValueError, 'changed'):
                recovery.verify_factory(self.file, lock)

    def test_pipe_rejected_without_waiting_for_a_writer(self):
        os.mkfifo(self.file)
        result = subprocess.run([sys.executable, '-B', str(Path(recovery.__file__)), str(self.file)], capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 1)
        self.assertIn('not a regular file', result.stderr)


if __name__ == '__main__':
    unittest.main()
