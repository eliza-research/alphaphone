// Runner policy and result parsing on synthetic `am instrument` output. Not emulator evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { instrumentationClassResults, listedInstrumentationTests, writeInstrumentationRecord } from "../scripts/instrumentation-result.mjs";
import { admitApks, admitHome, classIsolationCommands, permissionRevocationCommands, CAMPAIGN_RUNNERS, CLASS_REGISTRY, DEFAULT_CLASSES, instrumentArgs, NOT_RUN_BY_A_RUNNER, parseInstrumentationArgs, PACKAGE, readHome, restoreHome, runLeased, selectAlphaHome } from "../scripts/android-instrumentation.mjs";
import { cases as permissionCases } from "../scripts/test-native-permissions.mjs";

const C = name => `${PACKAGE}.${name}InstrumentedTest`;
const block = (cls, method, code, numtests = 1) =>
  `INSTRUMENTATION_STATUS: class=${cls}\nINSTRUMENTATION_STATUS: current=1\nINSTRUMENTATION_STATUS: id=AndroidJUnitRunner\nINSTRUMENTATION_STATUS: numtests=${numtests}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const done = (summary = "OK (1 test)") => `INSTRUMENTATION_RESULT: stream=\n\nTime: 1\n\n${summary}\n\nINSTRUMENTATION_CODE: -1\n`;

test("per-class results keep going past a failing class and never count skips as passes", () => {
  const output = block(C("Shell"), "a", 1, 4) + block(C("Shell"), "a", 0, 4)
    + block(C("NoMockProduct"), "b", 1, 4) + block(C("NoMockProduct"), "b", -2, 4)
    + block(C("TextScale"), "c", 1, 4) + block(C("TextScale"), "c", 0, 4)
    + block(C("TextScale"), "d", 1, 4) + block(C("TextScale"), "d", -4, 4)
    + block(C("BrowserFlow"), "e", 1, 4) + block(C("BrowserFlow"), "e", -4, 4)
    + done("FAILURES!!!\nTests run: 4,  Failures: 1");
  const { results, runFailure } = instrumentationClassResults(output, [C("Shell"), C("NoMockProduct"), C("TextScale"), C("BrowserFlow"), C("Rotation")]);
  assert.equal(runFailure, false);
  const status = Object.fromEntries(results.map(row => [row.class.split(".").pop(), row.status]));
  assert.deepEqual(status, {
    BrowserFlowInstrumentedTest: "skipped", NoMockProductInstrumentedTest: "failed", RotationInstrumentedTest: "missing",
    ShellInstrumentedTest: "passed", TextScaleInstrumentedTest: "passed",
  });
  assert.deepEqual(results.find(row => row.class === C("TextScale")).ignored, ["d"]);
});

test("a crash or missing terminal result fails the class that was running", () => {
  const crashed = block(C("Shell"), "a", 1) + "INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0\n";
  const { results, crashedIn } = instrumentationClassResults(crashed, [C("Shell")]);
  assert.equal(crashedIn, C("Shell"));
  assert.equal(results[0].status, "failed");
  assert.equal(instrumentationClassResults(block(C("Shell"), "a", 1) + block(C("Shell"), "a", 0), [C("Shell")]).results[0].status, "failed", "no INSTRUMENTATION_CODE");
  assert.throws(() => instrumentationClassResults("", ["bad class"]));
});

test("log-only listing enumerates tests without executing them", () => {
  const listed = listedInstrumentationTests(block(C("Shell"), "a", 1) + block(C("Shell"), "a", 0) + block(C("Shell"), "b", 1) + block(C("Shell"), "b", 0) + done());
  assert.deepEqual(listed, [`${C("Shell")}#a`, `${C("Shell")}#b`]);
});

test("records bind commit and APK hashes, are emulator class E and refuse overwrite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-instr-"));
  try {
    const file = path.join(dir, "results.json");
    const apks = [{ variant: "standalone", role: "app", sha256: "a".repeat(64) }, { variant: "standalone", role: "test", sha256: "b".repeat(64) }];
    const classes = [{ variant: "standalone", class: C("Shell"), status: "passed" }, { variant: "standalone", class: C("BrowserFlow"), status: "skipped" }];
    assert.throws(() => writeInstrumentationRecord(file, { commit: "abc", apks, classes }), /commit/);
    assert.throws(() => writeInstrumentationRecord(file, { commit: "c".repeat(40), apks: [{ variant: "x", role: "app", sha256: "z" }], classes }), /SHA-256/);
    const body = writeInstrumentationRecord(file, { commit: "c".repeat(40), apks, classes });
    assert.equal(body.evidenceClass, "E");
    assert.ok(body.notEvidenceFor.includes("physical-device acceptance"));
    assert.equal(body.passed, false, "a skipped class is not a pass");
    assert.throws(() => writeInstrumentationRecord(file, { commit: "c".repeat(40), apks, classes }), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("argument policy: short names, campaigns refused with their runner, clock and test-mocks gates", () => {
  const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "a", "--classes", "NoMockProduct,Shell,StartupReadiness"]);
  assert.deepEqual(options.classes, [C("NoMockProduct"), C("Shell"), C("StartupReadiness")]);
  assert.equal(options.apkDir, "artifacts");
  assert.deepEqual(options.variants, ["standalone", "launcher"]);
  assert.equal(parseInstrumentationArgs([]).classes.length, DEFAULT_CLASSES.length);
  assert.equal(parseInstrumentationArgs(["--test-mocks"]).apkDir, "artifacts/test-mocks");
  for (const name of ["ResidentEgressRedaction", "ReminderTapProcessDeath", "WorkflowNoticeProcessDeath", "VoicePermissionRevoke"])
    assert.throws(() => parseInstrumentationArgs(["--classes", name]), /own campaign/);
  // Classes that assume a test-mocks app build are refused without it instead of reporting "skipped".
  assert.throws(() => parseInstrumentationArgs(["--classes", "ConnectionChooser"]), /test-mocks app build/);
  assert.equal(parseInstrumentationArgs(["--test-mocks", "--classes", "ConnectionChooser"]).classes[0], C("ConnectionChooser"));
  // HOME-role classes never run (and so never skip) outside the opt-in phase.
  for (const name of ["LauncherHome", "SettingsRoles"]) assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--classes", name]), /--home-role/);
  assert.deepEqual(parseInstrumentationArgs(["--owned-emulator", "--home-role", "--classes", "SettingsRoles,LauncherHome"]).classes, [C("SettingsRoles"), C("LauncherHome")]);
  assert.throws(() => parseInstrumentationArgs(["--home-role", "--classes", "LauncherHome"]), /requires --owned-emulator/);
  assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--home-role", "--variants", "standalone", "--classes", "LauncherHome"]), /launcher variant/);
  assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--home-role", "--classes", "Shell"]), /no requested class uses the HOME role/);
  assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--home-role", "--all"]), /cannot be combined with --all/);
  assert.deepEqual(instrumentArgs(C("BrowserPageQuestion")).slice(-6, -1), ["browserPageQuestion", "1", "-e", "class", C("BrowserPageQuestion")]);
  assert.throws(() => parseInstrumentationArgs(["--classes", "RealClock"]), /clock-exclusive/);
  assert.equal(parseInstrumentationArgs(["--classes", "RealClock", "--clock-exclusive"]).classes[0], C("RealClock"));
  assert.throws(() => parseInstrumentationArgs(["--classes", "BrowserAutofill"]), /test-mocks/);
  assert.throws(() => parseInstrumentationArgs(["--all", "--classes", "Shell"]));
  assert.throws(() => parseInstrumentationArgs(["--variants", "standalone,standalone"]));
  assert.throws(() => parseInstrumentationArgs(["--classes", "Shell;id"]));
  assert.throws(() => parseInstrumentationArgs(["--bogus"]));
  const args = instrumentArgs(C("StartupReadiness"));
  assert.deepEqual(args.slice(-6, -1), ["startupReadiness", "1", "-e", "class", C("StartupReadiness")]);
  assert.ok(args.includes("startupReadiness") && args.at(-1) === `${PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner`);
  assert.deepEqual(CLASS_REGISTRY.HostedProcessRestart.phases.length, 3);
});

