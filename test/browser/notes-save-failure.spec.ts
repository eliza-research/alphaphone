import { test, expect } from '@playwright/test';

for (const failure of ['quota', 'concurrent edit'] as const) {
  test(`Notes retains unsaved text after ${failure}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Recovery note');
    const body = page.getByRole('textbox', { name: 'Note', exact: true });
    await body.fill('Saved original');
    await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/browser/notes-document.ts')).browserNotesDocument.read())!.raw).records.find((n:any)=>n.title==='Recovery note')?.body)).toBe('Saved original');
    const stored = await page.evaluate(async (failure) => {
      const {openBrowserNotes,browserNotesDocument}=await import('/src/browser/notes-document.ts');
      if(failure==='concurrent edit'){
        const store=await openBrowserNotes(),list=store.list;
        list.find(note=>note.title==='Recovery note')!.body='Saved in another view';await store.replace(list);
      }else{
        IDBObjectStore.prototype.put=function(){throw new DOMException('Storage full','QuotaExceededError');};
      }
      return (await browserNotesDocument.read())?.raw;
    }, failure);
    await body.fill('Unsaved text that must not disappear');
    await expect(body).toHaveValue('Unsaved text that must not disappear');
    await expect(page.getByRole('status').filter({ hasText: 'Keep this screen open' })).toBeVisible();
    // A refused edit must neither overwrite the concurrent value nor repeat an uncertain write.
    expect(await page.evaluate(async () => (await (await import('/src/browser/notes-document.ts')).browserNotesDocument.read())?.raw)).toBe(stored);
    await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
    await page.getByRole('button', { name: 'Open Recovery note', exact: true }).click();
    await expect(body).toHaveValue('Unsaved text that must not disappear');
  });
}
