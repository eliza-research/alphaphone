// A scripted stand-in for one Pixel 10a over adb and fastboot, for test/pixel10a-flash.test.mjs and
// test/pixel10a-drills.test.mjs. It models only what those scripts observe (transport state, getvar,
// getprop, two A/B slots and which one is active) and records every command. It is not a device,
// recovery, update_engine or bootloader, and says nothing about how real ones behave.
import fs from "node:fs";
import path from "node:path";

export const SERIAL = "67091JEA313850";
export const FP_OLD = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/41:user/release-keys";
export const FP_NEW = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/42:user/release-keys";
export const FP_STOCK = "google/stallion/stallion:17/CP3A.261005.005/14209000:user/release-keys";

export class FakePixel {
  constructor(options = {}) {
    Object.assign(this, {
      serial: SERIAL, state: "android", product: "stallion", unlocked: "yes", unlockAbility: "1",
      bootloader: "stallion-17.0-15819938", baseband: "g5400i-260604-260807-B-16035863",
      slots: { a: FP_OLD, b: FP_OLD }, active: "a", booted: "a", dateUtc: { [FP_OLD]: "1792800000", [FP_NEW]: "1792900000", [FP_STOCK]: "1792700000" },
      rootAllowed: true, flashStatus: 0, flashImages: {}, sideloadApplies: true, pendingOta: null,
      interruptNext: false, autoReboot: false, calls: [], clock: 0,
    }, options);
    this.run = this.run.bind(this);
  }
  ok(stdout = "", stderr = "") { return { status: 0, stdout, stderr, timedOut: false }; }
  fail(stderr = "error") { return { status: 1, stdout: "", stderr, timedOut: false }; }
  boot() { this.state = "android"; this.booted = this.active; }
  get fingerprint() { return this.slots[this.booted]; }
  get other() { return this.active === "a" ? "b" : "a"; }
  /** Stage the pending OTA on the inactive slot and make it active, as an A/B apply does. */
  stage() { this.slots[this.other] = this.pendingOta; this.active = this.other; }
  props() {
    const fp = this.fingerprint;
    return {
      "sys.boot_completed": "1", "ro.build.fingerprint": fp, "ro.build.date.utc": this.dateUtc[fp] ?? "1792800000", "ro.build.type": fp.includes(":userdebug/") ? "userdebug" : "user",
      "ro.build.tags": fp.split("/").at(-1), "ro.product.device": this.product, "ro.boot.slot_suffix": `_${this.booted}`, "ro.boot.flash.locked": this.unlocked === "yes" ? "0" : "1",
      "ro.boot.verifiedbootstate": this.unlocked === "yes" ? "orange" : "yellow", "ro.boot.vbmeta.digest": "ab".repeat(32),
    };
  }
  run(command, args, options = {}) {
    this.clock += 1000;
    const tool = path.basename(command);
    this.calls.push([tool, ...args].join(" "));
    if (tool === "fastboot" && args[0] === "devices") return this.ok(this.state === "bootloader" ? `${this.serial}\tfastboot\n` : "");
    if (args[0] !== "-s" || args[1] !== this.serial) return this.fail(`unknown device ${args[1]}`);
    const rest = args.slice(2);
    return tool === "adb" ? this.adb(rest, options) : this.fastboot(rest, options);
  }
  adb(args, options) {
    const [verb, ...rest] = args;
    if (verb === "get-state") return ["android", "sideload"].includes(this.state) ? this.ok(this.state === "android" ? "device\n" : "sideload\n") : this.fail("device not found");
    if (verb === "reboot") {
      const target = rest[0];
      if (target === "bootloader") this.state = "bootloader";
      else if (target === "sideload" || target === "sideload-auto-reboot") { this.state = "sideload"; this.autoReboot = target === "sideload-auto-reboot"; }
      else this.boot();
      return this.ok();
    }
    if (verb === "root") return this.rootAllowed ? this.ok("restarting adbd as root\n") : this.ok("adbd cannot run as root in production builds\n");
    if (verb === "push") return this.ok("1 file pushed\n");
    if (verb === "pull") { fs.writeFileSync(rest[1], "fake alpha apk bytes"); return this.ok("1 file pulled\n"); }
    if (verb === "sideload") {
      if (this.state !== "sideload") return this.fail("no sideload device");
      if (this.interruptNext) { this.interruptNext = false; this.state = "sideload"; return { status: null, stdout: "serving: 'ota.zip'  (~37%)    \r", stderr: "", timedOut: true }; }
      if (this.sideloadApplies) this.stage();
      if (this.autoReboot) this.boot();
      return this.ok("Total xfer: 1.00x\n");
    }
    if (verb === "shell") {
      const command = rest.join(" ");
      if (command === "getprop") return this.ok(Object.entries(this.props()).map(([key, value]) => `[${key}]: [${value}]`).join("\n") + "\n");
      if (command === "getprop sys.boot_completed") return this.state === "android" ? this.ok("1\n") : this.fail();
      if (command === "getenforce") return this.ok("Enforcing\n");
      if (command.startsWith("cmd role get-role-holders")) return this.ok("ai.elizaresearch.alphaphone\n");
      if (command.startsWith("dumpsys package")) return this.ok("  versionCode=11 minSdk=31 targetSdk=36\n  versionName=0.1.0-native-v11\n  codePath=/product/app/AlphaPhone\n");
      if (command.startsWith("pm path")) return this.ok("package:/product/app/AlphaPhone/AlphaPhone.apk\n");
      if (command.startsWith("update_engine_client")) {
        if (this.interruptNext) { this.interruptNext = false; return { status: null, stdout: "onStatusUpdate(UPDATE_STATUS_DOWNLOADING (3), 0.41)\n", stderr: "", timedOut: true }; }
        this.stage();
        return this.ok("onStatusUpdate(UPDATE_STATUS_DOWNLOADING (3), 0.5)\nonStatusUpdate(UPDATE_STATUS_UPDATED_NEED_REBOOT (6), 1)\nonPayloadApplicationComplete(ErrorCode::kSuccess (0))\n");
      }
      if (command.startsWith("kill -9")) return this.ok();
    }
    return this.fail(`fake adb does not model ${args.join(" ")}`);
  }
  fastboot(args) {
    if (this.state !== "bootloader") return this.fail("< waiting for device >");
    const wipe = args[0] === "-w";
    const rest = wipe ? args.slice(1) : args;
    const [verb, ...more] = rest;
    if (verb === "getvar") {
      const values = { product: this.product, unlocked: this.unlocked, "version-bootloader": this.bootloader, "version-baseband": this.baseband, "current-slot": this.active, "is-userspace": "no", serialno: this.serial };
      return Object.hasOwn(values, more[0]) ? this.ok("", `${more[0]}: ${values[more[0]]}\nFinished. Total time: 0.001s\n`) : this.fail(`getvar:${more[0]} FAILED`);
    }
    if (verb === "--skip-reboot" && more[0] === "update") {
      if (this.flashStatus !== 0) return this.fail("update failed");
      this.slots[this.active] = this.flashImages[more[1]] ?? FP_OLD;
      this.wiped = wipe;
      return this.ok();
    }
    if (verb === "reboot") { this.boot(); return this.ok(); }
    if (verb === "reboot-bootloader") return this.ok();
    if (verb?.startsWith("--set-active=")) { this.active = verb.slice("--set-active=".length); return this.ok(); }
    if (verb === "flash" || verb === "erase") return this.ok();
    if (verb === "flashing" && more[0] === "get_unlock_ability") return this.ok("", `(bootloader) get_unlock_ability: ${this.unlockAbility}\nOKAY\n`);
    if (verb === "flashing" && more[0] === "lock") { this.unlocked = "no"; return this.ok(); }
    return this.fail(`fake fastboot does not model ${args.join(" ")}`);
  }
  /** Dependencies for the scripts: this runner, a no-op sleep and a monotonic clock. */
  deps(extra = {}) { return { run: this.run, sleep: () => {}, now: () => 1_800_000_000_000 + this.clock++, say: () => {}, ...extra }; }
  /** Commands that change the device. */
  changes() { return this.calls.filter(call => !/ get-state$| getvar | shell getprop| shell getenforce| shell cmd role| shell dumpsys| shell pm path| pull |^fastboot devices$|get_unlock_ability/.test(call)); }
}
