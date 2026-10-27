// Release APK signing outside Gradle (docs/human-actions.md H-10): the ceremony's key files or a
// PKCS#11 token sign the unsigned releases, and nothing replaces an unsigned release unless the
// result verifies against android/release-signer.json. A stub apksigner records argument vectors;
// where the Android SDK is installed, one case signs a real APK with a throwaway key.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PIN_ENV, keyFileProblems, main, signArguments } from "../scripts/sign-release-apks.mjs";

const RELEASE = "e5".repeat(32);

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A product root with a release signer record and the two unsigned releases verify-apks names. */
function product(t, signer = RELEASE) {
  const root = scratch(t, "alpha-sign-root-");
  fs.mkdirSync(path.join(root, "android"));
  fs.writeFileSync(path.join(root, "android/release-signer.json"), JSON.stringify({ schema: 1, signerSha256: signer, lastRelease: { versionCode: null, versionName: null, recordedAt: null } }));
  fs.mkdirSync(path.join(root, "artifacts"));
  for (const variant of ["standalone", "launcher"]) fs.writeFileSync(path.join(root, `artifacts/${variant}-release-unsigned.apk`), `unsigned ${variant}`);
  return root;
}

/** Decrypted ceremony layout for one signing job: owner-only directory and key files (contents unused by the stub). */
function keys(t, { dirMode = 0o700, fileMode = 0o600 } = {}) {
  const dir = scratch(t, "alpha-sign-keys-");
  fs.chmodSync(dir, dirMode);
  for (const file of ["alphaphone_app.pk8", "alphaphone_app.x509.pem"]) fs.writeFileSync(path.join(dir, file), "public-or-throwaway", { mode: fileMode });
  return dir;
}

/** A stub apksigner that records its argv and whether the PIN variable reached it, then copies input to --out. */
function stubSigner(t) {
  const dir = scratch(t, "alpha-sign-tool-");
  const log = path.join(dir, "calls.jsonl");
  const tool = path.join(dir, "apksigner");
  fs.writeFileSync(tool, `#!${process.execPath}\nconst fs=require("fs");const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({argv:a,pin:process.env.${PIN_ENV}??null})+"\\n");const o=a[a.indexOf("--out")+1];fs.copyFileSync(a.at(-1),o);\n`, { mode: 0o755 });
  return { tool, calls: () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
}

async function sign(root, argv, { env = {}, digest = async () => RELEASE } = {}) {
  const out = [], err = [], ran = [];
  const code = await main(argv, { root, env, digest, run: (command, args) => ran.push(args), log: line => out.push(line), error: line => err.push(line) });
  return { code, out: out.join("\n"), err: err.join("\n"), ran };
}

test("key files sign both releases, replace the unsigned files only after the signer matches, and refresh the manifest and SBOM", async t => {
  const root = product(t), dir = keys(t), { tool, calls } = stubSigner(t);
  const result = await sign(root, ["--keys-dir", dir, "--apksigner", tool]);
  assert.equal(result.code, 0, result.err);
  for (const variant of ["standalone", "launcher"]) {
    assert.equal(fs.readFileSync(path.join(root, `artifacts/${variant}-release.apk`), "utf8"), `unsigned ${variant}`);
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release-unsigned.apk`)), false, "exactly one release name per variant");
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release.apk.partial`)), false);
  }
  const real = fs.realpathSync(dir);
  assert.deepEqual(calls()[0].argv, ["sign", "--key", path.join(real, "alphaphone_app.pk8"), "--cert", path.join(real, "alphaphone_app.x509.pem"),
    "--v4-signing-enabled", "false", "--out", path.join(root, "artifacts/standalone-release.apk.partial"), path.join(root, "artifacts/standalone-release-unsigned.apk")]);
  assert.deepEqual(result.ran.map(args => args[0]), ["scripts/verify-apks.mjs", "scripts/generate-sbom.mjs"]);
  assert.deepEqual(result.ran[0], ["scripts/verify-apks.mjs"]);
  assert.ok(result.ran[1].includes("--apks"));
});

