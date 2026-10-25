import {test,expect,type Page} from '@playwright/test';
import {cloudNotesVoiceFixture,agentNotesMock} from './cloud-notes-voice-fixture';
// Cold start: an unregistered notes route is "starting" and retried; a failing store is "unavailable".
// Neither is ever shown as an empty Alpha notes list, and phone notes stay editable throughout.

const fail=(page:Page,status:number,times:number)=>page.evaluate(({status,times})=>{const a=(window as any).agentNotes;for(let index=0;index<times;index++)a.next.push(()=>{throw Object.assign(Error('Synthetic HTTP '+status),{status});});},{status,times});
async function phoneNoteStillSaves(page:Page,title:string){
 await page.getByRole('button',{name:'New note',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open '+title,exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>JSON.parse(await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records.map((note:any)=>note.title))).toContain(title);
}

test('a route that is not registered yet shows the starting status, then the notes',async({page})=>{
 await cloudNotesVoiceFixture(page);await agentNotesMock(page,[{id:'milk',title:'Buy milk',body:''}]);await fail(page,404,1);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const section=page.getByRole('region',{name:'Alpha notes',exact:true});
 await expect(section.getByRole('status')).toHaveText('Starting your agent…');
 await expect(section.getByRole('button',{name:'Open Buy milk',exact:true})).toHaveCount(0);
 await phoneNoteStillSaves(page,'Written while starting');
 await expect(section.getByRole('button',{name:'Open Buy milk',exact:true})).toBeVisible({timeout:5000});
 await expect(section.getByRole('status')).toHaveCount(0);
});

test('a missing view client is reported as starting and the note is not resent',async({page})=>{
 await cloudNotesVoiceFixture(page);await agentNotesMock(page,[{id:'milk',title:'Buy milk',body:''}]);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const section=page.getByRole('region',{name:'Alpha notes',exact:true});await expect(section.getByRole('button',{name:'Open Buy milk',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).agentNotes.next.push(()=>({requestId:'request',success:false,error:'Missing client id for frontend view interaction. Provide X-ElizaOS-Client-Id or clientId.'})));
 const create=section.getByRole('textbox',{name:'New Alpha note',exact:true});await create.fill('Bread');await create.blur();
 await expect(section.getByRole('alert')).toHaveText('Your agent is still starting. Nothing was saved; try again shortly.');
 await expect(create).toHaveValue('Bread');
 expect(await page.evaluate(()=>(window as any).agentNotes.calls.filter((call:any)=>call.method==='POST').length)).toBe(1);
});

test('a persistent store failure shows unavailable, never an empty list',async({page})=>{
 await cloudNotesVoiceFixture(page);await agentNotesMock(page,[{id:'milk',title:'Buy milk',body:''}]);await fail(page,503,20);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const section=page.getByRole('region',{name:'Alpha notes',exact:true});
 await expect(section.getByRole('status')).toHaveText('Alpha notes are unavailable');
 await expect(section.getByRole('textbox',{name:'New Alpha note',exact:true})).toHaveCount(0);
 await phoneNoteStillSaves(page,'Written while unavailable');
 await expect(section.getByRole('status')).toHaveText('Alpha notes are unavailable');
});
