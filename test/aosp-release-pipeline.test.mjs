// Pixel 10a image build and release pipeline automation (issues #399, #400, #377). The build
// runner, source verification, free-space probe, releasetools and key materialization are all
// injected or faked in temporary directories: these tests establish command construction, lunch
// selection, refusals, recorded hashes and key cleanup. They never run an AOSP build and are not
// an image build, a signed image, an image boot or a flash.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { BUILD_GOALS, buildCommand, buildEnvironment, buildImage, buildOutputs, findOtatools, lunchFor, parseBuildArgs } from "../scripts/aosp-build-image.mjs";
import { buildRecordProblems, parsePipelineArgs, pipelineCommands, runPipeline, vbmetaPublicKey, verifySignedRelease } from "../scripts/aosp-release-pipeline.mjs";
import { PIXEL10A_PRODUCT } from "../scripts/aosp-pixel10a.mjs";

const root = path.resolve(import.meta.dirname, "..");
const product = JSON.parse(fs.readFileSync(path.join(root, PIXEL10A_PRODUCT), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const GIB = 1024 ** 3;
const DEV_FINGERPRINT = "Alpha/alpha_stallion_phone/stallion:17/CP2A.260605.016/eng.ci:userdebug/test-keys";
const USER_FINGERPRINT = "Alpha/alpha_stallion_phone/stallion:17/CP2A.260605.016/eng.ci:user/test-keys";
const RELEASE_FINGERPRINT = USER_FINGERPRINT.replace(/test-keys$/, "release-keys");

/** Write a zip. A value is text, or [text|base64:..., mode] for an entry with Unix permissions. */
function zip(file, entries) {
  const normalized = Object.fromEntries(Object.entries(entries).map(([name, value]) => {
    const [content, mode] = Array.isArray(value) ? value : [value, 0o644];
    return [name, [Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(content).toString("base64"), mode]];
  }));
  execFileSync("python3", ["-I", "-c", "import base64,json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for k,(v,m) in json.loads(sys.argv[2]).items():\n  i=zipfile.ZipInfo(k,(2008,1,1,0,0,0)); i.create_system=3; i.external_attr=(0o100000|m)<<16; z.writestr(i,base64.b64decode(v))", file, JSON.stringify(normalized)]);
}
function temporary(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fakeTree(t) {
  const source = temporary(t, "alpha-aosp-tree-");
  fs.mkdirSync(path.join(source, "build"));
  fs.writeFileSync(path.join(source, "build/envsetup.sh"), "# fake\n");
  return source;
}
const props = (fingerprint, tags = "test-keys") => ({
  "SYSTEM/build.prop": `ro.system.build.fingerprint=${fingerprint.replace("Alpha/alpha_stallion_phone/stallion", "Android/generic_system/generic")}\nro.build.type=${fingerprint.includes(":user/") ? "user" : "userdebug"}\nro.build.tags=${tags}\nro.build.id=CP2A.260605.016\n`,
  "VENDOR/build.prop": `ro.vendor.build.fingerprint=${fingerprint}\n`,
  "PRODUCT/etc/build.prop": `ro.product.build.fingerprint=${fingerprint}\nro.build.type=${fingerprint.includes(":user/") ? "user" : "userdebug"}\nro.build.tags=${tags}\n`,
});

/** A spawn stand-in that writes the outputs a real build would and exits 0. */
function producingSpawn({ fingerprint, calls, otatools = true }) {
  return (command, args, { cwd, env, log }) => {
    calls.push({ command, args, cwd, env, log });
    fs.writeFileSync(log, "fake build log\n", { flag: "wx" });
    const outputs = buildOutputs({ source: cwd, outDir: env.OUT_DIR, product });
    fs.mkdirSync(path.dirname(outputs.targetFiles), { recursive: true });
    zip(outputs.targetFiles, { ...props(fingerprint), "META/misc_info.txt": "avb_enable=true\n" });
    zip(outputs.image, { "android-info.txt": "require board=stallion\n", "fastboot-info.txt": "version 1\n", "boot.img": "boot", "vbmeta.img": "vbmeta", "radio.img": "radio" });
    fs.writeFileSync(outputs.fingerprintFile, `${fingerprint}\n`);
    if (otatools) {
      const gen = path.join(outputs.outRoot, "soong/.intermediates/build/make/tools/otatools_package/otatools-package/linux_glibc_common/gen");
      fs.mkdirSync(gen, { recursive: true });
      zip(path.join(gen, "otatools.zip"), Object.fromEntries(["sign_target_files_apks", "ota_from_target_files", "img_from_target_files", "avbtool", "apksigner"].map(name => [`bin/${name}`, ["#!/bin/sh\n", 0o755]])));
    }
    return { pid: 1, exited: Promise.resolve({ code: 0, signal: null }), kill: () => {} };
  };
}
const passingSource = async ({ source, factory }) => ({ schema: 1, target: "pixel10a", sourceLockSha256: "a".repeat(64), source, factory, developmentOnly: true });
const plenty = () => 500 * GIB;
const instant = () => Promise.resolve();

test("lunch targets come from the product descriptor and match the variant's build type", () => {
  assert.equal(lunchFor(product, "development"), product.lunch.development);
  assert.equal(lunchFor(product, "production"), product.lunch.production);
  assert.match(lunchFor(product, "production"), /-user$/);
  assert.throws(() => lunchFor(product, "eng"), /development or production/);
  assert.throws(() => lunchFor({ ...product, lunch: { ...product.lunch, production: "alpha_stallion_phone-cp2a-userdebug" } }, "production"), /user build/);
  assert.throws(() => lunchFor({ ...product, lunch: { ...product.lunch, development: "aosp_cf_x86_64_phone-cp2a-userdebug" } }, "development"), /alpha_stallion_phone/);
  assert.throws(() => lunchFor({ ...product, lunch: { ...product.lunch, development: "x; rm -rf /" } }, "development"), /not a lunch target/);
});

test("the build command and environment are the reviewed build-image.sh steps in one bash -lc", () => {
  const { command, args } = buildCommand({ lunch: "alpha_stallion_phone-cp2a-user", jobs: 6 });
  assert.equal(command, "bash");
  assert.equal(args[0], "-lc");
  assert.deepEqual(args[1].split("\n"), ["set -euo pipefail", "unset NINJA_ARGS NINJA_EXTRA_ARGS", "source build/envsetup.sh", "lunch alpha_stallion_phone-cp2a-user", "m -j6 droid target-files-package updatepackage otatools-package"]);
  assert.deepEqual(BUILD_GOALS, ["droid", "target-files-package", "updatepackage", "otatools-package"]);
  assert.match(buildCommand({ lunch: "alpha_stallion_phone-cp2a-userdebug" }).args[1], /\nm droid target-files/);
  assert.throws(() => buildCommand({ lunch: "alpha_stallion_phone-cp2a-user", jobs: 0 }), /positive/);
  const env = buildEnvironment({ outDir: "out", gomaxprocs: 2, gomemlimit: "18GiB", ninjaHighmemJobs: 1 }, { PATH: "/bin", NINJA_ARGS: "-k 0", NINJA_EXTRA_ARGS: "x" });
  assert.deepEqual({ OUT_DIR: env.OUT_DIR, ANDROID_QUIET_BUILD: env.ANDROID_QUIET_BUILD, SISO_EXPERIMENTS: env.SISO_EXPERIMENTS, GOMAXPROCS: env.GOMAXPROCS, GOMEMLIMIT: env.GOMEMLIMIT, NINJA_HIGHMEM_NUM_JOBS: env.NINJA_HIGHMEM_NUM_JOBS },
    { OUT_DIR: "out", ANDROID_QUIET_BUILD: "true", SISO_EXPERIMENTS: "ignore-missing-targets", GOMAXPROCS: "2", GOMEMLIMIT: "18GiB", NINJA_HIGHMEM_NUM_JOBS: "1" });
  assert.equal(env.PATH, "/bin");
  assert.ok(!("NINJA_ARGS" in env) && !("NINJA_EXTRA_ARGS" in env));
  const parsed = parseBuildArgs(["--aosp-source", "/s", "--factory-image", "/f.zip", "--variant", "production", "--out", "/o", "--jobs", "4", "--min-free-gib", "30", "--gomemlimit", "24GiB"]);
  assert.deepEqual(parsed, { dryRun: false, source: "/s", factory: "/f.zip", variant: "production", out: "/o", jobs: 4, minFreeGib: 30, gomemlimit: "24GiB" });
  assert.throws(() => parseBuildArgs(["--jobs", "two"]), /jobs/);
  assert.throws(() => parseBuildArgs(["--out-dir", "../elsewhere"]), /inside the source tree/);
  assert.throws(() => parseBuildArgs(["--gomemlimit", "lots"]), /memory limit/);
});

test("the build refuses below the free-space floor before verifying source or running anything", async t => {
  const source = fakeTree(t), out = path.join(temporary(t, "alpha-build-out-"), "record");
  const calls = [];
  let verified = false;
  await assert.rejects(buildImage({ root, source, factory: "/f.zip", variant: "development", out, minFreeGib: 12 },
    { freeBytes: () => 11 * GIB, verifySource: async () => { verified = true; }, spawn: producingSpawn({ fingerprint: DEV_FINGERPRINT, calls }) }), /below the 12 GiB floor/);
  assert.equal(calls.length, 0);
  assert.equal(verified, false);
  assert.ok(!fs.existsSync(out), "nothing is written on refusal");
});

test("the build refuses when source verification fails, and production refuses on product problems", async t => {
  const source = fakeTree(t), base = temporary(t, "alpha-build-out-");
  const calls = [];
  await assert.rejects(buildImage({ root, source, factory: "/f.zip", variant: "development", out: path.join(base, "a") },
    { freeBytes: plenty, verifySource: async () => { throw new Error("Source revision differs: frameworks/base"); }, spawn: producingSpawn({ fingerprint: DEV_FINGERPRINT, calls }) }), /source verification failed: Source revision differs/);
  await assert.rejects(buildImage({ root, source, factory: "/f.zip", variant: "production", out: path.join(base, "b") },
    { freeBytes: plenty, verifySource: passingSource, productProblems: () => ["sourceLock.sha256 is unset"], spawn: producingSpawn({ fingerprint: USER_FINGERPRINT, calls }) }), /production: sourceLock.sha256 is unset/);
  // A clean descriptor still needs a lock admitted for release.
  await assert.rejects(buildImage({ root, source, factory: "/f.zip", variant: "production", out: path.join(base, "c") },
    { freeBytes: plenty, verifySource: passingSource, productProblems: () => [], spawn: producingSpawn({ fingerprint: USER_FINGERPRINT, calls }) }), /developmentOnly source lock/);
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(base), []);
  // The real descriptor is still UNSET: production is refused (dry run, no source hashing).
  const dry = await buildImage({ root, source, factory: "/f.zip", variant: "production", out: path.join(base, "d"), dryRun: true }, { freeBytes: plenty });
  assert.ok(dry.problems.some(problem => /^production: .*UNSET|^production: .*unset/i.test(problem)));
  assert.equal(dry.plan.lunch, product.lunch.production);
});

test("a successful build records the artifact hashes and fingerprint and unpacks otatools for signing", async t => {
  const source = fakeTree(t), out = path.join(temporary(t, "alpha-build-out-"), "record");
  const calls = [];
  const { record, recordFile } = await buildImage({ root, source, factory: "/abs/factory.zip", variant: "development", out, jobs: 3 },
    { freeBytes: plenty, verifySource: passingSource, spawn: producingSpawn({ fingerprint: DEV_FINGERPRINT, calls }), sleep: instant });
  assert.deepEqual(record.problems, []);
  assert.equal(record.imageBuilt, true);
  for (const flag of ["imageSigned", "imageBooted", "imageFlashed", "releaseQualified", "deviceAcceptanceVerified"]) assert.equal(record[flag], false, flag);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, source);
  assert.match(calls[0].args[1], /lunch alpha_stallion_phone-cp2a-userdebug\nm -j3 droid target-files-package updatepackage otatools-package$/);
  const outputs = buildOutputs({ source, outDir: "out", product });
  assert.equal(record.artifacts.targetFiles.file, outputs.targetFiles);
  assert.equal(record.artifacts.targetFiles.sha256, sha256(fs.readFileSync(outputs.targetFiles)));
  assert.equal(record.artifacts.image.sha256, sha256(fs.readFileSync(outputs.image)));
  assert.equal(record.artifacts.otatools.sha256, sha256(fs.readFileSync(record.artifacts.otatools.file)));
  assert.match(record.artifacts.otatools.file, /otatools-package\/linux_glibc_common\/gen\/otatools\.zip$/);
  assert.equal(record.fingerprint, DEV_FINGERPRINT);
  assert.match(record.fingerprints.partitions.system, /^Android\/generic_system/);
  assert.equal(record.releasetools, path.join(out, "otatools/bin"));
  for (const name of ["sign_target_files_apks", "ota_from_target_files", "img_from_target_files"]) fs.accessSync(path.join(record.releasetools, name), fs.constants.X_OK);
  for (const name of ["build-start.json", "build-result.json", "source-verification.json", "image-build.log"]) assert.ok(fs.existsSync(path.join(out, name)), name);
  assert.deepEqual(JSON.parse(fs.readFileSync(recordFile, "utf8")).artifacts, record.artifacts);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "build-start.json"), "utf8")).env.GOMEMLIMIT, "18GiB");
});

