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
 private String invocation;
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
 }
 /** The only extra: a product-set launch flag the renderer may read. Caller extras are dropped. */
 static final String EXTRA_ASSISTANT = "alpha.assistant";
 /**
  * Reads and consumes this launch's origin: {@link AssistInvocation#LISTENER} is returned at most
  * once per launch, then {@link AssistInvocation#ASSIST}, so a consumer that starts a voice turn on
  * it cannot fire twice.
  */
 synchronized String takeInvocation() {
  String origin = AssistInvocation.LISTENER.equals(invocation) ? AssistInvocation.LISTENER : AssistInvocation.ASSIST;
  invocation = AssistInvocation.ASSIST;
  return origin;
 }
 /**
  * The caller package is known only when the caller shared its identity (the listener does). The
  * origin comes from Android-reported caller identity only, never from caller extras.
  */
 private Intent cleanIntent(String caller) {
  boolean sameSigner = caller != null && getPackageManager().checkSignatures(getPackageName(), caller) == PackageManager.SIGNATURE_MATCH;
  synchronized (this) { invocation = AssistInvocation.origin(caller, sameSigner); }
  return new Intent(this, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST).putExtra(EXTRA_ASSISTANT, true);
 }
}
