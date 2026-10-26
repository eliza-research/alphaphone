#!/usr/bin/env node
/**
 * Release pipeline for one alpha_stallion_phone (Pixel 10a) image (issues #399, #400, #377).
 * Runs on the self-hosted image runner inside the GitHub `release` environment, which supplies
 * the ALPHA_KEY_* secrets (scripts/release-keys.mjs):
 *
 *   node scripts/aosp-release-pipeline.mjs --out /abs/new-pipeline-dir \
 *     ( --build-record /abs/build/build-result.json
 *     | --aosp-source /abs/stallion-source --factory-image /abs/factory.zip [--jobs N] [--min-free-gib 12] ) \
 *     [--keys-base /dev/shm] [--apk-manifest /abs/apk-manifest.json] [--apksigner /abs/apksigner] \
 *     [--map-key SOURCE=NAME ...] [--incremental-from /abs/previous-signed-target_files.zip]
 *
 * Phases, each recorded in --out/pipeline.json with its exact command and exit status:
 *   build        (only with --aosp-source) scripts/aosp-build-image.mjs --variant production --out OUT/build
 *   build-record read the production build record; refuse an unbuilt, development or incomplete one
 *   keys         scripts/release-keys.mjs materialize --out <keys-base>/alpha-release-keys-<unique> (tmpfs only)
 *   sign         scripts/sign-aosp-release.mjs with the recorded target-files SHA-256 -> OUT/release
 *   image        <releasetools>/img_from_target_files on the signed target-files -> OUT/release/signed-img.zip
 *   verify       read-only checks of the signed outputs (verifySignedRelease) -> OUT/signed-verification.json
 *   keys-cleanup always: the materialized key directory is removed, even when a phase fails
 *
 * A passed pipeline is signed build output only. It is never an image boot, a flash, an applied
 * update, a rollback or recovery drill, release qualification or device acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PIXEL10A_PRODUCT } from "./aosp-pixel10a.mjs";
import { BUILD_RECORD_KIND, REQUIRED_RELEASETOOLS, targetFilesFingerprints } from "./aosp-build-image.mjs";
import { RECORD_KIND, certificateSha256, entries, entry, fileSha256, parseProperties } from "./aosp-release-record.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PIPELINE_KIND = "alpha-aosp-release-pipeline";
const HEX64 = /^[0-9a-f]{64}$/;
const TMPFS_MAGIC = 0x01021994;
const RAMFS_MAGIC = 0x858458f6;

/** Fields of the AVB vbmeta header (libavb AvbVBMetaImageHeader, big-endian, 256 bytes). */
export function vbmetaPublicKey(bytes) {
  if (bytes.length < 256 || bytes.subarray(0, 4).toString("latin1") !== "AVB0") return null;
  const u64 = at => Number(bytes.readBigUInt64BE(at));
  const authSize = u64(12), auxSize = u64(20), keyOffset = u64(64), keySize = u64(72);
  const start = 256 + authSize + keyOffset;
  if (keyOffset + keySize > auxSize || start + keySize > bytes.length) return null;
  return bytes.subarray(start, start + keySize);
}

function entrySha256(zip, name) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const child = spawn("unzip", ["-p", zip, name], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", chunk => hash.update(chunk));
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(hash.digest("hex")) : reject(new Error(`unzip ${name} from ${zip} exited ${code}`)));
  });
}
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/**
 * Read-only checks of the signed outputs in `releaseDir` (sign-aosp-release.mjs plus the signed
 * img zip) against the build record, the product descriptor and the channel. Never reads a
 * private key; `releasetools` provides avbtool. Returns { problems, checks }.
 */