test("a build whose outputs are stale, missing otatools or the wrong build type is not recorded as built", async t => {
  const source = fakeTree(t), base = temporary(t, "alpha-build-out-");
  const calls = [];
  const spawnUser = producingSpawn({ fingerprint: USER_FINGERPRINT, calls });
  const { record: wrongType } = await buildImage({ root, source, factory: "/f.zip", variant: "development", out: path.join(base, "a") },
    { freeBytes: plenty, verifySource: passingSource, spawn: spawnUser, sleep: instant });
  assert.equal(wrongType.imageBuilt, false);
  assert.ok(wrongType.problems.some(problem => /not a userdebug build/.test(problem)));
  fs.rmSync(path.join(source, "out"), { recursive: true });
  const { record: noTools } = await buildImage({ root, source, factory: "/f.zip", variant: "development", out: path.join(base, "b") },
    { freeBytes: plenty, verifySource: passingSource, spawn: producingSpawn({ fingerprint: DEV_FINGERPRINT, calls, otatools: false }), sleep: instant });
  assert.equal(noTools.imageBuilt, false);
  assert.ok(noTools.problems.some(problem => /no otatools\.zip/.test(problem)));
  // Outputs left by an earlier build are not this build's outputs.
  const outputs = buildOutputs({ source, outDir: "out", product });
  const stale = (command, args, options) => {
    fs.writeFileSync(options.log, "", { flag: "wx" });
    const old = new Date(Date.now() - 86400e3);
    for (const file of [outputs.targetFiles, outputs.image]) fs.utimesSync(file, old, old);
    return { pid: 1, exited: Promise.resolve({ code: 0, signal: null }), kill: () => {} };
  };
  const { record: staleRecord } = await buildImage({ root, source, factory: "/f.zip", variant: "development", out: path.join(base, "c") },
    { freeBytes: plenty, verifySource: passingSource, spawn: stale, sleep: instant });
  assert.equal(staleRecord.imageBuilt, false);
  assert.ok(staleRecord.problems.some(problem => /predates this build/.test(problem)));
  assert.equal(findOtatools([path.join(base, "none.zip")]).problem.startsWith("no otatools.zip"), true);
});

