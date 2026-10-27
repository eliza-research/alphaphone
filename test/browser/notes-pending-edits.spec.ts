import {expect,test} from '@playwright/test';
import {openLegacyNotes} from './helpers/legacy-notes';

test('rapid Notes edits queue behind a pending commit without becoming recovery or an agent target',async({page})=>{
 await page.goto('/?mode=dev');
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records.length)).toBe(1);
 await expect(page.getByText('Saving on this device…',{exact:true})).toHaveCount(0);
 const before=await page.evaluate(async()=>JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()));
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.selectedObject?.kind)).toBe('note');

 // Hold the first durable write, then type in another field while its local draft is current.
 await page.evaluate(async()=>{
  const {browserNotesPort}=await import('/src/runtime/browser-notes-document.ts');
  const original=browserNotesPort.compareExchange.bind(browserNotesPort);
  const held=(window as any).pendingNotesWrite={calls:0,entered:false,release:null};
  browserNotesPort.compareExchange=async(expected,raw,signal)=>{
   held.calls++;
   if(!held.entered){held.entered=true;await new Promise<void>(resolve=>{held.release=resolve;});}
   return original(expected,raw,signal);
  };
 });
 const title=page.getByRole('textbox',{name:'Title',exact:true}),body=page.getByRole('textbox',{name:'Note',exact:true});
 await title.fill('Queued note title');
 await expect.poll(()=>page.evaluate(()=>(window as any).pendingNotesWrite.entered)).toBe(true);
 await body.fill('Body typed while the title commit is held.');
 await expect(title).toHaveValue('Queued note title');
 await expect(body).toHaveValue('Body typed while the title commit is held.');
 await expect(page.getByText('Saving on this device…',{exact:true})).toBeVisible();
 await expect(page.getByText(/Keep this screen open|Notes storage needs recovery|Save unconfirmed/)).toHaveCount(0);
 await expect(page.getByText(/^(Saved to Notes|Note saved|Recording saved to Notes)$/)).toHaveCount(0);
 expect(await page.evaluate(async()=>JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()))).toEqual(before);
 expect(await page.evaluate(()=>(window as any).pendingNotesWrite.calls)).toBe(1);
 expect(await page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.selectedObject?.kind)).toBe('legacy-app-notes-source');

 await page.evaluate(()=>(window as any).pendingNotesWrite.release());
 await expect.poll(()=>page.evaluate(async()=>{
  const rows=JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records;
  return rows.map((note:any)=>({id:note.id,title:note.title,body:note.body}));
 })).toEqual([{id:before.records[0].id,title:'Queued note title',body:'Body typed while the title commit is held.'}]);
 await expect(page.getByText('Saving on this device…',{exact:true})).toHaveCount(0);
 await expect(page.getByText(/Keep this screen open|Notes storage needs recovery|Save unconfirmed/)).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).pendingNotesWrite.calls)).toBe(2);
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.selectedObject?.kind)).toBe('note');
 await page.reload();await openLegacyNotes(page);
 await page.getByRole('button',{name:'Open Queued note title',exact:true}).click();
 await expect(body).toHaveValue('Body typed while the title commit is held.');
});
