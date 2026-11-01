// The develop pin sync (scripts/eliza-pin-sync.mjs, .github/workflows/eliza-pin-sync.yml) moves
// only literal pin fields and writes the same source-only comparison a manual pin commit records.
// Its incident guard fails closed, and its receipts and drift report are checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CLEARANCE, HOLDS, ancestryClearance, assessDrift, buildInputAdmission, carryResidentDispositions, currentHold, decide,
  embeddingReasonSentence, incidentGuard, nextVoiceComparison, patchProblems, payloadFindings, pinRecordProblems,
  renderHold, renderReceipt, renderReport, renderReportComment, replaceOnce, reportPlan, reportState, requirementsNote,
  sha256, statusPinText,
} from '../scripts/eliza-pin-sync.mjs';
import {loadIocs} from '../scripts/owner/gh-readonly.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), E1 = '1'.repeat(40), E2 = '2'.repeat(40), D1 = 'd1'.repeat(20), D2 = 'd2'.repeat(20);

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

test('the sync refreshes a stale or missing PR, waits on a young one, closes a superseded one and holds on two', () => {
  const base = {pin: A, develop: B, main: C, prs: [7], event: 'schedule', now: Date.parse('2026-11-01T12:00:00Z'), refreshHours: 6};
  const bot = {pin: A, parent: C, date: '2026-11-01T10:00:00Z'};
  assert.equal(decide({...base, pin: B, prs: []}), 'none');
  assert.equal(decide({...base, pin: B}), 'close');
  assert.equal(decide({...base, bot: {...bot, pin: B}}), 'none', 'the PR already pins develop on this main');
  assert.equal(decide({...base, bot, prs: []}), 'refresh');
  for (const event of ['schedule', 'workflow_dispatch']) assert.equal(decide({...base, bot, event, prs: [7, 8]}), 'hold', 'two open pin PRs: touch neither');
  assert.equal(decide({...base, bot}), 'wait');
  assert.equal(decide({...base, bot, event: 'repository_dispatch'}), 'wait', 'upstream pushes do not bypass the refresh interval');
  assert.equal(decide({...base, bot, event: 'workflow_dispatch'}), 'refresh');
  assert.equal(decide({...base, bot: {...bot, date: '2026-11-01T05:00:00Z'}}), 'refresh');
  assert.equal(assessDrift({behind: 51, staleDays: 0}, {commits: 50, days: 2}), true);
  assert.equal(assessDrift({behind: 5, staleDays: 2.1}, {commits: 50, days: 2}), true);
  assert.equal(assessDrift({behind: 50, staleDays: 2}, {commits: 50, days: 2}), false);
});

// The incident guard: a status in which develop moved three commits past the pin.
const iocs = loadIocs();
const status = {upstream: 'elizaOS/eliza', main: C, pin: A, develop: B, behind: 3, pinOnly: 0, observedAt: '2026-11-01T14:41:07Z', staleSince: '2026-10-31T09:00:00Z', staleDays: 1.2, drift: false,
  compareUrl: `https://github.com/elizaOS/eliza/compare/${A}...${B}`, thresholds: {commits: 50, days: 2, refreshHours: 6}, botBranch: 'bot/eliza-pin-sync', run: 'https://github.com/eliza-research/alphaphone/actions/runs/7'};
const cleared = {repositories: {'elizaOS/eliza': {forgedCommits: [C], record: 'issue #658 comment 1'}}};
const lineage = {ancestors: [B, D1, D2, A], included: [{sha: D1, subject: 'feat: one'}, {sha: D2, subject: 'fix: @someone two'}, {sha: B, subject: 'chore: three'}], dropped: []};
const intake = {raw: [{oldMode: '100644', newMode: '100644', status: 'M', path: 'packages/app/src/a.ts'}], patch: 'diff --git a/packages/app/src/a.ts b/packages/app/src/a.ts\n--- a/packages/app/src/a.ts\n+++ b/packages/app/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n', readAt: () => null};
const never = () => { throw new Error('read upstream before clearance'); };
const sources = (history = lineage, change = intake) => ({history: () => history, intake: () => change});