export async function verifySignedRelease({ releaseDir, buildRecord, product, channel, releasetools, workDir, runTool = spawnSync }) {
  const problems = [], checks = {};
  const file = name => path.join(releaseDir, name);
  const files = { record: file("release-record.json"), signed: file("signed-target_files.zip"), ota: file("ota.zip"), pkmd: file("avb_pkmd.bin"), image: file("signed-img.zip") };
  for (const [name, at] of Object.entries(files)) {
    if (!fs.existsSync(at) || fs.lstatSync(at).isSymbolicLink() || !fs.statSync(at).isFile()) problems.push(`${path.basename(at)} (${name}) is missing or not a regular file`);
  }
  if (problems.length) return { problems, checks };
  let record;
  try { record = JSON.parse(fs.readFileSync(files.record, "utf8")); } catch (error) { return { problems: [`release-record.json is unreadable: ${error.message}`], checks }; }
  if (record.kind !== RECORD_KIND) problems.push(`release-record.json is not a ${RECORD_KIND} record`);
  if (!Array.isArray(record.problems) || record.problems.length) problems.push("release-record.json lists problems");
  for (const flag of ["imageBooted", "signedUpdateApplied", "releaseQualified", "deviceAcceptanceVerified"]) if (record[flag] !== false) problems.push(`release-record.json ${flag} must be false`);
  const unsigned = buildRecord?.artifacts?.targetFiles?.sha256;
  if (record.inputs?.unsignedTargetFilesSha256 !== unsigned) problems.push("release-record.json was not signed from the build record's target-files");
  const [signedSha, otaSha, imageSha] = await Promise.all([fileSha256(files.signed), fileSha256(files.ota), fileSha256(files.image)]);
  Object.assign(checks, { signedSha256: signedSha, otaSha256: otaSha, imageSha256: imageSha });
  if (record.artifacts?.signedTargetFiles?.sha256 !== signedSha) problems.push("signed-target_files.zip differs from release-record.json");
  if (record.artifacts?.ota?.sha256 !== otaSha) problems.push("ota.zip differs from release-record.json");

  // Verified boot: the release AVB public key is the reviewed one and is embedded in every vbmeta.
  const pkmd = fs.readFileSync(files.pkmd);
  checks.avbPublicKeySha256 = sha256(pkmd);
  if (checks.avbPublicKeySha256 !== product?.avb?.publicKeySha256) problems.push("avb_pkmd.bin is not the product's avb.publicKeySha256");
  if (checks.avbPublicKeySha256 !== channel?.avbPublicKeySha256) problems.push("avb_pkmd.bin is not the channel's avbPublicKeySha256");
  if (record.verifiedBoot?.publicKeySha256 !== checks.avbPublicKeySha256) problems.push("release-record.json records a different AVB public key");
  const signedNames = entries(files.signed);
  const vbmetas = signedNames.filter(name => /^IMAGES\/vbmeta[a-z0-9_]*\.img$/.test(name));
  if (!vbmetas.includes("IMAGES/vbmeta.img")) problems.push("the signed target-files has no IMAGES/vbmeta.img");
  checks.vbmeta = {};
  for (const name of vbmetas) {
    const bytes = entry(files.signed, name), partition = path.posix.basename(name, ".img");
    const key = vbmetaPublicKey(bytes);
    checks.vbmeta[partition] = { sha256: sha256(bytes), releaseKey: Boolean(key && key.equals(pkmd)) };
    if (!key) problems.push(`${name} is not a signed AVB vbmeta image`);
    else if (!key.equals(pkmd)) problems.push(`${name} is not signed with the release AVB key`);
    const recorded = record.verifiedBoot?.images?.[partition];
    if (recorded && recorded !== checks.vbmeta[partition].sha256) problems.push(`${name} differs from release-record.json`);
  }
  // avbtool checks every signature and hash descriptor, following the chained partitions.
  const avbtool = path.join(releasetools ?? "", "avbtool");
  if (!releasetools || !fs.existsSync(avbtool)) problems.push(`no avbtool in ${releasetools}; AVB signatures were not verified`);
  else {
    const work = fs.mkdtempSync(path.join(workDir, "avb-"));
    try {
      const unzip = runTool("unzip", ["-q", files.signed, "IMAGES/*.img", "-d", work], { stdio: ["ignore", "ignore", "pipe"] });
      if (unzip.status !== 0) problems.push("the signed images could not be extracted for avbtool");
      else {
        const out = runTool(avbtool, ["verify_image", "--image", path.join(work, "IMAGES/vbmeta.img"), "--follow_chain_partitions"], { encoding: "utf8", maxBuffer: 16 << 20 });
        checks.avbtool = { status: out.status, log: String(out.stdout ?? "").slice(-4000) };
        if (out.status !== 0 || !/Successfully verified/.test(String(out.stdout ?? ""))) problems.push(`avbtool verify_image failed: ${String(out.stderr ?? "").trim().slice(0, 400)}`);
      }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }

  // Release fingerprints: the build's own fingerprint with release-keys, in every partition.
  const expected = String(buildRecord?.fingerprint ?? "").replace(/\/test-keys$/, "/release-keys");
  const fingerprints = targetFilesFingerprints(files.signed);
  checks.fingerprint = fingerprints.fingerprint;
  if (!expected.endsWith("/release-keys")) problems.push("the build record has no fingerprint to compare");
  else if (fingerprints.fingerprint !== expected) problems.push(`signed fingerprint ${fingerprints.fingerprint} is not ${expected}`);
  for (const [partition, value] of Object.entries(fingerprints.partitions)) if (value && !value.endsWith("/release-keys")) problems.push(`${partition} fingerprint ${value} does not carry release-keys`);
  if (fingerprints.buildTags !== "release-keys") problems.push(`ro.build.tags is ${fingerprints.buildTags}, not release-keys`);
  if (fingerprints.buildType !== "user") problems.push(`ro.build.type is ${fingerprints.buildType}, not user`);

  // The OTA: release OTA certificate, A/B, and the signed fingerprint.
  const otaNames = entries(files.ota);
  if (!otaNames.includes("META-INF/com/android/otacert")) problems.push("ota.zip has no META-INF/com/android/otacert");
  else {
    try { checks.otaCertificateSha256 = certificateSha256(entry(files.ota, "META-INF/com/android/otacert")); } catch { checks.otaCertificateSha256 = null; }
    if (checks.otaCertificateSha256 !== channel?.otaCertificateSha256) problems.push("ota.zip otacert is not the channel's otaCertificateSha256");
  }
  const metadata = otaNames.includes("META-INF/com/android/metadata") ? parseProperties(entry(files.ota, "META-INF/com/android/metadata").toString("utf8")) : {};
  if (metadata["ota-type"] !== "AB") problems.push(`ota.zip ota-type is ${metadata["ota-type"]}, not AB`);
  if (metadata["post-build"] !== fingerprints.fingerprint) problems.push(`ota.zip post-build ${metadata["post-build"]} is not the signed fingerprint`);
  if (metadata["pre-device"] && metadata["pre-device"] !== product?.device?.codename) problems.push(`ota.zip pre-device ${metadata["pre-device"]} is not ${product?.device?.codename}`);

  // The flashable image zip: flat, the unsigned build's flash instructions, only signed or unchanged firmware images.
  const unsignedImage = buildRecord?.artifacts?.image?.file;
  if (!unsignedImage || !fs.existsSync(unsignedImage)) problems.push("the build record's unsigned img zip is missing");
  else if (await fileSha256(unsignedImage) !== buildRecord.artifacts.image.sha256) problems.push(`${unsignedImage} differs from the build record (rebuilt since?)`);
  else {
    const names = entries(files.image), unsignedNames = new Set(entries(unsignedImage));
    if (new Set(names).size !== names.length) problems.push("signed-img.zip has duplicate entries");
    for (const name of names) if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") problems.push(`signed-img.zip entry ${name} is not flat`);
    for (const name of ["android-info.txt", "fastboot-info.txt"]) {
      if (!names.includes(name)) problems.push(`signed-img.zip has no ${name}`);
      else if (!unsignedNames.has(name) || !entry(files.image, name).equals(entry(unsignedImage, name))) problems.push(`signed-img.zip ${name} differs from the unsigned build`);
    }
    const signedSet = new Set(signedNames);
    checks.images = {};
    for (const name of names.filter(item => item.endsWith(".img"))) {
      const value = await entrySha256(files.image, name);
      checks.images[name] = value;
      if (signedSet.has(`IMAGES/${name}`)) { if (value !== await entrySha256(files.signed, `IMAGES/${name}`)) problems.push(`signed-img.zip ${name} differs from the signed target-files`); }
      else if (signedSet.has(`RADIO/${name}`) && unsignedNames.has(name)) { if (value !== await entrySha256(unsignedImage, name)) problems.push(`signed-img.zip firmware ${name} differs from the unsigned build`); }
      else problems.push(`signed-img.zip ${name} is neither a signed image nor unchanged firmware`);
    }
    for (const name of vbmetas) if (!names.includes(path.posix.basename(name))) problems.push(`signed-img.zip has no ${path.posix.basename(name)}`);
    const unexpected = names.filter(name => !name.endsWith(".img") && !["android-info.txt", "fastboot-info.txt"].includes(name));
    if (unexpected.length) problems.push(`signed-img.zip has unexpected entries: ${unexpected.join(", ")}`);
  }
  return { problems, checks };
}

/** Problems with a build record as the input to release signing. */
export function buildRecordProblems(record) {
  const problems = [];
  if (record?.kind !== BUILD_RECORD_KIND) return [`not a ${BUILD_RECORD_KIND} record`];
  if (record.variant !== "production" || !/-user$/.test(record.lunch ?? "")) problems.push(`release signing takes a production user build, not ${record.variant} (${record.lunch})`);
  if (record.imageBuilt !== true || record.exitCode !== 0 || (record.problems ?? []).length) problems.push("the build record is not a successful image build");
  for (const name of ["targetFiles", "image", "otatools"]) {
    const artifact = record.artifacts?.[name];
    if (!artifact?.file || !HEX64.test(artifact.sha256 ?? "")) problems.push(`the build record has no ${name} artifact and SHA-256`);
    else if (!fs.existsSync(artifact.file)) problems.push(`${artifact.file} no longer exists`);
  }
  if (!record.releasetools || !fs.existsSync(record.releasetools)) problems.push("the build record has no unpacked releasetools");
  else for (const name of REQUIRED_RELEASETOOLS) {
    try { fs.accessSync(path.join(record.releasetools, name), fs.constants.X_OK); } catch { problems.push(`${record.releasetools} lacks an executable ${name}`); }
  }
  if (!record.fingerprint) problems.push("the build record has no build fingerprint");
  return problems;
}

export function parsePipelineArgs(args) {
  const names = { "--out": "out", "--build-record": "buildRecord", "--aosp-source": "source", "--factory-image": "factory", "--jobs": "jobs", "--min-free-gib": "minFreeGib",
    "--keys-base": "keysBase", "--apk-manifest": "apkManifest", "--apksigner": "apksigner", "--incremental-from": "incrementalFrom" };
  const usage = "Use --out NEW_DIR (--build-record FILE | --aosp-source DIR --factory-image ZIP [--jobs N] [--min-free-gib N]) [--keys-base /dev/shm] [--apk-manifest FILE] [--apksigner FILE] [--map-key SOURCE=NAME ...] [--incremental-from ZIP]";
  const options = { mapKeys: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--map-key") {
      const value = args[i + 1] ?? "";
      if (value.indexOf("=") <= 0 || value.startsWith("--")) throw new Error(usage);
      options.mapKeys.push(value);
      i++;
      continue;
    }
    const key = names[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith("--") || options[key] !== undefined) throw new Error(usage);
    options[key] = args[++i];
  }
  if (!options.out) throw new Error(usage);
  if (Boolean(options.buildRecord) === Boolean(options.source)) throw new Error(`Give exactly one of --build-record and --aosp-source. ${usage}`);
  if (options.source && !options.factory) throw new Error("--aosp-source needs --factory-image");
  if (options.buildRecord && (options.factory || options.jobs || options.minFreeGib)) throw new Error("--factory-image, --jobs and --min-free-gib apply only with --aosp-source");
  return options;
}

