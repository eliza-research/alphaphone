/**
 * Execute and record the four Pixel 10a (stallion) update and recovery drills on a real device
 * (issues #377, #400), and apply passed drill evidence to the signed update channel.
 *
 *   node scripts/pixel10a-drills.mjs signed-update       --serial S --ota /abs/ota.zip --ota-sha256 HEX --out /abs/new-dir [--method sideload|update-engine] [--confirm-destructive]
 *   node scripts/pixel10a-drills.mjs interrupted-update  --serial S --ota /abs/ota.zip --ota-sha256 HEX --out /abs/new-dir [--method ...] [--interrupt reboot|kill] [--interrupt-after-seconds N]
 *   node scripts/pixel10a-drills.mjs compatible-rollback --serial S --ota /abs/ota.zip --ota-sha256 HEX --known-good-record /abs/release-record.json --out /abs/new-dir [--method ...]
 *   node scripts/pixel10a-drills.mjs stock-recovery      --serial S --factory-zip /abs/stallion-...-factory-....zip --alpha-image-zip /abs/img.zip --alpha-image-sha256 HEX --out /abs/new-dir --confirm-destructive
 *   node scripts/pixel10a-drills.mjs record --result /abs/a.json [--result ...] --out /abs/new-evidence.json
 *   node scripts/pixel10a-drills.mjs --apply-to-channel /abs/evidence.json
 *
 * Every drill hashes its inputs and checks the device before changing it, and records the
 * commands it ran, the device serial, the build fingerprint and A/B slot before, during and after,
 * and every failed check. A drill passes only from what the device reports after the actions ran.
 *
 * Mechanisms (A/B, Virtual A/B):
 * - `sideload` (default): `adb reboot sideload[-auto-reboot]` and `adb sideload OTA`. The device's
 *   own recovery verifies the package against its installed otacerts and its anti-downgrade
 *   timestamp, so this is the path a locked user release-keys build supports.
 * - `update-engine`: payload.bin and payload_properties.txt are extracted from the OTA, pushed to
 *   /data/ota_package and applied with `update_engine_client --update --follow`. It needs
 *   `adb root`, so it only works on userdebug builds.
 * - interrupted-update interrupts the apply (after N seconds: kill update_engine, or reboot), checks
 *   that the old slot still boots the old fingerprint, then reapplies and checks the new one.
 * - compatible-rollback applies the candidate OTA but never boots it: from the bootloader it sets
 *   the known-good slot active again (`fastboot --set-active`), so the device returns to the
 *   known-good build and Virtual A/B cancels the unmerged snapshot. With downgradeAllowed false
 *   there is no downgrade OTA, and after a merge the old slot is gone; returning to a known-good
 *   build after that is a new, higher-versioned release (roll forward), not this drill.
 * - stock-recovery flashes the stock factory image named in the channel (hash-checked),
 *   bootloader/radio first when they differ, with -w, checks the stock boot, then reflashes Alpha.
 *
 * Drill results are written to a new directory and never into the channel. `record` collects
 * results into new evidence JSON; `--apply-to-channel` updates the channel's drills and
 * recovery.knownGoodRelease only from evidence in which all four drills executed and passed on
 * one serial with fingerprints and slots. Every adb/fastboot command goes through the injectable
 * runner of scripts/pixel10a-flash.mjs. Nothing here passes a drill without running it.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { entries, entry, fileSha256, parseProperties, RECORD_KIND } from "./aosp-release-record.mjs";
import { Device, DEVICE, enterBootloader, fastbootChecks, inspectImageZip, newDirectory, parseArgs, regularFile, verifiedSha256, writeJson } from "./pixel10a-flash.mjs";

export const DRILLS = Object.freeze({ "signed-update": "signedUpdate", "interrupted-update": "interruptedUpdate", "compatible-rollback": "compatibleRollback", "stock-recovery": "stockRecovery" });
export const RESULT_KIND = "alpha-pixel10a-drill-result";
export const EVIDENCE_KIND = "alpha-pixel10a-drill-evidence";
export const DEFAULT_CHANNEL = "android/aosp/pixel10a-ota-channel.json";
export const REMOTE_PAYLOAD = "/data/ota_package/payload.bin";
export const ROLLBACK_MECHANISM = "pre-merge slot revert: apply the candidate OTA, never boot it, fastboot --set-active the known-good slot, boot it twice; Virtual A/B cancels the unmerged snapshot. No downgrade OTA (downgradeAllowed false).";
const HEX64 = /^[0-9a-f]{64}$/;
const SLOT = /^_[ab]$/;
const RELEASE_BUILD = /:user\/release-keys$/;
const HEADER = /^[A-Z_]+=[A-Za-z0-9+/=._-]*$/;
const MINUTE = 60_000;

/** Signed A/B OTA package identity: metadata, payload properties and refusals (no device contact). */
export function inspectOta(zip, { list = entries, read = entry } = {}) {
  const names = list(zip);
  const problems = [];
  const text = name => names.includes(name) ? read(zip, name).toString("utf8") : null;
  const rawMetadata = text("META-INF/com/android/metadata");
  const rawProperties = text("payload_properties.txt");
  if (rawMetadata === null) problems.push("--ota has no META-INF/com/android/metadata; it is not a signed OTA package");
  if (!names.includes("payload.bin")) problems.push("--ota has no payload.bin; it is not an A/B OTA");
  if (rawProperties === null) problems.push("--ota has no payload_properties.txt");
  const metadata = parseProperties(rawMetadata ?? "");
  const headers = String(rawProperties ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (rawMetadata !== null) {
    if (metadata["ota-type"] !== "AB") problems.push(`--ota ota-type is ${JSON.stringify(metadata["ota-type"])}, not AB`);
    if (!(metadata["pre-device"] ?? "").split("|").includes(DEVICE)) problems.push(`--ota pre-device is ${JSON.stringify(metadata["pre-device"])}, not ${DEVICE}`);
    if (!metadata["post-build"]) problems.push("--ota records no post-build fingerprint");
    if (metadata["ota-downgrade"] === "yes") problems.push("--ota is a downgrade package; the channel has downgradeAllowed false");
  }
  for (const line of headers) if (!HEADER.test(line)) problems.push(`payload_properties.txt line ${JSON.stringify(line)} is not KEY=VALUE`);
  return { metadata, headers, postBuild: metadata["post-build"] ?? null, wipe: metadata["ota-wipe"] === "yes", problems };
}

/** Whether this OTA can apply to the booted build (incremental source, anti-downgrade timestamp). */
export function otaPreconditionProblems(ota, before) {
  const problems = [];
  if (before.properties["ro.product.device"] !== DEVICE) problems.push(`device reports ro.product.device ${JSON.stringify(before.properties["ro.product.device"])}, not ${DEVICE}`);
  if (!SLOT.test(before.slot ?? "")) problems.push(`device reports no A/B slot (ro.boot.slot_suffix ${JSON.stringify(before.slot)})`);
  const pre = ota.metadata["pre-build"];
  if (pre && !pre.split("|").includes(before.fingerprint)) problems.push(`incremental --ota applies to ${pre}, but the device runs ${before.fingerprint}`);
  if (before.fingerprint === ota.postBuild) problems.push(`the device already runs the OTA's post-build ${ota.postBuild}`);
  const post = Number(ota.metadata["post-timestamp"]), now = Number(before.properties["ro.build.date.utc"]);
  if (Number.isFinite(post) && Number.isFinite(now) && post <= now) problems.push(`--ota post-timestamp ${post} is not newer than the device build ${now}; that is a downgrade`);
  return problems;
}

/** Extract one zip member to a file (payload.bin is several GB, so it streams to disk). */
export function extractMember(zip, member, destination) {
  const fd = fs.openSync(destination, "wx", 0o600);
  try {
    const out = spawnSync("unzip", ["-p", zip, member], { stdio: ["ignore", fd, "pipe"] });
    if (out.status !== 0) throw new Error(`unzip ${member} from ${zip} exited ${out.status}`);
  } finally { fs.closeSync(fd); }
  return destination;
}

/** Shell command for update_engine_client; headers are validated KEY=VALUE lines. */
export function updateEngineCommand({ sizeBytes, headers }) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error("payload.bin size is unknown");
  for (const line of headers) if (!HEADER.test(line)) throw new Error(`refusing payload header ${JSON.stringify(line)}`);
  return `update_engine_client --update --follow --payload=file://${REMOTE_PAYLOAD} --offset=0 --size=${sizeBytes} '--headers=${headers.join("\n")}'`;
}

