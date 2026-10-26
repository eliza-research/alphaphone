#!/usr/bin/env node
/**
 * Alpha release key custody (issue #400, decision P-57): keys are generated on the release
 * owner's machine, private keys live only in the GitHub `release` environment (required
 * reviewer, main only) plus an owner-held encrypted offline backup, and only public
 * certificates/AVB public keys and their digests are committed.
 *
 *   node scripts/release-keys.mjs generate --out ~/.alpha-release-keys [--avbtool /abs/avbtool.py]
 *       Creates the APK keystore and every AOSP release key in a new 0700 directory outside Git,
 *       copies the public halves to android/release-keys/ and pins their digests in
 *       android/release-signer.json, android/aosp/pixel10a-product.json and
 *       android/aosp/pixel10a-ota-channel.json. Refuses to overwrite existing keys or pins.
 *   node scripts/release-keys.mjs backup --keys ~/.alpha-release-keys --to /media/usb/alpha-keys.tar.gpg
 *       gpg --symmetric (AES256) archive; gpg asks for the passphrase. Keep it offline.
 *   node scripts/release-keys.mjs upload --keys ~/.alpha-release-keys [--repo AlphaCompute/alphaphone]
 *       `gh secret set --env release` for each private value, read from stdin; nothing is printed.
 *   node scripts/release-keys.mjs materialize --out /dev/shm/alpha-keys [--keystore-out /dev/shm/k.p12]
 *       CI only: rebuilds the signer key directory from ALPHA_KEY_* environment secrets and the
 *       committed public files (mode 0700/0600). Run in the `release` environment.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, X509Certificate, createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APEX_KEYS, EXPLICIT_KEYS, X509_KEYS } from "./sign-aosp-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = "android/release-keys";
export const SIGNER = "android/release-signer.json";
export const PRODUCT = "android/aosp/pixel10a-product.json";
export const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
export const KEYSTORE = { file: "alpha-release.p12", alias: "alpha-release" };
/** x509 pairs: the signer's default and explicit names plus the APEX container. */
export const PAIR_KEYS = Object.freeze([...new Set([...X509_KEYS, ...EXPLICIT_KEYS, APEX_KEYS.container])]);
/** Raw RSA PEM keys used through avbtool. */
export const AVB_KEYS = Object.freeze({ avb: { pem: "avb.pem", pub: "avb_pkmd.bin" }, apex_payload: { pem: `${APEX_KEYS.payload}.pem`, pub: `${APEX_KEYS.payload}.avbpubkey` } });
const SUBJECT = name => `/C=US/O=Alpha Compute/OU=Alpha Phone release/CN=Alpha Phone ${name}`;
const DAYS = "10000";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const certificateSha256 = pem => new X509Certificate(pem).fingerprint256.replaceAll(":", "").toLowerCase();

/** Secret name for a private key file in the `release` environment. */
export function secretName(file) {
  return `ALPHA_KEY_${file.replace(/\.(pk8|pem)$/, "").toUpperCase()}${file.endsWith(".pk8") ? "_PK8" : "_PEM"}`;
}

/** Every private file in the key directory and the secret that carries it (base64). */
export function privateFiles() {
  return [...PAIR_KEYS.map(name => `${name}.pk8`), ...Object.values(AVB_KEYS).map(key => key.pem)].map(file => ({ file, secret: secretName(file) }));
}

/** Public files the signer reads from the key directory; committed under PUBLIC_DIR. */
export function publicFiles() {
  return [...PAIR_KEYS.map(name => `${name}.x509.pem`), ...Object.values(AVB_KEYS).map(key => key.pub)];
}

function run(tool, args, options = {}) {
  const out = spawnSync(tool, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
  if (out.status !== 0) throw new Error(`${tool} ${args[0]} failed: ${String(out.stderr ?? "").trim().slice(0, 400)}`);
  return out.stdout;
}

function outsideGit(dir) {
  const out = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { stdio: ["ignore", "pipe", "pipe"] });
  return out.status !== 0;
}

function privateDirectory(dir, { create }) {
  if (!path.isAbsolute(dir)) throw new Error(`${dir} must be an absolute path`);
  if (create) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} already exists and is not empty; release keys are never regenerated over existing ones`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(dir, 0o700);
  if (!outsideGit(dir)) throw new Error(`${dir} is inside a Git working tree; release keys never enter a working tree`);
  return fs.realpathSync(dir);
}

function writePrivate(file, bytes) {
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function readJson(rel, root) { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); }
function writeJson(rel, value, root) { fs.writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`); }

