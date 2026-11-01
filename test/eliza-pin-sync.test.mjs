// The develop pin sync (scripts/eliza-pin-sync.mjs, .github/workflows/eliza-pin-sync.yml) moves
// only literal pin fields and writes the same source-only comparison a manual pin commit records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessDrift, buildInputAdmission, carryResidentDispositions, decide, embeddingReasonSentence, nextVoiceComparison,
  patchProblems, pinRecordProblems, renderBody, replaceOnce, requirementsNote, sha256, statusPinText,
} from '../scripts/eliza-pin-sync.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), E1 = '1'.repeat(40), E2 = '2'.repeat(40);

test('the committed records hold the pin where a repin expects it', () => {
  assert.deepEqual(pinRecordProblems(process.cwd()), []);
});

test('a pin field is replaced only when it occurs exactly once', () => {
  assert.equal(replaceOnce(`{"commit": "${A}"}`, `"commit": "${A}"`, `"commit": "${B}"`, 'lock'), `{"commit": "${B}"}`);
  assert.throws(() => replaceOnce(`"pin": "${A}", "pin": "${A}"`, `"pin": "${A}"`, 'x', 'twice'), /exactly one/);
  assert.throws(() => replaceOnce('{}', `"pin": "${A}"`, 'x', 'absent'), /exactly one/);
});

test('a patch stays at the old pin when its target changed or appeared upstream', () => {
  const manifest = {patches: [{file: 'p.patch', targets: [{path: 'kept', beforeSha256: sha256('kept')}, {path: 'added', beforeSha256: null}]}]};
  const files = new Map([['kept', Buffer.from('kept')]]);
  assert.deepEqual(patchProblems(manifest, file => files.get(file) ?? null), []);
  files.set('kept', Buffer.from('edited')).set('added', Buffer.from('upstream'));
  assert.deepEqual(patchProblems(manifest, file => files.get(file) ?? null), ['p.patch: kept changed upstream', 'p.patch: added now exists upstream']);
});

const ENGINE = 'plugins/plugin-local-inference/native/llama.cpp';
const previous = {
  inputs: [{path: ENGINE}, {path: 'native/jni'}, {path: 'consumer/android'}],
  embeddingInputs: {changedPaths: [ENGINE], unchangedPaths: ['native/jni/voice.cpp']},
  consumerAndroidModules: {changedPaths: [], unchangedPaths: ['consumer/android']},
  evidenceScope: 'Source-only comparison.',
};
// Two commits of a tiny upstream tree; `changed` moves the engine gitlink and one JNI source.
function fixtureTree(changed) {
  const entries = {
    [A]: {[ENGINE]: `160000 commit ${E1}`, 'native/jni/voice.cpp': '100644 blob 1', 'consumer/android/A.java': '100644 blob 2'},
    [B]: {[ENGINE]: `160000 commit ${changed ? E2 : E1}`, 'native/jni/voice.cpp': `100644 blob ${changed ? 3 : 1}`, 'consumer/android/A.java': '100644 blob 2'},
  };
  const under = (file, prefix) => file === prefix || file.startsWith(`${prefix}/`);
  const lsTree = (commit, prefix) => Buffer.from(Object.entries(entries[commit]).filter(([file]) => under(file, prefix)).map(([file, entry]) => `${entry}\t${file}\n`).join(''));
  const changedNames = (from, to, paths) => Object.keys(entries[to]).filter(file => paths.some(prefix => under(file, prefix)) && entries[from][file] !== entries[to][file]);
  return {lsTree, changedNames};
}

