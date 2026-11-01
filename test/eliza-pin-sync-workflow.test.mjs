// The develop pin sync's job separation (.github/workflows/eliza-pin-sync.yml): develop code runs
// only in the read-only repin job, inside its sandbox, and the publish job, which alone holds
// contents: write, runs git, jq and gh in shell and publishes only a repin it has checked, field by
// field, against main and the record allowlist. The publish checks run here for real, on the
// committed records and against throwaway repositories, with no node on PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  CLEARANCE, RECORDS, RECORD_RULES, carryResidentDispositions, embeddingReasonSentence, nextVoiceComparison, replaceOnce,
  requirementsNote, sha256, statusPinText,
} from '../scripts/eliza-pin-sync.mjs';

const read = file => fs.readFileSync(file, 'utf8');
const workflow = read('.github/workflows/eliza-pin-sync.yml');
/** Top-level jobs of a workflow file, by name, as their source text. */
function jobs(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + 6), names = [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):\n/gm)];
  return Object.fromEntries(names.map((match, index) => [match[1], body.slice(match.index, names[index + 1]?.index ?? body.length)]));
}
const job = jobs(workflow);
/** The block scalar that follows `<indent>key: |`, dedented. */
function block(text, key, indent) {
  const at = text.indexOf(`\n${' '.repeat(indent)}${key}: |\n`);
  assert.ok(at >= 0, key);
  const lines = text.slice(text.indexOf('\n', at + 1) + 1).split('\n');
  const end = lines.findIndex(line => line.trim() && !line.startsWith(' '.repeat(indent + 2)));
  return lines.slice(0, end).map(line => line.slice(indent + 2)).join('\n').replace(/\n+$/, '\n');
}
const step = (text, name) => block(text.slice(text.indexOf(`- name: ${name}\n`)), 'run', 8);
/** A job's executable text: no comment lines and no RECORD_PATHS or JSON_RULE data. */
const code = text => text.replace(/\n {6}(?:RECORD_PATHS|JSON_RULE): \|\n(?: {8}.*\n)+/g, '\n').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
const permissions = text => /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(text)?.[1].split('\n').filter(line => /^ {6}[a-z-]+: /.test(line)).map(line => line.trim()).sort() ?? [];
const SANDBOXED = '[ "${SANDBOXED:-}" = 1 ] || exec "$SANDBOX/run" "$0"\n';

