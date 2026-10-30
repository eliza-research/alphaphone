package ai.elizaresearch.alphaphone;

/** Public credential storage must not bypass native journal/provider state machines. */
final class RendererCredentialSlots {
 private static final String[] NATIVE_NAMESPACES = {
  "canonical-notification-owner", "gmail-background", "native-calendar-sync", "native-delete-journal", "native-delete-installation", "native-digest-source", "resident-results", "local-agent-provider", "workflow-notice-taps",
  "workflow-notice-delivery", "workflow-notice-owner", "workflow-approval-notices", "action-journal", "hosted-background",
  "hosted-digests", "hosted-notices", "note-audio-metadata", "reminder-taps",
  // In-app Cloud sign-in: the pending Google PKCE record and the key acknowledgement receipt.
  "cloud-signin", "google-workspace-return",
  // Physical deployment slots are native-owned. Renderer calls must use logical names.
  "cloud-deployment"
 };
 static String requireAllowed(String slot) {
  if (slot == null || slot.isEmpty() || slot.length() > 1024) throw new SecurityException("Invalid credential slot");
  for (String namespace : NATIVE_NAMESPACES)
   if (slot.equals(namespace) || slot.startsWith(namespace + ":")) throw new SecurityException("Native-only credential slot");
  return slot;
 }
}
