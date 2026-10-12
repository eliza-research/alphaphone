#!/usr/bin/env node
/** Read-only Alpha image checks. No install, role change, alarm, or runtime request. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyAospClockHandlers} from './aosp-clock-contract.mjs';

const PACKAGE = 'ai.elizaresearch.alphaphone';
const requireThat = (value, message) => { if (!value) throw Error(message); };
const component = value => value.replace('/.', `/${value.split('/')[0]}.`);
const components = text => text.trim().split(/\r?\n/).map(line => line.trim())
  .filter(line => /^[A-Za-z][\w.]*\/[.A-Za-z][\w.$]*$/.test(line)).map(component);

export function validateExpectation(expected) {
  requireThat(expected?.packageName === PACKAGE, 'Descriptor must belong to Alpha Phone');
  requireThat(/^[a-f0-9]{64}$/.test(expected.apkSha256 ?? ''), 'Expected APK SHA-256 required');
  requireThat(/^[a-f0-9]{64}$/.test(expected.certificateSha256 ?? ''), 'Expected certificate SHA-256 required');
  requireThat(typeof expected.fingerprint === 'string' && expected.fingerprint.length > 0 &&
    expected.fingerprint.length <= 512 && !/[\r\n\0]/.test(expected.fingerprint), 'Exact expected image fingerprint required');
  requireThat(/^\/(product|system|system_ext)\/app\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.apk$/.test(expected.apkPath ?? '') &&
    !expected.apkPath.split('/').includes('..'), 'Expected nonprivileged system APK path required');
  return expected;
}

/** Injected runner enables controlled negative tests; all commands are read-only. */
export function verifyCuttlefishLauncher(run, expected, user) {
  validateExpectation(expected);
  requireThat(/^(0|[1-9]\d*)$/.test(user ?? ''), 'Explicit Android user required');
  const shell = (...args) => run('shell', ...args).trim();
  const prop = name => shell('getprop', name);
  requireThat(prop('sys.boot_completed') === '1', 'Android boot is incomplete');
  const hardware = prop('ro.hardware'), device = prop('ro.product.device');
  requireThat(['cutf_cvm', 'cutf_ivshmem', 'cutf_vm'].includes(hardware) && /^vsoc_/.test(device), 'Only Cuttlefish is admitted');
  const fingerprint = prop('ro.build.fingerprint');
  requireThat(fingerprint === expected.fingerprint, 'Booted image fingerprint differs from expectation');
  const bootId = shell('cat', '/proc/sys/kernel/random/boot_id');
  requireThat(/^[a-f0-9-]{36}$/.test(bootId), 'Boot identity unavailable');
  requireThat(shell('am', 'get-current-user') === user, 'Selected user is not foreground');
  requireThat(shell('am', 'get-started-user-state', user) === 'RUNNING_UNLOCKED', 'Selected user is not unlocked');
  requireThat(shell('getenforce') === 'Enforcing', 'SELinux is not enforcing');
  const installedPath = () => shell('pm', 'path', '--user', user, PACKAGE);
  requireThat(installedPath() === `package:${expected.apkPath}`, 'Alpha is missing, split, or overridden by a data APK');
  const digest = () => {
    const result = shell('sha256sum', expected.apkPath);
    requireThat(/^[a-f0-9]{64}\s/.test(result), 'Installed APK digest unavailable');
    return result.split(/\s+/)[0];
  };
  requireThat(digest() === expected.apkSha256, 'Installed APK differs from the staged launcher');
  const homeArgs = ['--user', user, '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'];
  const home = components(shell('cmd', 'package', 'resolve-activity', '--brief', ...homeArgs));
  requireThat(home.length === 1 && home[0] === `${PACKAGE}/${PACKAGE}.MainActivity`, 'Alpha is not the resolved HOME');
  const candidates = components(shell('cmd', 'package', 'query-activities', '--brief', '--components', ...homeArgs));
  // Settings FallbackHome only waits for a real HOME; it is not a recovery launcher.
  const recovery = [...new Set(candidates.filter(row => !row.startsWith(`${PACKAGE}/`) &&
    row !== 'com.android.settings/com.android.settings.FallbackHome'))].filter(row => {
    const pkg = row.split('/')[0];
    return shell('pm', 'list', 'packages', '--user', user, '-s', '-e', pkg).split(/\r?\n/).includes(`package:${pkg}`);
  });
  requireThat(recovery.length > 0, 'No enabled system recovery HOME remains');
  const clock = verifyAospClockHandlers(run, user);
  const webview = /Current WebView package \(name, version\):\s*\(([^,\s]+),\s*([^\)]+)\)/
    .exec(shell('dumpsys', 'webviewupdate'));
  requireThat(webview, 'Current WebView provider unavailable');
  // Reject a result assembled across a reboot, foreground-user change or APK replacement.
  requireThat(shell('cat', '/proc/sys/kernel/random/boot_id') === bootId &&
    prop('sys.boot_completed') === '1' && prop('ro.build.fingerprint') === fingerprint &&
    shell('am', 'get-current-user') === user && installedPath() === `package:${expected.apkPath}` && digest() === expected.apkSha256,
  'Image, user or APK changed during verification');
  return {passed: true, evidence: 'cuttlefish-launcher-postboot', fingerprint, hardware, device, user,
    apkPath: expected.apkPath, apkSha256: expected.apkSha256,
    certificateSha256: expected.certificateSha256, certificateEvidence: 'same APK bytes as supplied staging descriptor',
    home: home[0], recoveryHomes: recovery, clock, webview: {packageName: webview[1], version: webview[2]},
    runtimeExecutionVerified: false, physicalDeviceVerified: false, productionReleaseVerified: false,
    scope: 'Booted image fingerprint, exact system launcher bytes, HOME, recovery HOME, Clock handlers and WebView presence only'};
}