/** Refuse to replace an already-pinned digest: a second key set would orphan installed devices. */
export function pinProblems({ signer, product, channel }) {
  const pinned = [];
  if (signer.signerSha256 !== "unset") pinned.push(`${SIGNER} signerSha256`);
  if (product.signer.platformCertificateSha256 !== "UNSET") pinned.push(`${PRODUCT} signer.platformCertificateSha256`);
  for (const [name, value] of Object.entries(product.signer.releaseCertificates)) if (value !== "UNSET") pinned.push(`${PRODUCT} signer.releaseCertificates.${name}`);
  if (product.avb.publicKeySha256 !== "UNSET") pinned.push(`${PRODUCT} avb.publicKeySha256`);
  if (channel.otaCertificateSha256 !== "UNSET") pinned.push(`${CHANNEL} otaCertificateSha256`);
  if (channel.avbPublicKeySha256 !== "UNSET") pinned.push(`${CHANNEL} avbPublicKeySha256`);
  return pinned.map(item => `${item} is already pinned; rotate keys through a reviewed key-rotation change instead`);
}

/** Apply public digests to the three descriptors (pure; returns new objects). */
export function pinnedDescriptors({ signer, product, channel }, digests) {
  const releaseCertificates = Object.fromEntries(Object.keys(product.signer.releaseCertificates).map(name => [name, digests.certificates[name]]));
  for (const [name, value] of Object.entries(releaseCertificates)) if (!/^[0-9a-f]{64}$/.test(value ?? "")) throw new Error(`no generated certificate for ${name}`);
  return {
    signer: { ...signer, signerSha256: digests.apk },
    product: { ...product, signer: { ...product.signer, platformCertificateSha256: digests.certificates.platform, releaseCertificates }, avb: { ...product.avb, publicKeySha256: digests.avb } },
    channel: { ...channel, otaCertificateSha256: digests.certificates.releasekey, avbPublicKeySha256: digests.avb },
  };
}

