import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { androidEnv, tool } from "./toolchain.mjs";

// Debug-only native hooks that may exist only in an explicit test-mocks build
// (src/testMocks attached to debug variants when ELIZA_DEV_ALLOW_TEST_MOCKS=1).
export const DEVELOPMENT_CLASSES = Object.freeze([
  "SyntheticAutofillService",
  "DevelopmentAgentPlugin",
  "DevelopmentVoiceCapture",
]);
// Components a distribution APK may export. Each one must be guarded by the
// listed permission (null: a deliberate public entry point).
export const EXPORTED_COMPONENTS = Object.freeze({
  "ai.elizaresearch.alphaphone.MainActivity": null,
  "ai.elizaresearch.alphaphone.AlphaAssistActivity": null,
  "ai.elizaresearch.alphaphone.AlphaNotificationListener": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
  "ai.elizaresearch.alphaphone.AlphaQuickSettingsTile": "android.permission.BIND_QUICK_SETTINGS_TILE",
  // Alpha's password vault as an Android Autofill provider (shared plugin-native-passwords).
  "ai.eliza.plugins.passwords.ElizaPasswordAutofillService": "android.permission.BIND_AUTOFILL_SERVICE",
  // Google Play services alone may notify this native sign-in revocation service.
  "com.google.android.gms.auth.api.signin.RevocationBoundService": "com.google.android.gms.auth.api.signin.permission.REVOCATION_NOTIFICATION",
  "androidx.work.impl.background.systemjob.SystemJobService": "android.permission.BIND_JOB_SERVICE",
  "androidx.work.impl.diagnostics.DiagnosticsReceiver": "android.permission.DUMP",
  "androidx.profileinstaller.ProfileInstallReceiver": "android.permission.DUMP",
  // Read-only release data integrity export for pilot updates (adb shell holds DUMP).
  "ai.elizaresearch.alphaphone.release.DataIntegrityProvider": "android.permission.DUMP",
});
// On-device speech is the fused libelizainference engine only. Entries and classes of the removed
// speech runtimes (Open Neural Network Exchange models and runtimes, sherpa, ORT-Web, the former
// in-browser model directory public/browser-speech/) never ship.
export const REMOVED_SPEECH_ENTRY = /(?:\.on{2}x$|libon{2}xruntime|libsherpa|k2fsa|ort-wasm|^assets\/public\/browser-speech\/)/i;
export const REMOVED_SPEECH_CLASSES = Object.freeze(["Lcom/k2fsa/", "Lai/eliza/speech/"]);
import { manifestFacts, parseXmlTree } from "../vendor/eliza/packages/app/scripts/lib/android-manifest-facts.mjs";
export { manifestFacts, parseXmlTree } from "../vendor/eliza/packages/app/scripts/lib/android-manifest-facts.mjs";
const isFalse = value => value === "0x0";

/**
 * Pure release-policy assessment. `apk` holds aapt dumps, zip entry names and
 * the development class names found in dex. Returns a list of problems.
 */