/** Status of an update_engine_client --follow transcript. */
export function updateEngineProgress(text) {
  const output = String(text);
  const completed = /UPDATE_STATUS_UPDATED_NEED_REBOOT|onPayloadApplicationComplete\(ErrorCode::kSuccess/.test(output);
  const failed = /onPayloadApplicationComplete\(ErrorCode::k(?!Success)/.test(output);
  const values = [...output.matchAll(/UPDATE_STATUS_(?:DOWNLOADING|VERIFYING|FINALIZING)[^,]*,\s*([0-9.]+)\)/g)].map(match => Number(match[1]));
  return { completed, failed, progress: values.length ? values.at(-1) : null };
}

/** Status of an `adb sideload` transcript ("serving: 'ota.zip'  (~42%)"). */
export function sideloadProgress(result) {
  const values = [...`${result.stdout}\n${result.stderr}`.matchAll(/\(~\s*(\d+)%\)/g)].map(match => Number(match[1]));
  return { completed: result.status === 0 && !result.timedOut, progress: values.length ? values.at(-1) / 100 : null };
}

/** Extract payload.bin and payload_properties.txt once per drill. */
function extractPayload(otaFile, ota, dir, extract) {
  const local = extract(otaFile, "payload.bin", path.join(dir, "payload.bin"));
  return { local, sizeBytes: fs.statSync(local).size, headers: ota.headers };
}

/** `adb root` (userdebug only) and push the payload. */
function pushPayload(device, payload) {
  const root = device.adb(["root"], { timeoutMs: 30_000 });
  if (root.status !== 0 || /cannot run as root/i.test(`${root.stdout}${root.stderr}`)) throw new Error("--method update-engine needs adb root, which only a userdebug build allows; use --method sideload on user builds");
  device.waitForAdbState(["device"], MINUTE);
  device.must(device.adb(["push", payload.local, REMOTE_PAYLOAD], { timeoutMs: 30 * MINUTE }), "adb push payload.bin");
}

function applyWithUpdateEngine(device, payload, timeoutMs) {
  pushPayload(device, payload);
  const out = device.adb(["shell", updateEngineCommand(payload)], { timeoutMs });
  return { ...updateEngineProgress(`${out.stdout}\n${out.stderr}`), timedOut: out.timedOut === true, status: out.status };
}

function applyWithSideload(device, otaFile, { autoReboot, timeoutMs }) {
  device.must(device.adb(["reboot", autoReboot ? "sideload-auto-reboot" : "sideload"]), "adb reboot sideload");
  device.waitForAdbState(["sideload"], 5 * MINUTE);
  const out = device.adb(["sideload", otaFile], { timeoutMs });
  return { ...sideloadProgress(out), timedOut: out.timedOut === true, status: out.status };
}

function startResult(drill, device, fields) {
  return { schema: 1, kind: RESULT_KIND, drill, serial: device.serial, startedAt: new Date(device.now()).toISOString(), finishedAt: null, executed: false, passed: false, ...fields, problems: [], commands: device.log };
}

function finish(result, out, device) {
  result.finishedAt = new Date(device.now()).toISOString();
  result.passed = result.executed && result.problems.length === 0;
  writeJson(path.join(out, `${result.drill}.json`), result);
  return result;
}

const check = (result, ok, message) => { if (!ok) result.problems.push(message); };
const methodOf = value => {
  const method = value ?? "sideload";
  if (!["sideload", "update-engine"].includes(method)) throw new Error("--method must be sideload or update-engine");
  return method;
};

/** Verified OTA plus a booted, compatible device: everything a drill checks before it changes anything. */
async function prepareOta(options, deps) {
  const device = new Device(options.serial, { adb: options.adb, fastboot: options.fastboot, ...deps });
  const method = methodOf(options.method);
  const otaSha256 = await verifiedSha256(options.ota, options.otaSha256, "--ota");
  const ota = inspectOta(options.ota, deps);
  if (ota.problems.length) throw new Error(`refused: ${ota.problems.join("; ")}`);
  if (ota.wipe && !options.confirmDestructive) throw new Error("--ota wipes user data (ota-wipe=yes); pass --confirm-destructive");
  if (device.adbState() !== "device") throw new Error(`${options.serial} is not booted with adb authorized; drills start from a booted device`);
  const before = device.snapshot();
  const problems = otaPreconditionProblems(ota, before);
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  return { method, otaSha256, ota, device, before };
}

function bootedSnapshot(device, timeoutMs = 20 * MINUTE) {
  device.waitForBoot(timeoutMs);
  return device.snapshot();
}

/** A signed OTA applies through the device's own verification and the new slot boots the new build, twice. */
export async function signedUpdate(options, deps = {}) {
  const { method, otaSha256, ota, device, before } = await prepareOta(options, deps);
  const out = newDirectory(options.out);
  const result = startResult("signedUpdate", device, { method, ota: { file: path.basename(options.ota), sha256: otaSha256, postBuild: ota.postBuild, preBuild: ota.metadata["pre-build"] ?? null }, before, after: null, persisted: null });
  try {
    result.executed = true;
    if (method === "sideload") {
      result.apply = applyWithSideload(device, options.ota, { autoReboot: true, timeoutMs: 60 * MINUTE });
    } else {
      result.apply = applyWithUpdateEngine(device, extractPayload(options.ota, ota, out, deps.extract ?? extractMember), 90 * MINUTE);
      check(result, result.apply.completed, "update_engine did not report UPDATED_NEED_REBOOT");
      device.must(device.adb(["reboot"]), "adb reboot");
    }
    result.after = bootedSnapshot(device);
    check(result, result.after.fingerprint === ota.postBuild, `after the update the device runs ${result.after.fingerprint}, not ${ota.postBuild}`);
    check(result, result.after.slot !== before.slot, `the device still boots slot ${before.slot}; the update did not switch slots`);
    device.must(device.adb(["reboot"]), "adb reboot");
    result.persisted = bootedSnapshot(device);
    check(result, result.persisted.fingerprint === ota.postBuild && result.persisted.slot === result.after.slot, "the updated slot did not survive a second reboot");
  } catch (error) { result.problems.push(String(error.message)); }
  return finish(result, out, device);
}

/** An interrupted apply leaves the old slot bootable on the old build; reapplying then succeeds. */
export async function interruptedUpdate(options, deps = {}) {
  const interrupt = options.interrupt ?? "reboot";
  if (!["reboot", "kill"].includes(interrupt)) throw new Error("--interrupt must be reboot or kill");
  if (interrupt === "kill" && methodOf(options.method) !== "update-engine") throw new Error("--interrupt kill stops update_engine and needs --method update-engine");
  const afterSeconds = Number(options.interruptAfterSeconds ?? 30);
  if (!Number.isFinite(afterSeconds) || afterSeconds < 1) throw new Error("--interrupt-after-seconds must be a positive number");
  const { method, otaSha256, ota, device, before } = await prepareOta(options, deps);
  const out = newDirectory(options.out);
  const result = startResult("interruptedUpdate", device, { method, interrupt, interruptAfterSeconds: afterSeconds, ota: { file: path.basename(options.ota), sha256: otaSha256, postBuild: ota.postBuild }, before, interrupted: null, after: null });
  try {
    result.executed = true;
    const payload = method === "update-engine" ? extractPayload(options.ota, ota, out, deps.extract ?? extractMember) : null;
    result.firstApply = payload ? applyWithUpdateEngine(device, payload, afterSeconds * 1000) : applyWithSideload(device, options.ota, { autoReboot: false, timeoutMs: afterSeconds * 1000 });
    check(result, result.firstApply.timedOut && !result.firstApply.completed, "the first apply finished before the interruption; lower --interrupt-after-seconds");
    if (interrupt === "kill") device.must(device.adb(["shell", "kill -9 $(pidof update_engine)"]), "kill update_engine");
    if (device.adb(["reboot"]).status !== 0) device.say("adb could not reboot the device from recovery; select \"Reboot system now\" on the device.");
    result.interrupted = bootedSnapshot(device);
    check(result, result.interrupted.fingerprint === before.fingerprint, `after the interruption the device runs ${result.interrupted.fingerprint}, not the old ${before.fingerprint}`);
    check(result, result.interrupted.slot === before.slot, `after the interruption the device boots ${result.interrupted.slot}, not the old slot ${before.slot}`);
    if (payload) {
      result.resume = applyWithUpdateEngine(device, payload, 90 * MINUTE);
      check(result, result.resume.completed, "the reapplied update did not report UPDATED_NEED_REBOOT");
      device.must(device.adb(["reboot"]), "adb reboot");
    } else result.resume = applyWithSideload(device, options.ota, { autoReboot: true, timeoutMs: 60 * MINUTE });
    result.after = bootedSnapshot(device);
    check(result, result.after.fingerprint === ota.postBuild, `after reapplying the device runs ${result.after.fingerprint}, not ${ota.postBuild}`);
    check(result, result.after.slot !== before.slot, "after reapplying the device did not switch slots");
  } catch (error) { result.problems.push(String(error.message)); }
  return finish(result, out, device);
}

/** The known-good release record (scripts/aosp-release-record.mjs output) this rollback returns to. */
export function knownGoodRelease(file) {
  regularFile(file, "--known-good-record");
  let record;
  try { record = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`--known-good-record ${file} is not JSON`); }
  const problems = [];
  if (record.kind !== RECORD_KIND) problems.push(`--known-good-record is not a ${RECORD_KIND} record`);
  if (!record.build?.fingerprint) problems.push("--known-good-record has no build.fingerprint");
  if (!HEX64.test(record.artifacts?.ota?.sha256 ?? "")) problems.push("--known-good-record has no artifacts.ota.sha256");
  if (record.problems?.length) problems.push(`--known-good-record lists problems: ${record.problems.join("; ")}`);
  if (problems.length) throw new Error(`refused: ${problems.join("; ")}`);
  return { buildFingerprint: record.build.fingerprint, otaSha256: record.artifacts.ota.sha256, recordFile: file };
}

