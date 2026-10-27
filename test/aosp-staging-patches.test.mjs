import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {reviewedSourceOverrides} from '../scripts/stage-aosp.mjs';
import {verifySecureCameraSource} from '../scripts/aosp-secure-camera-contract.mjs';

test('secure camera staging accepts exact reviewed SystemUI changes without admitting other source changes', t => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-staging-patches-'));
  t.after(() => fs.rmSync(source, {recursive:true, force:true}));
  const directory = path.join(source, 'framework'); fs.mkdirSync(directory);
  const hash = text => createHash('sha256').update(text).digest('hex');
  const git = (...args) => execFileSync('git', args, {cwd:directory, encoding:'utf8'}).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(directory, 'camera.txt'), 'camera');
  fs.writeFileSync(path.join(directory, 'ui.txt'), 'before');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const revision = git('rev-parse', 'HEAD');
  const lockPath = path.join(source, 'lock.json');
  fs.writeFileSync(lockPath, JSON.stringify({projects:[{path:'framework', commit:revision}], overrides:[]}));
  const manifest = {project:'framework', revision, baselineLockSha256:hash(fs.readFileSync(lockPath)), files:[
    {path:'ui.txt', beforeSha256:hash('before'), afterSha256:hash('after')},
    {path:'Chip.java', beforeSha256:null, afterSha256:hash('chip')},
  ]};
  fs.writeFileSync(path.join(directory, 'ui.txt'), 'after');
  fs.writeFileSync(path.join(directory, 'Chip.java'), 'chip');
  const contract = {modules:[{path:'framework', commit:revision, files:{'camera.txt':hash('camera')}}]};
  const options = {source, cuttlefish:true, lockPath, appliedPatches:[{manifest}]};
  const overrides = () => reviewedSourceOverrides(options);
  assert.equal(verifySecureCameraSource(source, contract, overrides()).sourceVerified, true);
  fs.writeFileSync(path.join(directory, 'Chip.java'), 'tampered');
  assert.throws(overrides, /patch bytes differ/);
  fs.writeFileSync(path.join(directory, 'Chip.java'), 'chip');
  manifest.files[0].beforeSha256 = hash('wrong');
  assert.throws(overrides, /preimage differs/);
  manifest.files[0].beforeSha256 = hash('before');
  manifest.baselineLockSha256 = '0'.repeat(64);
  assert.throws(overrides, /source lock differs/);
  manifest.baselineLockSha256 = hash(fs.readFileSync(lockPath));
  options.appliedPatches.push({manifest});
  assert.throws(overrides, /overlaps/);
  options.appliedPatches.pop();
  fs.writeFileSync(path.join(directory, 'unreviewed.java'), 'extra');
  assert.throws(() => verifySecureCameraSource(source, contract, overrides()), /not clean/);
});