/** The exact command of each subprocess phase. */
export function pipelineCommands({ root = ROOT, node = process.execPath, options, buildRecord, keysDir }) {
  const out = path.resolve(options.out);
  const release = path.join(out, "release");
  const commands = {};
  if (options.source) commands.build = [node, path.join(root, "scripts/aosp-build-image.mjs"), "--aosp-source", options.source, "--factory-image", options.factory, "--variant", "production",
    "--out", path.join(out, "build"), ...(options.jobs ? ["--jobs", String(options.jobs)] : []), ...(options.minFreeGib ? ["--min-free-gib", String(options.minFreeGib)] : [])];
  commands.keys = [node, path.join(root, "scripts/release-keys.mjs"), "materialize", "--out", keysDir];
  if (buildRecord) {
    commands.sign = [node, path.join(root, "scripts/sign-aosp-release.mjs"), "--target-files", buildRecord.artifacts.targetFiles.file, "--target-files-sha256", buildRecord.artifacts.targetFiles.sha256,
      "--keys-dir", keysDir, "--releasetools", buildRecord.releasetools, "--out", release,
      ...(options.apksigner ? ["--apksigner", options.apksigner] : []), ...(options.apkManifest ? ["--apk-manifest", options.apkManifest] : []),
      ...options.mapKeys.flatMap(value => ["--map-key", value]), ...(options.incrementalFrom ? ["--incremental-from", options.incrementalFrom] : [])];
    commands.image = [path.join(buildRecord.releasetools, "img_from_target_files"), "-p", path.dirname(buildRecord.releasetools), path.join(release, "signed-target_files.zip"), path.join(release, "signed-img.zip")];
  }
  return { out, release, commands };
}