/** From the known-good build, stage the candidate OTA, revert to the known-good slot before it ever boots, and stay there. */
export async function compatibleRollback(options, deps = {}) {
  const knownGood = knownGoodRelease(options.knownGoodRecord);
  const { method, otaSha256, ota, device, before } = await prepareOta(options, deps);
  if (before.fingerprint !== knownGood.buildFingerprint) throw new Error(`refused: the device runs ${before.fingerprint}, not the known-good ${knownGood.buildFingerprint}; flash or update to it first`);
  const out = newDirectory(options.out);
  const result = startResult("compatibleRollback", device, { method, mechanism: ROLLBACK_MECHANISM, knownGood, candidate: { file: path.basename(options.ota), sha256: otaSha256, postBuild: ota.postBuild }, before, staged: null, after: null, persisted: null });
  const knownSlot = before.slot.slice(1);
  try {
    result.executed = true;
    if (method === "update-engine") {
      result.apply = applyWithUpdateEngine(device, extractPayload(options.ota, ota, out, deps.extract ?? extractMember), 90 * MINUTE);
      check(result, result.apply.completed, "update_engine did not report UPDATED_NEED_REBOOT");
      device.must(device.adb(["reboot", "bootloader"]), "adb reboot bootloader");
    } else {
      result.apply = applyWithSideload(device, options.ota, { autoReboot: false, timeoutMs: 60 * MINUTE });
      if (device.adb(["reboot", "bootloader"]).status !== 0) device.say("Select \"Reboot to bootloader\" in recovery on the device (do not boot the new slot).");
    }
    device.waitForFastboot(30 * MINUTE);
    result.staged = { currentSlot: device.getvar("current-slot") };
    check(result, result.staged.currentSlot && result.staged.currentSlot !== knownSlot, `the candidate update did not stage the other slot (current-slot ${JSON.stringify(result.staged.currentSlot)})`);
    device.must(device.fastboot([`--set-active=${knownSlot}`]), "fastboot --set-active");
    result.staged.revertedSlot = device.getvar("current-slot");
    check(result, result.staged.revertedSlot === knownSlot, `fastboot did not make slot ${knownSlot} active`);
    device.must(device.fastboot(["reboot"]), "fastboot reboot");
    result.after = bootedSnapshot(device);
    check(result, result.after.fingerprint === knownGood.buildFingerprint, `after rollback the device runs ${result.after.fingerprint}, not the known-good ${knownGood.buildFingerprint}`);
    check(result, result.after.slot === before.slot, `after rollback the device boots ${result.after.slot}, not the known-good slot ${before.slot}`);
    device.must(device.adb(["reboot"]), "adb reboot");
    result.persisted = bootedSnapshot(device);
    check(result, result.persisted.fingerprint === knownGood.buildFingerprint && result.persisted.slot === before.slot, "the known-good slot did not survive a second reboot");
  } catch (error) { result.problems.push(String(error.message)); }
  return finish(result, out, device);
}

