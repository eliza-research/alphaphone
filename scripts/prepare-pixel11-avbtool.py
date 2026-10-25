"""Create a hash-checked standalone AVB verification tool; never edit AOSP sources."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--aosp-root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True, help='New directory for the standalone host tool')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
contracts = root / 'android/aosp/host-tools'
contract = json.loads((contracts / 'avbtool-mldsa.json').read_text())
source = args.aosp_root / 'external/avb' / contract['sourcePath']
patch = contracts / contract['patch']
source_bytes, patch_bytes = source.read_bytes(), patch.read_bytes()
if hashlib.sha256(source_bytes).hexdigest() != contract['baseSha256']:
    raise ValueError('AOSP avbtool does not match the pinned patch base')
if hashlib.sha256(patch_bytes).hexdigest() != contract['patchSha256']:
    raise ValueError('AVB verification patch digest mismatch')
output = args.output.absolute()
output.mkdir(mode=0o700)
# --no-index applies to this standalone directory, not its enclosing Git worktree.
tool = output / contract['sourcePath']
tool.write_bytes(source_bytes)
checked_patch = output / 'applied.patch'
checked_patch.write_bytes(patch_bytes)
subprocess.run(['git', 'apply', '--no-index', '--check', str(checked_patch)], cwd=output, check=True)
subprocess.run(['git', 'apply', '--no-index', str(checked_patch)], cwd=output, check=True)
actual = hashlib.sha256(tool.read_bytes()).hexdigest()
if actual != contract['resultSha256']:
    raise ValueError('Patched AVB verifier does not match the pinned result')
receipt = {'tool': str(tool), 'sha256': actual, 'baseSha256': contract['baseSha256'],
           'patchSha256': contract['patchSha256'], 'aospSourceModified': False,
           'releaseSigningAuthorized': False}
(output / 'provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
