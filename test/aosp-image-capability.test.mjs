// Alpha AOSP image capability (P-36, issue #420): renderer detection, image staging output and the
// native gating contract, checked from source. No APK build, emulator or image boot is involved.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectAospImage, admittedAospViews, AOSP_IMAGE_VIEWS, ADMITTED_AOSP_VIEW_ADAPTERS } from "../apps/app/src/runtime/aosp-image.ts";
import { IMAGE_FEATURE_VERSION, imageFeatureName, renderImageCapability, writeImageCapability } from "../scripts/aosp-image-capability.mjs";

const PKG = "ai.elizaresearch.alphaphone";
const read = file => fs.readFileSync(file, "utf8");
const JAVA = "android/app/src/main/java/ai/elizaresearch/alphaphone";
const header = (methods = ["imageCapability", "status"]) => ({ name: "AlphaTelephony", methods: methods.map(name => ({ name, rtype: "promise" })) });

test("the renderer sees the image only through the native image-only plugin on Android", () => {
  assert.equal(detectAospImage("android", [header()]), true);
  assert.equal(detectAospImage("web", [header()]), false, "a browser never has the image");
  assert.equal(detectAospImage("ios", [header()]), false);
  assert.equal(detectAospImage("android", []), false, "standalone and sideloaded launcher installs register no plugin");
  assert.equal(detectAospImage("android", undefined), false);
  assert.equal(detectAospImage("android", [header(["status"])]), false, "the capability method itself must be registered");
  assert.equal(detectAospImage("android", [{ name: "DeviceApps", methods: [{ name: "imageCapability" }] }]), false);
});

test("image views open only on the image and only with an admitted adapter", () => {
  assert.deepEqual([...AOSP_IMAGE_VIEWS].sort(), ["contacts", "messages", "phone"]);
  assert.deepEqual(ADMITTED_AOSP_VIEW_ADAPTERS, [], "no prototype telephony view is admitted while its actions are simulated");
  assert.deepEqual(admittedAospViews(true), []);
  assert.deepEqual(admittedAospViews(false, ["contacts"]), [], "no install without the image admits a view");
  assert.deepEqual(admittedAospViews(true, ["contacts", "wallet", "inbox"]), ["contacts"], "only image views can be admitted this way");
});

test("the renderer capability ignores URLs, storage, flags and the launcher flavor", () => {
  const source = read("apps/app/src/runtime/aosp-image.ts");
  for (const forbidden of [/location\./, /localStorage/, /sessionStorage/, /testMocksEnabled|VITE_ELIZA_DEV_ALLOW_TEST_MOCKS/, /IS_LAUNCHER|buildInfo|launcher\s*[:=]/])
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), forbidden);
  const features = read("apps/app/src/prototype/mvp-features.ts");
  assert.match(features, /admittedAospViews\(aospImage\)/);
  assert.match(features, /new Set\(\["phone", "messages", "contacts", "wallet"\]\.filter\(view => !ENABLED_MVP_VIEWS\.has\(view\)\)\)/, "restored state, routes and deep links drop every unavailable view");
});

test("image staging declares the versioned system feature in the product partition", t => {
  assert.equal(imageFeatureName(PKG), `${PKG}.aosp_image`);
  assert.throws(() => imageFeatureName("Not a package"), /Invalid package/);
  const files = renderImageCapability(PKG);
  const xml = files[`image-capability/${PKG}.aosp_image.xml`];
  assert.match(xml, new RegExp(`<feature name="${PKG.replaceAll(".", "\\.")}\\.aosp_image" version="${IMAGE_FEATURE_VERSION}" />`));
  assert.match(files.productMakefile, new RegExp(`PRODUCT_COPY_FILES \\+= \\$\\(alphaphone_image_capability_dir\\)/${PKG.replaceAll(".", "\\.")}\\.aosp_image\\.xml:\\$\\(TARGET_COPY_OUT_PRODUCT\\)/etc/permissions/`));
  assert.doesNotMatch(files.productMakefile, /\bALPHA_/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-image-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, "product.mk"), "PRODUCT_PACKAGES += AlphaPhone\n");
  writeImageCapability(out, PKG);
  assert.ok(fs.existsSync(path.join(out, `image-capability/${PKG}.aosp_image.xml`)));
  assert.match(read(path.join(out, "product.mk")), /etc\/permissions/);
  assert.throws(() => writeImageCapability(out, PKG), /EEXIST/);
});

test("staging, native check and feature declaration agree", () => {
  const stage = read("scripts/stage-aosp.mjs");
  const call = stage.indexOf("writeImageCapability(output, identity.appId)");
  assert.ok(call > 0, "stage-aosp writes the image capability");
  assert.ok(call < stage.indexOf("if (production) {"), "development and production images both declare it");
  const admission = stage.indexOf("\nadmitApk({");
  assert.ok(admission > stage.indexOf("function admitApk("), "the admission call site, not the definition");
  assert.ok(admission > 0 && admission < call, "test-mocks and non-distributable APKs are refused before the capability is written");
  const capability = read(`${JAVA}/AlphaImageCapability.java`);
  assert.match(capability, new RegExp(`static final int FEATURE_VERSION = ${IMAGE_FEATURE_VERSION};`));
  assert.match(capability, /return packageName \+ "\.aosp_image";/);
  assert.match(capability, /return launcherBuild && !testMocks && systemInstalled && imageFeature;/, "every fact is required");
  assert.match(capability, /if \(!AlphaImageCapabilities\.aospImage\(context\)\) return false;/, "telephony cannot bypass the production RRO capability");
  assert.match(capability, /ApplicationInfo\.FLAG_SYSTEM/);
  assert.match(capability, /hasSystemFeature\(featureName\(app\.getPackageName\(\)\), FEATURE_VERSION\)/);
  assert.match(capability, /admitted\(BuildConfig\.IS_LAUNCHER, BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS, system, feature\)/);
});