test('the incident guard fails closed and reports the specific hold while ancestry clearance is unavailable', () => {
  // Every committed entry is a full forged-commit set with its record; without one the sync holds before it reads develop.
  for (const [repository, entry] of Object.entries(JSON.parse(fs.readFileSync(CLEARANCE, 'utf8')).repositories))
    assert.equal(ancestryClearance({repositories: {[repository]: entry}}, iocs, repository).problem, undefined, repository);
  const held = incidentGuard(status, {clearance: {repositories: {}}, iocs, sources: {history: never, intake: never}});
  assert.equal(held.cleared, false);
  assert.equal(held.hold, 'ancestry-unavailable');
  assert.ok(held.reason.startsWith(`${HOLDS['ancestry-unavailable']}: ${CLEARANCE} records no reviewed forged-commit set for elizaOS/eliza, and the 2026-10-27 incident record (scripts/owner/incident-2026-10-27-iocs.json) does not cover it.`), held.reason);
  assert.match(held.reason, /Commit author or committer identity is not clearance\.$/);
  // Author identity is never clearance: a record that names trusted authors instead of a forged set still holds.
  for (const entry of [{trustedAuthors: ['github-actions[bot]', 'shawmakesmagic']}, {forgedCommits: null, record: 'x'}, {forgedCommits: ['39ef59401'], record: 'x'}, {forgedCommits: [], record: ''}])
    assert.equal(incidentGuard(status, {clearance: {repositories: {'elizaOS/eliza': entry}}, iocs, sources: {history: never, intake: never}}).hold, 'ancestry-unavailable', JSON.stringify(entry));
  // A history or tree read that fails is a hold, never a clearance.
  const broken = () => { throw new Error('fatal: remote error: upload-pack: not our ref'); };
  assert.equal(incidentGuard(status, {clearance: cleared, iocs, sources: {history: broken, intake: never}}).hold, 'ancestry-unavailable');
  assert.equal(incidentGuard(status, {clearance: cleared, iocs, sources: {history: () => lineage, intake: broken}}).hold, 'payload-unavailable');
});

