// Pixel 10a signed-update, interrupted-update, compatible-rollback and stock-recovery drills and
// their channel record (issues #377, #400). adb and fastboot are a scripted fake
// (test/fixtures/fake-pixel.mjs), OTA and factory archives are small temporary files read through
// fake zip readers, and the channel is a temporary copy: these tests establish refusals, command
// construction, record contents and the evidence gate. They are not an applied OTA, an interrupted
// or rolled-back update, a stock flash or a passed drill, and the committed channel stays unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyToChannel, compatibleRollback, evidenceProblems, factoryMembers, inspectOta, interruptedUpdate, recordEvidence, REMOTE_PAYLOAD, signedUpdate, stockRecovery, updateEngineCommand } from "../scripts/pixel10a-drills.mjs";
import { channelDistributionProblems, channelSigningProblems } from "../scripts/sign-aosp-release.mjs";
import { RECORD_KIND } from "../scripts/aosp-release-record.mjs";
import { FakePixel, FP_NEW, FP_OLD, FP_STOCK, SERIAL } from "./fixtures/fake-pixel.mjs";

const root = path.resolve(import.meta.dirname, "..");
const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const HEADERS = "FILE_HASH=q83vEjRWeJA=\nFILE_SIZE=4096\nMETADATA_HASH=3q2+7w==\nMETADATA_SIZE=512\n";
const FACTORY_TOP = "stallion-cp3a.261005.005";

function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "alpha-drill-test-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** Fake zip contents keyed by archive path. */
function zips(archives) {
  return { list: zip => Object.keys(archives[zip] ?? {}), read: (zip, name) => Buffer.from(archives[zip][name]),
    extract: (zip, name, destination) => { fs.writeFileSync(destination, `${path.basename(zip)}:${name}`, { flag: "wx" }); return destination; } };
}
function ota(dir, metadata = {}, name = "ota.zip") {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `ota ${name}`);
  const fields = { "ota-type": "AB", "pre-device": "stallion", "post-build": FP_NEW, "post-timestamp": "1792900000", ...metadata };
  const members = { "META-INF/com/android/metadata": Object.entries(fields).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join("\n"), "payload.bin": "", "payload_properties.txt": HEADERS };
  return { file, sha: sha256(`ota ${name}`), members };
}
function knownGoodRecord(dir, fingerprint = FP_OLD) {
  const file = path.join(dir, "known-good-release-record.json");
  fs.writeFileSync(file, JSON.stringify({ schema: 1, kind: RECORD_KIND, build: { fingerprint }, artifacts: { ota: { file: "ota-41.zip", sha256: "4".repeat(64) } }, problems: [] }));
  return file;
}
function setup(t, fake = {}, metadata = {}) {
  const dir = temporary(t);
  const package_ = ota(dir, metadata);
  const pixel = new FakePixel({ pendingOta: FP_NEW, ...fake });
  return { dir, ota: package_, pixel, deps: pixel.deps(zips({ [package_.file]: package_.members })) };
}
const base = (s, extra = {}) => ({ serial: SERIAL, ota: s.ota.file, otaSha256: s.ota.sha, out: path.join(s.dir, "out"), ...extra });
/** A reviewed channel copy: hex signing identities and a stock image this test can hash. */
function reviewedChannel(dir, stockSha) {
  const channel = JSON.parse(fs.readFileSync(path.join(root, CHANNEL), "utf8"));
  Object.assign(channel, { otaCertificateSha256: "c".repeat(64), avbPublicKeySha256: "d".repeat(64) });
  channel.recovery.stockFactoryImage.sha256 = stockSha;
  const file = path.join(dir, "channel.json");
  fs.writeFileSync(file, JSON.stringify(channel, null, 2) + "\n");
  return { channel, file };
}

test("OTA packages that are not stallion A/B updates, or are downgrades, are refused by inspection", t => {
  const dir = temporary(t);
  for (const [metadata, pattern] of [[{ "ota-type": "BLOCK" }, /not AB/], [{ "pre-device": "komodo" }, /pre-device is "komodo"/], [{ "ota-downgrade": "yes" }, /downgradeAllowed false/], [{ "post-build": null }, /no post-build/]]) {
    const pkg = ota(dir, metadata, `ota-${Object.keys(metadata)[0]}.zip`);
    const { problems } = inspectOta(pkg.file, zips({ [pkg.file]: pkg.members }));
    assert.match(problems.join("\n"), pattern);
  }
});

