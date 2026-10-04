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
  if (["--development", "--development-kiosk"].includes(args[i])) continue;
  if (
    !["--apk", "--output", "--descriptor"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --apk FILE --output NEW_DIR [--descriptor FILE | --development]",
    );
  i++;
}
const development = args.includes("--development");
const kiosk = args.includes("--development-kiosk");
if(kiosk && !development) throw Error("Kiosk development overlay requires --development");
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
if(kiosk) {
 fs.cpSync("android/aosp/AlphaKioskFrameworkOverlay",path.join(output,"AlphaKioskFrameworkOverlay"),{recursive:true});
 fs.appendFileSync(path.join(output,"product.mk"),"\n# Explicit development kiosk; enroll using scripts/provision-cuttlefish-kiosk.mjs.\nPRODUCT_PACKAGES += AlphaKioskFrameworkOverlay\nPRODUCT_PRODUCT_PROPERTIES += persist.sys.usb.config=adb\n");
}
console.log(
  `Add under vendor/${identity.slug.replaceAll("-", "_")} and inherit product.mk from the selected AOSP product. This is staging evidence, not an image boot.`,
);
