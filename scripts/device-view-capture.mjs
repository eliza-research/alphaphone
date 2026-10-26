#!/usr/bin/env node
/**
 * Native per-view screenshot gate (decision P-58, docs/device-acceptance-gates.md).
 *
 *   node scripts/device-view-capture.mjs --device-target cuttlefish|pixel --serial S --output DIR \
 *     [--views Home,Inbox,...] [--themes light,dark] [--baseline DIR [--update-baseline]] \
 *     [--max-diff-percent 1] [--ignore-top-percent 5] [--ignore-bottom-percent 5] [--settle-ms 1500]
 *   node scripts/device-view-capture.mjs --device-target cuttlefish --serial 127.0.0.1:6520 --output DIR --observe-only
 *
 * Drives the Alpha app that is already installed on the target through its own production UI:
 * it starts MainActivity, finds each view's button on Home (or "Open <view>" in the All apps
 * dialog) in a `uiautomator dump` of the WebView's accessibility tree and taps it. Nothing is
 * installed, cleared or uninstalled, and no test-mocks hook, deep link or instrumentation is used:
 * the production bundle has no route for a view, so its own buttons are the only safe path.
 * Each view is captured with `adb exec-out screencap -p` in light and dark (`cmd uimode night`;
 * the original night mode is put back and read back, and an unproven restoration fails the run).
 *
 * Per image the automated checks are: the PNG is not blank or uniform; no crash or ANR dialog is
 * showing and Alpha owns the focused window (`dumpsys window`); no new Alpha entry in the crash
 * log buffer (`logcat -b crash`) and the app process did not restart; the view's landmark is in the
 * `uiautomator dump` and the screen changed from Home; and, with --baseline, the changed-pixel share
 * against the committed baseline image is within --max-diff-percent (pure JS, no dependency).
 * --update-baseline writes the images that passed every other check as the new baseline.
 *
 * --observe-only changes nothing on the device (no start, tap, key or night-mode change): it
 * captures and checks the screen as it is. It never counts as the per-view gate (passed: false).
 *
 * The manifest records the evidence class of the target (Cuttlefish I, physical Pixel D), the
 * device identity and fingerprint, the installed app's version, APK SHA-256 and signer, and
 * every image's SHA-256. It is not user acceptance of what the screens say, and not class E.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { admitDeviceTarget, DEVICE_TARGETS, PACKAGE } from "./android-instrumentation.mjs";

/** Home, then the root views of test/browser/root-view-states.spec.ts (ROOT), in that order. */
export const DEVICE_VIEWS = ["Home", "Inbox", "Calendar", "Browser", "Camera", "Photos", "Maps", "Notes", "Files", "Workflows", "Settings"];
export const THEMES = ["light", "dark"];
const NOT_EVIDENCE_FOR = {
  cuttlefish: ["emulator instrumentation", "physical-device acceptance", "user acceptance of the screens' content", "real integrations"],
  pixel: ["emulator instrumentation", "AOSP image boot", "real integrations", "user acceptance of the screens' content", "other device models or builds"],
};

// ---------------------------------------------------------------- PNG (8-bit, non-interlaced)

/** Decode an 8-bit grey, grey+alpha, RGB or RGBA PNG into RGBA bytes. */
export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error("Not a PNG");
  let offset = 8, width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colour = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!width || !height || depth !== 8 || !channels || interlace !== 0) throw new Error(`Unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error("PNG data length does not match its header");
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride, up = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0, b = y > 0 ? pixels[up + x] : 0, c = y > 0 && x >= channels ? pixels[up + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`);
      pixels[out + x] = value & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (channels === 4) pixels.copy(rgba, i * 4, s, s + 4);
    else if (channels === 3) { rgba[i * 4] = pixels[s]; rgba[i * 4 + 1] = pixels[s + 1]; rgba[i * 4 + 2] = pixels[s + 2]; rgba[i * 4 + 3] = 255; }
    else { const g = pixels[s]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = channels === 2 ? pixels[s + 1] : 255; }
  }
  return { width, height, data: rgba };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Encode RGBA bytes as a PNG (filter 0). Used for difference images and test fixtures. */
