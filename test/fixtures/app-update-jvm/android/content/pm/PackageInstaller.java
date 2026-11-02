package android.content.pm;
/**
 * What the update flow reaches of PackageInstallerSession and PackageInstallerService, transcribed from AOSP's android-10.0.0_r1
 * to android-17.0.0_r1 and chosen by sdk, not proved by them or on a device. A session is listed from createSession until
 * Android ends it. isActive() reads Android's count above zero: open +1, the first commit's validation +1, each confirmation
 * sent -1, close -1, install() on an accepted session +1 from sdk 34. A second commit skips validation's +1 and not the -1, so each one nets -1.
 */
public class PackageInstaller {
 public static final String EXTRA_STATUS="android.content.pm.extra.STATUS",EXTRA_SESSION_ID="android.content.pm.extra.SESSION_ID";
 public static final int STATUS_PENDING_USER_ACTION=-1,STATUS_SUCCESS=0,STATUS_FAILURE=1,STATUS_FAILURE_ABORTED=3;
 public final java.util.List<Integer> sessions=new java.util.ArrayList<>(),abandoned=new java.util.ArrayList<>(),committed=new java.util.ArrayList<>(),destroyed=new java.util.ArrayList<>();
 public final java.util.Map<Integer,Internal> internals=new java.util.HashMap<>();
 /** The device's Build.VERSION.SDK_INT: 29 is Android 10, Alpha's minimum, and 37 is Android 17, the production target. */
 public int sdk=37;
 /** Commits wait for validate, as a large APK's does. */
 public boolean validating;
 /** Runs while a session's bytes reach the disk, to destroy a bridge at that moment. */
 public Runnable staging=()->{};
 /** Runs inside commit, once the session has its owner, to hold or fail it there. */
 public Runnable committing=()->{};
 /** Runs as Android answers getMySessions, while each read waits on its session's lock: to destroy a bridge at that moment, or to let validation end. */
 public volatile Runnable listing=()->{};
 public boolean listDown,infoDown;
 private int next=40;
 /** Android's side of a session. progress: 0.8 once validated, 0.9 once native libraries are being prepared. validated: its commit is marked. onDisk: that mark as Android last wrote it. ended: past its last status, still listed. updated: Android never moves it on a non-staged session. */
 public static final class Internal {public int active;public boolean sealed,validated,onDisk,accepted,stageDirInUse,ended;public float progress;public long updated=System.currentTimeMillis();}
 public static class SessionParams {
  public static final int MODE_FULL_INSTALL=1;
  public SessionParams(int mode){}
  public void setAppPackageName(String name){}
  public void setSize(long size){}
 }
 /** What one read returned, not a view of the session. */
 public static class SessionInfo {
  private final int id;private final boolean sealed,active,committed;private final float progress;private final long updated;
  SessionInfo(int id,Internal internal,float progress){this.id=id;sealed=internal.sealed;active=internal.active>0;committed=internal.validated;this.progress=progress;updated=internal.updated;}
  public int getSessionId(){return id;}
  public boolean isSealed(){return sealed;}
  public boolean isActive(){return active;}
  public boolean isCommitted(){return committed;}
  public float getProgress(){return progress;}
  public long getUpdatedMillis(){return updated;}
 }
 public class Session implements java.io.Closeable {
  private final int id;Session(int id){this.id=id;}
  public java.io.OutputStream openWrite(String name,long offset,long length){return java.io.OutputStream.nullOutputStream();}
  public void fsync(java.io.OutputStream out){staging.run();}
  public void commit(android.content.IntentSender receiver){
   committing.run();
   Internal session=internals.get(id);
   if(session.ended)throw new IllegalStateException("Session gone");
   boolean again=session.sealed;
   session.sealed=true;committed.add(id);
   // Android 10 marks a commit before its first write. Later ones write first, so only a later write records the mark: from sdk 31 a second commit writes before it validates, so it records a mark already there.
   if(again&&sdk>=31)write();
   if(!validating)validate(id);
   if(sdk==29)write();
   // handleInstall on an accepted session sends no confirmation. Through sdk 33 it then ends the session at any stage: relinquished
   // up to 32, files in use on 33. It activates again from sdk 34; sdk 34 and 35 then stop at mVerificationInProgress, and 36 and 37
   // reach parseApk, which fails a session whose stage directory is in use and destroys it.
   if(session.accepted){
    if(sdk>=34)session.active++;
    if(sdk<=33||session.stageDirInUse&&sdk>=36)destroy(id);
   }
  }
  @Override public void close(){internals.get(id).active--;}
 }
 /** streamValidateAndCommit, which does nothing for a session already committed. */
 public void validate(int id){Internal session=internals.get(id);if(session.validated)return;session.validated=true;session.active++;session.progress=0.8f;}
 /** handleInstall sending the confirmation, for one commit: the session reads idle once its client has closed. */
 public void sendConfirmation(int id){Internal session=internals.get(id);if(session!=null)session.active--;}
 /** setPermissionsResult(true), which only posts the install to Android's one install thread. */
 public void accept(int id){internals.get(id).accepted=true;}
 /** handleInstall reaching an accepted session: activates it from sdk 34. */
 public void install(int id){if(sdk>=34)internals.get(id).active++;}
 /** Android preparing an accepted session's native libraries and verifying it, up to the install. */
 public void prepare(int id){Internal session=internals.get(id);session.progress=0.9f;session.stageDirInUse=true;}
 /** setSessionFailed or a rejected confirmation: the stage directory goes, and Android forgets the session. */
 public void destroy(int id){sessions.remove((Integer)id);destroyed.add(id);}
 public void abandonSession(int id){if(!sessions.remove((Integer)id))throw new SecurityException("No such session");abandoned.add(id);}
 public int createSession(SessionParams params){sessions.add(++next);internals.put(next,new Internal());write();return next;}
 public Session openSession(int id){if(!sessions.contains(id))throw new SecurityException("No such session");internals.get(id).active++;return new Session(id);}
 /** generateInfoInternal: validation holds the session's lock up to its mark, and a read waits for that lock. From sdk 33 it takes progress ahead of the lock, so one that waited pairs the mark with the progress from before it; through sdk 32 it takes both under the lock. */
 private SessionInfo read(int id,Runnable waiting){
  Internal session=internals.get(id);
  float progress=session.progress;
  waiting.run();
  return new SessionInfo(id,session,sdk>=33?progress:session.progress);
 }
 public SessionInfo getSessionInfo(int id){if(infoDown)throw new RuntimeException("DeadSystemException");return sessions.contains(id)?read(id,()->{}):null;}
 /** PackageInstallerService writing its session file. */
 public void write(){for(Internal session:internals.values())session.onDisk=session.validated;}
 /** A boot rereads that file: seals stay, a commit's mark is what was written, and progress, the count and an accept start over. */
 public void reboot(){
  android.os.SystemClock.booted=System.currentTimeMillis();
  for(Internal session:internals.values()){session.validated=session.onDisk;session.active=0;session.progress=0;session.accepted=session.stageDirInUse=false;session.updated=android.os.SystemClock.booted-60000;}
 }
 public java.util.List<SessionInfo> getMySessions(){
  if(listDown)throw new RuntimeException("DeadSystemException");
  java.util.List<SessionInfo> mine=new java.util.ArrayList<>();
  for(int id:new java.util.ArrayList<>(sessions))mine.add(read(id,listing));
  return mine;
 }
}
