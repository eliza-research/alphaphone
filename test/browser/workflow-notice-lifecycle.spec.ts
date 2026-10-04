import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');});
test('history hides the older download when no older copy exists',async({page})=>{
 await page.evaluate(async()=>{const {openWorkflowHistory}=await import('/src/browser/workflow-history.ts');openWorkflowHistory(()=>({flows:[],localRuns:{}}),()=>{},()=>false);});
 const dialog=page.getByRole('dialog',{name:'Workflow history',exact:true});await expect(dialog.getByRole('link',{name:'Download notification history',exact:true})).toBeVisible();
 await expect(dialog.getByText('Download older notification history',{exact:true})).toBeHidden();
});
for(const event of ['launcher-home','alpha:device-state'])test(`notice action cancelled by ${event} cannot commit or navigate later`,async({page})=>{
 const before=await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),row=await n.publishWorkflowNotice('late-open','Retain notice',new AbortController().signal),edit=n.workflowNoticesDocument.edit.bind(n.workflowNoticesDocument);let navigated=0;
  window.addEventListener('alpha:browser-open-view',()=>navigated++);
  n.workflowNoticesDocument.edit=(initial,prepare,signal)=>edit(initial,async data=>{const result=await prepare(data);(window as any).noticePrepared=true;await new Promise<void>(resolve=>(window as any).releaseNotice=resolve);return result;},signal);
  (window as any).noticeAction=n.actOnWorkflowNotice(row,true).then(()=>({cancelled:false,navigated}),()=>({cancelled:true,navigated}));
  return n.savedWorkflowNoticeHistory();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).noticePrepared)).toBe(true);
 await page.evaluate(event=>{window.dispatchEvent(new Event(event));(window as any).releaseNotice();},event);
 expect(await page.evaluate(()=>(window as any).noticeAction)).toEqual({cancelled:true,navigated:0});
 expect(await page.evaluate(async()=>(await import('/src/browser/workflow-notices.ts')).savedWorkflowNoticeHistory())).toBe(before);
});
test('locking while another notice source is loading redacts the complete result',async({page})=>{
 await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),{BrowserNotifications}=await import('/src/browser/notifications.ts'),{browserHostedResults}=await import('/src/browser/hosted-results.ts');
  await n.publishWorkflowNotice('late-read','Private result',new AbortController().signal,'Private title');
  const original=browserHostedResults.list.bind(browserHostedResults);browserHostedResults.list=async()=>{(window as any).noticeListHeld=true;await new Promise<void>(resolve=>(window as any).releaseNoticeList=resolve);return original();};
  const notifications=new BrowserNotifications({listReminders:async()=>({reminders:[]})} as any,{listAlerts:async()=>({items:[]})} as any);
  (window as any).noticeList=notifications.list();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).noticeListHeld)).toBe(true);
 await page.evaluate(()=>{document.documentElement.dataset.devBackground='true';(window as any).releaseNoticeList();});
 const rows=await page.evaluate(async()=>(await (window as any).noticeList).items);
 expect(rows.find((row:any)=>row.id==='workflow:late-read')).toMatchObject({title:'Workflows',text:'',canOpen:false});
});