export function encodePng({ width, height, data }) {
  const chunk = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, "latin1"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body]))); return Buffer.concat([head, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Rows compared: the status bar (top) and gesture/navigation bar (bottom) bands are excluded. */
const band = (height, { ignoreTopPercent = 5, ignoreBottomPercent = 5 } = {}) => [Math.floor(height * ignoreTopPercent / 100), height - Math.floor(height * ignoreBottomPercent / 100)];

/**
 * Blank or uniform: within the compared rows, the most common colour (quantised to 4 bits per
 * channel) covers more than `maxDominantPercent` of the pixels, or luminance barely varies.
 */
export function blankness(image, options = {}) {
  const [top, bottom] = band(image.height, options);
  const counts = new Map();
  let sum = 0, sumSq = 0, n = 0;
  for (let y = top; y < bottom; y += 2) for (let x = 0; x < image.width; x += 2) {
    const i = (y * image.width + x) * 4, r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; sum += lum; sumSq += lum * lum; n++;
  }
  if (!n) return { blank: true, dominantPercent: 100, luminanceStdDev: 0 };
  const dominantPercent = Math.max(...counts.values()) / n * 100;
  const luminanceStdDev = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  const maxDominantPercent = options.maxDominantPercent ?? 99.5;
  return { blank: dominantPercent > maxDominantPercent || luminanceStdDev < 1.5, dominantPercent: round(dominantPercent), luminanceStdDev: round(luminanceStdDev) };
}

/**
 * Changed-pixel share between two captures of the same size over the compared rows: a pixel is
 * changed when any RGB channel differs by more than `channelThreshold` (16, as in
 * scripts/compare-prototype.py). Returns a red heat image of the differences.
 */
export function compareImages(a, b, options = {}) {
  if (a.width !== b.width || a.height !== b.height) return { status: "dimension-mismatch", baseline: [a.width, a.height], capture: [b.width, b.height] };
  const threshold = options.channelThreshold ?? 16;
  const [top, bottom] = band(a.height, options);
  const heat = Buffer.alloc(a.width * a.height * 4);
  let changed = 0, compared = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    heat[i + 3] = 255;
    if (y < top || y >= bottom) continue;
    compared++;
    const delta = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (delta > threshold) { changed++; heat[i] = Math.min(255, delta * 4); }
  }
  return { status: "compared", changedPercent: round(changed / compared * 100), changedPixels: changed, comparedPixels: compared, rows: [top, bottom], heat: { width: a.width, height: a.height, data: heat } };
}
const round = value => Math.round(value * 10_000) / 10_000;

// ---------------------------------------------------------------- device observations

const entity = text => text.replace(/&(#x?[0-9a-f]+|amp|quot|lt|gt|apos);/gi, (_, e) => ({ amp: "&", quot: '"', lt: "<", gt: ">", apos: "'" })[e.toLowerCase()]
  ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
/** Nodes of a `uiautomator dump`: text, content-desc, resource-id, package, clickable and centre. */
export function parseUiDump(xml) {
  if (!/<hierarchy[\s>]/.test(xml)) throw new Error("uiautomator dump returned no hierarchy");
  return [...xml.matchAll(/<node\s([^>]*?)\/?>/g)].map(([, attributes]) => {
    const attr = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, entity(value)]));
    const box = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attr.bounds ?? "");
    return { text: attr.text ?? "", desc: attr["content-desc"] ?? "", id: attr["resource-id"] ?? "", pkg: attr.package ?? "", clickable: attr.clickable === "true",
      center: box ? [Math.round((+box[1] + +box[3]) / 2), Math.round((+box[2] + +box[4]) / 2)] : null };
  });
}
const label = node => node.text || node.desc;
const named = (nodes, name) => nodes.find(node => node.clickable && node.center && (node.text === name || node.desc === name));
/** The production sign-in gate (runtime/connection-ui.tsx, id alpha-auth-title) covers Home when signed out. */
export const signInGate = nodes => nodes.some(node => node.id === "alpha-auth-title" || /(^|\/)alpha-auth-title$/.test(node.id));
const atHome = nodes => Boolean(named(nodes, "All apps"));

