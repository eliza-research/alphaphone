import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {writeAospCapabilityOverlay} from '../scripts/aosp-capability-overlay.mjs';

test('compiled image admission requires every trusted fact and keeps adapter roles unavailable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-image-cap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const files={
 'android/content/pm/ApplicationInfo.java':'package android.content.pm; public class ApplicationInfo {public static final int FLAG_SYSTEM=1; public int flags;}',
 'android/content/res/Resources.java':'package android.content.res; public class Resources {public boolean value; public boolean missing;public boolean getBoolean(int id){if(missing)throw new IllegalArgumentException();return value;}}',
 'android/content/Context.java':'package android.content; public class Context {public android.content.pm.ApplicationInfo info=new android.content.pm.ApplicationInfo();public android.content.res.Resources resources=new android.content.res.Resources();public android.content.pm.ApplicationInfo getApplicationInfo(){return info;}public android.content.res.Resources getResources(){return resources;}}',
 'ai/elizaresearch/alphaphone/BuildConfig.java':'package ai.elizaresearch.alphaphone; public class BuildConfig {public static boolean DEBUG=false,ELIZA_DEV_ALLOW_TEST_MOCKS=false,IS_LAUNCHER=true;}',
 'ai/elizaresearch/alphaphone/R.java':'package ai.elizaresearch.alphaphone; public class R {public static class bool {public static int alpha_aosp_image_capability=1;}}',
 'ai/elizaresearch/alphaphone/CapabilityTest.java':`package ai.elizaresearch.alphaphone;
public class CapabilityTest {
 static void check(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args){
  for(int mask=0;mask<32;mask++)check(AlphaImageCapabilities.admitted((mask&1)!=0,(mask&2)!=0,(mask&4)!=0,(mask&8)!=0,(mask&16)!=0)==(mask==28));
  android.content.Context c=new android.content.Context();check(!AlphaImageCapabilities.aospImage(c));c.resources.value=true;check(!AlphaImageCapabilities.aospImage(c));c.info.flags=1;check(AlphaImageCapabilities.aospImage(c));
  check(AlphaImageCapabilities.defaultAppEnabled(c,"dial"));check(!AlphaImageCapabilities.defaultAppEnabled(c,"sms"));check(!AlphaImageCapabilities.defaultAppEnabled(c,null));
  BuildConfig.DEBUG=true;check(!AlphaImageCapabilities.aospImage(c));BuildConfig.DEBUG=false;BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS=true;check(!AlphaImageCapabilities.aospImage(c));BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS=false;
  BuildConfig.IS_LAUNCHER=false;check(!AlphaImageCapabilities.aospImage(c));BuildConfig.IS_LAUNCHER=true;
  c.resources.missing=true;check(!AlphaImageCapabilities.aospImage(c));check(!AlphaImageCapabilities.defaultAppEnabled(c,"dial"));
  for(String role:new String[]{"dialer","sms","contacts","unknown",null})check(!AlphaImageCapabilities.roleEnabled(role));check(AlphaImageCapabilities.roleEnabled("home"));check(AlphaImageCapabilities.roleEnabled("assistant"));
  System.out.println("PASS image admission and unimplemented role denial");
 }
}`,
 };
 for(const [name,body] of Object.entries(files)){const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);}
 const actual='android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaImageCapabilities.java';
 const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
 execFileSync(binary('javac'),['--release','11','-d',dir,actual,...Object.keys(files).map(name=>path.join(dir,name))],{timeout:30000,stdio:'pipe'});
 assert.match(execFileSync(binary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.CapabilityTest'],{encoding:'utf8',timeout:30000}),/PASS image admission/);
});
test('production RRO targets the prebuilt app overlayable and cannot be a development default',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-image-overlay-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'product.mk'),'');
 const files=writeAospCapabilityOverlay(dir,'ai.elizaresearch.alphaphone');assert.match(files['image-capabilities/Android.bp'],/runtime_resource_overlay/);assert.match(files['image-capabilities/Android.bp'],/product_specific: true/);
 assert.match(files['image-capabilities/AndroidManifest.xml'],/targetName="AlphaImageProvisioning"/);assert.match(files['image-capabilities/res/values/capabilities.xml'],/>true</);
 const defaults=fs.readFileSync('android/app/src/main/res/values/aosp-capabilities.xml','utf8');assert.match(defaults,/alpha_aosp_image_capability">false</);assert.match(defaults,/policy type="system\|product"/);
 const stage=fs.readFileSync('scripts/stage-aosp.mjs','utf8');assert.ok(stage.indexOf('writeAospCapabilityOverlay(output')>stage.indexOf('if (production) {'));
 assert.throws(()=>writeAospCapabilityOverlay(dir,'bad"target'),/Invalid/);
});
