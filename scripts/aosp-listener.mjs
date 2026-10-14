/**
 * AOSP staging for the always-on listener (issue #424, docs/adr/0001-privileged-listener.md).
 *
 * Admits the separately built listener APK (android/sense) and copies the reviewed image
 * configuration from android/aosp/listener next to the staged launcher module. Admission checks
 * the APK's requested permissions against the privapp allowlist (no network, no call/output
 * capture), its package name and that it shares the launcher's signer, and the overlay keeps the
 * emergency and camera power gestures and clears every indicator-exempt role. Production staging
 * also requires a reviewed listener descriptor pinning the APK hash and signer, and a packaged,
 * qualified speech bundle. This is staging output only: the privilege grants, the
 * indicator and press-and-hold invocation are proven only by booting the built image.
 */
import fs from "node:fs";
import path from "node:path";

export const LISTENER_SOURCE = "android/aosp/listener";
export const listenerPackage = appId => `${appId}.sense`;

/** Permissions the listener may request that need no image grant (normal or user-granted runtime). */
export const UNPRIVILEGED = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.HIDE_OVERLAY_WINDOWS",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECORD_AUDIO",
];
/** Never requested by, or granted to, the listener. */
export const FORBIDDEN = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAPTURE_AUDIO_OUTPUT",
  "android.permission.CAPTURE_MEDIA_OUTPUT",
  "android.permission.CAPTURE_VOICE_COMMUNICATION_OUTPUT",
  "android.permission.BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION",
  "android.permission.EXEMPT_FROM_AUDIO_RECORD_RESTRICTIONS",
  "android.permission.RECORD_BACKGROUND_AUDIO",
  "android.permission.MODIFY_AUDIO_ROUTING",
  "android.permission.READ_PHONE_STATE",
];

const withoutComments = text => String(text).replace(/<!--[\s\S]*?-->/g, "");

/** Permission names in a privapp-permissions file for one package. */
export function privappPermissions(xml, packageName) {
  const body = withoutComments(xml);
  const blocks = [...body.matchAll(/<privapp-permissions\s+package="([^"]+)"\s*>([\s\S]*?)<\/privapp-permissions>/g)];
  if (blocks.length !== 1 || blocks[0][1] !== packageName) throw new Error(`The privapp allowlist must name exactly ${packageName}`);
  if (/<deny-permission/.test(blocks[0][2])) throw new Error("The listener allowlist must not use deny-permission");
  return [...blocks[0][2].matchAll(/<permission\s+name="([^"]+)"\s*\/>/g)].map(match => match[1]).sort();
}

/** Parses `aapt dump permissions`: package name and requested permissions. */
export function apkPermissions(dump) {
  const packageName = /^package: (\S+)$/m.exec(dump)?.[1] ?? null;
  const requested = [...dump.matchAll(/^uses-permission: name='([^']+)'/gm)].map(match => match[1]).sort();
  return { packageName, requested };
}

/**
 * Every requested permission is either unprivileged or allowlisted, every allowlisted permission is
 * requested (a stale allowlist entry fails privapp enforcement at boot), and none is forbidden.
 */
export function checkListenerPermissions(dump, privappXml, expectedPackage) {
  const { packageName, requested } = apkPermissions(dump);
  if (packageName !== expectedPackage) throw new Error(`Listener APK package is ${packageName}, expected ${expectedPackage}`);
  const privileged = privappPermissions(privappXml, expectedPackage);
  const forbidden = [...requested, ...privileged].filter(name => FORBIDDEN.includes(name));
  if (forbidden.length) throw new Error(`The listener must not request or be granted: ${[...new Set(forbidden)].join(", ")}`);
  const unreviewed = requested.filter(name => !UNPRIVILEGED.includes(name) && !privileged.includes(name) && !name.startsWith(`${expectedPackage}.`));
  if (unreviewed.length) throw new Error(`The listener requests permissions outside the reviewed set: ${unreviewed.join(", ")}`);
  const unused = privileged.filter(name => !requested.includes(name));
  if (unused.length) throw new Error(`The privapp allowlist grants permissions the listener does not request: ${unused.join(", ")}`);
  if (!requested.includes("android.permission.RECORD_AUDIO") || !requested.includes("android.permission.FOREGROUND_SERVICE_MICROPHONE"))
    throw new Error("The listener must request RECORD_AUDIO and FOREGROUND_SERVICE_MICROPHONE");
  return { requested, privileged };
}

/** PermissionManager EXEMPTED_ROLES: holders are hidden from the microphone/camera privacy indicator. */
export const INDICATOR_EXEMPT_ROLES = [
  "config_systemAmbientAudioIntelligence",
  "config_systemUiIntelligence",
  "config_systemAudioIntelligence",
  "config_systemNotificationIntelligence",
  "config_systemTextIntelligence",
  "config_systemVisualIntelligence",
];

