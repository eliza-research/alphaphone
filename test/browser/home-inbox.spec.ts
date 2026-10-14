import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';

const tile=(page:Page)=>page.getByRole('region',{name:'Home',exact:true}).locator('[data-alpha-home-inbox]');
async function fixture(page:Page,theme='light'){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?theme='+theme);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
  s.read=async()=>null;
  const f=(window as any).homeInboxFixture={owner:'a',reads:0,accountReads:0,hold:false,fail:false,more:false,rows:[
   {id:'unread-a',threadId:'thread-a',subject:'Synthetic quarterly planning subject',from:'Synthetic sender A',to:[],snippet:'Private body preview must stay out of Home',receivedAt:'2026-10-09T00:00:00Z',unread:true},
   {id:'read',threadId:'thread-read',subject:'Already read email',from:'Synthetic sender B',to:[],snippet:'',receivedAt:'2026-10-09T00:00:00Z',unread:false},
   {id:'unread-b',threadId:'thread-b',subject:'Synthetic second subject',from:'Synthetic sender C',to:[],snippet:'',receivedAt:'2026-10-09T00:00:00Z',unread:true}]};
  const client={gmailAccounts:async()=>{f.accountReads++;return [{connectionId:'grant-'+f.owner,label:'Synthetic mailbox '+f.owner,connected:true,grantedCapabilities:['google.gmail.triage']}];},
   gmailSearch:async()=>{f.reads++;if(f.hold)await new Promise<void>(resolve=>f.release=resolve);if(f.fail)throw Error('Synthetic provider unavailable');return {messages:structuredClone(f.rows),syncedAt:'fixture',nextPageToken:f.more?'next-fixture-page':null};},
   gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false})};
  c.getCloudClient=()=>({client,sessionId:'fixture-'+f.owner} as any);
  const original=c.getSnapshot(),snapshots=new Map();c.getSnapshot=()=>{if(!snapshots.has(f.owner))snapshots.set(f.owner,{...original,cloudAccount:{environment:'production',userId:'fixture-'+f.owner,sessionId:'fixture-'+f.owner,credentialId:'fixture-only'}});return snapshots.get(f.owner);};
 });
}
async function load(page:Page){await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();await returnToApps(page);}

for(const theme of ['light','dark'])test(`Home Inbox uses cached unread subjects and aligned text: ${theme}`,async({page},info)=>{
 await fixture(page,theme);await load(page);const card=tile(page);await card.scrollIntoViewIfNeeded();
 await expect(card).toHaveAttribute('aria-label','Open Inbox: 2 unread emails');await expect(card).toContainText('2 unread');await expect(card).toContainText('Synthetic quarterly planning subject');await expect(card).toContainText('Synthetic second subject');
 await expect(card).not.toContainText('Already read email');await expect(card).not.toContainText('Private body preview');await expect(card).not.toContainText('View email accounts');
 expect(await card.locator('[aria-hidden="true"]').count()).toBe(1);
 expect(await card.evaluate(el=>{const card=el.getBoundingClientRect(),header=el.firstElementChild!,icon=header.lastElementChild!.getBoundingClientRect(),subjects=el.querySelector('[data-alpha-home-inbox-subjects]')!.getBoundingClientRect();return {iconRight:Math.round(card.right-icon.right),textLeft:Math.round(subjects.left-card.left),overflow:el.scrollWidth-el.clientWidth};})).toEqual({iconRight:22,textLeft:22,overflow:0});
 const before=await page.evaluate(()=>({reads:(window as any).homeInboxFixture.reads,accounts:(window as any).homeInboxFixture.accountReads}));await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent rerender');await expect(card).toContainText('Synthetic second subject');expect(await page.evaluate(()=>({reads:(window as any).homeInboxFixture.reads,accounts:(window as any).homeInboxFixture.accountReads}))).toEqual(before);
 await page.screenshot({path:info.outputPath('home-inbox-'+theme+'.png'),animations:'disabled'});
});

test('Home Inbox distinguishes complete empty results from partial loaded results',async({page})=>{
 await fixture(page);await page.evaluate(()=>{const f=(window as any).homeInboxFixture;f.rows=[];f.more=true;});await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByText('Your Inbox is empty',{exact:true})).toBeVisible();await returnToApps(page);await expect(tile(page)).toContainText('From loaded messages');await expect(tile(page)).not.toContainText('No unread');
 await page.evaluate(()=>{(window as any).homeInboxFixture.more=false;});await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByText('Your Inbox is empty',{exact:true})).toBeVisible();await returnToApps(page);await expect(tile(page)).toContainText('No unread email');await expect(tile(page).locator('[data-alpha-home-inbox-subjects]')).toHaveCount(0);
});

test('Home Inbox offers Connect email before a connection and never reads mail',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');await expect(tile(page)).toContainText('Connect email');await expect(tile(page)).not.toContainText('View email accounts');await expect(tile(page)).not.toContainText('No unread');
});

test('Home Inbox retains failure and retires cached subjects on owner change',async({page})=>{
 await fixture(page);await load(page);await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();await page.evaluate(()=>(window as any).homeInboxFixture.fail=true);await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await returnToApps(page);await expect(tile(page)).toContainText('Open to retry');await expect(tile(page)).not.toContainText('No unread');
 await page.evaluate(async()=>{(window as any).homeInboxFixture.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');await expect(tile(page)).not.toContainText('2 unread');
});

test('Home Inbox does not publish a cancelled delayed load as empty or fetched',async({page})=>{
 await fixture(page);await page.evaluate(()=>(window as any).homeInboxFixture.hold=true);await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeInboxFixture.release)).toBe('function');await returnToApps(page);await expect(tile(page)).toContainText('Open to load email');await expect(tile(page)).not.toContainText('No unread');await page.evaluate(()=>(window as any).homeInboxFixture.release());await expect(tile(page).locator('[data-alpha-home-inbox-subjects]')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).homeInboxFixture.reads)).toBe(1);
});
