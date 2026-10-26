// Device-target instrumentation and the per-view screenshot gate on a scripted (fake) adb.
// Host test only (class S): no emulator, Cuttlefish or phone is involved, and nothing here is
// evidence of class E, I or D.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { admitDeviceTarget, PACKAGE, parseInstrumentationArgs, runLeased } from "../scripts/android-instrumentation.mjs";
import { EVIDENCE_BY_TARGET, writeInstrumentationRecord } from "../scripts/instrumentation-result.mjs";
import { blankness, compareImages, crashEntries, decodePng, DEVICE_VIEWS, encodePng, parseCaptureArgs, parseUiDump, runCapture, viewMarker, windowState } from "../scripts/device-view-capture.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const CF = { "sys.boot_completed": "1", "ro.kernel.qemu": "", "ro.boot.qemu": "", "ro.product.name": "alpha_cf_x86_64_phone", "ro.product.device": "vsoc_x86_64_only",
  "ro.product.model": "Alpha Phone Cuttlefish", "ro.hardware": "cutf_cvm", "ro.build.fingerprint": "Alpha/alpha_cf_x86_64_phone/vsoc_x86_64_only:Baklava/CP2A/eng:userdebug/test-keys",
  "ro.build.type": "userdebug", "ro.build.version.sdk": "37", "ro.product.cpu.abi": "x86_64", "ro.serialno": "CUTTLEFISHCVD011" };
const PIXEL = { ...CF, "ro.product.name": "stallion", "ro.product.device": "stallion", "ro.product.model": "Pixel 10a", "ro.hardware": "stallion",
  "ro.build.fingerprint": "google/stallion/stallion:17/CP3A.261005.005/1:user/release-keys", "ro.build.type": "user", "ro.product.cpu.abi": "arm64-v8a", "ro.serialno": "4B021JEBF00123" };
const getprop = props => args => args[0] === "shell" && args[1] === "getprop" ? `${props[args[2]] ?? ""}\n` : null;

// ------------------------------------------------------------------ instrumentation device target

