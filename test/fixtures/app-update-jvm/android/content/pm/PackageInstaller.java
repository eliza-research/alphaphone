package android.content.pm;
/**
 * What the update flow reads of Android: a session is listed from createSession until Android ends it, and a commit
 * seals it. Taken from AOSP's PackageInstallerSession and PackageInstallerService, not proved by them.
 */
public class PackageInstaller {
 public static final String EXTRA_STATUS="android.content.pm.extra.STATUS",EXTRA_SESSION_ID="android.content.pm.extra.SESSION_ID";
 public static final int STATUS_PENDING_USER_ACTION=-1,STATUS_SUCCESS=0,STATUS_FAILURE=1,STATUS_FAILURE_ABORTED=3;
 public final java.util.List<Integer> sessions=new java.util.ArrayList<>(),abandoned=new java.util.ArrayList<>(),committed=new java.util.ArrayList<>();
 /** Sealed by a commit; of those, the ones Android is still working on and the ones it has not yet validated. */
 public final java.util.Set<Integer> sealed=new java.util.HashSet<>(),working=new java.util.HashSet<>(),unvalidated=new java.util.HashSet<>();
 /** Runs while a session's bytes reach the disk, to destroy a bridge at that moment. */
 public Runnable staging=()->{};
 /** Runs inside commit, once the session has its owner, to hold or fail it there. */
 public Runnable committing=()->{};
 public boolean listDown;
 private int next=40;
 public static class SessionParams {
  public static final int MODE_FULL_INSTALL=1;
  public SessionParams(int mode){}
  public void setAppPackageName(String name){}
  public void setSize(long size){}
 }
 public static class SessionInfo {
  private final int id;private final boolean sealed,active,committed;
  SessionInfo(int id,boolean sealed,boolean active,boolean committed){this.id=id;this.sealed=sealed;this.active=active;this.committed=committed;}
  public int getSessionId(){return id;}
  public boolean isSealed(){return sealed;}
  public boolean isActive(){return active;}
  public boolean isCommitted(){return committed;}
 }
 public class Session implements java.io.Closeable {
  private final int id;Session(int id){this.id=id;}
  public java.io.OutputStream openWrite(String name,long offset,long length){return java.io.OutputStream.nullOutputStream();}
  public void fsync(java.io.OutputStream out){staging.run();}
  public void commit(android.content.IntentSender receiver){committing.run();sealed.add(id);working.add(id);committed.add(id);}
  @Override public void close(){}
 }
 public void abandonSession(int id){if(!sessions.remove((Integer)id))throw new SecurityException("No such session");abandoned.add(id);}
 public int createSession(SessionParams params){sessions.add(++next);return next;}
 public Session openSession(int id){if(!sessions.contains(id))throw new SecurityException("No such session");return new Session(id);}
 public java.util.List<SessionInfo> getMySessions(){
  if(listDown)throw new RuntimeException("DeadSystemException");
  java.util.List<SessionInfo> mine=new java.util.ArrayList<>();
  for(int id:sessions)mine.add(new SessionInfo(id,sealed.contains(id),working.contains(id),sealed.contains(id)&&!unvalidated.contains(id)));
  return mine;
 }
}
