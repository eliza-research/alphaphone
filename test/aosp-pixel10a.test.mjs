import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pixel10aOptions, writePixel10aProduct} from '../scripts/aosp-pixel10a.mjs';

function assertSingleProductRegistration(output) {
  const staged = fs.readdirSync(output, {recursive:true});
  assert.deepEqual(staged.filter(file => path.basename(file) === 'AndroidProducts.mk'), ['AndroidProducts.mk']);
  assert.deepEqual(staged.filter(file => path.basename(file) === 'alpha_stallion_phone.mk'), ['alpha_stallion_phone.mk']);
  const source = path.resolve('vendor/eliza/packages/os/android/devices/pixel10a');
  // Preserve every other board, policy and patch input, including future additions.
  for (const relative of fs.readdirSync(source, {recursive:true})) {
    if (['AndroidProducts.mk', 'alpha_stallion_phone.mk'].includes(relative)) continue;
    if (fs.statSync(path.join(source, relative)).isFile()) {
      assert.deepEqual(fs.readFileSync(path.join(output, 'stallion', relative)), fs.readFileSync(path.join(source, relative)), relative);
    }
  }
}

test('physical target requires explicit development or production and exact source/factory inputs', () => {
  const options = {target:'pixel10a', development:true, source:'/source', factory:'/factory'};
  assert.equal(pixel10aOptions(options), true);
  assert.equal(pixel10aOptions({...options, development:false, production:true}), true);
  assert.equal(pixel10aOptions({development:true, target:null}), false);
  assert.equal(pixel10aOptions({production:true}), false);
  for (const change of [{target:'stallion'}, {development:false}, {production:true}, {source:null}, {factory:null}]) assert.throws(() => pixel10aOptions({...options, ...change}));
  assert.throws(() => pixel10aOptions({factory:'/factory'}));
});

test('physical overlay installs ARM64 JNI and development product without boot claims', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pixel-stage-'));
  t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
  const apk = path.join(temporary, 'input.apk'), output = path.join(temporary, 'overlay');
  fs.mkdirSync(output);
  execFileSync('python3', ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('lib/arm64-v8a/libcamera.so',b'\\x7fELF\\x02\\x01'+bytes(12)+b'\\xb7\\x00'+bytes(44)); z.close()", apk]);
  fs.writeFileSync(path.join(output, 'Android.bp'), '// Generated from a hash- and signer-verified downstream launcher.\nandroid_app_import {\n    name: "AlphaPhone",\n    apk: "Launcher.apk",\n    presigned: true,\n    preprocessed: true,\n    product_specific: true,\n    dex_preopt: { enabled: false },\n}\n');
  fs.copyFileSync(apk,path.join(output,'Launcher.apk'));
  fs.writeFileSync(path.join(output, 'product.mk'), '# existing camera, clock and image capability\n');
  writePixel10aProduct({root:process.cwd(), output, apk, identity:{moduleName:'AlphaPhone'}, launcher:{schemaVersion:1,brand:'alphaphone',moduleName:'AlphaPhone',packageName:'ai.elizaresearch.alphaphone',apkSha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),certificateSha256:'b'.repeat(64)}, sourceEvidence:{fixture:true}});
  assertSingleProductRegistration(output);
  const product = fs.readFileSync(path.join(output, 'product.mk'), 'utf8');
  assert.match(product, /existing camera, clock and image capability/);
  assert.match(product, /TARGET_FS_CONFIG_GEN \+= vendor\/alphaphone\/config.fs/);
  assert.match(fs.readFileSync(path.join(output, 'AndroidProducts.mk'), 'utf8'), /alpha_stallion_phone/);
  assert.ok(fs.existsSync(path.join(output, 'stallion/vendor-config/Android.bp')));
  const report = JSON.parse(fs.readFileSync(path.join(output, 'physical-product.json')));
  assert.equal(report.developmentOnly, true);
  for (const key of ['imageBuilt','releaseQualified','deviceAcceptanceVerified']) assert.equal(report[key], false);
});

test('production physical overlay sets no board AVB variables and records no build, signing or acceptance', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pixel-production-'));
  t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
  const apk = path.join(temporary, 'input.apk'), output = path.join(temporary, 'overlay');
  fs.mkdirSync(output);
  execFileSync('python3', ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('lib/arm64-v8a/libcamera.so',b'\\x7fELF\\x02\\x01'+bytes(12)+b'\\xb7\\x00'+bytes(44)); z.close()", apk]);
  fs.writeFileSync(path.join(output, 'Android.bp'), '// Generated from a hash- and signer-verified downstream launcher.\nandroid_app_import {\n    name: "AlphaPhone",\n    apk: "Launcher.apk",\n    presigned: true,\n    preprocessed: true,\n    product_specific: true,\n    dex_preopt: { enabled: false },\n}\n');
  fs.copyFileSync(apk,path.join(output,'Launcher.apk'));
  fs.writeFileSync(path.join(output, 'product.mk'), '# existing\n');
  writePixel10aProduct({root:process.cwd(), output, apk, identity:{moduleName:'AlphaPhone'}, launcher:{schemaVersion:1,brand:'alphaphone',moduleName:'AlphaPhone',packageName:'ai.elizaresearch.alphaphone',apkSha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),certificateSha256:'b'.repeat(64)}, sourceEvidence:{fixture:true}, production:true});
  assertSingleProductRegistration(output);
  const productMk = fs.readFileSync(path.join(output, 'product.mk'), 'utf8');
  assert.doesNotMatch(productMk, /BOARD_AVB_|release-avb/);
  assert.equal(fs.existsSync(path.join(output, 'stallion/release-avb.mk')), false);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'physical-product.json')));
  assert.equal(report.production, true);
  assert.equal(report.lunch, 'alpha_stallion_phone-cp2a-user');
  assert.equal(report.productDescriptor.file, 'android/aosp/pixel10a-product.json');
  for (const key of ['imageBuilt','imageSigned','releaseQualified','deviceAcceptanceVerified']) assert.equal(report[key], false, key);
});

test('native admission fixtures cover corrupt provenance, policy, ELF and overlay inputs', () => {
  execFileSync('python3', ['test/aosp-native-fixtures.py'], {stdio:'pipe'});
});
