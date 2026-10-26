/**
 * Flash a verified Alpha Pixel 10a (stallion) image zip and record the boot it produced (issues #377, #400).
 *
 *   node scripts/pixel10a-flash.mjs --serial SERIAL --image-zip /abs/alpha-stallion-img.zip \
 *     --image-sha256 HEX --out /abs/new-flash-dir [--fastboot PATH] [--adb PATH] [--wipe] [--apksigner PATH]
 *   node scripts/pixel10a-flash.mjs --serial SERIAL --enroll-avb-key /abs/avb_pkmd.bin --avb-key-sha256 HEX --out /abs/new-dir
 *   node scripts/pixel10a-flash.mjs --serial SERIAL --lock --confirm-destructive --out /abs/new-dir
 *
 * Image mode hashes the zip and refuses on a mismatch, reads its android-info.txt, then checks the
 * device over `fastboot getvar`: product stallion, unlocked, and the bootloader and baseband
 * versions the image requires. It refuses a zip whose fastboot-info.txt erases userdata or
 * metadata unconditionally unless --wipe is given, and passes -w only with --wipe. It runs
 * `fastboot -s SERIAL [-w] --skip-reboot update ZIP`, `fastboot reboot`, waits for
 * sys.boot_completed and writes postboot.json (fingerprint, vbmeta digest, verified boot state,
 * SELinux, HOME role holder, Alpha package version, APK hash and, with --apksigner, signer) and
 * flash-result.json into the new --out directory.
 *
 * --enroll-avb-key writes the release AVB public key metadata to avb_custom_key (`fastboot erase
 * avb_custom_key`, `fastboot flash avb_custom_key FILE`); --lock runs `fastboot flashing lock`,
 * which wipes the device and needs a person to confirm on the device. Neither runs without its
 * flag. Every adb and fastboot command goes through an injectable runner (tests use a fake one).
 * A flash record is evidence that this device booted this zip; it is not an applied OTA, a drill,
 * release qualification or device acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { entries, entry, fileSha256 } from "./aosp-release-record.mjs";

export const DEVICE = "stallion";
export const ALPHA_PACKAGE = "ai.elizaresearch.alphaphone";
export const HOME_ROLE = "android.app.role.HOME";
export const DEFAULT_ADB = "adb";
export const DEFAULT_FASTBOOT = "fastboot";
const HEX64 = /^[0-9a-f]{64}$/;
const SERIAL = /^[A-Za-z0-9._-]+$/;
const MINUTE = 60_000;
/** Properties every device record keeps. */
export const RECORDED_PROPERTIES = Object.freeze(["sys.boot_completed", "ro.build.fingerprint", "ro.build.date.utc", "ro.build.type", "ro.build.tags",
  "ro.build.version.incremental", "ro.build.version.security_patch", "ro.product.device", "ro.boot.slot_suffix", "ro.boot.flash.locked",
  "ro.boot.verifiedbootstate", "ro.boot.vbmeta.digest", "ro.boot.vbmeta.device_state"]);

