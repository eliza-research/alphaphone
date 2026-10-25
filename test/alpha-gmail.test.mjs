import test from 'node:test';
import assert from 'node:assert/strict';
import {beginAlphaGmail,finishAlphaGmail,pendingGmailReturn,parseGmailReturn,gmailReturnURL,cancelAlphaGmail} from '../apps/app/src/runtime/alpha-gmail.ts';
const owner={environment:'production',userId:'user',organizationId:'org',credentialId:'credential'};
const signal=()=>new AbortController().signal;
const pending=()=>({...owner,permission:'send',state:'s'.repeat(43),expiresAt:Date.now()+60000});
const link=(p,result='connected')=>gmailReturnURL(p.environment)+'#state='+p.state+'&result='+result+(result==='connected'?'&connectionId=new-grant':'');
function fixture(saved=null){let record=saved,callback=saved?link(saved):null;const opened=[];return {opened,get:()=>record,callback:()=>callback,setCallback:value=>callback=value,host:{read:async()=>record,replace:async(expected,value)=>{if(JSON.stringify(expected)!==JSON.stringify(record))return false;record=value;return true;},callback:async()=>callback,clearCallback:async()=>{callback=null},open:async url=>{opened.push(url)}}};}
test('Gmail initiation persists account and permission binding before opening Google',async()=>{
 const f=fixture();await beginAlphaGmail(owner,'send',f.host,async state=>{assert.equal(f.get().state,state);assert.equal(f.get().permission,'send');assert.equal(state.length,43);return 'https://accounts.google.com/o/oauth2/v2/auth';},signal());
 assert.equal(f.opened.length,1);assert.equal(f.get().credentialId,owner.credentialId);
 await assert.rejects(beginAlphaGmail(owner,'read',f.host,async()=>{throw Error('Must not initiate twice')},signal()),/already pending/);
});
test('Gmail returns require exact environment, nonce and bounded fragment outcome',()=>{
 const p=pending();assert.deepEqual(parseGmailReturn(link(p),p),{result:'connected',connectionId:'new-grant'});assert.deepEqual(parseGmailReturn('alphaphone://gmail/production#state='+p.state+'&result=denied',p),{result:'denied',connectionId:null});
 for(const raw of [link(p)+'&token=secret',link(p)+'&state='+p.state,link(p).replace('#','?'),link(p).replace('alphacompute.ai','attacker.invalid'),link(p).replace('/gmail/callback','/gmail/staging/callback'),link(p).replace(p.state,'x'.repeat(43)),link(p,'unknown'),link(p).replace('&connectionId=new-grant',''),link(p)+'&connectionId=other',link(p,'denied')+'&connectionId=new-grant'])assert.equal(parseGmailReturn(raw,p),null);
});
test('cold completion refreshes actual permissions and never trusts a success marker',async()=>{
 const f=fixture(pending());let reads=0;
 const result=await finishAlphaGmail(owner,f.host,async()=>{reads++;return [{connectionId:'new-grant',connected:true,grantedCapabilities:['google.gmail.triage']}]},signal());
 assert.equal(result.result,'missing-permission');assert.equal(reads,1);assert.equal(f.get(),null);assert.equal(f.callback(),null);
 const valid=fixture(pending());assert.equal((await finishAlphaGmail(owner,valid.host,async()=>[{connectionId:'new-grant',connected:true,grantedCapabilities:['google.gmail.triage','google.gmail.send']}],signal())).result,'connected');
 assert.equal(await finishAlphaGmail(owner,valid.host,async()=>{throw Error('No replay')},signal()),null);
});
test('account switches, re-login credentials and expired attempts do not consume another return',async()=>{
 const f=fixture(pending());for(const other of [{...owner,userId:'other'},{...owner,credentialId:'new'},{...owner,environment:'staging'}])assert.equal(await pendingGmailReturn(other,f.host),null);
 assert.ok(f.get());assert.ok(f.callback());f.get().expiresAt=0;assert.equal(await pendingGmailReturn(owner,f.host),null);
});
test('denial and failure retire the attempt without reading mail or claiming connected',async()=>{
 for(const result of ['denied','failed']){const f=fixture(pending());f.setCallback(link(f.get(),result));assert.equal((await finishAlphaGmail(owner,f.host,async()=>{throw Error('No provider read')},signal())).result,result);assert.equal(f.get(),null);}
});
test('failed status check remains recoverable; cancellation during initiation retires only its attempt',async()=>{
 const f=fixture(pending());await assert.rejects(finishAlphaGmail(owner,f.host,async()=>{throw Error('offline')},signal()),/offline/);assert.ok(f.get());assert.ok(f.callback());
 const fresh=fixture(),controller=new AbortController();await assert.rejects(beginAlphaGmail(owner,'read',fresh.host,async()=>{controller.abort();return 'https://accounts.google.com/o/oauth2/v2/auth'},controller.signal));assert.equal(fresh.opened.length,0);assert.equal(fresh.get(),null);
});
test('cancelling a pending attempt is owner-bound and a late return cannot reconnect it',async()=>{
 const f=fixture(pending()),callback=f.callback();assert.equal(await cancelAlphaGmail({...owner,userId:'other'},f.host),false);assert.ok(f.get());
 assert.equal(await cancelAlphaGmail(owner,f.host),true);f.setCallback(callback);
 assert.equal(await finishAlphaGmail(owner,f.host,async()=>{throw Error('No replay')},signal()),null);
});
test('a cancelled permission refresh never publishes or consumes a late result',async()=>{
 const f=fixture(pending()),controller=new AbortController();
 await assert.rejects(finishAlphaGmail(owner,f.host,async()=>{controller.abort();return [{connectionId:'new-grant',connected:true,grantedCapabilities:['google.gmail.triage','google.gmail.send']}]},controller.signal));
 assert.ok(f.get());assert.ok(f.callback());
});
test('another Google account cannot mask missing permissions on the returned connection',async()=>{
 const older={connectionId:'older-grant',connected:true,grantedCapabilities:['google.gmail.triage','google.gmail.send']};
 for(const accounts of [[older],[older,{connectionId:'new-grant',connected:true,grantedCapabilities:['google.gmail.triage']}],[older,{connectionId:'new-grant',connected:false,grantedCapabilities:['google.gmail.triage','google.gmail.send']}]]){
  const f=fixture(pending());const result=await finishAlphaGmail(owner,f.host,async()=>accounts,signal());assert.equal(result.result,'missing-permission');assert.equal(result.connectionId,'new-grant');
 }
 const f=fixture(pending());const result=await finishAlphaGmail(owner,f.host,async()=>[older,{...older,connectionId:'new-grant'}],signal());assert.equal(result.result,'connected');assert.equal(result.connectionId,'new-grant');
});