test('the incident guard holds on forged ancestry, a receipt mismatch, a nested repository move and payload markers', () => {
  const reaches = incidentGuard(status, {clearance: cleared, iocs, sources: sources({...lineage, ancestors: [...lineage.ancestors, C]})});
  assert.equal(reaches.hold, 'reaches-forged');
  assert.match(reaches.reason, /develop bbbbbbbbbb reaches cccccccccc\./);
  // The IOC file's short forged IDs count too, for a repository the record covers.
  assert.deepEqual(ancestryClearance({repositories: {'eliza-research/alphaphone': {forgedCommits: [], record: 'r'}}}, iocs, 'eliza-research/alphaphone').forged.slice(0, 2), iocs.branches.filter(row => row.repo === 'alphaphone').map(row => row.forged).slice(0, 2));
  assert.equal(incidentGuard({...status, behind: 4}, {clearance: cleared, iocs, sources: sources()}).hold, 'receipt-mismatch');
  const engine = {...intake, raw: [...intake.raw, {oldMode: '160000', newMode: '160000', status: 'M', path: 'plugins/plugin-local-inference/native/llama.cpp'}]};
  const nested = incidentGuard(status, {clearance: cleared, iocs, sources: sources(lineage, engine)});
  assert.equal(nested.hold, 'nested-repository');
  assert.match(nested.reason, /llama\.cpp moves\. The guard does not clear another repository's ancestry/);
  const payload = {
    raw: [{status: 'A', path: 'init'}, {status: 'M', path: 'packages/app/package.json'}, {status: 'A', path: 'packages/app/.vscode/tasks.json'}, {status: 'D', path: '.env'}],
    patch: 'diff --git a/packages/app/.vscode/tasks.json b/packages/app/.vscode/tasks.json\n+++ b/packages/app/.vscode/tasks.json\n@@ -0,0 +1 @@\n+  "runOn": "folderOpen"\n',
    readAt: (commit, file) => (commit === B ? '{"scripts":{"build":"node init && vite build","test":"node --test"}}' : '{"scripts":{"test":"node --test"}}'),
  };
  assert.deepEqual(payloadFindings(payload, iocs.markers, {from: A, to: B}), ['marker path init', 'packages/app/package.json script "build" runs init', 'packages/app/.vscode/tasks.json adds a line matching /"runOn"\\s*:\\s*"folderOpen"/']);
  assert.equal(incidentGuard(status, {clearance: cleared, iocs, sources: sources(lineage, {...payload, raw: payload.raw.map(row => ({oldMode: '100644', newMode: '100644', ...row}))})}).hold, 'payload-marker');
  // A script that already ran init at the old pin is not new intake; a deleted marker path is not added.
  assert.deepEqual(payloadFindings({raw: [{status: 'M', path: 'package.json'}, {status: 'D', path: '.env'}], patch: '', readAt: () => '{"scripts":{"x":"node init"}}'}, iocs.markers, {from: A, to: B}), []);
  for (const hold of [reaches, nested]) assert.doesNotMatch(renderHold(status, hold), /\u2014/);
  assert.match(renderHold(status, reaches), /^### Eliza develop pin sync: held\n\n {4}Held: develop reaches/);
});

test('a cleared guard records exact source identities and the inclusion and drift receipts', () => {
  const guard = incidentGuard(status, {clearance: cleared, iocs, sources: sources()});
  assert.equal(guard.cleared, true);
  const body = renderReceipt(status, guard);
  for (const expected of [
    `| \`develop\` head, read 2026-11-01T14:41:07Z | \`${B}\` |`, `| Old pin (\`upstream.lock.json\` on \`main\`) | \`${A}\` |`,
    `| New pin (\`upstream.lock.json\` and the \`vendor/eliza\` gitlink) | \`${B}\` |`, `| \`main\`, the base of this PR | \`${C}\` |`, status.compareUrl,
    `records 1 forged commit for elizaOS/eliza (issue #658 comment 1), and none of them is among the 4 commits develop reaches`, 'Commit author and committer identity played no part.',
    `- Included: 3 commits on develop that the old pin lacks; list SHA-256 \`${sha256(`${D1}\n${D2}\n${B}\n`)}\` (\`git rev-list --reverse aaaaaaaaaa..bbbbbbbbbb | sha256sum\`).`,
    `- Dropped: 0 commits on the old pin that develop lacks; list SHA-256 \`${sha256('')}\``,
    `${D2} fix: @someone two`, '- Thresholds: 50 commits or 2 days; drift is within them.', `- Read 2026-11-01T14:41:07Z by ${status.run}.`,
    'This PR never merges itself and updates no running app', 'ELIZA_PIN_SYNC=off',
  ]) assert.ok(body.includes(expected), expected);
  // Upstream commit subjects appear only inside a text fence, after their commit ID.
  const fenced = body.split('```text\n')[1].split('\n```')[0].split('\n');
  assert.deepEqual(fenced.map(line => line.slice(0, 40)), [D1, D2, B]);
  assert.equal(body.split('\n').filter(line => line.includes('@someone')).length, 1);
  const dropped = renderReceipt({...status, pinOnly: 1}, {...guard, dropped: [{sha: E1, subject: 'only on the old pin'}]});
  assert.match(dropped, /> \[!WARNING\]\n> The current pin is not on develop; this PR drops 1 commit:\n\n```text\n1{40} only on the old pin\n```/);
  assert.doesNotMatch(body, /\u2014|auto-merge|automerge/i, 'no em dash and no auto-merge in the body');
});

test('the repin report lists what needs a person and the checks', () => {
  const report = {from: A, to: B, date: '2026-11-01', applied: ['Pin fields.'], needsPerson: ['Review the drop.'], checks: [{name: 'verify-upstream', ok: true, main: true, output: `Eliza source verified: ${B}`}, {name: 'Third-party notices', ok: false, main: true, output: 'stale'}]};
  const body = renderReport(report);
  for (const expected of [`Repin of \`${A}\` to \`${B}\` on 2026-11-01.`, '- Review the drop.', '- Pin fields.', '| Third-party notices | pass | FAIL |', `Eliza source verified: ${B}`, '<summary>Third-party notices output</summary>'])
    assert.ok(body.includes(expected), expected);
  assert.doesNotMatch(body, /\u2014/, 'no em dash in shipped copy');
});

test('drift and holds update one durable report, and only when that state changes', () => {
  const drift = {...status, drift: true, behind: 60};
  assert.deepEqual(reportPlan([], {drift: false, hold: ''}), {action: 'none'}, 'nothing to say: no comment');
  assert.deepEqual(reportPlan([], {drift: true, hold: ''}), {action: 'create'});
  assert.deepEqual(reportPlan([], {drift: false, hold: 'ancestry-unavailable'}), {action: 'create'});
  const existing = [{id: 11, state: reportState({drift: true, hold: 'ancestry-unavailable'})}, {id: 12, state: 'drift=within;hold=none'}];
  assert.deepEqual(reportPlan(existing, {drift: true, hold: 'ancestry-unavailable'}), {action: 'none'}, 'a lasting state edits nothing');
  assert.deepEqual(reportPlan(existing, {drift: true, hold: ''}), {action: 'edit', id: 11}, 'only the first report comment is ever edited');
  assert.deepEqual(reportPlan(existing, {drift: false, hold: 'ancestry-unavailable'}), {action: 'edit', id: 11});
  // A run that did not reach the guard keeps the last reported hold; a cleared guard or a current main drops it.
  assert.equal(currentHold({action: 'wait'}, {}, 'drift=over;hold=payload-marker'), 'payload-marker');
  assert.equal(currentHold({action: 'wait'}, {}, undefined), '');
  assert.equal(currentHold({action: 'refresh'}, {cleared: 'true', hold: ''}, 'drift=over;hold=payload-marker'), '');
  assert.equal(currentHold({action: 'refresh'}, {cleared: 'false', hold: 'ancestry-unavailable'}, ''), 'ancestry-unavailable');
  assert.equal(currentHold({action: 'refresh'}, {cleared: '', hold: ''}, ''), 'guard-error', 'a guard that reported nothing is a hold');
  assert.equal(currentHold({action: 'hold', hold: 'multiple-prs'}, {}, ''), 'multiple-prs');
  for (const action of ['none', 'close']) assert.equal(currentHold({action}, {}, 'drift=over;hold=payload-marker'), '');
  const comment = renderReportComment(drift, {drift: true, hold: 'ancestry-unavailable'}, `${HOLDS['ancestry-unavailable']}: none recorded.`);
  assert.ok(comment.startsWith('<!-- eliza-pin-sync:report state:drift=over;hold=ancestry-unavailable -->\n'));
  assert.match(comment, /- Drift: over the threshold \(more than 50 commits or 2 days\)\. `main` pins `aaaaaaaaaa`, 60 commits behind develop `bbbbbbbbbb`/);
  assert.match(comment, /- Hold: `ancestry-unavailable`:\n\n {6}Held: incident ancestry clearance is unavailable: none recorded\./);
  assert.doesNotMatch(comment, /\u2014|Updated/);
  assert.match(renderReportComment(status, {drift: false, hold: 'payload-marker'}, ''), /- Hold: `payload-marker`, unchanged since an earlier run\./);
});
