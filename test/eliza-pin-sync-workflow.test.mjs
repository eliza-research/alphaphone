// The develop pin sync's job separation (.github/workflows/eliza-pin-sync.yml): develop code runs
// only in the read-only repin job, and the publish job, which alone holds contents: write, runs git
// and gh in shell and publishes only a repin it has checked against main and the record allowlist.
// The publish checks run here for real, against throwaway repositories, with no node on PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {CLEARANCE, RECORD_RULES} from '../scripts/eliza-pin-sync.mjs';

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
/** A job's executable text: no comment lines and no RECORD_PATHS data. */
const code = text => text.replace(/\n {6}RECORD_PATHS: \|\n(?: {8}.*\n)+/, '\n').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
const permissions = text => /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(text)?.[1].split('\n').filter(line => /^ {6}[a-z-]+: /.test(line)).map(line => line.trim()).sort() ?? [];

test('only the publish job can write contents, and develop code runs only in a read-only job', () => {
  assert.deepEqual(Object.keys(job), ['status', 'repin', 'publish', 'close', 'drift']);
  assert.match(workflow, /^permissions: \{\}$/m, 'nothing at workflow level');
  assert.deepEqual(permissions(job.status), ['contents: read', 'pull-requests: read']);
  assert.deepEqual(permissions(job.repin), ['contents: read']);
  assert.deepEqual(permissions(job.publish), ['actions: write', 'contents: write', 'pull-requests: write']);
  assert.deepEqual(permissions(job.close), ['pull-requests: write']);
  assert.deepEqual(permissions(job.drift), ['contents: read', 'issues: write']);
  // vendor/eliza and npm ci appear in the repin job alone; it restores and saves no cache.
  for (const [name, text] of Object.entries(job)) if (name !== 'repin') assert.doesNotMatch(code(text), /git -C vendor\/eliza|npm ci|eliza-pin-sync\.mjs apply|setup-node[^\n]*\n[^\n]*\n[^\n]*cache/, name);
  assert.doesNotMatch(code(job.repin), /\bcache\b|actions\/cache/);
  assert.match(job.repin, /\n {4}if: needs\.status\.outputs\.action == 'refresh' && needs\.status\.outputs\.cleared == 'true'\n/);
  assert.equal((job.repin.match(/GH_TOKEN/g) ?? []).length, 1, 'the read-only token reaches the repin step alone');
  assert.ok(job.repin.indexOf('GH_TOKEN') > job.repin.indexOf('- name: Repin with the owning scripts') && job.repin.indexOf('GH_TOKEN') < job.repin.indexOf('- name: Commit and bundle'));
  assert.match(job.repin, /persist-credentials: false/);
  // The guard runs in the status job before any repin, and only a cleared guard starts one.
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
  // Its verify step runs below with only git and shell text tools on PATH; its other steps call git and gh.
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
  // A PR someone set to auto-merge is refused before anything is pushed into it.
  const find = step(job.publish, 'Find the one pin PR');
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

test('the publish allowlist is the record list the repin writes, and excludes the guard and workflow inputs', () => {
  const listed = block(job.publish, 'RECORD_PATHS', 6).trim().split('\n').map(line => line.trim().split(' '));
  assert.deepEqual(listed, RECORD_RULES);
  const paths = listed.map(([file]) => file);
  for (const file of [CLEARANCE, 'scripts/owner/incident-2026-10-27-iocs.json', 'scripts/eliza-pin-sync.mjs', 'package.json', 'package-lock.json', '.nvmrc'])
    assert.ok(!paths.includes(file), file);
  assert.ok(paths.every(file => !file.startsWith('.github/') && fs.existsSync(file)), 'every listed record exists');
  // Executable files may change only in their commit IDs.
  for (const [file, rule] of listed) if (/\.(mjs|js|py|sh)$/.test(file)) assert.equal(rule, 'ids', file);
});

// A throwaway origin with main, then a repin made by the repin job's own commit step, then the
// publish job's own verify step, run by bash with only git and shell text tools on PATH.
const OLD = '1'.repeat(40), NEW = '2'.repeat(40);
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const write = (root, file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); };
const evidence = `docs/evidence/sdk-${NEW.slice(0, 10)}-build-input-admission-20261101.json`;
function toolbox(dir) {
  // Only the tools the two steps may use; node, npm and everything else are absent.
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const tool of ['git', 'sed', 'cmp', 'sha256sum', 'cut', 'head', 'grep', 'cat'])
    fs.symlinkSync(execFileSync('/bin/sh', ['-c', `command -v ${tool}`], {encoding: 'utf8'}).trim(), path.join(bin, tool));
  return bin;
}
let template;
function fixture() {
  template ??= origin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-sync-publish-'));
  fs.cpSync(template.dir, dir, {recursive: true, verbatimSymlinks: true});
  return {...template, dir, origin: path.join(dir, 'origin'), repin: path.join(dir, 'repin'), bin: path.join(dir, 'bin')};
}
function origin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-sync-template-'));
  const origin = path.join(dir, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q');
  write(origin, 'upstream.lock.json', `{\n  "url": "https://github.com/elizaOS/eliza.git",\n  "commit": "${OLD}"\n}\n`);
  write(origin, 'scripts/ci/calendar-bridge.py', `SDK = '${OLD}'\nprint(SDK)\n`);
  write(origin, 'docs/requirements.json', '{\n  "note": "Current source pin old."\n}\n');
  write(origin, 'package.json', '{"scripts": {}}\n');
  write(origin, '.github/workflows/ci.yml', 'on: push\n');
  write(origin, CLEARANCE, '{"repositories": {}}\n');
  git(origin, 'add', '-A');
  git(origin, 'update-index', '--add', '--cacheinfo', `160000,${OLD},vendor/eliza`);
  git(origin, 'commit', '-q', '-m', 'main');
  const main = git(origin, 'rev-parse', 'HEAD');
  const repin = path.join(dir, 'repin');
  git(dir, 'clone', '-q', `file://${origin}`, repin);
  git(repin, 'checkout', '-q', '--detach', main);
  write(repin, 'upstream.lock.json', read(path.join(repin, 'upstream.lock.json')).replace(OLD, NEW));
  write(repin, 'scripts/ci/calendar-bridge.py', `SDK = '${NEW}'\nprint(SDK)\n`);
  write(repin, 'docs/requirements.json', '{\n  "note": "Current source pin new. Previous source note: Current source pin old."\n}\n');
  write(repin, evidence, '{"to": "new"}\n');
  return {dir, origin, repin, main, bin: toolbox(dir)};
}
const bash = (script, cwd, env, bin) => spawnSync('/bin/bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {cwd, encoding: 'utf8', env: {PATH: bin, HOME: cwd, ...env}});
function repinAndPublish(fx, {mutate = () => {}, tamper = () => {}, ready = 'true'} = {}) {
  mutate(fx);
  const repinTemp = path.join(fx.dir, 'repin-temp'), publishTemp = path.join(fx.dir, 'publish-temp');
  fs.mkdirSync(path.join(repinTemp, 'out'), {recursive: true});
  fs.writeFileSync(path.join(repinTemp, 'out', 'body.md'), '### Needs a person\n- @someone review\n```\n```\n');
  const env = {MAIN: fx.main, NEW_PIN: NEW, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
  const commit = bash(step(job.repin, 'Commit and bundle'), fx.repin, {...env, READY: ready, RUNNER_TEMP: repinTemp}, fx.bin);
  assert.equal(commit.status, 0, commit.stderr);
  fs.mkdirSync(publishTemp);
  fs.cpSync(path.join(repinTemp, 'out'), path.join(publishTemp, 'repin'), {recursive: true});
  tamper({...fx, artifact: path.join(publishTemp, 'repin')});
  const output = path.join(publishTemp, 'output');
  const result = bash(step(job.publish, 'Verify the repin against main and the record allowlist'), fx.dir, {
    ...env, OLD_PIN: OLD, COMMITS: '3', REPO_URL: `file://${fx.origin}`, BASE_BRANCH: 'main', RUNNER_TEMP: publishTemp, GITHUB_OUTPUT: output,
    RECORD_PATHS: block(job.publish, 'RECORD_PATHS', 6), RECEIPT: 'Pins elizaOS/eliza `develop` (receipt from the status job).',
  }, fx.bin);
  const outputs = Object.fromEntries((fs.existsSync(output) ? read(output) : '').split('\n').filter(Boolean).map(line => line.split('=')));
  return {...result, outputs, publishTemp};
}

test('the publish job publishes a repin that keeps to the allowlist, as its own commit on main', () => {
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
  const body = read(path.join(result.publishTemp, 'body.md'));
  assert.ok(body.startsWith('Pins elizaOS/eliza `develop` (receipt from the status job).\n\n### Published commit\n'));
  assert.match(body, /every one of its 5 changed paths passed the record allowlist and matched the manifest/);
  // The repin job's report is text: an indented code block, so its mentions and fences do nothing.
  assert.ok(body.endsWith('\n\n    ### Needs a person\n    - @someone review\n    ```\n    ```\n'), body);
  fs.rmSync(fx.dir, {recursive: true, force: true});
});

test('the publish job rejects a repin outside the allowlist, beyond commit IDs, off main or unlike its manifest', () => {
  const rejects = (label, options, reason) => {
    const fx = fixture();
    const result = repinAndPublish(fx, options);
    assert.equal(result.status, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.ok(result.stdout.includes('::error::Repin rejected: ') && result.stdout.includes(reason), `${label}: ${result.stdout}`);
    assert.equal(result.outputs.verified, undefined, label);
    fs.rmSync(fx.dir, {recursive: true, force: true});
  };
  rejects('a dependency manifest', {mutate: ({repin}) => write(repin, 'package.json', '{"scripts": {"postinstall": "node x"}}\n')}, 'package.json is not on the record allowlist');
  rejects('a workflow', {mutate: ({repin}) => write(repin, '.github/workflows/ci.yml', 'on: push\npermissions: write-all\n')}, '.github/workflows/ci.yml is not on the record allowlist');
  rejects('the clearance record', {mutate: ({repin}) => write(repin, CLEARANCE, '{"repositories": {"elizaOS/eliza": {"forgedCommits": [], "record": "me"}}}\n')}, `${CLEARANCE} is not on the record allowlist`);
  rejects('code beyond its IDs', {mutate: ({repin}) => write(repin, 'scripts/ci/calendar-bridge.py', `SDK = '${NEW}'\nprint(SDK)\nimport os\n`)}, 'scripts/ci/calendar-bridge.py changed beyond its commit IDs');
  rejects('a pin file beyond its IDs', {mutate: ({repin}) => write(repin, 'upstream.lock.json', `{\n  "url": "https://github.com/someone/eliza.git",\n  "commit": "${NEW}"\n}\n`)}, 'upstream.lock.json changed beyond its commit IDs');
  rejects('another gitlink', {tamper: ({repin, main, artifact}) => {
    git(repin, 'update-index', '--cacheinfo', `160000,${'3'.repeat(40)},vendor/eliza`);
    git(repin, 'commit', '-q', '--amend', '--no-edit');
    git(repin, 'update-ref', 'refs/heads/eliza-pin-sync', 'HEAD');
    git(repin, 'bundle', 'create', '-q', path.join(artifact, 'repin.bundle'), 'refs/heads/eliza-pin-sync', `^${main}`);
  }}, `vendor/eliza must move to the new pin ${NEW}`);
  rejects('a symlinked record', {mutate: ({repin}) => { fs.rmSync(path.join(repin, 'docs/requirements.json')); fs.symlinkSync('/etc/passwd', path.join(repin, 'docs/requirements.json')); }}, 'docs/requirements.json has mode 120000');
  rejects('a second commit', {mutate: ({repin}) => { git(repin, 'commit', '-q', '-am', 'extra'); }}, 'is not one commit on main');
  rejects('a tampered manifest', {tamper: ({artifact}) => fs.appendFileSync(path.join(artifact, 'manifest.txt'), `${'0'.repeat(64)}  package.json\n`)}, 'the manifest does not match the bundle');
  rejects('a bad ready flag', {ready: 'yes'}, 'the ready flag is neither true nor false');
});

test('the publish job publishes nothing when main moved during the repin', () => {
  const fx = fixture();
  const result = repinAndPublish(fx, {mutate: ({origin}) => { write(origin, 'README.md', 'moved\n'); git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'moved'); }});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::notice::main moved from [0-9a-f]{40} to [0-9a-f]{40} during the repin; nothing is published/);
  assert.equal(result.outputs.verified, undefined);
  fs.rmSync(fx.dir, {recursive: true, force: true});
});
