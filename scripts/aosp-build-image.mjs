#!/usr/bin/env node
/**
 * Build the alpha_stallion_phone (Pixel 10a) AOSP image from a verified source tree (issues #399, #377).
 *
 *   node scripts/aosp-build-image.mjs --aosp-source /abs/stallion-source \
 *     --factory-image /abs/stallion-cp3a.261005.005-factory-d1d25502.zip \
 *     --variant development|production --out /abs/new-build-record-dir \
 *     [--jobs N] [--min-free-gib 12] [--out-dir out] [--gomaxprocs 2] [--gomemlimit 18GiB] \
 *     [--ninja-highmem-jobs 1] [--dry-run]
 *
 * Before anything is built it verifies the tree against android/aosp/pixel10a-source.json
 * (the same check as scripts/verify-pixel10a-source.mjs) and, for --variant production,
 * refuses on any pixel10aProductProblems. It refuses while the tree's filesystem has less than
 * --min-free-gib free, then runs, in the tree,
 *
 *   bash -lc 'set -euo pipefail; unset NINJA_ARGS NINJA_EXTRA_ARGS; source build/envsetup.sh;
 *             lunch <pixel10a-product.json lunch.<variant>>;
 *             m [-jN] droid target-files-package updatepackage otatools-package'
 *
 * with OUT_DIR, ANDROID_QUIET_BUILD, SISO_EXPERIMENTS, GOMAXPROCS, GOMEMLIMIT and
 * NINJA_HIGHMEM_NUM_JOBS set, as its own process group. While it runs, free space is polled and
 * the whole group is stopped when it falls below the floor. It writes build-start.json, the build
 * log image-build.log and build-result.json into --out (a new directory), records the SHA-256 of
 * the target-files zip, the img zip and otatools.zip (each must be newer than the build start),
 * the build fingerprints read from the target-files' build.prop files, and unpacks otatools.zip
 * into --out/otatools so that --out/otatools/bin is sign-aosp-release.mjs's --releasetools.
 *
 * A successful build is an unsigned image build only: never a signed image, an image boot,
 * a flash, release qualification or device acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PIXEL10A_PRODUCT, pixel10aProductProblems } from "./aosp-pixel10a.mjs";
import { fileSha256, parseProperties } from "./aosp-release-record.mjs";
import { loadAdmittedPatches, verifyPixel10aSource } from "./pixel10a-source-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD_RECORD_KIND = "alpha-aosp-image-build";
export const BUILD_GOALS = Object.freeze(["droid", "target-files-package", "updatepackage", "otatools-package"]);
/** Releasetools the signing pipeline runs from the unpacked otatools. */
export const REQUIRED_RELEASETOOLS = Object.freeze(["sign_target_files_apks", "ota_from_target_files", "img_from_target_files"]);
const GIB = 1024 ** 3;
const LUNCH = /^[a-z][a-z0-9_]*-[a-z0-9]+-(user|userdebug)$/;
const VARIANT_BUILD_TYPE = Object.freeze({ development: "userdebug", production: "user" });

export const BUILD_DEFAULTS = Object.freeze({ minFreeGib: 12, outDir: "out", gomaxprocs: 2, gomemlimit: "18GiB", ninjaHighmemJobs: 1, pollSeconds: 2, killGraceSeconds: 120 });

/** The lunch target for a variant, from the product descriptor; the build type must match the variant. */
export function lunchFor(product, variant) {
  if (!Object.hasOwn(VARIANT_BUILD_TYPE, variant)) throw new Error("--variant must be development or production");
  const lunch = product?.lunch?.[variant];
  if (typeof lunch !== "string" || !LUNCH.test(lunch)) throw new Error(`${PIXEL10A_PRODUCT}: lunch.${variant} is not a lunch target`);
  if (!lunch.startsWith(`${product.product}-`)) throw new Error(`${PIXEL10A_PRODUCT}: lunch.${variant} is not a ${product.product} target`);
  if (lunch.split("-").at(-1) !== VARIANT_BUILD_TYPE[variant]) throw new Error(`${PIXEL10A_PRODUCT}: lunch.${variant} must be a ${VARIANT_BUILD_TYPE[variant]} build`);
  return lunch;
}