test("re-verification keeps the recorded runtime profile, and a test-mocks build is never signed for release", async t => {
  const { tool } = stubSigner(t);
  const cloud = product(t);
  fs.writeFileSync(path.join(cloud, "artifacts/build-config.json"), JSON.stringify({ testMocks: false, runtimeProfile: "cloud" }));
  const signed = await sign(cloud, ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(signed.code, 0, signed.err);
  assert.deepEqual(signed.ran[0], ["scripts/verify-apks.mjs", "--runtime-profile=cloud"]);
  const mocks = product(t);
  fs.writeFileSync(path.join(mocks, "artifacts/build-config.json"), JSON.stringify({ testMocks: true, runtimeProfile: "native" }));
  const refused = await sign(mocks, ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /test-mocks build, which is never distributable/);
  assert.equal(fs.existsSync(path.join(mocks, "artifacts/standalone-release.apk")), false);
});

test("a result signed by any other certificate leaves the unsigned releases and no signed file", async t => {
  const root = product(t), dir = keys(t), { tool } = stubSigner(t);
  const result = await sign(root, ["--keys-dir", dir, "--apksigner", tool], { digest: async () => "f6".repeat(32) });
  assert.equal(result.code, 1);
  assert.match(result.err, /not the recorded release certificate/);
  for (const variant of ["standalone", "launcher"]) {
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release-unsigned.apk`)), true);
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release.apk`)), false);
    assert.equal(fs.existsSync(path.join(root, `artifacts/${variant}-release.apk.partial`)), false);
  }
  assert.deepEqual(result.ran, []);
});

test("PKCS#11 signing names the token key by label and passes a PIN only through the environment", async t => {
  const root = product(t), { tool, calls } = stubSigner(t);
  const config = path.join(scratch(t, "alpha-sign-p11-"), "sunpkcs11.cfg");
  fs.writeFileSync(config, "name = alpha\nlibrary = /usr/lib/pkcs11/example.so\n");
  const withPin = await sign(root, ["--pkcs11-config", config, "--key-label", "alpha-release-app", "--apksigner", tool, "--no-verify"], { env: { [PIN_ENV]: "123456" } });
  assert.equal(withPin.code, 0, withPin.err);
  const [first] = calls();
  assert.deepEqual(first.argv.slice(0, 14), ["-J--add-exports=jdk.crypto.cryptoki/sun.security.pkcs11=ALL-UNNAMED", "sign", "--provider-class", "sun.security.pkcs11.SunPKCS11",
    "--provider-arg", config, "--ks", "NONE", "--ks-type", "PKCS11", "--ks-key-alias", "alpha-release-app", "--ks-pass", `env:${PIN_ENV}`]);
  assert.equal(first.pin, "123456", "the PIN reaches apksigner through its environment");
  assert.ok(!first.argv.join(" ").includes("123456"), "the PIN is never on the command line");
  assert.match(withPin.out, /Skipped verify-apks/);
  assert.deepEqual(signArguments({ mode: "pkcs11", pkcs11Config: config, keyLabel: "x", pin: false, input: "in.apk", output: "out.apk" }).slice(12, 14), ["--ks-pass", "pass:"]);
});

test("the key directory and files must be owner-only, outside Git and real files", t => {
  assert.match(keyFileProblems("relative/keys", "alphaphone_app").join(), /absolute path/);
  assert.match(keyFileProblems(path.join(os.tmpdir(), "alpha-missing-keys-dir"), "alphaphone_app").join(), /does not exist/);
  assert.match(keyFileProblems(keys(t, { dirMode: 0o750 }), "alphaphone_app").join(), /owner-only/);
  assert.match(keyFileProblems(keys(t, { fileMode: 0o640 }), "alphaphone_app").join(), /mode 0600 or stricter/);
  const tree = scratch(t, "alpha-sign-tree-");
  fs.mkdirSync(path.join(tree, ".git"));
  const inside = path.join(tree, "keys");
  fs.mkdirSync(inside, { mode: 0o700 });
  for (const file of ["alphaphone_app.pk8", "alphaphone_app.x509.pem"]) fs.writeFileSync(path.join(inside, file), "x", { mode: 0o600 });
  assert.match(keyFileProblems(inside, "alphaphone_app").join(), /inside the Git working tree/);
  const link = path.join(scratch(t, "alpha-sign-link-"), "keys");
  fs.symlinkSync(keys(t), link);
  assert.match(keyFileProblems(link, "alphaphone_app").join(), /symbolic link/);
  const pair = keys(t);
  fs.rmSync(path.join(pair, "alphaphone_app.x509.pem"));
  assert.match(keyFileProblems(pair, "alphaphone_app").join(), /alphaphone_app\.x509\.pem is missing/);
  assert.deepEqual(keyFileProblems(keys(t), "alphaphone_app"), []);
});

