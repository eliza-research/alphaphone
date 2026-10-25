import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkPostBoot, main, parseOptions, validateExpectation} from '../scripts/pixel11-postboot.mjs';

const serial = 'PIXELFIXTURE';
const expected = {
  schemaVersion: 1, device: 'grizzly', slot: 'b', pageSize: 4096,
  fingerprint: 'Alpha/alpha_grizzly_phone/grizzly:17/CP2A.260605.016/fixture:userdebug/test-keys',
  apkSha256: 'a'.repeat(64), adbSha256: 'b'.repeat(64),
  bootloader: 'fixture-bootloader', baseband: 'fixture-radio',
  nativeFiles: [{name: 'libeliza_bun.so', sha256: 'c'.repeat(64), mode: '0755'}],
};
const apk = '/product/app/AlphaPhone/AlphaPhone.apk';
const bun = '/product/app/AlphaPhone/lib/arm64/libeliza_bun.so';

function fixture(overrides = {}) {
  const reads = [], values = new Map([
    ['get-devpath', 'usb:1-2'], ['getprop ro.boot.serialno', serial],
    ['getprop ro.product.device', 'grizzly'], ['getprop ro.boot.hardware.sku', 'G7SWN'],
    ['getprop ro.kernel.qemu', ''], ['getprop sys.boot_completed', '1'],
    ['getprop ro.build.fingerprint', expected.fingerprint], ['getprop ro.boot.slot_suffix', '_b'],
    ['getprop ro.bootloader', expected.bootloader], ['getprop gsm.version.baseband', expected.baseband],
    ['getenforce', 'Enforcing'], ['getconf PAGESIZE', '4096'],
    [`pm path ai.elizaresearch.alphaphone`, `package:${apk}`],
    [`sha256sum ${apk}`, `${expected.apkSha256}  ${apk}`],
    [`sha256sum ${bun}`, `${expected.nativeFiles[0].sha256}  ${bun}`],
    [`stat -c %a:%u:%g ${bun}`, '755:0:0'],
    ['cmd role get-role-holders android.app.role.HOME', 'com.android.launcher3'],
    ...Object.entries(overrides),
  ]);
  const read = args => {
    const key = args.join(' ');
    reads.push(key);
    assert.ok(values.has(key), `Unexpected command: ${key}`);
    const value = values.get(key);
    if (value instanceof Error) throw value;
    return value;
  };
  return {read, reads};
}

test('Alpha image checks use read-only commands and retain separate acceptance boundaries', () => {
  const f = fixture();
  const result = checkPostBoot(expected, serial, f.read, f.read);
  assert.equal(result.imageBootChecksPassed, true);
  assert.equal(result.alphaHomeSelected, false);
  for (const key of ['deployReady', 'restoreDrillVerified', 'residentAgentExecutionVerified', 'hardwareAcceptanceVerified'])
    assert.equal(result[key], false);
  assert.equal(JSON.stringify(result).includes(serial), false);
  assert.ok(f.reads.every(command => /^(get-devpath|getprop |getenforce|getconf |pm path |sha256sum |stat |cmd role get-role-holders )/.test(command)));
});

test('wrong device, serial, SKU or emulator stops before package inspection', () => {
  for (const [key, value] of Object.entries({'get-devpath': 'unknown', 'getprop ro.boot.serialno': 'OTHER',
    'getprop ro.product.device': 'kodiak', 'getprop ro.boot.hardware.sku': 'UNKNOWN', 'getprop ro.kernel.qemu': '1'})) {
    const f = fixture({[key]: value});
    assert.equal(checkPostBoot(expected, serial, f.read, f.read).imageBootChecksPassed, false);
    assert.equal(f.reads.some(command => command.startsWith('pm ') || command.startsWith('sha256sum ')), false);
  }
});

test('fallback slot, changed firmware, file mismatch, wrong permissions and timeout fail image checks', () => {
  for (const [key, value] of Object.entries({'getprop ro.boot.slot_suffix': '_a',
    'getprop ro.build.fingerprint': expected.fingerprint + '-different', 'getenforce': 'Permissive',
    'getconf PAGESIZE': '16384', 'getprop gsm.version.baseband': 'other-radio',
    [`sha256sum ${apk}`]: `${'d'.repeat(64)}  ${apk}`, [`stat -c %a:%u:%g ${bun}`]: '644:0:0',
    'getprop sys.boot_completed': new Error('timeout')})) {
    const f = fixture({[key]: value});
    assert.equal(checkPostBoot(expected, serial, f.read, f.read).imageBootChecksPassed, false, key);
  }
});

test('invalid expectations and mutation flags reject before any device query', () => {
  for (const change of [{slot: 'all'}, {device: 'kodiak'}, {apkSha256: 'unknown'},
    {nativeFiles: [{name: '../../other', sha256: 'a'.repeat(64), mode: '0755'}]},
    {nativeFiles: [expected.nativeFiles[0], expected.nativeFiles[0]]}])
    assert.throws(() => validateExpectation({...expected, ...change}));
  assert.throws(() => checkPostBoot({...expected, slot: 'all'}, serial, () => assert.fail('queried'), () => assert.fail('queried')));
  assert.throws(() => parseOptions(['--execute']));
  assert.throws(() => parseOptions(['--expected', 'a', '--expected', 'b']));
  assert.throws(() => parseOptions(['--expected', 'a', '--device', serial, '--adb', 'adb', '--output', 'o']));
});

test('CLI refuses changed tools and existing reports before executing ADB', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-postboot-'));
  try {
    const adb = path.join(dir, 'adb'), descriptor = path.join(dir, 'expected.json');
    const output = path.join(dir, 'report.json'), marker = path.join(dir, 'executed');
    const tool = `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`;
    fs.writeFileSync(adb, tool, {mode: 0o755});
    const options = ['--expected', descriptor, '--device', serial, '--adb', adb, '--output', output];
    fs.writeFileSync(descriptor, JSON.stringify(expected));
    assert.throws(() => main(options), /ADB differs/);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(output), false);
    fs.writeFileSync(descriptor, JSON.stringify({...expected, adbSha256: createHash('sha256').update(tool).digest('hex')}));
    fs.writeFileSync(output, 'preserve');
    assert.throws(() => main(options), /EEXIST/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'preserve');
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