test('only the publish job can write contents, and develop code runs only in the repin job\'s sandbox', () => {
  assert.deepEqual(Object.keys(job), ['status', 'repin', 'publish', 'close', 'drift']);
  assert.match(workflow, /^permissions: \{\}$/m, 'nothing at workflow level');
  assert.doesNotMatch(workflow, /repository_dispatch/, 'no trigger asks anyone for a token to this repository');
  assert.deepEqual(permissions(job.status), ['contents: read', 'pull-requests: read']);
  assert.deepEqual(permissions(job.repin), ['contents: read']);
  assert.deepEqual(permissions(job.publish), ['actions: write', 'contents: write', 'pull-requests: write']);
  assert.deepEqual(permissions(job.close), ['pull-requests: write']);
  assert.deepEqual(permissions(job.drift), ['contents: read', 'issues: write']);
  // vendor/eliza and npm ci appear in the repin job alone. No job restores or saves a cache: every
  // setup-node turns its package-manager cache off.
  for (const [name, text] of Object.entries(job)) if (name !== 'repin') assert.doesNotMatch(code(text), /git -C vendor\/eliza|npm ci|eliza-pin-sync\.mjs apply/, name);
  const setups = [...workflow.matchAll(/- uses: actions\/setup-node@\S+ # v[\d.]+\n {8}with:\n((?: {10}.*\n)+)/g)].map(match => match[1]);
  assert.equal(setups.length, (workflow.match(/actions\/setup-node@/g) ?? []).length);
  for (const inputs of setups) assert.deepEqual(inputs.trim().split('\n').map(line => line.trim()).sort(), ['node-version-file: .nvmrc', 'package-manager-cache: false']);
  assert.doesNotMatch(code(workflow), /actions\/cache|^\s+cache(?:-dependency-path)?:/m);
  // The repin job's steps that run npm, node or git on the repin tree all re-run themselves in the
  // sandbox first; the runner's own steps there only prepare it and copy its output out.
  const repinSteps = [...job.repin.matchAll(/\n {6}- (?:name: (.+)|uses: (\S+).*)\n/g)].map(match => match[1] ?? match[2].split('@')[0]);
  assert.deepEqual(repinSteps, ['actions/checkout', 'actions/setup-node', 'Set up the sandbox', 'Fetch the current and new pins', 'Repin with the owning scripts', 'Commit and bundle', 'Collect the repin', 'actions/upload-artifact']);
  for (const name of ['Fetch the current and new pins', 'Repin with the owning scripts', 'Commit and bundle']) assert.ok(step(job.repin, name).startsWith(SANDBOXED), name);
  for (const name of ['Set up the sandbox', 'Collect the repin']) assert.doesNotMatch(code(step(job.repin, name)), /\b(node|npm|npx)\b|\/repo|vendor\/eliza|eliza-pin-sync\.mjs/, name);
  const collect = code(step(job.repin, 'Collect the repin'));
  assert.doesNotMatch(collect, /\bgit\b/, 'no git of the runner touches the repin tree');
  assert.match(collect, /sudo -u "\$PIN_USER" cat -- "\$PIN_DIR\/out\/\$file" > "\$RUNNER_TEMP\/out\/\$file"/, 'the sandbox user reads, the runner writes its own copy');
  // The launcher: PIN_USER, no new privileges, only PIN_DIR writable, no /home, its own /tmp, and the
  // token passed by name, never on a command line.
  const launcher = step(job.repin, 'Set up the sandbox');
  assert.match(launcher, /sudo useradd --system --user-group --no-create-home --shell \/usr\/sbin\/nologin "\$PIN_USER"\n/);
  assert.match(launcher, /\nsudo install -m 0755 "\$RUNNER_TEMP\/sandbox" "\$SANDBOX\/run"\n?$/);
  const run = launcher.slice(launcher.indexOf("<<'EOF'\n"), launcher.indexOf('\nEOF\n'));
  for (const flag of ['systemd-run --quiet --wait --pipe --collect', '--uid="$PIN_USER"', '--gid="$PIN_USER"', '-p NoNewPrivileges=yes', '-p ProtectSystem=strict', '-p ProtectHome=yes', '-p PrivateTmp=yes', '-p ReadWritePaths="$PIN_DIR"', '-E SANDBOXED=1', '${GH_TOKEN:+-E GH_TOKEN}'])
    assert.ok(run.includes(flag), flag);
  assert.equal((run.match(/ReadWritePaths|BindPaths/g) ?? []).length, 1);
  assert.match(run, /exec sudo --preserve-env=GH_TOKEN systemd-run /);
  assert.doesNotMatch(run, /GH_TOKEN=/);
  assert.match(job.repin, /\n {6}SANDBOX: \/srv\/eliza-pin-sync\n {6}PIN_DIR: \/srv\/eliza-pin-sync\/work\n/);
  // The read-only token reaches the repin step alone.
  assert.equal((job.repin.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g) ?? []).length, 1);
  const token = job.repin.indexOf('GH_TOKEN: ${{');
  assert.ok(token > job.repin.indexOf('- name: Repin with the owning scripts') && token < job.repin.indexOf('- name: Commit and bundle'));
  assert.match(job.repin, /persist-credentials: false/);
  // The guard runs in the status job before any repin, and only a cleared guard starts one.
  assert.match(job.repin, /\n {4}if: needs\.status\.outputs\.action == 'refresh' && needs\.status\.outputs\.cleared == 'true'\n/);
  assert.match(job.status, /- id: guard\n {8}name: Incident ancestry and payload guard\n(?: {8}#.*\n)* {8}if: steps\.status\.outputs\.action == 'refresh'\n/);
  assert.match(job.status, /cleared: \$\{\{ steps\.guard\.outputs\.cleared \}\}/);
});

test('the publish job runs no node or npm, checks out nothing and needs a cleared guard and a successful repin', () => {
  const publish = job.publish;
  assert.match(publish, /\n {4}needs: \[status, repin\]\n/);
  assert.match(publish, /\n {4}if: needs\.status\.outputs\.cleared == 'true' && needs\.repin\.result == 'success' && !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\)\n/);
  assert.deepEqual([...publish.matchAll(/uses: (\S+)/g)].map(match => match[1]), ['actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333'], 'no checkout, no setup-node');
  assert.doesNotMatch(code(publish), /(^|[\s;&|(`$])(node|nodejs|npm|npx|bun|bunx|yarn|pnpm|deno|tsx|python3?)(\s|$)/m);
  assert.doesNotMatch(code(publish), /\.m?[jt]s\b|scripts\//, 'no repository script');
  // Its verify step runs below with only git, jq and shell text tools on PATH; its other steps call git and gh.
  for (const name of ['Find the one pin PR', 'Push the bot branch', 'Open or update the one pin PR', 'Dispatch the PR checks'])
    for (const line of step(job.publish, name).split('\n').filter(text => text.trim() && !text.trim().startsWith('#')))
      assert.match(line.trim(), /^(gh |git |if |else|fi|case |auth=|echo |export |open=\$\(gh |count=|read -r |title=|NUMBER=|gh api)/, `${name}: ${line}`);
  // The artifact is exactly the one the repin job's upload step reported, by ID.
  assert.match(job.repin, /\n {6}artifact_id: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}\n/);
  assert.match(job.repin, /- uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7\.0\.2\n {8}id: upload\n/);
  assert.match(publish, /\n {10}artifact-ids: \$\{\{ needs\.repin\.outputs\.artifact_id \}\}\n/);
});

test('nothing in the pin sync can merge a PR or update a running app', () => {
  const script = read('scripts/eliza-pin-sync.mjs'), policy = read('docs/ci-cost-policy.md');
  for (const [file, text] of [['workflow', code(workflow)], ['script', script]]) {
    assert.doesNotMatch(text, /gh pr merge|\bpulls\/[^/\s]+\/merge|enablePullRequestAutoMerge|mergePullRequest|--auto\b|merge_method|AUTOMERGE/i, file);
    assert.doesNotMatch(text, /\bdeploy|wrangler|environment:|cloudflare|gh release/i, file);
  }
  assert.doesNotMatch(policy, /ELIZA_PIN_SYNC_AUTOMERGE/);
  // A PR someone set to auto-merge is refused before anything is pushed into it, and only the bot
  // branch's PRs into the base branch count as pin PRs.
  const find = step(job.publish, 'Find the one pin PR');
  assert.match(find, /pulls\?state=open&head=\$\{GITHUB_REPOSITORY%%\/\*\}:\$BOT_BRANCH&base=\$BASE_BRANCH" --jq '\.\[\] \| select\(\.base\.ref == env\.BASE_BRANCH\) \| /);
  assert.match(script, /pulls\?state=\$\{state\}&head=\$\{repository\.split\('\/'\)\[0\]\}:\$\{botBranch\}&base=\$\{baseBranch\}`/);
  assert.match(job.status, /--bot-branch "\$BOT_BRANCH" --base-branch "\$BASE_BRANCH"/);
  assert.match(find, /\.auto_merge != null/);
  assert.match(find, /if \[ "\$auto" = true \]; then echo "::error::Auto-merge is on for #\$number; turn it off, then run the sync again\."; exit 1; fi/);
  assert.match(find, /if \[ "\$count" -gt 1 \]; then echo "::error::More than one open pin PR/, 'exactly one PR: two are refused');
  assert.ok(job.publish.indexOf('- name: Find the one pin PR') < job.publish.indexOf('- name: Push the bot branch'));
  // The PR checks it dispatches build and test with a read grant only.
  assert.deepEqual([...workflow.matchAll(/gh workflow run (\S+)/g)].map(match => match[1]), ['browser.yml', 'android.yml']);
  for (const file of ['browser.yml', 'android.yml']) {
    const text = read(path.join('.github/workflows', file));
    assert.match(text, /^permissions:\n {2}contents: read\n/m, file);
    assert.doesNotMatch(text, /environment:|: write\s*$|secrets\./m, file);
  }
});

test('the publish allowlist is the record list the repin writes, and lists no integrity digest but the reviewed two', () => {
  const listed = block(job.publish, 'RECORD_PATHS', 6).trim().split('\n').map(line => line.trim().split(' '));
  assert.deepEqual(listed, RECORD_RULES);
  const paths = listed.map(([file]) => file);
  for (const file of [CLEARANCE, RECORDS.combinedSource, 'scripts/owner/incident-2026-10-27-iocs.json', 'scripts/eliza-pin-sync.mjs', 'package.json', 'package-lock.json', '.nvmrc'])
    assert.ok(!paths.includes(file), file);
  assert.ok(paths.every(file => !file.startsWith('.github/') && fs.existsSync(file)), 'every listed record exists');
  for (const [file, rule, field] of listed) {
    assert.ok(['pin', 'status', 'json', 'data'].includes(rule), `${file} ${rule}`);
    assert.equal(rule === 'json', Boolean(field), `${file}: only a json rule names fields`);
    // Executable files may change only in their pin.
    if (/\.(mjs|js|py|sh)$/.test(file)) assert.equal(rule, 'pin', file);
  }
  // The mobile UUID lock digest (checked against vendor/eliza/bun.lock at every build) and the
  // resident audit's input digest are the only digests a repin may rewrite.
  assert.deepEqual(listed.map(([, , field]) => field).filter(field => /sha256/i.test(field ?? '')), ['.lockSha256', '.resident.inputSha256']);
});

// A throwaway origin holding main's committed records, then a repin of them made with the
// script's own record edits and the repin job's commit step, then the publish job's verify step,
// run by bash with only git, jq and shell text tools on PATH.
const OLD = JSON.parse(read(RECORDS.lock)).commit, NEW = '2'.repeat(40), DATE = '2026-11-02';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const write = (root, file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); };
const edit = (root, file, change) => write(root, file, change(read(path.join(root, file))));
const editJson = (root, file, change) => edit(root, file, text => `${JSON.stringify(change(JSON.parse(text)), null, 2)}\n`);
const evidence = `docs/evidence/sdk-${NEW.slice(0, 10)}-build-input-admission-${DATE.replaceAll('-', '')}.json`;
const ENGINE = 'e'.repeat(40);
const EVIDENCE = {from: OLD, to: NEW, inputs: [{path: 'plugins/a', unchanged: true}], changedPaths: [], forkPins: {from: ENGINE, to: ENGINE},
  embeddingInputs: {changedPaths: [], unchangedPaths: ['plugins/a']}, consumerAndroidModules: {changedPaths: [], unchangedPaths: []}, note: 'Unchanged.', requalificationRequired: true};
const TOOLS = ['git', 'sed', 'cmp', 'sha256sum', 'cut', 'head', 'tail', 'grep', 'cat', 'tr', 'sort', 'jq'];
function toolbox(dir) {
  // Only the tools the two steps may use; node, npm and everything else are absent.
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const tool of TOOLS) fs.symlinkSync(execFileSync('/bin/sh', ['-c', `command -v ${tool}`], {encoding: 'utf8'}).trim(), path.join(bin, tool));
  return bin;
}
/** What apply writes, made with the script's own record edits. */
function repin(root) {
  const pin = (file, key) => edit(root, file, text => replaceOnce(text, `"${key}": "${OLD}"`, `"${key}": "${NEW}"`, file));
  pin(RECORDS.lock, 'commit'); pin(RECORDS.inventory, 'upstream_pin'); pin(RECORDS.voiceHost, 'pin');
  pin(RECORDS.nativePatches, 'baseCommit'); pin(RECORDS.clientPatches, 'baseCommit');
  edit(root, RECORDS.calendarBridge, text => replaceOnce(text, `SDK = '${OLD}'`, `SDK = '${NEW}'`, 'bridge'));
  editJson(root, RECORDS.mobileUuid, value => ({...value, baseCommit: NEW, lockSha256: sha256('bun.lock at the new pin')}));
  editJson(root, RECORDS.voiceHost, value => ({...value, sourceAdmission: nextVoiceComparison(value.sourceAdmission, EVIDENCE, evidence)}));
  editJson(root, RECORDS.embeddingHost, value => ({...value, requalification: {...value.requalification, atPin: NEW, reason: value.requalification.reason + embeddingReasonSentence(EVIDENCE, evidence)}}));
  editJson(root, RECORDS.requirements, value => ({...value, note: requirementsNote(value.note, {from: OLD, to: NEW, date: DATE, commits: 3, evidence: EVIDENCE, evidencePath: evidence})}));
  edit(root, RECORDS.status, text => statusPinText(text, {from: OLD, to: NEW}));
  const before = JSON.parse(read(path.join(root, RECORDS.snapshot))).resident, after = {...before, upstreamCommit: NEW, auditedOn: DATE};
  editJson(root, RECORDS.snapshot, value => ({...value, resident: after}));
  editJson(root, RECORDS.dispositions, value => carryResidentDispositions(value, before, after, {from: OLD, to: NEW, date: DATE, lockUnchanged: false}));
  editJson(root, RECORDS.reachability, value => ({...value, baseCommit: NEW, head: NEW, mergeBase: NEW, command: value.command.replaceAll(OLD, NEW), recordedAt: DATE}));
  for (const file of [RECORDS.notices, RECORDS.noticesText]) edit(root, file, text => text.replaceAll(OLD, NEW));
  write(root, evidence, `${JSON.stringify(EVIDENCE, null, 2)}\n`);
}
let template;
function fixture() {
  template ??= origin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-sync-publish-'));
  fs.cpSync(template.dir, dir, {recursive: true, verbatimSymlinks: true});
  return {...template, dir, origin: path.join(dir, 'origin'), pin: path.join(dir, 'pin'), repo: path.join(dir, 'pin', 'repo'), bin: path.join(dir, 'bin')};
}
function origin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-sync-template-'));
  const origin = path.join(dir, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q');
  for (const file of new Set([...RECORD_RULES.map(([file]) => file), RECORDS.combinedSource])) write(origin, file, read(file));
  write(origin, 'package.json', '{"scripts": {}}\n');
  write(origin, '.github/workflows/ci.yml', 'on: push\n');
  write(origin, CLEARANCE, '{"repositories": {}}\n');
  git(origin, 'add', '-A');
  git(origin, 'update-index', '--add', '--cacheinfo', `160000,${OLD},vendor/eliza`);
  git(origin, 'commit', '-q', '-m', 'main');
  const main = git(origin, 'rev-parse', 'HEAD');
  const repo = path.join(dir, 'pin', 'repo');
  git(dir, 'clone', '-q', `file://${origin}`, repo);
  git(repo, 'checkout', '-q', '--detach', main);
  repin(repo);
  return {dir, origin, main, bin: toolbox(dir)};
}
const bash = (script, cwd, env, bin) => spawnSync('/bin/bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {cwd, encoding: 'utf8', env: {PATH: bin, HOME: cwd, ...env}});
const BODY = '### Needs a person\n- @someone review\n```\n```\n';
function repinAndPublish(fx, {mutate = () => {}, tamper = () => {}, ready = 'true', body = BODY, tools = {}} = {}) {
  mutate(fx);
  const out = path.join(fx.pin, 'out'), publishTemp = path.join(fx.dir, 'publish-temp');
  fs.mkdirSync(out, {recursive: true});
  // The repin step's output, then its commit step, as the sandbox runs them.
  fs.writeFileSync(path.join(out, 'body.md'), body);
  fs.writeFileSync(path.join(out, 'ready'), `${ready}\n`);
  const env = {MAIN: fx.main, NEW_PIN: NEW, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
  const commit = bash(step(job.repin, 'Commit and bundle'), fx.dir, {...env, SANDBOXED: '1', PIN_DIR: fx.pin}, fx.bin);
  assert.equal(commit.status, 0, commit.stderr);
  fs.mkdirSync(publishTemp);
  fs.cpSync(out, path.join(publishTemp, 'repin'), {recursive: true});
  tamper({...fx, artifact: path.join(publishTemp, 'repin')});
  for (const [tool, script] of Object.entries(tools)) { fs.rmSync(path.join(fx.bin, tool)); fs.writeFileSync(path.join(fx.bin, tool), script, {mode: 0o755}); }
  const output = path.join(publishTemp, 'output');
  const result = bash(step(job.publish, 'Verify the repin against main and the record allowlist'), fx.dir, {
    ...env, OLD_PIN: OLD, COMMITS: '3', REPO_URL: `file://${fx.origin}`, BASE_BRANCH: 'main', RUNNER_TEMP: publishTemp, GITHUB_OUTPUT: output,
    RECORD_PATHS: block(job.publish, 'RECORD_PATHS', 6), JSON_RULE: block(job.publish, 'JSON_RULE', 6), RECEIPT: 'Pins elizaOS/eliza `develop` (receipt from the status job).',
  }, fx.bin);
  const outputs = Object.fromEntries((fs.existsSync(output) ? read(output) : '').split('\n').filter(Boolean).map(line => line.split('=')));
  const prBody = fs.existsSync(path.join(publishTemp, 'body.md')) ? read(path.join(publishTemp, 'body.md')) : '';
  return {...result, outputs, publishTemp, body: prBody};
}
/** The repin report as the PR body renders it: the fenced block after "### Repin report". */
function report(body) {
  const lines = body.slice(body.indexOf('\n### Repin report\n')).split('\n');
  const open = lines.findIndex(line => /^`{3,}text$/.test(line));
  const fence = lines[open].slice(0, -'text'.length);
  return {fence, lines: lines.slice(open + 1, lines.lastIndexOf(fence)), after: lines.slice(lines.lastIndexOf(fence) + 1)};
}

test('the publish job publishes a repin of the committed records that keeps to the allowlist, as its own commit on main', () => {
  const fx = fixture();
  const result = repinAndPublish(fx);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.outputs.verified, 'true');
  assert.equal(result.outputs.ready, 'true');
  const work = path.join(result.publishTemp, 'publish'), published = result.outputs.commit;
  assert.equal(git(work, 'rev-parse', `${published}^@`), fx.main, 'one commit on main');
  assert.equal(git(work, 'rev-parse', `${published}^{tree}`), git(work, 'rev-parse', 'refs/repin^{tree}'), 'the checked tree');
  assert.equal(git(work, 'log', '-1', '--format=%an <%ae>|%cn|%s', published), 'github-actions[bot] <41898333+github-actions[bot]@users.noreply.github.com>|github-actions[bot]|Pin Eliza develop 2222222222');
  assert.equal(git(work, 'ls-tree', published, 'vendor/eliza'), `160000 commit ${NEW}\tvendor/eliza`);
  const records = new Set(RECORD_RULES.map(([file]) => file)).size;
  assert.ok(result.body.startsWith('Pins elizaOS/eliza `develop` (receipt from the status job).\n\n### Published commit\n'));
  assert.match(result.body, new RegExp(`every one of its ${records + 2} changed paths kept to its rule in the record allowlist and matched the manifest`));
  // What it could not derive is listed for review; the pin fields are not, since they were checked exactly.
  for (const line of ['- `patches/eliza/mobile-uuid-build.json`: `.lockSha256`', '- `android/embedding-host/qualified-host.json`: `.requalification.reason:append`', '- `docs/requirements.json`: `.note:prepend`',
    `- \`${RECORDS.notices}\`: the whole file`, `- \`${evidence}\`: the whole file`])
    assert.ok(result.body.includes(`\n${line}\n`), line);
  assert.doesNotMatch(result.body, /:pin`|`upstream\.lock\.json`|`docs\/mvp-current-status\.md`/);
  // The repin job's report is text: a fenced code block, so its mentions and fences do nothing.
  const shown = report(result.body);
  assert.equal(shown.fence, '``````', 'longer than the report\'s own fence');
  assert.deepEqual(shown.lines, ['### Needs a person', '- @someone review', '```', '```']);
  assert.deepEqual(shown.after, ['']);
  fs.rmSync(fx.dir, {recursive: true, force: true});
});

test('the PR body keeps a hostile repin report inside its code block', () => {
  // A lone CR ends a Markdown line, so before this an indented block could be left with one.
  const hostile = '### Needs a person\r**OUT OF THE CODE BLOCK** @someone Fixes #743\r\u2028@octocat\u2029Closes #1\u0085x\0\x1b[31m\v\f\n`````\n~~~\n   ``````\ntail';
  const fx = fixture();
  const result = repinAndPublish(fx, {body: hostile});
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.doesNotMatch(result.body, /[\0-\x08\x0b-\x1f\x7f\u0085\u2028\u2029]/, 'no control character or Unicode line separator');
  const shown = report(result.body);
  assert.deepEqual(shown.lines, ['### Needs a person**OUT OF THE CODE BLOCK** @someone Fixes #743@octocatCloses #1x[31m', '`````', '~~~', '   ``````', 'tail']);
  assert.deepEqual(shown.after, ['']);
  // CommonMark closes a fence only on a line of at least as many backticks; none is inside.
  assert.equal(shown.fence.length, 9);
  for (const line of shown.lines) assert.doesNotMatch(line, new RegExp(`^ {0,3}\`{${shown.fence.length},}\\s*$`), line);
  fs.rmSync(fx.dir, {recursive: true, force: true});
});

test('the publish job rejects a repin outside the allowlist, beyond its fields, off main or unlike its manifest', () => {
  const rejects = (label, options, reason) => {
    const fx = fixture();
    const result = repinAndPublish(fx, options);
    assert.equal(result.status, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.ok(result.stdout.includes('::error::Repin rejected: ') && result.stdout.includes(reason), `${label}: ${result.stdout}${result.stderr}`);
    assert.equal(result.outputs.verified, undefined, label);
    fs.rmSync(fx.dir, {recursive: true, force: true});
  };
  const json = (file, change) => ({mutate: ({repo}) => editJson(repo, file, value => { change(value); return value; })});
  const text = (file, change) => ({mutate: ({repo}) => edit(repo, file, change)});
  const digest = 'f'.repeat(64);
  rejects('a dependency manifest', text('package.json', () => '{"scripts": {"postinstall": "node x"}}\n'), 'package.json is not on the record allowlist');
  rejects('a workflow', text('.github/workflows/ci.yml', () => 'on: push\npermissions: write-all\n'), '.github/workflows/ci.yml is not on the record allowlist');
  rejects('the clearance record', text(CLEARANCE, () => '{"repositories": {"elizaOS/eliza": {"forgedCommits": [], "record": "me"}}}\n'), `${CLEARANCE} is not on the record allowlist`);
  rejects('the combined source', text(RECORDS.combinedSource, source => source.replace(/'[0-9a-f]{40}'/, `'${'3'.repeat(40)}'`)), `${RECORDS.combinedSource} is not on the record allowlist`);
  rejects('code beyond its pin', text(RECORDS.calendarBridge, source => `${source}import os\n`), `${RECORDS.calendarBridge} changed beyond its pin`);
  // The review's payloads: integrity digests and pins rewritten inside allowed records.
  rejects('the calendar host digest', text(RECORDS.calendarBridge, source => source.replace(/^HOST = '[0-9a-f]{64}'$/m, `HOST = '${digest}'`)), `${RECORDS.calendarBridge} changed beyond its pin`);
  rejects('a 64-character SDK', text(RECORDS.calendarBridge, source => source.replace(`SDK = '${NEW}'`, `SDK = '${digest}'`)), `${RECORDS.calendarBridge} changed beyond its pin`);
  rejects('a pin file beyond its pin', text(RECORDS.lock, source => source.replace('https://github.com/elizaOS/eliza.git', 'https://github.com/someone/eliza.git')), `${RECORDS.lock} changed beyond its pin`);
  rejects('a patch target digest', text(RECORDS.nativePatches, source => source.replace(/"beforeSha256": "[0-9a-f]{64}"/, `"beforeSha256": "${digest}"`)), `${RECORDS.nativePatches} changed beyond its pin`);
  rejects('the builder digest', json(RECORDS.mobileUuid, value => { value.builder.sha256 = digest; }), `${RECORDS.mobileUuid} changed beyond`);
  rejects('a package file digest', json(RECORDS.mobileUuid, value => { value.package.files['dist-node/index.js'] = digest; }), `${RECORDS.mobileUuid} changed beyond`);
  rejects('a second JSON value', text(RECORDS.mobileUuid, source => `${source}{}\n`), `${RECORDS.mobileUuid} changed beyond`);
  rejects('a native library digest', json(RECORDS.embeddingHost, value => { value.libraries[0].sha256 = digest; }), `${RECORDS.embeddingHost} changed beyond`);
  rejects('a redirected model', json(RECORDS.embeddingHost, value => { value.model.path = 'models/other.gguf'; }), `${RECORDS.embeddingHost} changed beyond`);
  rejects('a pin field off the new pin', json(RECORDS.embeddingHost, value => { value.requalification.atPin = '3'.repeat(40); }), `${RECORDS.embeddingHost} changed beyond`);
  rejects('a rewritten reason', json(RECORDS.embeddingHost, value => { value.requalification.reason = 'Nothing to requalify.'; }), `${RECORDS.embeddingHost} changed beyond`);
  rejects('a duplicate digest key', text(RECORDS.embeddingHost, source => source.replace(/^( +)"sha256": /m, `$1"sha256": "${digest}",\n$1"sha256": `)), `${RECORDS.embeddingHost} is not in jq's form of its JSON`);
  rejects('an admitted voice host', json(RECORDS.voiceHost, value => { value.sourceAdmission.currentSourceComparison.admitted = true; }), `${RECORDS.voiceHost} changed beyond`);
  rejects('a voice model digest', json(RECORDS.voiceHost, value => { value.models[0].sha256 = digest; }), `${RECORDS.voiceHost} changed beyond`);
  rejects('rewritten history', json(RECORDS.dispositions, value => { value.resident.sourceBindingHistory[0].note = 'Rewritten.'; }), `${RECORDS.dispositions} changed beyond`);
  rejects('a new exception', json(RECORDS.dispositions, value => { value.resident.exceptions.push({advisory: 'GHSA-x'}); }), `${RECORDS.dispositions} changed beyond`);
  rejects('a replaced note', json(RECORDS.requirements, value => { value.note = `Current source pin ${NEW}.`; }), `${RECORDS.requirements} changed beyond`);
  rejects('a changed requirement', json(RECORDS.requirements, value => { value.requirements[0].status = 'done'; }), `${RECORDS.requirements} changed beyond`);
  rejects('the status page beyond its sentences', text(RECORDS.status, source => `${source}\nAccepted for release.\n`), `${RECORDS.status} changed beyond its pin sentences`);
  rejects('the snapshot beyond the resident audit', json(RECORDS.snapshot, value => { value.lockSha256 = digest; }), `${RECORDS.snapshot} changed beyond`);
  rejects('another gitlink', {tamper: ({repo, main, artifact}) => {
    git(repo, 'update-index', '--cacheinfo', `160000,${'3'.repeat(40)},vendor/eliza`);
    git(repo, 'commit', '-q', '--amend', '--no-edit');
    git(repo, 'update-ref', 'refs/heads/eliza-pin-sync', 'HEAD');
    git(repo, 'bundle', 'create', '-q', path.join(artifact, 'repin.bundle'), 'refs/heads/eliza-pin-sync', `^${main}`);
  }}, `vendor/eliza must move to the new pin ${NEW}`);
  rejects('a symlinked record', {mutate: ({repo}) => { fs.rmSync(path.join(repo, RECORDS.requirements)); fs.symlinkSync('/etc/passwd', path.join(repo, RECORDS.requirements)); }}, `${RECORDS.requirements} has mode 120000`);
  rejects('a second commit', {mutate: ({repo}) => { git(repo, 'commit', '-q', '-am', 'extra'); }}, 'is not one commit on main');
  rejects('a tampered manifest', {tamper: ({artifact}) => fs.appendFileSync(path.join(artifact, 'manifest.txt'), `${'0'.repeat(64)}  package.json\n`)}, 'the manifest does not match the bundle');
  rejects('a bad ready flag', {ready: 'yes'}, 'the ready flag is neither true nor false');
  // The jq it relies on: one that rounds number literals is refused before it reads a record.
  const jq = execFileSync('/bin/sh', ['-c', 'command -v jq'], {encoding: 'utf8'}).trim();
  rejects('a rounding jq', {tools: {jq: `#!/bin/sh\n'${jq}' "$@" | sed 's/9007199254740993/9007199254740992/g'\n`}}, 'jq here rounds number literals or keeps an earlier duplicate key');
});

test('the publish job publishes nothing when main moved during the repin', () => {
  const fx = fixture();
  const result = repinAndPublish(fx, {mutate: ({origin}) => { write(origin, 'README.md', 'moved\n'); git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'moved'); }});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::notice::main moved from [0-9a-f]{40} to [0-9a-f]{40} during the repin; nothing is published/);
  assert.equal(result.outputs.verified, undefined);
  fs.rmSync(fx.dir, {recursive: true, force: true});
});
