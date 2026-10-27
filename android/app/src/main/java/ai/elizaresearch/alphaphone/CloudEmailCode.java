package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

/**
 * The one adapter for Eliza Cloud's in-app email sign-in code (elizaOS/eliza PR #36260): the code is
 * sent to the address and typed into Alpha; no magic link and no hosted Eliza Cloud page is involved.
 *
 * Paths and body shapes live only here (and in config/cloud-email-code.json, which the development
 * browser bridge reads and test/cloud-sign-in-flow.test.mjs pins to these constants). If Cloud's
 * final routes differ, this class and that file are the whole change.
 *
 * send:   POST {api}/steward/auth/email/code/send   {email, tenantId, client, pkce:{codeChallenge, codeChallengeMethod}}
 * verify: POST {api}/steward/auth/email/code/verify {email, code, tenantId, client, pkce:{codeVerifier}}
 *
 * The PKCE pair binds the verify call to the phone that asked for the code; the verifier never leaves
 * native memory except in that verify body.
 */
final class CloudEmailCode {
 private CloudEmailCode() {}
 static final String SEND_PATH = "/steward/auth/email/code/send";
 static final String VERIFY_PATH = "/steward/auth/email/code/verify";

 static JSONObject sendBody(CloudSignInFlow.Environment environment, String email, String verifier) throws Exception {
  return new JSONObject().put("email", email).put("tenantId", environment.tenant).put("client", CloudSignInFlow.CLIENT_ID)
   .put("pkce", new JSONObject().put("codeChallenge", CloudSignInFlow.s256(verifier)).put("codeChallengeMethod", "S256"));
 }
 static JSONObject verifyBody(CloudSignInFlow.Environment environment, String email, String code, String verifier) throws Exception {
  return new JSONObject().put("email", email).put("code", code).put("tenantId", environment.tenant).put("client", CloudSignInFlow.CLIENT_ID)
   .put("pkce", new JSONObject().put("codeVerifier", verifier));
 }
 /** When the code stops working: the server's expiresAt when present, never later than 15 minutes, 10 minutes when absent. */
 static long expiresAt(Object reported, long now) {
  long value = reported instanceof Number ? ((Number) reported).longValue() : 0;
  if (value == 0 && reported instanceof String) try { value = java.time.Instant.parse((String) reported).toEpochMilli(); } catch (Exception invalid) { value = 0; }
  if (value <= 0) return now + 10 * 60 * 1000L;
  return Math.min(value, now + 15 * 60 * 1000L);
 }
 /** Never shorten a server resend timestamp or Retry-After header. No timer sends automatically. */
 static long resendAt(Object reported, String retryAfter, long now) {
  long result = now + CloudSignInFlow.RESEND_COOLDOWN_MS;
  long timestamp = reported instanceof Number ? ((Number) reported).longValue() : 0;
  if (reported instanceof String) try { timestamp = java.time.Instant.parse((String) reported).toEpochMilli(); } catch (Exception invalid) { /* Use the local minimum. */ }
  result = Math.max(result, timestamp);
  if (retryAfter != null) try {
   String value = retryAfter.trim();
   long deadline = value.matches("[0-9]{1,9}") ? now + Long.parseLong(value) * 1000L
    : java.time.ZonedDateTime.parse(value, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli();
   result = Math.max(result, deadline);
  } catch (Exception invalid) { /* A malformed header cannot shorten the local or server deadline. */ }
  return result;
 }
}
