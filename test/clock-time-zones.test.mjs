import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('Clock accepts equivalent fixed offsets but refuses changed regional rules and invalid zones',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'clock-zones-'));
 try{
  const harness=path.join(temporary,'ClockZonesTest.java');
  fs.writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public class ClockZonesTest {
 static void check(boolean expected,String a,String b){if(ClockTimeZones.same(a,b)!=expected)throw new AssertionError(a+" / "+b);}
 public static void main(String[] args){
  check(true,"+00:00","Etc/UTC");check(true,"-00:00","Etc/GMT");check(true,"+05:30","GMT+05:30");check(true,"-03:30","GMT-03:30");
  check(true,"America/Los_Angeles","America/Los_Angeles");
  check(false,"+00:00","Europe/London");check(false,"-08:00","America/Los_Angeles");
  check(false,"America/Los_Angeles","America/Vancouver");check(false,"+05:30","GMT+05:45");
  for(String value:new String[]{null,"","garbage","+25:00","+01:99"})check(false,value,"Etc/UTC");
 }
}`);
  const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(binary('javac'),['--release','11','-d',temporary,path.resolve('android/app/src/main/java/ai/elizaresearch/alphaphone/ClockTimeZones.java'),harness],{timeout:20000});
  execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.ClockZonesTest'],{timeout:20000});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