/** The flashable parts of a Google factory archive: one top directory with bootloader, radio and image zip. */
export function factoryMembers(names) {
  const top = [...new Set(names.map(name => name.split("/")[0]))];
  const one = pattern => names.filter(name => pattern.test(name));
  const bootloader = one(/^[^/]+\/bootloader-[^/]+\.img$/), radio = one(/^[^/]+\/radio-[^/]+\.img$/), image = one(/^[^/]+\/image-[^/]+\.zip$/);
  if (top.length !== 1 || bootloader.length !== 1 || radio.length !== 1 || image.length !== 1) throw new Error("--factory-zip is not one factory directory with exactly one bootloader, radio and image zip");
  const buildId = /^[a-z0-9]+-([a-z0-9]+\.[0-9]+\.[0-9]+)$/i.exec(top[0])?.[1]?.toUpperCase() ?? null;
  return { top: top[0], buildId, bootloader: bootloader[0], radio: radio[0], image: image[0],
    bootloaderVersion: /bootloader-[a-z0-9]+-(.+)\.img$/i.exec(bootloader[0])?.[1] ?? null, basebandVersion: /radio-[a-z0-9]+-(.+)\.img$/i.exec(radio[0])?.[1] ?? null };
}

/** Flash the stock factory image (wipes), check the stock boot, then reflash Alpha (wipes). */
export async function stockRecovery(options, deps = {}) {
  if (!options.confirmDestructive) throw new Error("stock-recovery wipes the device twice; pass --confirm-destructive");
  const device = new Device(options.serial, { adb: options.adb, fastboot: options.fastboot, ...deps });
  const channel = options.channel;
  const stock = channel?.recovery?.stockFactoryImage;
  if (!stock || !HEX64.test(stock.sha256 ?? "")) throw new Error("the channel has no recovery.stockFactoryImage SHA-256");
  regularFile(options.factoryZip, "--factory-zip");
  if (path.basename(options.factoryZip) !== stock.filename) throw new Error(`--factory-zip must be the channel's ${stock.filename}`);
  const factorySha256 = await verifiedSha256(options.factoryZip, stock.sha256, "--factory-zip");
  const factory = factoryMembers((deps.list ?? entries)(options.factoryZip));
  const alphaSha256 = await verifiedSha256(options.alphaImageZip, options.alphaImageSha256, "--alpha-image-zip");
  const alpha = inspectImageZip(options.alphaImageZip, deps);
  if (alpha.problems.length) throw new Error(`refused: ${alpha.problems.join("; ")}`);
  if (device.adbState() !== "device") throw new Error(`${options.serial} is not booted with adb authorized; stock-recovery starts from booted Alpha`);
  const before = device.snapshot();
  if (before.properties["ro.product.device"] !== DEVICE) throw new Error(`refused: device is ${JSON.stringify(before.properties["ro.product.device"])}, not ${DEVICE}`);
  if (!SLOT.test(before.slot ?? "")) throw new Error("refused: the device reports no A/B slot");
  const out = newDirectory(options.out);
  const work = path.join(out, "stock");
  fs.mkdirSync(work);
  const result = startResult("stockRecovery", device, { factory: { file: stock.filename, sha256: factorySha256, buildId: factory.buildId, bootloaderVersion: factory.bootloaderVersion, basebandVersion: factory.basebandVersion },
    alphaImage: { file: path.basename(options.alphaImageZip), sha256: alphaSha256 }, before, firmwareFlashed: [], stock: null, after: null });
  const extract = deps.extract ?? extractMember;
  try {
    const local = Object.fromEntries(["bootloader", "radio", "image"].map(part => [part, extract(options.factoryZip, factory[part], path.join(work, path.basename(factory[part])))]));
    result.factory.members = Object.fromEntries(await Promise.all(Object.entries(local).map(async ([part, file]) => [part, { file: path.basename(file), sha256: await fileSha256(file) }])));
    result.executed = true;
    enterBootloader(device);
    const checks = fastbootChecks(device);
    result.fastbootBefore = checks.vars;
    if (checks.problems.length) throw new Error(checks.problems.join("; "));
    for (const [part, variable, version] of [["bootloader", "version-bootloader", factory.bootloaderVersion], ["radio", "version-baseband", factory.basebandVersion]]) {
      if (String(device.getvar(variable)).toLowerCase() === String(version).toLowerCase()) continue;
      device.must(device.fastboot(["flash", part, local[part]], { timeoutMs: 10 * MINUTE }), `fastboot flash ${part}`);
      device.must(device.fastboot(["reboot-bootloader"]), "fastboot reboot-bootloader");
      device.waitForFastboot();
      result.firmwareFlashed.push(part);
    }
    device.must(device.fastboot(["-w", "--skip-reboot", "update", local.image], { timeoutMs: 60 * MINUTE }), "fastboot -w update (stock)");
    device.must(device.fastboot(["reboot"]), "fastboot reboot");
    device.say("Stock Android was wiped. Finish setup, enable Developer options and USB debugging, and authorize this computer.");
    result.stock = bootedSnapshot(device, 60 * MINUTE);
    check(result, String(result.stock.fingerprint).startsWith(`google/${DEVICE}/${DEVICE}:`) && String(result.stock.fingerprint).includes(`/${factory.buildId}/`), `the stock boot runs ${result.stock.fingerprint}, not Google ${factory.buildId}`);
    check(result, /\/release-keys$/.test(result.stock.fingerprint ?? ""), "the stock boot is not a release-keys build");
    enterBootloader(device);
    const alphaChecks = fastbootChecks(device, alpha.requires);
    if (alphaChecks.problems.length) throw new Error(alphaChecks.problems.join("; "));
    device.must(device.fastboot(["-w", "--skip-reboot", "update", options.alphaImageZip], { timeoutMs: 60 * MINUTE }), "fastboot -w update (Alpha)");
    device.must(device.fastboot(["reboot"]), "fastboot reboot");
    device.say("Alpha was reflashed and wiped. If the build disables USB debugging, finish setup and enable it again.");
    result.after = bootedSnapshot(device, 60 * MINUTE);
    check(result, String(result.after.fingerprint).includes("/alpha_stallion_phone/"), `the reflashed device runs ${result.after.fingerprint}, not alpha_stallion_phone`);
  } catch (error) { result.problems.push(String(error.message)); }
  finally { fs.rmSync(work, { recursive: true, force: true }); }
  return finish(result, out, device);
}

