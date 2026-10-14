import fs from "node:fs";
import { writeAospCapabilityOverlay } from "./aosp-capability-overlay.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { androidEnv, tool } from "./toolchain.mjs";
import { verifySecureCameraSource, writeSecureCameraOverlay, assertNoAlphaLockScreenSurface } from "./aosp-secure-camera-contract.mjs";
import { clockProductRequirement } from "./aosp-clock-contract.mjs";
import { provisioningComponents, writeProvisioningOverlay } from "./aosp-provisioning-overlay.mjs";
import { writeImageCapability } from "./aosp-image-capability.mjs";
import { releaseBlockers } from "./release-blockers.mjs";
import { checkListenerDescriptor, checkListenerSpeechBundle, checkListenerSpeechNatives, stageListener } from "./aosp-listener.mjs";

/**
 * Refuse inputs that must never reach an image: anything from the separate
 * test-mocks build, APKs whose packaged web bundle was built with test mocks,
 * and releases verify-apks recorded as non-distributable. Production staging
 * additionally requires a verified distributable release from apk-manifest.json.
 */
function admitApk({ apk, hash, development, manifestFile }) {
  const testMocksDir = path.resolve("artifacts/test-mocks");
  const real = fs.realpathSync(apk);
  for (const candidate of [path.resolve(apk), real]) {
    const relative = path.relative(testMocksDir, candidate);
    if (!relative.startsWith("..") && !path.isAbsolute(relative))
      throw new Error(`Refusing ${apk}: artifacts/test-mocks/ builds are never staged into an image.`);
  }
  let flags;
  try {
    flags = JSON.parse(execFileSync("unzip", ["-p", apk, "assets/public/build-flags.json"], { encoding: "utf8" }));
  } catch {
    throw new Error(`Refusing ${apk}: its web bundle has no assets/public/build-flags.json, so its test-mocks flag is unverified.`);
  }
  if (flags.testMocks !== false)
    throw new Error(`Refusing ${apk}: its web bundle was built with test mocks enabled.`);
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
  const entry = manifest?.results?.find(row => row.sha256 === hash) ?? null;
  if (entry && (manifest.testMocks === true || entry.testMocks === true))
    throw new Error(`Refusing ${apk}: ${manifestFile} records it as a test-mocks build.`);
  // Every unresolved blocker verify-apks recorded for a release (signing, runtime, speech,
  // the proprietary-font check, test mocks) is named; a release is never staged while one remains.
  // Open-source licence flags (licenceFlags) are a record, never a blocker (decision P-09).
  const blockers = entry?.mode === "release" || entry?.distributable !== undefined
    ? releaseBlockers(entry, { manifestTestMocks: manifest.testMocks }) : [];
  if (entry && (entry.distributable === false || (entry.mode === "release" && blockers.length)))
    throw new Error(`Refusing ${apk}: ${manifestFile} records this release as not distributable (runtime ${entry.runtime ?? "unknown"}, ${entry.signed ? "signed" : "unsigned"}). Unresolved blockers:\n${blockers.map(item => `  - ${item}`).join("\n")}`);
  if (!development && !(entry && entry.mode === "release" && entry.distributable === true && blockers.length === 0))
    throw new Error(`Production staging requires a release APK that verify-apks recorded as distributable in ${manifestFile}.`);
  // --development is for debug builds. A release reaches an image only through its distributable
  // manifest row (checked above), so an APK without that row must itself be a debuggable build:
  // a missing manifest, a row for other bytes or a row relabelled "debug" admits no release.
  if (development && entry?.mode !== "release") {
    let debuggable;
    try {
      debuggable = /android:debuggable[^\n]*0xffffffff/.test(execFileSync(tool("aapt"), ["dump", "xmltree", apk, "AndroidManifest.xml"], { encoding: "utf8", env: androidEnv(), maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
      throw new Error(`Refusing ${apk}: --development stages debug builds only, and this APK's build type could not be read.`);
    }
    if (!debuggable)
      throw new Error(`Refusing ${apk}: --development stages debug builds only. This is a release build that ${manifestFile} does not record as distributable.`);
  }
}
const args = process.argv.slice(2);
const get = (key) => {
  const i = args.indexOf(key);
  return i < 0 ? null : args[i + 1];
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--development" || args[i] === "--production") continue;
  if (
    !["--apk", "--output", "--descriptor", "--apk-manifest", "--aosp-source", "--listener-apk", "--listener-descriptor"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --apk FILE --output NEW_DIR [--descriptor FILE [--production] | --development] [--apk-manifest FILE] [--aosp-source PATH] [--listener-apk FILE [--listener-descriptor FILE]]",
    );
  i++;
}
const development = args.includes("--development");
// --production adds the provisioning overlay (default HOME, assistant role, Autofill
// offer). It needs a reviewed descriptor and a distributable release, so it is
// refused until a signed, PACKAGED, qualified release APK exists.
const production = args.includes("--production");
if (production && development) throw new Error("--production and --development are exclusive");
// The always-on listener is part of the AOSP MVP (issue #424): production images must include it.
const listenerApk = get("--listener-apk");
const listenerDescriptor = get("--listener-descriptor");
if (listenerDescriptor && !listenerApk) throw new Error("--listener-descriptor needs --listener-apk");
const apk = get("--apk");
if (!apk) throw new Error("Supply --apk PATH to a signed launcher APK.");
const identity = JSON.parse(fs.readFileSync("app.config.json"));
let descriptor = get("--descriptor");
const hash = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
admitApk({
  apk,
  hash,
  development,
  manifestFile: get("--apk-manifest") || "artifacts/apk-manifest.json",
});
// Checked after APK admission so input refusals are reported first.
if (production && !listenerApk)
  throw new Error("Production staging requires --listener-apk (the always-on listener built by ./gradlew :sense:assembleRelease).");
if (production && !listenerDescriptor)
  throw new Error("Production staging requires --listener-descriptor: an independently reviewed record of the listener's packageName, apkSha256 and certificateSha256.");
const cameraSource = get("--aosp-source") || !development
  ? verifySecureCameraSource(get("--aosp-source"))
  : { sourceVerified: false, imageVerified: false, lockedCaptureVerified: false, deviceAcceptanceVerified: false, reason: "Development staging without reviewed AOSP source" };
const env = androidEnv();
const tree = execFileSync(tool("aapt"), ["dump", "xmltree", apk, "AndroidManifest.xml"], { encoding: "utf8", env, maxBuffer: 64 << 20 });
assertNoAlphaLockScreenSurface(tree);
if (!descriptor) {
  if (!development)
    throw new Error(
      "Production staging requires an independently reviewed --descriptor with pinned hash and signer.",
    );
  const cert = execFileSync(
    tool("apksigner"),
    ["verify", "--print-certs", apk],
    { encoding: "utf8", env },
  );
  const signer = /Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/
    .exec(cert)?.[1]
    .toLowerCase();
  if (!signer) throw new Error("No verified signer found");
  fs.mkdirSync("artifacts", { recursive: true });
  descriptor = `artifacts/launcher-${hash.slice(0, 12)}.json`;
  fs.writeFileSync(
    descriptor,
    JSON.stringify(
      {
        schemaVersion: 1,
        brand: identity.slug.replaceAll("-", "_"),
        moduleName: identity.moduleName,
        packageName: identity.appId,
        apkSha256: hash,
        certificateSha256: signer,
      },
      null,
      2,
    ) + "\n",
  );
}
const reviewed = JSON.parse(fs.readFileSync(descriptor));
if (
  reviewed.packageName !== identity.appId ||
  reviewed.moduleName !== identity.moduleName
)
  throw new Error("Descriptor does not belong to this product");
const output =
  get("--output") || `artifacts/aosp/${identity.slug}-${hash.slice(0, 12)}`;
execFileSync(
  "node",
  [
    "vendor/eliza/packages/os/scripts/android/stage-launcher-overlay.ts",
    "--descriptor",
    path.resolve(descriptor),
    "--apk",
    path.resolve(apk),
    "--output",
    path.resolve(output),
    "--aapt",
    tool("aapt"),
    "--apksigner",
    tool("apksigner"),
    ...(development ? ["--development"] : []),
  ],
  { stdio: "inherit", env },
);
fs.appendFileSync(path.join(output, "product.mk"), clockProductRequirement);
// The image system feature Alpha Phone requires, with a system-partition install, before it offers
// Phone, Contacts or SMS (P-36). Development and production images both declare it; test-mocks APKs
// were refused above, and a sideloaded APK never has the system-partition install.
const capability = writeImageCapability(output, identity.appId);
console.log(`Image capability: ${Object.keys(capability).find(name => name !== "productMakefile")}.`);
writeSecureCameraOverlay(output, cameraSource);
if (production) {
  const components = provisioningComponents(tree, identity.appId);
  writeProvisioningOverlay(output, identity.appId, components);
  writeAospCapabilityOverlay(output, identity.appId);
  console.log(`Provisioning overlay: HOME ${components.home}, assistant ${identity.appId}, Autofill ${components.autofill}.`);
}
if (listenerApk) {
  // Debuggable listener builds are development-only; a production image takes a release build.
  if (!development) {
    let debuggable;
    try {
      debuggable = /android:debuggable[^\n]*0xffffffff/.test(execFileSync(tool("aapt"), ["dump", "xmltree", listenerApk, "AndroidManifest.xml"], { encoding: "utf8", env, maxBuffer: 64 << 20 }));
    } catch {
      throw new Error(`Refusing ${listenerApk}: its manifest could not be read.`);
    }
    if (debuggable) throw new Error(`Refusing ${listenerApk}: a debuggable listener is staged only with --development.`);
  }
  const listenerCert = execFileSync(tool("apksigner"), ["verify", "--print-certs", listenerApk], { encoding: "utf8", env });
  const listenerSigner = /Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/.exec(listenerCert)?.[1]?.toLowerCase();
  const dump = execFileSync(tool("aapt"), ["dump", "permissions", listenerApk], { encoding: "utf8", env, maxBuffer: 16 << 20 });
  // The privileged APK is pinned like the launcher: reviewed bytes and signer, not just a name.
  const listenerHash = createHash("sha256").update(fs.readFileSync(listenerApk)).digest("hex");
  if (listenerDescriptor)
    checkListenerDescriptor(JSON.parse(fs.readFileSync(listenerDescriptor, "utf8")), { appId: identity.appId, apkSha256: listenerHash, signer: listenerSigner });
  // A listener without its speech model can never listen; production refuses it.
  const qualifiedAbis = JSON.parse(fs.readFileSync("android/local-speech/qualified-runtime-manifest.json", "utf8")).qualifiedAbis;
  const entries = execFileSync("unzip", ["-Z1", listenerApk], { encoding: "utf8", maxBuffer: 64 << 20 }).split(/\r?\n/).filter(Boolean);
  try {
    const packaged = checkListenerSpeechBundle(entries, qualifiedAbis);
    checkListenerSpeechNatives(packaged, qualifiedAbis, entry => createHash("sha256").update(execFileSync("unzip", ["-p", listenerApk, entry], { maxBuffer: 256 << 20 })).digest("hex"));
  } catch (problem) {
    if (production) throw new Error(`Refusing ${listenerApk}: ${problem.message}`);
    console.warn(`Development listener: ${problem.message}. It will report SPEECH_UNAVAILABLE on the image.`);
  }
  stageListener({ root: process.cwd(), output, apk: listenerApk, dump, signer: listenerSigner, launcherSigner: String(reviewed.certificateSha256 ?? "").toLowerCase(), appId: identity.appId });
  console.log(`Always-on listener staged: ${identity.appId}.sense (privileged, no network). Grants, indicator and invocation are image-boot evidence, not staging evidence.`);
}
console.log(
  `Add under vendor/${identity.slug.replaceAll("-", "_")} and inherit product.mk from the selected AOSP product. This is staging evidence, not an image boot.`,
);
