import {test,expect} from '@playwright/test';
import {cloudNotesVoiceFixture,agentNotesMock} from './cloud-notes-voice-fixture';
// The owner's case: "save a note …" runs the agent's own notes action during a chat turn. When the
// turn ends the note is in the Notes screen without a reload, and a later save shows on return.

test('a note the agent saves during a chat turn appears when the reply ends and after a visibility change',async({page})=>{
 await cloudNotesVoiceFixture(page,true,true);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');if(!c.getSnapshot().session)throw Error('Fixture did not connect');
  const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');
  // The synthetic agent saves into its own store before it replies, as NOTES_CREATE does.
  LocalAgentProtocol.prototype.send=async(_id:string,text:string)=>{(window as any).agentNotes.add(text.match(/save a note:\s*(.+)$/m)![1]);return {text:'Saved to your notes.'};};
 });
 await agentNotesMock(page);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await expect(page.getByRole('region',{name:'Alpha notes',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Type',exact:true}).click();
 const composer=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await composer.fill('save a note: buy milk');await composer.press('Enter');
 await expect(page.getByText('Saved to your notes.',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Alpha notes',exact:true}).getByRole('button',{name:'Open buy milk',exact:true})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).agentNotes.calls.filter((call:any)=>call.path==='/api/notes/state').length)).toBeGreaterThan(0);

 await page.evaluate(()=>(window as any).agentNotes.add('Call the plumber'));
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.getByRole('region',{name:'Alpha notes',exact:true}).getByRole('button',{name:'Open Call the plumber',exact:true})).toHaveCount(1);
});
