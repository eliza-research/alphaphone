package ai.elizaresearch.alphaphone;

import android.app.ComponentCaller;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.RequiresApi;

/** User-invoked assistant surface. Never consumes caller text, URI, or assist context. */
public final class AlphaAssistActivity extends MainActivity {
 @Override protected boolean isAssistantSurface() { return true; }
 private String newIntentCaller;
 /** This launch's origin until the renderer takes it; see {@link #takeInvocation}. */
 /** Window event the renderer listens for: a new invocation reached the already open surface. */
 static final String INVOCATION_EVENT = "alpha:assist-invocation";
 @Override public void onCreate(Bundle state) {
  // A recreated activity (configuration change, process restore) is not a new invocation: the
  // launching package Android reports is still the original one, so it is ignored.
  setIntent(cleanIntent(state == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? getLaunchedFromPackage() : null));
  super.onCreate(state);
 }
 /** Android 15+ reports who sent each new intent to this single-task surface. */
 @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
 @Override public void onNewIntent(Intent intent, ComponentCaller caller) {
  newIntentCaller = caller == null ? null : caller.getPackage();
  super.onNewIntent(intent, caller);
 }
 @Override public void onNewIntent(Intent ignored) {
  Intent clean = cleanIntent(newIntentCaller);
  newIntentCaller = null;
  setIntent(clean);
  super.onNewIntent(clean);
  // The surface may already be in front (no visibility change): tell the renderer to read it now.
  if (getBridge() != null) getBridge().triggerWindowJSEvent(INVOCATION_EVENT);
 }
 /** The only extra: a product-set launch flag the renderer may read. Caller extras are dropped. */
 static final String EXTRA_ASSISTANT = "alpha.assistant";
 /**
  * Legacy Agent read: no owner-bound session accompanies this method, so it is a navigation
  * hint only. ElizaSense owns authenticated, one-shot wake consumption.
  */
 synchronized String takeInvocation() {
  // Legacy Agent callers lack an owner-bound session; only the shared ElizaSense bridge
  // can consume a wake as microphone authority. Keep this old method as a UI-only hint.
  return "assist";
 }
 /**
  * The caller package is known only when the caller shared its identity (the listener does). The
  * origin comes from Android-reported caller identity only, never from caller extras.
  */
 private Intent cleanIntent(String caller) {
  new ai.eliza.plugins.system.SenseListenerClient(this).recordInvocation(caller);
  return new Intent(this, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST).putExtra(EXTRA_ASSISTANT, true);
 }
}