test("APK admission binds the app to the verify-apks manifest and the test APK to its recorded hash", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-instr-apk-"));
  try {
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    fs.mkdirSync(path.join(dir, "instrumentation"));
    fs.writeFileSync(path.join(dir, "standalone-debug.apk"), "app");
    fs.writeFileSync(path.join(dir, "instrumentation/standalone-androidTest.apk"), "test");
    const manifest = { testMocks: false, results: [{ variant: "standalone", mode: "debug", sha256: sha("app"), versionCode: 7 }], instrumentation: { standalone: { sha256: sha("test") } } };
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
    const [app, testApk] = admitApks(dir, "standalone", { testMocks: false });
    assert.equal(app.sha256, sha("app"));
    assert.equal(testApk.sha256, sha("test"));
    assert.throws(() => admitApks(dir, "standalone", { testMocks: true }), /testMocks/);
    // A test APK the manifest does not record is not bound to this app build.
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify({ ...manifest, instrumentation: {} }));
    assert.throws(() => admitApks(dir, "standalone", { testMocks: false }), /instrumentation APK recorded/);
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, "standalone-debug.apk"), "changed");
    assert.throws(() => admitApks(dir, "standalone", { testMocks: false }), /does not match/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("restart runner keeps the bookmark phase wired", () => {
  const source = fs.readFileSync("scripts/test-native-restart.mjs", "utf8");
  // P-04 sign-in persistence: the phase the test class documents must have a runner case with its gate.
  assert.match(source, /signin: \{\n\t\ttestClass: "BrowserSigninsInstrumentedTest",\n\t\tmethod: "signinProcessRestartPhase",\n\t\tgate: "signinPhase"/);
  const signins = fs.readFileSync("android/app/src/androidTest/java/ai/elizaresearch/alphaphone/BrowserSigninsInstrumentedTest.java", "utf8");
  assert.match(signins, /void signinProcessRestartPhase\(\)/);
  for (const phase of ["prepare", "verify", "cleanup"]) assert.ok(signins.includes(`"${phase}"`), `sign-in restart phase ${phase}`);
  assert.ok(signins.includes('getString("signinPhase")'));
  assert.match(source, /bookmark: \{\n\t\ttestClass: "BrowserContinuityInstrumentedTest",\n\t\tmethod: "bookmarkProcessRestartPhase",\n\t\tgate: "bookmarkPhase"/);
  assert.equal(JSON.parse(fs.readFileSync("package.json", "utf8")).scripts["test:android:instrumentation"], "node scripts/android-instrumentation.mjs");
});

const ROOTS = ["android/app/src/androidTest/java", "android/app/src/testMocks/androidTest/java"];
const javaFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? javaFiles(file) : file.endsWith(".java") ? [file] : [];
});
/** Every class under androidTest with at least one @Test method, by simple class name. */
const testClasses = () => new Map(ROOTS.flatMap(javaFiles).filter(file => /^\s*@(?:org\.junit\.)?Test\b/m.test(fs.readFileSync(file, "utf8")) || /[\s;{}]@(?:org\.junit\.)?Test\b/.test(fs.readFileSync(file, "utf8")))
  .map(file => [path.basename(file, ".java"), file]));
const registryName = cls => cls.replace(/InstrumentedTest$/, "");
const gateRead = (source, gate, value) => {
  // Java imports and the exact fully qualified registry name call the same API.
  source = source.replaceAll("androidx.test.platform.app.InstrumentationRegistry", "InstrumentationRegistry");
  if (source.includes(`"${value}".equals(InstrumentationRegistry.getArguments().getString("${gate}")`)) return true;
  // Some destructive-fixture gates deliberately assert instead of assumption-skipping.
  const assertions = [...source.matchAll(/assertEquals\(\s*(?:"[^"\n]*"\s*,\s*)?"([^"\n]*)"\s*,\s*InstrumentationRegistry\.getArguments\(\)\.getString\("([^"\n]*)"\)/g)];
  return assertions.some(([, expected, key]) => expected === value && key === gate);
};

test("every registered class exists in the app's instrumentation sources and declares the gates the runner passes", () => {
  const roots = ROOTS.map(root => path.join(root, "ai/elizaresearch/alphaphone"));
  for (const [name, spec] of Object.entries(CLASS_REGISTRY)) {
    const found = roots.map(root => path.join(root, `${name}InstrumentedTest.java`)).filter(file => fs.existsSync(file));
    assert.equal(found.length, 1, `${name} must be exactly one class in the app instrumentation sources`);
    assert.equal(found[0].includes("testMocks"), spec.testMocks === true, `${name} test-mocks flag must match its source set`);
    const source = fs.readFileSync(found[0], "utf8");
    // Lifecycle diagnostics are consumed by the scenario helper used by the class.
    const helper = source.includes("BoundedActivityScenario") ? fs.readFileSync(path.join(roots[0], "BoundedActivityScenario.java"), "utf8") : "";
    for (const [gate, value] of Object.entries(spec.args ?? {}))
      assert.ok(gateRead(source, gate, value) || (gate === "lifecycleDiagnostics" && gateRead(helper, gate, value)), `${name} does not read gate ${gate}=${value}`);
    for (const method of spec.phases ?? []) assert.match(source, new RegExp(`void ${method}\\(`), `${name} has no phase ${method}`);
    if (spec.requiresTestMocksBuild) assert.ok(source.includes("BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS"), `${name} does not assume a test-mocks app build`);
    if (spec.homeRole) {
      assert.ok(["requests", "held"].includes(spec.homeRole) && source.includes("BuildConfig.IS_LAUNCHER"), `${name} is not a launcher-variant HOME class`);
      // "held" classes must not change the role themselves; "requests" classes must put back what they found.
      if (spec.homeRole === "held") assert.ok(!/add-role-holder|remove-role-holder|set-home-activity/.test(source), `${name} must not change the HOME role`);
      else assert.ok(source.includes("add-role-holder") && /finally\s*\{/.test(source), `${name} must restore the HOME holder it found`);
    }
    if (spec.campaign) {
      // The refusal names a real script, and that script names the class.
      const script = /(?:node|python3) (scripts\/[A-Za-z0-9_./-]+)/.exec(spec.campaign)?.[1];
      assert.ok(script && fs.existsSync(script), `${name} campaign names no existing script: ${spec.campaign}`);
      assert.ok(new RegExp(`\\b${name}InstrumentedTest\\b`).test(fs.readFileSync(script, "utf8")), `${script} does not run ${name}`);
      assert.ok(!spec.args && !spec.phases, `${name} is a campaign; its gates belong to the campaign runner`);
    }
  }
  // A core-loop class with a gate runs its gated methods instead of reporting them skipped.
  assert.deepEqual(instrumentArgs(C("ClockHandoff")).slice(-6, -1), ["clockHandoff", "1", "-e", "class", C("ClockHandoff")]);
  // HostedResultNotice's posted and denied notices need the notification permission set first, so
  // this runner passes neither gate and the permission runner owns both.
  assert.equal(CLASS_REGISTRY.HostedResultNotice.args, undefined);
  for (const scenario of ["notice", "notice-denied"]) assert.equal(permissionCases[scenario].testClass, "HostedResultNoticeInstrumentedTest");
});

test("every @Test class is run by a runner or listed with a reason, and neither list goes stale", () => {
  const classes = testClasses();
  assert.ok(classes.size > 100, "instrumentation sources were found");
  for (const file of CAMPAIGN_RUNNERS) assert.ok(fs.existsSync(file), `campaign runner ${file} is missing`);
  const campaignSources = CAMPAIGN_RUNNERS.map(file => [file, fs.readFileSync(file, "utf8")]);
  const namedBy = cls => campaignSources.filter(([, source]) => new RegExp(`\\b${cls}\\b`).test(source)).map(([file]) => file);
  const unreachable = [], stale = [];
  for (const cls of classes.keys()) {
    const name = registryName(cls);
    const registered = Object.hasOwn(CLASS_REGISTRY, name) && cls.endsWith("InstrumentedTest");
    const campaigns = namedBy(cls);
    const excused = Object.hasOwn(NOT_RUN_BY_A_RUNNER, name);
    if (!registered && !campaigns.length && !excused) unreachable.push(cls);
    if (excused && (registered || campaigns.length)) stale.push(`${cls} (${registered ? "registered" : campaigns.join(", ")})`);
  }
  assert.deepEqual(unreachable, [], "these @Test classes have no runner entry, no campaign and no listed reason; register them in scripts/android-instrumentation.mjs or a campaign runner, or add them to NOT_RUN_BY_A_RUNNER with the reason");
  assert.deepEqual(stale, [], "these classes are run by a runner now; remove them from NOT_RUN_BY_A_RUNNER");
  for (const [name, reason] of Object.entries(NOT_RUN_BY_A_RUNNER)) {
    assert.ok(classes.has(name) || classes.has(`${name}InstrumentedTest`), `NOT_RUN_BY_A_RUNNER lists ${name}, which is not a @Test class`);
    assert.ok(typeof reason === "string" && reason.trim().length >= 40, `NOT_RUN_BY_A_RUNNER.${name} needs a specific reason`);
  }
  // Registry entries must be classes too (the test above checks each file); nothing is registered twice.
  assert.equal(new Set(Object.keys(CLASS_REGISTRY)).size, Object.keys(CLASS_REGISTRY).length);
  // What this package registered stays registered.
  for (const name of ["BrowserPageQuestion", "ConnectionChooser", "LauncherHome", "SettingsRoles", "NotesSecureStorage"]) assert.ok(Object.hasOwn(CLASS_REGISTRY, name), name);
  for (const cls of ["VoicePermissionDeniedInstrumentedTest", "VoicePermissionRevokeInstrumentedTest", "HostedResultNoticeInstrumentedTest", "LocalVoiceRecordingLimitInstrumentedTest"])
    assert.deepEqual(namedBy(cls), ["scripts/test-native-permissions.mjs"], cls);
});

test("permission scenarios name real classes, methods and gates", () => {
  const classes = testClasses();
  for (const [scenario, spec] of Object.entries(permissionCases)) {
    const file = classes.get(spec.testClass);
    assert.ok(file, `${scenario}: ${spec.testClass} is not a @Test class`);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, new RegExp(`@Test\\s+public void ${spec.method}\\(`), `${scenario}: ${spec.testClass} has no test ${spec.method}`);
    assert.ok(source.includes(`getString("${spec.gate}")`), `${scenario}: ${spec.testClass} does not read ${spec.gate}`);
    if (!spec.revokeWhileRecording) assert.ok(gateRead(source, spec.gate, spec.value), `${scenario}: gate ${spec.gate}=${spec.value} is not what the class checks`);
    for (const [operation, permission] of spec.permissions) {
      assert.ok(["grant", "revoke"].includes(operation));
      assert.ok(fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8").includes(`android.permission.${permission}`), `${scenario}: the app does not declare ${permission}`);
    }
  }
  // The microphone scenarios: denied before start, and revoked mid-recording in phases the class implements.
  assert.deepEqual(permissionCases.voice.permissions, [["revoke", "RECORD_AUDIO"]]);
  const revoke = permissionCases["voice-revoke"], source = fs.readFileSync(classes.get(revoke.testClass), "utf8");
  for (const phase of [revoke.value, ...revoke.revokeWhileRecording.phases]) assert.ok(source.includes(`case "${phase}":`), `voice-revoke phase ${phase}`);
  assert.ok(source.includes(`getString("${revoke.revokeWhileRecording.runIdGate}")`));
  assert.equal(revoke.revokeWhileRecording.marker, `files/${/static final String MARKER = "([^"]+)"/.exec(source)[1]}`);
  assert.deepEqual(permissionCases["notice-denied"].permissions, [["revoke", "POST_NOTIFICATIONS"]]);
});

/** A scripted emulator: role state, installs and instrumentation output, with every command recorded. */
function fakeEmulator({ stock = "com.android.launcher3", mode = "pass" } = {}) {
  const state = { holder: stock, activity: `${stock}/.Launcher`, installed: new Map(), users: new Map(), commands: [] };
  const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const adb = args => {
    state.commands.push(args.join(" "));
    const text = args.join(" ");
    if (text.includes("pm clear")) return "Success\n";
    if (text === "shell dumpsys webviewupdate" && mode === "provider-unknown") return "Unavailable";
    if (text === "shell dumpsys webviewupdate") return "Current WebView package (name, version): (com.android.webview, 145.0)\nWebView package dirty: false\n";
    if (text === "shell pm path com.android.webview") return "package:/system/webview.apk\n";
    if (text === "shell sha256sum /system/webview.apk") return `${(mode === "provider-changing" && state.commands.some(c=>c.startsWith("install ")) ? "e" : "f").repeat(64)}  /system/webview.apk\n`;
    if (text === "emu avd name") return "fixture-avd\nOK\n";
    if (text.includes("getprop ro.product.cpu.abi")) return "arm64-v8a\n";
    if (text.includes("getprop ro.build.version.sdk")) return "35\n";
    if (text.includes("getprop")) return "1\n";
    // Packages made available to a secondary user, tracked per user.
    const perUser = /^shell (?:cmd package install-existing|pm uninstall|pm list packages) --user (\d+)(?: (\S+))?$/.exec(text);
    if (perUser && perUser[1] !== "0" && !text.includes("--user all")) {
      const held = state.users.get(perUser[1]) ?? state.users.set(perUser[1], new Set()).get(perUser[1]);
      if (text.includes("install-existing")) { held.add(perUser[2]); return `Package ${perUser[2]} installed for user: ${perUser[1]}\n`; }
      if (text.includes("pm uninstall")) { held.delete(perUser[2]); return "Success\n"; }
      return [...held].map(name => `package:${name}`).join("\n");
    }
    if (text.includes("pm list packages")) return [...state.installed.keys()].map(name => `package:${name}`).join("\n");
    if (text.includes("am get-current-user")) return mode === "secondary-user" ? "10\n" : "0\n";
    if (text.includes("get-role-holders")) return `${state.holder}\n`;
    if (text.includes("resolve-activity")) return `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${state.activity}\n`;
    if (args[0] === "install") { const file = args.at(-1); state.installed.set(file.includes("androidTest") ? `${PACKAGE}.test` : PACKAGE, sha(file)); return "Success\n"; }
    if (text.includes("pm path")) return `package:/data/app/${args.at(-1)}.apk\n`;
    if (text.includes("sha256sum")) return `${state.installed.get(path.basename(args.at(-1), ".apk"))}  ${args.at(-1)}\n`;
    if (args[0] === "uninstall") { state.installed.delete(args[1]); return "Success\n"; }
    if (text.includes("set-home-activity")) {
      const component = args.at(-1);
      if (mode === "select-fails" && component.startsWith(PACKAGE)) return "";
      if (mode === "restore-fails" && !component.startsWith(PACKAGE)) return "";
      state.activity = component; state.holder = component.split("/")[0]; return "Success\n";
    }
    if (text.includes("add-role-holder")) { if (mode !== "restore-fails") { state.holder = args.at(-1); state.activity = `${state.holder}/.Launcher`; } return ""; }
    if (text.includes("dumpsys activity activities")) return `  topResumedActivity=ActivityRecord{1 u0 ${mode === "home-not-resumed" ? `${stock}/.Launcher` : state.activity} t1}\n`;
    if (text.includes("am instrument")) {
      const cls = args[args.indexOf("class") + 1].split("#")[0]; // A phase names one method of the class.
      // A role-requesting class that forgets to restore leaves Alpha as HOME.
      if (mode === "requests-leaves-home" && cls === C("SettingsRoles") && !args.includes("log")) { state.holder = PACKAGE; state.activity = `${PACKAGE}/.MainActivity`; }
      // -3 is an assumption failure: every method of the class skipped by its own gate.
      if (mode === "all-skipped" && cls === C("BrowserDownload")) return block(cls, "m", 1) + block(cls, "m", -3) + done();
      return block(cls, "m", 1) + block(cls, "m", 0) + done();
    }
    return "";
  };
  return { state, adb };
}
function apkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-home-role-"));
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(path.join(dir, "instrumentation"));
  const manifest = { testMocks: false, results: [], instrumentation: {} };
  for (const variant of ["standalone", "launcher"]) {
    fs.writeFileSync(path.join(dir, `${variant}-debug.apk`), `${variant} app`);
    fs.writeFileSync(path.join(dir, `instrumentation/${variant}-androidTest.apk`), `${variant} test`);
    manifest.results.push({ variant, mode: "debug", sha256: sha(`${variant} app`), versionCode: 7 });
    manifest.instrumentation[variant] = { sha256: sha(`${variant} test`) };
  }
  fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
  return dir;
}
const timing = { sleep: () => {}, attempts: 2 };
async function homeRun(mode, extra = []) {
  const dir = apkDir(), emulator = fakeEmulator({ mode });
  try {
    const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "fixture-avd", "--serial", "emulator-5554", "--home-role", "--classes", "Shell,LauncherHome,SettingsRoles", "--apk-dir", dir, "--output", path.join(dir, "out"), ...extra]);
    let result, error;
    try { result = await runLeased({ options, serial: "emulator-5554", adb: emulator.adb, timing }); } catch (failure) { error = failure; }
    const recovery = path.join(dir, "out/home-role-recovery.json");
    const providerFailure = path.join(dir, "out/post-run-provider-error.json");
    return { result, error, ...emulator, providerFailure: fs.existsSync(providerFailure) ? JSON.parse(fs.readFileSync(providerFailure, "utf8")) : null, recovery: fs.existsSync(recovery) ? JSON.parse(fs.readFileSync(recovery, "utf8")) : null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const stepsOf = commands => commands.flatMap(command => {
  if (command.startsWith("install")) return [`install ${/(standalone|launcher)-(debug|androidTest)/.exec(command)[0]}`];
  if (command.startsWith("uninstall")) return [command];
  if (command.includes("am instrument") && !command.includes("-e log true")) return [`run ${/alphaphone\.([A-Za-z]+)InstrumentedTest/.exec(command)[1]}`];
  if (command.includes("set-home-activity")) return [`home ${command.split(" ").at(-1)}`];
  if (command.includes("add-role-holder")) return [`role ${command.split(" ").at(-1)}`];
  if (command.includes("KEYCODE_HOME")) return ["HOME key"];
  if (command.includes("am force-stop")) return ["force-stop"];
  return [];
});

test("HOME role phase selects the launcher APK, runs the HOME classes and restores the original holder before uninstalling", async () => {
  const { result, error, state } = await homeRun("pass");
  assert.ifError(error);
  assert.deepEqual(stepsOf(state.commands), [
    // Standalone: only the classes that do not need HOME; LauncherHome and SettingsRoles are not run, so they cannot skip.
    "install standalone-debug", "install standalone-androidTest", "run Shell", `uninstall ${PACKAGE}.test`, `uninstall ${PACKAGE}`,
    // Launcher: ordinary classes, then the class that requests the role itself, then selection and a cold HOME start.
    "install launcher-debug", "install launcher-androidTest", "run Shell", "run SettingsRoles",
    `home ${PACKAGE}/.MainActivity`, "force-stop", "HOME key", "run LauncherHome",
    // The original holder is put back while Alpha is still installed, and only then is Alpha removed.
    "role com.android.launcher3", "home com.android.launcher3/.Launcher", `uninstall ${PACKAGE}.test`, `uninstall ${PACKAGE}`,
  ]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.homeRole, { user: "0", original: { holders: ["com.android.launcher3"], activity: "com.android.launcher3/.Launcher" }, selected: true,
    coldHome: { resumed: true }, restored: true, after: { holders: ["com.android.launcher3"], activity: "com.android.launcher3/.Launcher" } });
  assert.deepEqual(result.classes.map(row => `${row.variant}:${row.class.split(".").pop()}:${row.status}`), [
    "standalone:ShellInstrumentedTest:passed", "launcher:ShellInstrumentedTest:passed", "launcher:SettingsRolesInstrumentedTest:passed", "launcher:LauncherHomeInstrumentedTest:passed"]);
  assert.equal(state.holder, "com.android.launcher3");
  assert.equal(state.installed.size, 0);
});

test("HOME role phase fails and keeps the installation when the original holder cannot be proven restored", async () => {
  const { result, state, recovery } = await homeRun("restore-fails");
  assert.equal(result.passed, false, "every class passed, but the run is not a pass");
  assert.equal(result.homeRole.restored, false);
  assert.deepEqual(result.homeRole.after.holders, [PACKAGE]);
  assert.ok(!stepsOf(state.commands).slice(stepsOf(state.commands).indexOf("run LauncherHome")).some(step => step.startsWith("uninstall")), "nothing is uninstalled after an unproven restoration");
  assert.deepEqual([...state.installed.keys()].sort(), [PACKAGE, `${PACKAGE}.test`]);
  assert.deepEqual(recovery.retainedPackages.sort(), [PACKAGE, `${PACKAGE}.test`]);
  assert.equal(recovery.recover, "adb -s emulator-5554 shell cmd role add-role-holder --user 0 android.app.role.HOME com.android.launcher3");
  assert.deepEqual(recovery.original, { holders: ["com.android.launcher3"], activity: "com.android.launcher3/.Launcher" });
});

test("HOME role phase reports a failed selection or cold start as missing HOME classes and still restores", async () => {
  for (const mode of ["select-fails", "home-not-resumed"]) {
    const { result, state } = await homeRun(mode);
    assert.equal(result.passed, false, mode);
    const launcherHome = result.classes.find(row => row.class === C("LauncherHome"));
    assert.equal(launcherHome.status, "missing", mode);
    assert.match(launcherHome.note, /HOME role phase failed/);
    assert.ok(!stepsOf(state.commands).includes("run LauncherHome"), `${mode}: HOME classes must not run without Alpha as HOME`);
    assert.equal(result.homeRole.restored, true, mode);
    assert.equal(state.holder, "com.android.launcher3", mode);
    assert.equal(state.installed.size, 0, mode);
    assert.match(result.homeRole.error, mode === "select-fails" ? /not selected as HOME/ : /did not bring Alpha to the foreground/);
  }
  // A role-requesting class that leaves HOME changed stops the phase before selection; the original is restored.
  const left = await homeRun("requests-leaves-home");
  assert.equal(left.result.passed, false);
  assert.match(left.result.homeRole.error, /did not restore it/);
  assert.equal(left.result.homeRole.selected, false);
  assert.ok(!stepsOf(left.state.commands).includes("run LauncherHome"));
  assert.equal(left.result.homeRole.restored, true, "the runner puts the original holder back even though it never selected Alpha itself");
  assert.equal(left.state.holder, "com.android.launcher3");
  assert.equal(left.recovery, null);
  assert.equal(left.state.installed.size, 0);
});

test("HOME role admission refuses an emulator without one stock HOME holder, and a secondary foreground user", async () => {
  await assert.rejects(async () => { const { error } = await homeRun("secondary-user"); throw error; }, /primary user/);
  const none = fakeEmulator(); none.state.holder = ""; assert.throws(() => admitHome(none.adb), /one stock HOME app/);
  const alpha = fakeEmulator(); alpha.state.holder = PACKAGE; alpha.state.activity = `${PACKAGE}/.MainActivity`; assert.throws(() => admitHome(alpha.adb), /one stock HOME app/);
  const ready = fakeEmulator();
  const home = admitHome(ready.adb);
  assert.deepEqual(readHome(ready.adb, "0"), home.original);
  // Restoring a HOME that was never selected changes nothing and only reads it back.
  const before = ready.state.commands.length;
  assert.equal(restoreHome(ready.adb, home, timing).restored, true);
  assert.ok(ready.state.commands.slice(before).every(command => /get-role-holders|resolve-activity/.test(command)));
  selectAlphaHome(ready.adb, home, timing);
  assert.equal(ready.state.holder, PACKAGE);
  assert.equal(restoreHome(ready.adb, home, timing).restored, true);
  assert.equal(ready.state.holder, "com.android.launcher3");
});

test("each named class starts from cleared app data with Android's shade closed", () => {
  // First emulator runs: Video, Accessibility and SettingsFlow passed or failed with the order of
  // the classes before them, and a system shade left open failed every later gesture.
  const commands = classIsolationCommands();
  assert.ok(commands.some(command => command.join(" ") === `shell pm clear ${PACKAGE}`));
  assert.ok(commands.some(command => command.join(" ") === "shell cmd statusbar collapse"));
  // Only the app under test is cleared; the instrumentation package and other apps keep their data.
  assert.equal(commands.filter(command => command.includes("clear")).length, 1);
  const runner = fs.readFileSync("scripts/android-instrumentation.mjs", "utf8");
  const loop = runner.slice(runner.indexOf("const runClass = (cls, { user } = {}) =>"));
  assert.ok(loop.indexOf("classIsolationCommands(user)") > 0 && loop.indexOf("classIsolationCommands(user)") < loop.indexOf("spec.phases"), "isolation runs once per class, before its phases");
  // In the secondary-user phase the same isolation applies to that user only.
  assert.ok(classIsolationCommands("10").some(command => command.join(" ") === `shell pm clear --user 10 ${PACKAGE}`));
});

test("classes that assert a secondary user run in a disposable user the runner creates and removes", async () => {
  // First run: HostedProcessRestart (then a default class) and HostedBackgroundWorker received their
  // gates in user 0 and failed on "Disposable secondary user required". Run in that user (round 7)
  // they answered "HTTPS required": their loopback HTTP fixture is admitted by a test-mocks app build only.
  for (const name of ["HostedProcessRestart", "HostedBackgroundWorker"]) {
    assert.equal(CLASS_REGISTRY[name].secondaryUser, true);
    assert.equal(CLASS_REGISTRY[name].requiresTestMocksBuild, true);
    assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--classes", name]), /needs a test-mocks app build/);
    assert.throws(() => parseInstrumentationArgs(["--test-mocks", "--classes", name]), /requires --owned-emulator/);
    assert.ok(!DEFAULT_CLASSES.includes(name), `${name} needs a test-mocks build, so it cannot be a default class`);
    const source = fs.readFileSync(`android/app/src/androidTest/java/ai/elizaresearch/alphaphone/${name}InstrumentedTest.java`, "utf8");
    assert.match(source, /isSystemUser\(\)/, `${name} still asserts a secondary user`);
  }
  assert.doesNotThrow(() => parseInstrumentationArgs([]));
  const run = async ({ lifecycle, classes = "Shell,HostedProcessRestart,HostedBackgroundWorker" }) => {
    const dir = apkDir(), emulator = fakeEmulator();
    // A test-mocks archive keeps both APKs beside the manifest.
    for (const variant of ["standalone", "launcher"]) fs.copyFileSync(path.join(dir, `instrumentation/${variant}-androidTest.apk`), path.join(dir, `${variant}-androidTest.apk`));
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, "apk-manifest.json"), "utf8")), testMocks: true }));
    try {
      const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "fixture-avd", "--serial", "emulator-5554", "--test-mocks", "--variants", "standalone", "--classes", classes, "--apk-dir", dir, "--output", path.join(dir, "out")]);
      let result, error;const observedUsers=[];const receiptFile=path.join(dir,"out/standalone/secondary-user.json");
      const observedAdb=(args,...rest)=>{if(args.includes("install-existing"))observedUsers.push(JSON.parse(fs.readFileSync(receiptFile,"utf8")).user);return emulator.adb(args,...rest);};
      try { result = await runLeased({ options, serial: "emulator-5554", adb: observedAdb, timing, withSecondaryUser: lifecycle }); } catch (failure) { error = failure; }
      return { result, error, commands: emulator.state.commands, observedUsers, savedLifecycle:fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,"utf8")):null };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  // The lifecycle the upstream helper provides: a user, the callback, then removal only with cleanup proof.
  const created = [];
  const lifecycle = async ({ name, record, run: body }) => {
    created.push(name); record({ user: 10, ownerRestored: false, removed: false });
    const proof = await body({ user: 10 });
    assert.equal(proof.cleaned, true, "the phase proves the user holds none of this run's packages");
    return { user: 10, ownerRestored: true, removed: true };
  };
  const passed = await run({ lifecycle });
  assert.equal(passed.error, undefined);
  assert.deepEqual(passed.observedUsers,[10,10],"user identity is durable before packages enter it");
  assert.equal(passed.savedLifecycle.removed,true);
  assert.equal(passed.result.passed, true, JSON.stringify([passed.result.secondaryUsers, passed.result.classes.map(row => [row.class, row.status, row.note])]));
  assert.deepEqual(passed.result.secondaryUsers, [{ variant: "standalone", user: 10, ownerRestored: true, removed: true }]);
  assert.match(created[0], /^instrumentation-standalone-\d+$/);
  const rows = Object.fromEntries(passed.result.classes.map(row => [row.class.split(".").at(-1), row.user]));
  assert.deepEqual(rows, { ShellInstrumentedTest: undefined, HostedProcessRestartInstrumentedTest: "secondary", HostedBackgroundWorkerInstrumentedTest: "secondary" });
  const inUser = passed.commands.filter(command => command.includes("--user 10"));
  assert.ok(inUser.indexOf(`shell cmd package install-existing --user 10 ${PACKAGE}`) < inUser.findIndex(command => command.includes("am instrument --user 10")), "packages reach the user before any class runs");
  assert.ok(inUser.includes(`shell cmd package install-existing --user 10 ${PACKAGE}.test`));
  assert.equal(inUser.filter(command => command.includes("am instrument --user 10") && !command.includes("-e log true") && command.includes("HostedProcessRestart")).length, 3, "each phase is its own instrumentation process in that user");
  assert.ok(inUser.includes(`shell pm clear --user 10 ${PACKAGE}`));
  assert.deepEqual(inUser.filter(command => command.startsWith("shell pm uninstall")), [`shell pm uninstall --user 10 ${PACKAGE}.test`, `shell pm uninstall --user 10 ${PACKAGE}`]);
  // The class that runs in user 0 never receives the user argument.
  assert.ok(passed.commands.filter(command => command.includes("Shell")).every(command => !command.includes("--user 10")));
  const denied = await run({ lifecycle, classes: "VoicePermissionDenied" });
  assert.ifError(denied.error);
  assert.equal(denied.result.passed, true);
  const reset = denied.commands.indexOf(`shell pm clear --user 10 ${PACKAGE}`);
  const revoke = denied.commands.indexOf(`shell pm revoke --user 10 ${PACKAGE} android.permission.RECORD_AUDIO`);
  const flags = denied.commands.indexOf(`shell pm clear-permission-flags --user 10 ${PACKAGE} android.permission.RECORD_AUDIO user-set user-fixed`);
  const launch = denied.commands.findIndex(command => command.includes("am instrument --user 10") && !command.includes("-e log true"));
  assert.ok(reset >= 0 && reset < revoke && revoke < flags && flags < launch);
  assert.equal(denied.savedLifecycle.removed, true);
  // A user that is not proven removed fails the run and names the classes that did not run.
  const kept = await run({ lifecycle: async ({ record }) => { record({ user: 11, ownerRestored: false, removed: false }); throw new Error("Owned user cleanup deferred; recover explicitly"); } });
  assert.equal(kept.result.passed, false);
  assert.equal(kept.savedLifecycle.user,11);assert.equal(kept.savedLifecycle.removed,false);
  assert.match(kept.savedLifecycle.error,/cleanup deferred/);
  assert.equal(kept.result.secondaryUsers[0].removed, false);
  assert.match(kept.result.secondaryUsers[0].error, /cleanup deferred/);
  assert.ok(kept.result.classes.filter(row => row.user === "secondary").every(row => row.status === "missing" && /secondary user phase failed/.test(row.note)));
  // Without the lifecycle (a caller that holds no lease) nothing is installed.
  const none = await run({ lifecycle: undefined });
  assert.match(none.error?.message ?? "", /disposable user lifecycle/);
  assert.ok(!none.commands.some(command => command.startsWith("install")));
});

