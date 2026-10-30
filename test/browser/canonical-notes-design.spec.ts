import {test,expect,type Page} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
import {setTextScale} from './accessibility-states';

// Live agent Notes are drawn by Alpha's own Notes template, the one mock mode shows: header with
// Back, title and actions, the search pill, and a two-column masonry of rounded cards whose type
// (checklist, voice note, link, text) follows the record's own data. Screenshots land in
// test-results/notes-restore for side-by-side review with the mock-mode reference.
const SHOTS='test-results/notes-restore';
const at='2026-10-30T09:00:00.000Z';
const note=(id:string,title:string,body:string,format?:{kind:string;data:Record<string,unknown>})=>({id,title,body:body?'\n'+body:'',color:'yellow',createdAt:at,updatedAt:at,...(format?{format}:{})});
const NOTES=[
 note('voice-sync','Design sync','',{kind:'voice',data:{dur:408,when:'Yesterday · 4:10 PM',
  lines:[{s:'me',t:'Lock screen first. Notifications stay as icons until you unlock.',at:0},{s:'me',t:'Voice still works locked, but the answers stay vague.',at:42},{s:'me',t:'Cut the mark button from the recorder.',at:190}],
  summary:['Notifications stay as icons until unlock','Voice works while locked; answers stay vague','The recorder drops the mark button'],
  actions:[{t:'Wire the recorder into Notes by Thursday',done:false},{t:'Send the prototype to the team tonight',done:true},{t:'Book a design review next week',done:false}]}}),
 note('launch','Launch checklist','Confirm attestation flow\nShip the keys-on-device doc\nDry run Friday',{kind:'text',data:{pinned:true}}),
 note('groceries','Groceries','',{kind:'list',data:{items:[{t:'Oat milk',done:true},{t:'Espresso beans',done:false},{t:'Lemons',done:false},{t:'Sourdough loaf',done:false}]}}),
 note('agents','The case for on-device agents','',{kind:'link',data:{url:'https://news.example/on-device-agents',domain:'news.example',clips:['Keys that never leave the device change what an assistant can be trusted with.','The phone becomes the agent\'s body, not just its screen.']}}),
 note('gifts','Gift ideas','Film camera, ceramics class.\nThe print show at the museum.'),
 // A voice-kind record without transcript, summary or actions is a plain text card.
 note('voicemail','Radiator','Call the landlord Friday. Bedroom radiator clanks all night.',{kind:'voice',data:{}}),
];
async function openSeeded(page:Page,path='/'){
 const fixture=await canonicalNotesFixture(page,{path,notes:NOTES});await openCanonicalNotes(page);
 await expect(page.getByRole('button',{name:'Open Design sync',exact:true})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 return fixture;
}
const card=(page:Page,title:string)=>page.getByRole('button',{name:`Open ${title}`,exact:true});
async function shot(page:Page,name:string){await page.screenshot({path:`${SHOTS}/${name}.png`,animations:'disabled'});}
/** Geometry and paint of the Notes list that the mock design fixes. */
async function layout(page:Page){
 return page.evaluate(()=>{
  const box=(el:Element|null)=>{if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:Math.round(r.x),w:Math.round(r.width),radius:s.borderRadius,bg:s.backgroundColor};};
  const cards=[...document.querySelectorAll('[data-alpha-subview="notes-list"] button.note-card')];
  return {title:getComputedStyle(document.querySelector('[data-alpha-app-title]')!).fontSize,search:box(document.querySelector('[data-alpha-subview="notes-list"] button[aria-label="Search notes"]')),
   columns:[...new Set(cards.map(el=>Math.round(el.getBoundingClientRect().x)))].sort((a,b)=>a-b),first:box(cards[0])};
 });
}

