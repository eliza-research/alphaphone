import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
const snapshot=(page:import('@playwright/test').Page)=>page.evaluate(()=>(window as any).canonicalNotesFixture.state);

test('canonical Notes UI creates, edits, trashes and restores the same committed identity',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
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
 await page.getByRole('button',{name:'Open Trash',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByText('Deleted notes are kept here for recovery.',{exact:true})).toBeVisible();
 await trash.getByRole('button',{name:'Restore Canonical browser note',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(1);
 const after=(await snapshot(page)).notes[0];expect(after.id).toBe(before.id);expect(after.body).toBe('\nUpdated exact text.');expect((await snapshot(page)).trash).toEqual([]);
 await trash.getByRole('button',{name:'Close Trash',exact:true}).click();
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Updated exact text.');
 const requests=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests);
 for(const capability of ['create-note','update-note','delete-note','restore-note'])expect(requests.some((r:any)=>r.path==='/api/views/notes/interact'&&r.body.capability===capability)).toBe(true);
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
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 const attempts=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.fail=false);
 await page.getByRole('button',{name:'Discard draft and reload',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Committed original');
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(attempts);
 expect(errors).toEqual([]);
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
 await page.getByLabel('Notes options',{exact:true}).click();
 await page.getByRole('button',{name:'Older notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Previous local note',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())).toBe(before);
 expect((await snapshot(page)).notes).toEqual([]);expect(errors).toEqual([]);
});
