package ai.elizaresearch.alphaphone;

import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Pure policy for the in-app sign-in readiness probe (no Android classes, so it runs on a plain JVM).
 *
 * Product builds keep the Cloud sign-in hand-off (cli-session) until Cloud is ready for this phone's
 * in-app sign-in, so shipping Alpha before Cloud is configured never leaves a phone unable to sign
 * in. AlphaCloudSignInPlugin gathers these observations with a few small GETs (and one bodiless POST
 * that sends nothing) and caches the answer; any failure, timeout or unexpected answer is "not ready".
 *
 * In-app (email, and Google when the phone can receive its return) requires all of:
 * - Cloud's mobile App Auth registration for this client, environment and redirect URI
 *   (GET /api/v1/app-auth/mobile/config);
 * - Steward offering email without a captcha for email_otp (GET /steward/auth/providers), and the
 *   email code route existing (CloudEmailCode.SEND_PATH answers a bodiless POST with a 4xx other than
 *   404/405; no address is sent, so no email goes out).
 * The mobile config route also verifies that the registered app allows the exact return URL.
 * Email completes over native HTTPS and does not receive a browser callback. Google additionally
 * requires /.well-known/assetlinks.json to grant this package and installed certificate,
 * Steward's Google authorize route to admit the return URL, and Android to report this phone's
 * App Link verified (or selected by the user). Google readiness cannot hide ready native email.
 */
final class CloudSignInReadiness {
 private CloudSignInReadiness() {}
 /** Both methods ready: six hours. Partial or unavailable methods: re-check after ten minutes. */
 static final long READY_TTL_MS = 6 * 60 * 60 * 1000L;
 static final long NOT_READY_TTL_MS = 10 * 60 * 1000L;
 /** Each probe request is short; the renderer waits at most a few seconds before using the hand-off. */
 static final int REQUEST_TIMEOUT_MS = 4000;
 static final String HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";

 /** One assetlinks.json statement, already extracted from JSON. */
 static final class Statement {
  final List<String> relations; final String namespace, packageName; final List<String> fingerprints;
  Statement(List<String> relations, String namespace, String packageName, List<String> fingerprints) {
   this.relations = relations; this.namespace = namespace; this.packageName = packageName; this.fingerprints = fingerprints;
  }
 }
 /** Upper-case colon-separated SHA-256 (the assetlinks.json form), or null when not a SHA-256 digest. */
 static String fingerprint(String value) {
  if (value == null) return null;
  String hex = value.replace(":", "").toUpperCase(Locale.ROOT);
  if (!hex.matches("[0-9A-F]{64}")) return null;
  StringBuilder out = new StringBuilder();
  for (int i = 0; i < 64; i += 2) { if (i > 0) out.append(':'); out.append(hex, i, i + 2); }
  return out.toString();
 }
 static String certificateFingerprint(byte[] certificate) {
  try {
   byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate);
   StringBuilder hex = new StringBuilder();
   for (byte b : digest) hex.append(String.format("%02X", b & 0xff));
   return fingerprint(hex.toString());
  } catch (Exception unavailable) { return null; }
 }
 /** True when a statement grants handle_all_urls to exactly this package and one of its signing certificates. */
 static boolean assetLinksGrant(List<Statement> statements, String packageName, Set<String> signers) {
  if (statements == null || packageName == null || signers == null || signers.isEmpty()) return false;
  for (Statement statement : statements) {
   if (statement == null || statement.relations == null || !statement.relations.contains(HANDLE_ALL_URLS)) continue;
   if (!"android_app".equals(statement.namespace) || !packageName.equals(statement.packageName) || statement.fingerprints == null) continue;
   for (String listed : statement.fingerprints) { String normalized = fingerprint(listed); if (normalized != null && signers.contains(normalized)) return true; }
  }
  return false;
 }
 /** GET /api/v1/app-auth/mobile/config?clientId&environment&redirectUri answered for this exact binding. */
 static boolean registered(int status, Object success, String clientId, String environment, String redirectUri, String method, CloudSignInFlow.Environment expected) {
  return status == 200 && Boolean.TRUE.equals(success) && CloudSignInFlow.CLIENT_ID.equals(clientId)
   && expected.name.equals(environment) && expected.callback().equals(redirectUri) && "S256".equals(method);
 }
 /** Steward's authorize route admitted the return URL: it redirects to Google instead of refusing. */
 static boolean redirectAllowed(int status, String location) {
  return (status == 302 || status == 303 || status == 307) && location != null && location.startsWith("https://accounts.google.com/");
 }
 /** Steward offers email for the tenant, without a captcha this native client cannot answer. */
 static boolean emailOffered(int status, Object email, Object captchaEnabled, List<String> captchaRequiredFor) {
  if (status != 200 || !Boolean.TRUE.equals(email)) return false;
  return !(Boolean.TRUE.equals(captchaEnabled) && captchaRequiredFor != null && (captchaRequiredFor.contains("email_otp") || captchaRequiredFor.contains("email")));
 }
 static boolean googleOffered(int status, Object google) { return status == 200 && Boolean.TRUE.equals(google); }
 /** The email code route exists: a bodiless request is refused as invalid, not as unknown. */
 static boolean emailRoutePresent(int status) { return status >= 400 && status < 500 && status != 404 && status != 405; }

 /** The probe's answer. */
 static final class Result {
  final boolean inApp, google; final long until;
  Result(boolean inApp, boolean google, long until) { this.inApp = inApp; this.google = inApp && google; this.until = until; }
  static Result notReady(long now) { return new Result(false, false, now + NOT_READY_TTL_MS); }
  boolean fresh(long now) { return now < until && until - now <= READY_TTL_MS; }
  String serialize() { return "v2|" + inApp + "|" + google + "|" + until; }
  static Result parse(String value) {
   if (value == null) return null;
   String[] parts = value.split("\\|", -1);
   if (parts.length != 4 || !"v2".equals(parts[0])) return null;
   try { return new Result(Boolean.parseBoolean(parts[1]), Boolean.parseBoolean(parts[2]), Long.parseLong(parts[3])); }
   catch (Exception invalid) { return null; }
  }
 }
 static Result combine(boolean registered, boolean redirectAllowed, boolean assetLinks, boolean emailOffered, boolean emailRoute,
                       boolean googleOffered, boolean deviceVerified, long now) {
  boolean inApp = registered && emailOffered && emailRoute;
  boolean google = inApp && googleOffered && assetLinks && redirectAllowed && deviceVerified;
  return new Result(inApp, google, now + (google ? READY_TTL_MS : NOT_READY_TTL_MS));
 }
}
