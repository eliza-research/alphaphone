package ai.elizaresearch.alphaphone;

/** Install the read-only native source callback before any resident service starts. */
public final class AlphaApplication extends android.app.Application {
 @Override protected void attachBaseContext(android.content.Context base){
  super.attachBaseContext(base);
  // Runs before ContentProvider/AndroidX Startup initialization, including WorkManager.
  // The provider-free reset recovery process shows the unfinished reset and must not stop itself.
  // A pending reset revokes Cloud keys (bounded), retries and stops this process (shared DataReset).
  AlphaDataReset.RESET.admitBeforeStartup(base,getProcessName());
 }
 private boolean resetRecoveryProcess(){return AlphaDataReset.RESET.isRecoveryProcess(this,getProcessName());}
 @Override public void onCreate(){
  super.onCreate();
  if(resetRecoveryProcess())return;NativeDigestHost host=new NativeDigestHost(this);NativeSourceHost.configure(host::read);NativeOwnerReminderHost owner=new NativeOwnerReminderHost(this);NativeSourceHost.configureOwnerReminderContext(owner::read);
  // Isolated helper processes have no app storage; only the main process keeps the problem log and schedules upkeep.
  if(android.os.Process.isIsolated()||!getPackageName().equals(getProcessName()))return;
  AlphaCrashLog.install(this);
  try{NativeDeletionCoordinator.get(this).start();}catch(RuntimeException unavailable){/* Pending intents remain durable and visible on next foreground read. */}
  try{AlphaNoteAudioPlugin.scheduleTrashBackstop(this);}catch(RuntimeException unavailable){/* Retried on the next start; the renderer still purges Trash. */}
 }
}
