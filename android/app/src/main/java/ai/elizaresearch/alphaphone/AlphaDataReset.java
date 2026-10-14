package ai.elizaresearch.alphaphone;

import android.app.ActivityManager;
import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;

/** Android owns the package-scoped deletion, process stop, jobs, alarms and Keystore cleanup.
 * A persisted request retries before app initialization if interrupted before system dispatch.
 * This marker does not make Android's multi-step storage deletion filesystem-atomic. */
final class AlphaDataReset {
 private static AtomicFile marker(Context context){return new AtomicFile(new File(context.createDeviceProtectedStorageContext().getNoBackupFilesDir(),"reset-alpha.pending"));}
 static boolean pending(Context context){AtomicFile file=marker(context);return file.getBaseFile().exists()||new File(file.getBaseFile().getPath()+".bak").exists();}
 static void record(Context context)throws Exception{
  AtomicFile file=marker(context);FileOutputStream out=null;
  try{out=file.startWrite();out.write(new byte[]{1});out.getFD().sync();file.finishWrite(out);out=null;
   java.io.FileDescriptor directory=android.system.Os.open(file.getBaseFile().getParent(),android.system.OsConstants.O_RDONLY,0);
   try{android.system.Os.fsync(directory);}finally{android.system.Os.close(directory);}
  }finally{if(out!=null)file.failWrite(out);}
 }
 /** Never resumes the old runtime, including when Android refuses or the Binder call fails. */
 static void dispatchAndExit(Context context){
  try{if(!AlphaListenerPlugin.resetForData(context))throw new IllegalStateException("Listener reset not acknowledged");
   ActivityManager manager=context.getSystemService(ActivityManager.class);if(manager!=null)manager.clearApplicationUserData();}
  catch(RuntimeException failure){android.util.Log.w("AlphaReset","Android reset request unavailable; retry on next launch");}
  finally{android.os.Process.killProcess(android.os.Process.myPid());System.exit(0);}
 }
 private AlphaDataReset(){}
}
