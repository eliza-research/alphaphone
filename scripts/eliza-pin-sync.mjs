// Keeps Alpha's elizaOS pin on `develop`: the mechanical part of a manual "Pin Eliza develop
// <short>" commit. Each record is refreshed by the script that already owns it; this file only
// moves the literal pin fields, writes the source-only build-input comparison and reports what
// still needs a person. Run by .github/workflows/eliza-pin-sync.yml (docs/ci-cost-policy.md,
// "Eliza develop pin sync").
//
//   node scripts/eliza-pin-sync.mjs status [--event <name>] [--bot-branch <branch>] [--main <sha>]
//                                                                                     read-only (gh api)
//   node scripts/eliza-pin-sync.mjs apply --to <sha> [--status <file>] [--report <file>]
//        [--vendor <git dir>] [--skip-scripts]                                      edits this checkout
//   node scripts/eliza-pin-sync.mjs body --status <file> --report <file>               PR body on stdout
//   node scripts/eliza-pin-sync.mjs drift-comment --status <file> --issue <number>     needs issues: write
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[0-9a-f]{40}$/;
const ENGINE = 'plugins/plugin-local-inference/native/llama.cpp';
const DRIFT_MARKER = '<!-- eliza-pin-sync:drift -->';
export const RECORDS = {
  lock: 'upstream.lock.json',
  voiceHost: 'android/voice-host/qualified-voice-host.json',
  embeddingHost: 'android/embedding-host/qualified-host.json',
  nativePatches: 'patches/eliza/native-manifest.json',
  clientPatches: 'patches/eliza/cloud-speech-client-manifest.json',
  mobileUuid: 'patches/eliza/mobile-uuid-build.json',
  calendarBridge: 'scripts/ci/calendar-bridge.py',
  inventory: 'docs/mvp-remaining-work-2026-10-09.json',
  requirements: 'docs/requirements.json',
  status: 'docs/mvp-current-status.md',
  snapshot: 'docs/dependency-audit.snapshot.json',
  dispositions: 'docs/dependency-audit.dispositions.json',
};
// Fields that hold nothing but the current pin. Patch manifests are moved only after their
// targets are confirmed unchanged at the new pin (see patchProblems).
const PLAIN_PIN_FIELDS = [[RECORDS.lock, 'commit'], [RECORDS.inventory, 'upstream_pin'], [RECORDS.voiceHost, 'pin']];

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const short = commit => String(commit).slice(0, 10);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const engineShort = commit => String(commit).slice(0, 8);
const list = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (root, file) => JSON.parse(read(root, file));
const upstreamRepository = url => new URL(url).pathname.replace(/^\//, '').replace(/\.git$/, '');

/** Replace the one occurrence of `before`, keeping every other byte of the file. */
export function replaceOnce(text, before, after, label) {
  const at = text.indexOf(before);
  if (at < 0 || text.indexOf(before, at + 1) >= 0) throw new Error(`${label}: expected exactly one ${before}`);
  return text.slice(0, at) + after + text.slice(at + before.length);
}

function setPinField(root, file, key, from, to) {
  fs.writeFileSync(path.join(root, file), replaceOnce(read(root, file), `"${key}": "${from}"`, `"${key}": "${to}"`, file));
}

// The records are written by JSON.stringify(value, null, 2); refuse to reformat one that is not.
function editJson(root, file, edit) {
  const text = read(root, file);
  const value = JSON.parse(text);
  if (`${JSON.stringify(value, null, 2)}\n` !== text) throw new Error(`${file} is not in its generated JSON form`);
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(edit(value), null, 2)}\n`);
}

/** Patch targets whose recorded pre-image no longer matches the file at the new pin. */
export function patchProblems(manifest, readAt) {
  const problems = [];
  for (const patch of manifest.patches ?? [])
    for (const target of patch.targets ?? []) {
      const bytes = readAt(target.path);
      const ok = target.beforeSha256 === null ? bytes === null : bytes !== null && sha256(bytes) === target.beforeSha256;
      if (!ok) problems.push(`${patch.file}: ${target.path} ${target.beforeSha256 === null ? 'now exists upstream' : 'changed upstream'}`);
    }
  return problems;
}

/**
 * The same source-only comparison the manual pin commits record in
 * docs/evidence/sdk-<short>-build-input-admission-<date>.json, over the previous record's paths.
 */
export function buildInputAdmission({previous, from, to, lsTree, changedNames, requalificationRequired}) {
  const paths = previous.inputs.map(row => row.path);
  const inputs = paths.map(file => {
    const before = lsTree(from, file), after = lsTree(to, file);
    return {path: file, entries: after.toString('utf8').split('\n').filter(Boolean).length, gitModeTypeBlobPathInventorySha256: sha256(after), unchanged: before.equals(after)};
  });
  const classify = group => {
    const all = [...group.changedPaths, ...group.unchangedPaths];
    const changed = all.filter(file => changedNames(from, to, [file]).length > 0);
    return {changedPaths: changed, unchangedPaths: all.filter(file => !changed.includes(file))};
  };
  const engine = commit => lsTree(commit, ENGINE).toString('utf8').match(/^160000 commit ([0-9a-f]{40})\t/)?.[1] ?? null;
  const record = {
    from, to, inputs,
    changedPaths: changedNames(from, to, paths),
    forkPins: {from: engine(from), to: engine(to)},
    embeddingInputs: classify(previous.embeddingInputs),
    consumerAndroidModules: classify(previous.consumerAndroidModules),
    command: `git -C vendor/eliza ls-tree -r <commit> -- <path> | sha256sum; git -C vendor/eliza diff --name-only ${from} ${to} -- <paths>`,
    evidenceScope: previous.evidenceScope,
    qualificationTransferred: false,
    admitted: false,
    requalificationRequired,
  };
  const consumers = record.consumerAndroidModules.changedPaths;
  const engineMove = record.forkPins.from === record.forkPins.to ? '' : ` The engine gitlink moves from ${engineShort(record.forkPins.from)} to ${engineShort(record.forkPins.to)}.`;
  record.note = (record.changedPaths.length || consumers.length
    ? `Listed native build inputs changed between ${short(from)} and ${short(to)}: ${[...record.changedPaths, ...consumers].join(', ')}.${engineMove}`
    : `The native engine gitlink (${engineShort(record.forkPins.to)}), every listed native build input and every consumer Android module are identical between ${short(from)} and ${short(to)}.`)
    + (requalificationRequired ? ' The recorded engine, embedding host and voice bytes remain unadmitted; fresh native builds and on-device requalification are still required.' : '')
    + ' No historic qualification transfers. Generated by scripts/eliza-pin-sync.mjs.';
  return record;
}

/** Roll the voice host's current comparison into its history, as the manual pin commits do. */
export function nextVoiceComparison(admission, evidence, evidencePath) {
  const consumers = new Set([...evidence.consumerAndroidModules.changedPaths, ...evidence.consumerAndroidModules.unchangedPaths]);
  const current = admission.currentSourceComparison;
  return {
    ...admission,
    currentSourceComparison: {
      priorAdmittedAt: current.priorAdmittedAt,
      comparedAt: evidence.to,
      admitted: false,
      requalificationRequired: true,
      unchangedPaths: evidence.inputs.filter(row => row.unchanged && !consumers.has(row.path)).map(row => row.path),
      changedPaths: evidence.changedPaths.filter(file => ![...consumers].some(module => file === module || file.startsWith(`${module}/`))),
      evidence: evidencePath,
      note: evidence.note,
      comparisonBase: evidence.from,
    },
    sourceComparisonHistory: [...admission.sourceComparisonHistory, current],
  };
}

/** The sentence the manual commits append to the embedding host's open requalification reason. */
export function embeddingReasonSentence(evidence, evidencePath) {
  const files = evidence.embeddingInputs.changedPaths.filter(file => file !== ENGINE).map(file => path.posix.basename(file));
  const moved = evidence.forkPins.from !== evidence.forkPins.to;
  const engine = moved ? `moves the engine gitlink from ${engineShort(evidence.forkPins.from)} to ${engineShort(evidence.forkPins.to)}` : `keeps the engine gitlink at ${engineShort(evidence.forkPins.to)}`;
  const inputs = files.length ? ` and changes ${list(files)}` : moved ? '' : ' with no further embedding build input change';
  return ` The pin then moved to ${short(evidence.to)}, which ${engine}${inputs} (${evidencePath}), so the earlier statement still holds: nothing was built or run at this pin.`;
}

/**
 * Carry the resident dispositions to the new pin only when the fresh audit reproduces the same
 * package set and findings; anything new stays for a person to review (null).
 */
export function carryResidentDispositions(dispositions, before, after, {from, to, date, lockUnchanged}) {
  const resident = dispositions.resident;
  const same = ['inputSha256', 'packages', 'counts', 'findings'].every(key => JSON.stringify(before?.[key]) === JSON.stringify(after?.[key]));
  if (!same || resident.upstreamCommit !== from || after.upstreamCommit !== to) return null;
  const note = `Fresh npm bulk advisory query at ${to} on ${date} reproduces the same ${after.packages} package versions, normalized input SHA-256 ${after.inputSha256} and all ${after.findings.length} findings. `
    + (lockUnchanged ? `The upstream Bun lock is byte-identical to ${from}. ` : `The upstream Bun lock changed from ${from} without changing the audited package set. `)
    + 'Existing exceptions, review and expiration dates, pending upstream fixes, historical shipped-set evidence and unknown current packaged reachability remain unchanged. This advances only the source binding, not security or release acceptance. Recorded by scripts/eliza-pin-sync.mjs.';
  return {...dispositions, resident: {...resident, upstreamCommit: to, sourceBinding: {priorUpstreamCommit: from, evidence: RECORDS.snapshot, note}, sourceBindingHistory: [...resident.sourceBindingHistory, resident.sourceBinding]}};
}

/** docs/requirements.json keeps every earlier note behind "Previous source note:". */
export function requirementsNote(previous, {from, to, date, commits, evidence, evidencePath}) {
  const changed = [...evidence.changedPaths, ...evidence.consumerAndroidModules.changedPaths];
  const native = changed.length ? `Native build inputs changed: ${changed.join(', ')} (${evidencePath}).` : `Native engine/model/JNI inputs are unchanged from ${short(from)} (${evidencePath}).`;
  const qualification = evidence.requalificationRequired ? 'existing native requalification remains required, and historical' : 'historical';
  return `Current source pin ${to} is the recorded elizaOS/eliza develop head (${date}; scripts/ci/upstream-reachability.json), applied by the develop pin sync from ${short(from)} (${plural(commits, 'upstream commit')}). ${native} This is source metadata only: ${qualification} runtime, APK and device results do not transfer. Previous source note: ${previous}`;
}

/** docs/mvp-current-status.md names the current pin; the reviewed projection paragraph keeps its own SDK. */
export function statusPinText(markdown, {from, to}) {
  const sentence = /The current upstream source pin is `([0-9a-f]{10})`; the preceding pins? (?:was|were) `([0-9a-f]{10})`[^.\n]*\./;
  const match = markdown.match(sentence);
  if (!match || match[1] !== short(from)) throw new Error(`${RECORDS.status}: no current-pin sentence naming ${short(from)}`);
  return markdown
    .replace(sentence, `The current upstream source pin is \`${short(to)}\`; the preceding pins were \`${short(from)}\` and \`${match[2]}\`.`)
    .replace(`Current source projection: SDK \`${short(from)}\` is the recorded`, `Source projection last reviewed at SDK \`${short(from)}\`, then the recorded`);
}

