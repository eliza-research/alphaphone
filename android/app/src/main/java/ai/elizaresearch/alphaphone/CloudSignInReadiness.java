package ai.elizaresearch.alphaphone;

import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Native email readiness depends on mobile registration and the email-code service.
 * Google additionally requires an admitted redirect and a verified App Link for this signer.
 * Missing Google infrastructure must never disable native email or trigger hosted login.
 */
final class CloudSignInReadiness {
 private CloudSignInReadiness() {}
 /** A positive answer is reused for six hours; a negative one is re-checked after ten minutes. */
 static final long READY_TTL_MS = 6 * 60 * 60 * 1000L;
 static final long NOT_READY_TTL_MS = 10 * 60 * 1000L;
 /** Each probe request is short; the renderer waits at most a few seconds before offering email alone. */
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
  return new Result(inApp, googleOffered && redirectAllowed && assetLinks && deviceVerified, now + (inApp ? READY_TTL_MS : NOT_READY_TTL_MS));
 }
}
