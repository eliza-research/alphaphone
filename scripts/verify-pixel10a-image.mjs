#!/usr/bin/env node
/**
 * Read-only checks of a booted alpha_stallion_phone image on a Pixel 10a through the shared
 * launcher image verifier: exact fingerprint, Alpha's nonprivileged system launcher bytes as
 * HOME, a remaining recovery HOME, Clock handlers, WebView and, with --listener, the Sense
 * listener's privileges. The shared verifier only records ro.boot.verifiedbootstate, so this
 * wrapper fails a report whose state is not green or yellow (an unlocked bootloader reports
 * orange). Device facts only; no install or role change.
 *
 *   node scripts/verify-pixel10a-image.mjs --serial SERIAL --user 0 --descriptor LAUNCHER_JSON \
 *     --fingerprint EXACT --apk-path /product/app/AlphaPhone/AlphaPhone.apk --out NEW_REPORT [--listener]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main as mainShared, parseArgs, verifyLauncherImage} from '../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs';
import {validateExpectation} from './verify-cuttlefish-launcher.mjs';

/** green: stock-key locked; yellow: locked with Alpha's custom AVB key. orange (unlocked) and anything else fail. */
export const ADMITTED_VERIFIED_BOOT_STATES = Object.freeze(['green', 'yellow']);

export function verifiedBootProblem(report) {
  const state = report?.verifiedBoot?.state;
  return ADMITTED_VERIFIED_BOOT_STATES.includes(state) ? null
    : `Verified boot state ${JSON.stringify(state ?? null)} is not green or yellow; the bootloader must be locked with verified boot enforcing`;
}

/** Injected runner enables controlled negative tests; all commands are read-only. */
export function verifyPixel10aImage(run, expected, user) {
  const report = verifyLauncherImage(run, validateExpectation(expected), user, 'pixel10a');
  const problem = verifiedBootProblem(report);
  if (problem) throw Error(problem);
  return report;
}

/** The shared CLI writes the report; a passing report with an inadmissible boot state is rewritten as a failure. */
export function main(argv = process.argv.slice(2)) {
  // Hold the shared PASS line until the boot state is admitted, so a failing run never prints PASS.
  const log = console.log, held = [];
  console.log = (...args) => held.push(args);
  try { mainShared(argv, {target: 'pixel10a', admitDescriptor: validateExpectation}); } finally { console.log = log; }
  if (process.exitCode) return held.forEach(args => log(...args));
  const out = parseArgs(argv, 'pixel10a')['--out'], report = JSON.parse(fs.readFileSync(out, 'utf8'));
  const problem = report.passed === true ? verifiedBootProblem(report) : 'Shared report did not pass';
  if (!problem) return held.forEach(args => log(...args));
  fs.writeFileSync(out, `${JSON.stringify({passed: false, evidence: report.evidence, verifiedBoot: report.verifiedBoot ?? null, error: problem, observedAt: report.observedAt}, null, 2)}\n`);
  console.error(`FAIL ${out}: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
