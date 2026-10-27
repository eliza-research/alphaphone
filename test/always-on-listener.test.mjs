import '../vendor/eliza/packages/app/test/android/sense.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('Alpha public components still compile against the common listener and preserve stored identity',()=>{
 const root=path.resolve(import.meta.dirname,'..'),shared=path.join(root,'vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense');
 const component=path.join(root,'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense');
 const product=JSON.parse(fs.readFileSync(path.join(root,'vendor/eliza/packages/os/android/products/pixel10a-alpha.json')));
 assert.equal(product.sense.componentPackage,'ai.elizaresearch.alphaphone.sense');assert.equal(product.sense.storageName,'listener-settings');assert.deepEqual(product.sense.wakeNames,['alpha']);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-sense-compat-'));
 try {
  const config='package ai.eliza.sense; public final class BuildConfig { public static final String APPLICATION_ID="ai.elizaresearch.alphaphone.sense", SENSE_HOST_PACKAGE="ai.elizaresearch.alphaphone", SENSE_ASSIST_ACTIVITY="ai.elizaresearch.alphaphone.AlphaAssistActivity", SENSE_APP_NAME="Alpha", SENSE_WAKE_LABEL="Alpha", SENSE_WAKE_NAMES="alpha", SENSE_COMPONENT_PACKAGE="ai.elizaresearch.alphaphone.sense", SENSE_STORAGE_NAME="listener-settings"; }';
  fs.writeFileSync(path.join(temp,'BuildConfig.java'),config);
  fs.writeFileSync(path.join(temp,'R.java'),'package ai.eliza.sense; public final class R { public static final class drawable { public static final int ic_listening=1; }}');
  fs.writeFileSync(path.join(temp,'NativeAsr.java'),'package ai.eliza.voice; public interface NativeAsr extends AutoCloseable { String transcribe(float[] samples); void cancel(); void close(); }');
  fs.writeFileSync(path.join(temp,'VoiceAssets.java'),'package ai.eliza.voice; public final class VoiceAssets { public static VoiceAssets install(android.content.Context context){return null;} public NativeAsr openAsr(){return null;} }');
  const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin/javac'):'javac';
  const sources=dir=>fs.readdirSync(dir).filter(file=>file.endsWith('.java')).map(file=>path.join(dir,file));
  execFileSync(java,['--release','21','-cp',path.join(process.env.ANDROID_HOME??path.join(os.homedir(),'Android/Sdk'),'platforms/android-36/android.jar'),'-d',path.join(temp,'out'),...sources(temp),...sources(shared),...sources(component)],{timeout:60000});
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