test("the build process group is stopped when free space falls below the floor during the build", async t => {
  const source = fakeTree(t), out = path.join(temporary(t, "alpha-build-out-"), "record");
  const free = [100 * GIB, 40 * GIB, 11 * GIB, 11 * GIB];
  const signals = [];
  let finish;
  const spawnHang = (command, args, options) => {
    fs.writeFileSync(options.log, "", { flag: "wx" });
    return { pid: 1, exited: new Promise(resolve => { finish = resolve; }), kill: signal => { signals.push(signal); finish({ code: null, signal }); } };
  };
  const { record } = await buildImage({ root, source, factory: "/f.zip", variant: "development", out, minFreeGib: 12 },
    { freeBytes: () => free.length > 1 ? free.shift() : free[0], verifySource: passingSource, spawn: spawnHang, sleep: instant });
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(record.imageBuilt, false);
  assert.equal(record.signal, "SIGTERM");
  assert.match(record.stoppedReason, /below the 12 GiB floor/);
  assert.equal(record.minimumFreeBytes, 11 * GIB);
  assert.deepEqual(record.artifacts, {});
});

/** A production build record pointing at fake artifacts and an executable fake releasetools dir. */
function productionRecord(t) {
  const dir = temporary(t, "alpha-pipeline-build-");
  const tools = path.join(dir, "otatools/bin");
  fs.mkdirSync(tools, { recursive: true });
  for (const name of ["sign_target_files_apks", "ota_from_target_files", "img_from_target_files", "avbtool"]) fs.writeFileSync(path.join(tools, name), "#!/bin/sh\n", { mode: 0o755 });
  const artifact = (name, content) => { const file = path.join(dir, name); fs.writeFileSync(file, content); return { file, sha256: sha256(Buffer.from(content)), sizeBytes: content.length }; };
  const record = { schema: 1, kind: "alpha-aosp-image-build", variant: "production", lunch: product.lunch.production, exitCode: 0, imageBuilt: true, problems: [], fingerprint: USER_FINGERPRINT,
    artifacts: { targetFiles: artifact("tf.zip", "target files"), image: artifact("img.zip", "image"), otatools: artifact("otatools.zip", "otatools") }, releasetools: tools };
  const file = path.join(dir, "build-result.json");
  fs.writeFileSync(file, JSON.stringify(record));
  return { record, file };
}

