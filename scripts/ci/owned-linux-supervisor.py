"""Linux port of reviewed verification-leaf/run.py non-reaping ownership logic."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def members(pgid):
    result = {}
    for file in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = file.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                result[int(file.parent.name)] = {'state': fields[0], 'birth': fields[19],
                    'rss': int(fields[21]) * os.sysconf('SC_PAGE_SIZE')}
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result


def live(rows):
    return {pid: row for pid, row in rows.items() if row['state'] != 'Z'}


def exited_unreaped(pid):
    return os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None


def allocated(root):
    return sum(path.lstat().st_blocks * 512 for path in root.rglob('*')
               if path.is_file() and not path.is_symlink()) if root.exists() else 0


def supervise(command, output, write_root, limits, env=None):
    assert sys.platform.startswith('linux')
    output.mkdir(parents=True, exist_ok=False)
    start = time.monotonic()
    result = {'passed': False, 'command': command, 'peakRSS': 0, 'peakDisk': 0,
              'exitCode': None, 'ownedGroupEmpty': False}
    proc = None
    birth = None
    try:
        with (output / 'process.log').open('xb') as log:
            proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                    start_new_session=True, env=env)
            first = members(proc.pid)
            assert proc.pid in first
            birth = first[proc.pid]['birth']
            while True:
                rows = members(proc.pid)
                assert proc.pid in rows and rows[proc.pid]['birth'] == birth
                active = live(rows)
                rss = sum(row['rss'] for row in active.values())
                disk = allocated(write_root)
                result['peakRSS'] = max(result['peakRSS'], rss)
                result['peakDisk'] = max(result['peakDisk'], disk)
                assert time.monotonic() - start < limits['seconds'], 'Wall cap'
                assert rss <= limits['rssBytes'], 'RSS cap'
                assert disk <= limits['growthBytes'], 'Disk cap'
                assert (output / 'process.log').stat().st_size <= limits['logBytes'], 'Log cap'
                assert os.statvfs(output).f_bavail * os.statvfs(output).f_frsize >= limits['stopFreeBytes'], 'Free-space floor'
                if exited_unreaped(proc.pid):
                    # The process can exit between the first snapshot and waitid.
                    # Refresh both ownership and final resource use before success.
                    rows = members(proc.pid)
                    assert proc.pid in rows and rows[proc.pid]['birth'] == birth
                    assert not live(rows), 'Owned child survived leader'
                    disk = allocated(write_root)
                    result['peakDisk'] = max(result['peakDisk'], disk)
                    assert time.monotonic() - start < limits['seconds'], 'Wall cap'
                    assert disk <= limits['growthBytes'], 'Disk cap'
                    assert (output / 'process.log').stat().st_size <= limits['logBytes'], 'Log cap'
                    assert os.statvfs(output).f_bavail * os.statvfs(output).f_frsize >= limits['stopFreeBytes'], 'Free-space floor'
                    result['passed'] = True
                    break
                time.sleep(.1)
    except BaseException as error:
        result['failure'] = type(error).__name__ + ': ' + str(error)[:200]
    finally:
        # Keep leader unreaped until its whole owned group is gone. Its PID
        # cannot be reused, unlike poll()+killpg patterns. Recheck birth before
        # every signal. This is the existing reviewed ownership primitive.
        if proc is not None:
            try:
                for sig, grace in [(signal.SIGTERM, 3), (signal.SIGKILL, 2)]:
                    rows = members(proc.pid)
                    assert proc.pid in rows and rows[proc.pid]['birth'] == birth
                    if not live(rows):
                        break
                    os.killpg(proc.pid, sig)
                    until = time.monotonic() + grace
                    while live(members(proc.pid)) and time.monotonic() < until:
                        time.sleep(.05)
                result['ownedGroupEmpty'] = not live(members(proc.pid))
                assert result['ownedGroupEmpty'], 'Owned-group cleanup unconfirmed'
                result['exitCode'] = proc.wait(timeout=2)
                result['passed'] = result['passed'] and result['exitCode'] == 0
            except BaseException as error:
                result['passed'] = False
                result['cleanupError'] = type(error).__name__
        result['seconds'] = time.monotonic() - start
        (output / 'RESULT.json').write_text(json.dumps(result, indent=2))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--write-root', type=Path, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    assert command and os.environ.get('GITHUB_ACTIONS') == 'true'
    result = supervise(command, args.output, args.write_root, json.loads(args.manifest.read_text())['limits'])
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