/** What a repin from the current pin relies on; the committed tree must keep these true (test/eliza-pin-sync.test.mjs). */
export function pinRecordProblems(root) {
  const pin = readJson(root, RECORDS.lock).commit;
  const problems = [];
  const once = (file, needle) => {
    const count = read(root, file).split(needle).length - 1;
    if (count !== 1) problems.push(`${file}: expected one ${needle}, found ${count}`);
  };
  for (const [file, key] of [...PLAIN_PIN_FIELDS, [RECORDS.nativePatches, 'baseCommit'], [RECORDS.clientPatches, 'baseCommit'], [RECORDS.mobileUuid, 'baseCommit']]) once(file, `"${key}": "${pin}"`);
  once(RECORDS.calendarBridge, `SDK = '${pin}'`);
  const requalification = readJson(root, RECORDS.embeddingHost).requalification;
  if (requalification?.required === true && requalification.atPin !== pin) problems.push(`${RECORDS.embeddingHost}: the open requalification names ${requalification.atPin}, not the pin`);
  const evidence = readJson(root, RECORDS.voiceHost).sourceAdmission?.currentSourceComparison?.evidence;
  const previous = evidence && fs.existsSync(path.join(root, evidence)) ? readJson(root, evidence) : null;
  if (!Array.isArray(previous?.inputs) || !previous.embeddingInputs || !previous.consumerAndroidModules) problems.push(`${RECORDS.voiceHost}: the current source comparison names no build-input evidence with inputs, embedding inputs and consumer modules`);
  try { statusPinText(read(root, RECORDS.status), {from: pin, to: pin}); } catch (error) { problems.push(error.message); }
  return problems;
}

