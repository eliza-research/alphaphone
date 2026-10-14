import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

// Issue #404 (P-20): every eligible login surface in Alpha supports password-manager fill,
// website fills bind to the committed HTTPS origin, app fills to verified app identity, and
// secrets never reach observations, transcripts or logs. config/login-surfaces.json is the
// inventory; these source guards keep a new login field from landing unregistered or unwired.
// They do not establish device behaviour: see remainingGates in the inventory.
const read = file => fs.readFileSync(file, 'utf8');
const inventory = JSON.parse(read('config/login-surfaces.json'));
const plugin = read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaBrowserPlugin.java');

function walk(dir, accept, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, accept, out); }
    else if (accept(full)) out.push(full);
  }
  return out;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Signals that a field holds a reusable credential. A field that only says autocomplete="off"
// is not detected; pairing codes are registered for documentation, not discovered.
const RENDERER_DETECTORS = [
  /\btype\s*[=:]\s*\{?\s*["']password["']/gi,
  /\btype\s*=\s*password\b/gi, // unquoted HTML attribute
  /\btype\s*=\s*\{[^}\n]*password[^}\n]*\}/gi, // dynamic type={show ? 'text' : 'password'}
  /\bauto[cC]omplete\s*[=:]\s*\{?\s*["'][^"']*\b(?:username|current-password|new-password|one-time-code|webauthn)\b[^"']*["']/gi,
  /\binput\([^\n]*?,\s*'password',/g,
  /(?:-webkit-)?text-security\s*:|[wW]ebkitTextSecurity|textSecurity\s*:/g, // masked text that is not type=password
];
const NATIVE_DETECTORS = [
  /textPassword|textWebPassword|numberPassword|textVisiblePassword/g,
  /TYPE_TEXT_VARIATION_(?:WEB_|VISIBLE_)?PASSWORD|TYPE_NUMBER_VARIATION_PASSWORD/g,
  /autofillHints|setAutofillHints|AUTOFILL_HINT_(?:PASSWORD|USERNAME)/g,
  /PasswordTransformationMethod|PasswordVisualTransformation|KeyboardType\.Password/g,
  /setInputType\(\s*(?:0x[0-9a-fA-F]+|\d+)\s*\)|android:inputType\s*=\s*"(?:0x[0-9a-fA-F]+|\d+)"/g, // numeric input types hide a password variation
];
const registered = inventory.surfaces.filter(surface => surface.file);

test('the inventory covers websites, other apps and every Alpha-owned secret field', () => {
  const ids = new Set(inventory.surfaces.map(surface => surface.id));
  assert.equal(ids.size, inventory.surfaces.length, 'unique surface ids');
  for (const id of ['browser-website-login', 'third-party-app-login', 'eliza-cloud-sign-in']) assert.ok(ids.has(id), id);
  for (const surface of inventory.surfaces) {
    assert.equal(typeof surface.eligible, 'boolean', surface.id);
    if (surface.eligible) {
      assert.ok(inventory.rules[surface.binding], `${surface.id} names a binding rule`);
      assert.ok(surface.providers?.integrated && (surface.providers.proton || surface.providers.other), `${surface.id} states both the integrated vault and an optional provider`);
      assert.ok(Array.isArray(surface.remainingGates) && surface.remainingGates.length, `${surface.id} lists its remaining acceptance gates`);
    } else {
      assert.ok(surface.reason?.length > 20, `${surface.id} explains why it is not a fill target`);
    }
  }
  assert.equal(inventory.surfaces.find(s => s.id === 'browser-website-login').binding, 'websiteBinding');
  assert.equal(inventory.surfaces.find(s => s.id === 'third-party-app-login').binding, 'appBinding');
});

test('no Alpha-owned login form is eligible until it has a provider-owned native fill route', () => {
  // The renderer WebView is excluded from Autofill, so registering an Alpha-owned form as
  // eligible without a native credential surface would be a false claim.
  for (const surface of inventory.surfaces.filter(s => s.kind === 'alpha-owned')) {
    assert.equal(surface.eligible, false, `${surface.id}: build a native credential surface first (rules.rendererWebView)`);
  }
  // A native Alpha-owned surface is eligible only when every field reports an authoritative origin.
  const native = inventory.surfaces.filter(s => s.kind === 'alpha-owned-native' && s.eligible);
  assert.equal(inventory.surfaces.find(s => s.id === 'browser-http-auth-prompt').eligible, false);
  for (const surface of native) {
    const source = read(surface.file);
    assert.ok(surface.fillRoute, surface.id);
    assert.match(source, /extras\.putString\(PasswordFormPolicy\.TOP_ORIGIN_EXTRA,origin\);/, surface.id);
    assert.match(source, /extras\.putString\(PasswordAutofillPolicy\.FIELD_ORIGIN,origin\);/, surface.id);
    assert.match(source, /structure\.setWebDomain\(origin\);/, surface.id);
    assert.match(source, /if\(origin==null\)\{field\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO\);return field;\}/, `${surface.id} fails closed without an origin`);
  }
});

test('the HTTP authentication prompt excludes provider fill without authenticated origin', () => {
  const auth = read('android/app/src/main/java/ai/elizaresearch/alphaphone/BrowserHttpAuthAutofill.java');
  // The origin rule itself is executed on the JVM below.
  assert.match(auth, /static String origin\(String reportedHost,String pendingMain,String documentUrl,boolean committed,java\.util\.Collection<String> otherRequests\)\{ return BrowserHttpAuthOrigin\.forChallenge\(reportedHost,pendingMain,documentUrl,committed,otherRequests\); \}/);
  assert.match(auth, /InputType\.TYPE_CLASS_TEXT\|\(password\?InputType\.TYPE_TEXT_VARIATION_PASSWORD:InputType\.TYPE_TEXT_FLAG_NO_SUGGESTIONS\)/, 'exactly one password-typed field');
  assert.doesNotMatch(auth, /getAutofillValue|getText\(\)/, 'Alpha never reads provider values back');
  // Observed request history is supplied for compatibility, but cannot authenticate a challenge.
  assert.match(plugin, /String authOrigin=BrowserHttpAuthAutofill\.origin\(host,t\.pendingMain,t\.url,t\.committed,t\.requestOriginsOverflow\?null:t\.requestOrigins\);/);
  assert.match(plugin, /if \(r\.isForMainFrame\(\)\) t\.pendingMain=r\.getUrl\(\)\.toString\(\); else recordRequestOrigin\(t,r\.getUrl\(\)\.toString\(\)\);/, 'every frame and resource origin is recorded');
  assert.match(plugin, /if\(t\.requestOrigins\.size\(\)>=MAX_REQUEST_ORIGINS\)t\.requestOriginsOverflow=true;/, 'an overflowed record refuses binding');
  // No tab is fillable while any site prompt is open, including after a provider unlock resumes the activity.
  const can = plugin.slice(plugin.indexOf('private boolean canAutofill(Tab t)'), plugin.indexOf('private void cancelAutofill(Tab t)'));
  assert.match(can, /state\.overlay=siteDialog!=null;/);
  assert.match(can, /return BrowserAutofillEligibility\.eligible\(state\);/);
  assert.match(plugin, /dismissSiteDialogs\(\);siteDialog=dialog;siteDialogTab=t;siteDialogCancel=cancel;siteDialogAutofill=false;\n\s*for\(Tab tab:tabs\.values\(\)\)disableAutofill\(tab\);/);
  // Save waits for the site: Sign in keeps the prompt open; commit() only when the load commits at the bound origin.
  assert.match(plugin, /\.setPositiveButton\("Sign in",null\)\.setNegativeButton\("Cancel",null\)\.create\(\);/);
  assert.match(plugin, /t\.authSaveOrigin=authOrigin;\n\s*v\.setEnabled\(false\);dialog\.setMessage\(message\+"\\n\\nSigning in…"\);\n\s*handler\.proceed\(u,p\);/);
  assert.doesNotMatch(plugin.slice(plugin.indexOf('private void httpAuth('), plugin.indexOf('// ---- Camera for capture-enabled')), /\.commit\(\)/, 'the prompt itself never commits');
  const finish = plugin.slice(plugin.indexOf('private void finishAuthSave('), plugin.indexOf('private void finishAuthSave(') + 700);
  assert.match(finish, /boolean accepted=committedUrl!=null&&origin\.equals\(BrowserHttpAuthOrigin\.exactHttps\(committedUrl\)\)&&t\.httpStatus!=401&&t\.httpStatus!=407;/);
  assert.match(finish, /if\(accepted\)\{siteDialogAutofill=false;AutofillManager manager=[^\n]*manager\.commit\(\);\}\n\s*dismissSiteDialogs\(\);/);
  assert.match(plugin, /finishAuthSave\(t,url\); syncAutofill\(t\);/, 'resolved before the tab can become fillable');
  assert.match(plugin, /\/\/ A repeated challenge means the previous answer was not accepted: never offer to save it\.\n\s*finishAuthSave\(t,null\);/);
  assert.match(plugin, /private void fail\(Tab t, String message\) \{ finishAuthSave\(t,null\);/);
  // Dismissal cancels first: a provider may save when every field becomes invisible.
  assert.match(plugin, /if\(siteDialogAutofill\)\{siteDialogAutofill=false;AutofillManager manager=getActivity\(\)\.getSystemService\(AutofillManager\.class\);if\(manager!=null\)manager\.cancel\(\);\}\n\s*dialog\.dismiss\(\);/);
  assert.match(plugin, /dialog\.setCancelable\(authOrigin==null\);dialog\.setCanceledOnTouchOutside\(false\);/);
  // The password manager is named only when Android has an Autofill service enabled.
  assert.match(plugin, /boolean autofillOn=authOrigin!=null&&autofillState!=null&&autofillState\.isEnabled\(\);/);
});

/** Every detector hit whose line no registered pattern for that file covers (per line, not per file). */
function unregisteredHits(files, detectors) {
  const hits = [];
  for (const file of files) {
    const text = read(file);
    const coveredLines = new Set();
    for (const surface of registered.filter(entry => entry.file === file)) {
      for (const match of text.matchAll(new RegExp(surface.pattern, 'g'))) coveredLines.add(lineOf(text, match.index));
    }
    for (const detector of detectors) {
      for (const match of text.matchAll(detector)) {
        const line = lineOf(text, match.index);
        if (!coveredLines.has(line)) hits.push(`${file}:${line} ${match[0]}`);
      }
    }
  }
  return hits;
}

test('every renderer credential field is registered in config/login-surfaces.json', () => {
  const files = walk('apps/app/src', file => /\.(ts|tsx|js|jsx|mjs|cjs|html|css)$/.test(file) && !/\.test\./.test(file));
  assert.deepEqual(unregisteredHits(files, RENDERER_DETECTORS), [], 'register each new credential field (and wire its fill route if eligible)');
});

test('the detectors catch the field shapes they claim to', () => {
  const samples = {
    renderer: ['<input type=password>', '<input type={reveal ? "text" : "password"}>', "style={{WebkitTextSecurity:'disc'}}", '.pin{-webkit-text-security:disc}', '<input autoComplete="current-password">'],
    native: ['android:inputType="textVisiblePassword"', 'InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD', 'new PasswordTransformationMethod()', 'field.setInputType(0x81)', 'android:inputType="129"'],
  };
  for (const sample of samples.renderer) assert.ok(RENDERER_DETECTORS.some(detector => new RegExp(detector.source, detector.flags).test(sample)), sample);
  for (const sample of samples.native) assert.ok(NATIVE_DETECTORS.some(detector => new RegExp(detector.source, detector.flags).test(sample)), sample);
});

test('each registered Alpha-owned field still exists exactly as inventoried', () => {
  for (const surface of registered) {
    const matches = [...read(surface.file).matchAll(new RegExp(surface.pattern, 'g'))];
    assert.equal(matches.length, surface.count ?? 1, `${surface.id} in ${surface.file}`);
  }
});

test('native Alpha UI declares no unregistered credential fields', () => {
  // Every Android module's source sets (app, launcher, embedding-host, local-speech, fixtures), per line.
  const roots = fs.readdirSync('android', {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => path.join('android', entry.name, 'src')).filter(dir => fs.existsSync(dir));
  assert.ok(roots.includes(path.join('android', 'app', 'src')));
  const files = roots.flatMap(root => walk(root, file => /\.(java|kt|xml)$/.test(file) && !/[\\/](test|androidTest)[\\/]/.test(file)));
  assert.deepEqual(unregisteredHits(files, NATIVE_DETECTORS), []);
});

test('website fills bind to the committed HTTPS top-level origin of an eligible tab', () => {
  assert.match(plugin, /getBridge\(\)\.getWebView\(\)\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS\);/, 'the privileged renderer WebView is never an Autofill target');
  const credential = plugin.slice(plugin.indexOf('private final class CredentialWebView'), plugin.indexOf('static String topOrigin('));
  assert.match(credential, /onProvideAutofillVirtualStructure\(ViewStructure structure,int flags\) \{\n\s*if\(canAutofill\(tab\)\) \{/);
  assert.match(credential, /String origin=topOrigin\(tab\.url\);\n\s*if\(origin!=null && structure\.getExtras\(\)!=null\)structure\.getExtras\(\)\.putString\(PasswordFormPolicy\.TOP_ORIGIN_EXTRA,origin\);/);
  assert.match(credential, /else structure\.setChildCount\(0\);/, 'an ineligible tab exposes no fields');
  assert.match(credential, /public void autofill\(SparseArray<AutofillValue> values\) \{\n\s*if\(canAutofill\(tab\)\)super\.autofill\(values\);/, 'late values for an ineligible tab are dropped');
  const top = plugin.slice(plugin.indexOf('static String topOrigin('));
  assert.match(top.slice(0, 600), /https/, 'only HTTPS origins are reported');
  // Upstream policy: cross-origin frames and missing per-field origins are refused for the integrated vault.
  const policy = read('vendor/eliza/plugins/plugin-native-passwords/android/src/main/java/ai/eliza/plugins/passwords/PasswordFormPolicy.java');
  assert.match(policy, /throw new Rejected\("Cross-origin frame"\)/);
  assert.match(policy, /throw new Rejected\("Field origin unavailable"\)/);
  assert.match(policy, /throw new Rejected\("Host interface is never filled"\)/);
});

test('secrets stay out of observations, transcripts and logs', () => {
  const client = read('apps/app/src/runtime/alpha-client.ts');
  const context = client.slice(client.indexOf('export interface ViewContext'), client.indexOf('export interface VerifiedSession'));
  // The observation is identity-only: no field values, page text, usernames or origins.
  assert.doesNotMatch(context, /\b(value|password|username|text|url|origin|fields?)\??:/i);
  const adapter = read('apps/app/src/prototype/agent-adapter.ts');
  assert.match(adapter, /sensitive: view === 'wallet' \|\| \(view === 'settings' && passwordSurfaceOpen\(shell\.vget\('settings'\)\)\)[^\n]*connectionController\.getSnapshot\(\)\.open,/, 'password pages and connection sheets (provider key, pairing) suspend observation');
  for (const file of ['apps/app/src/passwords/password-manager.ts', 'apps/app/src/browser/password-provider.ts', 'apps/app/src/prototype/browser-adapter.ts']) {
    assert.doesNotMatch(read(file), /console\.(log|info|warn|error|debug)\(/, `${file} does not log`);
  }
  for (const file of ['AlphaBrowserPlugin.java', 'PasswordProviderSupport.java', 'BrowserPasskeys.java']) {
    const text = read('android/app/src/main/java/ai/elizaresearch/alphaphone/' + file);
    const logs = [...text.matchAll(/(?:android\.util\.)?Log\.[vdiwe]\([^;]*;/g)].map(match => match[0]);
    for (const line of logs) assert.doesNotMatch(line, /url|value|password|username|structure|getText|origin/i, `${file}: ${line}`);
    assert.doesNotMatch(text, /printStackTrace\(/, file);
  }
  // Autofill values are never read back into the bridge.
  assert.doesNotMatch(plugin, /getAutofillValue\(|AutofillValue\.forText|\.getTextValue\(\)/);
});

// Plain-JVM run of the challenge origin rule and of the pinned upstream PasswordFormPolicy against
// the field shape the HTTP authentication prompt reports. No APK, device, provider or vault.
test('the pinned password policy admits the HTTP auth prompt only for its exact verified origin', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'login-binding-'));
  const java = process.env.JAVA_HOME || (process.platform === 'darwin' ? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home' : '');
  const binary = name => java ? path.join(java, 'bin', name) : name;
  try {
    execFileSync(binary('javac'), ['--release', '17', '-d', temporary,
      'android/app/src/main/java/ai/elizaresearch/alphaphone/BrowserHttpAuthOrigin.java',
      'vendor/eliza/plugins/plugin-native-passwords/android/src/main/java/ai/eliza/plugins/passwords/PasswordFormPolicy.java',
      'vendor/eliza/plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/PasswordFacets.java',
      'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserAutofillEligibility.java',
      'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserWebOrigin.java',
      'test/fixtures/LoginBindingTest.java'], {timeout: 60000});
    assert.match(execFileSync(binary('java'), ['-cp', temporary, 'ai.elizaresearch.alphaphone.LoginBindingTest'], {encoding: 'utf8', timeout: 60000}), /^PASS login binding \d+/);
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
