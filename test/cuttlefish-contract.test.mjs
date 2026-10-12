import test from 'node:test';
import assert from 'node:assert/strict';
import {admitCuttlefish,keyguardReadyFromPolicy} from '../scripts/cuttlefish-contract.mjs';
import {admitInstrumentationDevice,instrumentArgs,parseInstrumentationArgs,runLeased} from '../scripts/android-instrumentation.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const fingerprint='Alpha/alpha_cf/vsoc_x86_64_only:16/test/userdebug';
const properties={hardware:'cutf_cvm',device:'vsoc_x86_64_only',bootCompleted:'1',fingerprint,userState:'RUNNING_UNLOCKED',keyguardReady:true};
test('fixture opt-in is scoped to SettingsFlow, PasswordBrowserFill and RealClock and absent for AVD runs',()=>{
 for(const name of ['SettingsFlow','PasswordBrowserFill','RealClock']){
 const cls=`ai.elizaresearch.alphaphone.${name}InstrumentedTest`;
 assert.ok(!instrumentArgs(cls).includes('ownedCuttlefishFingerprint'));
 assert.ok(!instrumentArgs('ai.elizaresearch.alphaphone.ShellInstrumentedTest',{cuttlefishFingerprint:fingerprint}).includes('ownedCuttlefishFingerprint'));
 const args=instrumentArgs(cls,{cuttlefishFingerprint:fingerprint});
 assert.equal(args[args.indexOf('ownedCuttlefishFingerprint')+1],fingerprint);
 }
});
test('native battery fixture gate refuses physical devices and unadmitted Cuttlefish',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-admission-'));
 try {
  const harness=path.join(dir,'FixtureAdmissionTest.java');
  fs.writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public class FixtureAdmissionTest {
 static void check(boolean expected,String fp,String model,String hw,String device,String requested){
  if(DisposableFixtureAdmission.allows(fp,model,hw,device,requested)!=expected)throw new AssertionError(hw+":"+requested);
 }
 public static void main(String[] args){
  if(DisposableFixtureAdmission.allowsCuttlefish("generic/sdk","ranchu","emu","generic/sdk"))throw new AssertionError("Cuttlefish-only guard admitted AVD");
  check(true,"generic/sdk","sdk","ranchu","emu",null);
  check(false,"Pixel/release","Pixel","tensor","pixel","Pixel/release");
  for(String hw:new String[]{"cutf_cvm","cutf_vm","cutf_ivshmem"}){
   check(true,"Alpha/release","Cuttlefish",hw,"vsoc_x86_64_only","Alpha/release");
   for(String requested:new String[]{null,"","other","Alpha/release\\n"})check(false,"Alpha/release","Cuttlefish",hw,"vsoc_x86_64_only",requested);
   check(false,"generic/sdk","sdk",hw,"vsoc_x86_64_only",null);
   check(false,"Alpha/release","Cuttlefish",hw,"physical","Alpha/release");
  }
 }
}`);
  const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(binary('javac'),['--release','11','-d',dir,path.resolve('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/DisposableFixtureAdmission.java'),harness],{timeout:20000});
  execFileSync(binary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.FixtureAdmissionTest'],{timeout:20000});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Cuttlefish rejects physical, remote, unbooted, locked and changed-image targets',()=>{
 assert.equal(admitCuttlefish('127.0.0.1:6520',properties,fingerprint),properties);
 for(const serial of ['emulator-5554','device-id','192.168.1.2:6520','localhost:99999'])assert.throws(()=>admitCuttlefish(serial,properties,fingerprint));
 for(const change of [{hardware:'tensor'},{device:'pixel'},{bootCompleted:'0'},{userState:'BOOTING'},{keyguardReady:false},{keyguardReady:undefined},{fingerprint:'another-image'}])assert.throws(()=>admitCuttlefish('127.0.0.1:6520',{...properties,...change},fingerprint));
 assert.throws(()=>admitCuttlefish('127.0.0.1:6520',properties,''));
});
const args=['--owned-cuttlefish','--image-fingerprint',fingerprint];
test('Cuttlefish requires explicit image ownership and preserves campaign gates',()=>{
 assert.equal(parseInstrumentationArgs([...args,'--classes','Shell']).ownedCuttlefish,true);
 assert.equal(parseInstrumentationArgs([...args,'--home-role','--variants','launcher','--classes','LauncherHome']).homeRole,true);
 for(const extra of [['--classes','ContactsFlow'],['--classes','unknown.SomeTest'],['--all'],['--owned-emulator'],['--avd','some-avd'],['--classes','RealClock'],['--classes','BrowserAutofill']])assert.throws(()=>parseInstrumentationArgs([...args,...extra]));
 for(const name of ['HostedProcessRestart','ai.elizaresearch.alphaphone.HostedProcessRestartInstrumentedTest']){assert.doesNotThrow(()=>parseInstrumentationArgs([...args,'--classes',name,'--test-mocks']));assert.throws(()=>parseInstrumentationArgs([...args,'--classes',name]),/test-mocks/);}
 assert.doesNotThrow(()=>parseInstrumentationArgs([...args,'--classes','CalendarCreationRecovery,ClockAgentReview,ReminderDeletionStorage']));
 assert.throws(()=>parseInstrumentationArgs(['--owned-cuttlefish']));
 assert.throws(()=>parseInstrumentationArgs(['--image-fingerprint',fingerprint]));
});
function fakeAdb(commands,existing=false){return args=>{
 commands.push(args);
 if(args.join(' ')==='shell dumpsys window policy')return '    KeyguardServiceDelegate\n      showing=false\n      inputRestricted=false\n';
 if(args.join(' ')==='shell am get-current-user')return '0';
 if(args.join(' ')==='shell am get-started-user-state 0')return 'RUNNING_UNLOCKED';
 if(args[1]==='getprop')return {'ro.hardware':'cutf_cvm','ro.product.device':'vsoc_x86_64_only','sys.boot_completed':'1','ro.build.fingerprint':fingerprint}[args[2]]||'';
 if(args.join(' ').startsWith('shell pm list packages'))return existing?'package:ai.elizaresearch.alphaphone\n':'';
 throw Error('Unexpected device command: '+args.join(' '));
};}
test('Cuttlefish admission is read-only and never issues AVD emulator-console commands',()=>{
 const commands=[];const result=admitInstrumentationDevice(parseInstrumentationArgs(args),'127.0.0.1:6520',fakeAdb(commands));
 assert.equal(result.image.fingerprint,fingerprint);assert.equal(result.avd,null);
 assert.ok(commands.every(a=>a[0]==='shell' && ['getprop','am','dumpsys'].includes(a[1])));
});
test('existing system Alpha APK is refused before installation or fixture mutation',async()=>{
 const commands=[];
 await assert.rejects(runLeased({options:parseInstrumentationArgs([...args,'--classes','Shell']),serial:'127.0.0.1:6520',adb:fakeAdb(commands,true)}),/already installed/);
 assert.ok(commands.every(a=>a[0]==='shell' && ['getprop','am','pm','dumpsys'].includes(a[1])));
 assert.ok(commands.every(a=>!a.includes('clear')&&!a.includes('create-user')&&!a.includes('switch-user')));
});

test('keyguard admission distinguishes unlocked storage from an unlocked UI',()=>{
 const dump='    KeyguardServiceDelegate\n      showing=false\n      inputRestricted=false\n';
 assert.equal(keyguardReadyFromPolicy(dump),true);
 for(const invalid of ['', 'RUNNING_UNLOCKED', dump.replace('showing=false','showing=true'),dump.replace('inputRestricted=false','inputRestricted=true'),dump+dump])assert.equal(keyguardReadyFromPolicy(invalid),false);
});
test('a visible keyguard is refused before any package mutation',async()=>{
 const commands=[];const delegate=fakeAdb(commands);
 const adb=args=>args.join(' ')==='shell dumpsys window policy'?'KeyguardServiceDelegate\n  showing=true\n  inputRestricted=true\n':delegate(args);
 await assert.rejects(runLeased({options:parseInstrumentationArgs([...args,'--classes','Shell']),serial:'127.0.0.1:6520',adb}),/lock screen/);
 assert.ok(commands.every(a=>a[0]==='shell'&&['getprop','am'].includes(a[1])));
});
