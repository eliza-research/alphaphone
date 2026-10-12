#!/usr/bin/env node
// Audits a built web bundle (web-dist or an APK's extracted assets/public) for mock,
// fixture and developer surfaces. Usage:
//   node scripts/audit-production-bundle.mjs <dir> [--expect-test-mocks]
// The denylist is skipped only when the bundle's build-flags.json records testMocks:true.
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fontLicenceFindings, fontLicenceLine} from './font-license-blockers.mjs';
import {licenceFlagLines} from './licence-policy.mjs';

export const DENYLIST = Object.freeze([
  'Connect remote agent', 'Agent HTTPS address', 'Development Cloud agent infrastructure', 'Dedicated hosting requires a reviewed setup',
  'alpha:force-render-error', 'alpha:render-error-check', 'Forced render failure',
  'Enter mock mode', 'Try mock mode', 'Exit mock mode', 'mock-mode-banner', 'Mock mode ·',
  '10.0.2.2:2138', 'cloud-staging', 'api-staging.eliza.app',
  'alpha-dev-tools', 'Development connections', 'Development card', 'Device controls',
  'Browser development device', 'Development reply', '__alpha-local-agent', '__alpha-browser-cloud',
  'emulator development agent', 'Simulate Clock request',
  'Maya Chen', 'Jordan Park', 'Priya Nair', 'Alex Kim', 'you@gmail.example', 'Ritual Coffee',
  'news.example', 'Design review at', 'Unlock for details',
  'Development vault secret', 'synthetic-dev-',
]);
const TEXT = /\.(?:html?|js|mjs|cjs|css|json|txt|svg|xml|webmanifest)$/i;

// Hard-coded avatar initials: a small round badge span whose whole text is two capital
// letters or a "+N" overflow count, written into markup instead of rendered from data.
// Matches the raw markup and its JSON-escaped form inside a bundled ?raw template.
export const AVATAR_INITIALS = /border-radius:\s*1[0-9]px;[^<>]{0,400}?\\?"\s*>\s*([A-Z]{2}|\+\d{1,2})\s*<\/span>/g;
// The prototype's next-event card still carries MC, JP and +2 (platform-20). The shell
// package removes them; delete this allowance in the change after that lands. Any other
// initials badge fails now.
export const PENDING_AVATAR_INITIALS = Object.freeze(['MC', 'JP', '+2']);
export function avatarInitials(text) {
  return [...text.matchAll(AVATAR_INITIALS)].map(match => match[1]);
}

function walk(root, directory = root, out = []) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(root, file, out);
    else if (entry.isFile()) out.push(path.relative(root, file).split(path.sep).join('/'));
  }
  return out;
}

/** Reads {"testMocks": boolean}. A missing or malformed record is treated as a production bundle. */
export function readBuildFlags(dir) {
  const file = path.join(dir, 'build-flags.json');
  if (!existsSync(file)) return {present: false, testMocks: false};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return {present: true, testMocks: value?.testMocks === true, valid: typeof value?.testMocks === 'boolean'};
  } catch { return {present: true, testMocks: false, valid: false}; }
}

/**
 * @param {string} dir bundle root
 * @param {{testMocks?: boolean}} [options] expected flag state; defaults to the recorded state
 * @returns {{ok: boolean, testMocks: boolean, files: number, findings: Array<{file: string, rule: string}>, errors: string[]}}
 */
export function auditWebBundle(dir, options = {}) {
  const errors = [], findings = [], pending = new Set();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return {ok: false, testMocks: false, files: 0, findings, errors: [`Bundle directory not found: ${dir}`]};
  const flags = readBuildFlags(dir);
  const expected = options.testMocks === true;
  if (!flags.present) errors.push('build-flags.json is missing; the bundle cannot prove how it was built.');
  else if (flags.valid === false) errors.push('build-flags.json is malformed.');
  if (flags.present && flags.testMocks !== expected) errors.push(`build-flags.json records testMocks:${flags.testMocks}, expected ${expected}.`);
  if (!existsSync(path.join(dir, 'index.html'))) errors.push('index.html is missing.');
  const files = walk(dir);
  // Only a bundle that both records and is expected to carry test mocks skips the denylist.
  const skip = expected && flags.testMocks;
  if (!skip) {
    for (const file of files) {
      if (file === 'img' || file.startsWith('img/')) findings.push({file, rule: 'fixture image directory img/'});
      if (file.endsWith('.map')) findings.push({file, rule: 'source map'});
      if (!TEXT.test(file)) continue;
      const text = readFileSync(path.join(dir, file), 'utf8');
      for (const entry of DENYLIST) if (text.includes(entry)) findings.push({file, rule: entry});
      for (const initials of avatarInitials(text))
        if (!PENDING_AVATAR_INITIALS.includes(initials)) findings.push({file, rule: `hard-coded avatar initials "${initials}"`});
        else pending.add(initials);
    }
  }
  return {ok: errors.length === 0 && findings.length === 0, testMocks: flags.testMocks, files: files.length, findings, errors, pendingAvatarInitials: [...pending].sort()};
}

function main(argv) {
  const args = argv.filter(arg => !arg.startsWith('--'));
  const flags = argv.filter(arg => arg.startsWith('--'));
  const unknown = flags.filter(flag => flag !== '--expect-test-mocks');
  if (args.length !== 1 || unknown.length) {
    console.error('Usage: node scripts/audit-production-bundle.mjs <dir> [--expect-test-mocks]');
    return 2;
  }
  const dir = path.resolve(args[0]);
  const result = auditWebBundle(dir, {testMocks: flags.includes('--expect-test-mocks')});
  for (const error of result.errors) console.error(`ERROR ${error}`);
  for (const finding of result.findings) console.error(`DENY ${finding.file}: ${finding.rule}`);
  if (result.pendingAvatarInitials?.length) console.warn(`PENDING hard-coded avatar initials ${result.pendingAvatarInitials.join(', ')} (platform-20; removed by the shell package)`);
  // Licence flags of the bundle's own notices are warnings (decision P-09); they never fail the audit.
  try { for (const line of licenceFlagLines(JSON.parse(readFileSync(path.join(dir, 'licenses', 'third-party-notices.json'), 'utf8')))) console.warn(line); }
  catch { /* a bundle without readable notices is reported by the APK checks, not here */ }
  // The one separately named font check. Reported, never failed here: a developer build may carry it.
  if (existsSync(dir)) { const fonts = fontLicenceFindings(dir); for (const row of [...fonts.unresolved, ...fonts.resolved]) console.warn(fontLicenceLine(row.message)); }
  if (result.ok) console.log(`PASS ${path.relative(process.cwd(), dir) || '.'}: ${result.files} files, testMocks=${result.testMocks}${result.testMocks ? ' (denylist skipped for an explicit test-mocks bundle)' : ', no mock, fixture or developer surfaces found'}.`);
  else console.error(`FAIL ${result.findings.length} denylist hit(s), ${result.errors.length} error(s).`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
