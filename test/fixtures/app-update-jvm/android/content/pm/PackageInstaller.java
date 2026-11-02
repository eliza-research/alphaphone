package android.content.pm;
public class PackageInstaller {
 public static final String EXTRA_STATUS="android.content.pm.extra.STATUS",EXTRA_SESSION_ID="android.content.pm.extra.SESSION_ID";
 public static final int STATUS_PENDING_USER_ACTION=-1,STATUS_FAILURE=1;
 public final java.util.List<Integer> sessions=new java.util.ArrayList<>(),abandoned=new java.util.ArrayList<>(),committed=new java.util.ArrayList<>();
 private int next=40;
 public static class SessionInfo {
  private final int id;SessionInfo(int id){this.id=id;}
  public int getSessionId(){return id;}
 }
 public static class SessionParams {
  public static final int MODE_FULL_INSTALL=1;
  public SessionParams(int mode){}
  public void setAppPackageName(String name){}
  public void setSize(long size){}
 }
 public class Session implements java.io.Closeable {
  private final int id;Session(int id){this.id=id;}
  public java.io.OutputStream openWrite(String name,long offset,long length){return java.io.OutputStream.nullOutputStream();}
  public void fsync(java.io.OutputStream out){}
  public void commit(android.content.IntentSender receiver){committed.add(id);}
  @Override public void close(){}
 }
 public java.util.List<SessionInfo> getMySessions(){java.util.List<SessionInfo> mine=new java.util.ArrayList<>();for(int id:sessions)mine.add(new SessionInfo(id));return mine;}
 public void abandonSession(int id){sessions.remove((Integer)id);abandoned.add(id);}
 public int createSession(SessionParams params){sessions.add(++next);return next;}
 public Session openSession(int id){return new Session(id);}
}