export function distributionProblems(apk, { mode, testMocks = false } = {}) {
  const facts = manifestFacts(apk.xml, apk.badging);
  const problems = [];
  const debugHooksAllowed = testMocks && mode === "debug";
  if (!debugHooksAllowed) {
    for (const name of DEVELOPMENT_CLASSES) {
      if (apk.xml.includes(name) || apk.dexClasses?.includes(name))
        problems.push(`Development class ${name} is packaged`);
    }
    if (/peerfixture/.test(apk.xml)) problems.push("peerfixture permission or package query is packaged");
    if (apk.names.some(name => /^res\/xml\/development_network_security_config\.xml$/.test(name)))
      problems.push("Development network security config is packaged");
    if (!isFalse(facts.application.usesCleartextTraffic))
      problems.push(`usesCleartextTraffic must be false (found ${facts.application.usesCleartextTraffic ?? "unset"})`);
  }
  if (mode === "release" && !facts.application.networkSecurityConfig)
    problems.push("Release manifest has no networkSecurityConfig");
  if (!isFalse(facts.application.allowBackup))
    problems.push(`allowBackup must be false (found ${facts.application.allowBackup ?? "unset"})`);
  for (const component of facts.exported) {
    if (debugHooksAllowed && DEVELOPMENT_CLASSES.some(name => component.name.endsWith("." + name))) continue;
    if (!(component.name in EXPORTED_COMPONENTS)) {
      problems.push(`Unexpected exported ${component.tag} ${component.name}`);
      continue;
    }
    const required = EXPORTED_COMPONENTS[component.name];
    if (required && component.permission !== required)
      problems.push(`Exported ${component.name} must require ${required}`);
  }
  const tileName = "ai.elizaresearch.alphaphone.AlphaQuickSettingsTile";
  const tile = facts.components.find(component => component.name === tileName);
  if (tile) {
    const application = parseXmlTree(apk.xml).children.find(node => node.name === "manifest")
      ?.children.find(node => node.name === "application");
    const nodes = application?.children.filter(node =>
      node.attrs.name === tileName || node.attrs.name === ".AlphaQuickSettingsTile") ?? [];
    const actions = nodes.flatMap(node => node.children.filter(child => child.name === "intent-filter")
      .flatMap(filter => filter.children.filter(child => child.name === "action").map(child => child.attrs.name)));
    if (tile.tag !== "service" || !tile.exported ||
        tile.permission !== EXPORTED_COMPONENTS[tileName] || nodes.length !== 1 ||
        actions.length !== 1 || actions[0] !== "android.service.quicksettings.action.QS_TILE")
      problems.push("Alpha Quick Settings tile must be one exported, permission-protected QS_TILE service");
  }
  // Test-only names (mock providers, fixture peers) never ship in a flag-off build.
  if (!debugHooksAllowed) {
    const named = [
      ...facts.components.map(component => component.name),
      ...facts.permissions,
      ...facts.queriedPackages,
    ];
    for (const name of named.filter(value => /mock|fixture/i.test(value)))
      problems.push(`Test-only manifest entry ${name}`);
  }
  if (facts.permissions.includes("android.permission.WRITE_EXTERNAL_STORAGE"))
    problems.push("WRITE_EXTERNAL_STORAGE is requested");
  const maps = apk.names.filter(name => name.startsWith("assets/") && name.endsWith(".map"));
  if (maps.length) problems.push(`Source maps are packaged: ${maps.slice(0, 3).join(", ")}`);
  const removedSpeech = apk.names.filter(name => REMOVED_SPEECH_ENTRY.test(name));
  if (removedSpeech.length) problems.push(`Removed speech runtime entries are packaged: ${removedSpeech.slice(0, 3).join(", ")}`);
  if (apk.removedSpeechClasses?.length) problems.push(`Removed speech runtime classes are packaged: ${apk.removedSpeechClasses.join(", ")}`);
  if (!apk.names.includes("assets/public/licenses/third-party-notices.json"))
    problems.push("assets/public/licenses/third-party-notices.json is missing");
  if (facts.versionCode === null)
    problems.push(`versionCode must be a positive integer (found ${facts.versionCodeText ?? "none"})`);
  if (!facts.versionName || facts.versionName === "0")
    problems.push(`versionName must be set (found ${facts.versionName ?? "none"})`);
  return { facts, problems };
}

function dexClassNames(file, names) {
  const found = new Set(), removed = new Set();
  for (const entry of names.filter(name => /^classes\d*\.dex$/.test(name))) {
    const bytes = execFileSync("unzip", ["-p", file, entry], { maxBuffer: 512 * 1024 * 1024 });
    for (const name of DEVELOPMENT_CLASSES) if (bytes.includes(`/${name};`)) found.add(name);
    for (const prefix of REMOVED_SPEECH_CLASSES) if (bytes.includes(prefix)) removed.add(prefix);
  }
  return { development: [...found], removedSpeech: [...removed] };
}

export function inspectApk(file) {
  const badging = execFileSync(tool("aapt"), ["dump", "badging", file], {
    encoding: "utf8",
  });
  const xml = execFileSync(
    tool("aapt"),
    ["dump", "xmltree", file, "AndroidManifest.xml"],
    { encoding: "utf8" },
  );
  const names = execFileSync("unzip", ["-Z1", file], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }).split("\n").filter(Boolean);
  const pkg = /package: name='([^']+)'/.exec(badging)?.[1];
  return {
    file,
    packageName: pkg,
    home: xml.includes("android.intent.category.HOME"),
    launcher: xml.includes("android.intent.category.LAUNCHER"),
    debuggable: /android:debuggable[^\n]*0xffffffff/.test(xml),
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    webPayload: names.includes("assets/public/index.html"),
    badging,
    xml,
    names,
    ...(({ development, removedSpeech }) => ({ dexClasses: development, removedSpeechClasses: removedSpeech }))(dexClassNames(file, names)),
  };
}

/** Extract assets/public into a fresh temporary directory; caller removes it. */
export function extractWebPayload(file) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-apk-public-"));
  execFileSync("unzip", ["-q", file, "assets/public/*", "-d", directory]);
  return { root: directory, public: path.join(directory, "assets/public") };
}

/** Read the build-time flag record that vite writes beside the web bundle. */
export function readBuildFlags(publicDir) {
  const file = path.join(publicDir, "build-flags.json");
  if (!fs.existsSync(file))
    throw new Error(`build-flags.json is missing from the packaged web bundle (${file}); the web build did not record its test-mocks flag`);
  const flags = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof flags.testMocks !== "boolean") throw new Error("build-flags.json has no boolean testMocks");
  return flags;
}