function defaultRun(argv, { env }) {
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "inherit", "inherit"], env });
    child.on("error", error => resolve({ code: null, signal: null, error: error.message }));
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

function defaultIsTmpfs(dir) {
  const type = Number(fs.statfsSync(dir).type);
  return type === TMPFS_MAGIC || type === RAMFS_MAGIC;
}

/**
 * Run the pipeline. `deps.run(argv, {env, phase})` runs one subprocess phase and resolves
 * {code, signal}; `deps.verify` replaces verifySignedRelease; `deps.isTmpfs` the tmpfs probe.
 * The key directory is removed in `finally` whatever happens.
 */
export async function runPipeline(options, deps = {}) {
  const root = options.root ?? ROOT;
  const run = deps.run ?? defaultRun;
  const verify = deps.verify ?? verifySignedRelease;
  const isTmpfs = deps.isTmpfs ?? defaultIsTmpfs;
  const now = deps.now ?? (() => new Date().toISOString());
  const keysBase = path.resolve(options.keysBase ?? "/dev/shm");
  const out = path.resolve(options.out);
  if (fs.existsSync(out)) throw new Error(`--out ${out} already exists`);
  if (!fs.existsSync(keysBase) || !fs.statSync(keysBase).isDirectory()) throw new Error(`--keys-base ${keysBase} is not a directory`);
  if (!isTmpfs(keysBase)) throw new Error(`--keys-base ${keysBase} is not a tmpfs; release keys are only materialized in memory`);
  fs.mkdirSync(out, { mode: 0o755 });
  const keysDir = path.join(keysBase, `alpha-release-keys-${process.pid}-${randomBytes(8).toString("hex")}`);
  const pipeline = { schema: 1, kind: PIPELINE_KIND, startedAt: now(), out, keysDir, phases: [], passed: false,
    imageSigned: false, imageBooted: false, imageFlashed: false, signedUpdateApplied: false, releaseQualified: false, deviceAcceptanceVerified: false };
  const env = deps.env ?? process.env;
  const phase = async (name, body) => {
    const entry = { name, startedAt: now(), status: null };
    pipeline.phases.push(entry);
    try {
      const result = await body(entry);
      entry.status = result.code === 0 ? "passed" : "failed";
      entry.exitCode = result.code;
      if (result.signal) entry.signal = result.signal;
      if (result.error) entry.error = result.error;
    } catch (error) {
      entry.status = "failed";
      entry.exitCode = null;
      entry.error = error.message;
    }
    entry.finishedAt = now();
    return entry.status === "passed";
  };
  const subprocess = (name, argv) => phase(name, async entry => { entry.command = argv; return run(argv, { env, phase: name }); });
  const removeKeys = () => fs.rmSync(keysDir, { recursive: true, force: true });
  const onSignal = signal => { removeKeys(); process.exit(signal === "SIGINT" ? 130 : 143); };
  if (deps.handleSignals !== false) for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, onSignal);
  let buildRecord = null;
  try {
    let ok = true;
    const initial = pipelineCommands({ root, options, keysDir });
    let recordFile = options.buildRecord ? path.resolve(options.buildRecord) : path.join(out, "build", "build-result.json");
    if (initial.commands.build) ok = await subprocess("build", initial.commands.build);
    if (ok) ok = await phase("build-record", async entry => {
      entry.file = recordFile;
      buildRecord = JSON.parse(fs.readFileSync(recordFile, "utf8"));
      entry.sha256 = await fileSha256(recordFile);
      const problems = buildRecordProblems(buildRecord);
      if (problems.length) entry.problems = problems;
      return { code: problems.length ? 1 : 0 };
    });
    if (!ok) buildRecord = null;
    const { release, commands } = pipelineCommands({ root, options, buildRecord, keysDir });
    if (ok) ok = await subprocess("keys", commands.keys);
    if (ok) ok = await subprocess("sign", commands.sign);
    if (ok) ok = await phase("image", async entry => {
      entry.command = commands.image;
      return run(commands.image, { env: { ...env, PATH: `${buildRecord.releasetools}${path.delimiter}${env.PATH ?? ""}` }, phase: "image" });
    });
    if (ok) ok = await phase("verify", async entry => {
      const product = JSON.parse(fs.readFileSync(path.join(root, PIXEL10A_PRODUCT), "utf8"));
      const channel = JSON.parse(fs.readFileSync(path.join(root, product.ota.channel), "utf8"));
      const result = await verify({ releaseDir: release, buildRecord, product, channel, releasetools: buildRecord.releasetools, workDir: out });
      const report = { schema: 1, kind: "alpha-aosp-signed-verification", checkedAt: now(), releaseDir: release, ...result, passed: result.problems.length === 0,
        imageBooted: false, imageFlashed: false, releaseQualified: false, deviceAcceptanceVerified: false };
      fs.writeFileSync(path.join(out, "signed-verification.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
      entry.report = path.join(out, "signed-verification.json");
      if (result.problems.length) entry.problems = result.problems;
      return { code: result.problems.length ? 1 : 0 };
    });
    pipeline.passed = ok;
    pipeline.imageSigned = ok;
  } finally {
    await phase("keys-cleanup", async entry => {
      removeKeys();
      entry.removed = !fs.existsSync(keysDir);
      return { code: entry.removed ? 0 : 1 };
    });
    if (deps.handleSignals !== false) for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, onSignal);
    if (pipeline.phases.at(-1).status !== "passed") { pipeline.passed = false; pipeline.imageSigned = false; }
    pipeline.finishedAt = now();
    fs.writeFileSync(path.join(out, "pipeline.json"), `${JSON.stringify(pipeline, null, 2)}\n`, { flag: "wx" });
  }
  return { pipeline, recordFile: path.join(out, "pipeline.json") };
}

async function main(args) {
  const { pipeline, recordFile } = await runPipeline(parsePipelineArgs(args));
  for (const entry of pipeline.phases) console.log(`${entry.name}: ${entry.status}${entry.exitCode === undefined ? "" : ` (exit ${entry.exitCode}${entry.signal ? `, ${entry.signal}` : ""})`}`);
  console.log(`Pipeline record: ${recordFile}`);
  if (pipeline.passed) console.log("Signed release outputs verified. This is not an image boot, a flash, an applied update, a drill or release qualification.");
  process.exitCode = pipeline.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`aosp-release-pipeline: ${error.message}`); process.exitCode = 2; }
}
