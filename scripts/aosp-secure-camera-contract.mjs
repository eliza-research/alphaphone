import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { manifestComponents } from "./aosp-provisioning-overlay.mjs";

const reviewed = JSON.parse(fs.readFileSync(new URL("../docs/aosp-secure-camera-source.json", import.meta.url)));
const alphaPackage = JSON.parse(fs.readFileSync(new URL("../app.config.json", import.meta.url))).appId;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const secureCameraPackage = "com.android.camera2";
export const secureCameraComponent = `${secureCameraPackage}/com.android.camera.SecureCameraActivity`;
export const secureCameraActions = ["STILL_IMAGE_CAMERA_SECURE", "IMAGE_CAPTURE_SECURE"];

/** Authenticate source inputs only. A clean pinned checkout is not a built-image receipt. */
export function verifySecureCameraSource(root, contract = reviewed) {
  if (!root) throw Error("Production staging requires explicit --aosp-source PATH");
  const base = fs.realpathSync(root);
  const modules = contract.modules.map(module => {
    const directory = fs.realpathSync(path.join(base, module.path));
    // Repo shadow workspaces may link module roots; authenticate their actual Git tree and bytes.
    const git = (...args) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 60_000, maxBuffer: 64 << 20 }).trim();
    if (git("rev-parse", "HEAD") !== module.commit) throw Error(`Unreviewed source revision: ${module.path}`);
    // Index hints can hide tracked changes from status; ignored Java files also enter src/**/*.java.
    if (git("ls-files", "-v").split("\n").some(row => row && !row.startsWith("H "))) throw Error(`Source index hides changes: ${module.path}`);
    if (git("ls-files", "--others", "--ignored", "--exclude-standard")) throw Error(`Ignored source inputs present: ${module.path}`);
    // Includes untracked sources because Camera2 compiles src/**/*.java.
    if (git("status", "--porcelain", "--untracked-files=all")) throw Error(`Source module is not clean: ${module.path}`);
    for (const [relative, expected] of Object.entries(module.files)) {
      const file = fs.realpathSync(path.join(directory, relative));
      if (!file.startsWith(directory + path.sep) || sha(fs.readFileSync(file)) !== expected) throw Error(`Source bytes differ: ${module.path}/${relative}`);
    }
    return { path: module.path, commit: module.commit, files: module.files };
  });
  return { sourceVerified: true, contractSha256: sha(JSON.stringify(contract)), modules, imageVerified: false, lockedCaptureVerified: false, deviceAcceptanceVerified: false };
}

export function writeSecureCameraOverlay(output, evidence) {
  const files = {
    "secure-camera/overlay/frameworks/base/core/res/res/values/config.xml": '<?xml version="1.0" encoding="utf-8"?>\n<resources><bool name="config_cameraDoubleTapPowerGestureEnabled">true</bool></resources>\n',
    "secure-camera/overlay/frameworks/base/packages/SystemUI/res/values/config.xml": '<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="config_cameraGesturePackage" translatable="false">com.android.camera2</string></resources>\n',
    "secure-camera/README.md": "# System secure camera\n\nCamera2 and the standard SystemUI power gesture are staged here. See source-evidence.json for the exact source verification result. Staging does not prove image consumption, locked capture isolation, unlock return or physical device acceptance.\n",
    "secure-camera/source-evidence.json": JSON.stringify(evidence, null, 2) + "\n",
  };
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(output, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, contents, { flag: "wx" });
  }
  fs.appendFileSync(path.join(output, "product.mk"), '\n# Standard AOSP secure camera and SystemUI power gesture; no Alpha lockscreen activity.\nPRODUCT_PACKAGES += Camera2\nalphaphone_secure_camera_dir := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))/secure-camera\nPRODUCT_PACKAGE_OVERLAYS += $(alphaphone_secure_camera_dir)/overlay\n');
}

/** Read-only image checks. Never launches capture, unlocks, grants permission, or reads photos. */
export function verifySecureCameraImage(run, user, expectedFingerprint) {
  if (!/^(0|[1-9]\d*)$/.test(user || "")) throw Error("Explicit Android user required");
  if (!expectedFingerprint?.trim()) throw Error("Explicit expected image fingerprint required");
  const fingerprint = run("shell", "getprop", "ro.build.fingerprint").trim();
  if (fingerprint !== expectedFingerprint) throw Error("Image fingerprint differs from expected target");
  const packages = run("shell", "pm", "list", "packages", "--user", user, "-s", "-e", secureCameraPackage);
  if (!packages.split(/\r?\n/).includes(`package:${secureCameraPackage}`)) throw Error("Required system Camera2 is not enabled for selected user");
  const handlers = {};
  for (const action of secureCameraActions) {
    const rows = run("shell", "cmd", "package", "query-activities", "--brief", "--components", "--user", user, "-a", `android.media.action.${action}`, "-c", "android.intent.category.DEFAULT", "-p", secureCameraPackage).trim().split(/\r?\n/).map(row => row.trim());
    if (!rows.includes(secureCameraComponent)) throw Error(`Required secure camera handler missing: ${action}`);
    const global = run("shell", "cmd", "package", "query-activities", "--brief", "--components", "--user", user, "-a", `android.media.action.${action}`, "-c", "android.intent.category.DEFAULT").trim().split(/\r?\n/);
    if (global.some(row => row.trim().startsWith(`${alphaPackage}/`))) throw Error(`Alpha must not handle secure camera action: ${action}`);
    handlers[action] = secureCameraComponent;
  }
  const lookup = (pkg, resource) => run("shell", "cmd", "overlay", "lookup", "--user", user, pkg, `${pkg}:${resource}`).trim();
  if (lookup("android", "bool/config_cameraDoubleTapPowerGestureEnabled") !== "true") throw Error("System power camera gesture is not enabled");
  if (lookup("com.android.systemui", "string/config_cameraGesturePackage") !== secureCameraPackage) throw Error("SystemUI camera gesture does not target reviewed Camera2");
  const disabled = run("shell", "settings", "--user", user, "get", "secure", "camera_double_tap_power_gesture_disabled").trim();
  if (!["null", "0"].includes(disabled)) throw Error("Selected user disabled the power camera gesture");
  const features = run("shell", "pm", "list", "features");
  if (!features.split(/\r?\n/).includes("feature:android.hardware.camera.any")) throw Error("Image has no camera feature");
  return { user, fingerprint, packageName: secureCameraPackage, handlers, imageContractVerified: true, lockedCaptureVerified: false, unlockPrivacyVerified: false, deviceAcceptanceVerified: false };
}

/** Manifest guard reused from reviewed remote df5ddb4a; runtime lockscreen behavior remains a separate gate. */
export function assertNoAlphaLockScreenSurface(xmltree) {
  const problems = [];
  for (const row of manifestComponents(xmltree)) {
    if (row.tag === "service") continue;
    for (const attr of ["showWhenLocked", "showOnLockScreen", "turnScreenOn"])
      if (row.attrs[attr] !== undefined && row.attrs[attr] !== "0x0") problems.push(`${row.name} sets android:${attr}`);
    for (const filter of row.filters)
      for (const action of filter.actions)
        if (secureCameraActions.some(name => `android.media.action.${name}` === action)) problems.push(`${row.name} handles ${action}`);
  }
  if (problems.length)
    throw new Error(`Refusing the APK: Alpha does not implement a secure camera or lock-screen surface (policy P-23).\n${problems.map(p => `  - ${p}`).join("\n")}`);
  return true;
}