test('the build-input comparison records unchanged and changed native inputs', () => {
  const same = buildInputAdmission({previous, from: A, to: B, ...fixtureTree(false), requalificationRequired: true});
  assert.deepEqual(same.inputs.map(row => [row.path, row.entries, row.unchanged]), [[ENGINE, 1, true], ['native/jni', 1, true], ['consumer/android', 1, true]]);
  assert.equal(same.inputs[1].gitModeTypeBlobPathInventorySha256, sha256('100644 blob 1\tnative/jni/voice.cpp\n'));
  assert.deepEqual(same.changedPaths, []);
  assert.deepEqual(same.forkPins, {from: E1, to: E1});
  assert.deepEqual(same.embeddingInputs, {changedPaths: [], unchangedPaths: [ENGINE, 'native/jni/voice.cpp']});
  assert.match(same.note, /identical between aaaaaaaaaa and bbbbbbbbbb.*still required/);
  assert.match(embeddingReasonSentence(same, 'docs/evidence/x.json'), /^ The pin then moved to bbbbbbbbbb, which keeps the engine gitlink at 11111111 with no further embedding build input change \(docs\/evidence\/x\.json\), so the earlier statement still holds/);
  const moved = buildInputAdmission({previous, from: A, to: B, ...fixtureTree(true), requalificationRequired: true});
  assert.deepEqual(moved.changedPaths, [ENGINE, 'native/jni/voice.cpp']);
  assert.deepEqual(moved.forkPins, {from: E1, to: E2});
  assert.equal(moved.inputs[0].unchanged, false);
  assert.match(moved.note, /changed between aaaaaaaaaa and bbbbbbbbbb: .*llama\.cpp, native\/jni\/voice\.cpp\. The engine gitlink moves from 11111111 to 22222222\./);
  assert.match(embeddingReasonSentence(moved, 'e.json'), /moves the engine gitlink from 11111111 to 22222222 and changes voice\.cpp \(e\.json\)/);
});

test('the voice host comparison rolls into its history without the consumer modules', () => {
  const evidence = buildInputAdmission({previous, from: A, to: B, ...fixtureTree(true), requalificationRequired: true});
  const current = {priorAdmittedAt: C, comparedAt: A, admitted: false, requalificationRequired: true};
  const next = nextVoiceComparison({sourceComparisonHistory: [], currentSourceComparison: current, other: 1}, evidence, 'e.json');
  assert.deepEqual(next.sourceComparisonHistory, [current]);
  assert.equal(next.other, 1);
  assert.deepEqual(next.currentSourceComparison, {priorAdmittedAt: C, comparedAt: B, admitted: false, requalificationRequired: true, unchangedPaths: [], changedPaths: [ENGINE, 'native/jni/voice.cpp'], evidence: 'e.json', note: evidence.note, comparisonBase: A});
});

test('resident dispositions move only when the fresh audit reproduces every finding', () => {
  const snapshot = {upstreamCommit: A, inputSha256: 'f', packages: 2, counts: {high: 1}, findings: [{package: 'x'}]};
  const dispositions = {root: true, resident: {upstreamCommit: A, exceptions: [], sourceBinding: {priorUpstreamCommit: C}, sourceBindingHistory: []}};
  const carried = carryResidentDispositions(dispositions, snapshot, {...snapshot, upstreamCommit: B}, {from: A, to: B, date: '2026-11-01', lockUnchanged: true});
  assert.equal(carried.resident.upstreamCommit, B);
  assert.deepEqual(carried.resident.sourceBindingHistory, [{priorUpstreamCommit: C}]);
  assert.equal(carried.resident.sourceBinding.priorUpstreamCommit, A);
  assert.match(carried.resident.sourceBinding.note, /reproduces the same 2 package versions.*all 1 findings\. The upstream Bun lock is byte-identical/);
  assert.equal(carried.root, true);
  assert.equal(carryResidentDispositions(dispositions, snapshot, {...snapshot, upstreamCommit: B, findings: []}, {from: A, to: B, date: 'd'}), null);
  assert.equal(carryResidentDispositions(dispositions, snapshot, snapshot, {from: A, to: B, date: 'd'}), null, 'a snapshot not taken at the new pin');
});