/** OwnerRoutes reads assets/owner-routes.json; it must be config/owner-routes.json, the table the renderer imports. */
export function verifyOwnerRouteTable(file) {
  let packaged;
  try { packaged = execFileSync("unzip", ["-p", file, "assets/owner-routes.json"], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error("assets/owner-routes.json is missing"); }
  if (!packaged.equals(fs.readFileSync(new URL("../config/owner-routes.json", import.meta.url))))
    throw new Error("assets/owner-routes.json differs from config/owner-routes.json");
}

export const AUDIT_SCRIPT = "scripts/audit-production-bundle.mjs";
/** Run the shared production-bundle audit CLI against an extracted web payload. */
export function auditBundle(directory, { testMocks = false, script = AUDIT_SCRIPT } = {}) {
  if (!fs.existsSync(script))
    throw new Error(`${script} is missing; the production bundle audit is required to verify APK web payloads`);
  const args = [script, directory, ...(testMocks ? ["--expect-test-mocks"] : [])];
  try {
    return execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`Production bundle audit failed for ${directory}:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

/** apksigner certificate digest of the first signer, or null when unsigned. */
export function signerDigest(file, { apiLevel } = {}) {
  if (apiLevel !== undefined && (!Number.isInteger(apiLevel) || apiLevel < 1)) throw new Error("Invalid Android API level");
  const output = execFileSync(tool("apksigner"), ["verify", "--print-certs", ...(apiLevel === undefined ? [] : ["--min-sdk-version", String(apiLevel), "--max-sdk-version", String(apiLevel)]), file], {
    encoding: "utf8", env: androidEnv(),
  });
  return parseSignerDigest(output, { apiLevel });
}
export function parseSignerDigest(output, { apiLevel } = {}) {
  const legacy = [...output.matchAll(/Signer #([0-9]+) certificate SHA-256 digest:\s*([a-fA-F0-9]{64})/g)];
  const ranged = [...output.matchAll(/Signer \(minSdkVersion=([0-9]+), maxSdkVersion=([0-9]+)\) certificate SHA-256 digest:\s*([a-fA-F0-9]{64})/g)];
  if (legacy.length && ranged.length) throw new Error('Ambiguous APK signer output');
  if (legacy.length === 1 && legacy[0][1] === '1') return legacy[0][2].toLowerCase();
  if (legacy.length) throw new Error('Multiple or unrecognized APK signers are not supported');
  if (!ranged.length) throw new Error('apksigner reported no SHA-256 signer digest');
  if (!Number.isInteger(apiLevel) || apiLevel < 1) throw new Error('Rotated APK signer requires an explicit Android API level');
  const matches = ranged.filter(row => Number(row[1]) <= apiLevel && apiLevel <= Number(row[2]));
  if (matches.length !== 1) throw new Error('No unique APK signer for the requested Android API level');
  return matches[0][3].toLowerCase();
}

export function validateApk(file, identity, wantsHome) {
  const data = inspectApk(file);
  if (data.packageName !== identity.appId)
    throw new Error(`Wrong package in ${file}: ${data.packageName}`);
  if (data.home !== wantsHome || !data.launcher || !data.webPayload)
    throw new Error(`Invalid launcher/web payload contract in ${file}`);
  if (
    data.xml.includes("android.permission.WRITE_SETTINGS")
  )
    throw new Error(`Unexpected elevated permission in ${file}`);
  for (const permission of ['CAMERA']) {
    if (!data.xml.includes('android.permission.' + permission)) throw new Error(`Missing native feature permission ${permission} in ${file}`);
  }
  // Contacts reads are packaged only for the launcher. The native image capability,
  // unlocked profile and runtime grant remain separate requirements for access.
  if (data.xml.includes('android.permission.READ_CONTACTS') !== wantsHome)
    throw new Error(`Invalid Contacts read permission for distribution in ${file}`);
  if (data.xml.includes('android.permission.WRITE_CONTACTS'))
    throw new Error(`Unexpected Contacts write permission in ${file}`);
  // SMS provider reads and reviewed sends (#421) are packaged only for the launcher; Android grants
  // these hard-restricted permissions only to the preinstalled image app or the SMS role holder.
  for (const permission of ['READ_SMS', 'SEND_SMS'])
    if (data.xml.includes(`android.permission.${permission}`) !== wantsHome)
      throw new Error(`Invalid ${permission} permission for distribution in ${file}`);
  for (const permission of ['RECEIVE_SMS', 'RECEIVE_MMS', 'CALL_PHONE'])
    if (data.xml.includes(`android.permission.${permission}`))
      throw new Error(`Unexpected telephony permission ${permission} in ${file}`);
  // aapt badging distinguishes required hardware from optional feature declarations.
  if (/uses-feature: name='android\.hardware\.camera(?:\.any|\.autofocus)?'/.test(data.badging))
    throw new Error(`Camera hardware must remain optional in ${file}`);
  return data;
}

/** Archive the verified APK payload, independent of the restored working web bundle. */
export function archiveWebPayload(apkFile, destination, { testMocks = false } = {}) {
  const payload = extractWebPayload(apkFile);
  try {
    const flags = readBuildFlags(payload.public);
    if (flags.testMocks !== testMocks) throw new Error(`APK web payload has testMocks=${flags.testMocks}; expected ${testMocks}`);
    auditBundle(payload.public, { testMocks });
    fs.cpSync(payload.public, destination, { recursive: true, errorOnExist: true, force: false });
  } finally {
    fs.rmSync(payload.root, { recursive: true, force: true });
  }
}
