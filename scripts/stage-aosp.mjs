import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { androidEnv, tool } from "./toolchain.mjs";
import { clockProductRequirement } from "./aosp-clock-contract.mjs";
const args = process.argv.slice(2);
const get = (key) => {
  const i = args.indexOf(key);
  return i < 0 ? null : args[i + 1];
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--development") continue;
  if (
    !["--apk", "--output", "--descriptor", "--target", "--source-lock"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --apk FILE --output NEW_DIR [--descriptor FILE | --development] [--target grizzly|stallion --source-lock FILE]",
    );
  i++;
}
const development = args.includes("--development");
const target = get("--target");
if (target && (!["grizzly", "stallion"].includes(target) || !development))
  throw new Error("Physical product staging requires --target grizzly|stallion --development; it does not admit a release.");
if (get("--source-lock") && !target)
  throw new Error("--source-lock requires a physical --target");
const lockPath = get("--source-lock") || (target === "grizzly" ? "vendor/eliza/packages/os/android/pixel11pro.lock.json" : null);
if (target && !lockPath) throw new Error("Stallion staging requires an explicit --source-lock FILE");
const lockBytes = lockPath ? fs.readFileSync(lockPath) : null;
const lock = lockBytes ? JSON.parse(lockBytes) : null;
if (target && (lock?.device?.codename !== target || lock?.manifestUrl !== "https://android.googlesource.com/platform/manifest" || !lock?.device?.buildId))
  throw new Error("Source lock must describe the selected physical device on the Eliza AOSP base");
const apk = get("--apk");
if (!apk) throw new Error("Supply --apk PATH to a signed launcher APK.");
const identity = JSON.parse(fs.readFileSync("app.config.json"));
const env = androidEnv();
let descriptor = get("--descriptor");
const hash = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
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
    "vendor/eliza/packages/os/scripts/distro-android/stage-launcher-overlay.ts",
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
if (target) {
  execFileSync("python3", ["-B", "scripts/stage-aosp-native.py", "--apk", path.resolve(apk),
    "--output", path.resolve(output), "--module", identity.moduleName, "--target", target], {stdio: "inherit", env});
  fs.appendFileSync(path.join(output, "product.mk"), "\n# Explicit modes for bundled JNI and resident executables.\nTARGET_FS_CONFIG_GEN += vendor/alphaphone/config.fs\n");
  for (const file of ["AndroidProducts.mk", `alpha_${target}_phone.mk`])
    fs.copyFileSync(path.join(`android/aosp/${target}`, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  if (target === "stallion") {
    fs.mkdirSync(path.join(output, "stallion"));
    for (const file of ["device.mk", "device-common.mk"])
      fs.copyFileSync(path.join("android/aosp/stallion", file), path.join(output, "stallion", file), fs.constants.COPYFILE_EXCL);
    fs.cpSync("android/aosp/stallion/sepolicy", path.join(output, "stallion/sepolicy"), {recursive: true, errorOnExist: true, force: false});
    fs.cpSync("android/aosp/stallion/vendor-config", path.join(output, "stallion/vendor-config"), {recursive: true, errorOnExist: true, force: false});
  }
  fs.writeFileSync(path.join(output, "physical-product.json"), JSON.stringify({
    schemaVersion: 1, target: target === "grizzly" ? "pixel11pro-grizzly" : "pixel10a-stallion", productName: `alpha_${target}_phone`,
    lunch: `alpha_${target}_phone-cp2a-userdebug`, development: true,
    sourceLockSha256: createHash("sha256").update(lockBytes).digest("hex"),
    upstreamSourceCommit: JSON.parse(fs.readFileSync("upstream.lock.json")).commit,
    sourceBaseline: lock.manifestRevision, factoryBuildId: lock.device.buildId,
    apkSha256: hash, sourceLockRole: "reference device inputs; upstream product identity is not inherited",
    imageBuilt: false, deployReady: false,
    remaining: ["locked generated vendor inputs and source overlays", "Alpha image build and packaged validation", "Alpha release adapter/signing", "physical boot, stock restoration and hardware acceptance"],
  }, null, 2) + "\n", {flag: "wx"});
}
console.log(
  target
    ? `Alpha ${target} development product staged for vendor/alphaphone. Source/vendor preparation and a full image build are still required; this does not authorize flashing.`
    : `Add under vendor/${identity.slug.replaceAll("-", "_")} and inherit product.mk from the selected AOSP product. This is staging evidence, not an image boot.`,
);
