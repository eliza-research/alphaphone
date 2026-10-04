import {test,expect} from '@playwright/test';
import {localAgentStorage} from '../../scripts/local-agent-dev-storage';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
let directory:string;
test.beforeEach(async({page})=>{directory=mkdtempSync(join(tmpdir(),'alpha-notice-recovery-'));await page.route('**/__alpha-local-agent',async route=>{try{const result=localAgentStorage(directory,route.request().postDataJSON().storage);await route.fulfill({json:result});}catch(error){await route.fulfill({status:409,json:{error:String(error)}});}});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test.afterEach(()=>rmSync(directory,{recursive:true,force:true}));
for(const state of ['posted','dismissed','compacted'])test(`notification receipt repairs an interrupted journal from ${state} history without reposting`,async({page})=>{
 const result=await page.evaluate(async state=>{
  const notices=await import('/src/browser/workflow-notices.ts'),{developmentActionJournal:journal}=await import('/src/runtime/local-agent-storage.ts');
  const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
  const scope='a'.repeat(64),proposalId='proposal',operationId='notice',operation={type:'post_notification',title:'Reviewed title',body:'Reviewed body'},record={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://agent.test',installationId:'installation',enrollmentId:'enrollment',digest:'digest',operation,workflow:{runId:'run'}};
  const bindingHash=await hash([scope,record.ownerId,record.agentId,record.sessionId,record.origin,record.installationId,record.enrollmentId,proposalId,record.digest,operationId]);
  await journal.reserve({scope,proposalId,operationId,operationHash:await hash(operation),record});await journal.markApplying({scope,proposalId,attemptId:'attempt'});
  const signal=new AbortController().signal;await notices.publishWorkflowNotice(operationId,operation.body,signal,operation.title,bindingHash);
  if(state!=='posted'){const row=(await notices.listWorkflowNotices())[0];await notices.actOnWorkflowNotice(row,false);}
  if(state==='compacted')await notices.compactWorkflowNotices((await notices.workflowNoticeHistory()).recovery,signal);
  const before=(await notices.savedWorkflowNoticeHistory());await journal.finish({scope,proposalId,status:'unknown',summary:'Interrupted after delivery'});
  const recovered=await journal.recoverNotification!({scope,proposalId,bindingHash});const repeat=await journal.recoverNotification!({scope,proposalId,bindingHash});
  return {status:recovered.entry?.status,phase:recovered.entry?.phase,operationId:recovered.entry?.result?.operationId,unchanged:before===(await notices.savedWorkflowNoticeHistory()),same:JSON.stringify(recovered)===JSON.stringify(repeat),posted:(await notices.listWorkflowNotices()).length};
 },state);expect(result).toEqual({status:'succeeded',phase:'terminal',operationId:'notice',unchanged:true,same:true,posted:state==='posted'?1:0});await page.reload();expect(await page.evaluate(async()=>{const {developmentActionJournal:journal}=await import('/src/runtime/local-agent-storage.ts');return (await journal.get({scope:'a'.repeat(64),proposalId:'proposal'})).entry?.status;})).toBe('succeeded');
});
test('missing, legacy and changed-bound notification receipts cannot be promoted',async({page})=>{
 const result=await page.evaluate(async()=>{const n=await import('/src/browser/workflow-notices.ts'),signal=new AbortController().signal,binding='a'.repeat(64),out:string[]=[];
 out.push((await n.workflowNoticeReceipt('missing','Title','Body',binding,signal)).status);
 await n.publishWorkflowNotice('legacy','Body',signal,'Title');out.push((await n.workflowNoticeReceipt('legacy','Title','Body',binding,signal)).status);
 await n.publishWorkflowNotice('bound','Body',signal,'Title',binding);const before=(await n.savedWorkflowNoticeHistory());for(const [title,body,hash] of [['Changed','Body',binding],['Title','Changed',binding],['Title','Body','b'.repeat(64)]]){try{await n.workflowNoticeReceipt('bound',title,body,hash,signal);out.push('accepted');}catch{out.push('rejected');}}
 return {out,unchanged:before===(await n.savedWorkflowNoticeHistory())};});expect(result).toEqual({out:['unknown','unknown','rejected','rejected','rejected'],unchanged:true});
});
test('a concurrently settled journal cannot be overwritten after notice receipt lookup',async({page})=>{
 let raced=false;
 await page.route('**/__alpha-local-agent',async route=>{
  const input=route.request().postDataJSON().storage;
  try{
   if(input.operation==='recoverNotification'){
    raced=true;
    localAgentStorage(directory,{operation:'finish',scope:input.scope,proposalId:input.proposalId,status:'failed',summary:'Concurrent settlement'});
   }
   await route.fulfill({json:localAgentStorage(directory,input)});
  }catch(error){await route.fulfill({status:409,json:{error:String(error)}});}
 });
 const result=await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),{developmentActionJournal:j}=await import('/src/runtime/local-agent-storage.ts');
  const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
  const scope='c'.repeat(64),proposalId='race',operationId='notice-race',operation={type:'post_notification',title:'Title',body:'Body'},record={ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://agent.test',installationId:'installation',enrollmentId:'enrollment',digest:'digest',operation,workflow:{runId:'run'}};
  const bindingHash=await hash([scope,record.ownerId,record.agentId,record.sessionId,record.origin,record.installationId,record.enrollmentId,proposalId,record.digest,operationId]);
  await j.reserve({scope,proposalId,operationId,operationHash:await hash(operation),record});await j.markApplying({scope,proposalId,attemptId:'attempt'});
  await n.publishWorkflowNotice(operationId,operation.body,new AbortController().signal,operation.title,bindingHash);
  const before=(await n.savedWorkflowNoticeHistory());let refused=false;
  try{await j.recoverNotification!({scope,proposalId,bindingHash});}catch{refused=true;}
  const {entry}=await j.get({scope,proposalId});
  return {refused,status:entry?.status,summary:entry?.summary,unchanged:before===(await n.savedWorkflowNoticeHistory()),posted:(await n.listWorkflowNotices()).length};
 });
 expect(raced).toBe(true);expect(result).toEqual({refused:true,status:'failed',summary:'Concurrent settlement',unchanged:true,posted:1});
});
