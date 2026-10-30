import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
const snapshot=(page:import('@playwright/test').Page)=>page.evaluate(()=>(window as any).canonicalNotesFixture.state);

// Live agent Notes render through Alpha's own Notes template (the one mock mode shows), saved through
// the canonical Notes client: the same committed identity, expectedRevision and Trash restore.
test('canonical Notes UI creates, edits, trashes and restores the same committed identity',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Canonical browser note');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Exact first line.\nSecond line.');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Canonical browser note',exact:true})).toBeVisible();
 const before=(await snapshot(page)).notes[0];expect(before.body).toBe('\nExact first line.\nSecond line.');
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Updated exact text.');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.find((n:any)=>n.id===before.id)?.body)).toBe('\nUpdated exact text.');
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await page.getByRole('button',{name:'Delete note',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(0);
 await expect(page.getByText('Canonical browser note moved to Trash',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open Trash',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByText('Deleted notes are kept here for recovery.',{exact:true})).toBeVisible();
 await expect(trash.getByRole('button',{name:'Empty Trash',exact:true})).toHaveCount(0);
 await trash.getByRole('button',{name:'Restore Canonical browser note',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(1);
 const after=(await snapshot(page)).notes[0];expect(after.id).toBe(before.id);expect(after.body).toBe('\nUpdated exact text.');expect((await snapshot(page)).trash).toEqual([]);
 await trash.getByRole('button',{name:'Close Trash',exact:true}).click();
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Updated exact text.');
 const requests=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests);
 for(const capability of ['create-note','update-note','delete-note','restore-note'])expect(requests.some((r:any)=>r.path==='/api/views/notes/interact'&&r.body.capability===capability)).toBe(true);
 // Every edit of an existing record names the revision it was made against.
 for(const update of requests.filter((r:any)=>r.body?.capability==='update-note'))expect(Number.isSafeInteger(update.body.params.expectedRevision)).toBe(true);
 expect(requests.every((r:any)=>['/api/notes/state','/api/views/notes/interact'].includes(r.path))).toBe(true);expect(requests.filter((r:any)=>r.path==='/api/notes/state').length).toBeGreaterThanOrEqual(2);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('canonical failed save retains the owner draft until explicit discard and reload',async({page})=>{
 const {errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Saved draft');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Committed original');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await page.getByRole('button',{name:'Open Saved draft',exact:true}).click();
 await page.evaluate(()=>(window as any).canonicalNotesFixture.fail=true);
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Keep this unsaved owner text');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Keep this unsaved owner text');
 expect((await snapshot(page)).notes[0].body).toBe('\nCommitted original');
 await expect(page.getByText('Your draft is kept here. Reload the current notes to discard it.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 const attempts=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.fail=false);
 await page.getByRole('button',{name:'Discard draft and reload',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Committed original');
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(attempts);
 expect(errors).toEqual([]);
});

test('a checklist, pin and Back leave Alpha cards in the same canonical record',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Groceries');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Oat milk\nLemons');
 await page.getByRole('button',{name:'Turn into checklist',exact:true}).click();
 await page.getByRole('button',{name:'Check Oat milk',exact:true}).click();
 await page.getByRole('button',{name:'Pin',exact:true}).click();
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes[0]?.format)).toEqual({kind:'list',data:{items:[{t:'Oat milk',done:true},{t:'Lemons',done:false}],pinned:true}});
 const card=page.getByRole('button',{name:'Open Groceries',exact:true});
 await expect(card).toBeVisible();
 // The checklist card: a checked item is struck through, the pin is shown.
 await expect(card.getByText('Oat milk',{exact:true})).toHaveCSS('text-decoration-line','line-through');
 await expect(card.getByText('Lemons',{exact:true})).not.toHaveCSS('text-decoration-line','line-through');
 await expect(card.locator('[data-alpha-icon]')).toHaveCount(1);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('Delete on a new note that was never saved closes it without a Notes request',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 const before=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Delete note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(before);
 expect((await snapshot(page)).notes).toEqual([]);expect((await snapshot(page)).trash).toEqual([]);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('slow saves: typing during a new note\'s first save makes one record, and Delete waits for the save',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.delay=250);
 const title=page.getByRole('textbox',{name:'Title',exact:true}),body=page.getByRole('textbox',{name:'Note',exact:true}),review=page.getByRole('button',{name:/^(Reload Notes|Discard draft and reload)$/});
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await title.pressSequentially('Hello',{delay:40});await body.pressSequentially('World',{delay:40});
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.map((n:any)=>[n.title,n.body]))).toEqual([['Hello','\nWorld']]);
 const creates=(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests)).filter((r:any)=>r.body?.capability==='create-note');
 expect(creates).toHaveLength(1);
 // Delete while the first save of a new note is still in flight: it waits, then trashes that record.
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await title.fill('Fresh');
 await page.getByRole('button',{name:'Delete note',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.trash.map((entry:any)=>entry.note.title)),{timeout:10_000}).toEqual(['Fresh']);
 await expect(title).toHaveCount(0);
 await expect(review).toHaveCount(0);
 expect((await snapshot(page)).notes.map((n:any)=>n.title)).toEqual(['Hello']);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('an agent append refreshes the open note and its card, search reads it, and a stale owner edit is kept for review',async({page})=>{
 const at='2026-10-30T09:00:00.000Z';
 const {foreign,errors}=await canonicalNotesFixture(page,{notes:[
  {id:'launch',title:'Launch plan',body:'\nConfirm attestation flow',color:'yellow',createdAt:at,updatedAt:at},
  {id:'groceries',title:'Groceries',body:'',color:'yellow',createdAt:at,updatedAt:at,format:{kind:'list',data:{items:[{t:'Oat milk',done:false}]}}},
 ]});
 await openCanonicalNotes(page);
 // The agent's NOTES action commits outside the view; its reply's same-session invalidation
 // (connection-ui.tsx, app-record-completion.ts) is the only signal the view gets.
 const agentEdit=(id:string,announce=true)=>page.evaluate(({id,announce})=>{
  const f=(window as any).canonicalNotesFixture,note=f.state.notes.find((n:any)=>n.id===id);
  if(note.format?.kind==='list')note.format.data.items.push({t:'Agent item',done:false});else note.body+='\nAppended by the agent';
  f.state.revision++;
  if(announce)window.dispatchEvent(new CustomEvent('alpha:canonical-notes-invalidated',{detail:{sessionId:'canonical-fixture-session',revision:f.state.revision}}));
 },{id,announce});
 const body=page.getByRole('textbox',{name:'Note',exact:true});
 await page.getByRole('button',{name:'Open Launch plan',exact:true}).click();
 await expect(body).toHaveValue('Confirm attestation flow');
 await agentEdit('launch');
 await expect(body).toHaveValue('Confirm attestation flow\nAppended by the agent');
 // The owner's next edit names the revision that includes the agent's append.
 await body.fill('Confirm attestation flow\nAppended by the agent\nOwner line');
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.find((n:any)=>n.id==='launch').body)).toBe('\nConfirm attestation flow\nAppended by the agent\nOwner line');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Launch plan',exact:true})).toContainText('Owner line');
 await agentEdit('groceries');
 await expect(page.getByRole('button',{name:'Open Groceries',exact:true}).getByText('Agent item',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Search notes',exact:true}).click();
 await page.getByRole('textbox',{name:'Search notes',exact:true}).fill('agent item');
 await expect(page.getByRole('button',{name:'Open Groceries',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Open Launch plan',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Close search',exact:true}).click();
 // An agent change the view has not heard about yet: the owner's edit names an older revision, so
 // it is refused, the owner's text stays in the editor and nothing overwrites the agent's change.
 await page.getByRole('button',{name:'Open Launch plan',exact:true}).click();
 await agentEdit('launch',false);
 await body.fill('Owner text against an older revision');
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 await expect(body).toHaveValue('Owner text against an older revision');
 expect((await snapshot(page)).notes.find((n:any)=>n.id==='launch').body).toBe('\nConfirm attestation flow\nAppended by the agent\nOwner line\nAppended by the agent');
 await page.getByRole('button',{name:'Discard draft and reload',exact:true}).click();
 await expect(body).toHaveValue('Confirm attestation flow\nAppended by the agent\nOwner line\nAppended by the agent');
 const updates=(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests)).filter((r:any)=>r.body?.capability==='update-note');
 expect(updates.length).toBeGreaterThan(0);for(const update of updates)expect(Number.isSafeInteger(update.body.params.expectedRevision)).toBe(true);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('older device notes stay a separate explicit recovery source and are not opened by canonical Notes',async({page})=>{
 const {errors}=await canonicalNotesFixture(page);
 const before=await page.evaluate(async()=>{
  const m=await import('/src/runtime/browser-notes-document.ts');
  await(await m.openBrowserNotes()).replace([{id:'old-note',kind:'text',title:'Previous local note',body:'Retained exact local text',custom:{keep:'verbatim'}}]);
  return m.readBrowserNotesRaw();
 });
 await openCanonicalNotes(page);
 await expect(page.getByRole('button',{name:'Open Previous local note',exact:true})).toHaveCount(0);
 // Recording stays with the device-local collection.
 await expect(page.getByRole('button',{name:'Record and transcribe',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Previous notes',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Older notes',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Open Previous local note',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())).toBe(before);
 expect((await snapshot(page)).notes).toEqual([]);
 await page.getByRole('button',{name:'Return to Notes',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Previous notes',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});

test('canonical Notes editor stays focusable beside half chat and isolates without losing its draft under full chat',async({page})=>{
 await page.setViewportSize({width:412,height:915});
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 const title=page.getByRole('textbox',{name:'Title',exact:true}),note=page.getByRole('textbox',{name:'Note',exact:true});
 const body='Retained overlay draft.\n'+'Exact authored line.\n'.repeat(24);
 await title.fill('Overlay draft');await note.fill(body);
 const notes=page.locator('[data-alpha-layer="app"]'),panel=page.locator('[data-alpha-layer="conversation"]');
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Keep the unsent chat draft');
 await panel.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
 await expect(notes).not.toHaveAttribute('inert','');
 await note.focus();await expect(note).toBeFocused();
 await expect.poll(async()=>{const n=await note.boundingBox(),p=await panel.boundingBox();return n&&p?n.y+n.height-p.y:999;}).toBeLessThanOrEqual(-8);
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await expect(notes).toHaveAttribute('inert','');await expect(notes).toHaveAttribute('aria-hidden','true');
 await expect(notes.getByRole('textbox',{name:'Note',exact:true})).toHaveCount(0);
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('[data-alpha-layer="app"]'))).toBe(false);}
 await page.getByRole('button',{name:'Shrink chat',exact:true}).click();
 await expect(notes).not.toHaveAttribute('inert','');
 await expect(title).toHaveValue('Overlay draft');await expect(note).toHaveValue(body);
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Keep the unsent chat draft');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(1);
 expect((await snapshot(page)).notes[0].body).toBe('\n'+body);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