/**
 * The overlay sets press-and-hold power to the assistant, leaves emergency/camera gestures alone
 * and clears every indicator-exempt role. `alphaPackages` are refused as any role value even if the
 * emptiness rule were relaxed.
 */
export function checkListenerOverlay(configXml, alphaPackages = []) {
  const body = withoutComments(configXml);
  const value = name => new RegExp(`<(?:integer|bool|string)\\s+name="${name}"[^>]*>([^<]*)<`).exec(body)?.[1]?.trim();
  if (value("config_longPressOnPowerBehavior") !== "5") throw new Error("Press and hold power must open the assistant (config_longPressOnPowerBehavior 5)");
  if (value("config_keyChordPowerVolumeUp") !== "2") throw new Error("Power + volume up must keep opening the power menu (config_keyChordPowerVolumeUp 2)");
  if (value("config_supportsMicToggle") !== "true") throw new Error("The microphone privacy toggle must be available");
  for (const role of INDICATOR_EXEMPT_ROLES) {
    const holder = value(role);
    if (holder === undefined) throw new Error(`${role} must be overlaid to empty: its holder is exempt from the microphone indicator`);
    if (alphaPackages.some(pkg => holder.split(/[\s,;]+/).includes(pkg))) throw new Error(`${role} names an Alpha package: it would be hidden from the microphone indicator`);
    if (holder !== "") throw new Error(`${role} must be empty: its holder is exempt from the microphone indicator`);
  }
  for (const kept of [/config_doublePressOnPowerBehavior/, /config_cameraDoubleTapPowerGestureEnabled/, /[Ee]mergency/, /config_defaultAssistant/, /config_keyChordPowerVolumeDown/])
    if (kept.test(body)) throw new Error(`The listener overlay must not change ${kept.source}`);
  return true;
}

/**
 * The model bundle the listener loads at runtime (SpeechAssets.install). A listener APK without it
 * would sit in SPEECH_UNAVAILABLE forever, so production staging refuses it. `entries` are the
 * APK's zip entry names; `qualifiedAbis` come from android/local-speech/qualified-runtime-manifest.json.
 */
export function checkListenerSpeechBundle(entries, qualifiedAbis) {
  const names = new Set(entries);
  if (!names.has("assets/local-speech/v1/manifest.json"))
    throw new Error("The listener APK has no assets/local-speech/v1/manifest.json: build it after the speech model bundle is prepared, or it can never listen");
  const abis = (qualifiedAbis ?? []).map(row => row.abi);
  const packaged = abis.filter(abi => names.has(`lib/${abi}/libsherpa-onnx-jni.so`));
  if (!packaged.length) throw new Error(`The listener APK packages no qualified speech runtime ABI (${abis.join(", ") || "none qualified"})`);
  return packaged;
}

/**
 * Native libraries the listener packages must be the qualified bytes. `hashOf(entry)` returns the
 * SHA-256 of a zip entry. Only ABIs present in the APK are checked.
 */
export function checkListenerSpeechNatives(packaged, qualifiedAbis, hashOf) {
  for (const abi of packaged) {
    const row = qualifiedAbis.find(item => item.abi === abi);
    for (const lib of row?.native ?? []) {
      const actual = hashOf(`lib/${abi}/${lib.file}`);
      if (actual !== lib.sha256) throw new Error(`Listener ${abi}/${lib.file} differs from qualified-runtime-manifest.json`);
    }
  }
  return true;
}

/**
 * The reviewed listener descriptor: an independently reviewed record pinning the listener APK's
 * bytes and signer, like the launcher's --descriptor. Production staging requires it.
 */
export function checkListenerDescriptor(descriptor, { appId, apkSha256, signer }) {
  if (!descriptor || typeof descriptor !== "object") throw new Error("A reviewed --listener-descriptor is required");
  if (descriptor.packageName !== listenerPackage(appId)) throw new Error(`Listener descriptor names ${descriptor.packageName}, expected ${listenerPackage(appId)}`);
  if (!/^[0-9a-f]{64}$/.test(descriptor.apkSha256 ?? "") || descriptor.apkSha256 !== apkSha256)
    throw new Error("The listener APK does not match the reviewed descriptor's apkSha256");
  if (!/^[0-9a-f]{64}$/.test(descriptor.certificateSha256 ?? "") || descriptor.certificateSha256 !== signer)
    throw new Error("The listener APK signer does not match the reviewed descriptor's certificateSha256");
  return true;
}

export function listenerProductMakefile() {
  return `
# Alpha Phone always-on listener (scripts/stage-aosp.mjs --listener-apk).
include $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))/listener/listener.mk
`;
}