function pipelineHarness(t, { fail } = {}) {
  const base = temporary(t, "alpha-pipeline-");
  const keysBase = path.join(base, "shm");
  fs.mkdirSync(keysBase);
  const calls = [];
  const run = async (argv, { phase }) => {
    calls.push({ phase, argv });
    if (phase === "keys") {
      const dir = argv[argv.indexOf("--out") + 1];
      fs.mkdirSync(dir, { mode: 0o700 });
      fs.writeFileSync(path.join(dir, "releasekey.pk8"), "TEST-ONLY-PRIVATE-MARKER", { mode: 0o600 });
    }
    return { code: fail === phase ? 1 : 0, signal: null };
  };
  return { base, keysBase, calls, run, out: path.join(base, "pipeline") };
}

test("the pipeline signs the recorded target-files hash and always removes the key directory", async t => {
  const { record, file } = productionRecord(t);
  const { keysBase, calls, run, out } = pipelineHarness(t);
  let verified = null;
  const { pipeline } = await runPipeline({ root, out, buildRecord: file, keysBase, mapKeys: ["vendor/x/certs/foo=foo"], apkManifest: "/abs/apk-manifest.json" },
    { run, isTmpfs: () => true, handleSignals: false, verify: async input => { verified = input; return { problems: [], checks: { ok: true } }; } });
  assert.equal(pipeline.passed, true);
  assert.deepEqual(pipeline.phases.map(entry => [entry.name, entry.status, entry.exitCode]),
    [["build-record", "passed", 0], ["keys", "passed", 0], ["sign", "passed", 0], ["image", "passed", 0], ["verify", "passed", 0], ["keys-cleanup", "passed", 0]]);
  const keysDir = pipeline.keysDir;
  assert.ok(path.dirname(keysDir) === keysBase && /^alpha-release-keys-\d+-[0-9a-f]{16}$/.test(path.basename(keysDir)));
  assert.ok(!fs.existsSync(keysDir), "the key directory is removed");
  const sign = calls.find(call => call.phase === "sign").argv;
  const arg = name => sign[sign.indexOf(name) + 1];
  assert.match(sign[1], /scripts\/sign-aosp-release\.mjs$/);
  assert.equal(arg("--target-files"), record.artifacts.targetFiles.file);
  assert.equal(arg("--target-files-sha256"), record.artifacts.targetFiles.sha256);
  assert.equal(arg("--keys-dir"), keysDir);
  assert.equal(arg("--releasetools"), record.releasetools);
  assert.equal(arg("--out"), path.join(out, "release"));
  assert.equal(arg("--map-key"), "vendor/x/certs/foo=foo");
  assert.deepEqual(calls.find(call => call.phase === "keys").argv.slice(2), ["materialize", "--out", keysDir]);
  assert.deepEqual(calls.find(call => call.phase === "image").argv, [path.join(record.releasetools, "img_from_target_files"), "-p", path.dirname(record.releasetools), path.join(out, "release/signed-target_files.zip"), path.join(out, "release/signed-img.zip")]);
  assert.equal(verified.releaseDir, path.join(out, "release"));
  const written = JSON.parse(fs.readFileSync(path.join(out, "pipeline.json"), "utf8"));
  assert.equal(written.passed, true);
  assert.equal(written.phases.find(entry => entry.name === "build-record").sha256, sha256(fs.readFileSync(file)));
  for (const flag of ["imageBooted", "imageFlashed", "signedUpdateApplied", "releaseQualified", "deviceAcceptanceVerified"]) assert.equal(written[flag], false, flag);
  assert.ok(fs.existsSync(path.join(out, "signed-verification.json")));
  assert.ok(!JSON.stringify(written).includes("TEST-ONLY-PRIVATE-MARKER"));
});