/** Environment overrides for the build (build-image.sh); NINJA_ARGS and NINJA_EXTRA_ARGS are removed. */
export function buildEnvironment(options, base = process.env) {
  const env = { ...base };
  delete env.NINJA_ARGS;
  delete env.NINJA_EXTRA_ARGS;
  return {
    ...env,
    OUT_DIR: options.outDir,
    ANDROID_QUIET_BUILD: "true",
    SISO_EXPERIMENTS: "ignore-missing-targets",
    GOMAXPROCS: String(options.gomaxprocs),
    GOMEMLIMIT: String(options.gomemlimit),
    NINJA_HIGHMEM_NUM_JOBS: String(options.ninjaHighmemJobs),
  };
}

/** The exact build command: bash -lc in the tree. `lunch` and `jobs` are validated, never interpolated raw. */
export function buildCommand({ lunch, jobs }) {
  if (!LUNCH.test(lunch)) throw new Error(`${lunch} is not a lunch target`);
  if (jobs != null && !(Number.isInteger(jobs) && jobs > 0)) throw new Error("--jobs must be a positive integer");
  const m = ["m", ...(jobs ? [`-j${jobs}`] : []), ...BUILD_GOALS].join(" ");
  const script = ["set -euo pipefail", "unset NINJA_ARGS NINJA_EXTRA_ARGS", "source build/envsetup.sh", `lunch ${lunch}`, m].join("\n");
  return { command: "bash", args: ["-lc", script] };
}

/** Where the build leaves its outputs, relative to the source tree. */
export function buildOutputs({ source, outDir, product }) {
  const outRoot = path.resolve(source, outDir);
  const productOut = path.join(outRoot, "target/product", product.device.codename);
  const name = product.product;
  return {
    outRoot,
    productOut,
    targetFiles: path.join(productOut, "obj/PACKAGING/target_files_intermediates", `${name}-target_files.zip`),
    image: path.join(productOut, `${name}-img.zip`),
    fingerprintFile: path.join(productOut, `build_fingerprint-${name}.txt`),
    // otatools-package is a Soong java_genrule_host; legacy Make put it in PRODUCT_OUT.
    otatoolsCandidates: [path.join(productOut, "otatools.zip"), path.join(outRoot, "soong/.intermediates/build/make/tools/otatools_package/otatools-package")],
  };
}

/** The single otatools.zip the build produced, or a problem. */
export function findOtatools(candidates) {
  const found = [];
  for (const candidate of candidates) {
    if (candidate.endsWith(".zip")) { if (fs.existsSync(candidate)) found.push(candidate); continue; }
    if (!fs.existsSync(candidate)) continue;
    for (const variant of fs.readdirSync(candidate)) {
      const file = path.join(candidate, variant, "gen/otatools.zip");
      if (fs.existsSync(file)) found.push(file);
    }
  }
  if (found.length === 1) return { file: found[0] };
  return { problem: found.length ? `more than one otatools.zip: ${found.join(", ")}` : `no otatools.zip in ${candidates.join(" or ")}` };
}

function unzipEntry(zip, name) {
  const out = spawnSync("unzip", ["-p", zip, name], { maxBuffer: 64 << 20 });
  return out.status === 0 ? out.stdout.toString("utf8") : null;
}

/**
 * Build fingerprints from the target-files build.prop files. The device fingerprint is the
 * product/vendor one; SYSTEM/build.prop can carry the generic system image's fingerprint.
 */
export function targetFilesFingerprints(zip) {
  const read = name => { const text = unzipEntry(zip, name); return text === null ? {} : parseProperties(text); };
  const system = read("SYSTEM/build.prop"), vendor = read("VENDOR/build.prop"), product = read("PRODUCT/etc/build.prop");
  const partitions = {
    build: system["ro.build.fingerprint"] ?? null,
    system: system["ro.system.build.fingerprint"] ?? null,
    vendor: vendor["ro.vendor.build.fingerprint"] ?? null,
    product: product["ro.product.build.fingerprint"] ?? null,
  };
  return {
    fingerprint: partitions.product ?? partitions.vendor ?? partitions.build ?? null,
    partitions,
    buildType: product["ro.build.type"] ?? system["ro.build.type"] ?? null,
    buildTags: product["ro.build.tags"] ?? system["ro.build.tags"] ?? null,
    buildId: system["ro.build.id"] ?? null,
  };
}