test("voice denial permission setup is secondary-user scoped and clears refusal flags", () => {
  const spec = CLASS_REGISTRY.VoicePermissionDenied;
  assert.throws(() => parseInstrumentationArgs(["--classes", "VoicePermissionDenied"]), /requires --owned-emulator/);
  const options = parseInstrumentationArgs(["--owned-emulator", "--classes", "VoicePermissionDenied"]);
  assert.equal(options.classes[0], C("VoicePermissionDenied"));
  assert.ok(instrumentArgs(C("VoicePermissionDenied"), { user: "10" }).includes("voicePermissionDenied"));
  for (const user of [undefined, 0, "0", "-1", "all", "10;id"]) assert.throws(() => permissionRevocationCommands(spec, user), /secondary user/);
  assert.throws(() => permissionRevocationCommands({ ...spec, secondaryUser: false }, 10), /secondary user/);
  assert.deepEqual(permissionRevocationCommands(spec, 10), [
    ["shell", "pm", "revoke", "--user", "10", PACKAGE, "android.permission.RECORD_AUDIO"],
    ["shell", "pm", "clear-permission-flags", "--user", "10", PACKAGE, "android.permission.RECORD_AUDIO", "user-set", "user-fixed"],
  ]);
});

test("declared permissions are granted after isolation, and a failed listing is kept", () => {
  // First run: WorkflowApprovalNotice failed to post because nothing had granted the notification
  // permission its fixture requires. RealClock needs AOSP Clock's own notification permission.
  assert.deepEqual(CLASS_REGISTRY.WorkflowApprovalNotice.grant, ["POST_NOTIFICATIONS"]);
  assert.deepEqual(CLASS_REGISTRY.RealClock.grantOther, { "com.android.deskclock": ["POST_NOTIFICATIONS"] });
  const runner = fs.readFileSync("scripts/android-instrumentation.mjs", "utf8");
  const body = runner.slice(runner.indexOf("const runClass = (cls, { user } = {}) =>"));
  assert.ok(body.indexOf("classIsolationCommands(user)") < body.indexOf("spec.grant"), "grants follow the data clear, which revokes them");
  assert.ok(body.indexOf("spec.grant") < body.indexOf("spec.grantOther"));
  assert.match(body, /-listing\.txt/);
});

