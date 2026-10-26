// Pixel 10a flashing, AVB custom key enrollment and bootloader locking (issues #377, #400).
// adb and fastboot are a scripted fake (test/fixtures/fake-pixel.mjs) and every image is a small
// temporary file: these tests establish refusals, the exact command lines and record contents.
// They are not a flash, a boot of any image, an enrolled key, a locked bootloader or device acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { enrollAvbKey, flashImage, lockBootloader, parseAndroidInfo, unconditionalWipes } from "../scripts/pixel10a-flash.mjs";
import { FakePixel, FP_OLD, SERIAL } from "./fixtures/fake-pixel.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const ANDROID_INFO = "require board=stallion\nrequire version-bootloader=stallion-17.0-15819938\nrequire version-baseband=g5400i-260604-260807-B-16035863\n";
const FASTBOOT_INFO = "version 1\nflash boot\nupdate-super\nif-wipe erase userdata\nif-wipe erase metadata\n";

function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "alpha-flash-test-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** A stand-in image zip: its bytes are hashed, and its listed members are served by fake zip readers. */
function image(dir, { androidInfo = ANDROID_INFO, fastbootInfo = FASTBOOT_INFO } = {}) {
  const file = path.join(dir, "alpha-stallion-img.zip");
  fs.writeFileSync(file, "fake image zip");
  const members = { "android-info.txt": androidInfo, "fastboot-info.txt": fastbootInfo, "boot.img": "", "system.img": "" };
  return { file, sha: sha256("fake image zip"), list: () => Object.keys(members), read: (_, name) => Buffer.from(members[name]) };
}
function setup(t, fake = {}, zip = {}) {
  const dir = temporary(t);
  const img = image(dir, zip);
  const pixel = new FakePixel(fake);
  const deps = pixel.deps({ list: img.list, read: img.read });
  return { dir, img, pixel, deps, out: path.join(dir, "flash") };
}

test("android-info requirements and unconditional wipes are parsed from the image zip", () => {
  assert.deepEqual(parseAndroidInfo(ANDROID_INFO + "require partition-exists=vendor_kernel_boot\n"), {
    board: ["stallion"], "version-bootloader": ["stallion-17.0-15819938"], "version-baseband": ["g5400i-260604-260807-B-16035863"], "partition-exists": ["vendor_kernel_boot"] });
  assert.deepEqual(unconditionalWipes(FASTBOOT_INFO), []);
  assert.deepEqual(unconditionalWipes("flash boot\nerase userdata\nif-wipe erase metadata\n"), ["erase userdata"]);
});

test("a SHA-256 mismatch is refused before any device command", async t => {
  const { img, pixel, deps, out } = setup(t);
  await assert.rejects(flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: "0".repeat(64), out }, deps), /has SHA-256 .* not 0{64}/);
  assert.deepEqual(pixel.calls, []);
  assert.equal(fs.existsSync(out), false);
});

test("network adb serials (Cuttlefish) and relative paths are refused", async t => {
  const { img, pixel, deps, out } = setup(t);
  await assert.rejects(flashImage({ serial: "127.0.0.1:6520", imageZip: img.file, imageSha256: img.sha, out }, deps), /network adb targets/);
  await assert.rejects(flashImage({ serial: SERIAL, imageZip: "alpha.zip", imageSha256: img.sha, out }, deps), /absolute path/);
  assert.deepEqual(pixel.calls, []);
});

test("a wrong product, a locked bootloader or mismatched firmware is refused before fastboot update", async t => {
  for (const [fake, pattern] of [[{ product: "komodo" }, /product is "komodo", not stallion/], [{ unlocked: "no" }, /not unlocked/], [{ bootloader: "stallion-16.0-1" }, /version-bootloader is "stallion-16.0-1"/]]) {
    const { img, pixel, deps, out } = setup(t, { state: "bootloader", ...fake });
    await assert.rejects(flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: img.sha, out }, deps), pattern);
    assert.ok(!pixel.calls.some(call => call.includes(" update ")), "fastboot update must not run");
    const record = JSON.parse(fs.readFileSync(path.join(out, "flash-result.json"), "utf8"));
    assert.equal(record.bootVerified, false);
    assert.equal(record.flashExitCode, null);
    assert.match(record.problems.join("\n"), pattern);
  }
});

test("an adb device that is not a stallion is refused before it is rebooted", async t => {
  const { img, pixel, deps, out } = setup(t, { product: "cf_x86_64_phone" });
  await assert.rejects(flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: img.sha, out }, deps), /not stallion/);
  assert.deepEqual(pixel.changes(), []);
});

test("an image that wipes unconditionally needs --wipe, which adds -w", async t => {
  const zip = { fastbootInfo: "version 1\nflash boot\nerase userdata\n" };
  const refused = setup(t, { state: "bootloader" }, zip);
  await assert.rejects(flashImage({ serial: SERIAL, imageZip: refused.img.file, imageSha256: refused.img.sha, out: refused.out }, refused.deps), /pass --wipe/);
  assert.deepEqual(refused.pixel.calls, []);
  const { img, pixel, deps, out } = setup(t, { state: "bootloader" }, zip);
  const record = await flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: img.sha, out, wipe: true }, deps);
  assert.ok(pixel.calls.includes(`fastboot -s ${SERIAL} -w --skip-reboot update ${img.file}`));
  assert.equal(record.wipe, true);
});

