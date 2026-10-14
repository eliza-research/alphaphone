// AOSP listener staging (issue #424) from the checked-in image configuration and fabricated
// `aapt dump permissions` output. Not image-build, boot, grant or device evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FORBIDDEN, INDICATOR_EXEMPT_ROLES, LISTENER_SOURCE, UNPRIVILEGED, apkPermissions, checkListenerDescriptor, checkListenerOverlay, checkListenerPermissions, checkListenerSpeechBundle, checkListenerSpeechNatives, listenerPackage, privappPermissions, stageListener, verifyAospListener } from "../scripts/aosp-listener.mjs";

const root = path.resolve(import.meta.dirname, "..");
const APP = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8")).appId;
const PKG = listenerPackage(APP);
const read = name => fs.readFileSync(path.join(root, LISTENER_SOURCE, name), "utf8");
const privapp = read("permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml");
const overlay = read("overlay/frameworks/base/core/res/res/values/config.xml");
const manifestPermissions = () => [...fs.readFileSync(path.join(root, "android/sense/src/main/AndroidManifest.xml"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  .matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")/g)].map(match => match[1]);
const dump = (permissions = manifestPermissions(), pkg = PKG) =>
  [`package: ${pkg}`, ...permissions.map(name => `uses-permission: name='${name}'`), `permission: ${PKG}.permission.LISTENER_CONTROL`].join("\n");
const SIGNER = "a".repeat(64);

test("the privapp allowlist matches exactly the privileged permissions the listener manifest requests", () => {
  assert.equal(PKG, "ai.elizaresearch.alphaphone.sense");
  assert.deepEqual(privappPermissions(privapp, PKG), ["android.permission.CAPTURE_AUDIO_HOTWORD", "android.permission.START_ACTIVITIES_FROM_BACKGROUND"]);
  const { requested, privileged } = checkListenerPermissions(dump(), privapp, PKG);
  assert.deepEqual(requested.filter(name => !UNPRIVILEGED.includes(name)), privileged);
  for (const name of FORBIDDEN) assert.ok(!requested.includes(name) && !privileged.includes(name), name);
  assert.deepEqual(apkPermissions(dump()).packageName, PKG);
});

test("a listener with network, call/output capture or unreviewed permissions is refused", () => {
  for (const extra of ["android.permission.INTERNET", "android.permission.CAPTURE_AUDIO_OUTPUT", "android.permission.READ_PHONE_STATE", "android.permission.RECORD_BACKGROUND_AUDIO"])
    assert.throws(() => checkListenerPermissions(dump([...manifestPermissions(), extra]), privapp, PKG), /must not request/, extra);
  assert.throws(() => checkListenerPermissions(dump([...manifestPermissions(), "android.permission.READ_CONTACTS"]), privapp, PKG), /outside the reviewed set/);
  assert.throws(() => checkListenerPermissions(dump(manifestPermissions().filter(name => !name.endsWith("CAPTURE_AUDIO_HOTWORD"))), privapp, PKG), /does not request/);
  assert.throws(() => checkListenerPermissions(dump(manifestPermissions(), APP), privapp, PKG), /expected/);
  const widened = privapp.replace("</privapp-permissions>", '<permission name="android.permission.CAPTURE_AUDIO_OUTPUT" /></privapp-permissions>');
  assert.throws(() => checkListenerPermissions(dump(), widened, PKG), /must not request or be granted/);
  assert.throws(() => privappPermissions(privapp.replace(PKG, APP), PKG), /exactly/, "the ordinary Alpha app gets no privapp grant");
});

test("hardware invocation keeps emergency and camera gestures and clears indicator-exempt roles", () => {
  assert.equal(checkListenerOverlay(overlay), true);
  assert.throws(() => checkListenerOverlay(overlay.replace(">5<", ">1<")), /assistant/);
  assert.throws(() => checkListenerOverlay(overlay.replace('config_keyChordPowerVolumeUp">2<', 'config_keyChordPowerVolumeUp">3<')), /power menu/);
  assert.throws(() => checkListenerOverlay(overlay.replace("</resources>", '<integer name="config_doublePressOnPowerBehavior">0</integer></resources>')), /must not change/);
  assert.throws(() => checkListenerOverlay(overlay.replace("</resources>", '<bool name="config_emergencyGestureEnabled">false</bool></resources>')), /must not change/);
  assert.equal(INDICATOR_EXEMPT_ROLES.length, 6, "all six PermissionManager EXEMPTED_ROLES");
  for (const role of INDICATOR_EXEMPT_ROLES) {
    const set = holder => overlay.replace(`${role}" translatable="false"><`, `${role}" translatable="false">${holder}<`);
    assert.ok(overlay.includes(`${role}" translatable="false"></string>`), `${role} is overlaid to empty`);
    assert.throws(() => checkListenerOverlay(set("com.example.ambient")), /must be empty/, role);
    assert.throws(() => checkListenerOverlay(set(PKG), [APP, PKG]), /names an Alpha package/, role);
    assert.throws(() => checkListenerOverlay(set(APP), [APP, PKG]), /names an Alpha package/, role);
    assert.throws(() => checkListenerOverlay(overlay.replace(new RegExp(`<string name="${role}"[^>]*></string>`), "")), /overlaid to empty/, role);
  }
  assert.throws(() => checkListenerOverlay(overlay.replace('config_supportsMicToggle">true', 'config_supportsMicToggle">false')), /toggle/);
  const makefile = read("listener.mk");
  assert.match(makefile, /^PRODUCT_PACKAGES \+= AlphaSense$/m);
  assert.match(makefile, /^PRODUCT_PRODUCT_PROPERTIES \+= ro\.hotword\.detection_service_required=true$/m);
  assert.doesNotMatch(makefile, /persist\.|ALPHA_/);
  const sysconfig = read("sysconfig/alphaphone-sense.xml").replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(sysconfig, /allow-in-power-save|bg-restriction-exemption|allow-in-data-usage-save/);
  assert.match(sysconfig, /android\.os\.usertype\.full\.SYSTEM/);
  const allowed = [...sysconfig.matchAll(/<allow-association target="([^"]+)" allowed="([^"]+)"/g)].map(match => (assert.equal(match[1], PKG), match[2])).sort();
  assert.deepEqual(allowed, [APP, "com.android.permissioncontroller", "com.android.settings", "com.android.systemui"], "the consent flow's system packages may associate; nothing else");
  const bp = read("Android.bp");
  assert.match(bp, /privileged: true/);
  assert.match(bp, /presigned: true/);
  assert.match(bp, /system_ext_specific: true/);
});

test("staging copies the reviewed configuration and APK and refuses a different signer", t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "listener-stage-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const apk = path.join(output, "input.apk");
  fs.writeFileSync(apk, "apk-bytes");
  fs.writeFileSync(path.join(output, "product.mk"), "# launcher\n");
  assert.throws(() => stageListener({ root, output, apk, dump: dump(), signer: "b".repeat(64), launcherSigner: SIGNER, appId: APP }), /launcher's certificate/);
  assert.throws(() => stageListener({ root, output, apk, dump: dump(), signer: undefined, launcherSigner: undefined, appId: APP }), /launcher's certificate/);
  assert.equal(fs.existsSync(path.join(output, "listener")), false, "nothing copied after a refusal");
  const target = stageListener({ root, output, apk, dump: dump(), signer: SIGNER, launcherSigner: SIGNER, appId: APP });
  assert.equal(fs.readFileSync(path.join(target, "AlphaSense.apk"), "utf8"), "apk-bytes");
  for (const file of ["Android.bp", "listener.mk", "permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml", "sysconfig/alphaphone-sense.xml", "overlay/frameworks/base/core/res/res/values/config.xml"])
    assert.ok(fs.existsSync(path.join(target, file)), file);
  assert.match(fs.readFileSync(path.join(output, "product.mk"), "utf8"), /^include .*\/listener\/listener\.mk$/m);
  assert.throws(() => stageListener({ root, output, apk, dump: dump(), signer: SIGNER, launcherSigner: SIGNER, appId: APP }), /already exists/);
});

test("the privileged listener is pinned by a reviewed descriptor and must carry its qualified speech bundle", () => {
  const hash = "c".repeat(64);
  const good = { packageName: PKG, apkSha256: hash, certificateSha256: SIGNER };
  assert.equal(checkListenerDescriptor(good, { appId: APP, apkSha256: hash, signer: SIGNER }), true);
  assert.throws(() => checkListenerDescriptor(null, { appId: APP, apkSha256: hash, signer: SIGNER }), /required/);
  assert.throws(() => checkListenerDescriptor({ ...good, packageName: APP }, { appId: APP, apkSha256: hash, signer: SIGNER }), /expected/);
  assert.throws(() => checkListenerDescriptor(good, { appId: APP, apkSha256: "d".repeat(64), signer: SIGNER }), /apkSha256/, "other bytes with the right name and signer are refused");
  assert.throws(() => checkListenerDescriptor(good, { appId: APP, apkSha256: hash, signer: "b".repeat(64) }), /certificateSha256/);
  assert.throws(() => checkListenerDescriptor({ ...good, apkSha256: "x" }, { appId: APP, apkSha256: "x", signer: SIGNER }), /apkSha256/);
  const qualified = JSON.parse(fs.readFileSync(path.join(root, "android/local-speech/qualified-runtime-manifest.json"), "utf8")).qualifiedAbis;
  const arm = qualified.find(row => row.abi === "arm64-v8a");
  const entries = ["AndroidManifest.xml", "classes.dex", "assets/local-speech/v1/manifest.json", ...arm.native.map(lib => `lib/arm64-v8a/${lib.file}`)];
  assert.deepEqual(checkListenerSpeechBundle(entries, qualified), ["arm64-v8a"]);
  assert.throws(() => checkListenerSpeechBundle(entries.filter(name => !name.startsWith("assets/local-speech/")), qualified), /no assets\/local-speech\/v1\/manifest\.json/, "an APK without the model can never listen");
  assert.throws(() => checkListenerSpeechBundle(entries.filter(name => !name.startsWith("lib/")), qualified), /no qualified speech runtime/);
  const hashes = Object.fromEntries(arm.native.map(lib => [`lib/arm64-v8a/${lib.file}`, lib.sha256]));
  assert.equal(checkListenerSpeechNatives(["arm64-v8a"], qualified, entry => hashes[entry]), true);
  assert.throws(() => checkListenerSpeechNatives(["arm64-v8a"], qualified, () => "0".repeat(64)), /differs from qualified/);
});

test("stage-aosp wires the listener and requires it for production images", () => {
  const stage = fs.readFileSync(path.join(root, "scripts/stage-aosp.mjs"), "utf8");
  assert.match(stage, /"--listener-apk"/);
  assert.match(stage, /"--listener-descriptor"/);
  assert.match(stage, /if \(production && !listenerApk\)\s*throw/);
  assert.match(stage, /if \(production && !listenerDescriptor\)\s*throw/);
  assert.match(stage, /checkListenerDescriptor\(/);
  assert.match(stage, /if \(production\) throw new Error\(`Refusing \$\{listenerApk\}: \$\{problem\.message\}`\)/, "production refuses a listener without its speech bundle");
  assert.match(stage, /a debuggable listener is staged only with --development/);
  assert.ok(stage.indexOf("stageListener(") > stage.indexOf("writeProvisioningOverlay("), "listener makefile is appended after the provisioning lines");
});

test("the read-only image check needs a privileged, persistent listener and a nonprivileged Alpha", () => {
  const listenerDump = ({ flags = "[ SYSTEM HAS_CODE PERSISTENT ]", privateFlags = "[ PRIVILEGED SYSTEM_EXT ]", extra = "" } = {}) =>
    `Packages:\n  Package [${PKG}]\n    flags=${flags}\n    privateFlags=${privateFlags}\n    requested permissions:\n      android.permission.RECORD_AUDIO\n    install permissions:\n      android.permission.CAPTURE_AUDIO_HOTWORD: granted=true\n${extra}    runtime permissions:\n      android.permission.RECORD_AUDIO: granted=false\n`;
  const device = (overrides = {}) => (...args) => {
    const command = args.join(" ");
    if (command.startsWith("shell pm list packages -s")) return overrides.packages ?? `package:${PKG}\n`;
    if (command === `shell dumpsys package ${PKG}`) return overrides.listener ?? listenerDump();
    if (command === `shell dumpsys package ${APP}`) return overrides.alpha ?? `  Package [${APP}]\n    privateFlags=[ PRODUCT ]\n`;
    if (command === "shell getprop ro.hotword.detection_service_required") return overrides.prop ?? "true\n";
    if (command.startsWith("shell dumpsys activity services")) return overrides.services ?? "ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  (nothing)\n";
    if (command === "shell device_config get privacy camera_mic_icons_enabled") return overrides.icons ?? "null\n";
    if (command.startsWith("shell cmd role get-role-holders --user 0 android.app.role.SYSTEM_")) return (overrides.roles ?? {})[args.at(-1)] ?? "\n";
    throw new Error(`unexpected ${command}`);
  };
  const result = verifyAospListener(device(), "0", APP);
  assert.equal(result.recordAudioGranted, false, "RECORD_AUDIO is not pre-granted");
  assert.equal(result.listeningServiceRunning, false, "nothing listens before consent");
  assert.equal(result.indicatorVerified, false);
  assert.equal(result.invocationVerified, false);
  assert.throws(() => verifyAospListener(device(), "", APP), /user/);
  assert.throws(() => verifyAospListener(device({ packages: "" }), "0", APP), /system package/);
  assert.throws(() => verifyAospListener(device({ listener: listenerDump({ privateFlags: "[ SYSTEM_EXT ]" }) }), "0", APP), /privileged/);
  assert.throws(() => verifyAospListener(device({ listener: listenerDump({ flags: "[ SYSTEM HAS_CODE ]" }) }), "0", APP), /persistent/);
  assert.throws(() => verifyAospListener(device({ listener: listenerDump({ extra: "      android.permission.INTERNET: granted=true\n" }) }), "0", APP), /INTERNET/);
  assert.throws(() => verifyAospListener(device({ alpha: "    privateFlags=[ PRIVILEGED PRODUCT ]\n" }), "0", APP), /nonprivileged/);
  assert.throws(() => verifyAospListener(device({ prop: "\n" }), "0", APP), /detection_service_required/);
  assert.throws(() => verifyAospListener(device({ icons: "false\n" }), "0", APP), /camera_mic_icons_enabled/);
  assert.equal(verifyAospListener(device({ icons: "true\n" }), "0", APP).privileged, true);
  assert.throws(() => verifyAospListener(device({ roles: { "android.app.role.SYSTEM_UI_INTELLIGENCE": "com.example.intelligence\n" } }), "0", APP), /SYSTEM_UI_INTELLIGENCE is held/);
  assert.equal(verifyAospListener(device({ services: `  * ServiceRecord{1 u0 ${PKG}/.ListeningService}\n` }), "0", APP).listeningServiceRunning, true);
});
