import importlib.util
import json
from pathlib import Path
import sys
import tempfile

assert sys.platform.startswith('linux'), 'Fixture is Linux-only'
spec = importlib.util.spec_from_file_location('owned', Path(__file__).with_name('owned-linux-supervisor.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

cases = [
    ('normal', 'print("normal")', True, 5, 128 * 1024**2),
    ('forked-child', 'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","print(1)"]);p.wait()', True, 5, 128 * 1024**2),
    ('leader-exit', 'import subprocess,sys;subprocess.Popen([sys.executable,"-c","import time;time.sleep(10)"])', False, 5, 128 * 1024**2),
    ('timeout', 'import time;time.sleep(10)', False, .2, 128 * 1024**2),
    ('rss', 'import time;x=bytearray(64*1024**2);time.sleep(10)', False, 5, 32 * 1024**2),
    ('fast-log-overflow', 'print("x"*(2*1024**2))', False, 5, 128 * 1024**2),
    ('fast-disk-overflow', 'import os;open("overflow.bin","wb").write(b"x"*(20*1024**2))', False, 5, 128 * 1024**2),
]
cases.extend((f'fast-normal-{n}', 'pass', True, 5, 128 * 1024**2) for n in range(20))
results = []
with tempfile.TemporaryDirectory(prefix='owned-inert-fixtures-') as root:
    root = Path(root)
    for name, code, passed, seconds, rss in cases:
        case_root = root / name
        case_root.mkdir()
        if name == 'fast-disk-overflow':
            code = 'import os;open(' + repr(str(case_root / 'overflow.bin')) + ',"wb").write(b"x"*(20*1024**2))'
        result = module.supervise([sys.executable, '-c', code], case_root / 'observation', case_root,
            {'seconds': seconds, 'rssBytes': rss, 'growthBytes': 16*1024**2,
             'logBytes': 1024**2, 'stopFreeBytes': 0})
        assert result['passed'] is passed, (name, result)
        assert result['ownedGroupEmpty'], (name, result)
        results.append({'case': name, 'pass': True})
Path('LINUX-SUPERVISOR-FIXTURES.json').write_text(json.dumps(results, indent=2))
print('PASS 27 Linux inert ownership/resource fixtures')