test("a class whose every method is skipped by its gate is recorded as skipped, a skipped phase as failed", async () => {
  // Round 7: BrowserDownload on a build without test mocks was recorded "failed" although the
  // verification guide promises "skipped" for a class skipped by its own assumption gate.
  const dir = apkDir(), emulator = fakeEmulator({ mode: "all-skipped" });
  try {
    const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "fixture-avd", "--serial", "emulator-5554", "--variants", "standalone", "--classes", "Shell,BrowserDownload", "--apk-dir", dir, "--output", path.join(dir, "out")]);
    const result = await runLeased({ options, serial: "emulator-5554", adb: emulator.adb, timing });
    assert.deepEqual(result.classes.map(row => [row.class.split(".").at(-1), row.status]), [["ShellInstrumentedTest", "passed"], ["BrowserDownloadInstrumentedTest", "skipped"]]);
    assert.equal(result.passed, false, "a skipped class is not a pass");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const runner = fs.readFileSync("scripts/android-instrumentation.mjs", "utf8");
  assert.match(runner, /row\.status === "passed" \? "passed" : spec\.phases \? "failed" : row\.status/);
});

test("provider identity is admitted before mutation and rechecked after cleanup", async()=>{
 const unknown=await homeRun("provider-unknown");
 assert.match(unknown.error.message,/WebView provider/);
 assert.deepEqual(stepsOf(unknown.state.commands),[]);
 const changed=await homeRun("provider-changing");
 assert.match(changed.error.message,/WebView provider changed/);
 assert.equal(changed.result,undefined);
 assert.equal(changed.providerFailure.passed,false);
 assert.equal(changed.providerFailure.kind,"post-run-provider-failure");
 assert.match(changed.providerFailure.error,/WebView provider changed/);
 assert.ok(changed.providerFailure.classes.length>0,"Preserve class evidence even though the campaign is invalid");
 assert.equal(changed.providerFailure.homeRestoration.restored,true);
 assert.equal(unknown.providerFailure,null,"Pre-admission failure has no completed evidence");
 assert.equal(changed.state.installed.size,0,"Owned APKs cleaned before post-run provider failure");
});


