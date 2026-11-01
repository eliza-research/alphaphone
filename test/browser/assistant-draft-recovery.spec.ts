import {test,expect as baseExpect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
// Every test here loads the whole development app at least once (several reload it, open a second tab
// or connect a profile), and the composer's saved draft is restored from IndexedDB after each load.
// Under four workers on a loaded machine a load has taken 10-30s and a restore more than the 5s
// default, so the timeouts are explicit: 90s per test, 15s per expectation. What is expected is
// unchanged; only how long the page may take to get there.
test.describe.configure({timeout:90_000});
const expect=baseExpect.configure({timeout:15_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!sessionStorage.getItem('draft-test-init')){localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));sessionStorage.setItem('draft-test-init','1');}});await page.goto('/');});
const composer=(page:any)=>page.getByRole('textbox',{name:'Ask Alpha',exact:true});
const status=(page:any)=>page.getByRole('status',{name:'Assistant draft status',exact:true});
async function saved(page:any){
 const text=await composer(page).inputValue();
 await expect.poll(()=>page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const binding=await c.assistantDraftBinding(new AbortController().signal);return (await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore(binding)).read())?.text||'';})).toBe(text);
 await expect(status(page)).toHaveCount(0);
}
/** The development agent with its transport replaced: each dispatch records the person's text (after the client observation). */
async function developmentAgent(page:any){
 await page.goto('/?mode=dev');await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');(window as any).sendDraftBinding=await c.assistantDraftBinding(new AbortController().signal);const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');(window as any).draftRequests=[];LocalAgentProtocol.prototype.send=async(_id,text)=>{(window as any).draftRequests.push(String(text).split('[USER MESSAGE]\n').pop());return {text:'Received'};};});
}
const draftBinding=(page:any)=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.assistantDraftBinding(new AbortController().signal));
const storedDraft=(page:any,binding:string)=>page.evaluate(async(binding:string)=>(await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore(binding)).read())?.text,binding);
const earlierDraft=(page:any,binding:string)=>page.evaluate(async(binding:string)=>(await(await import('/src/runtime/assistant-draft-store.ts')).readEarlierDraft(binding)).text,binding);
/** Another window replaces this binding's saved copy behind the composer. */
const writeElsewhere=(page:any,binding:string,text:string)=>page.evaluate(async({binding,text}:{binding:string;text:string})=>{const store=await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore(binding);await store.save(await store.read(),text);},{binding,text});
const visibleLayers=(page:any)=>page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]');
const visibleComposer=(page:any)=>visibleLayers(page).getByRole('textbox').first();
const earlierButton=(page:any,name:string)=>visibleLayers(page).getByRole('button',{name,exact:true});
test('an unsent multiline draft survives reload and clearing stays cleared',async({page})=>{
 await composer(page).fill('Remember this\nwithout sending');await saved(page);await page.reload();await expect(composer(page)).toHaveValue('Remember this\nwithout sending');// Successful restore stays quiet; the exact composer value above proves restoration.
 await expect(status(page)).toHaveCount(0);await composer(page).fill('');await saved(page);await page.reload();await expect(composer(page)).toHaveValue('');
});
test('another tab cannot replace a draft silently and recovery retains the current text',async({page,context},info)=>{
 const other=await context.newPage();await other.goto(page.url());await expect(composer(other)).toBeEnabled();await composer(page).fill('First window');await saved(page);await composer(other).fill('Second window');await expect(status(other)).toContainText('Review the saved copy');await expect(composer(other)).toHaveValue('Second window');await expect(other.getByText('Saved copy: First window',{exact:true})).toBeVisible();await other.screenshot({path:info.outputPath('assistant-draft-conflict.png'),animations:'disabled'});
 await other.getByRole('button',{name:'Replace saved draft with this text',exact:true}).click();await saved(other);await page.reload();await expect(composer(page)).toHaveValue('Second window');
});
test('failed autosave keeps editable text and explicit retry can save it',async({page})=>{
 await expect(composer(page)).toBeEnabled();await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;(window as any).restoreDraftPut=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='documents')throw new DOMException('Full','QuotaExceededError');return put.apply(this,args as any);};});
 await composer(page).fill('Keep this text');await expect(status(page)).toContainText('Draft was not saved');await expect(composer(page)).toHaveValue('Keep this text');
 // Send does not hide the failure: the notice, the text and its retry stay; nothing is set aside.
 await composer(page).press('Enter');await expect(status(page)).toContainText('Draft was not saved');await expect(composer(page)).toHaveValue('Keep this text');await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);await page.evaluate(()=>(window as any).restoreDraftPut());await page.getByRole('button',{name:'Replace saved draft with this text',exact:true}).click();await saved(page);await page.reload();await expect(composer(page)).toHaveValue('Keep this text');
});
test('Send clears the retained draft and dispatches only the reviewed text once',async({page})=>{
 await developmentAgent(page);
 await composer(page).fill('Reviewed draft');await saved(page);await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests.length)).toBe(1);// The draft is kept until the dispatch is confirmed, then cleared once.
 await expect.poll(()=>page.evaluate(async()=>(await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore((window as any).sendDraftBinding)).read())?.text)).toBe('');await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('');
});
// The draft guard never blocks Send. An empty saved copy found when the draft opens is bookkeeping and
// resolves without asking.
test('an empty saved copy found when the draft opens resolves without a banner, and Send works',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Before storage stopped');await saved(page);
 const binding=await draftBinding(page);await writeElsewhere(page,binding,'');
 // Reads of this draft fail until Retry, so the binding reopens with the composer's text.
 await page.evaluate(async(binding:string)=>{const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join(''),key='alpha.browser.assistant-draft:v1:'+hash,get=IDBObjectStore.prototype.get;(window as any).restoreDraftGet=()=>{IDBObjectStore.prototype.get=get;};IDBObjectStore.prototype.get=function(...args:any[]){if(args[0]===key)throw new DOMException('Unavailable','UnknownError');return get.apply(this,args as any);};},binding);
 await composer(page).fill('Typed while storage was unavailable');await expect(status(page)).toContainText('Draft was not saved. Your current text is retained.');
 await page.evaluate(()=>(window as any).restoreDraftGet());await page.getByRole('button',{name:'Retry draft storage',exact:true}).click();
 await saved(page);await expect(composer(page)).toHaveValue('Typed while storage was unavailable');await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
 await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Typed while storage was unavailable']);
 await expect.poll(()=>storedDraft(page,binding)).toBe('');expect(await earlierDraft(page,binding)).toBe('');await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
});