/**
 * The view's landmark: a non-clickable node whose accessible name contains the view's name (the
 * main/region/dialog name rule of root-view-states.spec.ts). Home is recognised by its All apps button.
 */
export function viewMarker(nodes, view) {
  if (view === "Home") return atHome(nodes) && !signInGate(nodes);
  return !signInGate(nodes) && nodes.some(node => !node.clickable && label(node).includes(view));
}
/** Which known screen a dump shows, for --observe-only. */
export const identifyScreen = nodes => signInGate(nodes) ? "sign-in" : DEVICE_VIEWS.find(view => view !== "Home" && viewMarker(nodes, view)) ?? (viewMarker(nodes, "Home") ? "Home" : null);

/** Crash or ANR dialogs and the focused window, from `dumpsys window`. */
export function windowState(dumpsys) {
  const focus = /mCurrentFocus=(.*)/.exec(dumpsys)?.[1]?.trim() ?? "";
  const dialog = /Application (?:Error|Not Responding): *\S+|isn't responding|keeps stopping|has stopped/.exec(dumpsys)?.[0] ?? null;
  return { focus, dialog, alphaFocused: focus.includes(`${PACKAGE}/`) };
}
/** Alpha's entries in the crash log buffer (one per FATAL EXCEPTION or native crash naming the process). */
export const crashEntries = log => (log.match(new RegExp(`(?:^|\\n)[^\\n]*(?:Process: ${PACKAGE.replace(/\./g, "\\.")}\\b|>>> ${PACKAGE.replace(/\./g, "\\.")}\\b)`, "g")) ?? []).length;

/** Installed app identity: version, APK path and on-device SHA-256, and signer from dumpsys. */
export function appIdentity(adb) {
  const pmPath = adb(["shell", "pm", "path", PACKAGE]).trim();
  const apkPaths = [...pmPath.matchAll(/^package:(\/\S+\.apk)$/gm)].map(match => match[1]);
  if (!apkPaths.length) throw new Error(`${PACKAGE} is not installed; install the build under test first (this gate installs nothing)`);
  if (apkPaths.length !== 1) throw new Error(`${PACKAGE} is installed as split APKs (${apkPaths.length}); the gate binds one base APK`);
  const dump = adb(["shell", "dumpsys", "package", PACKAGE]);
  // dumpsys lists the active package first; an updated system app lists its system copy after it.
  const first = dump.slice(0, dump.search(/\n\s*Hidden system packages:|$/));
  const apkSha256 = adb(["shell", "sha256sum", apkPaths[0]]).trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(apkSha256)) throw new Error("Installed APK digest unavailable");
  return { packageName: PACKAGE, apkPath: apkPaths[0], apkSha256, versionName: /versionName=(\S+)/.exec(first)?.[1] ?? null,
    versionCode: /versionCode=(\d+)/.exec(first)?.[1] ?? null, signatures: /signatures:\[([^\]]*)\]/.exec(first)?.[1] ?? null,
    flags: /pkgFlags=\[([^\]]*)\]/.exec(first)?.[1]?.trim() ?? null };
}
export const nightMode = text => /Night mode: (\S+)/.exec(text)?.[1] ?? null;

// ---------------------------------------------------------------- options

