import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');

test('pinned generated secure-store helper reads bounded actual bytes on the Java 8 API',()=>{
  const fixture=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-frame-test-')));
  try {
    for(const relative of ['scripts/prepare-local-agent.mjs','scripts/stage-local-agent-sources.mjs','scripts/local-agent-source.mjs','upstream.lock.json','app.config.json']) {
      fs.mkdirSync(path.dirname(path.join(fixture,relative)),{recursive:true});
      fs.copyFileSync(path.join(root,relative),path.join(fixture,relative));
    }
    fs.mkdirSync(path.join(fixture,'vendor'));
    fs.symlinkSync(fs.realpathSync(path.join(root,'vendor/eliza')),path.join(fixture,'vendor/eliza'));
    // Native lifecycle sources must be physical, admitted runtime files; a vendor
    // symlink alone cannot stand in for their independent committed provenance.
    const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json')));
    const runtimeFixture=path.join(fixture,'artifacts/local-agent-source');
    // Exercise the real source preparer even on a clean checkout. This fixture
    // compiles Java only; dependency installation remains the runtime build's job.
    // The pinned submodule supplies objects; an interrupted runtime preparation
    // may have created its directory without fetching the pinned commit.
    const stageEnv={...process.env,ALPHA_LOCAL_AGENT_SOURCE_DIR:runtimeFixture,
      ALPHA_RUNTIME_GIT_CACHE:path.join(root,'vendor/eliza')};
    execFileSync(process.execPath,[path.join(fixture,'scripts/prepare-local-agent.mjs'),'--source-only'],{stdio:'pipe',timeout:180000,env:stageEnv});
    const launcherResult=execFileSync('python3',[path.join(root,'test/fixtures/resident-launcher-survival.py'),fixture,runtimeFixture],{encoding:'utf8',timeout:15000,maxBuffer:65536});
    assert.ok(launcherResult.includes('PASS source-derived'));
    execFileSync(process.execPath,[path.join(fixture,'scripts/stage-local-agent-sources.mjs')],{timeout:60000,env:stageEnv});
    const identity=JSON.parse(fs.readFileSync(path.join(fixture,'app.config.json'))).appId;
    const generated=path.join(fixture,'android/app/build/generated/local-agent');
    const target=path.join(generated,'java',...identity.split('.'));
    const store=fs.readFileSync(path.join(target,'AgentSecureStore.java'),'utf8');
    assert.ok(!store.includes('readNBytes('));
    assert.equal(store.match(/SecureStoreFrameInput.readBounded/g)?.length,2);
    const manifest=JSON.parse(fs.readFileSync(path.join(generated,'source-manifest.json')));
    assert.deepEqual(manifest.patches,[]);
    assert.deepEqual(manifest.runtimeSource,{commit:lock.commit});
    for(const entry of manifest.files){
      const hash=createHash('sha256').update(fs.readFileSync(path.join(runtimeFixture,entry.path))).digest('hex');
      assert.equal(entry.sourceSha256,hash);assert.equal(entry.sha256,hash);
    }
    const harness=`package ${identity};
import java.io.*;
import java.util.Arrays;
public class FrameReadTest {
 static void same(byte[] actual, byte... expected) { if(!Arrays.equals(actual,expected)) throw new AssertionError("bytes"); }
 static class Chunked extends ByteArrayInputStream {
  boolean zero = true;
  Chunked(byte[] bytes) { super(bytes); }
  public synchronized int read(byte[] bytes, int off, int len) {
   if(zero) { zero=false; return 0; }
   zero=true; return super.read(bytes,off,Math.min(2,len));
  }
 }
 public static void main(String[] args) throws Exception {
  // Consecutive frames: never consume beyond the requested length; preserve NUL and unsigned bytes.
  InputStream stream=new Chunked(new byte[]{0,1,(byte)255,3,4,5});
  same(SecureStoreFrameInput.readBounded(stream,4),(byte)0,(byte)1,(byte)255,(byte)3);
  same(SecureStoreFrameInput.readBounded(stream,2),(byte)4,(byte)5);
  same(SecureStoreFrameInput.readBounded(stream,4)); // clean EOF, caller may disconnect
  same(SecureStoreFrameInput.readBounded(new Chunked(new byte[]{1,2}),4),(byte)1,(byte)2); // partial header
  same(SecureStoreFrameInput.readBounded(new Chunked(new byte[]{3}),8),(byte)3); // partial body
  same(SecureStoreFrameInput.readBounded(new Chunked(new byte[]{}),4)); // zero bulk then EOF
  final int[] reads={0};
  InputStream never=new InputStream(){public int read(){reads[0]++;throw new AssertionError("unexpected read");}};
  same(SecureStoreFrameInput.readBounded(never,0));
  for(int size:new int[]{-1,4194305}) {try {SecureStoreFrameInput.readBounded(never,size);throw new AssertionError("unbounded");}catch(IllegalArgumentException expected){}}
  if(reads[0]!=0) throw new AssertionError("bounds read stream");
  byte[] max=new byte[4194304];max[max.length-1]=17;
  if(!Arrays.equals(max,SecureStoreFrameInput.readBounded(new ByteArrayInputStream(max),max.length)))throw new AssertionError("maximum");
  IOException failure=new IOException("synthetic transport failure");
  InputStream broken=new InputStream(){public int read() throws IOException {throw failure;}};
  try {SecureStoreFrameInput.readBounded(broken,4);throw new AssertionError("swallowed failure");}catch(IOException actual){if(actual!=failure)throw actual;}
  System.out.println("PASS bounded, chunked, zero-progress, EOF, truncation, limits, transport failure");
 }
}`;
    fs.writeFileSync(path.join(target,'FrameReadTest.java'),harness);
    const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');
    const binary=name=>java?path.join(java,'bin',name):name;
    execFileSync(binary('javac'),['--release','8','-d',fixture,path.join(target,'SecureStoreFrameInput.java'),path.join(target,'FrameReadTest.java')],{timeout:20000});
    assert.match(execFileSync(binary('java'),['-cp',fixture,identity+'.FrameReadTest'],{encoding:'utf8',timeout:20000}),/^PASS bounded/);
    // Source drift must stop staging before generating native files.
    fs.appendFileSync(path.join(runtimeFixture,'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/AgentSecureStore.java'),'\n');
    assert.throws(()=>execFileSync(process.execPath,[path.join(fixture,'scripts/stage-local-agent-sources.mjs')],{stdio:'pipe',timeout:60000,env:stageEnv}),/Unexpected runtime source/);
  } finally { fs.rmSync(fixture,{recursive:true,force:true}); }
});
