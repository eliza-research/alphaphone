package ai.elizaresearch.alphaphone;

import ai.eliza.auth.cloud.CloudCredentialSlots;
import ai.eliza.auth.cloud.CloudSignInConfig;
import ai.eliza.auth.cloud.CloudSignInEnvironment;
import ai.eliza.auth.cloud.CloudSignInPlugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Alpha's registration of the shared native Eliza Cloud sign-in client (elizaOS/eliza
 * packages/auth/android, {@link CloudSignInPlugin}). The client owns email/SMS codes, native Google,
 * MFA, the mobile App Auth tail, acknowledgement resume, replaced-key revocation and readiness. Alpha
 * supplies only its registration: the `ai.elizaresearch.alphaphone` App Auth client and its
 * `/alphaphone/auth/callback` return, the configured deployments (staging only in
 * ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds), its product name, the installed storage names below and its
 * Keystore credential store. The minted key follows the resident's credential-intent rule.
 *
 * The `cloud:<environment>` slot stays renderer-readable, as the Cloud sign-in hand-off's key always
 * was; the pending and receipt slots are native-only (RendererCredentialSlots).
 */
@CapacitorPlugin(name = "AlphaCloudSignIn")
public final class AlphaCloudSignInPlugin extends CloudSignInPlugin {
 /** Installed names: compatibility identifiers of existing sign-ins on this phone. */
 static final String PENDING_SLOT = "cloud-signin:v1:pending";
 static final String CALLBACK_PATH = "/alphaphone/auth/callback";
 static final CloudSignInConfig REGISTRATION = registration(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);

 static CloudSignInConfig registration(boolean testMocks) {
  CloudSignInConfig.Builder builder = CloudSignInConfig.builder()
   .clientId("ai.elizaresearch.alphaphone").deviceName("Alpha Phone").productName("Alpha Phone").googleClientId("alpha-phone")
   .logTag("AlphaCloudSignIn").readinessPreferences("alpha-cloud-signin-readiness-" + CloudDeployment.STORAGE_NAMESPACE)
   .pendingSlot(PENDING_SLOT).receiptSlotPrefix("cloud-signin:v1:ack:").credentialSlotPrefix("cloud:")
   .environment(new CloudSignInEnvironment("production", CloudDeployment.PRODUCTION_API_HOST, CloudDeployment.PRODUCTION_WEB_HOST,
    CloudDeployment.PRODUCTION_TENANT, CloudDeployment.PRODUCTION_NAME, CALLBACK_PATH));
  if (testMocks) builder.environment(new CloudSignInEnvironment("staging", CloudDeployment.STAGING_API_HOST, CloudDeployment.STAGING_WEB_HOST,
   CloudDeployment.STAGING_TENANT, CloudDeployment.STAGING_NAME, CALLBACK_PATH));
  return builder.build();
 }
 static String receiptSlot(CloudSignInEnvironment environment) { return REGISTRATION.receiptSlot(environment); }

 @Override protected CloudSignInConfig registration() { return REGISTRATION; }
 @Override protected CloudCredentialSlots credentials(Runnable guard) {
  AlphaCredentialStore store = new AlphaCredentialStore(getContext(), guard);
  return new CloudCredentialSlots() {
   @Override public String read(String slot) throws Exception { return store.readCredentialSlot(slot); }
   @Override public void write(String slot, String value) throws Exception { store.writeCredentialSlot(slot, value); }
   @Override public void remove(String slot) throws Exception { store.removeCredentialSlot(slot); }
  };
 }
 @Override protected Runnable reserveCredentialCommit() {
  long intent = AlphaLocalAgentPlugin.reserveCredentialIntent();
  return () -> AlphaLocalAgentPlugin.requireCredentialIntent(intent);
 }
}