export function assessDrift({behind, staleDays}, {commits, days}) {
  return behind > commits || staleDays > days;
}

/** none: nothing to do; close: main is current and a bot PR is left; refresh: rebuild the PR; wait: refresh later. */
export function decide({pin, develop, main, bot, pr, event, now, refreshHours}) {
  if (pin === develop) return pr ? 'close' : 'none';
  if (bot && bot.pin === develop && bot.parent === main) return 'none';
  // Only a person dispatching the workflow skips the refresh interval; each refresh can dispatch full CI.
  if (!pr || !bot || event === 'workflow_dispatch') return 'refresh';
  return (now - Date.parse(bot.date)) / 3600000 >= refreshHours ? 'refresh' : 'wait';
}

function gh(args, {allowMissing = false} = {}) {
  const result = spawnSync('gh', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (result.status === 0) return result.stdout;
  if (allowMissing && /HTTP 404/.test(result.stderr)) return null;
  throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`);
}
// gh prints a string result of --jq raw and any other result as JSON.
const ghText = (route, jq, options) => gh(['api', route, '--jq', jq], options)?.trim() ?? null;
const ghJson = (route, jq, options) => {
  const output = ghText(route, jq, options);
  return output === null ? null : JSON.parse(output);
};
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();
const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

function status({root, repository, botBranch, event, main = git(root, 'rev-parse', 'HEAD'), env, now = Date.now()}) {
  const lock = readJson(root, RECORDS.lock);
  const upstream = upstreamRepository(lock.url);
  const pin = lock.commit;
  const develop = ghText(`repos/${upstream}/branches/develop`, '.commit.sha');
  if (![pin, develop, main].every(commit => SHA.test(commit))) throw new Error('Expected full main, pin and develop commit IDs');
  const compare = pin === develop ? {ahead_by: 0, behind_by: 0, dates: []}
    : ghJson(`repos/${upstream}/compare/${pin}...${develop}`, '{ahead_by,behind_by,dates:[.commits[].commit.committer.date]}');
  const pinOnlyCommits = compare.behind_by
    ? ghJson(`repos/${upstream}/compare/${develop}...${pin}`, '[.commits[]|select((.parents|length)==1)|{sha,subject:(.commit.message|split("\\n")[0])}]')
    : [];
  const staleSince = compare.dates.length ? compare.dates.reduce((a, b) => (a < b ? a : b)) : null;
  const thresholds = {commits: positive(env.ELIZA_PIN_SYNC_DRIFT_COMMITS, 50), days: positive(env.ELIZA_PIN_SYNC_DRIFT_DAYS, 2), refreshHours: positive(env.ELIZA_PIN_SYNC_REFRESH_HOURS, 6)};
  const result = {
    repository, upstream, main, pin, develop,
    behind: compare.ahead_by, pinOnly: compare.behind_by, pinOnlyCommits, staleSince,
    staleDays: staleSince ? Math.floor((now - Date.parse(staleSince)) / 8640000) / 10 : 0,
    compareUrl: `https://github.com/${upstream}/compare/${pin}...${develop}`,
    thresholds, botBranch,
  };
  result.drift = assessDrift(result, thresholds);
  const branch = ghJson(`repos/${repository}/branches/${botBranch}`, '{head:.commit.sha,parent:.commit.parents[0].sha,date:.commit.commit.committer.date}', {allowMissing: true});
  if (branch) {
    const content = ghText(`repos/${repository}/contents/${RECORDS.lock}?ref=${branch.head}`, '.content');
    branch.pin = JSON.parse(Buffer.from(content, 'base64').toString('utf8')).commit;
  }
  result.bot = branch;
  const owner = repository.split('/')[0];
  result.pr = ghJson(`repos/${repository}/pulls?state=open&head=${owner}:${botBranch}`, '[.[].number]')[0] ?? null;
  result.action = decide({...result, event, now, refreshHours: thresholds.refreshHours});
  return result;
}

