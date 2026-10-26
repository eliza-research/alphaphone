// Release key custody tooling (issue #400, P-57). Values are throwaway bytes in temporary
// directories: these tests establish secret naming, pin refusal and CI key-directory
// reconstruction. They are not generated release keys, a signed image or a signed APK.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHANNEL, PAIR_KEYS, PRODUCT, PUBLIC_DIR, SIGNER, materialize, pinProblems, pinnedDescriptors, privateFiles, publicFiles, secretName } from "../scripts/release-keys.mjs";
import { APEX_KEYS, EXPLICIT_KEYS, X509_KEYS } from "../scripts/sign-aosp-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const hex = c => c.repeat(64);

test("every signer key name has a private secret and a committed public file", () => {
  for (const name of [...X509_KEYS, ...EXPLICIT_KEYS, APEX_KEYS.container]) {
    assert.ok(PAIR_KEYS.includes(name), name);
    assert.ok(privateFiles().some(row => row.file === `${name}.pk8`), `${name}.pk8`);
    assert.ok(publicFiles().includes(`${name}.x509.pem`), `${name}.x509.pem`);
  }
  assert.ok(publicFiles().includes("avb_pkmd.bin") && publicFiles().includes(`${APEX_KEYS.payload}.avbpubkey`));
  assert.equal(secretName("sdk_sandbox.pk8"), "ALPHA_KEY_SDK_SANDBOX_PK8");
  assert.equal(secretName("avb.pem"), "ALPHA_KEY_AVB_PEM");
  const names = privateFiles().map(row => row.secret);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[A-Z][A-Z0-9_]*$/);
});

test("pins apply to all three descriptors and are never replaced", () => {
  const descriptors = { signer: read(SIGNER), product: read(PRODUCT), channel: read(CHANNEL) };
  const certificates = Object.fromEntries(PAIR_KEYS.map((name, index) => [name, hex("abcdef0123456789"[index % 16])]));
  const next = pinnedDescriptors(descriptors, { certificates, apk: hex("1"), avb: hex("2") });
  assert.equal(next.signer.signerSha256, hex("1"));
  assert.equal(next.product.signer.platformCertificateSha256, certificates.platform);
  assert.equal(next.channel.otaCertificateSha256, certificates.releasekey);
  assert.equal(next.channel.avbPublicKeySha256, next.product.avb.publicKeySha256);
  assert.deepEqual(Object.keys(next.product.signer.releaseCertificates), Object.keys(descriptors.product.signer.releaseCertificates));
  assert.equal(pinProblems(next).length, 12);
  assert.throws(() => pinnedDescriptors(descriptors, { certificates: { ...certificates, nfc: undefined }, apk: hex("1"), avb: hex("2") }), /nfc/);
});

test("CI materialize refuses missing secrets and rebuilds a private key directory", t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-release-keys-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const fakeRoot = path.join(base, "repo");
  fs.mkdirSync(path.join(fakeRoot, PUBLIC_DIR), { recursive: true });
  for (const file of publicFiles()) fs.writeFileSync(path.join(fakeRoot, PUBLIC_DIR, file), `public ${file}`);
  const env = Object.fromEntries(privateFiles().map(({ file, secret }) => [secret, Buffer.from(`private ${file}`).toString("base64")]));
  assert.throws(() => materialize({ out: path.join(base, "partial"), env: { ...env, ALPHA_KEY_AVB_PEM: "" }, root: fakeRoot }), /ALPHA_KEY_AVB_PEM/);
  const dir = materialize({ out: path.join(base, "keys"), keystoreOut: path.join(base, "k.p12"), env: { ...env, ELIZAOS_KEYSTORE_BASE64: Buffer.from("store").toString("base64") }, root: fakeRoot });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const { file } of privateFiles()) {
    assert.equal(fs.readFileSync(path.join(dir, file), "utf8"), `private ${file}`);
    assert.equal(fs.statSync(path.join(dir, file)).mode & 0o777, 0o600);
  }
  for (const file of publicFiles()) assert.equal(fs.readFileSync(path.join(dir, file), "utf8"), `public ${file}`);
  assert.equal(fs.readFileSync(path.join(base, "k.p12"), "utf8"), "store");
  assert.throws(() => materialize({ out: path.join(base, "keys"), env, root: fakeRoot }), /not empty/);
});