export function parseBuildArgs(args) {
  const names = { "--aosp-source": "source", "--factory-image": "factory", "--variant": "variant", "--out": "out", "--jobs": "jobs", "--min-free-gib": "minFreeGib",
    "--out-dir": "outDir", "--gomaxprocs": "gomaxprocs", "--gomemlimit": "gomemlimit", "--ninja-highmem-jobs": "ninjaHighmemJobs" };
  const usage = "Use --aosp-source DIR --factory-image ZIP --variant development|production --out NEW_DIR [--jobs N] [--min-free-gib 12] [--out-dir out] [--gomaxprocs 2] [--gomemlimit 18GiB] [--ninja-highmem-jobs 1] [--dry-run]";
  const options = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") { options.dryRun = true; continue; }
    const key = names[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith("--") || options[key] !== undefined) throw new Error(usage);
    options[key] = args[++i];
  }
  for (const key of ["jobs", "minFreeGib", "gomaxprocs", "ninjaHighmemJobs"]) if (options[key] !== undefined) {
    const value = Number(options[key]);
    if (!Number.isInteger(value) || value < (key === "minFreeGib" ? 0 : 1)) throw new Error(`${key} must be a ${key === "minFreeGib" ? "non-negative" : "positive"} integer`);
    options[key] = value;
  }
  if (options.gomemlimit !== undefined && !/^\d+(KiB|MiB|GiB|TiB)?$/.test(options.gomemlimit)) throw new Error("--gomemlimit must be a Go memory limit such as 18GiB");
  if (options.outDir !== undefined && (path.isAbsolute(options.outDir) || options.outDir.split("/").includes(".."))) throw new Error("--out-dir must be a relative directory inside the source tree");
  return options;
}

function defaultFreeBytes(dir) {
  const stat = fs.statfsSync(dir);
  return Number(stat.bavail) * Number(stat.bsize);
}

/** Spawn the build as its own process group; kill() signals the whole group. */
function defaultSpawn(command, args, { cwd, env, log }) {
  const fd = fs.openSync(log, "wx");
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  const kill = signal => { try { process.kill(-child.pid, signal); } catch { /* already gone */ } };
  // The group is detached from the terminal: forward an interrupt of this runner to it.
  const forward = signal => kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, forward);
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => { for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, forward); });
  return { pid: child.pid, exited, kill };
}

function unpackOtatools(zip, dest) {
  const out = spawnSync("unzip", ["-q", zip, "-d", dest], { stdio: ["ignore", "ignore", "pipe"] });
  return out.status === 0 ? null : `unzip of ${zip} exited ${out.status}: ${String(out.stderr).trim().slice(0, 400)}`;
}