// A real conflict never blocks Send either: the other copy is kept in browser storage first (a sibling
// row of the same draft document store) and offered as "Restore earlier draft" until restored.
test('a real conflict never blocks Send, and the earlier copy survives a reload and restores exactly',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Words before the other window');await saved(page);
 const slot=await draftBinding(page),earlier='Earlier words\n  from another window ';await writeElsewhere(page,slot,earlier);
 await composer(page).fill('Words to send');await expect(status(page)).toContainText('Review the saved copy');
 await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Words to send']);
 await expect(earlierButton(page,'Restore earlier draft')).toBeVisible();const key=await draftBinding(page);
 await expect.poll(()=>earlierDraft(page,key)).toBe(earlier);expect(await storedDraft(page,key)).not.toBe(earlier);
 await page.reload();await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();if(!c.getSnapshot().session)await c.startDevelopment('local');});
 await expect.poll(()=>draftBinding(page)).toBe(key);await earlierButton(page,'Restore earlier draft').click();
 await expect(visibleComposer(page)).toHaveValue(earlier);
 await expect.poll(()=>storedDraft(page,key)).toBe(earlier);await expect.poll(()=>earlierDraft(page,key)).toBe('');await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
 await page.reload();await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();if(!c.getSnapshot().session)await c.startDevelopment('local');});
 await expect.poll(()=>draftBinding(page)).toBe(key);await expect(visibleComposer(page)).toHaveValue(earlier);await page.waitForTimeout(1_000);await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
});

test('a dismissed earlier draft stays dismissed after a reload and never shows in another conversation',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Words before the other window');await saved(page);
 await writeElsewhere(page,await draftBinding(page),'Dismiss these words');await composer(page).fill('Words to send');await expect(status(page)).toContainText('Review the saved copy');
 await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Words to send']);
 await expect(earlierButton(page,'Restore earlier draft')).toBeVisible();const key=await draftBinding(page);
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});await expect.poll(()=>draftBinding(page)).toBe(JSON.stringify(['offline']));await page.waitForTimeout(1_000);await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.startDevelopment('local');});await expect.poll(()=>draftBinding(page)).toBe(key);
 await earlierButton(page,'Dismiss earlier draft').click();await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);await expect.poll(()=>earlierDraft(page,key)).toBe('');
 await page.reload();await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();if(!c.getSnapshot().session)await c.startDevelopment('local');});
 await expect.poll(()=>draftBinding(page)).toBe(key);await page.waitForTimeout(1_000);await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
});