export function parseCaptureArgs(argv) {
  const options = { deviceTarget: null, serial: null, output: null, views: DEVICE_VIEWS, themes: THEMES, baseline: null, updateBaseline: false,
    maxDiffPercent: 1, ignoreTopPercent: 5, ignoreBottomPercent: 5, settleMs: 1500, observeOnly: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index], name = arg.split("=")[0];
    const value = () => { if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1); if (argv[index + 1] === undefined) throw new Error(`${arg} needs a value`); return argv[++index]; };
    const number = () => { const v = Number(value()); if (!Number.isFinite(v) || v < 0) throw new Error(`${name} needs a non-negative number`); return v; };
    const list = () => value().split(",").map(s => s.trim()).filter(Boolean);
    switch (name) {
      case "--device-target": options.deviceTarget = value(); break;
      case "--serial": options.serial = value(); break;
      case "--output": options.output = value(); break;
      case "--views": options.views = list(); break;
      case "--themes": options.themes = list(); break;
      case "--baseline": options.baseline = value(); break;
      case "--update-baseline": options.updateBaseline = true; break;
      case "--max-diff-percent": options.maxDiffPercent = number(); break;
      case "--ignore-top-percent": options.ignoreTopPercent = number(); break;
      case "--ignore-bottom-percent": options.ignoreBottomPercent = number(); break;
      case "--settle-ms": options.settleMs = number(); break;
      case "--observe-only": options.observeOnly = true; break;
      default: throw new Error(`Unknown option ${arg}`);
    }
  }
  if (!Object.hasOwn(DEVICE_TARGETS, options.deviceTarget ?? "")) throw new Error("--device-target cuttlefish|pixel is required; emulators are not a device target");
  if (typeof options.serial !== "string") throw new Error("--serial is required");
  if (typeof options.output !== "string") throw new Error("--output <new directory> is required");
  if (!options.views.length || new Set(options.views).size !== options.views.length || options.views.some(view => !DEVICE_VIEWS.includes(view)))
    throw new Error(`--views must name each of ${DEVICE_VIEWS.join(", ")} at most once`);
  if (!options.themes.length || new Set(options.themes).size !== options.themes.length || options.themes.some(theme => !THEMES.includes(theme)))
    throw new Error("--themes must list light and/or dark once each");
  if (options.updateBaseline && !options.baseline) throw new Error("--update-baseline needs --baseline <directory>");
  if (options.observeOnly && (options.updateBaseline || argv.some(arg => /^--(views|themes)(=|$)/.test(arg))))
    throw new Error("--observe-only captures the current screen only; it takes no --views, --themes or --update-baseline");
  if (options.ignoreTopPercent + options.ignoreBottomPercent >= 90) throw new Error("The ignored bands leave too little of the screen to compare");
  return options;
}

// ---------------------------------------------------------------- run

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sha256File = file => {
  const hash = createHash("sha256"), fd = fs.openSync(file, "r"), chunk = Buffer.alloc(1 << 20);
  try { for (let read; (read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, read)); } finally { fs.closeSync(fd); }
  return hash.digest("hex");
};
const defaultSleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * One capture run. `adb(args, {binary})` returns a string, or a Buffer with binary; `certificateOf`
 * returns the signer SHA-256 of the pulled APK file (apksigner) or throws.
 */