export function generate({ out, avbtool, root }) {
  const descriptors = { signer: readJson(SIGNER, root), product: readJson(PRODUCT, root), channel: readJson(CHANNEL, root) };
  const pinned = pinProblems(descriptors);
  if (pinned.length) throw new Error(pinned.join("\n"));
  if (!fs.existsSync(avbtool)) throw new Error(`avbtool not found at ${avbtool}; pass --avbtool /abs/external/avb/avbtool.py`);
  const keys = privateDirectory(out, { create: true });
  const tmp = fs.mkdtempSync(path.join(keys, ".work-"));
  try {
    for (const name of PAIR_KEYS) {
      const rsa = path.join(tmp, `${name}.key`);
      run("openssl", ["genrsa", "-out", rsa, "4096"]);
      run("openssl", ["req", "-new", "-x509", "-sha256", "-key", rsa, "-out", path.join(keys, `${name}.x509.pem`), "-days", DAYS, "-subj", SUBJECT(name)]);
      writePrivate(path.join(keys, `${name}.pk8`), run("openssl", ["pkcs8", "-in", rsa, "-topk8", "-outform", "DER", "-nocrypt"]));
    }
    for (const key of Object.values(AVB_KEYS)) {
      const pem = path.join(keys, key.pem);
      run("openssl", ["genrsa", "-out", pem, "4096"]);
      fs.chmodSync(pem, 0o600);
      run("python3", [avbtool, "extract_public_key", "--key", pem, "--output", path.join(keys, key.pub)]);
    }
    const password = randomBytes(32).toString("base64url");
    writePrivate(path.join(keys, "keystore-password"), password);
    run("keytool", ["-genkeypair", "-noprompt", "-storetype", "PKCS12", "-keystore", path.join(keys, KEYSTORE.file), "-alias", KEYSTORE.alias,
      "-keyalg", "RSA", "-keysize", "4096", "-sigalg", "SHA256withRSA", "-validity", DAYS, "-dname", "CN=Alpha Phone APK, OU=Alpha Phone release, O=Alpha Compute, C=US",
      "-storepass:file", path.join(keys, "keystore-password")]);
    fs.chmodSync(path.join(keys, KEYSTORE.file), 0o600);
    const apkPem = run("keytool", ["-exportcert", "-rfc", "-keystore", path.join(keys, KEYSTORE.file), "-alias", KEYSTORE.alias, "-storepass:file", path.join(keys, "keystore-password")]);
    fs.writeFileSync(path.join(keys, "apk.x509.pem"), apkPem);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const certificates = Object.fromEntries(PAIR_KEYS.map(name => [name, certificateSha256(fs.readFileSync(path.join(keys, `${name}.x509.pem`)))]));
  const digests = { certificates, apk: certificateSha256(fs.readFileSync(path.join(keys, "apk.x509.pem"))), avb: sha256(fs.readFileSync(path.join(keys, AVB_KEYS.avb.pub))) };
  const next = pinnedDescriptors(descriptors, digests);
  const publicDir = path.join(root, PUBLIC_DIR);
  fs.mkdirSync(publicDir, { recursive: true });
  for (const file of [...publicFiles(), "apk.x509.pem"]) fs.copyFileSync(path.join(keys, file), path.join(publicDir, file));
  writeJson(SIGNER, next.signer, root);
  writeJson(PRODUCT, next.product, root);
  writeJson(CHANNEL, next.channel, root);
  console.log(`Generated release keys in ${keys} (mode 0700). Public certificates were copied to ${PUBLIC_DIR}/ and pinned.`);
  console.log(`APK signer SHA-256 ${digests.apk}; OTA ${certificates.releasekey}; platform ${certificates.platform}; AVB ${digests.avb}`);
  console.log("Next: back up (release-keys.mjs backup), upload (release-keys.mjs upload), then commit the public files.");
}

function backup({ keys, to }) {
  const dir = privateDirectory(keys, { create: false });
  if (!path.isAbsolute(to) || fs.existsSync(to)) throw new Error(`--to must be a new absolute path`);
  if (!outsideGit(path.dirname(to))) throw new Error("--to is inside a Git working tree");
  const tar = spawnSync("tar", ["-C", path.dirname(dir), "-cf", "-", path.basename(dir)], { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
  if (tar.status !== 0) throw new Error("tar failed");
  const gpg = spawnSync("gpg", ["--symmetric", "--cipher-algo", "AES256", "--output", to], { input: tar.stdout, stdio: ["pipe", "inherit", "inherit"] });
  if (gpg.status !== 0) throw new Error("gpg failed");
  fs.chmodSync(to, 0o600);
  console.log(`Encrypted backup written to ${to} (SHA-256 ${sha256(fs.readFileSync(to))}). Store it offline, away from this machine.`);
}

function setSecret({ gh, repo, name, value }) {
  const out = spawnSync(gh, ["secret", "set", name, "--env", "release", "--repo", repo], { input: value, stdio: ["pipe", "ignore", "pipe"] });
  if (out.status !== 0) throw new Error(`gh secret set ${name} failed: ${String(out.stderr).trim()}`);
  console.log(`set ${name}`);
}

function upload({ keys, repo, gh }) {
  const dir = privateDirectory(keys, { create: false });
  for (const { file, secret } of privateFiles()) setSecret({ gh, repo, name: secret, value: fs.readFileSync(path.join(dir, file)).toString("base64") });
  setSecret({ gh, repo, name: "ELIZAOS_KEYSTORE_BASE64", value: fs.readFileSync(path.join(dir, KEYSTORE.file)).toString("base64") });
  const password = fs.readFileSync(path.join(dir, "keystore-password"), "utf8");
  setSecret({ gh, repo, name: "ELIZAOS_KEYSTORE_PASSWORD", value: password });
  setSecret({ gh, repo, name: "ELIZAOS_KEY_PASSWORD", value: password });
  setSecret({ gh, repo, name: "ELIZAOS_KEY_ALIAS", value: KEYSTORE.alias });
}

/** CI: rebuild the signer key directory from environment secrets and committed public files. */
export function materialize({ out, keystoreOut, env = process.env, root = ROOT }) {
  const dir = privateDirectory(out, { create: true });
  const missing = privateFiles().filter(({ secret }) => !env[secret]).map(({ secret }) => secret);
  if (missing.length) throw new Error(`missing release environment secrets: ${missing.join(", ")}`);
  for (const { file, secret } of privateFiles()) writePrivate(path.join(dir, file), Buffer.from(env[secret], "base64"));
  for (const file of publicFiles()) {
    const source = path.join(root, PUBLIC_DIR, file);
    if (!fs.existsSync(source)) throw new Error(`${PUBLIC_DIR}/${file} is not committed`);
    writePrivate(path.join(dir, file), fs.readFileSync(source));
  }
  if (keystoreOut) {
    if (!env.ELIZAOS_KEYSTORE_BASE64) throw new Error("missing release environment secret ELIZAOS_KEYSTORE_BASE64");
    writePrivate(keystoreOut, Buffer.from(env.ELIZAOS_KEYSTORE_BASE64, "base64"));
  }
  return dir;
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

export async function main(args) {
  const [command, ...rest] = args;
  const home = value => value?.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
  if (command === "generate")
    generate({ out: home(option(rest, "--out")), avbtool: home(option(rest, "--avbtool", "~/Android/pixel10a-preparation/eliza-source/external/avb/avbtool.py")), root: ROOT });
  else if (command === "backup") backup({ keys: home(option(rest, "--keys")), to: home(option(rest, "--to")) });
  else if (command === "upload") upload({ keys: home(option(rest, "--keys")), repo: option(rest, "--repo", "AlphaCompute/alphaphone"), gh: option(rest, "--gh", "gh") });
  else if (command === "materialize") console.log(materialize({ out: option(rest, "--out"), keystoreOut: option(rest, "--keystore-out", null) }));
  else throw new Error("usage: release-keys.mjs generate|backup|upload|materialize (see the header comment)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`release-keys: ${error.message}`); process.exitCode = 1; }
}