test("a failed signing, image or verification phase stops the pipeline and still removes the keys", async t => {
  for (const failing of ["keys", "sign", "image"]) {
    const { file } = productionRecord(t);
    const { keysBase, calls, run, out } = pipelineHarness(t, { fail: failing });
    const { pipeline } = await runPipeline({ root, out, buildRecord: file, keysBase, mapKeys: [] }, { run, isTmpfs: () => true, handleSignals: false, verify: async () => assert.fail("verify must not run") });
    assert.equal(pipeline.passed, false, failing);
    const names = pipeline.phases.map(entry => entry.name);
    assert.equal(names.at(-1), "keys-cleanup");
    assert.equal(pipeline.phases.find(entry => entry.name === failing).exitCode, 1);
    assert.equal(names.at(-2), failing, `${failing} is the last phase run`);
    assert.ok(!fs.existsSync(pipeline.keysDir), `${failing}: keys removed`);
    assert.equal(pipeline.phases.at(-1).status, "passed");
    assert.ok(!calls.some(call => names.indexOf(call.phase) === -1));
  }
  const { file } = productionRecord(t);
  const { keysBase, run, out } = pipelineHarness(t);
  const { pipeline } = await runPipeline({ root, out, buildRecord: file, keysBase, mapKeys: [] },
    { run, isTmpfs: () => true, handleSignals: false, verify: async () => { throw new Error("unzip exploded"); } });
  assert.equal(pipeline.passed, false);
  assert.deepEqual(pipeline.phases.slice(-2).map(entry => [entry.name, entry.status]), [["verify", "failed"], ["keys-cleanup", "passed"]]);
  assert.match(pipeline.phases.at(-2).error, /unzip exploded/);
  assert.ok(!fs.existsSync(pipeline.keysDir));
});

