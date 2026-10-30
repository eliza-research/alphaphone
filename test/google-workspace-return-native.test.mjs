import test from 'node:test';
import assert from 'node:assert/strict';
import {runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
import {returnSources,returnFixture,workspaceConstant} from './fixtures/workspace-return-source.mjs';

test('actual shared native Workspace return contract validates the product callback, binding and TTL',{skip:jsonJarSkip},()=>{
 const result=runJvm([...returnSources(),returnFixture('WorkspaceAppReturnTest.java')],
  'ai.eliza.plugins.agent.connection.test.WorkspaceAppReturnTest',
  {json:true,args:[workspaceConstant('WORKSPACE_CALLBACK')]});
 assert.match(result,/^PASS Workspace return pure contract 63/);
});