const sleepSeconds = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** Every reason to refuse before anything is built or written. */
export async function buildPreflight(options, deps = {}) {
  const root = options.root ?? ROOT;
  const freeBytes = deps.freeBytes ?? defaultFreeBytes;
  const verifySource = deps.verifySource ?? verifyPixel10aSource;
  const productProblems = deps.productProblems ?? pixel10aProductProblems;
  const settings = { ...BUILD_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  const problems = [];
  const product = JSON.parse(fs.readFileSync(path.join(root, PIXEL10A_PRODUCT), "utf8"));
  let lunch = null;
  try { lunch = lunchFor(product, settings.variant); } catch (error) { problems.push(error.message); }
  if (!settings.out || !path.isAbsolute(settings.out)) problems.push("--out must be an absolute path to a new directory");
  else if (fs.existsSync(settings.out)) problems.push(`--out ${settings.out} already exists`);
  const source = settings.source;
  if (!source || !path.isAbsolute(source)) problems.push("--aosp-source must be an absolute path");
  else if (!fs.existsSync(path.join(source, "build/envsetup.sh"))) problems.push(`--aosp-source ${source} has no build/envsetup.sh`);
  if (!settings.factory || !path.isAbsolute(settings.factory)) problems.push("--factory-image must be an absolute path to the pinned factory archive");
  if (settings.variant === "production") for (const problem of productProblems(root)) problems.push(`production: ${problem}`);
  let free = null;
  if (source && fs.existsSync(source)) {
    free = freeBytes(source);
    if (free < settings.minFreeGib * GIB) problems.push(`${source} has ${(free / GIB).toFixed(1)} GiB free, below the ${settings.minFreeGib} GiB floor`);
  }
  let command = null;
  if (lunch) command = buildCommand({ lunch, jobs: settings.jobs });
  // Source verification hashes the whole tree; run it only once everything cheaper has passed.
  let sourceEvidence = null;
  if (!problems.length && !settings.dryRun) {
    try { sourceEvidence = await verifySource({ source, factory: settings.factory, patches: loadAdmittedPatches(root) }); } catch (error) { problems.push(`source verification failed: ${error.message}`); }
    if (sourceEvidence && settings.variant === "production" && sourceEvidence.developmentOnly !== false) problems.push("source verification reports a developmentOnly source lock; a production build needs inputs admitted for release");
  }
  return { problems, settings, product, lunch, command, freeBytes: free, sourceEvidence };
}

/**
 * Build the image. `deps` injects the process runner (spawn), free-space probe (freeBytes),
 * source verification (verifySource), production problems (productProblems), sleep and clock;
 * tests use these and never run a real build.
 */
export async function buildImage(options, deps = {}) {
  const root = options.root ?? ROOT;
  const pre = await buildPreflight({ ...options, root }, deps);
  const { settings, product, lunch, command } = pre;
  const env = buildEnvironment(settings, deps.baseEnv ?? process.env);
  const plan = { lunch, command: command && [command.command, ...command.args], cwd: settings.source, env: Object.fromEntries(["OUT_DIR", "ANDROID_QUIET_BUILD", "SISO_EXPERIMENTS", "GOMAXPROCS", "GOMEMLIMIT", "NINJA_HIGHMEM_NUM_JOBS"].map(name => [name, env[name]])) };
  if (settings.dryRun) return { dryRun: true, problems: pre.problems, plan, ran: false };
  if (pre.problems.length) throw new Error(`Refusing to build the image:\n${pre.problems.map(item => `  - ${item}`).join("\n")}`);
  const freeBytes = deps.freeBytes ?? defaultFreeBytes;
  const spawnBuild = deps.spawn ?? defaultSpawn;
  const sleep = deps.sleep ?? sleepSeconds;
  const now = deps.now ?? (() => Date.now());
  const floor = settings.minFreeGib * GIB;
  const out = settings.out;
  fs.mkdirSync(out, { recursive: false, mode: 0o755 });
  writeJson(path.join(out, "source-verification.json"), { ...pre.sourceEvidence, observedAt: new Date(now()).toISOString() });
  const outputs = buildOutputs({ source: settings.source, outDir: settings.outDir, product });
  const startedAtMs = now();
  const start = {
    schema: 1, kind: `${BUILD_RECORD_KIND}-start`, product: product.product, device: product.device.codename, variant: settings.variant, lunch,
    source: settings.source, outDir: settings.outDir, command: plan.command, env: plan.env, minFreeGib: settings.minFreeGib, freeBytesAtStart: pre.freeBytes,
    sourceLockSha256: pre.sourceEvidence?.sourceLockSha256 ?? null, productDescriptorSha256: await fileSha256(path.join(root, PIXEL10A_PRODUCT)),
    startedAt: new Date(startedAtMs).toISOString(), imageBuilt: false, imageSigned: false, imageFlashed: false,
  };
  writeJson(path.join(out, "build-start.json"), start);
  const record = { ...start, kind: BUILD_RECORD_KIND, minimumFreeBytes: pre.freeBytes, stoppedReason: null, exitCode: null, signal: null, artifacts: {}, fingerprint: null, problems: [] };
  const child = spawnBuild(command.command, command.args, { cwd: settings.source, env, log: path.join(out, "image-build.log") });
  let finished = null;
  child.exited.then(result => { finished = result; }, error => { finished = { code: null, signal: null, error }; });
  let killedAt = null;
  while (!finished) {
    const free = freeBytes(settings.source);
    record.minimumFreeBytes = Math.min(free, record.minimumFreeBytes ?? free);
    if (free < floor && !record.stoppedReason) {
      record.stoppedReason = `free space ${(free / GIB).toFixed(1)} GiB fell below the ${settings.minFreeGib} GiB floor`;
      child.kill("SIGTERM");
      killedAt = now();
    } else if (killedAt !== null && now() - killedAt > settings.killGraceSeconds * 1000) {
      child.kill("SIGKILL");
      killedAt = Infinity;
    }
    if (!finished) await Promise.race([sleep(settings.pollSeconds), child.exited.catch(() => null)]);
  }
  record.exitCode = finished.code;
  record.signal = finished.signal;
  if (finished.error) record.problems.push(`the build could not run: ${finished.error.message}`);
  if (record.stoppedReason) record.problems.push(`build stopped: ${record.stoppedReason}`);
  else if (finished.code !== 0) record.problems.push(`the build exited ${finished.code ?? finished.signal}`);
  if (!record.problems.length) {
    const artifact = async file => {
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) { record.problems.push(`${file} was not produced`); return null; }
      const stat = fs.statSync(file);
      if (stat.mtimeMs < startedAtMs) { record.problems.push(`${file} predates this build`); return null; }
      return { file, sha256: await fileSha256(file), sizeBytes: stat.size };
    };
    const otatools = findOtatools(outputs.otatoolsCandidates);
    if (otatools.problem) record.problems.push(otatools.problem);
    record.artifacts = {
      targetFiles: await artifact(outputs.targetFiles),
      image: await artifact(outputs.image),
      otatools: otatools.file ? await artifact(otatools.file) : null,
    };
    if (record.artifacts.targetFiles) {
      const fingerprints = targetFilesFingerprints(outputs.targetFiles);
      record.fingerprint = fingerprints.fingerprint;
      record.fingerprints = fingerprints;
      const expectedType = VARIANT_BUILD_TYPE[settings.variant];
      if (!fingerprints.fingerprint) record.problems.push("the target-files records no build fingerprint");
      else {
        if (!fingerprints.fingerprint.includes(`/${product.product}/${product.device.codename}:${product.device.androidRelease}/`)) record.problems.push(`fingerprint ${fingerprints.fingerprint} is not ${product.product} on ${product.device.codename} Android ${product.device.androidRelease}`);
        if (!fingerprints.fingerprint.includes(`:${expectedType}/`)) record.problems.push(`fingerprint ${fingerprints.fingerprint} is not a ${expectedType} build`);
      }
      if (fingerprints.buildType && fingerprints.buildType !== expectedType) record.problems.push(`ro.build.type is ${fingerprints.buildType}, not ${expectedType}`);
      if (fs.existsSync(outputs.fingerprintFile)) {
        const file = fs.readFileSync(outputs.fingerprintFile, "utf8").trim();
        record.fingerprints.productOutFile = file;
        if (fingerprints.fingerprint && file !== fingerprints.fingerprint) record.problems.push(`${outputs.fingerprintFile} (${file}) differs from the target-files fingerprint`);
      }
    }
    if (record.artifacts.otatools) {
      const dest = path.join(out, "otatools");
      const failed = (deps.unpack ?? unpackOtatools)(record.artifacts.otatools.file, dest);
      if (failed) record.problems.push(failed);
      else {
        const bin = path.join(dest, "bin");
        for (const name of REQUIRED_RELEASETOOLS) {
          try { fs.accessSync(path.join(bin, name), fs.constants.X_OK); } catch { record.problems.push(`otatools.zip has no executable bin/${name}`); }
        }
        record.releasetools = bin;
        record.otatoolsRoot = dest;
      }
    }
  }
  record.finishedAt = new Date(now()).toISOString();
  record.imageBuilt = record.problems.length === 0;
  Object.assign(record, { imageSigned: false, imageBooted: false, imageFlashed: false, releaseQualified: false, deviceAcceptanceVerified: false });
  writeJson(path.join(out, "build-result.json"), record);
  return { dryRun: false, ran: true, record, recordFile: path.join(out, "build-result.json") };
}

async function main(args) {
  const options = parseBuildArgs(args);
  if (options.dryRun) {
    const result = await buildImage(options);
    console.log(JSON.stringify({ dryRun: true, ran: false, plan: result.plan, problems: result.problems }, null, 2));
    if (result.problems.length) { console.warn(`The build would be refused (${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}).`); process.exitCode = 2; }
    return;
  }
  const { record, recordFile } = await buildImage(options);
  console.log(`Build record: ${recordFile}`);
  for (const problem of record.problems) console.error(`BUILD PROBLEM ${problem}`);
  if (record.imageBuilt) console.log(`Unsigned ${record.variant} image built: ${record.fingerprint}. This is not a signed image, an image boot, a flash or release qualification.`);
  process.exitCode = record.imageBuilt ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`aosp-build-image: ${error.message}`); process.exitCode = 2; }
}