export function parseArgs(args) {
  const values = {};
  const allowed = ['--serial', '--user', '--descriptor', '--fingerprint', '--apk-path', '--out', '--adb'];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    requireThat(allowed.includes(flag) && values[flag] === undefined && args[i + 1] && !args[i + 1].startsWith('--'), `Invalid or duplicate option: ${flag}`);
    values[flag] = args[++i];
  }
  for (const flag of allowed.filter(flag => flag !== '--adb')) requireThat(values[flag], `${flag} required`);
  requireThat(/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(values['--serial']), 'Explicit loopback Cuttlefish endpoint required');
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options, output;
  try {
    options = parseArgs(process.argv.slice(2));
    // Reserve a new report before reading device state; never overwrite previous evidence.
    output = fs.openSync(options['--out'], 'wx', 0o600);
    const descriptorBytes = fs.readFileSync(options['--descriptor']);
    const expected = {...JSON.parse(descriptorBytes), fingerprint: options['--fingerprint'], apkPath: options['--apk-path']};
    const run = (...args) => {
      try { return execFileSync(options['--adb'] ?? 'adb', ['-s', options['--serial'], ...args],
        {encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}); }
      catch { throw Error('ADB observation failed or timed out'); }
    };
    const report = verifyCuttlefishLauncher(run, expected, options['--user']);
    report.descriptorSha256 = createHash('sha256').update(descriptorBytes).digest('hex');
    report.observedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS ${options['--out']}: Cuttlefish launcher postboot checks only`);
  } catch (error) {
    // Subprocess errors can contain stdout/stderr; retain a bounded diagnostic, not raw device dumps.
    const message = String(error.message).slice(0, 1024);
    if (output !== undefined) fs.writeFileSync(output, JSON.stringify({passed: false, evidence: 'cuttlefish-launcher-postboot', error: message, observedAt: new Date().toISOString()}, null, 2) + '\n');
    console.error(message);
    process.exitCode = 1;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
