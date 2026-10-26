import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { existingIdentities, generateKeys, parseArgs, privateFiles, publicFiles, PUBLIC_DIR, recordPublicIdentities, X509_NAMES } from "../scripts/aosp-release-key-ceremony.mjs";
import { avbPublicKeyMetadata, rsaModulus } from "../scripts/avb-public-key.mjs";

const DESCRIPTORS = ["android/aosp/pixel10a-product.json", "android/aosp/pixel10a-ota-channel.json", "android/release-signer.json"];
const temporary = (t, prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

test("the ceremony needs an offline backup outside the checkout and refuses unknown options", () => {
  assert.throws(() => parseArgs([]), /--backup/);
  assert.throws(() => parseArgs(["--backup", "relative.enc"]), /--backup/);
  assert.throws(() => parseArgs(["--backup", path.join(process.cwd(), "keys.enc")]), /outside this checkout/);
  assert.throws(() => parseArgs(["--backup", "/tmp/x.enc", "--key-dir", "/tmp"]), /Unknown/);
  assert.deepEqual(parseArgs(["--backup", "/media/offline/keys.enc"]), { backup: "/media/offline/keys.enc", repo: "AlphaCompute/alphaphone-release", secret: "AOSP_RELEASE_KEYS" });
});

test("generated keys publish only certificates and digests, which match the private keys", t => {
  const keys = temporary(t, "ceremony-keys-"), repo = temporary(t, "ceremony-repo-");
  for (const file of DESCRIPTORS) { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.copyFileSync(file, path.join(repo, file)); }
  assert.deepEqual(existingIdentities(repo), []);
  generateKeys(keys);
  for (const file of [...privateFiles(), ...publicFiles()]) assert.ok(fs.existsSync(path.join(keys, file)), file);
  assert.equal(fs.statSync(path.join(keys, "avb.pem")).mode & 0o777, 0o600);
  assert.deepEqual(fs.readFileSync(path.join(keys, "avb_pkmd.bin")), avbPublicKeyMetadata(rsaModulus(path.join(keys, "avb.pem"))));
  const identities = recordPublicIdentities(keys, repo);
  const published = fs.readdirSync(path.join(repo, PUBLIC_DIR)).sort();
  assert.deepEqual(published, publicFiles().sort());
  assert.ok(!published.some(file => /\.pk8$|^avb\.pem$|^apex_payload\.pem$/.test(file)));
  for (const name of X509_NAMES) assert.match(new X509Certificate(fs.readFileSync(path.join(repo, PUBLIC_DIR, `${name}.x509.pem`))).subject, new RegExp(`CN=Alpha Phone ${name}`));
  const product = read(repo, DESCRIPTORS[0]), channel = read(repo, DESCRIPTORS[1]), signer = read(repo, DESCRIPTORS[2]);
  assert.equal(product.signer.platformCertificateSha256, identities.platform);
  assert.ok(Object.values(product.signer.releaseCertificates).every(value => /^[0-9a-f]{64}$/.test(value)));
  assert.equal(channel.otaCertificateSha256, identities.releasekey);
  assert.equal(channel.avbPublicKeySha256, product.avb.publicKeySha256);
  assert.equal(signer.signerSha256, identities.apk);
  assert.equal(product.releaseQualified, false);
  assert.ok(existingIdentities(repo).length >= 4, "a second ceremony refuses to replace reviewed identities");
});