test('live agent Notes use the mock-mode Notes design with typed cards',async({page})=>{
 await page.goto('/?mode=mock&start=notes');await expect(page.getByRole('button',{name:'Open Design sync',exact:true})).toBeVisible();
 const mock=await layout(page);await shot(page,'reference-mock-list');
 // The mock checklist editor, for the side-by-side review of the live one.
 await card(page,'Groceries').click();await expect(page.getByRole('button',{name:'Uncheck Oat milk',exact:true})).toBeVisible();
 await shot(page,'reference-mock-checklist');
 const {foreign,errors}=await openSeeded(page);
 expect(await layout(page)).toEqual(mock);
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
 for(const name of ['Back to apps','Open Trash','New note','Search notes'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Record and transcribe',exact:true})).toHaveCount(0);
 // Pinned first, then the collection order, alternating between the two columns.
 const order=await page.locator('[data-alpha-subview="notes-list"] button.note-card').evaluateAll(list=>list.map(el=>[el.getAttribute('aria-label'),Math.round(el.getBoundingClientRect().x)]));
 expect(order.map(([label])=>label)).toEqual(['Open Launch checklist','Open Groceries','Open Gift ideas','Open Design sync','Open The case for on-device agents','Open Radiator']);
 await expect(card(page,'Launch checklist').locator('[data-alpha-icon]')).toHaveCount(1);
 await expect(card(page,'Design sync')).toContainText('6:48 · 3 to-dos');
 expect(await card(page,'Design sync').locator('span').count()).toBeGreaterThanOrEqual(20);
 await expect(card(page,'The case for on-device agents')).toContainText('news.example');
 await expect(card(page,'Groceries').getByText('Oat milk',{exact:true})).toHaveCSS('text-decoration-line','line-through');
 await expect(card(page,'Radiator')).toContainText('Call the landlord Friday.');
 await expect(card(page,'Radiator').locator('span')).toHaveCount(0);
 // The shared Notes view's agent ids stay on the matching controls (canonical-notes-ui.ts, template.html).
 const ids=(scope:string)=>page.locator(`${scope} [data-agent-id]`).evaluateAll(list=>list.filter(el=>(el as HTMLElement).getClientRects().length).map(el=>el.getAttribute('data-agent-id')));
 expect(await ids('[data-alpha-subview="notes-list"]')).toEqual(['notes-trash','notes-new','notes-search','launch','groceries','gifts','voice-sync','agents','voicemail','notes-source-legacy']);
 await shot(page,'live-list');
 await page.getByRole('button',{name:'Previous notes',exact:true}).scrollIntoViewIfNeeded();
 expect((await page.getByRole('button',{name:'Previous notes',exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(48);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('live agent Notes in dark mode, the text editor and the checklist editor',async({page})=>{
 const {foreign,errors}=await openSeeded(page,'/?theme=dark');
 await shot(page,'live-list-dark');
 await card(page,'Launch checklist').click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Confirm attestation flow\nShip the keys-on-device doc\nDry run Friday');
 for(const name of ['Back to notes','Dictate','Turn into checklist','Unpin','Share note','Delete note','Review reminder draft','Review calendar event draft']){
  const control=page.getByRole('button',{name,exact:true});await expect(control).toBeVisible();
  const box=(await control.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(412);
  // Alpha's editor header holds up to eight 44px actions; the draft actions are full 48px rows.
  expect(box.height).toBeGreaterThanOrEqual(name.startsWith('Review')?47.5:43.5);
 }
 await shot(page,'live-editor-dark');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Groceries').click();
 await expect(page.getByRole('button',{name:'Uncheck Oat milk',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check Lemons',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes.find((n:any)=>n.id==='groceries').format.data.items[2])).toEqual({t:'Lemons',done:true});
 expect(await page.locator('[data-alpha-subview="notes-editor"] [data-agent-id]').evaluateAll(list=>list.map(el=>el.getAttribute('data-agent-id')))).toEqual(
  expect.arrayContaining(['notes-back','notes-dictate','notes-format','notes-pin','notes-share','notes-delete','notes-title','notes-draftReminder','notes-draftEvent','notes-remove-item-0','notes-remove-item-3','notes-add-item']));
 await shot(page,'live-checklist-dark');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Design sync').click();
 await expect(page.getByText('Notifications stay as icons until unlock',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Play recording',exact:true}).or(page.getByRole('button',{name:'Play',exact:true}))).toHaveCount(0);
 expect(await page.locator('[data-alpha-subview="notes-voice"] [data-agent-id]').evaluateAll(list=>list.map(el=>el.getAttribute('data-agent-id')))).toEqual(
  expect.arrayContaining(['notes-back','notes-pin','notes-share','notes-delete','notes-action-0','notes-action-2']));
 await shot(page,'live-voice-dark');
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('live agent Notes light editor, checklist and restore-only Trash',async({page})=>{
 const {foreign,errors}=await openSeeded(page);
 await card(page,'Launch checklist').click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Launch checklist');
 await shot(page,'live-editor');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Groceries').click();
 await expect(page.getByRole('button',{name:'Uncheck Oat milk',exact:true})).toBeVisible();
 await shot(page,'live-checklist');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await card(page,'Gift ideas').click();
 await page.getByRole('button',{name:'Delete note',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.state.trash.length)).toBe(1);
 await page.getByRole('button',{name:'Open Trash',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByRole('button',{name:'Restore Gift ideas',exact:true})).toBeVisible();
 await expect(trash.getByText('Note · Recoverable',{exact:true})).toBeVisible();
 await shot(page,'live-trash');
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('live agent Notes at 300% text keep cards and controls on screen',async({page})=>{
 test.setTimeout(90_000);
 await page.goto('/?mode=mock&start=notes');await expect(page.getByRole('button',{name:'Open Design sync',exact:true})).toBeVisible();
 await setTextScale(page,3);await shot(page,'reference-mock-list-300pct');
 const {foreign,errors}=await openSeeded(page);
 await setTextScale(page,3);
 const overflow=await page.evaluate(()=>{
  const out:string[]=[];
  for(const el of document.querySelectorAll<HTMLElement>('[data-alpha-subview="notes-list"] button')){
   if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
   if(r.left<-1||r.right>innerWidth+1)out.push(`${el.getAttribute('aria-label')} outside the screen`);
   if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)out.push(`${el.getAttribute('aria-label')} clips its text`);
  }
  return out;
 });
 expect(overflow).toEqual([]);
 for(const name of ['Back to apps','Open Trash','New note']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x+box.width).toBeLessThanOrEqual(413);}
 await shot(page,'live-list-300pct');
 await card(page,'Launch checklist').click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toBeVisible();
 await shot(page,'live-editor-300pct');
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