/** Collect drill results into new evidence. Partial evidence is recorded and reported, never applied. */
export async function recordEvidence({ results, channelFile = DEFAULT_CHANNEL, channel }) {
  if (!results.length) throw new Error("record needs at least one --result FILE");
  const drills = {};
  for (const file of results) {
    const result = JSON.parse(fs.readFileSync(regularFile(file, "--result"), "utf8"));
    if (result.kind !== RESULT_KIND || !Object.values(DRILLS).includes(result.drill)) throw new Error(`--result ${file} is not a drill result`);
    if (drills[result.drill]) throw new Error(`--result ${file} repeats the ${result.drill} drill`);
    drills[result.drill] = { ...result, resultFile: path.basename(file), resultSha256: await fileSha256(file) };
  }
  const missing = Object.values(DRILLS).filter(name => !drills[name]);
  return {
    schema: 1, kind: EVIDENCE_KIND, createdAt: new Date().toISOString(), product: channel.product, device: channel.device,
    channel: { file: channelFile, channel: channel.channel, otaCertificateSha256: channel.otaCertificateSha256, avbPublicKeySha256: channel.avbPublicKeySha256, stockFactoryImageSha256: channel.recovery?.stockFactoryImage?.sha256 ?? null },
    serials: [...new Set(Object.values(drills).map(result => result.serial))],
    drills, missing,
    knownGoodRelease: drills.compatibleRollback?.knownGood ?? null,
  };
}

