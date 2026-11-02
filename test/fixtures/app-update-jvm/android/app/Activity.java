package android.app;
public class Activity {
 public final java.util.List<android.content.Intent> started=new java.util.ArrayList<>();
 public androidx.lifecycle.Lifecycle.State state=androidx.lifecycle.Lifecycle.State.RESUMED;
 public androidx.lifecycle.Lifecycle getLifecycle(){return new androidx.lifecycle.Lifecycle(state);}
 public void startActivity(android.content.Intent intent){started.add(intent);}
 public void runOnUiThread(Runnable work){work.run();}
}
