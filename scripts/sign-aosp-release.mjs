/**
 * Release-sign an alpha_stallion_phone target-files zip and build its OTA (issue #400).
 *
 * Runs on the Linux image host, after the production image build, with AOSP releasetools
 * (otatools `bin/`) and a decrypted release key directory supplied at runtime:
 *
 *   node scripts/sign-aosp-release.mjs \
 *     --target-files /abs/unsigned-target_files.zip --target-files-sha256 <hex from the build record> \
 *     --keys-dir /dev/shm/keys --releasetools /abs/otatools/bin --out /abs/new-release-dir \
 *     [--apksigner /abs/apksigner] [--map-key SOURCE=NAME ...] [--apk-manifest /abs/apk-manifest.json]
 *     [--incremental-from /abs/previous-signed-target_files.zip] [--dry-run]
 *
 * It follows the upstream key layout and signing job (vendor/eliza/packages/os/android/signing).
 * Before anything runs it reads the unsigned target-files' META/misc_info.txt, apkcerts.txt and
 * apexkeys.txt, and refuses an APK certificate it does not map to a release key, a chained AVB
 * partition without its own key mapping, or a missing APEX key. It then runs
 * `sign_target_files_apks -o -d KEYS` (plus -k for bluetooth, nfc and --map-key sources,
 * --extra_apex_payload_key/--extra_apks for every non-presigned APEX, and the `avb` key for vbmeta
 * and each chained partition), verifies with apksigner that every non-presigned APK and APEX in the
 * signed target-files carries a release certificate and every APEX the release payload key, and
 * only then runs `ota_from_target_files -k KEYS/releasekey` and writes release-record.json
 * (scripts/aosp-release-record.mjs) and the public avb_pkmd.bin for avb_custom_key enrollment.
 *
 * Keys never come from the repository: the key directory must be outside every Git working tree
 * and private to its owner. Private keys are only passed by path to the releasetools; this script
 * reads public certificates and avb_pkmd.bin to compare them with the reviewed digests in
 * android/aosp/pixel10a-product.json and android/aosp/pixel10a-ota-channel.json, and refuses on
 * any UNSET or mismatching value. --dry-run prints the plan and every problem and runs nothing.
 * A signed output is not an image boot, an applied update, a rollback or recovery drill, or
 * release qualification.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PIXEL10A_PRODUCT, pixel10aProductProblems, placeholderFields } from "./aosp-pixel10a.mjs";
import { chainedPartitionsFromMiscInfo, compatibilityRecord, entries, entry, fileSha256, incrementalSource, keyCertificates, parseProperties, parseQuotedRows, writeRecord } from "./aosp-release-record.mjs";

/** x509/pk8 keys sign_target_files_apks maps by default name (upstream key-manifest.json). */
export const X509_KEYS = Object.freeze(["releasekey", "platform", "shared", "media", "networkstack", "sdk_sandbox", "bluetooth", "nfc"]);
export const RELEASETOOLS = Object.freeze(["sign_target_files_apks", "ota_from_target_files"]);
/** AOSP development keys `-d KEYS` remaps to the same-named release key (releasekey for testkey and devkey). */
export const DEFAULT_KEY_MAP = Object.freeze({ testkey: "releasekey", devkey: "releasekey", platform: "platform", shared: "shared", media: "media", networkstack: "networkstack", sdk_sandbox: "sdk_sandbox" });
/** Development keys `-d` does not remap; passed explicitly with -k. */
export const EXPLICIT_KEYS = Object.freeze(["bluetooth", "nfc"]);
const DEV_KEY_DIRS = Object.freeze(["build/make/target/product/security", "build/target/product/security"]);
/** One APEX container key pair and one APEX payload key (upstream key-manifest.json). */
export const APEX_KEYS = Object.freeze({ container: "apex", payload: "apex_payload" });
const KEY_NAME = /^[a-z][a-z0-9_]*$/;
const PRESIGNED = new Set(["PRESIGNED", "EXTERNAL"]);
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Channel fields that must be reviewed before signing. A first release has no known-good predecessor, and drills follow signing. */
export function channelSigningProblems(channel, product, file = "android/aosp/pixel10a-ota-channel.json") {
  if (!channel || typeof channel !== "object") return [`${file} is missing or unreadable`];
  const problems = [];
  const { recovery, drills, ...signing } = channel;
  const { knownGoodRelease, ...stock } = recovery ?? {};
  for (const field of [...placeholderFields(signing), ...placeholderFields(stock).map(name => `recovery.${name}`)]) problems.push(`${file}: ${field} is unset or a placeholder`);
  if (channel.schema !== 1) problems.push(`${file}: schema must be 1`);
  if (channel.product !== product?.product || channel.device !== product?.device?.codename) problems.push(`${file}: channel is not for ${product?.product ?? "the product"} on ${product?.device?.codename ?? "its device"}`);
  if (!HEX64.test(channel.otaCertificateSha256 ?? "")) problems.push(`${file}: otaCertificateSha256 must be a SHA-256`);
  if (!HEX64.test(channel.avbPublicKeySha256 ?? "")) problems.push(`${file}: avbPublicKeySha256 must be a SHA-256`);
  else if (channel.avbPublicKeySha256 !== product?.avb?.publicKeySha256) problems.push(`${file}: avbPublicKeySha256 is not the product's avb.publicKeySha256`);
  if (channel.downgradeAllowed !== false) problems.push(`${file}: downgradeAllowed must be false`);
  if (!HEX64.test(recovery?.stockFactoryImage?.sha256 ?? "")) problems.push(`${file}: recovery.stockFactoryImage.sha256 must be a SHA-256`);
  return problems;
}