/** The default runner: one synchronous process, never a shell. A timeout kills the local client and is reported, not thrown. */
export function systemRunner(command, args, { timeoutMs = 2 * MINUTE, encoding = "utf8" } = {}) {
  const out = spawnSync(command, args, { encoding, timeout: timeoutMs, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const timedOut = out.error?.code === "ETIMEDOUT";
  if (out.error && !timedOut) return { status: null, stdout: "", stderr: String(out.error.message), timedOut: false };
  return { status: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "", timedOut };
}

const realSleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * One physical device addressed by serial, over adb and fastboot. Every command is logged in
 * `log` (command, args, exit status, timing) so records show exactly what ran.
 */
export class Device {
  constructor(serial, { adb = DEFAULT_ADB, fastboot = DEFAULT_FASTBOOT, run = systemRunner, sleep = realSleep, now = Date.now, say = message => console.error(message) } = {}) {
    if (!SERIAL.test(serial ?? "")) throw new Error("--serial must be a USB device serial (letters, digits, . _ -); network adb targets such as 127.0.0.1:6520 are refused");
    Object.assign(this, { serial, adbPath: adb, fastbootPath: fastboot, run, sleep, now, say, log: [] });
  }
  exec(tool, args, options = {}) {
    const started = this.now();
    const result = this.run(tool, args, options);
    this.log.push({ command: [path.basename(tool), ...args].join(" "), status: result.status, timedOut: result.timedOut === true, startedAt: new Date(started).toISOString(), ms: this.now() - started });
    return result;
  }
  adb(args, options) { return this.exec(this.adbPath, ["-s", this.serial, ...args], options); }
  fastboot(args, options) { return this.exec(this.fastbootPath, ["-s", this.serial, ...args], options); }
  /** Run and require exit 0. */
  must(result, what) {
    if (result.status !== 0) throw new Error(`${what} failed (exit ${result.timedOut ? "timeout" : result.status}): ${String(result.stderr || result.stdout).trim().slice(0, 400)}`);
    return result;
  }
  shell(command, options) { return this.must(this.adb(["shell", command], options), `adb shell ${command}`).stdout; }
  /** adb transport state (device, recovery, sideload, unauthorized) or null when absent. */
  adbState() {
    const out = this.adb(["get-state"], { timeoutMs: 10_000 });
    return out.status === 0 ? String(out.stdout).trim() : null;
  }
  inFastboot() {
    const out = this.exec(this.fastbootPath, ["devices"], { timeoutMs: 10_000 });
    return out.status === 0 && String(out.stdout).split(/\r?\n/).some(line => line.split(/\s+/)[0] === this.serial);
  }
  getvar(name) {
    const out = this.fastboot(["getvar", name], { timeoutMs: 20_000 });
    const text = `${out.stdout}\n${out.stderr}`;
    const line = text.split(/\r?\n/).map(value => value.trim()).find(value => value.startsWith(`${name}:`));
    return out.status === 0 && line ? line.slice(name.length + 1).trim() : null;
  }
  waitFor(what, test, timeoutMs, everyMs = 2000) {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      if (test()) return;
      if (this.now() >= deadline) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}`);
      this.sleep(everyMs);
    }
  }
  waitForFastboot(timeoutMs = 3 * MINUTE) { this.waitFor(`${this.serial} in fastboot`, () => this.inFastboot(), timeoutMs); }
  waitForAdbState(states, timeoutMs = 5 * MINUTE) { this.waitFor(`${this.serial} in adb state ${states.join("/")}`, () => states.includes(this.adbState()), timeoutMs); }
  waitForBoot(timeoutMs = 15 * MINUTE) {
    this.waitFor(`${this.serial} sys.boot_completed=1`, () => this.adbState() === "device" && String(this.adb(["shell", "getprop", "sys.boot_completed"], { timeoutMs: 15_000 }).stdout).trim() === "1", timeoutMs, 5000);
  }
  /** All properties from one `getprop`. */
  properties() {
    const props = {};
    for (const match of String(this.shell("getprop")).matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]$/gm)) props[match[1]] = match[2];
    return props;
  }
  /** The recorded subset plus slot, for a booted device. */
  snapshot() {
    const all = this.properties();
    const properties = Object.fromEntries(RECORDED_PROPERTIES.map(name => [name, all[name] ?? null]));
    return { observedAt: new Date(this.now()).toISOString(), fingerprint: properties["ro.build.fingerprint"], slot: properties["ro.boot.slot_suffix"], properties };
  }
}

/** `require key=value` lines of a Pixel image zip's android-info.txt. */
export function parseAndroidInfo(text) {
  const requires = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*require\s+([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (match) requires[match[1]] = match[2].split("|").map(value => value.trim());
  }
  return requires;
}

/** fastboot-info.txt lines that erase or wipe data without being conditional on -w. */
export function unconditionalWipes(text) {
  return String(text).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#") && !line.startsWith("if-wipe") && /^(erase|format)\s+(userdata|metadata)\b|(^|\s)-w(\s|$)/.test(line));
}

/** Image zip identity and flash requirements (read with unzip; no device contact). */
export function inspectImageZip(zip, { list = entries, read = entry } = {}) {
  const names = list(zip);
  if (!names.includes("android-info.txt")) return { problems: ["--image-zip has no android-info.txt; it is not a fastboot update zip"] };
  const requires = parseAndroidInfo(read(zip, "android-info.txt").toString("utf8"));
  const fastbootInfo = names.includes("fastboot-info.txt") ? read(zip, "fastboot-info.txt").toString("utf8") : "";
  const problems = [];
  const boards = requires.board ?? requires.product ?? [];
  if (!boards.includes(DEVICE)) problems.push(`--image-zip android-info.txt requires board ${boards.join("|") || "(none)"}, not ${DEVICE}`);
  return { problems, requires, wipes: unconditionalWipes(fastbootInfo), images: names.filter(name => name.endsWith(".img")).sort() };
}

/** Bootloader-side prerequisites; every value is recorded whether or not it passes. */
export function fastbootChecks(device, requires = {}) {
  const vars = Object.fromEntries(["product", "unlocked", "version-bootloader", "version-baseband", "current-slot", "is-userspace", "serialno"].map(name => [name, device.getvar(name)]));
  const problems = [];
  if (vars.product !== DEVICE) problems.push(`fastboot product is ${JSON.stringify(vars.product)}, not ${DEVICE}`);
  if (vars.unlocked !== "yes") problems.push(`the bootloader is not unlocked (unlocked: ${JSON.stringify(vars.unlocked)}); unlocking needs OEM unlocking in Settings and a person to confirm on the device, and wipes it`);
  if (vars["is-userspace"] === "yes") problems.push("the device is in fastbootd; reboot to the bootloader first");
  for (const [key, variable] of [["version-bootloader", "version-bootloader"], ["version-baseband", "version-baseband"]]) {
    const wanted = requires[key];
    if (wanted && !wanted.some(value => value.toLowerCase() === String(vars[variable]).toLowerCase()))
      problems.push(`${variable} is ${JSON.stringify(vars[variable])}, but the image requires ${wanted.join("|")} (flash the matching factory bootloader/radio first)`);
  }
  return { vars, problems };
}

/** Get the device into the bootloader, recording the booted build first when Android is up. */
export function enterBootloader(device) {
  if (device.inFastboot()) return null;
  const state = device.adbState();
  if (state === "device") {
    const before = device.snapshot();
    if (before.properties["ro.product.device"] !== DEVICE) throw new Error(`adb device ${device.serial} is ${JSON.stringify(before.properties["ro.product.device"])}, not ${DEVICE}`);
    device.must(device.adb(["reboot", "bootloader"]), "adb reboot bootloader");
    device.waitForFastboot();
    return before;
  }
  if (state === "recovery" || state === "sideload") {
    device.must(device.adb(["reboot", "bootloader"]), "adb reboot bootloader");
    device.waitForFastboot();
    return null;
  }
  throw new Error(`device ${device.serial} is in neither fastboot nor adb (adb state ${JSON.stringify(state)})`);
}

/** Post-boot record: build identity, verified boot, SELinux, HOME and the Alpha package. Reads only; `adb pull` copies the APK into outDir. */
export async function postBootRecord(device, { outDir, apksigner = null, run = device.run } = {}) {
  const snap = device.snapshot();
  const selinux = String(device.shell("getenforce")).trim();
  const home = String(device.adb(["shell", "cmd", "role", "get-role-holders", HOME_ROLE]).stdout).trim().split(/\s+/).filter(Boolean);
  const dump = String(device.adb(["shell", "dumpsys", "package", ALPHA_PACKAGE]).stdout);
  const paths = String(device.adb(["shell", "pm", "path", ALPHA_PACKAGE]).stdout).split(/\r?\n/).map(line => line.replace(/^package:/, "").trim()).filter(Boolean);
  const base = paths.find(file => file.endsWith("/base.apk")) ?? paths[0] ?? null;
  const alpha = { package: ALPHA_PACKAGE, installed: Boolean(base), versionCode: Number(/versionCode=(\d+)/.exec(dump)?.[1] ?? NaN) || null,
    versionName: /versionName=(\S+)/.exec(dump)?.[1] ?? null, codePath: /codePath=(\S+)/.exec(dump)?.[1] ?? null, apkPath: base, apkSha256: null, signerSha256: null };
  if (base && outDir) {
    const local = path.join(outDir, "alpha-base.apk");
    device.must(device.adb(["pull", base, local], { timeoutMs: 10 * MINUTE }), `adb pull ${base}`);
    alpha.apkSha256 = await fileSha256(local);
    if (apksigner) {
      const out = run(apksigner, ["verify", "--print-certs", local], { timeoutMs: 2 * MINUTE });
      alpha.signerSha256 = out.status === 0 ? [...String(out.stdout).matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/g)].map(match => match[1].toLowerCase()) : null;
    }
  }
  return { ...snap, selinux, homeRoleHolders: home, alpha };
}

export function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

/** A new output directory whose parent exists; never reuses one. */
export function newDirectory(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error("--out must be an absolute path to a new directory");
  if (fs.existsSync(dir)) throw new Error(`--out ${dir} already exists; records are never overwritten`);
  fs.mkdirSync(dir);
  return dir;
}

/** A regular, non-linked input file. */
export function regularFile(file, flag) {
  if (!file || !path.isAbsolute(file)) throw new Error(`${flag} must be an absolute path`);
  let stat;
  try { stat = fs.lstatSync(file); } catch { throw new Error(`${flag} ${file} does not exist`); }
  if (!stat.isFile()) throw new Error(`${flag} ${file} must be a regular file, not a link or directory`);
  return file;
}

/** Hash a file and refuse unless it is the expected SHA-256. */
export async function verifiedSha256(file, expected, flag) {
  if (!HEX64.test(expected ?? "")) throw new Error(`${flag}-sha256 must be a lowercase SHA-256`);
  const actual = await fileSha256(regularFile(file, flag));
  if (actual !== expected) throw new Error(`${flag} ${file} has SHA-256 ${actual}, not ${expected}`);
  return actual;
}

export function parseArgs(args, { values: valueFlags, booleans }) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (booleans.includes(flag)) { out[flag] = true; continue; }
    if (!valueFlags.includes(flag) || args[i + 1] === undefined || args[i + 1].startsWith("--") || Object.hasOwn(out, flag)) throw new Error(`unexpected or repeated argument ${flag}`);
    out[flag] = args[++i];
  }
  return out;
}

const FLASH_VALUES = ["--serial", "--image-zip", "--image-sha256", "--fastboot", "--adb", "--out", "--apksigner", "--enroll-avb-key", "--avb-key-sha256", "--product"];
const FLASH_BOOLEANS = ["--wipe", "--lock", "--confirm-destructive"];

/** Flash an image zip. `deps` supplies the device runner, sleep and clock (tests) and zip readers. */
export async function flashImage(options, deps = {}) {
  const { serial, imageZip, imageSha256, wipe = false, out, apksigner = null } = options;
  const device = new Device(serial, { adb: options.adb, fastboot: options.fastboot, ...deps });
  const archiveSha256 = await verifiedSha256(imageZip, imageSha256, "--image-zip");
  const image = inspectImageZip(imageZip, deps);
  if (image.problems.length) throw new Error(image.problems.join("; "));
  if (image.wipes.length && !wipe) throw new Error(`--image-zip fastboot-info.txt wipes data (${image.wipes.join(", ")}); pass --wipe to accept that`);
  newDirectory(out);
  const before = enterBootloader(device);
  const checks = fastbootChecks(device, image.requires);
  const record = { schema: 1, kind: "alpha-pixel10a-flash", serial, startedAt: new Date(device.now()).toISOString(), image: { file: path.basename(imageZip), sha256: archiveSha256, requires: image.requires, images: image.images },
    wipe, before, fastboot: checks.vars, problems: checks.problems, flashExitCode: null, bootVerified: false, postboot: null, commands: device.log };
  if (checks.problems.length) {
    record.finishedAt = new Date(device.now()).toISOString();
    writeJson(path.join(out, "flash-result.json"), record);
    throw new Error(`refused before flashing: ${checks.problems.join("; ")}`);
  }
  writeJson(path.join(out, "flash-start.json"), { ...record, commands: undefined });
  const flash = device.fastboot([...(wipe ? ["-w"] : []), "--skip-reboot", "update", imageZip], { timeoutMs: 60 * MINUTE });
  record.flashExitCode = flash.timedOut ? "timeout" : flash.status;
  if (flash.status === 0) {
    try {
      device.must(device.fastboot(["reboot"]), "fastboot reboot");
      device.waitForBoot();
      record.postboot = await postBootRecord(device, { outDir: out, apksigner });
      record.bootVerified = record.postboot.properties["sys.boot_completed"] === "1" && record.postboot.properties["ro.product.device"] === DEVICE;
      writeJson(path.join(out, "postboot.json"), record.postboot);
    } catch (error) { record.problems.push(String(error.message)); }
  } else record.problems.push(`fastboot update exited ${record.flashExitCode}`);
  record.finishedAt = new Date(device.now()).toISOString();
  writeJson(path.join(out, "flash-result.json"), record);
  return record;
}

/** Enroll the release AVB public key metadata so a locked bootloader verifies the Alpha image (yellow state). */
export async function enrollAvbKey(options, deps = {}) {
  const { serial, keyFile, keySha256, out, product = null } = options;
  const device = new Device(serial, { adb: options.adb, fastboot: options.fastboot, ...deps });
  const reviewed = product?.avb?.publicKeySha256;
  if (HEX64.test(reviewed ?? "") && reviewed !== keySha256) throw new Error(`--avb-key-sha256 is not the product's reviewed avb.publicKeySha256 ${reviewed}`);
  const sha = await verifiedSha256(keyFile, keySha256, "--enroll-avb-key");
  if (fs.statSync(keyFile).size > 64 << 10) throw new Error("--enroll-avb-key is larger than avb_pkmd.bin public key metadata can be");
  newDirectory(out);
  const before = enterBootloader(device);
  const checks = fastbootChecks(device);
  const record = { schema: 1, kind: "alpha-pixel10a-avb-key-enrollment", serial, avbPublicKeySha256: sha, reviewedProductKey: HEX64.test(reviewed ?? ""), before, fastboot: checks.vars, problems: checks.problems, enrolled: false, commands: device.log };
  if (!checks.problems.length) {
    device.must(device.fastboot(["erase", "avb_custom_key"]), "fastboot erase avb_custom_key");
    device.must(device.fastboot(["flash", "avb_custom_key", keyFile]), "fastboot flash avb_custom_key");
    record.enrolled = true;
  }
  writeJson(path.join(out, "avb-key-result.json"), record);
  if (checks.problems.length) throw new Error(`refused: ${checks.problems.join("; ")}`);
  return record;
}

/**
 * Lock the bootloader. Refuses unless Android is booted on a user release-keys build (so the
 * enrolled key is the one that signed it) and unlock ability stays 1 (so the device can be
 * unlocked again). A person confirms the lock on the device; locking wipes it.
 */
export async function lockBootloader(options, deps = {}) {
  const { serial, out, confirmDestructive } = options;
  if (!confirmDestructive) throw new Error("--lock wipes the device; pass --confirm-destructive");
  const device = new Device(serial, { adb: options.adb, fastboot: options.fastboot, ...deps });
  if (device.adbState() !== "device") throw new Error("--lock starts from booted Android so the running build can be checked; boot the release image first");
  const before = device.snapshot();
  const problems = [];
  if (before.properties["ro.product.device"] !== DEVICE) problems.push(`device is ${JSON.stringify(before.properties["ro.product.device"])}, not ${DEVICE}`);
  if (!/:user\/release-keys$/.test(before.fingerprint ?? "")) problems.push(`the running build ${JSON.stringify(before.fingerprint)} is not a user release-keys build; locking it would not boot`);
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  newDirectory(out);
  device.must(device.adb(["reboot", "bootloader"]), "adb reboot bootloader");
  device.waitForFastboot();
  const checks = fastbootChecks(device);
  const ability = device.fastboot(["flashing", "get_unlock_ability"]);
  const unlockAbility = /get_unlock_ability:\s*(\d)/.exec(`${ability.stdout}\n${ability.stderr}`)?.[1] ?? null;
  if (unlockAbility !== "1") checks.problems.push(`get_unlock_ability is ${JSON.stringify(unlockAbility)}, not 1; a locked device could not be unlocked again`);
  const record = { schema: 1, kind: "alpha-pixel10a-bootloader-lock", serial, before, fastboot: checks.vars, unlockAbility, problems: checks.problems, locked: false, postboot: null, commands: device.log };
  if (!checks.problems.length) {
    device.say("Confirm the lock on the device with the volume and power keys.");
    device.must(device.fastboot(["flashing", "lock"], { timeoutMs: 5 * MINUTE }), "fastboot flashing lock");
    record.locked = device.getvar("unlocked") === "no";
    device.must(device.fastboot(["reboot"]), "fastboot reboot");
    device.say("The device was wiped. Complete setup and enable USB debugging so the post-lock boot can be recorded.");
    try {
      device.waitForBoot(60 * MINUTE);
      record.postboot = device.snapshot();
      if (record.postboot.properties["ro.boot.verifiedbootstate"] !== "yellow") record.problems.push(`verified boot state after lock is ${JSON.stringify(record.postboot.properties["ro.boot.verifiedbootstate"])}, not yellow (custom key)`);
    } catch (error) { record.problems.push(String(error.message)); }
  }
  writeJson(path.join(out, "lock-result.json"), record);
  if (record.problems.length) throw new Error(`lock incomplete: ${record.problems.join("; ")}`);
  return record;
}

async function main(args) {
  const values = parseArgs(args, { values: FLASH_VALUES, booleans: FLASH_BOOLEANS });
  const common = { serial: values["--serial"], adb: values["--adb"], fastboot: values["--fastboot"], out: values["--out"] };
  const modes = [values["--image-zip"] && "image", values["--enroll-avb-key"] && "enroll", values["--lock"] && "lock"].filter(Boolean);
  if (modes.length !== 1) throw new Error("Use exactly one of --image-zip ZIP --image-sha256 HEX [--wipe], --enroll-avb-key FILE --avb-key-sha256 HEX, or --lock --confirm-destructive; all need --serial S --out NEW_DIR");
  let record;
  if (modes[0] === "image") record = await flashImage({ ...common, imageZip: values["--image-zip"], imageSha256: values["--image-sha256"], wipe: values["--wipe"] === true, apksigner: values["--apksigner"] });
  else if (modes[0] === "enroll") record = await enrollAvbKey({ ...common, keyFile: values["--enroll-avb-key"], keySha256: values["--avb-key-sha256"],
    product: JSON.parse(fs.readFileSync(values["--product"] ?? "android/aosp/pixel10a-product.json", "utf8")) });
  else record = await lockBootloader({ ...common, confirmDestructive: values["--confirm-destructive"] === true });
  console.log(JSON.stringify({ ...record, commands: undefined }, null, 2));
  if (record.problems?.length || record.bootVerified === false) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`pixel10a-flash: ${error.message}`); process.exitCode = 2; }
}