test("refusals: no enrolled signer, already signed releases, mixed modes, dry run changes nothing", async t => {
  const { tool, calls } = stubSigner(t);
  const unset = await sign(product(t, "unset"), ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(unset.code, 1);
  assert.match(unset.err, /H-09/);
  const root = product(t);
  fs.writeFileSync(path.join(root, "artifacts/launcher-release.apk"), "signed by Gradle");
  const twice = await sign(root, ["--keys-dir", keys(t), "--apksigner", tool]);
  assert.equal(twice.code, 1);
  assert.match(twice.err, /launcher-release\.apk already exists/);
  for (const argv of [[], ["--keys-dir", "/k", "--key-label", "x"], ["--pkcs11-config", "/c"], ["--pkcs11-config", "/c", "--key-label", "x", "--key-name", "y"], ["--keys-dir"], ["--keys-dir", "/k", "--bogus"], ["--keys-dir", "/k", "--artifacts", "x"]])
    assert.equal((await sign(product(t), argv)).code, 2, argv.join(" "));
  const dry = product(t);
  const dryRun = await sign(dry, ["--keys-dir", keys(t), "--apksigner", tool, "--dry-run"]);
  assert.equal(dryRun.code, 0, dryRun.err);
  assert.match(dryRun.out, /Dry run: nothing signed/);
  assert.match(dryRun.out, /sign --key .*alphaphone_app\.pk8/);
  assert.deepEqual(calls(), []);
  assert.equal(fs.existsSync(path.join(dry, "artifacts/standalone-release-unsigned.apk")), true);
  // One explicit APK (for example the preprocessed listener) keeps its input and does not rewrite the manifest.
  const single = product(t);
  const listener = path.join(single, "sense-release-unsigned.apk");
  fs.writeFileSync(listener, "listener");
  const one = await sign(single, ["--keys-dir", keys(t), "--apksigner", tool, "--apk", listener, "--out", path.join(single, "sense-release.apk")]);
  assert.equal(one.code, 0, one.err);
  assert.equal(fs.existsSync(listener), true);
  assert.equal(fs.readFileSync(path.join(single, "sense-release.apk"), "utf8"), "listener");
  assert.deepEqual(one.ran, []);
});

test("a real apksigner signs an APK with ceremony-layout key files, and the result verifies against the recorded certificate", async t => {
  let toolchain;
  try { toolchain = await import("../scripts/toolchain.mjs"); toolchain.androidEnv(); } catch { t.skip("Android SDK and JDK 21 are not installed here"); return; }
  const apksigner = toolchain.tool("apksigner"), aapt2 = path.join(path.dirname(apksigner), "aapt2");
  const androidJar = path.join(toolchain.androidEnv().ANDROID_HOME, "platforms/android-36/android.jar");
  if (![apksigner, aapt2, androidJar].every(file => fs.existsSync(file))) { t.skip("build-tools 36.0.0 or platform android-36 is missing"); return; }
  const work = scratch(t, "alpha-sign-real-");
  fs.writeFileSync(path.join(work, "AndroidManifest.xml"), '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.example.signingtest"><uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/><application android:hasCode="false"/></manifest>');
  const unsigned = path.join(work, "app-unsigned.apk");
  execFileSync(aapt2, ["link", "-o", unsigned, "-I", androidJar, "--manifest", path.join(work, "AndroidManifest.xml")], { stdio: "ignore" });
  const dir = keys(t);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/O=Example Release Test/CN=alphaphone_app", "-days", "1", "-keyout", path.join(work, "key.pem"), "-out", path.join(dir, "alphaphone_app.x509.pem")], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs8", "-topk8", "-nocrypt", "-outform", "DER", "-in", path.join(work, "key.pem"), "-out", path.join(dir, "alphaphone_app.pk8")], { stdio: "ignore" });
  fs.chmodSync(path.join(dir, "alphaphone_app.pk8"), 0o600);
  fs.chmodSync(path.join(dir, "alphaphone_app.x509.pem"), 0o600);
  const certificate = new X509Certificate(fs.readFileSync(path.join(dir, "alphaphone_app.x509.pem"))).fingerprint256.replaceAll(":", "").toLowerCase();
  const root = product(t, certificate);
  const out = [], err = [];
  const code = await main(["--keys-dir", dir, "--apksigner", apksigner, "--apk", unsigned, "--out", path.join(work, "app-release.apk")],
    { root, env: process.env, log: line => out.push(line), error: line => err.push(line) });
  assert.equal(code, 0, err.join("\n"));
  const { signerDigest } = await import("../scripts/apk.mjs");
  assert.equal(signerDigest(path.join(work, "app-release.apk")), certificate);
  assert.equal(fs.existsSync(path.join(work, "app-release.apk.idsig")), false, "no v4 side file is written");
  // The same key against a different recorded signer is refused and leaves nothing behind.
  const other = product(t, "0".repeat(64));
  assert.equal(await main(["--keys-dir", dir, "--apksigner", apksigner, "--apk", unsigned, "--out", path.join(work, "other.apk")], { root: other, env: process.env, log() {}, error() {} }), 1);
  assert.equal(fs.existsSync(path.join(work, "other.apk")), false);
});
