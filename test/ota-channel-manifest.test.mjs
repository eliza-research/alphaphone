// The update channel manifest writer (scripts/ota/make-channel-manifest.mjs, docs/runbooks/ota-updates.md).
// Packages are small zips in the ota_from_target_files layout with a fake payload: no build, key or device.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { channelManifest } from "../scripts/ota/make-channel-manifest.mjs";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/ota/make-channel-manifest.mjs");
const LAB = "Alpha/alpha_stallion_phone/stallion:17/CP2A.260605.016/eng.shaw:userdebug/test-keys";
const DEV = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/42:user/dev-keys";
const RELEASE = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/42:user/release-keys";
const PREVIOUS = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/41:user/release-keys";
const PAYLOAD = Buffer.concat([Buffer.from("CrAU"), Buffer.alloc(60, 7)]);
// payload.bin is the first stored entry: a 30-byte local header plus its 11-byte name.
const OFFSET = 41;

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-ota-manifest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A stored zip whose entries keep their order; values are latin1 strings. */
function ota(dir, name, { post = RELEASE, pre = null, offset = OFFSET, fileSize = PAYLOAD.length, omit = null } = {}) {
  const metadata = [
    `ota-streaming-property-files=payload.bin:${offset}:${PAYLOAD.length},payload_properties.txt:200:150,metadata:400:300          `,
    "ota-type=AB",
    `post-build=${post}`,
    "post-security-patch-level=2026-10-05",
    "post-timestamp=1793000000",
    ...(pre ? [`pre-build=${pre}`] : []),
    "pre-device=stallion",
  ].join("\n");
  const properties = `FILE_HASH=${createHash("sha256").update(PAYLOAD).digest("base64")}\nFILE_SIZE=${fileSize}\nMETADATA_HASH=bWV0YQ==\nMETADATA_SIZE=12\n`;
  const content = { "payload.bin": PAYLOAD.toString("latin1"), "payload_properties.txt": properties, "META-INF/com/android/metadata": metadata };
  delete content[omit];
  const file = path.join(dir, name);
  execFileSync("python3", ["-I", "-c", "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for k,v in json.loads(sys.argv[2]).items(): z.writestr(k, v.encode('latin1'))", file, JSON.stringify(content)]);
  return file;
}

const options = (otas, overrides = {}) => ({ channel: "stable", version: "0.1.0", sequence: 1, baseUrl: "https://updates.example/alpha/stallion/0.1.0", otas, ...overrides });

test("describes a full and an incremental package for update_engine", async t => {
  const dir = temporary(t);
  const incremental = ota(dir, "incremental-from-41.zip", { pre: PREVIOUS });
  const full = ota(dir, "ota.zip");
  const manifest = await channelManifest(options([incremental, full]));
  const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.deepEqual(manifest, {
    schema: 1,
    channel: "stable",
    device: "stallion",
    version: "0.1.0",
    sequence: 1,
    buildFingerprint: RELEASE,
    buildDateUtc: 1793000000,
    securityPatch: "2026-10-05",
    rolloutPercent: 100,
    updates: [full, incremental].map((file, index) => ({
      from: index ? PREVIOUS : null,
      url: `https://updates.example/alpha/stallion/0.1.0/${path.basename(file)}`,
      sha256: sha256(file),
      sizeBytes: fs.statSync(file).size,
      payload: {
        offset: OFFSET,
        size: PAYLOAD.length,
        properties: [`FILE_HASH=${createHash("sha256").update(PAYLOAD).digest("base64")}`, `FILE_SIZE=${PAYLOAD.length}`, "METADATA_HASH=bWV0YQ==", "METADATA_SIZE=12"],
      },
    })),
  });
  assert.equal(fs.readFileSync(full).subarray(OFFSET, OFFSET + 4).toString(), "CrAU");
  assert.equal((await channelManifest(options([full], { rolloutPercent: 0 }))).rolloutPercent, 0);
});

test("serves a test-keys or dev-keys build only over loopback", async t => {
  const dir = temporary(t);
  const lab = ota(dir, "ota.zip", { post: LAB });
  const manifest = await channelManifest(options([lab], { channel: "beta", version: "lab-20261102", baseUrl: "http://127.0.0.1:8000" }));
  assert.equal(manifest.updates[0].url, "http://127.0.0.1:8000/ota.zip");
  await assert.rejects(channelManifest(options([lab])), /test-keys or dev-keys build is described only for a loopback URL/);
  await assert.rejects(channelManifest(options([ota(dir, "dev.zip", { post: DEV })])), /test-keys or dev-keys build is described only for a loopback URL/);
  await assert.rejects(channelManifest(options([lab], { baseUrl: "http://updates.example/" })), /must be https, or http on a loopback/);
  await assert.rejects(channelManifest(options([lab], { baseUrl: "https://user:pass@updates.example/" })), /must not carry credentials/);
});

test("refuses packages update_engine could not stream as described", async t => {
  const dir = temporary(t);
  const full = ota(dir, "ota.zip");
  const cases = [
    [[ota(dir, "moved.zip", { offset: 99 })], /moved\.zip: payload\.bin is not at its recorded offset/],
    [[ota(dir, "short.zip", { fileSize: 12 })], /short\.zip: payload_properties\.txt FILE_SIZE is not the payload\.bin size/],
    [[ota(dir, "bare.zip", { omit: "payload_properties.txt" })], /bare\.zip: payload_properties\.txt is missing/],
    [[full, ota(dir, "full-2.zip")], /exactly one package must be a full OTA/],
    [[full, ota(dir, "other.zip", { post: PREVIOUS, pre: LAB })], /every package must update to the same build/],
    [[full, ota(dir, "a.zip", { pre: PREVIOUS }), ota(dir, "b.zip", { pre: PREVIOUS })], /two incremental packages start from the same build/],
    [[ota(dir, "self.zip", { pre: RELEASE }), full], /starts from the build it updates to/],
  ];
  for (const [otas, problem] of cases) await assert.rejects(channelManifest(options(otas)), problem);
  await assert.rejects(channelManifest(options([full], { rolloutPercent: 101, channel: "nightly", version: "../x", sequence: 0 })), error =>
    ["channel must be one of stable, beta", "version must be a plain token", "sequence must be a positive integer", "rollout percent must be an integer"].every(text => error.message.includes(text)));
});

test("the command writes a new manifest file and never overwrites one", t => {
  const dir = temporary(t);
  const full = ota(dir, "ota.zip");
  const out = path.join(dir, "stable.json");
  const run = () => spawnSync(process.execPath, [SCRIPT, "--channel", "stable", "--version", "0.1.0", "--sequence", "3", "--base-url", "https://updates.example/r/", "--rollout-percent", "5", "--out", out, full], { encoding: "utf8" });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const written = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(written.rolloutPercent, 5);
  assert.equal(written.sequence, 3);
  assert.equal(written.updates[0].url, "https://updates.example/r/ota.zip");
  const second = run();
  assert.equal(second.status, 1);
  assert.match(second.stderr, /EEXIST/);
});
