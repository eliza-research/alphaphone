package ai.elizaresearch.alphaphone;

/**
 * Explicit platform-protected Power entry. No intent filters and no caller-extra authority.
 * A cold/recreated instance opens only the surface; warm reuse delegates one-shot voice to the
 * existing owner/session-bound ElizaSense controller. Ordinary Assist remains surface-only.
 */
public final class AlphaPowerVoiceActivity extends AlphaAssistActivity {
 @Override protected boolean isProtectedPowerEntry() { return true; }
}