function statusSummary(s) {
  const lines = [`### Eliza develop pin: ${s.action}`, '',
    `- main pin \`${short(s.pin)}\`, develop \`${short(s.develop)}\`: ${plural(s.behind, 'commit')} behind${s.staleSince ? ` since ${s.staleSince}` : ''} (${s.compareUrl})`,
    `- pin-only commits that a develop pin drops: ${s.pinOnly}`,
    `- bot PR: ${s.pr ? `#${s.pr}` : 'none'}; bot branch ${s.bot ? `pins \`${short(s.bot.pin)}\` on main \`${short(s.bot.parent)}\`` : 'absent'}`];
  if (s.drift) lines.push('', `**Drift:** the main pin is over ${s.thresholds.commits} commits or ${s.thresholds.days} days behind develop.`);
  return `${lines.join('\n')}\n`;
}

function apply({root, to, vendor, skipScripts, statusFile, date = new Date().toISOString().slice(0, 10)}) {
  if (!SHA.test(to)) throw new Error('--to needs a full commit ID');
  const lock = readJson(root, RECORDS.lock);
  const from = lock.commit;
  if (from === to) throw new Error(`${RECORDS.lock} already pins ${to}`);
  const recordProblems = pinRecordProblems(root);
  if (recordProblems.length) throw new Error(`main's pin records disagree; fix them before a repin:\n${recordProblems.join('\n')}`);
  const state = statusFile ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
  const report = {from, to, date, upstream: upstreamRepository(lock.url), applied: [], needsPerson: [], checks: [], ready: false};
  const need = problem => report.needsPerson.push(problem);
  if (state && state.pin !== from) throw new Error(`Status was taken at pin ${state.pin}, but ${RECORDS.lock} pins ${from}`);
  if (state?.pinOnly) need(`The current pin carries ${plural(state.pinOnly, 'commit')} that develop does not; this PR would drop them (listed above).`);
  const vendorGit = (...args) => execFileSync('git', ['-C', vendor, ...args], {maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  // A path absent at the new pin reads as null (a patch addition target must be absent).
  const readAt = file => { try { return vendorGit('cat-file', 'blob', `${to}:${file}`); } catch { return null; } };
  const lsTree = (commit, file) => vendorGit('ls-tree', '-r', commit, '--', file);
  const changedNames = (a, b, files) => vendorGit('diff', '--name-only', a, b, '--', ...files).toString('utf8').split('\n').filter(Boolean);
  for (const commit of [from, to]) vendorGit('cat-file', '-e', `${commit}^{commit}`);
  const node = (name, ...args) => {
    const result = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    return {name, command: `node ${args.join(' ')}`, ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()};
  };
  const runChecks = () => CHECKS.map(([name, ...args]) => node(name, ...args));
  // The same checks on main first: only a check that passes there and fails at the new pin blocks the PR.
  let baseline = [];
  if (!skipScripts) {
    vendorGit('checkout', '-q', '--detach', from);
    baseline = runChecks();
    vendorGit('checkout', '-q', '--detach', to);
  }

  for (const [file, key] of PLAIN_PIN_FIELDS) setPinField(root, file, key, from, to);
  fs.writeFileSync(path.join(root, RECORDS.calendarBridge), replaceOnce(read(root, RECORDS.calendarBridge), `SDK = '${from}'`, `SDK = '${to}'`, RECORDS.calendarBridge));
  report.applied.push(`Pin fields: ${[...PLAIN_PIN_FIELDS.map(([file]) => file), RECORDS.calendarBridge].join(', ')}, and the vendor/eliza gitlink.`);

  for (const file of [RECORDS.nativePatches, RECORDS.clientPatches]) {
    const problems = patchProblems(readJson(root, file), readAt);
    if (problems.length) need(`${file} stays at ${short(from)}: ${problems.join('; ')}. Rebase the patch.`);
    else { setPinField(root, file, 'baseCommit', from, to); report.applied.push(`${file}: every patch target is unchanged at the new pin.`); }
  }
  const uuid = readJson(root, RECORDS.mobileUuid);
  const builder = readAt(uuid.builder.path), bunLock = readAt('bun.lock');
  const lockBefore = vendorGit('cat-file', 'blob', `${from}:bun.lock`);
  if (!builder || sha256(builder) !== uuid.builder.sha256) need(`${RECORDS.mobileUuid} stays at ${short(from)}: ${uuid.builder.path} changed upstream.`);
  else if (!bunLock || !bunLock.toString('utf8').includes(`"${uuid.package.name}": ["${uuid.package.name}@${uuid.package.version}"`)) need(`${RECORDS.mobileUuid} stays at ${short(from)}: bun.lock no longer resolves ${uuid.package.name}@${uuid.package.version}.`);
  else {
    editJson(root, RECORDS.mobileUuid, value => ({...value, baseCommit: to, lockSha256: sha256(bunLock)}));
    report.applied.push(`${RECORDS.mobileUuid}: bound to the new bun.lock (${bunLock.equals(lockBefore) ? 'byte-identical' : 'changed; uuid and its builder are unchanged'}).`);
  }

  const voice = readJson(root, RECORDS.voiceHost);
  const current = voice.sourceAdmission.currentSourceComparison;
  const evidence = buildInputAdmission({previous: readJson(root, current.evidence), from, to, lsTree, changedNames, requalificationRequired: current.requalificationRequired === true});
  const evidencePath = `docs/evidence/sdk-${short(to)}-build-input-admission-${date.replaceAll('-', '')}.json`;
  fs.writeFileSync(path.join(root, evidencePath), `${JSON.stringify(evidence, null, 2)}\n`);
  report.native = {evidence: evidencePath, changedPaths: evidence.changedPaths, consumerChanges: evidence.consumerAndroidModules.changedPaths, forkPins: evidence.forkPins};
  report.applied.push(`${evidencePath}: ${evidence.note}`);
  if (current.requalificationRequired === true) {
    editJson(root, RECORDS.voiceHost, value => ({...value, sourceAdmission: nextVoiceComparison(value.sourceAdmission, evidence, evidencePath)}));
    report.applied.push(`${RECORDS.voiceHost}: the current source comparison moved to history; the new one cites ${evidencePath}.`);
  } else if (evidence.changedPaths.length) need(`${RECORDS.voiceHost}: native inputs changed while the record is admitted; a reviewer must decide its admission.`);
  const embedding = readJson(root, RECORDS.embeddingHost);
  if (embedding.requalification?.required === true) {
    editJson(root, RECORDS.embeddingHost, value => ({...value, requalification: {...value.requalification, atPin: to, reason: value.requalification.reason + embeddingReasonSentence(evidence, evidencePath)}}));
    report.applied.push(`${RECORDS.embeddingHost}: the open requalification now names the new pin.`);
  } else if (evidence.embeddingInputs.changedPaths.length) need(`${RECORDS.embeddingHost}: embedding inputs changed (${evidence.embeddingInputs.changedPaths.join(', ')}); the admitted host needs requalification.`);

  const commits = state?.behind ?? 0;
  editJson(root, RECORDS.requirements, value => ({...value, note: requirementsNote(value.note, {from, to, date, commits, evidence, evidencePath})}));
  fs.writeFileSync(path.join(root, RECORDS.status), statusPinText(read(root, RECORDS.status), {from, to}));
  report.applied.push(`${RECORDS.requirements} and ${RECORDS.status}: name the new pin; the reviewed projection paragraph keeps its SDK.`);

  if (skipScripts) {
    report.skipped = ['node scripts/verify-upstream.mjs --record-reachability', 'node scripts/dependency-audit.mjs --resident --write', 'node scripts/generate-licenses.mjs', 'the pin-bound checks'];
    need('Dry run: the owning scripts and checks did not run.');
    return report;
  }
  // Owning scripts, in the order a manual pin runs them.
  const record = node('Record develop reachability', 'scripts/verify-upstream.mjs', '--record-reachability', '--upstream-reachability=off');
  if (record.ok) report.applied.push('scripts/ci/upstream-reachability.json: re-recorded by scripts/verify-upstream.mjs --record-reachability.');
  else need(`Recording reachability failed:\n${record.output.slice(-1500)}`);
  const before = readJson(root, RECORDS.snapshot).resident;
  const audit = node('Resident advisory audit', 'scripts/dependency-audit.mjs', '--resident', '--write');
  const after = readJson(root, RECORDS.snapshot).resident;
  if (after?.upstreamCommit === to) report.applied.push(`${RECORDS.snapshot}: re-audited by scripts/dependency-audit.mjs --resident --write.`);
  if (after?.upstreamCommit !== to) need(`The resident audit did not write a snapshot for the new pin:\n${audit.output.slice(-1500)}`);
  else {
    const carried = carryResidentDispositions(readJson(root, RECORDS.dispositions), before, after, {from, to, date, lockUnchanged: bunLock?.equals(lockBefore) ?? false});
    if (carried) { editJson(root, RECORDS.dispositions, () => carried); report.applied.push(`${RECORDS.dispositions}: the fresh audit reproduces all ${after.findings.length} findings, so only the source binding moved.`); }
    else need(`${RECORDS.dispositions}: the resident audit at the new pin differs (${after.packages} packages, ${after.findings.length} findings, was ${before?.packages} and ${before?.findings?.length}); review the dispositions.`);
  }
  const licenses = node('Third-party notices', 'scripts/generate-licenses.mjs');
  if (licenses.ok) report.applied.push('apps/app/public/licenses: regenerated by scripts/generate-licenses.mjs.');
  else need(`Regenerating third-party notices failed:\n${licenses.output.slice(-1500)}`);

  report.checks = runChecks().map((check, index) => ({...check, main: baseline[index].ok}));
  report.ready = report.needsPerson.length === 0 && report.checks.every(check => check.ok || !check.main);
  return report;
}
// Checks a pin move can break, run on main and at the new pin. The pin-bound tests read committed
// records and vendor/eliza only; the dispatched PR checks run everything else.
const CHECKS = [
  ['verify-upstream', 'scripts/verify-upstream.mjs', '--upstream-reachability=fail'],
  ['Third-party notices', 'scripts/generate-licenses.mjs', '--check'],
  ['Pin-bound record tests', '--test', '--test-reporter=dot', 'test/eliza-pin-sync.test.mjs', 'test/docs-requirements-consistency.test.mjs', 'test/docs-inventory-consistency.test.mjs', 'test/upstream-reachability.test.mjs', 'test/embedding-host-admission.test.mjs', 'test/voice-host-record.test.mjs', 'test/mobile-uuid-build.test.mjs', 'test/dependency-audit.test.mjs', 'test/licenses.test.mjs'],
];

export function renderBody(s, report, {automerge = false} = {}) {
  const fence = text => ['```', text.length > 6000 ? `[...]\n${text.slice(-6000)}` : text, '```'];
  const lines = [
    `Pins elizaOS/eliza \`develop\` at \`${short(report.to)}\`, ${plural(s.behind, 'upstream commit')} after the current pin \`${short(report.from)}\`.`, '',
    `- New pin: \`${report.to}\``,
    `- Old pin: \`${report.from}\``,
    `- Upstream commits: ${s.behind}; pin-only commits this drops: ${s.pinOnly}`,
    `- Compare: ${s.compareUrl}`,
  ];
  if (s.pinOnlyCommits?.length) lines.push('', '> [!WARNING]', `> The current pin is not on develop. Moving to develop drops ${plural(s.pinOnly, 'commit')}:`, ...s.pinOnlyCommits.map(row => `> - \`${short(row.sha)}\` ${row.subject}`));
  lines.push('', '### Needs a person', ...(report.needsPerson.length ? report.needsPerson.map(item => `- ${item.replaceAll('\n', '\n  ')}`) : ['Nothing the sync job can see. The dispatched Browser MVP and Android foundation runs on this branch are the merge checks.']));
  lines.push('', '### Applied', ...report.applied.map(item => `- ${item}`));
  if (report.checks.length) {
    const result = ok => (ok ? 'pass' : 'FAIL');
    lines.push('', '### Checks in the sync job', '', 'A check that already fails on `main` does not block this PR.', '', '| Check | main | New pin |', '| --- | --- | --- |', ...report.checks.map(check => `| ${check.name} | ${result(check.main)} | ${result(check.ok)} |`));
    const verify = report.checks.find(check => check.name === 'verify-upstream');
    lines.push('', '<details><summary>verify-upstream output</summary>', '', ...fence(verify.output), '', '</details>');
    for (const check of report.checks.filter(item => !item.ok && item !== verify)) lines.push('', `<details><summary>${check.name} output</summary>`, '', ...fence(check.output), '', '</details>');
  }
  lines.push('', '---', `Rebuilt from \`main\` by \`.github/workflows/eliza-pin-sync.yml\` when develop has moved and this PR is ${s.thresholds.refreshHours} hours old, or at once on a manual dispatch; commits pushed to \`${s.botBranch}\` are replaced. Auto-merge is ${automerge ? 'on (ELIZA_PIN_SYNC_AUTOMERGE)' : 'off'}. Pause with the repository variable \`ELIZA_PIN_SYNC=off\` (docs/ci-cost-policy.md, "Eliza develop pin sync").`);
  return `${lines.join('\n')}\n`;
}

/** One comment per drift episode on the configured issue: created on entry, edited while it lasts and when it clears. */
function driftComment({repository, issue, s}) {
  if (!/^[1-9][0-9]*$/.test(issue)) throw new Error('--issue needs an issue number');
  const comments = gh(['api', '--paginate', `repos/${repository}/issues/${issue}/comments`, '--jq', `.[]|select(.body|contains("${DRIFT_MARKER}"))|{id,open:(.body|contains("state:open"))}`])
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const last = comments.at(-1);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const body = s.drift
    ? `${DRIFT_MARKER}<!-- state:open -->\nAlpha's elizaOS pin \`${short(s.pin)}\` on main is ${plural(s.behind, 'commit')} behind \`develop\` (\`${short(s.develop)}\`)${s.staleSince ? `, stale since ${s.staleSince}` : ''}, over the ${s.thresholds.commits}-commit or ${s.thresholds.days}-day threshold. Pin PR: ${s.pr ? `#${s.pr}` : 'none open'}.${s.pinOnly ? ` The current pin carries ${plural(s.pinOnly, 'commit')} that develop does not.` : ''} Compare: ${s.compareUrl}\n\nUpdated ${stamp} UTC by eliza-pin-sync.`
    : `${DRIFT_MARKER}<!-- state:cleared -->\nAlpha's elizaOS pin is back within the drift threshold (\`${short(s.pin)}\`, ${plural(s.behind, 'commit')} behind develop). Updated ${stamp} UTC by eliza-pin-sync.`;
  if (s.drift && !last?.open) gh(['api', `repos/${repository}/issues/${issue}/comments`, '-f', `body=${body}`]);
  else if (last?.open) gh(['api', '-X', 'PATCH', `repos/${repository}/issues/comments/${last.id}`, '-f', `body=${body}`]);
}

function option(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(argv) {
  const [command] = argv;
  const env = process.env;
  const repository = option(argv, '--repo') ?? env.GITHUB_REPOSITORY;
  const output = (key, value) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`); };
  if (command === 'status') {
    if (!repository) throw new Error('status needs --repo or GITHUB_REPOSITORY');
    const s = status({root: ROOT, repository, botBranch: option(argv, '--bot-branch') ?? 'bot/eliza-pin-sync', event: option(argv, '--event') ?? 'workflow_dispatch', main: option(argv, '--main'), env});
    console.log(JSON.stringify(s, null, 2));
    for (const key of ['action', 'develop', 'drift', 'main', 'pr']) output(key, s[key] ?? '');
    output('bot_head', s.bot?.head ?? '');
    output('json', JSON.stringify(s));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, statusSummary(s));
    if (s.drift) console.log(`::warning::elizaOS pin ${short(s.pin)} is ${s.behind} commits behind develop (stale since ${s.staleSince}).`);
    return 0;
  }
  if (command === 'apply') {
    const report = apply({root: ROOT, to: option(argv, '--to'), vendor: path.resolve(ROOT, option(argv, '--vendor') ?? 'vendor/eliza'), skipScripts: argv.includes('--skip-scripts'), statusFile: option(argv, '--status')});
    const file = option(argv, '--report');
    if (file) fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    for (const item of report.needsPerson) console.log(`NEEDS A PERSON ${item}`);
    for (const check of report.checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
    console.log(`Pinned ${report.to} (was ${report.from}); ready: ${report.ready}`);
    output('ready', report.ready);
    return 0;
  }
  const s = option(argv, '--status') && JSON.parse(fs.readFileSync(option(argv, '--status'), 'utf8'));
  if (command === 'body' && s) {
    process.stdout.write(renderBody(s, JSON.parse(fs.readFileSync(option(argv, '--report'), 'utf8')), {automerge: env.ELIZA_PIN_SYNC_AUTOMERGE === 'true'}));
    return 0;
  }
  if (command === 'drift-comment' && s) {
    driftComment({repository: repository ?? s.repository, issue: option(argv, '--issue'), s});
    return 0;
  }
  console.error('Usage: node scripts/eliza-pin-sync.mjs status|apply|body|drift-comment (see the header of this file)');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
