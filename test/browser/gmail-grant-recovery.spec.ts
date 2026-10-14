import {test,expect} from '@playwright/test';
for(const reason of ['disconnected','scope-revoked'] as const)test(`Gmail same-ID ${reason} clears read availability and recovers explicitly`,async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');s.read=async()=>null;
  const w=window as any;w.gmailGrantFixture={connected:true,triage:true,reads:0,oauth:0};
  const client={gmailAccounts:async()=>[{connectionId:'same-grant',label:'Fixture mailbox',configured:true,connected:w.gmailGrantFixture.connected,grantedCapabilities:w.gmailGrantFixture.triage?['google.gmail.triage']:[]}],gmailSearch:async()=>{w.gmailGrantFixture.reads++;return {messages:[],syncedAt:'fixture-revision'};},initiateGmail:async()=>{w.gmailGrantFixture.oauth++;throw Error('No live OAuth in fixture');}};
  c.getCloudClient=()=>({client,sessionId:'fixture-cloud',credentialId:'fixture-only'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-cloud',credentialId:'fixture-only'}};c.getSnapshot=()=>snapshot as any;
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 // Opening Inbox loads the connected account once, without another tap.
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).gmailGrantFixture.reads)).toBe(1);
 await page.evaluate(reason=>{const f=(window as any).gmailGrantFixture;if(reason==='disconnected')f.connected=false;else f.triage=false;},reason);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:google-accounts-changed')));
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toHaveCount(0);
 await expect(page.getByText('Connect Gmail to read your inbox',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Fixture mailbox',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toHaveCount(0);
 await expect(page.getByText('Connect Gmail to read your inbox',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).gmailGrantFixture)).toMatchObject({reads:1,oauth:0});
 await page.evaluate(()=>{const f=(window as any).gmailGrantFixture;f.connected=true;f.triage=true;});
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:google-accounts-changed')));
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).gmailGrantFixture.reads)).toBe(2);
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).gmailGrantFixture.reads)).toBe(3);
 expect(await page.evaluate(()=>(window as any).gmailGrantFixture.oauth)).toBe(0);
});
