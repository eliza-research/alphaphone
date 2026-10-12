import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../apps/app/src/runtime/managed-service-routes.ts',import.meta.url),'utf8');
const {managedServiceRequest:allowed}=await import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(source)));
test('managed service admission preserves owned service APIs and refuses agent hosts, paths and mutation variants',()=>{
 for(const path of ['/api/v1/user','/api/v1/credits/balance','/api/v1/eliza/google/accounts?side=owner','/api/v1/eliza/google/gmail/inbox-v1/thread?grantId=owner'])assert.equal(allowed('https://api.eliza.app'+path,'GET'),true,path);
 for(const url of ['https://agent.cloud.eliza.app/api/v1/user','https://api.eliza.app.evil.test/api/v1/user','https://api.eliza.app:444/api/v1/user','http://api.eliza.app/api/v1/user','https://owner@api.eliza.app/api/v1/user','https://api.eliza.app/api/v1/user#x'])assert.equal(allowed(url,'GET'),false,url);
 for(const path of ['/api/auth/pair','/api/agents','/api/conversations','/api/v1/eliza/agents','/api/v1/eliza/personal','/api/v1/eliza/agents/id/api/conversations','/api/v1/%65liza/google/status','/api/v1/eliza/google/status/'])for(const method of ['GET','POST'])assert.equal(allowed('https://api.eliza.app'+path,method),false,path);
 assert.equal(allowed('https://api.eliza.app/api/v1/user','POST',true),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/user','GET',true),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/api-keys/current','DELETE'),true);
 assert.equal(allowed('https://api.eliza.app/api/v1/api-keys/current?other=owner','DELETE'),false);
 assert.equal(allowed('https://api.eliza.app/api/v1/eliza/google/gmail/inbox-v1/operations/owner-request/dispatch','POST',true),true);
});