const deviceState = (result, key) => result?.[key] && typeof result[key].fingerprint === "string" && SLOT.test(result[key].slot ?? "");

/** Every reason this evidence cannot set the channel's drills to passed. */
export function evidenceProblems(evidence, channel) {
  const problems = [];
  if (evidence?.kind !== EVIDENCE_KIND || evidence.schema !== 1) return ["the file is not drill evidence from scripts/pixel10a-drills.mjs record"];
  if (evidence.product !== channel.product || evidence.device !== channel.device) problems.push("the evidence is for a different product or device");
  for (const field of ["otaCertificateSha256", "avbPublicKeySha256"]) {
    if (!HEX64.test(channel[field] ?? "")) problems.push(`the channel's ${field} is unset; drills qualify only a reviewed signing identity`);
    else if (evidence.channel?.[field] !== channel[field]) problems.push(`the evidence was recorded for a different ${field}`);
  }
  if (evidence.channel?.stockFactoryImageSha256 !== channel.recovery?.stockFactoryImage?.sha256) problems.push("the evidence was recorded for a different stock factory image");
  const serials = new Set();
  for (const name of Object.values(DRILLS)) {
    const result = evidence.drills?.[name];
    if (!result) { problems.push(`${name}: missing (partial evidence)`); continue; }
    if (result.kind !== RESULT_KIND || result.drill !== name) problems.push(`${name}: not a ${name} drill result`);
    if (result.executed !== true) problems.push(`${name}: not executed`);
    if (result.passed !== true) problems.push(`${name}: not passed`);
    if (result.problems?.length) problems.push(`${name}: recorded problems: ${result.problems.join("; ")}`);
    if (typeof result.serial !== "string" || !/^[A-Za-z0-9._-]+$/.test(result.serial)) problems.push(`${name}: no device serial`);
    else serials.add(result.serial);
    for (const key of ["before", "after"]) if (!deviceState(result, key)) problems.push(`${name}: no ${key} fingerprint and slot`);
    for (const key of ["before", "after"]) if (deviceState(result, key) && !RELEASE_BUILD.test(result[key].fingerprint)) problems.push(`${name}: ${key} build ${result[key].fingerprint} is not a user release-keys build`);
  }
  if (serials.size > 1) problems.push(`the drills ran on different devices (${[...serials].join(", ")})`);
  const { signedUpdate: signed, interruptedUpdate: interrupted, compatibleRollback: rollback, stockRecovery: stock } = evidence.drills ?? {};
  if (deviceState(signed, "after")) {
    if (signed.after.fingerprint !== signed.ota?.postBuild) problems.push("signedUpdate: the after fingerprint is not the OTA post-build");
    if (signed.after.slot === signed.before?.slot) problems.push("signedUpdate: the slot did not change");
  }
  if (interrupted) {
    if (!deviceState(interrupted, "interrupted") || interrupted.interrupted.fingerprint !== interrupted.before?.fingerprint || interrupted.interrupted.slot !== interrupted.before?.slot)
      problems.push("interruptedUpdate: no record that the old slot booted the old build after the interruption");
    if (interrupted.after?.fingerprint !== interrupted.ota?.postBuild) problems.push("interruptedUpdate: the after fingerprint is not the OTA post-build");
  }
  if (rollback) {
    if (rollback.after?.fingerprint !== rollback.knownGood?.buildFingerprint || rollback.after?.slot !== rollback.before?.slot) problems.push("compatibleRollback: the device did not return to the known-good build and slot");
  }
  if (stock) {
    if (!deviceState(stock, "stock") || !stock.stock.fingerprint.startsWith(`google/${DEVICE}/${DEVICE}:`)) problems.push("stockRecovery: no stock boot fingerprint and slot");
    if (stock.factory?.sha256 !== channel.recovery?.stockFactoryImage?.sha256) problems.push("stockRecovery: the factory image is not the channel's stockFactoryImage");
  }
  const known = evidence.knownGoodRelease;
  if (!known?.buildFingerprint || !HEX64.test(known.otaSha256 ?? "") || !known.recordFile) problems.push("the evidence has no known-good release (fingerprint, OTA SHA-256 and record file)");
  else if (known.buildFingerprint !== rollback?.knownGood?.buildFingerprint) problems.push("the known-good release is not the one the rollback drill returned to");
  return problems;
}

