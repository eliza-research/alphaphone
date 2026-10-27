package ai.elizaresearch.alphaphone;

/** Install the read-only native source callback before any resident service starts. */
public final class AlphaApplication extends android.app.Application {
 @Override protected void attachBaseContext(android.content.Context base){
  super.attachBaseContext(base);
  // Runs before ContentProvider/AndroidX Startup initialization, including WorkManager.
  // The provider-free reset recovery process shows the unfinished reset and must not stop itself.
  if(!android.os.Process.isIsolated()&&!resetRecoveryProcess()&&AlphaDataReset.pending(this)){ResetCloudRevocation.revoke(base,ResetCloudRevocation.PENDING_DEADLINE_MS);AlphaDataReset.admitAndExit(this);}
 }
 private boolean resetRecoveryProcess(){return (getPackageName()+ResetRecoveryActivity.PROCESS_SUFFIX).equals(getProcessName());}
 @Override public void onCreate(){
  super.onCreate();
  if(resetRecoveryProcess())return;NativeDigestHost host=new NativeDigestHost(this);NativeSourceHost.configure(host::read);NativeOwnerReminderHost owner=new NativeOwnerReminderHost(this);NativeSourceHost.configureOwnerReminderContext(owner::read);
  // Isolated helper processes have no app storage; only the main process keeps the problem log and schedules upkeep.
  if(android.os.Process.isIsolated()||!getPackageName().equals(getProcessName()))return;
  AlphaCrashLog.install(this);
  // Shared voice latency trials keep Alpha's existing timing document name and build identity.
  ai.eliza.voice.VoiceLatencyProbe.configureHost("alpha-native-voice-timing-v3",BuildConfig.ELIZA_SOURCE_COMMIT,BuildConfig.ELIZA_SOURCE_DIRTY,BuildConfig.FLAVOR+"-"+BuildConfig.BUILD_TYPE);
  try{NativeDeletionCoordinator.get(this).start();}catch(RuntimeException unavailable){/* Pending intents remain durable and visible on next foreground read. */}
  try{AlphaNoteAudioPlugin.scheduleTrashBackstop(this);}catch(RuntimeException unavailable){/* Retried on the next start; the renderer still purges Trash. */}
 }
}