// Send reads the saved copy again before setting it aside: the review on screen may be stale.
const markSending=(page:any,binding:string,text:string)=>page.evaluate(async({binding,text}:{binding:string;text:string})=>{const store=await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore(binding);await store.save(await store.read(),text,undefined,{sending:true});},{binding,text});
async function conflicted(page:any,other:string,text:string){
 const slot=await draftBinding(page);await writeElsewhere(page,slot,other);await composer(page).fill(text);await expect(status(page)).toContainText('Review the saved copy');return slot;
}
test('a stale conflict never blocks the first Send, and a copy another window already sent is not offered',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Words before the other window');await saved(page);
 // The other window typed again behind this review: its newest copy is the one set aside.
 const slot=await conflicted(page,'Shown in the review','Words to send');await writeElsewhere(page,slot,'Typed again in the other window');
 await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Words to send']);
 const key=await draftBinding(page);await expect.poll(()=>earlierDraft(page,key)).toBe('Typed again in the other window');await expect(earlierButton(page,'Restore earlier draft')).toBeVisible();
 await earlierButton(page,'Dismiss earlier draft').click();await expect.poll(()=>earlierDraft(page,key)).toBe('');
 // The other window sent the copy this review shows, so the saved copy is empty when this one sends.
 await visibleComposer(page).fill('Second words');await expect.poll(()=>storedDraft(page,key)).toBe('Second words');
 await writeElsewhere(page,key,'Typed and sent in the other window');await visibleComposer(page).fill('Second words to send');
 await expect(visibleLayers(page).getByRole('status',{name:'Assistant draft status',exact:true}).first()).toContainText('Review the saved copy');await writeElsewhere(page,key,'');
 await visibleComposer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Words to send','Second words to send']);
 await expect.poll(()=>storedDraft(page,key)).toBe('');expect(await earlierDraft(page,key)).toBe('');await page.waitForTimeout(500);await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
});
test('a copy another window is sending is never set aside as a draft, and Send waits for its review',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Words before the other window');await saved(page);
 const slot=await conflicted(page,'In flight from the other window','Words to send');await markSending(page,slot,'In flight from the other window');
 await composer(page).press('Enter');await expect(status(page)).toContainText('This message may already have been sent');
 await page.waitForTimeout(500);expect(await page.evaluate(()=>(window as any).draftRequests)).toEqual([]);
 await expect(composer(page)).toHaveValue('Words to send');expect(await earlierDraft(page,slot)).toBe('');await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
});
test('earlier copies over the draft size limit take another row instead of blocking Send, and each is offered in turn',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Words before the other window');await saved(page);
 const first='a'.repeat(40_000),second='b'.repeat(30_000);
 await page.evaluate(async({binding,text}:{binding:string;text:string})=>{await(await import('/src/runtime/assistant-draft-store.ts')).keepEarlierDraft(binding,text);},{binding:await draftBinding(page),text:first});
 await conflicted(page,second,'Words to send');
 await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Words to send']);
 const key=await draftBinding(page);await expect.poll(()=>earlierDraft(page,key)).toBe(first);
 await earlierButton(page,'Restore earlier draft').click();await expect(visibleComposer(page)).toHaveValue(first);
 // Once the composer's draft holds the first copy, the second is offered.
 await expect.poll(()=>earlierDraft(page,key)).toBe(second);await expect(earlierButton(page,'Restore earlier draft')).toBeVisible();
 await earlierButton(page,'Dismiss earlier draft').click();await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);await expect.poll(()=>earlierDraft(page,key)).toBe('');
 await expect.poll(()=>storedDraft(page,key)).toBe(first);
});
test('an unreadable earlier-copy row is left as it is and never blocks Send: the copy takes the next row',async({page})=>{
 await developmentAgent(page);await composer(page).fill('Words before the other window');await saved(page);
 const slot=await draftBinding(page);
 // Row 0 of this binding's earlier copies holds bytes that are not a draft for it.
 const row=(page:any,binding:string,write:boolean)=>page.evaluate(async({binding,write}:{binding:string;write:boolean})=>{const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['earlier-draft',binding])))),n=>n.toString(16).padStart(2,'0')).join('');const {BrowserJsonDomainDocument}=await import('/src/browser/json-domain-document.ts');const doc=new BrowserJsonDomainDocument('alpha.browser.assistant-draft:v1:'+hash);if(write)await doc.editJson(()=>({version:1,binding:'another identity',revision:'r',text:'Not this conversation'}));return (await doc.capture()).raw;},{binding,write});
 const damaged=await row(page,slot,true);expect(damaged).toContain('another identity');
 await conflicted(page,'Earlier words','Words to send');
 await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests)).toEqual(['Words to send']);
 const key=await draftBinding(page);await expect.poll(()=>earlierDraft(page,key)).toBe('Earlier words');
 await earlierButton(page,'Restore earlier draft').click();await expect(visibleComposer(page)).toHaveValue('Earlier words');
 await expect.poll(()=>earlierDraft(page,key)).toBe('');await expect(earlierButton(page,'Restore earlier draft')).toHaveCount(0);
 expect(await row(page,slot,false)).toBe(damaged);
});