/**
 * Copies the reviewed listener configuration and the admitted APK into `<output>/listener` and
 * appends its makefile to product.mk. `dump` is `aapt dump permissions` of the APK; `signer` and
 * `launcherSigner` are SHA-256 certificate digests.
 */
export function stageListener({ root, output, apk, dump, signer, launcherSigner, appId }) {
  const source = path.join(root, LISTENER_SOURCE);
  const read = name => fs.readFileSync(path.join(source, name), "utf8");
  checkListenerPermissions(dump, read("permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml"), listenerPackage(appId));
  checkListenerOverlay(read("overlay/frameworks/base/core/res/res/values/config.xml"), [appId, listenerPackage(appId)]);
  if (!/^[0-9a-f]{64}$/.test(signer ?? "") || signer !== launcherSigner)
    throw new Error("The listener APK must be signed with the launcher's certificate (its control permission is signature-level)");
  const target = path.join(output, "listener");
  if (fs.existsSync(target)) throw new Error(`${target} already exists`);
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  fs.copyFileSync(apk, path.join(target, "AlphaSense.apk"), fs.constants.COPYFILE_EXCL);
  fs.appendFileSync(path.join(output, "product.mk"), listenerProductMakefile());
  return target;
}

const privilegedFlag = /privateFlags=\[[^\]]*\bPRIVILEGED\b/;

/**
 * Read-only admission of a booted Alpha image over adb (`run(...args)` returns adb stdout). It
 * reports what the package manager and properties say; it does not open the microphone, change
 * consent or press keys. The visible indicator, press-and-hold invocation, lock-screen controls,
 * call/echo behaviour and battery remain device/user acceptance and are never established here.
 */
export function verifyAospListener(run, user, appId) {
  if (!/^(0|[1-9]\d*)$/.test(user || "")) throw Error("Explicit Android user required");
  const pkg = listenerPackage(appId);
  const system = run("shell", "pm", "list", "packages", "-s", "--user", user, pkg);
  if (!system.split(/\r?\n/).map(line => line.trim()).includes(`package:${pkg}`)) throw Error(`${pkg} is not installed as a system package for user ${user}`);
  const dump = run("shell", "dumpsys", "package", pkg);
  if (!privilegedFlag.test(dump)) throw Error(`${pkg} is not a privileged app`);
  if (!/\bflags=\[[^\]]*\bPERSISTENT\b/.test(dump)) throw Error(`${pkg} is not persistent`);
  const granted = name => new RegExp(`${name.replace(/\./g, "\\.")}: granted=true`).test(dump);
  if (!granted("android.permission.CAPTURE_AUDIO_HOTWORD")) throw Error("CAPTURE_AUDIO_HOTWORD is not granted to the listener");
  for (const name of FORBIDDEN) if (new RegExp(`${name.replace(/\./g, "\\.")}\\b`).test(dump)) throw Error(`The listener has ${name}`);
  if (privilegedFlag.test(run("shell", "dumpsys", "package", appId))) throw Error(`${appId} must stay nonprivileged`);
  if (run("shell", "getprop", "ro.hotword.detection_service_required").trim() !== "true") throw Error("ro.hotword.detection_service_required is not true");
  // SystemUI hides the microphone/camera chip when this DeviceConfig flag is false. Its AOSP
  // default is true and the image has no flag-push service; any explicit false fails admission.
  if (/^false$/i.test(run("shell", "device_config", "get", "privacy", "camera_mic_icons_enabled").trim()))
    throw Error("DeviceConfig privacy/camera_mic_icons_enabled is false: the microphone indicator is disabled");
  for (const role of ["android.app.role.SYSTEM_AMBIENT_AUDIO_INTELLIGENCE", "android.app.role.SYSTEM_UI_INTELLIGENCE", "android.app.role.SYSTEM_AUDIO_INTELLIGENCE",
    "android.app.role.SYSTEM_NOTIFICATION_INTELLIGENCE", "android.app.role.SYSTEM_TEXT_INTELLIGENCE", "android.app.role.SYSTEM_VISUAL_INTELLIGENCE"]) {
    const holders = run("shell", "cmd", "role", "get-role-holders", "--user", user, role).trim();
    if (holders) throw Error(`${role} is held by ${holders}: its holder is hidden from the microphone indicator`);
  }
  const services = run("shell", "dumpsys", "activity", "services", pkg);
  return {
    user, packageName: pkg, privileged: true, persistent: true, captureHotwordGranted: true,
    recordAudioGranted: granted("android.permission.RECORD_AUDIO"),
    listeningServiceRunning: /\.ListeningService\b/.test(services),
    indicatorVerified: false, invocationVerified: false, lockScreenControlsVerified: false,
  };
}
