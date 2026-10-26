#!/usr/bin/env node
/**
 * One-time Pixel 10a release key ceremony (issue #399, decision P-16 key-file mode).
 *
 * Run by a person in their own terminal. It generates every release key in a 0700 directory
 * under /dev/shm, writes a passphrase-encrypted offline backup (openssl prompts for the
 * passphrase), stores the private keys as one GitHub Actions secret on the private release
 * repository with `gh secret set`, and writes only public material into this checkout:
 * certificates, AVB public key metadata and their reviewed digests in the product descriptor,
 * update channel and APK release-signer descriptor. The key directory is overwritten and removed
 * on exit. Private keys are never printed, committed or passed on a command line.
 *
 *   node scripts/aosp-release-key-ceremony.mjs --backup /absolute/offline/alphaphone-release-keys.tar.gz.enc \
 *     [--repo AlphaCompute/alphaphone-release] [--secret AOSP_RELEASE_KEYS]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { avbPublicKeyMetadata, rsaModulus } from "./avb-public-key.mjs";
import { certificateSha256 } from "./aosp-release-record.mjs";
import { X509_KEYS, APEX_KEYS } from "./sign-aosp-release.mjs";
import { PIXEL10A_PRODUCT } from "./aosp-pixel10a.mjs";

const root = path.resolve(import.meta.dirname, "..");
const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
const APK_SIGNER = "android/release-signer.json";
export const PUBLIC_DIR = "android/aosp/release-keys";
/** The launcher and listener APK release key (apksigner --key/--cert). */
export const APK_KEY = "alpha_apk";
/** RSA-2048 x509 keys as AOSP make_key creates them; AVB and APEX payload keys are RSA-4096. */
export const X509_NAMES = Object.freeze([...X509_KEYS, APEX_KEYS.container, APK_KEY]);
const RSA4096 = Object.freeze(["avb", APEX_KEYS.payload]);
const SECRET_LIMIT = 48 * 1024;
/** `GH_BIN` selects the GitHub CLI when `gh` on PATH is a wrapper. */
const GH = process.env.GH_BIN || "gh";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function parseArgs(args) {
  const values = { "--repo": "AlphaCompute/alphaphone-release", "--secret": "AOSP_RELEASE_KEYS" };
  for (let i = 0; i < args.length; i += 2) {
    if (!["--backup", "--repo", "--secret"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw Error(`Unknown or incomplete option: ${args[i]}`);
    values[args[i]] = args[i + 1];
  }
  if (!values["--backup"] || !path.isAbsolute(values["--backup"])) throw Error("--backup /absolute/new/file is required: GitHub secrets cannot be read back, so this is the only recoverable copy");
  if (fs.existsSync(values["--backup"])) throw Error(`${values["--backup"]} already exists`);
  const relative = path.relative(root, values["--backup"]);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw Error("The backup must be outside this checkout");
  if (!/^[\w.-]+\/[\w.-]+$/.test(values["--repo"])) throw Error("--repo must be OWNER/NAME");
  if (!/^[A-Z][A-Z0-9_]*$/.test(values["--secret"])) throw Error("--secret must be an Actions secret name");
  return { backup: values["--backup"], repo: values["--repo"], secret: values["--secret"] };
}

/** Refuse to replace reviewed release identities: rotation is a separate, reviewed change. */
export function existingIdentities(dir = root) {
  const product = JSON.parse(fs.readFileSync(path.join(dir, PIXEL10A_PRODUCT), "utf8"));
  const channel = JSON.parse(fs.readFileSync(path.join(dir, CHANNEL), "utf8"));
  const signer = JSON.parse(fs.readFileSync(path.join(dir, APK_SIGNER), "utf8"));
  const set = value => /^[0-9a-f]{64}$/.test(value ?? "");
  return [
    set(product.signer.platformCertificateSha256) && `${PIXEL10A_PRODUCT} signer.platformCertificateSha256`,
    set(product.avb.publicKeySha256) && `${PIXEL10A_PRODUCT} avb.publicKeySha256`,
    set(channel.otaCertificateSha256) && `${CHANNEL} otaCertificateSha256`,
    set(signer.signerSha256) && `${APK_SIGNER} signerSha256`,
    fs.existsSync(path.join(dir, PUBLIC_DIR)) && PUBLIC_DIR,
  ].filter(Boolean);
}

const openssl = (args, options = {}) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "inherit"], ...options });

