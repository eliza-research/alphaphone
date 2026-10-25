"""Board admission and real GNU Make policy evaluation; no image/boot claim."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('board', ROOT / 'scripts/prepare-grizzly-stock-board.py')
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)


class BoardPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'aosp'
        self.output = self.root / 'prepared'
        self.inputs = {}
        for name in board.INPUTS:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'# fixture input\n')
            self.inputs[name] = board.sha(path.read_bytes())
        self.patch = patch.object(board, 'INPUTS', self.inputs)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_preparation_does_not_modify_source(self):
        report = board.prepare(self.source, self.output)
        for name, expected in self.inputs.items():
            self.assertEqual(board.sha((self.source / name).read_bytes()), expected)
        self.assertEqual(board.sha((self.output / 'BoardConfig.mk').read_bytes()), report['outputSha256'])
        self.assertFalse(report['deployReady'])
        self.assertFalse(report['aospTreeModified'])

    def test_each_mismatched_input_rejects_before_output(self):
        for name in self.inputs:
            with self.subTest(name=name):
                path = self.source / name
                path.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    board.prepare(self.source, self.output)
                self.assertFalse(self.output.exists())
                path.write_bytes(b'# fixture input\n')

    def test_redirected_input_is_rejected(self):
        path = self.source / board.BOARD
        data = path.read_bytes()
        path.unlink()
        target = self.root / 'external.mk'
        target.write_bytes(data)
        path.symlink_to(target)
        with self.assertRaises(ValueError):
            board.prepare(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_or_internal_output_is_preserved(self):
        self.output.mkdir()
        sentinel = self.output / 'keep'
        sentinel.write_text('untouched')
        with self.assertRaises(FileExistsError):
            board.prepare(self.source, self.output)
        self.assertEqual(sentinel.read_text(), 'untouched')
        with self.assertRaises(ValueError):
            board.prepare(self.source, self.source / 'new')
        self.assertFalse((self.source / 'new').exists())
        with self.assertRaises(ValueError):
            board.prepare(self.source, self.root / 'outside' / '..' / 'aosp' / 'new')

    def evaluate(self, product='alpha_grizzly_phone', stock='true'):
        makefile = self.root / 'evaluate.mk'
        makefile.write_text(f'''TARGET_PRODUCT := {product}
USE_STOCK_KERNEL := {stock}
BOARD_KERNEL_CMDLINE := keep=1 bootloader.pixel.MTE_FORCE_ON kasan.fault=panic bootconfig bootconfig init_on_free=0 kasan=on
SANITIZE_TARGET := cfi memtag_heap memtag_stack memtag_globals
TARGET_HAS_ARM_MTE := true
include {board.FRAGMENT}
$(info CMD=$(BOARD_KERNEL_CMDLINE))
$(info SANITIZE=$(SANITIZE_TARGET))
$(info MTE=$(TARGET_HAS_ARM_MTE))
all: ; @:
''')
        return subprocess.run(['make', '-s', '-f', str(makefile)], capture_output=True, text=True)

    def test_alpha_stock_policy_uses_b1_flags_and_keeps_other_sanitizers(self):
        result = self.evaluate()
        self.assertEqual(result.returncode, 0, result.stderr)
        values = dict(line.split('=', 1) for line in result.stdout.splitlines())
        self.assertEqual(values['CMD'].split(), ['keep=1', 'kasan=off', 'init_on_alloc=0', 'init_on_free=1'])
        self.assertEqual(values['SANITIZE'], 'cfi')
        self.assertEqual(values['MTE'], 'false')

    def test_other_products_unchanged(self):
        result = self.evaluate(product='other_product')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('bootloader.pixel.MTE_FORCE_ON', result.stdout)
        self.assertIn('SANITIZE=cfi memtag_heap memtag_stack memtag_globals', result.stdout)
        self.assertIn('MTE=true', result.stdout)

    def test_nonstock_kernel_rejected(self):
        result = self.evaluate(stock='false')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires USE_STOCK_KERNEL=true', result.stderr)


if __name__ == '__main__':
    unittest.main()
