import {test,expect} from '@playwright/test';
import {cloudNotesVoiceFixture,agentNotesMock,agentNotesInteractions} from './cloud-notes-voice-fixture';
// Real Notes view, adapter, stock notes client and Alpha transport over a synthetic agent store.

test('an agent note shows under Alpha notes, edits send full content with the revision, and delete confirms with Undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await cloudNotesVoiceFixture(page);await agentNotesMock(page,[{id:'milk',title:'Buy milk',body:'\nOat, two litres'}]);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const section=page.getByRole('region',{name:'Alpha notes',exact:true});
 await expect(section.getByRole('heading',{name:'Alpha notes',exact:true})).toBeVisible();
 await expect(section.getByRole('button',{name:'Open Buy milk',exact:true})).toContainText('Oat, two litres');

 await section.getByRole('button',{name:'Open Buy milk',exact:true}).click();
 const editor=section.getByRole('textbox',{name:'Alpha note',exact:true});
 await expect(editor).toHaveValue('Buy milk\nOat, two litres');
 await editor.fill('Buy milk\nOat, two litres\nand bread');
 await section.getByRole('button',{name:'Done',exact:true}).click();
 await expect(section.getByRole('button',{name:'Open Buy milk',exact:true})).toContainText('and bread');
 expect(await agentNotesInteractions(page)).toEqual([{capability:'update-note',params:{id:'milk',content:'Buy milk\nOat, two litres\nand bread',expectedRevision:1}}]);

 await section.getByRole('button',{name:'Open Buy milk',exact:true}).click();
 await section.getByRole('button',{name:'Delete Alpha note',exact:true}).click();
 await expect(section.getByText('Delete this note from your agent? It does not go to Trash.',{exact:true})).toBeVisible();
 expect(await agentNotesInteractions(page)).toHaveLength(1);
 await section.getByRole('button',{name:'Confirm delete',exact:true}).click();
 await expect(page.getByText('Buy milk deleted',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Alpha notes',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByRole('region',{name:'Alpha notes',exact:true}).getByRole('button',{name:'Open Buy milk',exact:true})).toBeVisible();
 expect((await agentNotesInteractions(page)).slice(1)).toEqual([{capability:'delete-note',params:{id:'milk'}},{capability:'create-note',params:{content:'Buy milk\nOat, two litres\nand bread'}}]);
 expect(errors).toEqual([]);
});

test('an edit conflict keeps the typed text in the editor and shows the agent change',async({page})=>{
 await cloudNotesVoiceFixture(page);await agentNotesMock(page,[{id:'milk',title:'Buy milk',body:''}]);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const section=page.getByRole('region',{name:'Alpha notes',exact:true});
 await section.getByRole('button',{name:'Open Buy milk',exact:true}).click();
 await page.evaluate(()=>{const a=(window as any).agentNotes;a.notes[0].title='Buy soy milk';a.revision++;});
 const editor=section.getByRole('textbox',{name:'Alpha note',exact:true});
 await editor.fill('Buy oat milk');
 await section.getByRole('button',{name:'Done',exact:true}).click();
 await expect(section.getByRole('alert')).toHaveText('Changed by your agent. Review and save again.');
 await expect(editor).toHaveValue('Buy oat milk');
 expect(await page.evaluate(()=>(window as any).agentNotes.notes[0].title)).toBe('Buy soy milk');
});
