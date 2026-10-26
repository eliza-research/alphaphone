import {expect,type Page} from '@playwright/test';
/** Seed only the isolated test's retained legacy document before explicitly opening Older notes.
 * Production source selection never initializes or migrates a missing legacy document. */
export async function openLegacyNotes(page:Page){
 await page.evaluate(async()=>{
  const m=await import('/src/runtime/browser-notes-document.ts');
  if(!await m.browserNotesPort.read())await m.openBrowserNotes();
 });
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const menu=page.getByLabel('Notes options',{exact:true});
 if(await menu.count()){
  await menu.click();await page.getByRole('button',{name:'Older notes',exact:true}).click();
 }
 await expect(page.getByRole('heading',{name:'Older notes',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeEnabled();
 await expect(page.getByText('Previous notes need a recovery review. Nothing was moved or changed.',{exact:true})).toHaveCount(0);
}