test("the pipeline refuses development records and non-tmpfs key locations", async t => {
  const { record, file } = productionRecord(t);
  const { keysBase, calls, run, out } = pipelineHarness(t);
  fs.writeFileSync(file, JSON.stringify({ ...record, variant: "development", lunch: product.lunch.development }));
  const { pipeline } = await runPipeline({ root, out, buildRecord: file, keysBase, mapKeys: [] }, { run, isTmpfs: () => true, handleSignals: false });
  assert.equal(pipeline.passed, false);
  assert.deepEqual(pipeline.phases.map(entry => entry.name), ["build-record", "keys-cleanup"]);
  assert.match(pipeline.phases[0].problems.join("\n"), /production user build/);
  assert.equal(calls.length, 0, "no keys are materialized for a refused record");
  await assert.rejects(runPipeline({ root, out: `${out}-2`, buildRecord: file, keysBase, mapKeys: [] }, { run, isTmpfs: () => false, handleSignals: false }), /not a tmpfs/);
  assert.ok(!fs.existsSync(`${out}-2`));
  assert.deepEqual(buildRecordProblems({ kind: "other" }), ["not a alpha-aosp-image-build record"]);
  assert.ok(buildRecordProblems({ ...record, artifacts: { ...record.artifacts, targetFiles: { file: record.artifacts.targetFiles.file, sha256: "nope" } } }).some(problem => /targetFiles artifact/.test(problem)));
});

