import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
import {returnSources,returnFixture,workspaceConstant} from './fixtures/workspace-return-source.mjs';

test('actual shared native Workspace flow consumes once and preserves credential/account boundaries',{skip:jsonJarSkip},()=>{
 const result=runJvm([...returnSources(),returnFixture('WorkspaceAppReturnFlowTest.java')],
  'ai.eliza.plugins.agent.connection.test.WorkspaceAppReturnFlowTest',
  {json:true,args:[workspaceConstant('WORKSPACE_CALLBACK')]});
 assert.match(result,/^PASS Workspace flow /);
});

test('shared Workspace return flow compiles against the Android org.json API',()=>{
 const sdk=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library/Android/sdk'),join(homedir(),'Android/Sdk')].filter(Boolean).map(root=>join(root,'platforms/android-36/android.jar')).find(existsSync);
 assert.ok(sdk,'Android 36 platform is required for the native API compatibility check');
 const output=mkdtempSync(join(tmpdir(),'alpha-workspace-android-api-'));
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',sdk,'-d',output,...returnSources()],{timeout:30000,stdio:'pipe'});
 }finally{rmSync(output,{recursive:true,force:true});}
});