test("the telephony plugin is registered and answers only on the verified image", () => {
  const main = read(`${JAVA}/MainActivity.java`);
  assert.match(main, /if \(AlphaImageCapability\.verified\(this\)\) registerPlugin\(AlphaTelephonyPlugin\.class\);/);
  assert.equal((main.match(/AlphaTelephonyPlugin/g) || []).length, 1, "no unconditional registration");
  assert.doesNotMatch(main, /plugins\.contacts\.ContactsPlugin|MessagesPlugin|PhonePlugin/, "upstream telephony plugins with write paths are not registered");
  const plugin = read(`${JAVA}/AlphaTelephonyPlugin.java`);
  // Every @PluginMethod, overrides of Capacitor's inherited permission methods included.
  const methods = [...plugin.matchAll(/@PluginMethod public void (\w+)\(PluginCall call\)\s*\{\s*([^\n]*)/g)];
  assert.equal(methods.length, (plugin.match(/@PluginMethod/g) || []).length, "no plugin method escapes the check");
  assert.deepEqual(methods.map(m => m[1]).sort(), ["checkPermissions", "composeSms", "dial", "imageCapability", "requestAccess", "requestPermissions", "requestRole", "searchContacts", "status"]);
  for (const [, name, first] of methods) assert.match(first, /^if \(!?refused\(call\)\)/, `${name} re-checks the capability before anything else`);
  for (const callback of plugin.matchAll(/@(?:Permission|Activity)Callback private void (\w+)\([^)]*\) \{ (.*)/g)) assert.match(callback[2], /refused\(call\)/, `${callback[1]} re-checks the capability`);
  assert.doesNotMatch(plugin, /SmsManager|sendTextMessage|ACTION_CALL\b|placeCall|WRITE_CONTACTS|insert\(|applyBatch/, "no direct call, send or contact write");
  assert.match(plugin, /Intent\.ACTION_DIAL/); assert.match(plugin, /Intent\.ACTION_SENDTO/);
  assert.match(plugin, /if \(!eligibleFor\(role\)\)/, "a role request Android could only refuse is never shown");
});

test("the Home Phone shortcut exists only in the launcher build (P-36)", () => {
  const apps = read(`${JAVA}/DeviceAppsPlugin.java`);
  assert.match(apps, /if \("dial"\.equals\(role\) && BuildConfig\.IS_LAUNCHER\) return new Intent\(Intent\.ACTION_DIAL, Uri\.parse\("tel:"\)\);/, "standalone resolves no dial hand-off, so the drawer shows no Phone entry");
  assert.match(apps, /Intent intent = roleIntent\(role\);\n\s*if \(intent == null\) \{ call\.reject/);
  assert.match(apps, /Intent intent = roleIntent\(call\.getString\("role"\)\);\n\s*if \(intent == null\) \{ call\.reject/, "openDefault is refused too");
});

test("permissions: standalone has none, the launcher declares read access only, nothing writes", () => {
  const main = read("android/app/src/main/AndroidManifest.xml");
  const launcher = read("android/app/src/launcher/AndroidManifest.xml");
  const standalone = read("android/app/src/standalone/AndroidManifest.xml");
  const declared = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")[^>]*\/>/g)].map(m => m[1]);
  const removed = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"[^>]*tools:node="remove"[^>]*\/>/g)].map(m => m[1]);
  for (const permission of ["READ_CONTACTS", "READ_PHONE_STATE"]) {
    assert.ok(!declared(main).includes(`android.permission.${permission}`), `main does not declare ${permission}`);
    assert.ok(declared(launcher).includes(`android.permission.${permission}`), `launcher declares ${permission}`);
    assert.ok(removed(standalone).includes(`android.permission.${permission}`), `standalone removes ${permission}`);
  }
  assert.ok(removed(main).includes("android.permission.WRITE_CONTACTS"), "contact writes are removed from every build");
  for (const xml of [main, launcher, standalone])
    for (const permission of ["SEND_SMS", "READ_SMS", "RECEIVE_SMS", "CALL_PHONE", "READ_CALL_LOG", "WRITE_CALL_LOG", "ANSWER_PHONE_CALLS"])
      assert.ok(!declared(xml).includes(`android.permission.${permission}`), `${permission} is not declared`);
  assert.match(launcher, /android\.intent\.action\.SENDTO"\/><data android:scheme="smsto"/);
  assert.doesNotMatch(main, /<intent><action android:name="android\.intent\.action\.SENDTO"\/><data android:scheme="smsto"\/><\/intent>/, "only the image-capable flavor can see SMS handlers");
});

test("telephony shares the bounded Contacts provider adapter", () => {
  const plugin=read(`${JAVA}/AlphaTelephonyPlugin.java`);
  assert.match(plugin,/new AlphaContactsCatalog\(getContext\(\)\)\.list\(query, limit, cancel\)/);
  assert.doesNotMatch(plugin,/ContactsReader/);
});
test("queued contacts cannot return data after access or lifecycle changes", () => {
  for(const name of ['AlphaTelephonyPlugin','AlphaContactsPlugin']) {
   const plugin=read(`${JAVA}/${name}.java`);
   assert.match(plugin,/handleOnResume/);assert.match(plugin,/ACTION_SCREEN_OFF/);
   assert.match(plugin,/handleOnPause/);assert.match(plugin,/handleOnDestroy/);
   assert.match(plugin,/runOnUiThread/);assert.match(plugin,/generation\.current/);
  }
});