test("the pipeline can run the production build as its first phase", async t => {
  const { keysBase, calls, out } = pipelineHarness(t);
  const run = async (argv, { phase }) => { calls.push({ phase, argv }); return { code: 1, signal: null }; };
  const options = parsePipelineArgs(["--out", out, "--aosp-source", "/abs/tree", "--factory-image", "/abs/factory.zip", "--jobs", "8", "--keys-base", keysBase]);
  const { pipeline } = await runPipeline({ ...options, root }, { run, isTmpfs: () => true, handleSignals: false });
  assert.deepEqual(pipeline.phases.map(entry => [entry.name, entry.exitCode]), [["build", 1], ["keys-cleanup", 0]]);
  assert.deepEqual(calls[0].argv.slice(1), [path.join(root, "scripts/aosp-build-image.mjs"), "--aosp-source", "/abs/tree", "--factory-image", "/abs/factory.zip", "--variant", "production", "--out", path.join(out, "build"), "--jobs", "8"]);
  assert.throws(() => parsePipelineArgs(["--out", out]), /exactly one/);
  assert.throws(() => parsePipelineArgs(["--out", out, "--build-record", "/r.json", "--jobs", "2"]), /only with --aosp-source/);
  assert.equal(pipelineCommands({ root, options: { out, mapKeys: [], buildRecord: "/r.json" }, keysDir: "/dev/shm/k" }).commands.sign, undefined);
});

/** A minimal signed vbmeta image (libavb header layout) embedding `key`. */
function vbmeta(key) {
  const header = Buffer.alloc(256);
  header.write("AVB0", 0, "latin1");
  header.writeBigUInt64BE(0n, 12);
  header.writeBigUInt64BE(BigInt(key.length), 20);
  header.writeBigUInt64BE(0n, 64);
  header.writeBigUInt64BE(BigInt(key.length), 72);
  return Buffer.concat([header, key]);
}
function certificate(dir) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", "/CN=alpha-test-ota", "-days", "1", "-keyout", path.join(dir, "k.tmp"), "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
  fs.rmSync(path.join(dir, "k.tmp"));
  const pem = fs.readFileSync(path.join(dir, "c.pem"));
  return { pem, sha256: sha256(Buffer.from(pem.toString("utf8").replace(/-----[^-]+-----|\s/g, ""), "base64")) };
}

