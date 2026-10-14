import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
test('pending reset retries before startup callbacks; accepted, refused and failed dispatch never resumes old runtime',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-reset-startup-')),sources=[];
 const put=(name,body)=>{const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);sources.push(path);};
 const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  put('android/content/Context.java',`package android.content; public class Context { public static java.io.File data; public static android.app.ActivityManager manager=new android.app.ActivityManager(); public Context createDeviceProtectedStorageContext(){return this;} public java.io.File getNoBackupFilesDir(){data.mkdirs();return data;} public <T>T getSystemService(Class<T> type){return type.cast(manager);} public String getPackageName(){return "fixture.alpha";} }`);
  put('android/app/Application.java',`package android.app; public class Application extends android.content.Context {protected void attachBaseContext(android.content.Context base){} public void onCreate(){} public static String getProcessName(){return "fixture.alpha";} }`);
  put('android/app/ActivityManager.java',`package android.app; public class ActivityManager {public static int calls,mode; public boolean clearApplicationUserData(){calls++;if(mode==2)throw new SecurityException("fixture refusal");return mode==0;} }`);
  put('android/os/Process.java',`package android.os; public final class Process {public static class Exit extends Error{} public static int myPid(){return 123;} public static boolean isIsolated(){return false;} public static void killProcess(int pid){throw new Exit();} }`);
  put('android/util/AtomicFile.java',`package android.util; public class AtomicFile {private final java.io.File file;public AtomicFile(java.io.File f){file=f;}public java.io.File getBaseFile(){return file;}public java.io.FileOutputStream startWrite()throws Exception{return new java.io.FileOutputStream(file);}public void finishWrite(java.io.FileOutputStream out)throws Exception{out.getFD().sync();out.close();}public void failWrite(java.io.FileOutputStream out){try{out.close();}catch(Exception ignored){}} }`);
  put('android/util/Log.java',`package android.util; public class Log {public static int w(String tag,String message){return 0;} }`);
  put('android/system/OsConstants.java',`package android.system; public class OsConstants {public static final int O_RDONLY=0;}`);
  put('android/system/Os.java',`package android.system; public class Os {public static java.io.FileDescriptor open(String path,int flags,int mode){return new java.io.FileDescriptor();}public static void fsync(java.io.FileDescriptor fd){}public static void close(java.io.FileDescriptor fd){} }`);
  put('ai/elizaresearch/alphaphone/Dependencies.java',`package ai.elizaresearch.alphaphone;
class AlphaListenerPlugin {static boolean resetSaved=true;static boolean resetForData(android.content.Context c){return resetSaved;}}
class NativeDigestHost {NativeDigestHost(android.content.Context c){NativeSourceHost.started++;}void read(){}}
class NativeOwnerReminderHost {NativeOwnerReminderHost(android.content.Context c){NativeSourceHost.started++;}void read(){}}
class NativeSourceHost {static int started;static void configure(Runnable r){started++;}static void configureOwnerReminderContext(Runnable r){started++;}}
class NativeDeletionCoordinator {static NativeDeletionCoordinator get(android.content.Context c){return new NativeDeletionCoordinator();}void start(){NativeSourceHost.started++;}}
class AlphaCrashLog {static void install(android.content.Context c){NativeSourceHost.started++;}}
class AlphaNoteAudioPlugin {static void scheduleTrashBackstop(android.content.Context c){NativeSourceHost.started++;}}
`);
  put('ai/elizaresearch/alphaphone/ResetStartupTest.java',`package ai.elizaresearch.alphaphone;
public class ResetStartupTest {
 static void check(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args)throws Exception {
  android.content.Context.data=new java.io.File(args[0]);AlphaApplication app=new AlphaApplication();
  check(!AlphaDataReset.pending(app));app.attachBaseContext(app);app.onCreate();check(NativeSourceHost.started==7);NativeSourceHost.started=0;
  AlphaDataReset.record(app);check(AlphaDataReset.pending(new AlphaApplication()));
  for(int mode=0;mode<3;mode++){android.app.ActivityManager.mode=mode;try{AlphaApplication restarted=new AlphaApplication();restarted.attachBaseContext(app);throw new AssertionError("Providers would initialize before onCreate");}catch(android.os.Process.Exit stopped){}check(NativeSourceHost.started==0);check(AlphaDataReset.pending(app));}
  check(android.app.ActivityManager.calls==3);
  AlphaListenerPlugin.resetSaved=false;
  try{app.attachBaseContext(app);throw new AssertionError("Unacknowledged listener reset resumed");}catch(android.os.Process.Exit stopped){}
  check(android.app.ActivityManager.calls==3);check(AlphaDataReset.pending(app));check(NativeSourceHost.started==0);
  AlphaListenerPlugin.resetSaved=true;
  // Simulated system completion: only this fixture directory is erased. Fresh launch initializes.
  for(java.io.File f:android.content.Context.data.listFiles())check(f.delete());
  check(!AlphaDataReset.pending(app));app.attachBaseContext(app);app.onCreate();check(NativeSourceHost.started==7);
  System.out.println("PASS reset startup admission and interrupted dispatch");
 }
}`);
  execFileSync(bin('javac'),['--release','11','-d',join(dir,'classes'),...sources,...['AlphaDataReset','AlphaApplication'].map(name=>join(root,`android/app/src/main/java/ai/elizaresearch/alphaphone/${name}.java`))],{timeout:60000});
  assert.match(execFileSync(bin('java'),['-cp',join(dir,'classes'),'ai.elizaresearch.alphaphone.ResetStartupTest',join(dir,'private-fixture')],{encoding:'utf8',timeout:10000}),/PASS reset startup/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
