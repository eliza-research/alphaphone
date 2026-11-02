package android.content.pm;
public class PackageInstaller {
 public static final String EXTRA_STATUS="android.content.pm.extra.STATUS",EXTRA_SESSION_ID="android.content.pm.extra.SESSION_ID";
 public static final int STATUS_PENDING_USER_ACTION=-1,STATUS_FAILURE=1;
 public final java.util.List<Integer> sessions=new java.util.ArrayList<>(),abandoned=new java.util.ArrayList<>(),committed=new java.util.ArrayList<>();
 /** Runs while a session's bytes reach the disk, to destroy a bridge at that moment. */
 public Runnable staging=()->{};
 /** Runs inside commit, once updateSession names the session, to hold or fail it there. */
 public Runnable committing=()->{};
 private int next=40;
 public static class SessionParams {
  public static final int MODE_FULL_INSTALL=1;
  public SessionParams(int mode){}
  public void setAppPackageName(String name){}
  public void setSize(long size){}
 }
 public class Session implements java.io.Closeable {
  private final int id;Session(int id){this.id=id;}
  public java.io.OutputStream openWrite(String name,long offset,long length){return java.io.OutputStream.nullOutputStream();}
  public void fsync(java.io.OutputStream out){staging.run();}
  public void commit(android.content.IntentSender receiver){committing.run();committed.add(id);}
  @Override public void close(){}
 }
 public void abandonSession(int id){if(!sessions.remove((Integer)id))throw new SecurityException("No such session");abandoned.add(id);}
 public int createSession(SessionParams params){sessions.add(++next);return next;}
 public Session openSession(int id){return new Session(id);}
}
