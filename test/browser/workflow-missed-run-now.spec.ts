import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
// P-10 (#394): a typed workflow's scheduled time that passed while the agent was not running is
// recorded once as missed by the agent and never replayed. Its receipt says nothing ran and offers
// an explicit Run now, which returns to the workflow's own reviewed run confirmation and starts one
// new run. A synthetic agent in the page answers workflow routes; every request is recorded.
async function setup(page:Page){
 await page.goto('/?mode=dev&workflows=agent');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(async()=>{
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const trigger={kind:'time',localTime:'07:30',timeZone:'UTC',days:[3]};
  const spec=JSON.stringify({version:1,name:'Morning',description:'',trigger,steps:[{id:'s0',kind:'Read',operation:'selected_notes'},{id:'s1',kind:'Write',operation:'model_draft'}]});
  const flows:any={morning:{id:'morning',name:'Morning notes digest',description:'Reads selected notes and drafts a digest',active:true,versionId:'morning-v1',steps:[{label:'Read selected Notes'},{label:'Draft digest'}],metadata:{elizaPhoneWorkflowSpec:spec}}};
  const scheduledAt='2026-10-28T07:30:00.000Z';
  const missed={id:'run-missed',workflowId:'morning',workflowVersionId:'morning-v1',status:'finished',startedAt:'2026-10-28T09:00:00Z',finished:true,stoppedAt:'2026-10-28T09:00:00Z',mode:'trigger',input:{typedSchedule:{scheduledAt,trigger,status:'ready',text:''}},output:{status:'missed',scheduledAt,text:'Not run: the agent was not running at the scheduled time'},events:[]};
  // A hosted digest is admitted only at its own scheduled occurrence; the agent refuses a manual run of it.
  flows.digest={id:'digest',name:'Evening digest',description:'Hosted evening digest',active:true,versionId:'digest-v1',steps:[{label:'Read selected Notes'}],metadata:{elizaHostedDigestV1:'{}'}};
  const digestMissed={id:'run-digest-missed',workflowId:'digest',workflowVersionId:'digest-v1',status:'finished',startedAt:'2026-10-28T09:00:00Z',finished:true,stoppedAt:'2026-10-28T09:00:00Z',mode:'trigger',input:{hostedDigest:{status:'missed'}},output:{status:'missed',scheduledAt,text:'The scheduled time was missed. No backlog was executed.'},events:[]};
  const runs:any={morning:[missed],digest:[digestMissed]};
  const w=window as any;w.agentRequests=[];
  const request=async(path:string,body:any)=>{
   w.agentRequests.push({path,method:body===undefined?'GET':'POST',body});
   if(path==='/api/automations')return {automations:Object.values(flows).map((flow:any)=>({id:'workflow:'+flow.id,type:'workflow',workflowId:flow.id,title:flow.name,description:flow.description,enabled:flow.active,status:flow.active?'active':'paused',schedules:[]}))};
   if(path==='/api/lifeops/reminders')return {reminders:[]};
   if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')return {tasks:[]};
   if(path==='/api/workflow/status')return {engine:'smthrs',status:'ready',manualSubmissionProtocol:1,lifecycleMutationProtocol:1,typedScheduleProtocol:1};
   if(path==='/api/workflow/workflows')return {workflows:Object.values(flows)};
   let m=/^\/api\/workflow\/workflows\/([^/]+)(\/.*)?$/.exec(path);
   if(m){const flow=flows[m[1]],rest=m[2]||'';if(!flow)throw Error('unknown flow');
    if(rest==='')return flow;
    if(rest==='/executions')return {executions:runs[flow.id]};
    if(rest==='/run'){const run={id:'run-new-'+runs[flow.id].length,workflowId:flow.id,workflowVersionId:flow.versionId,status:'finished',startedAt:'2026-10-28T09:05:00Z',finished:true,stoppedAt:'2026-10-28T09:05:05Z',output:'Synthetic digest text',events:[]};runs[flow.id].unshift(run);return {submissionId:body.submissionId,execution:run};}
   }
   m=/^\/api\/workflow\/executions\/([^/]+)$/.exec(path);
   if(m){const run=(Object.values(runs).flat() as any[]).find(r=>r.id===m![1]);if(!run)throw Error('unknown run');return {execution:run};}
   throw Error('Unexpected synthetic route '+path);
  };
  const client=new WorkflowProtocol((path,body)=>request(path,body));const original=c.getWorkflowClient.bind(c);
  c.getWorkflowClient=()=>{const binding=original();return binding?{...binding,client}:binding;};
  const automations=c.getAutomationsClient.bind(c);c.getAutomationsClient=()=>{const binding=automations();return binding?{...binding,request:async(path,method)=>{if(method!=='GET')throw Error('Unexpected automation mutation');return request(path,undefined);}}:binding;};
 });
 await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();
}
const posts=(page:Page,suffix:string)=>page.evaluate(suffix=>(window as any).agentRequests.filter((r:any)=>r.method==='POST'&&r.path.endsWith(suffix)).length,suffix);

test('a missed scheduled time says nothing ran and offers Run now only through the reviewed run confirmation',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Morning notes digest',{exact:true}).first().click();
 await page.getByRole('button',{name:'Missed — did not run execution',exact:true}).click();await page.getByText('Execution details',{exact:true}).click();
 await expect(page.getByText(/this scheduled time came while the phone or agent was off, so nothing ran\. It is never run later/)).toBeVisible();
 await page.waitForTimeout(500);expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Back to workflow to review and start one new run now',exact:true}).click();
 await expect(page.getByText(/Review the steps, then tap Run now again to start this workflow once/).first()).toBeVisible();expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Run now',exact:true}).click();await expect.poll(()=>posts(page,'/run')).toBe(1);
 const sent=await page.evaluate(()=>(window as any).agentRequests.find((r:any)=>r.path.endsWith('/run')).body);expect(sent.expectedVersionId).toBe('morning-v1');
 await expect(page.getByText('Synthetic digest text',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to Morning notes digest',exact:true}).click();
 // The missed record stays in history as not run; the new run is separate.
 await expect(page.getByRole('button',{name:'Missed — did not run execution',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'finished execution',exact:true})).toBeVisible();expect(await posts(page,'/run')).toBe(1);
});

test('a hosted digest\'s missed time offers no Run now, because only its own schedule admits it',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Evening digest',{exact:true}).first().click();
 await page.getByRole('button',{name:'Missed — did not run execution',exact:true}).click();await page.getByText('Execution details',{exact:true}).click();
 await expect(page.getByText(/so nothing ran\. It is never run later\. This digest runs again only at its next scheduled occurrence/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Back to workflow to review and start one new run now',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to workflow',exact:true}).click();
 await page.waitForTimeout(500);expect(await posts(page,'/run')).toBe(0);
});