/** Set the channel's drills to passed and its known-good release, only from complete passing evidence. */
export async function applyToChannel({ evidenceFile, channelFile = DEFAULT_CHANNEL, root = process.cwd() }) {
  const evidence = JSON.parse(fs.readFileSync(regularFile(path.resolve(evidenceFile), "--apply-to-channel"), "utf8"));
  const channel = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  const problems = evidenceProblems(evidence, channel);
  if (problems.length) throw new Error(`refused to apply drill evidence:\n- ${problems.join("\n- ")}`);
  const relative = file => { const rel = path.relative(root, path.resolve(file)); return rel.startsWith("..") ? path.resolve(file) : rel; };
  const updated = {
    ...channel,
    recovery: { ...channel.recovery, knownGoodRelease: { buildFingerprint: evidence.knownGoodRelease.buildFingerprint, otaSha256: evidence.knownGoodRelease.otaSha256, recordFile: relative(evidence.knownGoodRelease.recordFile) } },
    drills: Object.fromEntries(Object.values(DRILLS).map(name => [name, "passed"])),
    drillEvidence: { file: relative(evidenceFile), sha256: await fileSha256(path.resolve(evidenceFile)), serial: evidence.serials[0] },
  };
  const temporary = `${channelFile}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(updated, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temporary, channelFile);
  return updated;
}

const DRILL_VALUES = ["--serial", "--ota", "--ota-sha256", "--out", "--method", "--adb", "--fastboot", "--interrupt", "--interrupt-after-seconds", "--known-good-record",
  "--factory-zip", "--alpha-image-zip", "--alpha-image-sha256", "--channel"];

async function main(args) {
  const [command, ...rest] = args;
  if (command === "--apply-to-channel") {
    const values = parseArgs(rest.slice(1), { values: ["--channel"], booleans: [] });
    if (!rest[0]) throw new Error("--apply-to-channel EVIDENCE.json [--channel FILE]");
    const updated = await applyToChannel({ evidenceFile: rest[0], channelFile: values["--channel"] ?? DEFAULT_CHANNEL });
    console.log(JSON.stringify({ drills: updated.drills, knownGoodRelease: updated.recovery.knownGoodRelease, drillEvidence: updated.drillEvidence }, null, 2));
    return;
  }
  if (command === "record") {
    const results = [], other = [];
    for (let i = 0; i < rest.length; i++) rest[i] === "--result" ? results.push(rest[++i]) : other.push(rest[i]);
    const values = parseArgs(other, { values: ["--out", "--channel"], booleans: [] });
    if (!values["--out"] || !path.isAbsolute(values["--out"])) throw new Error("record needs --out /absolute/new-evidence.json");
    const channelFile = values["--channel"] ?? DEFAULT_CHANNEL;
    const evidence = await recordEvidence({ results, channelFile, channel: JSON.parse(fs.readFileSync(channelFile, "utf8")) });
    writeJson(values["--out"], evidence);
    const problems = evidenceProblems(evidence, JSON.parse(fs.readFileSync(channelFile, "utf8")));
    console.log(problems.length ? `Recorded ${values["--out"]}; NOT APPLICABLE to the channel:\n- ${problems.join("\n- ")}` : `Recorded ${values["--out"]}; all four drills passed. Apply with --apply-to-channel.`);
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (!Object.hasOwn(DRILLS, command)) throw new Error(`Use one of ${Object.keys(DRILLS).join(", ")}, record, or --apply-to-channel`);
  const values = parseArgs(rest, { values: DRILL_VALUES, booleans: ["--confirm-destructive"] });
  const options = { serial: values["--serial"], ota: values["--ota"], otaSha256: values["--ota-sha256"], out: values["--out"], method: values["--method"], adb: values["--adb"], fastboot: values["--fastboot"],
    interrupt: values["--interrupt"], interruptAfterSeconds: values["--interrupt-after-seconds"], knownGoodRecord: values["--known-good-record"], factoryZip: values["--factory-zip"],
    alphaImageZip: values["--alpha-image-zip"], alphaImageSha256: values["--alpha-image-sha256"], confirmDestructive: values["--confirm-destructive"] === true,
    channel: JSON.parse(fs.readFileSync(values["--channel"] ?? DEFAULT_CHANNEL, "utf8")) };
  const run = { "signed-update": signedUpdate, "interrupted-update": interruptedUpdate, "compatible-rollback": compatibleRollback, "stock-recovery": stockRecovery }[command];
  const result = await run(options);
  console.log(JSON.stringify({ ...result, commands: undefined }, null, 2));
  console.log(result.passed ? `${result.drill}: passed on ${result.serial}` : `${result.drill}: FAILED on ${result.serial}`);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`pixel10a-drills: ${error.message}`); process.exitCode = 2; }
}
