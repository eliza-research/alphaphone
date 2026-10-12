package ai.elizaresearch.alphaphone;

/** Install the read-only native source callback before any resident service starts. */
public final class AlphaApplication extends android.app.Application {
 @Override protected void attachBaseContext(android.content.Context base){
  super.attachBaseContext(base);
  // Runs before ContentProvider/AndroidX Startup initialization, including WorkManager.
  if(!android.os.Process.isIsolated()&&AlphaDataReset.pending(this))AlphaDataReset.dispatchAndExit(this);
 }
 @Override public void onCreate(){
  super.onCreate();NativeDigestHost host=new NativeDigestHost(this);NativeSourceHost.configure(host::read);NativeOwnerReminderHost owner=new NativeOwnerReminderHost(this);NativeSourceHost.configureOwnerReminderContext(owner::read);
  // Isolated helper processes have no app storage; only the main process keeps the problem log and schedules upkeep.
  if(android.os.Process.isIsolated()||!getPackageName().equals(getProcessName()))return;
  AlphaCrashLog.install(this);
  try{AlphaNoteAudioPlugin.scheduleTrashBackstop(this);}catch(RuntimeException unavailable){/* Retried on the next start; the renderer still purges Trash. */}
 }
}