test("device-target options: explicit serial per target, --allow-reinstall, and no emulator-only classes or mocks", () => {
  const base = ["--classes", "Shell"];
  const ok = parseInstrumentationArgs(["--device-target", "cuttlefish", "--serial", "127.0.0.1:6520", "--allow-reinstall", ...base]);
  assert.equal(ok.deviceTarget, "cuttlefish");
  assert.equal(parseInstrumentationArgs(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", ...base]).deviceTarget, "pixel");
  const refuse = (argv, pattern) => assert.throws(() => parseInstrumentationArgs([...argv, ...(argv.includes("--classes") ? [] : base)]), pattern, argv.join(" "));
  refuse(["--device-target", "emulator", "--serial", "emulator-5554", "--allow-reinstall"], /cuttlefish or pixel/);
  refuse(["--device-target", "cuttlefish", "--allow-reinstall"], /explicit --serial/);
  refuse(["--device-target", "cuttlefish", "--serial", "4B021JEBF00123", "--allow-reinstall"], /loopback/);
  refuse(["--device-target", "cuttlefish", "--serial", "192.168.1.5:5555", "--allow-reinstall"], /loopback/);
  refuse(["--device-target", "pixel", "--serial", "127.0.0.1:6520", "--allow-reinstall"], /USB serial/);
  refuse(["--device-target", "pixel", "--serial", "emulator-5554", "--allow-reinstall"], /USB serial/);
  refuse(["--device-target", "pixel", "--serial", "4B021JEBF00123"], /--allow-reinstall/);
  refuse(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--owned-emulator"], /never an emulator/);
  refuse(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--avd", "x"], /never an emulator/);
  refuse(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--test-mocks"], /not device evidence/);
  refuse(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--clock-exclusive"], /alarms/);
  for (const cls of ["CalendarSyncProvider", "PasswordVaultSettings", "PasswordVaultFill"])
    refuse(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--classes", cls], /owned disposable emulator|requires --owned-emulator/);
  refuse(["--allow-reinstall", "--owned-emulator", "--avd", "a"], /only to --device-target/);
  // The emulator path is unchanged: HOME role still needs --owned-emulator there.
  refuse(["--home-role", "--classes", "LauncherHome"], /--owned-emulator/);
  assert.equal(parseInstrumentationArgs(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--home-role", "--classes", "Shell,LauncherHome"]).homeRole, true);
});

test("device-target admission checks the Alpha Cuttlefish product or a Pixel 10a by its own serial, never an emulator", () => {
  const adb = props => args => getprop(props)(args) ?? "";
  assert.equal(admitDeviceTarget(adb(CF), "cuttlefish", "127.0.0.1:6520").product, "alpha_cf_x86_64_phone");
  assert.equal(admitDeviceTarget(adb(PIXEL), "pixel", "4B021JEBF00123").device, "stallion");
  assert.throws(() => admitDeviceTarget(adb({ ...CF, "ro.product.name": "aosp_cf_x86_64_phone" }), "cuttlefish", "127.0.0.1:6520"), /not the Alpha Cuttlefish product/);
  assert.throws(() => admitDeviceTarget(adb({ ...CF, "ro.hardware": "ranchu" }), "cuttlefish", "127.0.0.1:6520"), /not the Alpha Cuttlefish product/);
  assert.throws(() => admitDeviceTarget(adb({ ...CF, "ro.kernel.qemu": "1" }), "cuttlefish", "127.0.0.1:6520"), /is an emulator/);
  assert.throws(() => admitDeviceTarget(adb({ ...CF, "sys.boot_completed": "" }), "cuttlefish", "127.0.0.1:6520"), /finished booting/);
  assert.throws(() => admitDeviceTarget(adb(CF), "cuttlefish", "4B021JEBF00123"), /loopback/);
  assert.throws(() => admitDeviceTarget(adb(PIXEL), "pixel", "OTHER0SERIAL"), /ro\.serialno/);
  assert.throws(() => admitDeviceTarget(adb({ ...PIXEL, "ro.product.device": "tegu" }), "pixel", "4B021JEBF00123"), /not a Pixel 10a/);
  assert.throws(() => admitDeviceTarget(adb(CF), "pixel", "127.0.0.1:6520"), /USB serial/);
});

test("records take their evidence class from where they ran; a caller cannot relabel an emulator run", () => {
  const dir = tmp("alpha-evidence-");
  try {
    const apks = [{ variant: "standalone", role: "app", sha256: "a".repeat(64) }];
    const classes = [{ variant: "standalone", class: `${PACKAGE}.ShellInstrumentedTest`, status: "passed" }];
    const base = { commit: "c".repeat(40), apks, classes };
    assert.equal(writeInstrumentationRecord(path.join(dir, "e.json"), { ...base, emulator: {}, evidenceClass: "D", evidence: "physical-device-instrumentation" }).evidenceClass, "E");
    const cf = writeInstrumentationRecord(path.join(dir, "i.json"), { ...base, deviceTarget: "cuttlefish", device: { target: "cuttlefish", fingerprint: "f" } });
    assert.deepEqual([cf.evidenceClass, cf.evidence], ["I", "cuttlefish-image-instrumentation"]);
    assert.ok(cf.notEvidenceFor.includes("physical-device acceptance") && cf.notEvidenceFor.includes("emulator instrumentation"));
    const d = writeInstrumentationRecord(path.join(dir, "d.json"), { ...base, deviceTarget: "pixel", device: { target: "pixel", fingerprint: "f" }, evidenceClass: "E" });
    assert.deepEqual([d.evidenceClass, d.evidence], ["D", "physical-device-instrumentation"]);
    assert.ok(d.notEvidenceFor.includes("AOSP image boot"));
    assert.throws(() => writeInstrumentationRecord(path.join(dir, "x1.json"), { ...base, deviceTarget: "pixel" }), /device identity/);
    assert.throws(() => writeInstrumentationRecord(path.join(dir, "x2.json"), { ...base, deviceTarget: "pixel", device: { target: "cuttlefish", fingerprint: "f" } }), /device identity/);
    assert.throws(() => writeInstrumentationRecord(path.join(dir, "x3.json"), { ...base, deviceTarget: "pixel", device: { target: "pixel", fingerprint: "f" }, emulator: {} }), /no emulator identity/);
    assert.throws(() => writeInstrumentationRecord(path.join(dir, "x4.json"), { ...base, device: { target: "pixel", fingerprint: "f" } }), /emulator record/);
    assert.throws(() => writeInstrumentationRecord(path.join(dir, "x5.json"), { ...base, deviceTarget: "emulator" }), /Unknown device target/);
    assert.deepEqual(Object.keys(EVIDENCE_BY_TARGET), ["emulator", "cuttlefish", "pixel"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A scripted device target for the instrumentation runner. */
function fakeTarget(props, { preinstalled = [], stock = "com.android.launcher3" } = {}) {
  const state = { installed: new Map(preinstalled.map(name => [name, "old"])), holder: stock, activity: `${stock}/.Launcher`, commands: [] };
  const adb = args => {
    const text = args.join(" ");
    state.commands.push(text);
    const prop = getprop(props)(args);
    if (prop !== null) return prop;
    if (text.includes("pm list packages")) return [...state.installed.keys()].map(name => `package:${name}`).join("\n");
    if (args[0] === "install") { const file = args.at(-1); state.installed.set(file.includes("androidTest") ? `${PACKAGE}.test` : PACKAGE, sha(fs.readFileSync(file))); return "Success\n"; }
    if (text.includes("pm path")) return `package:/data/app/${args.at(-1)}.apk\n`;
    if (text.includes("sha256sum")) return `${state.installed.get(path.basename(args.at(-1), ".apk"))}  ${args.at(-1)}\n`;
    if (args[0] === "uninstall") { state.installed.delete(args[1]); return "Success\n"; }
    if (text.includes("am get-current-user")) return "0\n";
    if (text.includes("get-role-holders")) return `${state.holder}\n`;
    if (text.includes("resolve-activity")) return `priority=0\n${state.activity}\n`;
    if (text.includes("set-home-activity")) { state.activity = args.at(-1); state.holder = args.at(-1).split("/")[0]; return "Success\n"; }
    if (text.includes("add-role-holder")) { state.holder = args.at(-1); state.activity = `${state.holder}/.Launcher`; return ""; }
    if (text.includes("dumpsys activity activities")) return `  topResumedActivity=ActivityRecord{1 u0 ${state.activity} t1}\n`;
    if (text.includes("am instrument")) {
      const cls = args[args.indexOf("class") + 1].split("#")[0];
      return `INSTRUMENTATION_STATUS: class=${cls}\nINSTRUMENTATION_STATUS: test=m\nINSTRUMENTATION_STATUS_CODE: 1\nINSTRUMENTATION_STATUS: class=${cls}\nINSTRUMENTATION_STATUS: test=m\nINSTRUMENTATION_STATUS_CODE: 0\nINSTRUMENTATION_CODE: -1\n`;
    }
    return "";
  };
  return { state, adb };
}
function apkFixture(dir) {
  fs.mkdirSync(path.join(dir, "instrumentation"));
  const manifest = { testMocks: false, results: [], instrumentation: {} };
  for (const variant of ["standalone", "launcher"]) {
    fs.writeFileSync(path.join(dir, `${variant}-debug.apk`), `${variant} app`);
    fs.writeFileSync(path.join(dir, `instrumentation/${variant}-androidTest.apk`), `${variant} test`);
    manifest.results.push({ variant, mode: "debug", sha256: sha(`${variant} app`), versionCode: 7 });
    manifest.instrumentation[variant] = { sha256: sha(`${variant} test`) };
  }
  fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
}
async function targetRun(target, props, serial, { extra = [], preinstalled = [] } = {}) {
  const dir = tmp("alpha-target-");
  apkFixture(dir);
  execFileSync("git", ["init", "--quiet", dir]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "--quiet", "-m", "fixture"]);
  const fake = fakeTarget(props, { preinstalled });
  const options = parseInstrumentationArgs(["--device-target", target, "--serial", serial, "--allow-reinstall", "--classes", "Shell", "--apk-dir", dir, "--output", path.join(dir, "out"), ...extra]);
  const previous = process.cwd();
  process.chdir(dir);
  try { return { result: await runLeased({ options, serial, adb: fake.adb, timing: { sleep: () => {}, attempts: 2 } }), ...fake, record: () => JSON.parse(fs.readFileSync(path.join(dir, "out/results.json"), "utf8")) }; }
  finally { process.chdir(previous); fs.rmSync(dir, { recursive: true, force: true }); }
}

test("a Cuttlefish run records class I with the image identity and never asks for an AVD", async () => {
  const { result, state } = await targetRun("cuttlefish", CF, "127.0.0.1:6520");
  assert.equal(result.passed, true);
  assert.equal(result.evidenceClass, "I");
  assert.equal(result.deviceTarget, "cuttlefish");
  assert.equal(result.device.fingerprint, CF["ro.build.fingerprint"]);
  assert.equal(result.emulator, undefined);
  assert.ok(!state.commands.some(command => command.startsWith("emu ")), "no emulator console command on a device target");
  assert.ok(state.commands.filter(command => command.startsWith("install")).every(command => command.startsWith("install -r -t ")));
  assert.equal(state.installed.size, 0, "only what the run installed is removed");
});

test("a Pixel run records class D, names a replaced installation, and the HOME phase restores the previous holder", async () => {
  const { result, state } = await targetRun("pixel", PIXEL, "4B021JEBF00123", { extra: ["--home-role", "--classes", "Shell,LauncherHome"], preinstalled: [] });
  assert.equal(result.evidenceClass, "D");
  assert.equal(result.homeRole.selected, true);
  assert.equal(result.homeRole.restored, true);
  assert.equal(state.holder, "com.android.launcher3");
  assert.equal(result.passed, true);
  const replaced = await targetRun("pixel", PIXEL, "4B021JEBF00123", { preinstalled: [PACKAGE] });
  assert.deepEqual(replaced.result.device.replacedPackages, [PACKAGE]);
  // Hand-built options without --allow-reinstall are refused before any install or clear.
  const fake = fakeTarget(PIXEL, { preinstalled: [PACKAGE] });
  const options = { ...parseInstrumentationArgs(["--device-target", "pixel", "--serial", "4B021JEBF00123", "--allow-reinstall", "--classes", "Shell"]), allowReinstall: false };
  await assert.rejects(runLeased({ options, serial: "4B021JEBF00123", adb: fake.adb }), /--allow-reinstall/);
  assert.ok(!fake.state.commands.some(command => /^install|^uninstall|pm clear/.test(command)));
  // A different serial than the admitted one is refused.
  await assert.rejects(runLeased({ options: { ...options, allowReinstall: true }, serial: "OTHER0SERIAL", adb: fake.adb }), /serial mismatch/);
});

// ------------------------------------------------------------------ PNG and image checks

test("the PNG decoder reverses every PNG row filter", () => {
  const width = 7, height = 5;
  const pixel = (x, y) => [(x * 37 + y * 11) & 255, (x * 5 + y * 71) & 255, (x * y * 13) & 255, 200 + x];
  for (const filter of [0, 1, 2, 3, 4]) {
    const raw = [], rows = [];
    for (let y = 0; y < height; y++) rows.push(Array.from({ length: width }, (_, x) => pixel(x, y)).flat());
    for (let y = 0; y < height; y++) {
      raw.push(filter);
      for (let i = 0; i < width * 4; i++) {
        const a = i >= 4 ? rows[y][i - 4] : 0, b = y ? rows[y - 1][i] : 0, c = y && i >= 4 ? rows[y - 1][i - 4] : 0;
        const p = a + b - c, pred = [0, a, b, (a + b) >> 1, Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c][filter];
        raw.push((rows[y][i] - pred) & 255);
      }
    }
    const reference = encodePng({ width, height, data: Buffer.from(rows.flat()) });
    // Replace the IDAT of a valid file with the filtered stream.
    const ihdr = reference.subarray(8, 33);
    const idat = zlib.deflateSync(Buffer.from(raw));
    const chunk = Buffer.alloc(8); chunk.writeUInt32BE(idat.length); chunk.write("IDAT", 4, "latin1");
    const file = Buffer.concat([reference.subarray(0, 8), ihdr, chunk, idat, Buffer.alloc(4), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
    assert.deepEqual([...decodePng(file).data], rows.flat(), `filter ${filter}`);
  }
  assert.throws(() => decodePng(Buffer.from("not a png at all, definitely not one")), /Not a PNG/);
});

const W = 60, H = 120;
function image(fill, rects = []) {
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...fill, 255], i * 4);
  for (const [x0, y0, x1, y1, colour] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...colour, 255], (y * W + x) * 4);
  return { width: W, height: H, data };
}

test("blank detection and baseline comparison ignore only the status and navigation bands", () => {
  assert.equal(blankness(image([255, 255, 255])).blank, true);
  assert.equal(blankness(image([255, 255, 255], [[0, 0, W, 6, [0, 0, 0]]])).blank, true, "content only inside the status band is still blank");
  assert.equal(blankness(image([255, 255, 255], [[5, 30, 55, 60, [20, 20, 20]]])).blank, false);
  const a = image([255, 255, 255], [[5, 30, 55, 60, [20, 20, 20]]]);
  assert.equal(compareImages(a, a).changedPercent, 0);
  assert.equal(compareImages(a, image([255, 255, 255], [[5, 30, 55, 60, [20, 20, 20]], [0, 0, W, 6, [0, 0, 255]]])).changedPercent, 0, "status bar clock is excluded");
  assert.ok(compareImages(a, image([255, 255, 255], [[5, 30, 55, 90, [20, 20, 20]]])).changedPercent > 10);
  assert.equal(compareImages(a, image([250, 250, 250], [[5, 30, 55, 60, [30, 30, 30]]])).changedPercent, 0, "within the 16-level channel threshold");
  assert.equal(compareImages(a, { width: W, height: H + 1, data: Buffer.alloc(W * (H + 1) * 4) }).status, "dimension-mismatch");
});

test("window, crash log and UI dump parsing", () => {
  assert.equal(windowState(`mCurrentFocus=Window{1 u0 ${PACKAGE}/${PACKAGE}.MainActivity}\n`).alphaFocused, true);
  assert.match(windowState(`mCurrentFocus=Window{2 u0 Application Not Responding: ${PACKAGE}}\n`).dialog, /Not Responding/);
  assert.equal(windowState(`mCurrentFocus=Window{2 u0 Application Error: ${PACKAGE}}\n`).alphaFocused, false);
  assert.equal(crashEntries(`--------- beginning of crash\nE AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: ${PACKAGE}, PID: 1\nE AndroidRuntime: Process: com.other, PID: 2\n`), 1);
  const nodes = parseUiDump(`<?xml version='1.0'?><hierarchy rotation="0"><node text="Inbox" content-desc="" resource-id="" clickable="false" bounds="[0,0][100,40]" /><node text="" content-desc="All apps" clickable="true" bounds="[10,10][30,50]"><node text="Q&amp;A" bounds="[0,0][1,1]"/></node></hierarchy>`);
  assert.deepEqual(nodes[1].center, [20, 30]);
  assert.equal(nodes[2].text, "Q&A");
  assert.equal(viewMarker(nodes, "Inbox"), true);
  assert.equal(viewMarker(nodes, "Home"), true);
  assert.equal(viewMarker([{ id: "alpha-auth-title", text: "Sign in", desc: "", clickable: false }, ...nodes], "Inbox"), false, "the sign-in gate is never a view");
  assert.throws(() => parseUiDump("ERROR: null root node"), /no hierarchy/);
});

test("the gate's view list is Home plus the root views of root-view-states.spec.ts", () => {
  const spec = fs.readFileSync(new URL("./browser/root-view-states.spec.ts", import.meta.url), "utf8");
  const root = JSON.parse(/const ROOT = (\[[^\]]+\])/.exec(spec)[1].replace(/'/g, '"'));
  assert.deepEqual(DEVICE_VIEWS, ["Home", ...root]);
});

// ------------------------------------------------------------------ per-view capture

/**
 * A scripted Alpha install: screens per view and theme, taps on dump coordinates, Back to Home,
 * and night mode. `faults` injects a blank view, a crash dialog, a crash log entry or a gate.
 */
function fakePhone({ props = CF, faults = {}, night = "no", variantPixels = null } = {}) {
  const state = { night, screen: faults.signedOut ? "signin" : "Home", commands: [], crashLog: "--------- beginning of crash\n", pid: "4242" };
  const views = DEVICE_VIEWS.filter(view => view !== "Home");
  const position = view => [10, 10 + views.indexOf(view) * 8];
  const dump = () => {
    if (state.screen === "signin") return `<hierarchy><node text="Sign in" resource-id="alpha-auth-title" clickable="false" bounds="[0,0][60,20]"/><node text="Sign in with Eliza Cloud" clickable="true" bounds="[0,30][60,40]"/></hierarchy>UI hierchary dumped to: /dev/tty`;
    if (state.screen === "Home") return `<hierarchy><node content-desc="All apps" clickable="true" bounds="[0,100][20,110]"/>${views.slice(0, 5).map(view => { const [x, y] = position(view); return `<node text="${view}" clickable="true" bounds="[${x - 1},${y - 1}][${x + 1},${y + 1}]"/>`; }).join("")}</hierarchy>`;
    if (state.screen === "AllApps") return `<hierarchy><node text="All apps" clickable="false" bounds="[0,0][60,10]"/>${views.map(view => { const [x, y] = position(view); return `<node content-desc="Open ${view}" clickable="true" bounds="[${x + 19},${y - 1}][${x + 21},${y + 1}]"/>`; }).join("")}</hierarchy>`;
    if (faults.noMarker === state.screen) return `<hierarchy><node text="Something else" clickable="false" bounds="[0,0][60,10]"/></hierarchy>`;
    return `<hierarchy><node text="${state.screen}" clickable="false" bounds="[0,0][60,120]"/></hierarchy>`;
  };
  const screenshot = () => {
    const dark = state.night === "yes", fill = dark ? [10, 10, 12] : [250, 250, 248], ink = dark ? [230, 230, 230] : [20, 20, 20];
    if (faults.blank === state.screen) return encodePng(image(fill));
    const index = ["Home", "AllApps", "signin", ...views].indexOf(state.screen);
    const img = image(fill, [[4, 10 + index * 4, 56, 30 + index * 4, ink], [4, 60, 8 + index * 4, 100, ink]]);
    if (variantPixels && variantPixels.view === state.screen) for (let y = 40; y < 40 + variantPixels.rows; y++) for (let x = 0; x < W; x++) img.data.set([255, 0, 0, 255], (y * W + x) * 4);
    return encodePng(img);
  };
  const adb = (args, { binary = false } = {}) => {
    const text = args.join(" ");
    state.commands.push(text);
    const prop = getprop(props)(args);
    if (prop !== null) return prop;
    if (text === `shell pm path ${PACKAGE}`) return `package:/product/app/AlphaPhone/AlphaPhone.apk\n`;
    if (text.startsWith("shell sha256sum")) return `${sha("apk bytes")}  /product/app/AlphaPhone/AlphaPhone.apk\n`;
    if (args[0] === "pull") { fs.writeFileSync(args[2], faults.pulledOther ? "other bytes" : "apk bytes"); return ""; }
    if (text === `shell dumpsys package ${PACKAGE}`) return `Packages:\n  Package [${PACKAGE}] (1):\n    versionCode=12 minSdk=29 targetSdk=36\n    versionName=0.2.0\n    signatures=PackageSignatures{1 version:3, signatures:[289df855], past signatures:[]}\n    pkgFlags=[ SYSTEM HAS_CODE ]\n`;
    if (text === "logcat -b crash -d") return state.crashLog;
    if (text === `shell pidof ${PACKAGE}`) return `${state.pid}\n`;
    if (text === "shell cmd uimode night") return `Night mode: ${state.night}\n`;
    const set = /^shell cmd uimode night (yes|no)$/.exec(text);
    if (set) { state.night = set[1]; return `Night mode: ${state.night}\n`; }
    if (text.startsWith("shell am start")) return "Status: ok\n";
    if (text === "shell input keyevent KEYCODE_BACK") { if (state.screen !== "signin") state.screen = "Home"; return ""; }
    const tap = /^shell input tap (\d+) (\d+)$/.exec(text);
    if (tap) {
      const [x, y] = [Number(tap[1]), Number(tap[2])];
      if (state.screen === "Home" && x === 10 && y === 105) state.screen = "AllApps";
      else {
        const hit = views.find(view => { const [vx, vy] = position(view); return vy === y && (state.screen === "Home" ? vx === x : vx + 20 === x); });
        if (hit) {
          state.screen = hit;
          if (faults.crashLog === hit) state.crashLog += `E AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: ${PACKAGE}, PID: 4242\n`;
          if (faults.restart === hit) state.pid = "5151";
        }
      }
      return "";
    }
    if (text === "exec-out screencap -p") return screenshot();
    if (text === "exec-out uiautomator dump /dev/tty") return dump();
    if (text === "shell dumpsys window") return faults.dialog === state.screen
      ? `  mCurrentFocus=Window{9 u0 Application Not Responding: ${PACKAGE}}\n` : `  mCurrentFocus=Window{1 u0 ${PACKAGE}/${PACKAGE}.MainActivity}\n`;
    if (binary) throw new Error(`unexpected binary command ${text}`);
    return "";
  };
  return { state, adb };
}
function capture(argv, phone, extra = {}) {
  const options = parseCaptureArgs(["--device-target", "cuttlefish", "--serial", "127.0.0.1:6520", ...argv]);
  return runCapture({ options, adb: phone.adb, sleep: () => {}, now: () => new Date("2026-10-26T00:00:00Z"), ...extra });
}
const MUTATING = /^(install|uninstall)|pm clear|cmd role|set-home-activity|input |am start|uimode night (yes|no)/;

test("every view in both themes is captured, checked and bound to the device and app, and night mode is restored", () => {
  const dir = tmp("alpha-views-");
  try {
    const phone = fakePhone({ night: "no" });
    const record = capture(["--output", path.join(dir, "run")], phone, { certificateOf: () => "c".repeat(64) });
    assert.equal(record.passed, true, JSON.stringify(record.captures.filter(row => !row.passed).map(row => [row.theme, row.view, row.failures])));
    assert.equal(record.evidenceClass, "I");
    assert.equal(record.evidence, "cuttlefish-image-view-capture");
    assert.equal(record.device.fingerprint, CF["ro.build.fingerprint"]);
    assert.deepEqual({ versionName: record.app.versionName, versionCode: record.app.versionCode, apkSha256: record.app.apkSha256, signatures: record.app.signatures },
      { versionName: "0.2.0", versionCode: "12", apkSha256: sha("apk bytes"), signatures: "289df855" });
    assert.equal(record.app.certificateSha256, "c".repeat(64));
    // Pulled bytes that differ from the on-device digest bind no certificate.
    const other = capture(["--output", path.join(dir, "other"), "--views", "Home", "--themes", "light"], fakePhone({ faults: { pulledOther: true } }), { certificateOf: () => "c".repeat(64) });
    assert.equal(other.app.certificateSha256, null);
    assert.match(other.app.certificateError, /differ/);
    assert.equal(record.captures.length, DEVICE_VIEWS.length * 2);
    assert.deepEqual(record.nightMode, { original: "no", restored: true, after: "no" });
    assert.equal(phone.state.night, "no");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "run/manifest.json"), "utf8"));
    for (const row of manifest.captures) assert.equal(sha(fs.readFileSync(path.join(dir, "run", row.file))), row.sha256, row.file);
    assert.ok(manifest.captures.some(row => row.navigation === "all-apps") && manifest.captures.some(row => row.navigation === "home-button"));
    assert.ok(!phone.state.commands.some(command => /^(install|uninstall)|pm clear|cmd role/.test(command)), "the gate never installs, clears or changes roles");
    assert.throws(() => capture(["--output", path.join(dir, "run")], fakePhone()), /EEXIST/, "never writes into older evidence");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a blank view, a crash or ANR dialog, a crash log entry, a restart and a missing landmark each fail that view only", () => {
  const dir = tmp("alpha-views-faults-");
  try {
    const cases = { blank: [{ blank: "Notes" }, /blank or uniform/], dialog: [{ dialog: "Maps" }, /crash or ANR dialog/], crash: [{ crashLog: "Files" }, /crash log buffer/],
      restart: [{ restart: "Photos" }, /process restarted/], marker: [{ noMarker: "Camera" }, /landmark not found/] };
    for (const [name, [faults, pattern]] of Object.entries(cases)) {
      const view = Object.values(faults)[0];
      const record = capture(["--output", path.join(dir, name), "--themes", "light"], fakePhone({ faults }));
      assert.equal(record.passed, false, name);
      const failed = record.captures.filter(row => !row.passed);
      assert.ok(failed.some(row => row.view === view && row.failures.some(failure => pattern.test(failure))), `${name}: ${JSON.stringify(failed.map(row => [row.view, row.failures]))}`);
      // Every other view passed: a fault is reported against the view it happened in.
      assert.deepEqual(failed.map(row => row.view), [view], name);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("signed out, the production sign-in gate fails every view and the screen is still recorded", () => {
  const dir = tmp("alpha-views-signin-");
  try {
    const phone = fakePhone({ faults: { signedOut: true }, night: "yes" });
    const record = capture(["--output", path.join(dir, "run")], phone);
    assert.equal(record.passed, false);
    assert.equal(record.captures.length, DEVICE_VIEWS.length * 2);
    assert.ok(record.captures.every(row => !row.passed && row.navigation.startsWith("signed-out") && row.failures.some(failure => /sign-in gate/.test(failure))));
    assert.equal(record.unreachable.length, DEVICE_VIEWS.length * 2);
    assert.ok(!phone.state.commands.some(command => command.startsWith("shell input tap")), "nothing is tapped behind the gate");
    assert.equal(phone.state.night, "yes", "the original dark mode is put back");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("baseline: only an explicit --update-baseline on a passing run writes it; later runs compare against it", () => {
  const dir = tmp("alpha-views-baseline-");
  try {
    const baseline = path.join(dir, "baseline");
    const views = ["--views", "Home,Inbox,Notes"];
    // A run that fails writes no baseline.
    const failed = capture(["--output", path.join(dir, "f"), ...views, "--baseline", baseline, "--update-baseline"], fakePhone({ faults: { blank: "Notes" } }));
    assert.equal(failed.baselineUpdated, false);
    assert.ok(!fs.existsSync(baseline));
    // Without a baseline image, a compare run fails rather than passing unchecked.
    assert.match(capture(["--output", path.join(dir, "m"), ...views, "--baseline", baseline], fakePhone()).captures[0].failures.join(), /no baseline image/);
    const updated = capture(["--output", path.join(dir, "u"), ...views, "--baseline", baseline, "--update-baseline"], fakePhone());
    assert.equal(updated.baselineUpdated, true);
    const written = JSON.parse(fs.readFileSync(path.join(baseline, "baseline.json"), "utf8"));
    assert.equal(Object.keys(written.images).length, 6);
    assert.equal(written.device.fingerprint, CF["ro.build.fingerprint"]);
    const same = capture(["--output", path.join(dir, "s"), ...views, "--baseline", baseline], fakePhone());
    assert.equal(same.passed, true);
    assert.ok(same.captures.every(row => row.checks.baseline.status === "compared" && row.checks.baseline.changedPercent === 0));
    // A drawn change in Notes beyond the threshold fails Notes and writes a difference image.
    const changed = capture(["--output", path.join(dir, "c"), ...views, "--baseline", baseline], fakePhone({ variantPixels: { view: "Notes", rows: 6 } }));
    assert.equal(changed.passed, false);
    const notes = changed.captures.filter(row => row.view === "Notes");
    assert.ok(notes.every(row => !row.passed && /differ from the baseline/.test(row.failures.join())));
    assert.ok(fs.existsSync(path.join(dir, "c", notes[0].checks.baseline.differenceImage)));
    assert.ok(changed.captures.filter(row => row.view !== "Notes").every(row => row.passed));
    // A looser explicit threshold admits the same change.
    assert.equal(capture(["--output", path.join(dir, "l"), ...views, "--baseline", baseline, "--max-diff-percent", "10"], fakePhone({ variantPixels: { view: "Notes", rows: 6 } })).passed, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("--observe-only changes nothing on the device and is never a pass", () => {
  const dir = tmp("alpha-views-observe-");
  try {
    const phone = fakePhone({ faults: { signedOut: true } });
    const record = capture(["--output", path.join(dir, "o"), "--observe-only"], phone);
    assert.equal(record.passed, false);
    assert.equal(record.observation.passed, true);
    assert.equal(record.observation.identified, "sign-in");
    assert.ok(!phone.state.commands.some(command => MUTATING.test(command)), phone.state.commands.join("\n"));
    assert.throws(() => parseCaptureArgs(["--device-target", "cuttlefish", "--serial", "s", "--output", "o", "--observe-only", "--views", "Home"]), /observe-only/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("capture options: device targets only, known views and themes, explicit baseline update", () => {
  const base = ["--serial", "127.0.0.1:6520", "--output", "o"];
  assert.throws(() => parseCaptureArgs(["--device-target", "emulator", ...base]), /emulators are not a device target/);
  assert.throws(() => parseCaptureArgs(["--device-target", "pixel", "--output", "o"]), /--serial/);
  assert.throws(() => parseCaptureArgs(["--device-target", "pixel", ...base, "--views", "Wallet"]), /--views/);
  assert.throws(() => parseCaptureArgs(["--device-target", "pixel", ...base, "--themes", "sepia"]), /--themes/);
  assert.throws(() => parseCaptureArgs(["--device-target", "pixel", ...base, "--update-baseline"]), /--baseline/);
  // The serial is checked against the target at admission, before anything is captured.
  const dir = tmp("alpha-views-serial-");
  try {
    assert.throws(() => runCapture({ options: parseCaptureArgs(["--device-target", "pixel", "--serial", "127.0.0.1:6520", "--output", path.join(dir, "x")]), adb: fakePhone({ props: PIXEL }).adb }), /USB serial/);
    assert.ok(!fs.existsSync(path.join(dir, "x")));
    const pixel = runCapture({ options: parseCaptureArgs(["--device-target", "pixel", "--serial", PIXEL["ro.serialno"], "--output", path.join(dir, "p"), "--views", "Home", "--themes", "light"]),
      adb: fakePhone({ props: PIXEL }).adb, sleep: () => {} });
    assert.equal(pixel.evidenceClass, "D");
    assert.equal(pixel.evidence, "physical-device-view-capture");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