test("a flash from booted Android records the device, runs the exact commands and writes the post-boot record", async t => {
  const { img, pixel, deps, out } = setup(t);
  pixel.flashImages[img.file] = FP_OLD;
  const record = await flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: img.sha, out }, deps);
  assert.deepEqual(pixel.changes(), [`adb -s ${SERIAL} reboot bootloader`, `fastboot -s ${SERIAL} --skip-reboot update ${img.file}`, `fastboot -s ${SERIAL} reboot`]);
  assert.equal(pixel.wiped, false, "no -w without --wipe");
  assert.equal(record.bootVerified, true);
  assert.equal(record.flashExitCode, 0);
  assert.deepEqual(record.problems, []);
  assert.equal(record.before.fingerprint, FP_OLD);
  assert.equal(record.fastboot["version-bootloader"], "stallion-17.0-15819938");
  assert.equal(record.image.sha256, img.sha);
  const postboot = JSON.parse(fs.readFileSync(path.join(out, "postboot.json"), "utf8"));
  assert.equal(postboot.fingerprint, FP_OLD);
  assert.equal(postboot.properties["ro.boot.vbmeta.digest"], "ab".repeat(32));
  assert.equal(postboot.properties["ro.boot.verifiedbootstate"], "orange");
  assert.equal(postboot.selinux, "Enforcing");
  assert.deepEqual(postboot.homeRoleHolders, ["ai.elizaresearch.alphaphone"]);
  assert.equal(postboot.alpha.versionCode, 11);
  assert.equal(postboot.alpha.apkSha256, sha256("fake alpha apk bytes"));
  const result = JSON.parse(fs.readFileSync(path.join(out, "flash-result.json"), "utf8"));
  assert.equal(result.commands.length, pixel.calls.length);
  assert.ok(fs.existsSync(path.join(out, "flash-start.json")));
  await assert.rejects(flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: img.sha, out }, deps), /already exists/);
});

test("a failed fastboot update is recorded and not followed by a reboot", async t => {
  const { img, pixel, deps, out } = setup(t, { state: "bootloader", flashStatus: 1 });
  const record = await flashImage({ serial: SERIAL, imageZip: img.file, imageSha256: img.sha, out }, deps);
  assert.equal(record.flashExitCode, 1);
  assert.equal(record.bootVerified, false);
  assert.ok(!pixel.calls.includes(`fastboot -s ${SERIAL} reboot`));
});

test("AVB key enrollment checks the reviewed key digest and writes avb_custom_key", async t => {
  const dir = temporary(t);
  const key = path.join(dir, "avb_pkmd.bin");
  fs.writeFileSync(key, "public key metadata");
  const digest = sha256("public key metadata");
  const pixel = new FakePixel({ state: "bootloader" });
  await assert.rejects(enrollAvbKey({ serial: SERIAL, keyFile: key, keySha256: digest, out: path.join(dir, "a"), product: { avb: { publicKeySha256: "1".repeat(64) } } }, pixel.deps()), /not the product's reviewed/);
  await assert.rejects(enrollAvbKey({ serial: SERIAL, keyFile: key, keySha256: "2".repeat(64), out: path.join(dir, "b") }, pixel.deps()), /has SHA-256/);
  assert.deepEqual(pixel.calls, []);
  const record = await enrollAvbKey({ serial: SERIAL, keyFile: key, keySha256: digest, out: path.join(dir, "c"), product: { avb: { publicKeySha256: digest } } }, pixel.deps());
  assert.deepEqual(pixel.changes(), [`fastboot -s ${SERIAL} erase avb_custom_key`, `fastboot -s ${SERIAL} flash avb_custom_key ${key}`]);
  assert.equal(record.enrolled, true);
  assert.equal(record.reviewedProductKey, true);
});

test("locking needs --confirm-destructive, a booted user release-keys build and unlock ability", async t => {
  const dir = temporary(t);
  await assert.rejects(lockBootloader({ serial: SERIAL, out: path.join(dir, "a") }, new FakePixel().deps()), /--confirm-destructive/);
  const testKeys = new FakePixel({ slots: { a: FP_OLD.replace("user/release-keys", "userdebug/test-keys"), b: FP_OLD } });
  await assert.rejects(lockBootloader({ serial: SERIAL, out: path.join(dir, "b"), confirmDestructive: true }, testKeys.deps()), /not a user release-keys build/);
  assert.deepEqual(testKeys.changes(), []);
  const noAbility = new FakePixel({ unlockAbility: "0" });
  await assert.rejects(lockBootloader({ serial: SERIAL, out: path.join(dir, "c"), confirmDestructive: true }, noAbility.deps()), /get_unlock_ability is "0"/);
  assert.ok(!noAbility.calls.some(call => call.endsWith("flashing lock")));
  const pixel = new FakePixel();
  const record = await lockBootloader({ serial: SERIAL, out: path.join(dir, "d"), confirmDestructive: true }, pixel.deps());
  assert.ok(pixel.calls.includes(`fastboot -s ${SERIAL} flashing lock`));
  assert.equal(record.locked, true);
  assert.equal(record.postboot.properties["ro.boot.verifiedbootstate"], "yellow");
});