test("update_engine_client gets the pushed payload, its size and newline-separated headers", () => {
  const command = updateEngineCommand({ sizeBytes: 4096, headers: HEADERS.trim().split("\n") });
  assert.equal(command, `update_engine_client --update --follow --payload=file://${REMOTE_PAYLOAD} --offset=0 --size=4096 '--headers=${HEADERS.trim()}'`);
  assert.throws(() => updateEngineCommand({ sizeBytes: 4096, headers: ["FILE_HASH=x'; reboot; '"] }), /refusing payload header/);
});

test("a signed update refuses a SHA mismatch, an unconfirmed wiping OTA, a wrong source build or a non-newer build without touching the device", async t => {
  const cases = [
    [{}, {}, s => base(s, { otaSha256: "0".repeat(64) }), /has SHA-256/],
    [{}, { "ota-wipe": "yes" }, s => base(s), /pass --confirm-destructive/],
    [{}, { "pre-build": FP_STOCK }, s => base(s), /incremental --ota applies to/],
    [{}, { "post-timestamp": "1792800000" }, s => base(s), /not newer .* downgrade/],
    [{ product: "cf_x86_64_phone" }, {}, s => base(s), /not stallion/],
    [{ state: "bootloader" }, {}, s => base(s), /not booted with adb/],
  ];
  for (const [fake, metadata, options, pattern] of cases) {
    const s = setup(t, fake, metadata);
    await assert.rejects(signedUpdate(options(s), s.deps), pattern);
    assert.deepEqual(s.pixel.changes(), [], `${pattern}: no device change`);
    assert.equal(fs.existsSync(path.join(s.dir, "out")), false);
  }
});

test("a sideloaded signed update records both slots and passes only when the new slot boots the post-build twice", async t => {
  const s = setup(t);
  const result = await signedUpdate(base(s), s.deps);
  assert.deepEqual(s.pixel.changes(), [`adb -s ${SERIAL} reboot sideload-auto-reboot`, `adb -s ${SERIAL} sideload ${s.ota.file}`, `adb -s ${SERIAL} reboot`]);
  assert.equal(result.executed, true);
  assert.equal(result.passed, true, result.problems.join("; "));
  assert.deepEqual([result.before.fingerprint, result.before.slot, result.after.fingerprint, result.after.slot, result.persisted.slot], [FP_OLD, "_a", FP_NEW, "_b", "_b"]);
  const written = JSON.parse(fs.readFileSync(path.join(s.dir, "out", "signedUpdate.json"), "utf8"));
  assert.equal(written.passed, true);
  assert.equal(written.ota.sha256, s.ota.sha);
  assert.equal(written.serial, SERIAL);

  const rejected = setup(t, { sideloadApplies: false });
  const failed = await signedUpdate(base(rejected), rejected.deps);
  assert.equal(failed.executed, true);
  assert.equal(failed.passed, false);
  assert.match(failed.problems.join("\n"), /not .*42:user\/release-keys|did not switch slots/);
});

test("update_engine needs adb root; on a user build the drill records the refusal", async t => {
  const s = setup(t, { rootAllowed: false });
  const result = await signedUpdate(base(s, { method: "update-engine" }), s.deps);
  assert.equal(result.passed, false);
  assert.match(result.problems.join("\n"), /needs adb root/);
});

