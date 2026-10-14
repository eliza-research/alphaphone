export const clockActions = ["SET_ALARM", "SHOW_ALARMS", "SNOOZE_ALARM", "DISMISS_ALARM"];
export const clockProductRequirement = "\n# Alpha MVP delegates alarms to the real AOSP Clock provider.\nPRODUCT_PACKAGES += DeskClock\n";

/** Read-only image admission. Handler availability does not prove ringing. */
export function verifyAospClockHandlers(run, user, expectedFingerprint) {
  if (!/^(0|[1-9]\d*)$/.test(user || "")) throw Error("Explicit Android user required");
  if (!expectedFingerprint?.trim()) throw Error("Explicit expected image fingerprint required (ALPHA_EXPECTED_IMAGE_FINGERPRINT)");
  const fingerprint = run("shell", "getprop", "ro.build.fingerprint").trim();
  if (fingerprint !== expectedFingerprint) throw Error("Image fingerprint differs from expected target");
  const installed = run("shell", "pm", "list", "packages", "--user", user, "-s", "-e", "com.android.deskclock");
  if (!installed.split(/\r?\n/).includes("package:com.android.deskclock")) {
    throw Error("Required system AOSP DeskClock is not enabled for the selected user");
  }
  const handlers = {};
  for (const action of clockActions) {
    const output = run("shell", "cmd", "package", "query-activities", "--brief", "--components", "--user", user,
      "-a", `android.intent.action.${action}`, "-c", "android.intent.category.DEFAULT", "-p", "com.android.deskclock");
    const matches = output.trim().split(/\r?\n/).filter(line => /^com\.android\.deskclock\/[A-Za-z0-9_.$]+$/.test(line.trim()));
    if (!matches.length) throw Error(`Required Clock handler missing: ${action}`);
    handlers[action] = matches.map(line => line.trim());
  }
  return { user, fingerprint, packageName: "com.android.deskclock", handlers, ringingVerified: false };
}
