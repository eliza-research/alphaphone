// Source-level product identity and storage namespace (AP-01). This reads committed source only;
// built-APK identity is checked by scripts/apk.mjs and is separate evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {hostIdentity, readHostDescriptor} from '../scripts/android-host.mjs';

const identity = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
// The generated host's app script comes from the pinned upstream template.
const gradle = fs.readFileSync('vendor/eliza/packages/app/scripts/mobile/android/consumer-host/app.gradle', 'utf8');
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(file, out);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name)) out.push(file);
  }
  return out;
}

const STORAGE_CALL = /\.(?:getItem|setItem|removeItem)\(\s*(?:(['"`])((?:(?!\1)[^\\$])*)|([A-Za-z_$][\w$]*)\s*[,)])/g;
const PREFIXES = ['alpha.', 'alphaphone:'];
const FOREIGN = /milady|eliza:|senior/i;

/** Literal localStorage keys under a source tree: direct string arguments and the string constants passed by name. */
function literalStorageKeys(root) {
  const files = sources(root).map(file => ({file, text: fs.readFileSync(file, 'utf8')}));
  const names = new Set(), keys = [];
  for (const {file, text} of files) {
    for (const match of text.matchAll(STORAGE_CALL)) {
      if (match[3]) names.add(match[3]);
      // A template or concatenated key is checked by its literal prefix.
      else if (match[2]) keys.push({file, key: match[2]});
    }
  }
  for (const {file, text} of files) {
    for (const name of names) {
      const declared = new RegExp(`(?:^|[\\s,;{(])${name.replace(/\$/g, '\\$')}\\s*=\\s*(['"])([^'"]+)\\1`, 'g');
      for (const match of text.matchAll(declared)) keys.push({file, key: match[2]});
    }
  }
  return keys;
}

test('app.config.json carries the Alpha Phone identity', () => {
  assert.equal(identity.appId, 'ai.elizaresearch.alphaphone');
  assert.equal(identity.appName, 'Alpha Phone');
});

test('the Android build derives namespace, applicationId and app_name from app.config.json', () => {
  // scripts/android-host.mjs hands app.config.json to the generator; the descriptor carries no identity.
  assert.deepEqual(hostIdentity('.'), {appId: identity.appId, appName: identity.appName, version: identity.version, versionCode: identity.versionCode});
  const {profile} = readHostDescriptor('.');
  assert.doesNotMatch(JSON.stringify(profile), /applicationId|appName|"identity"/);
  assert.match(gradle, /^def identity = profile\.identity$/m);
  assert.match(gradle, /^\s*namespace identity\.appId\s*$/m);
  assert.match(gradle, /^\s*applicationId identity\.appId\s*$/m);
  // The generator writes the non-translatable app_name from identity.appName.
  assert.match(fs.readFileSync('vendor/eliza/packages/app/scripts/mobile/android/consumer-host.mjs', 'utf8'), /<string name="app_name" formatted="false" translatable="false">/);
  assert.doesNotMatch(gradle, /applicationId\s+['"]/, 'no hard-coded applicationId');
  assert.doesNotMatch(gradle, /applicationIdSuffix/);
});

test('the manifest keeps backup off and every authority and task affinity scoped to ${applicationId}', () => {
  assert.match(manifest, /<application [^>]*android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /android:allowBackup="true"/);
  const authorities = [...manifest.matchAll(/android:authorities="([^"]+)"/g)].map(match => match[1]);
  assert.ok(authorities.length > 0);
  for (const value of authorities) for (const authority of value.split(';')) assert.match(authority, /^\$\{applicationId\}\./, authority);
  for (const [, affinity] of manifest.matchAll(/android:taskAffinity="([^"]+)"/g)) assert.match(affinity, /^\$\{applicationId\}\./, affinity);
  assert.match(manifest, /android:label="@string\/app_name"/);
});

test('every literal localStorage key under apps/app/src uses an Alpha prefix', () => {
  const keys = literalStorageKeys('apps/app/src');
  assert.ok(keys.length >= 20, `found only ${keys.length} keys; the scan no longer sees the storage calls`);
  for (const {file, key} of keys) {
    // Preserve the original durable Alpha onboarding key; renaming would lose completed installs.
    const historicalSetup = file === 'apps/app/src/startup-permission-progress.ts' && key === 'alpha:startup-permission-walkthrough:v1'
      || file === 'apps/app/src/startup-permissions.tsx' && ['alpha:startup-permission-progress:v1','alpha:startup-permissions-dismissed:v1'].includes(key);
    assert.ok(historicalSetup || PREFIXES.some(prefix => key.startsWith(prefix)), `${file}: ${JSON.stringify(key)} lacks an alpha. or alphaphone: prefix`);
    assert.doesNotMatch(key, FOREIGN, `${file}: ${JSON.stringify(key)} uses another product's prefix`);
  }
});

test('the key scan would catch an unprefixed or foreign key', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-identity-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'a.ts'), "const k='milady.theme';localStorage.getItem(k);localStorage.setItem('eliza:x','1');localStorage.getItem(`alpha.dev.${n}`);");
  assert.deepEqual(literalStorageKeys(dir).map(row => row.key).sort(), ['alpha.dev.', 'eliza:x', 'milady.theme']);
});