/**
 * Problems with distributing a signed release on the channel: a retained known-good recovery
 * release and passed signed-update, interruption, rollback and stock-recovery drills. These are
 * recorded from executed drills; nothing in this repository runs them.
 */
export function channelDistributionProblems(channel, file = "android/aosp/pixel10a-ota-channel.json") {
  const problems = [];
  const recovery = channel?.recovery?.knownGoodRelease;
  for (const field of ["buildFingerprint", "otaSha256", "recordFile"]) {
    const value = recovery?.[field];
    if (typeof value !== "string" || !value.trim() || placeholderFields(value).length)
      problems.push(`${file}: recovery.knownGoodRelease.${field} is unset`);
    else if (field === "otaSha256" && !HEX64.test(value))
      problems.push(`${file}: recovery.knownGoodRelease.otaSha256 must be a SHA-256`);
  }
  const drills = new Set(["signedUpdate", "interruptedUpdate", "compatibleRollback", "stockRecovery", ...Object.keys(channel?.drills ?? {})]);
  for (const drill of drills) {
    const result = channel?.drills?.[drill];
    if (result !== "passed") problems.push(`${file}: ${drill} drill is ${JSON.stringify(result)}, not passed`);
  }
  return problems;
}

/** Refuse unless git positively says the directory is outside any repository; a missing or failing git is not proof. */
export function gitWorkTreeProblem(dir, run = spawnSync) {
  const out = run("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (out.error || out.status === null) return "--keys-dir could not be confirmed to be outside a Git working tree (git did not run)";
  if (out.status === 0) return "--keys-dir is inside a Git working tree; release keys never enter a working tree";
  if (!/not a git repository/i.test(String(out.stderr ?? ""))) return "--keys-dir could not be confirmed to be outside a Git working tree";
  return null;
}

/** True when `child` is `parent` or inside it (a sibling named `..keys` is not). */
export function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

/** The source key (path without .x509.pem) an apkcerts/apexkeys row names, or null when presigned. */
function sourceKey(certificate) {
  if (!certificate || PRESIGNED.has(certificate)) return null;
  return certificate.replace(/\.x509\.pem$/, "");
}

/** Release key name for a development key source, from the default -d map, the explicit -k keys and --map-key. */
export function releaseKeyFor(source, keyMap = {}) {
  if (Object.hasOwn(keyMap, source)) return keyMap[source];
  const dir = path.posix.dirname(source), base = path.posix.basename(source);
  if (DEV_KEY_DIRS.includes(dir) && Object.hasOwn(DEFAULT_KEY_MAP, base)) return DEFAULT_KEY_MAP[base];
  if (DEV_KEY_DIRS.includes(dir) && EXPLICIT_KEYS.includes(base)) return base;
  return null;
}

/** Signing-relevant metadata of a target-files zip (read with unzip; no image bytes). */
export function inspectTargetFiles(zip) {
  const names = new Set(entries(zip));
  const read = name => names.has(name) ? entry(zip, name).toString("utf8") : null;
  const misc = read("META/misc_info.txt");
  const miscInfo = misc === null ? null : parseProperties(misc);
  const apkcerts = parseQuotedRows(read("META/apkcerts.txt") ?? "");
  const apexkeys = parseQuotedRows(read("META/apexkeys.txt") ?? "");
  // apkcerts.txt lists every APK module the build knows (CTS and test APKs included); only the
  // APKs packaged in the target-files are re-signed, so only those need a release key mapping.
  const packagedApks = new Set([...names].filter(name => !name.startsWith("META/") && name.endsWith(".apk")).map(name => path.posix.basename(name)));
  return { miscInfo, apkcerts, apexkeys, packagedApks, hasApkcerts: names.has("META/apkcerts.txt"), chainedPartitions: miscInfo ? chainedPartitionsFromMiscInfo(miscInfo) : [] };
}

/** APEXes the job re-signs (neither payload nor container presigned). */
function signedApexes(apexkeys) {
  return apexkeys.filter(row => row.name && !PRESIGNED.has(row.private_key) && !PRESIGNED.has(row.container_private_key));
}

/** Every key file the job passes to the releasetools, for these target-files. */
export function requiredKeyFiles({ product, keyMap = {}, inspection = null }) {
  const names = new Set([...Object.values(DEFAULT_KEY_MAP), ...EXPLICIT_KEYS, "releasekey", ...Object.values(keyMap)]);
  const files = [...names].flatMap(name => [`${name}.pk8`, `${name}.x509.pem`]);
  files.push(product?.avb?.vbmetaKey ?? "avb.pem", product?.avb?.publicKeyMetadata ?? "avb_pkmd.bin");
  if (inspection && signedApexes(inspection.apexkeys).length)
    files.push(`${APEX_KEYS.container}.pk8`, `${APEX_KEYS.container}.x509.pem`, `${APEX_KEYS.payload}.pem`, `${APEX_KEYS.payload}.avbpubkey`);
  return [...new Set(files)];
}

/** Pre-sign target-files problems: AVB chaining against the product's key mapping, and unmapped APK or APEX keys. */
export function targetFilesProblems(inspection, { product, keyMap = {} }) {
  const problems = [];
  if (!inspection.miscInfo) return ["--target-files has no META/misc_info.txt; its AVB chaining cannot be checked"];
  if (inspection.miscInfo.avb_enable !== "true") problems.push("--target-files was built without AVB (avb_enable is not true)");
  const mapped = new Set(product?.avb?.chainedPartitions ?? []);
  for (const partition of inspection.chainedPartitions)
    if (!mapped.has(partition)) problems.push(`chained AVB partition ${partition} has no mapped --avb_${partition}_key (add it to avb.chainedPartitions in ${PIXEL10A_PRODUCT})`);
  for (const partition of mapped)
    if (!inspection.chainedPartitions.includes(partition)) problems.push(`${PIXEL10A_PRODUCT} maps --avb_${partition}_key, but the target-files does not chain ${partition}`);
  if (!inspection.hasApkcerts) problems.push("--target-files has no META/apkcerts.txt; its APK certificates cannot be checked");
  for (const row of inspection.apkcerts) {
    if (inspection.packagedApks && !inspection.packagedApks.has(row.name)) continue;
    if (row.certificate === "EXTERNAL") { problems.push(`APK ${row.name} is EXTERNAL; externally signed APKs are not supported by this job`); continue; }
    const source = sourceKey(row.certificate);
    if (source && !releaseKeyFor(source, keyMap)) problems.push(`APK ${row.name} is signed with ${row.certificate}, which no release key mapping covers (use --map-key ${source}=NAME)`);
  }
  for (const row of inspection.apexkeys)
    if (PRESIGNED.has(row.private_key) !== PRESIGNED.has(row.container_private_key)) problems.push(`APEX ${row.name} is only partly presigned (payload ${row.private_key}, container ${row.container_private_key})`);
  return problems;
}

/** Runtime key directory checks: location, permissions, every required file and public digests. Never opens a private key. */
export function keyDirectoryProblems(keysDir, { product, channel, root = process.cwd(), keyMap = {}, inspection = null, runGit } = {}) {
  if (!keysDir) return ["--keys-dir is required: the decrypted release key directory, supplied at signing time"];
  if (!path.isAbsolute(keysDir)) return ["--keys-dir must be an absolute path"];
  if (!fs.existsSync(keysDir) || !fs.statSync(keysDir).isDirectory()) return [`--keys-dir ${keysDir} is not a directory`];
  const problems = [];
  const real = fs.realpathSync(keysDir), repo = fs.realpathSync(root);
  if (isWithin(repo, real)) problems.push("--keys-dir is inside this repository; release keys never enter a working tree");
  const git = gitWorkTreeProblem(real, runGit);
  if (git) problems.push(git);
  if (fs.statSync(real).mode & 0o077) problems.push("--keys-dir must not be readable or writable by group or others (mode 0700)");
  const missing = [];
  for (const name of requiredKeyFiles({ product, keyMap, inspection })) {
    let stat;
    try { stat = fs.lstatSync(path.join(real, name)); } catch { missing.push(name); continue; }
    if (stat.isSymbolicLink()) problems.push(`--keys-dir ${name} is a symbolic link; key files must be regular files in the key directory`);
    else if (!stat.isFile()) problems.push(`--keys-dir ${name} is not a regular file`);
    else if (stat.mode & 0o077) problems.push(`--keys-dir ${name} must not be readable or writable by group or others (mode 0600)`);
  }
  if (missing.length) problems.push(`--keys-dir lacks ${missing.join(", ")} (decrypt the release key bundle first; .enc files are not read)`);
  const certs = keyCertificates(real, ["platform", "releasekey"]);
  if (certs.platform && certs.platform !== product?.signer?.platformCertificateSha256) problems.push(`platform.x509.pem is ${certs.platform}, not the product's signer.platformCertificateSha256`);
  if (certs.releasekey && certs.releasekey !== channel?.otaCertificateSha256) problems.push(`releasekey.x509.pem is ${certs.releasekey}, not the channel's otaCertificateSha256`);
  // Every other certificate the job signs with is pinned too, so no public AOSP test key (shared,
  // media, networkstack, ...) can be signed into the image under a release name.
  const pinned = product?.signer?.releaseCertificates ?? {};
  const others = [...new Set([...Object.values(DEFAULT_KEY_MAP), ...EXPLICIT_KEYS, ...Object.values(keyMap),
    ...(inspection && signedApexes(inspection.apexkeys).length ? [APEX_KEYS.container] : [])])].filter(name => !["platform", "releasekey"].includes(name));
  const other = keyCertificates(real, others);
  for (const name of others) {
    if (!/^[0-9a-f]{64}$/.test(pinned[name] ?? "")) problems.push(`${PIXEL10A_PRODUCT} signer.releaseCertificates.${name} must be the reviewed certificate SHA-256`);
    else if (other[name] && other[name] !== pinned[name]) problems.push(`${name}.x509.pem is ${other[name]}, not the product's signer.releaseCertificates.${name}`);
  }
  const pkmd = path.join(real, product?.avb?.publicKeyMetadata ?? "avb_pkmd.bin");
  if (fs.existsSync(pkmd) && !fs.lstatSync(pkmd).isSymbolicLink() && sha256(fs.readFileSync(pkmd)) !== product?.avb?.publicKeySha256) problems.push(`${path.basename(pkmd)} is not the product's avb.publicKeySha256`);
  return problems;
}

/**
 * The exact releasetools invocations. `keysDir` must already be the key directory's realpath.
 * Key paths are arguments only; their contents are never read here.
 */
export function signingCommands({ targetFiles, keysDir, releasetools, out, product, incrementalFrom = null, keyMap = {}, inspection = { apexkeys: [] } }) {
  const keys = keysDir, tools = path.resolve(releasetools);
  const algorithm = product.avb.algorithm, avbKey = path.join(keys, product.avb.vbmetaKey);
  const signed = path.join(out, "signed-target_files.zip"), ota = path.join(out, incrementalFrom ? "incremental-ota.zip" : "ota.zip");
  const explicit = [...EXPLICIT_KEYS.map(name => [`${DEV_KEY_DIRS[0]}/${name}`, name]), ...Object.entries(keyMap)]
    .flatMap(([source, name]) => ["-k", `${source}=${path.join(keys, name)}`]);
  const apex = signedApexes(inspection.apexkeys).flatMap(row => ["--extra_apex_payload_key", `${row.name}=${path.join(keys, `${APEX_KEYS.payload}.pem`)}`, "--extra_apks", `${row.name}=${path.join(keys, APEX_KEYS.container)}`]);
  const avb = ["--avb_vbmeta_key", avbKey, "--avb_vbmeta_algorithm", algorithm,
    ...product.avb.chainedPartitions.flatMap(partition => [`--avb_${partition}_key`, avbKey, `--avb_${partition}_algorithm`, algorithm])];
  return {
    signed, ota,
    commands: [
      { tool: path.join(tools, "sign_target_files_apks"), args: ["-p", path.dirname(tools), "-o", "-d", keys, ...explicit, ...apex, ...avb, path.resolve(targetFiles), signed] },
      { tool: path.join(tools, "ota_from_target_files"), args: ["-p", path.dirname(tools), "-k", path.join(keys, "releasekey"), ...(incrementalFrom ? ["-i", path.resolve(incrementalFrom)] : []), signed, ota] },
    ],
  };
}

/** Certificate SHA-256 digests apksigner reports for one APK or APEX. */
function signerDigests(apksigner, file) {
  const out = spawnSync(apksigner, ["verify", "--print-certs", file], { encoding: "utf8", maxBuffer: 16 << 20 });
  if (out.status !== 0) return null;
  return [...out.stdout.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/g)].map(match => match[1].toLowerCase());
}

