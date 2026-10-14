package ai.elizaresearch.alphaphone.sense;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import android.os.UserManager;
import android.service.quicksettings.TileService;

/**
 * Process-wide listener coordination: gathers the policy inputs and starts or stops the
 * microphone service to match. Every control path (consent screen, notification, Quick Settings,
 * Alpha's control provider, unlock, process start) ends in {@link #refresh}.
 */
final class Listener {
 private Listener(){}
 static final String ALPHA_PACKAGE="ai.elizaresearch.alphaphone";
 static final String CONTROL_PERMISSION="ai.elizaresearch.alphaphone.sense.permission.LISTENER_CONTROL";

 // Observed by the running service; reset whenever capture stops so a stale value never blocks or admits capture.
 static volatile boolean inCall,otherAppRecording,micSilenced,speechUnavailable;

 static ListenerPolicy.Inputs inputs(Context context){
  ListenerStore store=new ListenerStore(context);
  ListenerPolicy.Inputs in=new ListenerPolicy.Inputs();
  in.consentVersion=store.consentVersion();
  in.enabled=store.enabled();
  in.recordAudioGranted=context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;
  in.notificationsVisible=ListenerNotifications.indicatorVisible(context);
  in.crashLoopTripped=store.crashLoopTripped();
  UserManager users=context.getSystemService(UserManager.class);
  in.userUnlocked=users!=null&&users.isUserUnlocked();
  in.userForeground=userForeground(users);
  in.speechUnavailable=speechUnavailable;
  in.pausedUntilMs=store.pausedUntil();
  in.inCall=inCall;
  in.otherAppRecording=otherAppRecording;
  in.micSilenced=micSilenced;
  return in;
 }

 /** The listener's user (the primary user) is the one using the phone. Unknown counts as not. */
 private static boolean userForeground(UserManager users){
  try{return users!=null&&users.isUserForeground();}catch(RuntimeException unavailable){return false;}
 }

 /** Pause deadlines are on the monotonic clock, so a wall-clock change cannot end a pause early. */
 static ListenerPolicy.State state(Context context){return ListenerPolicy.decide(inputs(context),SystemClock.elapsedRealtime());}

 static final ListeningEpoch epoch=new ListeningEpoch();

 static synchronized void refresh(Context context){
  // Invalidate synchronously with the control, before Android delivers service lifecycle events.
  epoch.invalidate();
  Context app=context.getApplicationContext();
  ListenerPolicy.State state=state(app);
  Intent service=new Intent(app,ListeningService.class);
  if(ListenerPolicy.foreground(state))app.startForegroundService(service);
  else app.stopService(service);
  ListenerNotifications.showStatus(app,state);
  try{TileService.requestListeningState(app,new ComponentName(app,ListenerTileService.class));}catch(RuntimeException unavailable){}
 }
}
