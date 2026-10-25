/** Read-only Alpha image checks. Never installs, reboots, selects roles or starts an agent. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hashFile} from '../vendor/eliza/packages/os/scripts/android/release-contract.ts';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const packageName = 'ai.elizaresearch.alphaphone';
const appPath = '/product/app/AlphaPhone/AlphaPhone.apk';
const nativePrefix = '/product/app/AlphaPhone/lib/arm64/';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const serialOk = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function validateExpectation(expected) {
  if (expected?.schemaVersion !== 1 || expected.device !== 'grizzly'
      || !['a', 'b'].includes(expected.slot) || ![4096, 16384].includes(expected.pageSize)
      || !/^Alpha\/alpha_grizzly_phone\/grizzly:17\/[^\s/]+\/[^\s/:]+:userdebug\/test-keys$/.test(expected.fingerprint ?? '')
      || !/^[A-Za-z0-9._+-]+$/.test(expected.bootloader ?? '') || !/^[A-Za-z0-9._+-]+$/.test(expected.baseband ?? '')
      || !digest(expected.apkSha256) || !digest(expected.adbSha256)
      || !Array.isArray(expected.nativeFiles) || expected.nativeFiles.length < 1 || expected.nativeFiles.length > 32)
    throw Error('Invalid Alpha grizzly development-image expectation');
  const names = new Set();
  for (const file of expected.nativeFiles) {
    if (!/^lib[A-Za-z0-9_.+-]+\.so$/.test(file.name ?? '') || names.has(file.name)
        || !digest(file.sha256) || !['0644', '0755'].includes(file.mode))
      throw Error('Invalid native-file expectation');
    names.add(file.name);
  }
  return expected;
}

export function checkPostBoot(expected, serial, shell, adbQuery) {
  validateExpectation(expected);
  if (!serialOk(serial)) throw Error('Explicit device serial required');
  const checks = [], observations = {};
  const check = (id, read, accept, retain = true) => {
    try {
      const value = read().trim();
      if (value.length > 4096 || /\x00/.test(value)) throw Error('Invalid bounded response');
      const passed = accept(value);
      checks.push({id, passed});
      if (retain) observations[id] = value;
      return passed;
    } catch {
      checks.push({id, passed: false, error: 'Read failed or timed out'});
      return false;
    }
  };
  const prop = key => shell(['getprop', key]);
  // Stop before file inspection if this is not the explicitly selected USB phone.
  const usb = check('usb-transport', () => adbQuery(['get-devpath']), v => /^usb:[^\s]+$/.test(v));
  const serialMatch = check('serial-match', () => prop('ro.boot.serialno'), v => v === serial, false);
  const device = check('device', () => prop('ro.product.device'), v => v === 'grizzly');
  const sku = check('sku', () => prop('ro.boot.hardware.sku'), v => ['G7SWN', 'GM45K'].includes(v));
  const physical = check('not-emulator', () => prop('ro.kernel.qemu'), v => v === '' || v === '0');
  if (usb && serialMatch && device && sku && physical) {
    check('boot-completed', () => prop('sys.boot_completed'), v => v === '1');
    check('fingerprint', () => prop('ro.build.fingerprint'), v => v === expected.fingerprint);
    check('slot', () => prop('ro.boot.slot_suffix'), v => v === `_${expected.slot}`);
    check('bootloader', () => prop('ro.bootloader'), v => v === expected.bootloader);
    check('baseband', () => prop('gsm.version.baseband'), v => v === expected.baseband);
    check('selinux', () => shell(['getenforce']), v => v === 'Enforcing');
    check('page-size', () => shell(['getconf', 'PAGESIZE']), v => v === String(expected.pageSize));
    check('apk-path', () => shell(['pm', 'path', packageName]), v => v === `package:${appPath}`);
    const fileHash = (id, filename, hash) => check(id, () => shell(['sha256sum', filename]),
      v => v === `${hash}  ${filename}`);
    fileHash('apk-sha256', appPath, expected.apkSha256);
    for (const file of expected.nativeFiles) {
      const filename = nativePrefix + file.name;
      fileHash(`native-sha256:${file.name}`, filename, file.sha256);
      check(`native-mode:${file.name}`, () => shell(['stat', '-c', '%a:%u:%g', filename]),
        v => v === `${file.mode.slice(1)}:0:0`);
    }
    // Roles are observations only: retaining a stock fallback HOME is intentional.
    check('home-observed', () => shell(['cmd', 'role', 'get-role-holders', 'android.app.role.HOME']),
      v => v === '' || /^[A-Za-z0-9_.]+(?:\n[A-Za-z0-9_.]+)*$/.test(v));
  }
  return {schemaVersion: 1, recordedAt: new Date().toISOString(), serialSha256: sha(serial),
    imageBootChecksPassed: checks.every(item => item.passed), checks, observations,
    alphaHomeSelected: observations['home-observed'] === packageName,
    residentAgentExecutionVerified: false, hardwareAcceptanceVerified: false,
    restoreDrillVerified: false, deployReady: false,
    scope: 'Read-only image and packaging checks; caller-supplied expectations are not release authorization'};
}

export function parseOptions(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!['--expected', '--device', '--adb', '--output'].includes(flag) || result[flag.slice(2)]
        || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw Error('Use --expected FILE --device SERIAL --adb ABSOLUTE_TOOL --output NEW_FILE');
    result[flag.slice(2)] = argv[i + 1];
  }
  if (Object.keys(result).length !== 4 || !serialOk(result.device) || !path.isAbsolute(result.adb))
    throw Error('All four explicit options are required');
  return result;
}

export function main(argv = process.argv.slice(2)) {
  const o = parseOptions(argv);
  const fd = fs.openSync(o.expected, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw Error('Expected descriptor must be a bounded regular file');
    const buffer = Buffer.alloc(65537);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 65536) throw Error('Expected descriptor changed size');
    bytes = buffer.subarray(0, length);
  } finally { fs.closeSync(fd); }
  const expected = validateExpectation(JSON.parse(bytes));
  if (hashFile(o.adb).sha256 !== expected.adbSha256)
    throw Error('ADB differs from the expected host tool');
  const reportFd = fs.openSync(o.output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const query = args => {
      if (hashFile(o.adb).sha256 !== expected.adbSha256) throw Error('ADB changed');
      const result = spawnSync(o.adb, ['-s', o.device, ...args], {encoding: 'utf8', timeout: 30000, maxBuffer: 16384});
      if (result.error || result.status !== 0) throw Error('Read-only ADB query failed');
      return result.stdout;
    };
    const report = checkPostBoot(expected, o.device, args => query(['shell', ...args]), query);
    report.expectationSha256 = sha(bytes);
    fs.writeFileSync(reportFd, JSON.stringify(report, null, 2) + '\n');
    fs.fsyncSync(reportFd);
    console.log(JSON.stringify(report, null, 2));
    return report.imageBootChecksPassed ? 0 : 2;
  } finally { fs.closeSync(reportFd); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