test('connection changes restore only that connection draft and retain the offline copy',async({page})=>{
 await page.goto('/?mode=dev');await composer(page).fill('Offline draft');await saved(page);await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');if(!c.getSnapshot().session)throw Error('Fixture did not connect');});await expect(composer(page)).toHaveValue('');await composer(page).fill('Connected draft');await saved(page);await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});await expect(composer(page)).toHaveValue('Offline draft');await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.startDevelopment('local');});await expect(composer(page)).toHaveValue('Connected draft');
});

test('damaged draft recovery backs up saved bytes and current text before a reviewed reset',async({page})=>{
 await page.evaluate(async()=>{const binding=JSON.stringify(['offline']),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');const {BrowserJsonDomainDocument}=await import('/src/browser/json-domain-document.ts');await new BrowserJsonDomainDocument('alpha.browser.assistant-draft:v1:'+hash).editJson(()=>({damaged:'retained'}));});await page.reload();await expect(status(page)).toContainText('could not be read');await composer(page).fill('Current unsaved text');await page.getByRole('button',{name:'Recover assistant draft',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Assistant draft recovery'});const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download assistant draft backup',exact:true}).click();const file=await download;const backup=JSON.parse(await readFile((await file.path())!,'utf8'));expect(backup.currentDraft).toBe('Current unsaved text');expect(backup.saved).toContain('damaged');await dialog.getByRole('button',{name:'Reset app assistant draft',exact:true}).click();// The confirmed reset reloads the app (domain-recovery.ts); wait for that load and the reloaded
 // composer rather than racing the old page's teardown.
 await Promise.all([page.waitForEvent('load',{timeout:60_000}),dialog.getByRole('button',{name:'Confirm assistant draft reset',exact:true}).click()]);await expect(dialog).toHaveCount(0);await expect(composer(page)).toBeVisible({timeout:30_000});await expect(composer(page)).toHaveValue('');await composer(page).fill('Usable again');await saved(page);
});

for(const initial of ['first',''])test(`a different tab restart selection cannot move the current draft: ${initial||'new conversation'}`,async({page})=>{
 await page.goto('/?mode=dev');await page.evaluate(async(initial)=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();const {developmentIdentity}=await import('/src/browser/development-identity.ts');const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');const identity=developmentIdentity('local'),key=JSON.stringify([new LocalAgentProtocol().origin,identity.ownerId,identity.agentId]);const choices=await import('/src/runtime/conversation-selection.ts');if(initial)await choices.selectConversation(key,await choices.captureConversationChoice(key),initial,new AbortController().signal,()=>{});await c.startDevelopment('local');if(!c.getSnapshot().session)throw Error('Fixture did not connect');await c.assistantDraftBinding(new AbortController().signal);await choices.selectConversation(key,await choices.captureConversationChoice(key),'other-tab',new AbortController().signal,()=>{});LocalAgentProtocol.prototype.send=async id=>{(window as any).draftTarget=id;return {text:'Received'};};},initial);
 await composer(page).fill('Stay in this conversation');await saved(page);await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftTarget||'')).not.toBe('');const target=await page.evaluate(()=>(window as any).draftTarget);expect(target).not.toBe('other-tab');if(initial)expect(target).toBe(initial);
});