test("signed outputs are checked read-only against the build record, release AVB key and OTA certificate", async t => {
  const dir = temporary(t, "alpha-signed-");
  const release = path.join(dir, "release");
  fs.mkdirSync(release);
  const pkmd = Buffer.from("release avb public key metadata");
  const cert = certificate(dir);
  const unsignedImage = path.join(dir, "unsigned-img.zip");
  zip(unsignedImage, { "android-info.txt": "require board=stallion\n", "fastboot-info.txt": "version 1\n", "boot.img": "unsigned boot", "vbmeta.img": "unsigned vbmeta", "radio.img": "radio" });
  const vb = vbmeta(pkmd), vbSystem = vbmeta(pkmd);
  zip(path.join(release, "signed-target_files.zip"), { ...props(RELEASE_FINGERPRINT, "release-keys"), "IMAGES/vbmeta.img": vb, "IMAGES/vbmeta_system.img": vbSystem, "IMAGES/boot.img": "signed boot", "RADIO/radio.img": "radio" });
  zip(path.join(release, "ota.zip"), { "META-INF/com/android/otacert": cert.pem, "META-INF/com/android/metadata": `ota-type=AB\npost-build=${RELEASE_FINGERPRINT}\npre-device=stallion\n`, "payload.bin": "payload" });
  zip(path.join(release, "signed-img.zip"), { "android-info.txt": "require board=stallion\n", "fastboot-info.txt": "version 1\n", "boot.img": "signed boot", "vbmeta.img": vb, "vbmeta_system.img": vbSystem, "radio.img": "radio" });
  fs.writeFileSync(path.join(release, "avb_pkmd.bin"), pkmd);
  const fileHash = name => sha256(fs.readFileSync(path.join(release, name)));
  const releaseRecord = { kind: "alpha-aosp-release-compatibility", problems: [], imageBooted: false, signedUpdateApplied: false, releaseQualified: false, deviceAcceptanceVerified: false,
    inputs: { unsignedTargetFilesSha256: "b".repeat(64) }, artifacts: { signedTargetFiles: { sha256: fileHash("signed-target_files.zip") }, ota: { sha256: fileHash("ota.zip") } },
    verifiedBoot: { publicKeySha256: sha256(pkmd), images: { vbmeta: sha256(vb), vbmeta_system: sha256(vbSystem) } } };
  fs.writeFileSync(path.join(release, "release-record.json"), JSON.stringify(releaseRecord));
  const buildRecord = { fingerprint: USER_FINGERPRINT, artifacts: { targetFiles: { sha256: "b".repeat(64) }, image: { file: unsignedImage, sha256: sha256(fs.readFileSync(unsignedImage)) } } };
  const tools = path.join(dir, "bin");
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, "avbtool"), "#!/bin/sh\n", { mode: 0o755 });
  const avbCalls = [];
  const runTool = (tool, args, options) => {
    if (tool !== "unzip") { avbCalls.push(args); return { status: 0, stdout: "Verifying image vbmeta.img using embedded public key\nSuccessfully verified SHA256_RSA4096 vbmeta struct in vbmeta.img\n", stderr: "" }; }
    return spawnSync("unzip", args, { stdio: "ignore" });
  };
  const productDescriptor = { ...product, avb: { ...product.avb, publicKeySha256: sha256(pkmd) } };
  const channel = { otaCertificateSha256: cert.sha256, avbPublicKeySha256: sha256(pkmd) };
  const input = { releaseDir: release, buildRecord, product: productDescriptor, channel, releasetools: tools, workDir: dir, runTool };
  const passed = await verifySignedRelease(input);
  assert.deepEqual(passed.problems, []);
  assert.equal(passed.checks.fingerprint, RELEASE_FINGERPRINT);
  assert.equal(passed.checks.otaCertificateSha256, cert.sha256);
  assert.deepEqual(Object.keys(passed.checks.vbmeta).sort(), ["vbmeta", "vbmeta_system"]);
  assert.equal(avbCalls[0][0], "verify_image");
  assert.ok(avbCalls[0].includes("--follow_chain_partitions"));
  assert.ok(!fs.readdirSync(dir).some(name => name.startsWith("avb-")), "extracted images are removed");
  assert.deepEqual(vbmetaPublicKey(vb), pkmd);
  assert.equal(vbmetaPublicKey(Buffer.from("not vbmeta")), null);

  // A different AVB key, OTA certificate or unsigned fingerprint is refused.
  const wrong = await verifySignedRelease({ ...input, product: { ...productDescriptor, avb: { ...product.avb, publicKeySha256: "c".repeat(64) } }, channel: { ...channel, otaCertificateSha256: "d".repeat(64) }, buildRecord: { ...buildRecord, fingerprint: DEV_FINGERPRINT } });
  assert.ok(wrong.problems.some(problem => /avb.publicKeySha256/.test(problem)));
  assert.ok(wrong.problems.some(problem => /otaCertificateSha256/.test(problem)));
  assert.ok(wrong.problems.some(problem => /signed fingerprint .* is not .*userdebug/.test(problem)));
  zip(path.join(release, "signed-img.zip"), { "android-info.txt": "require board=stallion\n", "fastboot-info.txt": "version 1\nif-wipe erase userdata\n", "boot.img": "unsigned boot", "vbmeta.img": vb, "radio.img": "radio" });
  const image = await verifySignedRelease(input);
  assert.ok(image.problems.some(problem => /fastboot-info.txt differs/.test(problem)));
  assert.ok(image.problems.some(problem => /boot.img differs from the signed target-files/.test(problem)));
  assert.ok(image.problems.some(problem => /no vbmeta_system.img/.test(problem)));
  const failing = await verifySignedRelease({ ...input, runTool: (tool, args, options) => tool === "unzip" ? runTool(tool, args, options) : { status: 1, stdout: "", stderr: "Signature check failed" } });
  assert.ok(failing.problems.some(problem => /avbtool verify_image failed/.test(problem)));
});