/**
 * After sign_target_files_apks and before any OTA: every APK and APEX in the signed target-files
 * that is not presigned must be signed only by a release certificate from the key directory, and
 * every re-signed APEX must carry the release payload public key. A remaining test or development
 * certificate (or any unknown one) is refused.
 */
export function signedTargetFilesProblems({ signed, keysDir, apksigner, keyMap = {} }) {
  const problems = [];
  const releaseNames = [...new Set([...Object.values(DEFAULT_KEY_MAP), ...EXPLICIT_KEYS, "releasekey", ...Object.values(keyMap), APEX_KEYS.container])];
  const release = new Set(Object.values(keyCertificates(keysDir, releaseNames)).filter(value => /^[0-9a-f]{64}$/.test(value ?? "")));
  const inspection = inspectTargetFiles(signed);
  const presigned = new Set([...inspection.apkcerts.filter(row => !sourceKey(row.certificate)).map(row => row.name),
    ...inspection.apexkeys.filter(row => PRESIGNED.has(row.private_key)).map(row => row.name)]);
  const listed = new Set([...inspection.apkcerts, ...inspection.apexkeys].map(row => row.name));
  for (const row of inspection.apkcerts) {
    const source = sourceKey(row.certificate);
    if (source && !isWithin(keysDir, path.resolve(path.dirname(source)))) problems.push(`signed apkcerts.txt still names ${row.certificate} for ${row.name}`);
  }
  const payload = fs.existsSync(path.join(keysDir, `${APEX_KEYS.payload}.avbpubkey`)) ? fs.readFileSync(path.join(keysDir, `${APEX_KEYS.payload}.avbpubkey`)) : null;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-signed-check-"));
  try {
    for (const name of entries(signed).filter(item => /\.(apk|apex)$/.test(item))) {
      const base = path.posix.basename(name);
      if (presigned.has(base)) continue;
      if (!listed.has(base)) { problems.push(`${name} is in neither apkcerts.txt nor apexkeys.txt`); continue; }
      const file = path.join(work, "package");
      fs.writeFileSync(file, entry(signed, name));
      const digests = signerDigests(apksigner, file);
      if (!digests || !digests.length) problems.push(`${name}: apksigner could not verify its signature`);
      else for (const digest of digests) if (!release.has(digest)) problems.push(`${name} is signed with ${digest}, which is not a release certificate (test or development key remains)`);
      if (base.endsWith(".apex")) {
        let key = null;
        try { key = execFileSync("unzip", ["-p", file, "apex_pubkey"], { maxBuffer: 1 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { key = null; }
        if (!key || !payload || !key.equals(payload)) problems.push(`${name} does not carry the release APEX payload key`);
      }
      fs.rmSync(file);
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  return problems;
}

function apksignerPath(options) {
  if (options.apksigner) return options.apksigner;
  return options.releasetools ? path.join(options.releasetools, "apksigner") : null;
}

/** Every reason the signing job would refuse, without running anything. */
export async function signingProblems({ root = process.cwd(), targetFiles, targetFilesSha256, keysDir, releasetools, apksigner, out, incrementalFrom, product, channel, keyMap = {}, runGit }) {
  const problems = [...pixel10aProductProblems(root)];
  if (!HEX64.test(product?.avb?.publicKeySha256 ?? "")) problems.push(`${PIXEL10A_PRODUCT}: avb.publicKeySha256 must be a SHA-256`);
  if (!/^SHA(256|512)_RSA(4096|8192)$/.test(product?.avb?.algorithm ?? "")) problems.push(`${PIXEL10A_PRODUCT}: avb.algorithm must be an RSA-4096/8192 AVB algorithm`);
  if (!Array.isArray(product?.avb?.chainedPartitions)) problems.push(`${PIXEL10A_PRODUCT}: avb.chainedPartitions must list the chained vbmeta partitions`);
  problems.push(...channelSigningProblems(channel, product, product?.ota?.channel));
  for (const [source, name] of Object.entries(keyMap)) if (!KEY_NAME.test(name) || !source || source.includes("=")) problems.push(`--map-key ${source}=${name} must map a source key path to a key name`);
  let inspection = null;
  if (!targetFiles || !fs.existsSync(targetFiles) || !fs.statSync(targetFiles).isFile()) problems.push("--target-files must name the unsigned target-files zip");
  else {
    if (!HEX64.test(targetFilesSha256 ?? "")) problems.push("--target-files-sha256 must be the SHA-256 from the image build record");
    else if (await fileSha256(targetFiles) !== targetFilesSha256) problems.push("--target-files differs from --target-files-sha256");
    try { inspection = inspectTargetFiles(targetFiles); } catch (error) { problems.push(`--target-files could not be read: ${error.message}`); }
    if (inspection) problems.push(...targetFilesProblems(inspection, { product, keyMap }));
  }
  if (incrementalFrom && !fs.existsSync(incrementalFrom)) problems.push("--incremental-from must name the previous signed target-files zip");
  if (!releasetools) problems.push("--releasetools is required: the otatools bin directory");
  else for (const name of RELEASETOOLS) {
    try { fs.accessSync(path.join(releasetools, name), fs.constants.X_OK); } catch { problems.push(`--releasetools lacks an executable ${name}`); }
  }
  const verifier = apksignerPath({ apksigner, releasetools });
  try { fs.accessSync(verifier ?? "", fs.constants.X_OK); } catch { problems.push("an executable apksigner is required to verify the signed target-files (--apksigner, or apksigner in --releasetools)"); }
  if (!out) problems.push("--out is required: a new output directory");
  else if (fs.existsSync(out)) problems.push(`--out ${out} already exists`);
  problems.push(...keyDirectoryProblems(keysDir, { product, channel, root, keyMap, inspection, runGit }));
  return { problems: [...new Set(problems)], inspection };
}

export async function signRelease(options) {
  const root = options.root ?? process.cwd();
  const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  const product = read(PIXEL10A_PRODUCT);
  let channel = null;
  try { channel = read(product.ota?.channel); } catch { channel = null; }
  const keyMap = options.keyMap ?? {};
  const { problems, inspection } = await signingProblems({ ...options, root, product, channel, keyMap });
  const keysDir = options.keysDir && path.isAbsolute(options.keysDir) && fs.existsSync(options.keysDir) ? fs.realpathSync(options.keysDir) : options.keysDir;
  const plan = Array.isArray(product.avb?.chainedPartitions) && options.targetFiles && keysDir && options.releasetools && options.out
    ? signingCommands({ ...options, keysDir, product, keyMap, inspection: inspection ?? { apexkeys: [] } }) : null;
  if (options.dryRun) return { dryRun: true, problems, commands: plan?.commands ?? [], ran: false };
  if (problems.length) throw new Error(`Refusing to sign the release:\n${problems.map(item => `  - ${item}`).join("\n")}`);
  fs.mkdirSync(options.out, { mode: 0o700 });
  const env = { ...process.env, PATH: `${path.resolve(options.releasetools)}${path.delimiter}${process.env.PATH ?? ""}` };
  const [sign, makeOta] = plan.commands;
  execFileSync(sign.tool, sign.args, { stdio: "inherit", env });
  // No OTA is built from target-files that still carry a test, development or unknown certificate.
  const remaining = signedTargetFilesProblems({ signed: plan.signed, keysDir, apksigner: apksignerPath(options), keyMap });
  if (remaining.length) throw new Error(`Refusing the signed target-files; no OTA was built:\n${remaining.map(item => `  - ${item}`).join("\n")}`);
  execFileSync(makeOta.tool, makeOta.args, { stdio: "inherit", env });
  const pkmd = path.join(keysDir, product.avb.publicKeyMetadata);
  fs.copyFileSync(pkmd, path.join(options.out, "avb_pkmd.bin"), fs.constants.COPYFILE_EXCL);
  const apkManifest = options.apkManifest ? JSON.parse(fs.readFileSync(options.apkManifest, "utf8")) : null;
  const certificates = keyCertificates(keysDir, [...new Set([...X509_KEYS, ...Object.values(keyMap), ...(fs.existsSync(path.join(keysDir, `${APEX_KEYS.container}.x509.pem`)) ? [APEX_KEYS.container] : [])])]);
  const record = await compatibilityRecord({
    signedTargetFiles: plan.signed, ota: plan.ota, product, channel, apkManifest, certificates,
    avbPublicKeySha256: sha256(fs.readFileSync(pkmd)),
    incrementalFrom: await incrementalSource(options.incrementalFrom),
    inputs: { unsignedTargetFilesSha256: options.targetFilesSha256, productDescriptorSha256: sha256(fs.readFileSync(path.join(root, PIXEL10A_PRODUCT))), sourceLockSha256: product.sourceLock.sha256 },
  });
  const recordFile = path.join(options.out, "release-record.json");
  writeRecord(recordFile, record);
  if (record.problems.length) throw new Error(`Signed outputs are inconsistent; see ${recordFile}:\n${record.problems.map(item => `  - ${item}`).join("\n")}`);
  return { dryRun: false, problems: [], commands: plan.commands, ran: true, record: recordFile, distributionProblems: channelDistributionProblems(channel, product.ota.channel) };
}

export function parseSigningArgs(args) {
  const names = { "--target-files": "targetFiles", "--target-files-sha256": "targetFilesSha256", "--keys-dir": "keysDir", "--releasetools": "releasetools", "--apksigner": "apksigner", "--out": "out", "--apk-manifest": "apkManifest", "--incremental-from": "incrementalFrom" };
  const usage = "Use --target-files ZIP --target-files-sha256 HEX --keys-dir DIR --releasetools DIR --out NEW_DIR [--apksigner FILE] [--map-key SOURCE=NAME ...] [--apk-manifest FILE] [--incremental-from ZIP] [--dry-run]";
  const options = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") { options.dryRun = true; continue; }
    if (args[i] === "--map-key") {
      const value = args[i + 1] ?? "", at = value.indexOf("=");
      if (at <= 0 || value.startsWith("--")) throw new Error(usage);
      options.keyMap = { ...(options.keyMap ?? {}), [value.slice(0, at)]: value.slice(at + 1) };
      i++;
      continue;
    }
    const key = names[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith("--") || options[key] !== undefined) throw new Error(usage);
    options[key] = args[++i];
  }
  return options;
}

async function main(args) {
  const result = await signRelease(parseSigningArgs(args));
  if (result.dryRun) {
    console.log(JSON.stringify({ dryRun: true, ran: false, commands: result.commands.map(({ tool, args }) => [tool, ...args]), problems: result.problems }, null, 2));
    if (result.problems.length) console.warn(`Signing would be refused (${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}).`);
    return;
  }
  console.log(`Signed release written to ${path.dirname(result.record)}. Compatibility record: ${result.record}.`);
  for (const problem of result.distributionProblems) console.warn(`NOT DISTRIBUTABLE ${problem}`);
  console.log("This is a signed build output, not an image boot, an applied update, a rollback or recovery drill, or release qualification.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