test("an interrupted update_engine apply boots the old slot, then the reapplied update boots the new one", async t => {
  const s = setup(t, { interruptNext: true });
  const result = await interruptedUpdate(base(s, { method: "update-engine", interrupt: "kill", interruptAfterSeconds: 20 }), s.deps);
  assert.equal(result.passed, true, result.problems.join("; "));
  assert.deepEqual([result.interrupted.fingerprint, result.interrupted.slot, result.after.fingerprint, result.after.slot], [FP_OLD, "_a", FP_NEW, "_b"]);
  assert.equal(result.firstApply.timedOut, true);
  assert.equal(result.firstApply.progress, 0.41);
  const changes = s.pixel.changes();
  assert.equal(changes.filter(call => call.includes("update_engine_client --update")).length, 2);
  assert.ok(changes.includes(`adb -s ${SERIAL} shell kill -9 $(pidof update_engine)`));
  assert.ok(changes.includes(`adb -s ${SERIAL} push ${path.join(s.dir, "out", "payload.bin")} ${REMOTE_PAYLOAD}`));
  await assert.rejects(interruptedUpdate(base(setup(t), { interrupt: "kill" }), s.deps), /needs --method update-engine/);
});

test("an interruption that comes after the apply finished does not pass", async t => {
  const s = setup(t);
  const result = await interruptedUpdate(base(s, { method: "sideload", interruptAfterSeconds: 5 }), s.deps);
  assert.equal(result.passed, false);
  assert.match(result.problems.join("\n"), /finished before the interruption/);
});

test("compatible rollback stages the candidate, sets the known-good slot active before it boots, and stays there", async t => {
  const s = setup(t);
  const record = knownGoodRecord(s.dir);
  const result = await compatibleRollback(base(s, { knownGoodRecord: record }), s.deps);
  assert.equal(result.passed, true, result.problems.join("; "));
  assert.deepEqual(s.pixel.changes(), [`adb -s ${SERIAL} reboot sideload`, `adb -s ${SERIAL} sideload ${s.ota.file}`, `adb -s ${SERIAL} reboot bootloader`,
    `fastboot -s ${SERIAL} --set-active=a`, `fastboot -s ${SERIAL} reboot`, `adb -s ${SERIAL} reboot`]);
  assert.deepEqual(result.staged, { currentSlot: "b", revertedSlot: "a" });
  assert.deepEqual(result.knownGood, { buildFingerprint: FP_OLD, otaSha256: "4".repeat(64), recordFile: record });
  assert.match(result.mechanism, /pre-merge slot revert/);
  const elsewhere = setup(t);
  await assert.rejects(compatibleRollback(base(elsewhere, { knownGoodRecord: knownGoodRecord(elsewhere.dir, FP_STOCK) }), elsewhere.deps), /not the known-good/);
  assert.deepEqual(elsewhere.pixel.changes(), []);
});

function factory(dir, channelSha = null) {
  const file = path.join(dir, "stallion-cp3a.261005.005-factory-d1d25502.zip");
  fs.writeFileSync(file, "fake factory archive");
  const members = Object.fromEntries([`${FACTORY_TOP}/`, `${FACTORY_TOP}/bootloader-stallion-stallion-17.0-15819938.img`, `${FACTORY_TOP}/radio-stallion-g5400i-260604-260807-b-16035863.img`,
    `${FACTORY_TOP}/image-stallion-cp3a.261005.005.zip`, `${FACTORY_TOP}/flash-all.sh`].map(name => [name, ""]));
  return { file, sha: channelSha ?? sha256("fake factory archive"), members };
}
function stockSetup(t) {
  const dir = temporary(t);
  const archive = factory(dir);
  const alpha = path.join(dir, "alpha-img.zip");
  fs.writeFileSync(alpha, "alpha image");
  const { channel } = reviewedChannel(dir, archive.sha);
  const pixel = new FakePixel();
  pixel.flashImages[path.join(dir, "out", "stock", "image-stallion-cp3a.261005.005.zip")] = FP_STOCK;
  pixel.flashImages[alpha] = FP_OLD;
  const deps = pixel.deps(zips({ [archive.file]: archive.members, [alpha]: { "android-info.txt": "require board=stallion\nrequire version-bootloader=stallion-17.0-15819938\n" } }));
  const options = { serial: SERIAL, factoryZip: archive.file, alphaImageZip: alpha, alphaImageSha256: sha256("alpha image"), out: path.join(dir, "out"), confirmDestructive: true, channel };
  return { dir, pixel, deps, options, channel };
}