test('the docs name the new pin and keep the reviewed history', () => {
  const evidence = {changedPaths: [], consumerAndroidModules: {changedPaths: []}, requalificationRequired: true};
  const note = requirementsNote('Old note.', {from: A, to: B, date: '2026-11-01', commits: 3, evidence, evidencePath: 'e.json'});
  assert.match(note, new RegExp(`^Current source pin ${B} is the recorded elizaOS/eliza develop head \\(2026-11-01; .*from aaaaaaaaaa \\(3 upstream commits\\)\\..*Previous source note: Old note\\.$`));
  const status = 'Current source projection: SDK `aaaaaaaaaa` is the recorded head. It adds things.\n\nThe current upstream source pin is `aaaaaaaaaa`; the preceding pins were `cccccccccc` and `dddddddddd`. Runtime results stay bound.\n';
  assert.equal(statusPinText(status, {from: A, to: B}), 'Source projection last reviewed at SDK `aaaaaaaaaa`, then the recorded head. It adds things.\n\nThe current upstream source pin is `bbbbbbbbbb`; the preceding pins were `aaaaaaaaaa` and `cccccccccc`. Runtime results stay bound.\n');
  assert.throws(() => statusPinText(status, {from: C, to: B}), /no current-pin sentence naming cccccccccc/);
});

test('the sync refreshes a stale or missing PR, waits on a young one and closes a superseded one', () => {
  const base = {pin: A, develop: B, main: C, pr: 7, event: 'schedule', now: Date.parse('2026-11-01T12:00:00Z'), refreshHours: 6};
  const bot = {pin: A, parent: C, date: '2026-11-01T10:00:00Z'};
  assert.equal(decide({...base, pin: B, pr: null}), 'none');
  assert.equal(decide({...base, pin: B}), 'close');
  assert.equal(decide({...base, bot: {...bot, pin: B}}), 'none', 'the PR already pins develop on this main');
  assert.equal(decide({...base, bot, pr: null}), 'refresh');
  assert.equal(decide({...base, bot}), 'wait');
  assert.equal(decide({...base, bot, event: 'repository_dispatch'}), 'wait', 'upstream pushes do not bypass the refresh interval');
  assert.equal(decide({...base, bot, event: 'workflow_dispatch'}), 'refresh');
  assert.equal(decide({...base, bot: {...bot, date: '2026-11-01T05:00:00Z'}}), 'refresh');
  assert.equal(assessDrift({behind: 51, staleDays: 0}, {commits: 50, days: 2}), true);
  assert.equal(assessDrift({behind: 5, staleDays: 2.1}, {commits: 50, days: 2}), true);
  assert.equal(assessDrift({behind: 50, staleDays: 2}, {commits: 50, days: 2}), false);
});

test('the PR body lists both pins, the compare, dropped commits and what needs a person', () => {
  const status = {behind: 3, pinOnly: 1, pinOnlyCommits: [{sha: C, subject: 'fix: only on the old pin'}], compareUrl: `https://github.com/elizaOS/eliza/compare/${A}...${B}`, thresholds: {refreshHours: 6}, botBranch: 'bot/eliza-pin-sync'};
  const report = {from: A, to: B, applied: ['Pin fields.'], needsPerson: ['Review the drop.'], checks: [{name: 'verify-upstream', ok: true, main: true, output: `Eliza source verified: ${B}`}, {name: 'Third-party notices', ok: false, main: true, output: 'stale'}]};
  const body = renderBody(status, report);
  for (const expected of [`New pin: \`${B}\``, `Old pin: \`${A}\``, status.compareUrl, '- `cccccccccc` fix: only on the old pin', '- Review the drop.', '| Third-party notices | pass | FAIL |', `Eliza source verified: ${B}`, 'Auto-merge is off', 'ELIZA_PIN_SYNC=off'])
    assert.ok(body.includes(expected), expected);
  assert.doesNotMatch(body, /\u2014/, 'no em dash in shipped copy');
});
