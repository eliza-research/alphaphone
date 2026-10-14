// Offline: checks the committed audit snapshot and reviewed dispositions against package-lock.json.
// The network audit itself is `node scripts/dependency-audit.mjs` (docs/dependency-audit.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  checkDispositions, dependencyPaths, loadAndCheck, normalizeAudit, sha256, DISPOSITIONS, LOCK, MAX_EXCEPTION_DAYS, REFRESH, SNAPSHOT,
} from '../scripts/dependency-audit.mjs';

const lockText = fs.readFileSync(LOCK, 'utf8');
const lock = JSON.parse(lockText);
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const dispositions = JSON.parse(fs.readFileSync(DISPOSITIONS, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const today = snapshot.auditedOn;
const check = (overrides = {}) => checkDispositions({snapshot, dispositions, lock, lockText, today, ...overrides});

test('the committed audit snapshot matches package-lock.json and every advisory path is dispositioned', () => {
  // Uses the real date: an exception past its reviewBy date fails here until it is re-reviewed.
  assert.deepEqual(loadAndCheck(), []);
  assert.equal(snapshot.lockSha256, sha256(lockText), `re-audit with: ${REFRESH}`);
  assert.equal(snapshot.counts.high + snapshot.counts.critical, 0, 'no high or critical advisory is carried as an exception');
});

test('a lockfile change makes the snapshot stale', () => {
  const problems = check({lockText: `${lockText}\n`});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /different package-lock\.json; re-audit with: node scripts\/dependency-audit\.mjs --write/);
});

test('an unrecorded high or critical advisory fails, as does a recorded advisory on a new path', () => {
  for (const severity of ['high', 'critical']) {
    const next = clone(snapshot);
    next.findings.push({
      package: 'left-pad', severity, direct: false, affectedRange: '*', via: ['left-pad'], fixAvailable: 'none',
      advisories: [{id: 'GHSA-xxxx-xxxx-xxxx', package: 'left-pad', severity, vulnerableRange: '*', title: 'synthetic', url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx'}],
      installed: [{location: 'node_modules/left-pad', version: '1.0.0', scope: 'production', paths: ['react > left-pad']}],
    });
    assert.ok(check({snapshot: next}).some(problem => problem.startsWith(`Unrecorded advisory: ${severity} GHSA-xxxx-xxxx-xxxx via left-pad`)), severity);
  }
  const moved = clone(snapshot);
  const uuid = moved.findings.find(finding => finding.package === 'uuid');
  uuid.installed[0].paths.push('react > uuid');
  uuid.installed[0].scope = 'production';
  const problems = check({snapshot: moved});
  assert.ok(problems.some(problem => problem.includes('reaches the tree through "react > uuid"')), problems.join('\n'));
  assert.ok(problems.some(problem => problem.includes('is a production dependency, but the exception was reviewed as dev-only')));
  const pulled = clone(snapshot);
  pulled.findings.push({...clone(uuid), package: 'other-consumer', installed: []});
  assert.ok(check({snapshot: pulled}).some(problem => problem.includes('via other-consumer is not among the packages reviewed')));
  const worse = clone(snapshot);
  for (const finding of worse.findings) for (const advisory of finding.advisories) advisory.severity = 'high';
  assert.ok(check({snapshot: worse}).some(problem => problem.includes('severity rose from the reviewed moderate to high')));
});

test('exceptions are time-bounded, justified and removed once the advisory is gone', () => {
  const [exception] = dispositions.exceptions;
  assert.ok(check({today: exception.reviewBy}).length === 0, 'valid through the reviewBy date');
  assert.ok(check({today: '2099-01-01'}).some(problem => problem.includes(`expired on ${exception.reviewBy}`)));
  const unbounded = clone(dispositions);
  unbounded.exceptions[0].reviewBy = '2030-01-01';
  assert.ok(check({dispositions: unbounded}).some(problem => problem.includes(`within ${MAX_EXCEPTION_DAYS} days`)));
  const bare = clone(dispositions);
  delete bare.exceptions[0].justification;
  bare.exceptions[0].reachability = '';
  const problems = check({dispositions: bare});
  assert.ok(problems.some(problem => problem.endsWith('missing justification')) && problems.some(problem => problem.endsWith('missing reachability')));
  assert.ok(check({snapshot: {...snapshot, findings: []}}).some(problem => problem.includes(`stale exception ${exception.advisory}`)));
});

test('a recorded fix cannot regress in the lockfile', () => {
  const [fix] = dispositions.fixes;
  assert.equal(fix.package, 'source-map-js');
  assert.deepEqual(check(), []);
  const regressed = clone(lock);
  regressed.packages['node_modules/source-map-js'].version = fix.from;
  const regressedText = JSON.stringify(regressed);
  const problems = checkDispositions({snapshot: {...snapshot, lockSha256: sha256(regressedText)}, dispositions, lock: regressed, lockText: regressedText, today});
  assert.deepEqual(problems, [`fix ${fix.advisory} regressed: node_modules/source-map-js is ${fix.from}, below ${fix.fixedIn}`]);
});

test('npm audit output is normalised to advisory ids and exact dependency paths', () => {
  assert.deepEqual(dependencyPaths(lock, 'node_modules/uuid'), ['@capacitor/cli > xcode > uuid']);
  assert.deepEqual(dependencyPaths(lock, 'node_modules/source-map-js'), [
    '@vitejs/plugin-react > vite > postcss > source-map-js',
    'jsdom > @asamuzakjp/dom-selector > css-tree > source-map-js',
    'jsdom > @bramus/specificity > css-tree > source-map-js',
    'jsdom > @csstools/css-syntax-patches-for-csstree > css-tree > source-map-js',
    'jsdom > css-tree > source-map-js',
    'vite > postcss > source-map-js',
  ]);
  const advisory = {source: 1, name: 'uuid', title: 't', url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq', severity: 'moderate', range: '<11.1.1'};
  const report = {vulnerabilities: {
    uuid: {name: 'uuid', severity: 'moderate', isDirect: false, via: [advisory], effects: ['xcode'], range: '<11.1.1', nodes: ['node_modules/uuid'], fixAvailable: {name: '@capacitor/cli', version: '8.4.3', isSemVerMajor: true}},
    xcode: {name: 'xcode', severity: 'moderate', isDirect: false, via: ['uuid'], effects: [], range: '>=0.9.2', nodes: ['node_modules/xcode'], fixAvailable: true},
  }};
  const normalised = normalizeAudit(report, lock, lockText);
  assert.deepEqual(normalised.counts, {info: 0, low: 0, moderate: 2, high: 0, critical: 0});
  const xcode = normalised.findings.find(finding => finding.package === 'xcode');
  assert.deepEqual(xcode.advisories.map(row => row.id), ['GHSA-w5hq-g745-h8pq'], 'a transitive finding resolves to its root advisory');
  assert.deepEqual(xcode.installed, [{location: 'node_modules/xcode', version: lock.packages['node_modules/xcode'].version, scope: 'dev', paths: ['@capacitor/cli > xcode']}]);
  assert.equal(normalised.findings.find(finding => finding.package === 'uuid').fixAvailable, '@capacitor/cli@8.4.3 (outside the declared range)');
  // Re-normalising the committed snapshot's own inputs is stable: same lock, same hash.
  assert.equal(normalised.lockSha256, snapshot.lockSha256);
});

test('docs/dependency-audit.md records every disposition', () => {
  const docs = fs.readFileSync('docs/dependency-audit.md', 'utf8');
  for (const item of [...dispositions.fixes, ...dispositions.exceptions]) assert.ok(docs.includes(item.advisory), item.advisory);
  for (const item of dispositions.exceptions) {
    assert.ok(docs.includes(item.reviewBy), `${item.advisory} review date`);
    for (const chain of item.paths) assert.ok(docs.includes(chain), chain);
  }
  assert.ok(docs.includes('node scripts/dependency-audit.mjs'));
});
