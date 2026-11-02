package android.content.pm;
/**
 * What the update flow reaches of PackageInstallerSession and PackageInstallerService, transcribed from AOSP's android-13.0.0_r1
 * to android-17.0.0_r1 and chosen by sdk, not proved by them or on a device. A session is listed from createSession until
 * Android ends it. isActive() reads Android's count above zero: open +1, the first commit's validation +1, each confirmation
 * sent -1, close -1, an accept +1 from sdk 34. A second commit skips validation's +1 and not the -1, so each one nets -1.
 */
public class PackageInstaller {
 public static final String EXTRA_STATUS="android.content.pm.extra.STATUS",EXTRA_SESSION_ID="android.content.pm.extra.SESSION_ID";
 public static final int STATUS_PENDING_USER_ACTION=-1,STATUS_SUCCESS=0,STATUS_FAILURE=1,STATUS_FAILURE_ABORTED=3;
 public final java.util.List<Integer> sessions=new java.util.ArrayList<>(),abandoned=new java.util.ArrayList<>(),committed=new java.util.ArrayList<>(),destroyed=new java.util.ArrayList<>();
 public final java.util.Map<Integer,Internal> internals=new java.util.HashMap<>();
 /** The device's Build.VERSION.SDK_INT: 33 is Android 13, 37 is Android 17, the production target. */
 public int sdk=37;
 /** Commits wait for validate, as a large APK's does. */
 public boolean validating;
 /** Runs while a session's bytes reach the disk, to destroy a bridge at that moment. */
 public Runnable staging=()->{};
 /** Runs inside commit, once the session has its owner, to hold or fail it there. */
 public Runnable committing=()->{};
 public boolean listDown,infoDown;
 private int next=40;
 /** Android's side of a session. progress: 0.8 once validated, 0.9 once native libraries are being prepared. */
 public static final class Internal {public int active;public boolean sealed,validated,accepted,stageDirInUse;public float progress;}
 public static class SessionParams {
  public static final int MODE_FULL_INSTALL=1;
  public SessionParams(int mode){}
  public void setAppPackageName(String name){}
  public void setSize(long size){}
 }
 public static class SessionInfo {
  private final int id;private final Internal internal;
  SessionInfo(int id,Internal internal){this.id=id;this.internal=internal;}
  public int getSessionId(){return id;}
  public boolean isSealed(){return internal.sealed;}
  public boolean isActive(){return internal.active>0;}
  public boolean isCommitted(){return internal.validated;}
  public float getProgress(){return internal.progress;}
 }
 public class Session implements java.io.Closeable {
  private final int id;Session(int id){this.id=id;}
  public java.io.OutputStream openWrite(String name,long offset,long length){return java.io.OutputStream.nullOutputStream();}
  public void fsync(java.io.OutputStream out){staging.run();}
  public void commit(android.content.IntentSender receiver){
   committing.run();
   Internal session=internals.get(id);
   session.sealed=true;committed.add(id);
   if(!validating)validate(id);
   // handleInstall on an accepted session sends no confirmation. It activates again from sdk 34; sdk 34 and 35 then stop at
   // mVerificationInProgress, and the others reach parseApk, which fails a session whose stage directory is in use and destroys it.
   if(session.accepted){
    if(sdk>=34)session.active++;
    if(session.stageDirInUse&&sdk!=34&&sdk!=35)destroy(id);
   }
  }
  @Override public void close(){internals.get(id).active--;}
 }
 /** streamValidateAndCommit, which does nothing for a session already committed. */
 public void validate(int id){Internal session=internals.get(id);if(session.validated)return;session.validated=true;session.active++;session.progress=0.8f;}
 /** handleInstall sending the confirmation, for one commit: the session reads idle once its client has closed. */
 public void sendConfirmation(int id){Internal session=internals.get(id);if(session!=null)session.active--;}
 /** setPermissionsResult(true). */
 public void accept(int id){Internal session=internals.get(id);session.accepted=true;if(sdk>=34)session.active++;}
 /** Android preparing an accepted session's native libraries and verifying it, up to the install. */
 public void prepare(int id){Internal session=internals.get(id);session.progress=0.9f;session.stageDirInUse=true;}
 /** setSessionFailed or a rejected confirmation: the stage directory goes, and Android forgets the session. */
 public void destroy(int id){sessions.remove((Integer)id);destroyed.add(id);}
 public void abandonSession(int id){if(!sessions.remove((Integer)id))throw new SecurityException("No such session");abandoned.add(id);}
 public int createSession(SessionParams params){sessions.add(++next);internals.put(next,new Internal());return next;}
 public Session openSession(int id){if(!sessions.contains(id))throw new SecurityException("No such session");internals.get(id).active++;return new Session(id);}
 public SessionInfo getSessionInfo(int id){if(infoDown)throw new RuntimeException("DeadSystemException");return sessions.contains(id)?new SessionInfo(id,internals.get(id)):null;}
 public java.util.List<SessionInfo> getMySessions(){
  if(listDown)throw new RuntimeException("DeadSystemException");
  java.util.List<SessionInfo> mine=new java.util.ArrayList<>();
  for(int id:sessions)mine.add(new SessionInfo(id,internals.get(id)));
  return mine;
 }
}