/** Generate all keys into `keys` (an existing 0700 directory). */
export function generateKeys(keys) {
  for (const name of X509_NAMES) {
    const pem = path.join(keys, `${name}.key.pem`);
    openssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", pem]);
    openssl(["pkcs8", "-topk8", "-nocrypt", "-inform", "PEM", "-outform", "DER", "-in", pem, "-out", path.join(keys, `${name}.pk8`)]);
    openssl(["req", "-new", "-x509", "-sha256", "-days", "10950", "-key", pem, "-subj", `/C=US/O=Alpha Compute/OU=Alpha Phone/CN=Alpha Phone ${name}`, "-out", path.join(keys, `${name}.x509.pem`)]);
    fs.rmSync(pem);
  }
  for (const name of RSA4096) openssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:4096", "-out", path.join(keys, `${name}.pem`)]);
  fs.writeFileSync(path.join(keys, "avb_pkmd.bin"), avbPublicKeyMetadata(rsaModulus(path.join(keys, "avb.pem"))));
  fs.writeFileSync(path.join(keys, `${APEX_KEYS.payload}.avbpubkey`), avbPublicKeyMetadata(rsaModulus(path.join(keys, `${APEX_KEYS.payload}.pem`))));
  for (const file of fs.readdirSync(keys)) fs.chmodSync(path.join(keys, file), 0o600);
}

export const privateFiles = () => [...X509_NAMES.map(name => `${name}.pk8`), ...RSA4096.map(name => `${name}.pem`)];
export const publicFiles = () => [...X509_NAMES.map(name => `${name}.x509.pem`), "avb_pkmd.bin", `${APEX_KEYS.payload}.avbpubkey`];

/** Write the public certificates and every reviewed digest derived from them into `dir`. */
export function recordPublicIdentities(keys, dir = root) {
  const out = path.join(dir, PUBLIC_DIR);
  fs.mkdirSync(out, { recursive: true });
  for (const file of publicFiles()) fs.copyFileSync(path.join(keys, file), path.join(out, file), fs.constants.COPYFILE_EXCL);
  const cert = name => certificateSha256(fs.readFileSync(path.join(out, `${name}.x509.pem`)));
  const avb = sha256(fs.readFileSync(path.join(out, "avb_pkmd.bin")));
  const edit = (file, change) => {
    const value = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    change(value);
    fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + "\n");
  };
  edit(PIXEL10A_PRODUCT, product => {
    product.signer.platformCertificateSha256 = cert("platform");
    for (const name of Object.keys(product.signer.releaseCertificates)) product.signer.releaseCertificates[name] = cert(name);
    product.avb.publicKeySha256 = avb;
  });
  edit(CHANNEL, channel => { channel.otaCertificateSha256 = cert("releasekey"); channel.avbPublicKeySha256 = avb; });
  edit(APK_SIGNER, signer => { signer.signerSha256 = cert(APK_KEY); });
  return { platform: cert("platform"), releasekey: cert("releasekey"), apk: cert(APK_KEY), avbPublicKeySha256: avb };
}

function wipe(keys) {
  for (const file of fs.readdirSync(keys)) {
    const target = path.join(keys, file);
    fs.writeFileSync(target, Buffer.alloc(fs.statSync(target).size));
  }
  fs.rmSync(keys, { recursive: true, force: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const existing = existingIdentities();
  if (existing.length) throw Error(`Release identities are already recorded; rotation is a separate reviewed change:\n  - ${existing.join("\n  - ")}`);
  execFileSync(GH, ["repo", "view", options.repo, "--json", "isPrivate", "--jq", "if .isPrivate then \"private\" else error(\"public\") end"], { stdio: ["ignore", "ignore", "inherit"] });
  const keys = fs.mkdtempSync(path.join(fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(), "alpha-release-keys-"));
  fs.chmodSync(keys, 0o700);
  try {
    generateKeys(keys);
    const archive = execFileSync("tar", ["-C", keys, "-czf", "-", ...privateFiles()], { maxBuffer: 1 << 20 });
    const encoded = archive.toString("base64");
    if (encoded.length > SECRET_LIMIT) throw Error(`Key archive is ${encoded.length} bytes; Actions secrets hold at most ${SECRET_LIMIT}`);
    console.log("Encrypting the offline backup. openssl will ask for a passphrase twice; store it separately from the backup.");
    const backup = spawnSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-salt", "-out", options.backup], { input: archive, stdio: ["pipe", "inherit", "inherit"] });
    if (backup.status !== 0) throw Error("Backup encryption failed; nothing was uploaded");
    fs.chmodSync(options.backup, 0o600);
    execFileSync(GH, ["secret", "set", options.secret, "--repo", options.repo], { input: encoded, stdio: ["pipe", "inherit", "inherit"] });
    const identities = recordPublicIdentities(keys);
    console.log(`Stored ${options.secret} on ${options.repo} and wrote the encrypted backup ${options.backup}.`);
    console.log(`Public identities: platform ${identities.platform}, OTA ${identities.releasekey}, APK ${identities.apk}, AVB ${identities.avbPublicKeySha256}.`);
    console.log(`Commit ${PUBLIC_DIR}, ${PIXEL10A_PRODUCT}, ${CHANNEL} and ${APK_SIGNER}. No private key was written to this checkout.`);
  } finally {
    wipe(keys);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await main();
