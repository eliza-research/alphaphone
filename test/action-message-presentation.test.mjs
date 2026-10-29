import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const bundle=await build({entryPoints:['apps/app/src/runtime/action-message-presentation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {projectActionMessages,browserNavigationSummary}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const notice='Review this request on your phone before it can run.';
const old='Opened an approved HTTPS destination in a new browser tab. Page loading is not verified.';
const user={id:'user',from:'user',text:'Open example.com'};
const action={id:'action',from:'agent',text:'Open browser destination https://example.com/path',card:{proposalId:'p',title:'Completed',sub:old,done:true}};
const render=rows=>rows.map(m=>({...m,c:m.card,cGeneric:!!m.card,displayText:m.text,hasCalendarText:true}));
test('completed action projects one truthful result without changing stored history',()=>{
 const rows=[user,{id:'notice',from:'agent',text:notice},action,{id:'device-receipt:p',from:'agent',text:old,deviceReceipt:true}];const frozen=structuredClone(rows);const shown=projectActionMessages(render(rows),rows);
 assert.deepEqual(shown.map(m=>m.id),['user','action']);assert.equal(shown[1].displayText,'Opened example.com.');assert.equal(shown[1].cGeneric,false);assert.deepEqual(rows,frozen);
});
test('pending review keeps its existing approve/cancel handlers and shows the destination once',()=>{
 const rows=[user,{...action,card:{...action.card,done:false}}];const approve=()=>{},cancel=()=>{};const projected=render(rows);projected[1]={...projected[1],cDigest:true,rows:[{open:approve},{open:cancel}]};const shown=projectActionMessages(projected,rows)[1];assert.equal(shown.hasCalendarText,false);assert.equal(shown.rows[0].who,'Open example.com?');assert.equal(shown.rows[0].open,approve);assert.equal(shown.rows[1].open,cancel);
});
test('failures remain visible once, user quotes and unrelated later messages are preserved',()=>{
 const failed={...action,card:{...action.card,title:'Not completed',sub:'The browser is unavailable.'}};const rows=[user,failed,{id:'device-receipt:p',from:'agent',text:'The browser is unavailable.',deviceReceipt:true},{id:'next',from:'user',text:notice},{id:'later',from:'agent',text:old}];const shown=projectActionMessages(render(rows),rows);assert.deepEqual(shown.map(m=>m.id),['user','action','next','later']);assert.equal(shown[1].displayText,'The browser is unavailable.');assert.equal(shown[2].text,notice);
});
test('restored verified browser receipt hides only exact protocol instruction in its turn',()=>{
 const rows=[user,{id:'n',from:'agent',text:notice},{id:'receipt',from:'agent',text:old,deviceReceipt:true,browserDestination:'https://example.com/'}];const shown=projectActionMessages(render(rows),rows);assert.deepEqual(shown.map(m=>m.id),['user','receipt']);assert.equal(shown[1].displayText,'Opened example.com.');assert.equal(projectActionMessages(render([rows[1]]),[rows[1]]).length,1);
});
test('no page loaded or read claim; malformed/non-HTTPS destinations refuse',()=>{assert.equal(browserNavigationSummary('https://example.com/path'),'Opened example.com.');assert.throws(()=>browserNavigationSummary('http://example.com/'));assert.throws(()=>browserNavigationSummary('not a URL'));});

// Cold history restoration runs through the real Alpha binding of the shared device-action coordinator.
const device=await build({entryPoints:['apps/app/src/runtime/device-actions.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {DeviceActions,actionScope}=await import('data:text/javascript;base64,'+Buffer.from(device.outputFiles[0].text).toString('base64'));
const DIGEST='d'.repeat(64),SCOPE='c'.repeat(64);
async function restoredReceipt(change=()=>{}){
 const operation={type:'browser_navigate',url:'https://example.com/'};
 const proposal={requestMessageId:'user',attemptId:'attempt',providerReceipt:{outcome:'applied',operationId:'effect'}};
 const entry={scope:SCOPE,proposalId:'p',phase:'terminal',status:'succeeded',attemptId:'attempt',operationId:'effect',operationHash:await actionScope(JSON.stringify(operation)),summary:old,result:{operationId:'effect'},record:{operation,digest:DIGEST,ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://origin.example',installationId:'installation',enrollmentId:'enrollment'}};
 change(proposal,entry);
 const wire={id:'p',digest:DIGEST,state:'done',subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+600000).toISOString(),payload:{action:'device_action',version:1,installationId:'installation',enrollmentId:'enrollment',operation,requestMessageId:proposal.requestMessageId},execution:{attemptId:proposal.attemptId,providerReceipt:proposal.providerReceipt}};
 const journal={get:async()=>({entry}),list:async()=>({entries:[entry]}),reserve:async()=>{throw Error('restoration never reserves');},markApplying:async()=>{throw Error('restoration never dispatches');},finish:async()=>{throw Error('restoration never dispatches');}};
 const actions=new DeviceActions({ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://origin.example'},{installationId:'installation',enrollmentId:'enrollment',key:'k'},SCOPE,async(path,body)=>{assert.equal(body,undefined,'restoration only reads proposals');return {proposals:[wire]};},journal,async()=>{throw Error('restoration never executes');});
 return actions.conversationReceipts(new Set(['user']),new AbortController().signal);
}
test('cold history reads one fully matched browser receipt without executing navigation',async()=>{
 const result=await restoredReceipt();assert.equal(result.length,1);assert.equal(result[0].summary,'Opened example.com.');assert.equal(result[0].browserDestination,'https://example.com/');
});
test('cold history refuses uncertain, foreign, changed or contradictory browser receipts',async()=>{
 for(const change of [(p,e)=>e.status='unknown',(p,e)=>e.phase='applying',(p,e)=>e.record.ownerId='foreign',(p,e)=>e.record.enrollmentId='foreign',(p,e)=>e.record.operation={type:'browser_navigate',url:'https://other.example/'},(p,e)=>e.operationHash='wrong',(p,e)=>e.attemptId='stale',(p,e)=>p.providerReceipt.operationId='other',(p,e)=>p.providerReceipt.outcome='unconfirmed',(p,e)=>p.providerReceipt.result={},(p,e)=>p.requestMessageId='other'])assert.equal((await restoredReceipt(change)).length,0);
});

test('automatic live receipt replaces the exact protocol pause without needing an approval card',()=>{
 const rows=[user,{id:'protocol',from:'agent',text:notice},{id:'result',from:'agent',text:'Opened example.com.',deviceReceipt:true}];const shown=projectActionMessages(render(rows),rows);assert.deepEqual(shown.map(m=>m.id),['user','result']);assert.equal(shown[1].displayText,'Opened example.com.');
});


test('equal summaries never hide another proposal receipt or an unbound message',()=>{
 for(const following of [
  {id:'device-receipt:other',from:'agent',text:old,deviceReceipt:true},
  {id:'unbound',from:'agent',text:old},
  {id:'device-receipt:p',from:'agent',text:old},
 ]) {
  const rows=[user,action,following];
  const shown=projectActionMessages(render(rows),rows);
  assert.deepEqual(shown.map(message=>message.id),rows.map(message=>message.id));
 }
});

test('a queued proposal and its later exact receipt show one result across the request turn',()=>{
 const queued={id:'queued',from:'agent',text:'Clock action',card:{proposalId:'clock',title:'Completed',sub:'Alarm saved.',done:true}};
 const receipt={id:'device-receipt:clock',from:'agent',text:'Alarm saved.',deviceReceipt:true};
 const reply={id:'reply',from:'agent',text:'Development reply.'};
 const rows=[queued,user,reply,receipt],original=structuredClone(rows);
 const shown=projectActionMessages(render(rows),rows);
 assert.deepEqual(shown.map(message=>message.id),['queued','user','reply']);
 assert.equal(shown[0].displayText,'Alarm saved.');
 assert.deepEqual(rows,original);
});

test('cross-turn collapse retains pending, foreign, quoted, different and offscreen results',()=>{
 const queued={id:'queued',from:'agent',text:'Clock action',card:{proposalId:'clock',title:'Completed',sub:'Alarm saved.',done:true}};
 const receipt={id:'device-receipt:clock',from:'agent',text:'Alarm saved.',deviceReceipt:true};
 for(const [card,result] of [
  [{...queued,card:{...queued.card,done:false}},receipt],
  [queued,{...receipt,id:'device-receipt:another'}],
  [queued,{...receipt,from:'user'}],
  [queued,{...receipt,deviceReceipt:false}],
  [queued,{...receipt,text:'Alarm was not saved.'}],
 ]) {
  const rows=[card,user,result];
  assert.deepEqual(projectActionMessages(render(rows),rows).map(message=>message.id),rows.map(message=>message.id));
 }
 const rows=[queued,user,receipt],visible=render([user,receipt]);
 assert.deepEqual(projectActionMessages(visible,rows).map(message=>message.id),['user','device-receipt:clock']);
});
