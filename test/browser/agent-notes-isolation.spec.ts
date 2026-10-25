import {test,expect,type Page} from '@playwright/test';
import {cloudNotesVoiceFixture,agentNotesMock,agentNotesInteractions} from './cloud-notes-voice-fixture';
// Alpha notes edits go only to the agent's own store: the phone document, its Trash and every
// legacy or browser storage key stay byte-identical, and the phone list renders unchanged.

const phoneState=(page:Page)=>page.evaluate(async()=>{
 const {readBrowserNotesRaw}=await import('/src/runtime/browser-notes-document.ts'),{readNotesTrash}=await import('/src/runtime/notes-trash.ts');
 return {document:await readBrowserNotesRaw(),trash:JSON.stringify(await readNotesTrash()),storage:Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))};
});
const phoneCards=(page:Page)=>page.locator('[data-alpha-subview="notes-list"] button[aria-current]').evaluateAll(nodes=>nodes.map(node=>[node.getAttribute('aria-label'),node.textContent]));

test('agent note create, update and delete never change phone notes, Trash or legacy keys',async({page})=>{
 await page.addInitScript(()=>{
  if(localStorage.getItem('agent-notes-seeded'))return;localStorage.setItem('agent-notes-seeded','yes');
  localStorage.setItem('alphaphone:notes:v2',JSON.stringify({version:2,collectionId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',records:[{id:'retained',kind:'text',title:'Retained',body:'Original bytes',updatedAt:'2026-01-02T03:04:05Z'}],deleted:[]},null,2));
  localStorage.setItem('alphaphone:daily:v1',JSON.stringify({notes:[],receipts:['kept']},null,2));
 });
 await cloudNotesVoiceFixture(page);
 await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-notes-storage-state','ready');
 await page.getByRole('button',{name:'New note',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Phone only');await page.getByRole('textbox',{name:'Note',exact:true}).fill('Stays on this phone');await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await page.getByRole('button',{name:'New note',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Trashed');await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await page.getByRole('button',{name:'Open Trashed',exact:true}).click();await page.getByRole('button',{name:'Delete note',exact:true}).click();await expect(page.getByText('Trashed moved to Trash',{exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-notes-storage-state','ready');
 const before=await phoneState(page),cards=await phoneCards(page);
 expect(cards.map(card=>card[0])).toEqual(['Open Phone only','Open Retained']);expect(JSON.parse(before.trash).entries).toHaveLength(1);

 await agentNotesMock(page,[{id:'milk',title:'Buy milk',body:''}]);
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));});
 const section=page.getByRole('region',{name:'Alpha notes',exact:true});
 await expect(section.getByRole('button',{name:'Open Buy milk',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'On this phone',exact:true})).toBeVisible();
 const create=section.getByRole('textbox',{name:'New Alpha note',exact:true});await create.fill('Call the plumber\nTuesday');await create.blur();
 await expect(section.getByRole('button',{name:'Open Call the plumber',exact:true})).toBeVisible();
 await section.getByRole('button',{name:'Open Buy milk',exact:true}).click();await section.getByRole('textbox',{name:'Alpha note',exact:true}).fill('Buy milk and eggs');await section.getByRole('button',{name:'Done',exact:true}).click();
 await section.getByRole('button',{name:'Open Buy milk and eggs',exact:true}).click();await section.getByRole('button',{name:'Delete Alpha note',exact:true}).click();await section.getByRole('button',{name:'Confirm delete',exact:true}).click();
 await expect(section.getByRole('button',{name:'Open Buy milk and eggs',exact:true})).toHaveCount(0);
 expect((await agentNotesInteractions(page)).map((body:any)=>body.capability)).toEqual(['create-note','update-note','delete-note']);

 expect(await phoneState(page)).toEqual(before);
 expect(await phoneCards(page)).toEqual(cards);
});