test("factory archives are split into exactly one bootloader, radio and image", () => {
  const parts = factoryMembers(Object.keys(factory(os.tmpdir()).members));
  assert.deepEqual([parts.buildId, parts.bootloaderVersion, parts.basebandVersion], ["CP3A.261005.005", "stallion-17.0-15819938", "g5400i-260604-260807-b-16035863"]);
  assert.throws(() => factoryMembers([`${FACTORY_TOP}/image-a.zip`, `${FACTORY_TOP}/image-b.zip`]), /exactly one/);
});

test("stock recovery needs --confirm-destructive and the channel's exact factory archive", async t => {
  const s = stockSetup(t);
  await assert.rejects(stockRecovery({ ...s.options, confirmDestructive: false }, s.deps), /--confirm-destructive/);
  await assert.rejects(stockRecovery({ ...s.options, channel: { recovery: { stockFactoryImage: { filename: "stallion-cp3a.261005.005-factory-d1d25502.zip", sha256: "9".repeat(64) } } } }, s.deps), /has SHA-256/);
  await assert.rejects(stockRecovery({ ...s.options, channel: { recovery: { stockFactoryImage: { filename: "other.zip", sha256: "9".repeat(64) } } } }, s.deps), /must be the channel's other.zip/);
  assert.deepEqual(s.pixel.changes(), []);
});

test("stock recovery flashes stock with -w (firmware only when it differs), checks the stock boot and reflashes Alpha", async t => {
  const s = stockSetup(t);
  const result = await stockRecovery(s.options, s.deps);
  assert.equal(result.passed, true, result.problems.join("; "));
  const stockImage = path.join(s.dir, "out", "stock", "image-stallion-cp3a.261005.005.zip");
  assert.deepEqual(s.pixel.changes(), [`adb -s ${SERIAL} reboot bootloader`, `fastboot -s ${SERIAL} -w --skip-reboot update ${stockImage}`, `fastboot -s ${SERIAL} reboot`,
    `adb -s ${SERIAL} reboot bootloader`, `fastboot -s ${SERIAL} -w --skip-reboot update ${s.options.alphaImageZip}`, `fastboot -s ${SERIAL} reboot`]);
  assert.deepEqual(result.firmwareFlashed, []);
  assert.deepEqual([result.before.fingerprint, result.stock.fingerprint, result.after.fingerprint], [FP_OLD, FP_STOCK, FP_OLD]);
  assert.equal(fs.existsSync(path.join(s.dir, "out", "stock")), false, "extracted factory images are removed");

  const old = stockSetup(t);
  old.pixel.bootloader = "stallion-16.0-1";
  const flashed = await stockRecovery(old.options, old.deps);
  assert.deepEqual(flashed.firmwareFlashed, ["bootloader"]);
  assert.ok(old.pixel.changes().some(call => /flash bootloader .*bootloader-stallion-stallion-17\.0-15819938\.img$/.test(call)));
});

/** All four drills run against fakes, written as results, then recorded into evidence. */
async function fullEvidence(t) {
  const results = [];
  const signed = setup(t);
  results.push(path.join(signed.dir, "out", "signedUpdate.json"));
  assert.equal((await signedUpdate(base(signed), signed.deps)).passed, true);
  const interrupted = setup(t, { interruptNext: true });
  results.push(path.join(interrupted.dir, "out", "interruptedUpdate.json"));
  assert.equal((await interruptedUpdate(base(interrupted, { method: "sideload" }), interrupted.deps)).passed, true);
  const rollback = setup(t);
  const record = knownGoodRecord(rollback.dir);
  results.push(path.join(rollback.dir, "out", "compatibleRollback.json"));
  assert.equal((await compatibleRollback(base(rollback, { knownGoodRecord: record }), rollback.deps)).passed, true);
  const stock = stockSetup(t);
  results.push(path.join(stock.dir, "out", "stockRecovery.json"));
  assert.equal((await stockRecovery(stock.options, stock.deps)).passed, true);
  const dir = temporary(t);
  const { channel, file } = reviewedChannel(dir, stock.channel.recovery.stockFactoryImage.sha256);
  return { results, channel, channelFile: file, dir };
}

test("partial, failed or unreviewed drill evidence is refused, and the channel file is left unchanged", async t => {
  const { results, channel, channelFile, dir } = await fullEvidence(t);
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
  const original = fs.readFileSync(channelFile);

  const partial = await recordEvidence({ results: results.slice(0, 3), channelFile, channel });
  assert.deepEqual(partial.missing, ["stockRecovery"]);
  await assert.rejects(applyToChannel({ evidenceFile: write("partial.json", partial), channelFile }), /stockRecovery: missing \(partial evidence\)/);

  const full = await recordEvidence({ results, channelFile, channel });
  const failed = structuredClone(full);
  Object.assign(failed.drills.interruptedUpdate, { passed: false, problems: ["the first apply finished before the interruption"] });
  await assert.rejects(applyToChannel({ evidenceFile: write("failed.json", failed), channelFile }), /interruptedUpdate: not passed/);

  const unexecuted = structuredClone(full);
  unexecuted.drills.signedUpdate.executed = false;
  delete unexecuted.drills.signedUpdate.after;
  assert.match(evidenceProblems(unexecuted, channel).join("\n"), /signedUpdate: not executed[\s\S]*signedUpdate: no after fingerprint and slot/);

  const otherDevice = structuredClone(full);
  otherDevice.drills.stockRecovery.serial = "OTHERSERIAL1";
  assert.match(evidenceProblems(otherDevice, channel).join("\n"), /different devices/);

  const testKeys = structuredClone(full);
  testKeys.drills.signedUpdate.after.fingerprint = FP_NEW.replace("user/release-keys", "userdebug/test-keys");
  assert.match(evidenceProblems(testKeys, channel).join("\n"), /not a user release-keys build/);

  const unreviewed = { ...channel, otaCertificateSha256: "UNSET", avbPublicKeySha256: "UNSET" };
  assert.match(evidenceProblems(full, unreviewed).join("\n"), /otaCertificateSha256 is unset[\s\S]*avbPublicKeySha256 is unset/);
  const committed = JSON.parse(fs.readFileSync(path.join(root, CHANNEL), "utf8"));
  assert.match(evidenceProblems(full, committed).join("\n"), /otaCertificateSha256 is unset|different otaCertificateSha256/, "fake-device evidence never applies to the committed channel");
  assert.deepEqual(fs.readFileSync(channelFile), original);
});

test("complete passing evidence sets the channel's drills and known-good release, and nothing else", async t => {
  const { results, channel, channelFile, dir } = await fullEvidence(t);
  const evidence = await recordEvidence({ results, channelFile, channel });
  assert.deepEqual(evidence.missing, []);
  assert.deepEqual(evidence.serials, [SERIAL]);
  assert.equal(evidence.drills.signedUpdate.resultSha256, sha256(fs.readFileSync(results[0])));
  const evidenceFile = path.join(dir, "evidence.json");
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
  assert.deepEqual(evidenceProblems(evidence, channel), []);
  assert.notDeepEqual(channelDistributionProblems(channel), []);
  const updated = await applyToChannel({ evidenceFile, channelFile, root: dir });
  assert.deepEqual(updated.drills, { signedUpdate: "passed", interruptedUpdate: "passed", compatibleRollback: "passed", stockRecovery: "passed" });
  assert.equal(updated.recovery.knownGoodRelease.buildFingerprint, FP_OLD);
  assert.equal(updated.recovery.knownGoodRelease.otaSha256, "4".repeat(64));
  assert.deepEqual(updated.drillEvidence, { file: "evidence.json", sha256: sha256(fs.readFileSync(evidenceFile)), serial: SERIAL });
  const written = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  assert.deepEqual(written, updated);
  assert.deepEqual(channelDistributionProblems(written, channelFile), []);
  const { drills, recovery, drillEvidence, ...rest } = written;
  const { drills: _drills, recovery: oldRecovery, ...before } = channel;
  assert.deepEqual(rest, before, "signing fields are untouched");
  assert.deepEqual(recovery.stockFactoryImage, oldRecovery.stockFactoryImage);
  assert.deepEqual(channelSigningProblems(written, { product: written.product, device: { codename: written.device }, avb: { publicKeySha256: written.avbPublicKeySha256 } }, channelFile), []);
});