test("independent browser methods all run after fresh app-data reset and retain earlier failure", async () => {
  const dir=apkDir(), emulator=fakeEmulator(), cls=C("BrowserWebFeatures"), calls=[];
  try {
    // Exercise execution here; parser/build admission have separate flag tests.
    const options=parseInstrumentationArgs(["--owned-emulator","--avd","fixture-avd","--serial","emulator-5554","--variants","standalone","--classes","Shell","--apk-dir",dir,"--output",path.join(dir,"out")]);
    options.classes=[cls];
    const adb=args=>{
      const text=args.join(" ");
      if(text.includes("pm clear")){calls.push("clear");return "Success\n";}
      if(text.includes("am instrument")){
        if(text.includes("-e log true"))return block(cls,"first",1)+block(cls,"first",0)+block(cls,"second",1)+block(cls,"second",0)+done();
        const method=args[args.indexOf("class")+1].split("#")[1];calls.push(method);
        return block(cls,method,1)+block(cls,method,method==="first"?-2:0)+done();
      }
      return emulator.adb(args);
    };
    const result=await runLeased({options,serial:"emulator-5554",adb,timing});
    assert.deepEqual(calls,["clear","clear","first","clear","second"]);
    assert.equal(result.passed,false);
    assert.equal(result.classes[0].passed,1);
    assert.deepEqual(result.classes[0].failed,["first"]);
    assert.equal(result.classes[0].listed,2);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});


test("independent method skips remain visible and a later missing method cannot be hidden", async () => {
  for (const last of ["pass","missing"]) {
    const dir=apkDir(), emulator=fakeEmulator(), cls=C("SelectedDocument");
    try {
      const options=parseInstrumentationArgs(["--owned-emulator","--avd","fixture-avd","--serial","emulator-5554","--variants","standalone","--classes","SelectedDocument","--apk-dir",dir,"--output",path.join(dir,"out")]);
      const adb=args=>{
        const text=args.join(" ");
        if(text.includes("pm clear"))return "Success\n";
        if(text.includes("am instrument")){
          if(text.includes("-e log true"))return block(cls,"skip",1)+block(cls,"skip",0)+block(cls,"later",1)+block(cls,"later",0)+done();
          const method=args[args.indexOf("class")+1].split("#")[1];
          return method==="skip"?block(cls,method,1)+block(cls,method,-3)+done():last==="pass"?block(cls,method,1)+block(cls,method,0)+done():done();
        }
        return emulator.adb(args);
      };
      const result=await runLeased({options,serial:"emulator-5554",adb,timing});
      assert.deepEqual(result.classes[0].ignored,["skip"]);
      assert.equal(result.classes[0].status,last==="pass"?"passed":"missing");
      assert.equal(result.classes[0].passed,last==="pass"?1:0);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  }
});


test("unconfirmed class isolation aborts before instrumentation and cleans owned APKs", async () => {
  const dir=apkDir(), emulator=fakeEmulator();let invoked=false;
  try {
    const options=parseInstrumentationArgs(["--owned-emulator","--avd","fixture-avd","--serial","emulator-5554","--variants","standalone","--classes","SettingsNative","--apk-dir",dir,"--output",path.join(dir,"out")]);
    const adb=args=>{const command=args.join(" ");if(command.includes("pm clear"))return "Failed\n";if(command.includes("am instrument"))invoked=true;return emulator.adb(args);};
    await assert.rejects(runLeased({options,serial:"emulator-5554",adb,timing}),/Class app-data reset unconfirmed/);
    assert.equal(invoked,false);assert.equal(emulator.state.installed.size,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});


test("native recording deadline requires an owned isolated user and pre-start microphone grant",()=>{
 const spec=CLASS_REGISTRY.LocalVoiceRecordingLimit;
 assert.equal(spec.secondaryUser,true);
 assert.deepEqual(spec.grant,["RECORD_AUDIO"]);
 assert.deepEqual(spec.args,{localVoiceRecording:"1"});
 assert.throws(()=>parseInstrumentationArgs(["--classes","LocalVoiceRecordingLimit"]),/owned-emulator or --owned-cuttlefish/);
 const options=parseInstrumentationArgs(["--owned-cuttlefish","--image-fingerprint","fixture","--classes","LocalVoiceRecordingLimit"]);
 assert.deepEqual(options.classes,[C("LocalVoiceRecordingLimit")]);
 const args=instrumentArgs(C("LocalVoiceRecordingLimit"),{user:"10"});
 assert.equal(args[args.indexOf("localVoiceRecording")+1],"1");
 assert.equal(args[args.indexOf("--user")+1],"10");
 assert.ok(!DEFAULT_CLASSES.includes("LocalVoiceRecordingLimit"));
});


test("voice-note lifecycle uses fresh user and method storage with explicit tombstone fence",()=>{
 const spec=CLASS_REGISTRY.NoteAudio;
 assert.equal(spec.secondaryUser,true);assert.equal(spec.independentMethods,true);
 assert.deepEqual(spec.grant,["RECORD_AUDIO"]);assert.deepEqual(spec.args,{audioFence:"true"});
 assert.throws(()=>parseInstrumentationArgs(["--classes","NoteAudio"]),/owned-emulator or --owned-cuttlefish/);
 assert.deepEqual(parseInstrumentationArgs(["--owned-cuttlefish","--image-fingerprint","fixture","--classes","NoteAudio"]).classes,[C("NoteAudio")]);
 const args=instrumentArgs(C("NoteAudio"),{user:"10"});assert.equal(args[args.indexOf("audioFence")+1],"true");
 assert.ok(!DEFAULT_CLASSES.includes("NoteAudio"));
});

test("new provider fixtures requiring a secondary user are isolated by the campaign", () => {
  for (const name of ["ContactsCatalog", "PhotosLibrary"]) {
    assert.equal(CLASS_REGISTRY[name].secondaryUser, true);
    const source = fs.readFileSync(`android/app/src/androidTest/java/ai/elizaresearch/alphaphone/${name}InstrumentedTest.java`, "utf8");
    assert.match(source, /android\.os\.Process\.myUid\(\)\/100000>0/);
    assert.throws(() => parseInstrumentationArgs(["--classes", name]), /owned-emulator or --owned-cuttlefish/);
    assert.doesNotThrow(() => parseInstrumentationArgs(["--owned-cuttlefish", "--image-fingerprint", "fixture", "--classes", name]));
  }
});