export function runCapture({ options, adb, sleep = defaultSleep, certificateOf = null, commit = null, now = () => new Date() }) {
  const device = admitDeviceTarget(adb, options.deviceTarget, options.serial);
  const app = appIdentity(adb);
  const output = path.resolve(options.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output); // Reserved before the APK pull. Fresh directory: never mix with older evidence.
  if (certificateOf) {
    // adb pull streams the APK (the packaged runtime makes it hundreds of MB) to a host temp file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-view-capture-apk-"));
    try {
      const file = path.join(dir, "base.apk");
      adb(["pull", app.apkPath, file], { timeout: 600_000 });
      if (sha256File(file) !== app.apkSha256) throw new Error("pulled APK bytes differ from the installed APK digest");
      app.certificateSha256 = certificateOf(file);
    } catch (error) { app.certificateSha256 = null; app.certificateError = String(error.message).slice(0, 300); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  let crashSeen = crashEntries(adb(["logcat", "-b", "crash", "-d"]));
  const pid = () => adb(["shell", "pidof", PACKAGE], { allowFailure: true }).trim() || null;
  const dump = () => {
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      last = adb(["exec-out", "uiautomator", "dump", "/dev/tty"], { allowFailure: true });
      if (/<hierarchy[\s>]/.test(last)) return { xml: last.replace(/UI hier[a-z]* dumped to: \/dev\/tty\s*$/, ""), nodes: parseUiDump(last) };
      sleep(500);
    }
    return { xml: last, nodes: null };
  };
  const bands = { ignoreTopPercent: options.ignoreTopPercent, ignoreBottomPercent: options.ignoreBottomPercent };
  const baseline = options.baseline ? path.resolve(options.baseline) : null;
  const baselineRecord = baseline && fs.existsSync(path.join(baseline, "baseline.json")) ? JSON.parse(fs.readFileSync(path.join(baseline, "baseline.json"), "utf8")) : null;
  const captures = [];
  const homeImages = new Map();

  /** Capture, save and check the current screen. */
  const capture = ({ view, theme, expected, navigation, pidBefore }) => {
    const name = `${theme}-${view.toLowerCase()}`;
    const failures = [];
    const png = adb(["exec-out", "screencap", "-p"], { binary: true });
    fs.writeFileSync(path.join(output, `${name}.png`), png);
    const ui = dump();
    fs.writeFileSync(path.join(output, `${name}.xml`), ui.xml);
    const window = windowState(adb(["shell", "dumpsys", "window"]));
    // New entries since the previous capture, so one crash fails the view it happened in.
    const crashTotal = crashEntries(adb(["logcat", "-b", "crash", "-d"]));
    const crashes = Math.max(0, crashTotal - crashSeen);
    crashSeen = Math.max(crashSeen, crashTotal);
    const pidAfter = pid();
    const row = { view, theme, file: `${name}.png`, sha256: sha256(png), uiDump: `${name}.xml`, navigation, checks: {} };
    let image = null;
    try { image = decodePng(png); row.width = image.width; row.height = image.height; }
    catch (error) { failures.push(`screencap is not a readable PNG: ${error.message}`); }
    if (image) { row.checks.blank = blankness(image, bands); if (row.checks.blank.blank) failures.push("screen is blank or uniform"); }
    row.checks.window = window;
    if (window.dialog) failures.push(`crash or ANR dialog: ${window.dialog}`);
    if (!window.alphaFocused) failures.push(`focused window is not Alpha's (${window.focus || "none"})`);
    row.checks.newCrashLogEntries = crashes;
    if (crashes > 0) failures.push(`${crashes} new Alpha entr${crashes === 1 ? "y" : "ies"} in the crash log buffer`);
    row.checks.pid = { before: pidBefore, after: pidAfter };
    if (!pidAfter) failures.push("Alpha's process is not running");
    else if (pidBefore && pidBefore !== pidAfter) failures.push("Alpha's process restarted during this view");
    if (!ui.nodes) failures.push("uiautomator dump failed");
    else {
      row.checks.signInGate = signInGate(ui.nodes);
      row.checks.identified = identifyScreen(ui.nodes);
      if (expected) {
        row.checks.marker = viewMarker(ui.nodes, view);
        if (!row.checks.marker) failures.push(row.checks.signInGate ? "the production sign-in gate covers the app (signed out)" : `${view} landmark not found in the UI dump`);
      }
    }
    // A view other than Home must have changed the screen: a tap that did nothing leaves Home's pixels.
    if (expected && image && view !== "Home" && homeImages.has(theme)) {
      const fromHome = compareImages(homeImages.get(theme), image, bands);
      row.checks.changedFromHomePercent = fromHome.changedPercent ?? null;
      if (fromHome.status === "compared" && fromHome.changedPercent < 1) failures.push("the screen did not change from Home");
    }
    if (image && view === "Home" && !failures.length) homeImages.set(theme, image);
    if (baseline && !options.updateBaseline && image && expected) {
      const file = path.join(baseline, `${name}.png`);
      if (!fs.existsSync(file)) { row.checks.baseline = { status: "missing" }; failures.push(`no baseline image ${path.relative(process.cwd(), file)}`); }
      else {
        const result = compareImages(decodePng(fs.readFileSync(file)), image, bands);
        const { heat, ...summary } = result;
        row.checks.baseline = { ...summary, baselineSha256: sha256(fs.readFileSync(file)), maxDiffPercent: options.maxDiffPercent,
          ...(baselineRecord && baselineRecord.device?.fingerprint !== device.fingerprint ? { baselineFingerprint: baselineRecord.device?.fingerprint ?? null } : {}) };
        if (heat) { fs.writeFileSync(path.join(output, `${name}.diff.png`), encodePng(heat)); row.checks.baseline.differenceImage = `${name}.diff.png`; }
        if (result.status !== "compared") failures.push(`baseline ${result.status}`);
        else if (result.changedPercent > options.maxDiffPercent) failures.push(`${result.changedPercent}% of pixels differ from the baseline (max ${options.maxDiffPercent}%)`);
      }
    }
    row.failures = failures;
    row.passed = failures.length === 0;
    captures.push(row);
    return { row, ui };
  };

  const record = { schema: 1, tool: "scripts/device-view-capture.mjs", createdAt: now().toISOString(), ...(commit ?? {}),
    evidenceClass: DEVICE_TARGETS[options.deviceTarget].evidenceClass, evidence: options.deviceTarget === "cuttlefish" ? "cuttlefish-image-view-capture" : "physical-device-view-capture",
    notEvidenceFor: NOT_EVIDENCE_FOR[options.deviceTarget], deviceTarget: options.deviceTarget, device, app,
    mode: options.observeOnly ? "observe-only" : "views", settings: { ...bands, settleMs: options.settleMs, maxDiffPercent: options.maxDiffPercent,
      channelThreshold: 16, baseline: baseline ? path.relative(process.cwd(), baseline) : null, updateBaseline: options.updateBaseline } };
  const originalNight = nightMode(adb(["shell", "cmd", "uimode", "night"]));
  record.nightMode = { original: originalNight };

  if (options.observeOnly) {
    const theme = originalNight === "yes" ? "dark" : "light";
    const { row } = capture({ view: "Current", theme, expected: false, navigation: "none", pidBefore: pid() });
    record.captures = captures;
    record.observation = { passed: row.passed, identified: row.checks.identified ?? null };
    record.passed = false;
    record.notPassedBecause = "--observe-only captures one existing screen; it is not the per-view gate";
  } else {
    if (!["yes", "no"].includes(originalNight)) throw new Error(`Night mode ${JSON.stringify(originalNight)} cannot be restored exactly (only yes or no); set it to yes or no first`);
    const unreachable = [];
    try {
      for (const theme of options.themes) {
        adb(["shell", "cmd", "uimode", "night", theme === "dark" ? "yes" : "no"]);
        if (nightMode(adb(["shell", "cmd", "uimode", "night"])) !== (theme === "dark" ? "yes" : "no")) throw new Error(`Night mode did not change to ${theme}`);
        adb(["shell", "am", "start", "-W", "-n", `${PACKAGE}/.MainActivity`]);
        sleep(options.settleMs);
        const toHome = () => {
          for (let attempt = 0; attempt < 4; attempt++) {
            const { nodes } = dump();
            if (nodes && (atHome(nodes) || signInGate(nodes))) return nodes;
            adb(["shell", "input", "keyevent", "KEYCODE_BACK"]); sleep(options.settleMs);
          }
          return dump().nodes;
        };
        for (const view of ["Home", ...options.views.filter(v => v !== "Home")]) {
          const nodes = toHome();
          const pidBefore = pid();
          if (!nodes || !atHome(nodes)) {
            if (view === "Home" && !options.views.includes("Home")) continue;
            // Signed out (or Home unreachable): record the screen once, and every view as not reached.
            const reason = nodes && signInGate(nodes) ? "signed-out: the production sign-in gate covers Home" : "Home was not reached";
            capture({ view, theme, expected: true, navigation: reason, pidBefore });
            unreachable.push(`${theme}:${view}`);
            continue;
          }
          let navigation = "home";
          if (view !== "Home") {
            const direct = named(nodes, view);
            if (direct) { adb(["shell", "input", "tap", String(direct.center[0]), String(direct.center[1])]); navigation = "home-button"; }
            else {
              const allApps = named(nodes, "All apps");
              adb(["shell", "input", "tap", String(allApps.center[0]), String(allApps.center[1])]); sleep(options.settleMs);
              const listed = dump().nodes;
              const open = listed && named(listed, `Open ${view}`);
              if (open) { adb(["shell", "input", "tap", String(open.center[0]), String(open.center[1])]); navigation = "all-apps"; }
              else navigation = "not-found";
            }
            sleep(options.settleMs);
          }
          if (view === "Home" && !options.views.includes("Home")) {
            // Home is captured only as the reference for the "screen changed" check.
            const png = adb(["exec-out", "screencap", "-p"], { binary: true });
            try { homeImages.set(theme, decodePng(png)); } catch { /* the per-view checks report it */ }
            continue;
          }
          const { row } = capture({ view, theme, expected: true, navigation, pidBefore });
          if (navigation === "not-found") { row.failures.unshift(`no "${view}" or "Open ${view}" button was found`); row.passed = false; }
        }
      }
    } finally {
      // Always put the original night mode back and read it back.
      try { adb(["shell", "cmd", "uimode", "night", originalNight]); } catch { /* read back below */ }
      let after = null;
      try { after = nightMode(adb(["shell", "cmd", "uimode", "night"])); } catch { after = null; }
      record.nightMode.restored = after === originalNight;
      record.nightMode.after = after;
      if (!record.nightMode.restored) console.error(`Night mode was NOT restored on ${options.serial}: recover with adb -s ${options.serial} shell cmd uimode night ${originalNight}`);
    }
    record.captures = captures;
    if (unreachable.length) record.unreachable = unreachable;
    const expectedCount = options.views.length * options.themes.length;
    record.passed = captures.length === expectedCount && captures.every(row => row.passed) && record.nightMode.restored === true;
    if (options.updateBaseline) {
      // Only images that passed every check become the baseline; a failed run writes none.
      if (!record.passed) record.baselineUpdated = false;
      else {
        fs.mkdirSync(baseline, { recursive: true });
        for (const row of captures) fs.copyFileSync(path.join(output, row.file), path.join(baseline, row.file));
        fs.writeFileSync(path.join(baseline, "baseline.json"), `${JSON.stringify({ schema: 1, createdAt: record.createdAt, ...(commit ?? {}), deviceTarget: options.deviceTarget,
          device, app: { versionName: app.versionName, versionCode: app.versionCode, apkSha256: app.apkSha256, certificateSha256: app.certificateSha256 ?? null },
          images: Object.fromEntries(captures.map(row => [row.file, row.sha256])) }, null, 2)}\n`);
        record.baselineUpdated = true;
      }
    }
  }
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return record;
}

async function main() {
  const options = parseCaptureArgs(process.argv.slice(2));
  const { androidEnv } = await import("./toolchain.mjs");
  const env = androidEnv();
  const adbPath = path.join(env.ANDROID_HOME, "platform-tools/adb");
  const adb = (args, { binary = false, allowFailure = false, timeout = 120_000 } = {}) => {
    const result = spawnSync(adbPath, ["-s", options.serial, ...args], { encoding: binary ? "buffer" : "utf8", env, timeout, maxBuffer: 256 << 20 });
    if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`adb ${args.slice(0, 3).join(" ")} failed: ${result.error?.message ?? String(result.stderr)}`);
    return binary ? result.stdout : `${result.stdout ?? ""}`;
  };
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
  const { signerDigest } = await import("./apk.mjs");
  const certificateOf = file => signerDigest(file);
  // The shared device lease keeps another runner from installing or tapping while this run captures.
  const { acquireDeviceLease, deviceLeaseStateDir } = await import("../vendor/eliza/packages/app/scripts/lib/device-lease.ts");
  const lease = await acquireDeviceLease(`android:${options.serial}`, { waitMs: 0, ttlMs: Number.MAX_SAFE_INTEGER, stateDir: deviceLeaseStateDir(process.env) });
  let record;
  try { record = runCapture({ options, adb, certificateOf, commit: { commit, dirty } }); } finally { lease.release(); }
  for (const row of record.captures) console.log(`${row.passed ? "pass" : "FAIL"} ${row.theme.padEnd(5)} ${row.view.padEnd(9)} ${row.failures.join("; ")}`);
  const where = path.relative(process.cwd(), path.join(path.resolve(options.output), "manifest.json"));
  console.log(`${record.passed ? "PASSED" : "FAILED"}: ${where} (class ${record.evidenceClass} view capture on ${record.device.product}; not user acceptance of the screens' content)`);
  process.exitCode = record.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
