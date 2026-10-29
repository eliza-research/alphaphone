// Alpha and Eliza are two brands of one shared mobile application: their functional feature
// manifests (the shared mobileFeatureManifest emitter over each product registration) may differ
// only by identity and theme. The differences still open, and the Alpha source that still owns
// behaviour, are listed in config/feature-parity.json, which may only shrink.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {featureParity} from '../scripts/feature-manifest.mjs';

const allowlist = JSON.parse(fs.readFileSync('config/feature-parity.json', 'utf8'));
const parity = await featureParity();
const regenerate = 'Run node scripts/feature-manifest.mjs --parity to see the current lists.';

test('Alpha and Eliza differ functionally only where the shrink-only allowlist says so', () => {
  const allowed = Object.keys(allowlist.differences);
  const unexplained = parity.differences.filter(key => !allowed.includes(key));
  assert.deepEqual(unexplained, [], `New functional difference from Eliza. Move the behaviour upstream or into both registrations; the allowlist never grows. ${regenerate}`);
  const closed = allowed.filter(key => !parity.differences.includes(key));
  assert.deepEqual(closed, [], `These differences are closed: remove them from config/feature-parity.json and lower ceiling.differences. ${regenerate}`);
  assert.ok(allowed.length <= allowlist.ceiling.differences, 'the difference allowlist only shrinks');
  for (const [key, owner] of Object.entries(allowlist.differences))
    assert.ok(typeof owner === 'string' && owner.trim(), `${key} names the Alpha module or decision that owns it`);
});

test('no new Alpha-owned behavioural module; moved modules leave the allowlist', () => {
  const listed = new Set(allowlist.modules);
  const added = parity.modules.filter(file => !listed.has(file));
  assert.deepEqual(added, [], `New Alpha-owned behaviour. Shared behaviour belongs upstream; Alpha keeps identity, theme and registration (apps/app/src/product). ${regenerate}`);
  const gone = allowlist.modules.filter(file => !parity.modules.includes(file));
  assert.deepEqual(gone, [], `These modules are gone: remove them from config/feature-parity.json and lower ceiling.modules. ${regenerate}`);
  assert.ok(allowlist.modules.length <= allowlist.ceiling.modules, 'the module allowlist only shrinks');
  assert.deepEqual(allowlist.modules, [...allowlist.modules].sort(), 'modules stay sorted');
});

test('branding never counts as a functional difference, and the launcher is shared by both brands', () => {
  assert.equal(allowlist.reference, 'ELIZA_MOBILE_PRODUCT');
  assert.equal(parity.alpha.branding.appId, 'ai.elizaresearch.alphaphone');
  assert.equal(parity.eliza.branding.appId, 'ai.elizaos.app');
  assert.equal(parity.alpha.branding.storage.launcherFavorites, 'alpha.launcher.favorites.v1');
  assert.equal(parity.eliza.branding.storage.launcherFavorites, 'eliza.launcher.favorites.v1');
  for (const capability of ['launcher.installed-apps', 'launcher.default-dial', 'launcher.favorites']) {
    assert.ok(parity.alpha.functional.capabilities.includes(capability), `Alpha provides ${capability}`);
    assert.ok(parity.eliza.functional.capabilities.includes(capability), `Eliza provides ${capability}`);
  }
  assert.ok(!parity.differences.some(key => key.startsWith('capability:launcher.')), 'one launcher for both brands');
  // Identity-only fields of the two records never surface in the functional part.
  assert.doesNotMatch(JSON.stringify(parity.alpha.functional), /alpha|Alpha/);
});

test('the Alpha manifest is deterministic and served views appear on both sides', async () => {
  const again = await featureParity();
  assert.equal(JSON.stringify(again.alpha), JSON.stringify(parity.alpha));
  const calendar = parity.alpha.functional.views.find(view => view.id === 'calendar');
  assert.deepEqual(calendar?.serves, ['reminders']);
});
