import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-notes-storage-state','ready');});
test('browser Notes persists canonically without a localStorage mirror and rejects stale writers',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {openBrowserNotes,browserNotesDocument}=await import('/src/browser/notes-document.ts');
  const a=await openBrowserNotes(),b=await openBrowserNotes(),original=localStorage.getItem('alphaphone:notes:v2');
  await a.replace([{id:'one',kind:'text',title:'Saved',body:'Canonical text'}]);let conflict=false;
  try{await b.replace([{id:'two',kind:'text',title:'Stale'}]);}catch{conflict=true;}
  const current=await openBrowserNotes();return {conflict,ids:current.list.map(n=>n.id),legacy:localStorage.getItem('alphaphone:notes:v2'),original,raw:(await browserNotesDocument.read())?.raw};
 });expect(result.conflict).toBe(true);expect(result.ids).toEqual(['one']);expect(result.legacy).toBe(result.original);expect(result.raw).toContain('Canonical text');
 await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(page.getByRole('button',{name:'Open Saved',exact:true})).toBeVisible();
});
test('reset prevents stale editors and never reimports retained sources',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {openBrowserNotes,browserNotesDocument:d}=await import('/src/browser/notes-document.ts');const a=await openBrowserNotes();await a.replace([{id:'one',kind:'text',title:'Before reset'}]);const captured=await d.capture();await d.reset(captured);let refused=false;try{await a.replace([{id:'one',kind:'text',title:'Stale restore'}]);}catch{refused=true;}return {refused,list:(await openBrowserNotes()).list,backup:captured.raw};
 });expect(result.refused).toBe(true);expect(result.list).toEqual([]);expect(result.backup).toContain('Before reset');
});
test('failed IndexedDB commit retains canonical bytes and faults the editor',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {openBrowserNotes,browserNotesDocument:d}=await import('/src/browser/notes-document.ts');const a=await openBrowserNotes(),before=await d.read(),put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};let refused=false;try{await a.replace([{id:'one',kind:'text',title:'Unsaved'}]);}catch{refused=true;}finally{IDBObjectStore.prototype.put=put;}
  return {refused,recovery:a.needsRecovery,same:JSON.stringify(before)===JSON.stringify(await d.read())};
 });expect(result).toEqual({refused:true,recovery:true,same:true});
});
test('normal Notes exposes backup and confirmed reset',async({page})=>{
 await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'Notes recovery',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Notes recovery',exact:true});await expect(dialog.getByRole('button',{name:'Download notes backup',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Reset browser notes',exact:true}).click();await expect(dialog.getByRole('button',{name:'Confirm notes reset',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Close recovery',exact:true}).click();
});
for(const source of ['v2','v1','daily','malformed'] as const)test(`preserve exact ${source} sources and detect later Notes writes`,async({browser})=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
 await page.addInitScript(source=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','yes');
  const note={id:'retained',kind:'text',title:'Retained',body:'Original bytes',updatedAt:'2026-01-02T03:04:05Z'};
  if(source==='v2')localStorage.setItem('alphaphone:notes:v2',JSON.stringify({version:2,collectionId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',records:[note],deleted:[{id:'gone',revision:'r1',operationId:'delete-1'}]},null,2));
  if(source==='v1')localStorage.setItem('alphaphone:prototype:notes:v1',JSON.stringify([note],null,3));
  localStorage.setItem('alphaphone:daily:v1',source==='malformed'?' { malformed original ':JSON.stringify({notes:source==='daily'?[note]:[],receipts:[]},null,2));
 },source);
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-notes-storage-state',source==='malformed'?'recovery':'ready');
 const result=await page.evaluate(async(source)=>{
  const {browserNotesDocument:d,openBrowserNotes}=await import('/src/browser/notes-document.ts');const backup=await d.capture();
  if(source==='malformed'){await d.reset(backup);return {empty:(await openBrowserNotes()).list.length,backup:backup.raw};}
  const store=await openBrowserNotes(),before=await d.read(),daily=JSON.parse(localStorage.getItem('alphaphone:daily:v1')!);daily.receipts.push('unrelated');localStorage.setItem('alphaphone:daily:v1',JSON.stringify(daily));await store.assertCurrent();
  daily.notes.push({id:'new',title:'Late old-tab write'});localStorage.setItem('alphaphone:daily:v1',JSON.stringify(daily));let refused=false;try{await store.assertCurrent();}catch{refused=true;}
  const current=await d.capture();return {refused,changed:current.legacyChanged,backup:backup.raw,before:before?.raw,empty:null};
 },source);
 if(source==='malformed'){expect(result.empty).toBe(0);expect(result.backup).toContain(' { malformed original ');}
 else{expect(result.refused).toBe(true);expect(result.changed).toBe(true);expect(result.backup).toContain('Original bytes');if(source==='v2'){expect(result.before).toContain('delete-1');expect(result.before).toContain('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');}}
 }finally{await context.close();}
});
test('lost commit acknowledgement keeps the saved note and prevents replay',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {openBrowserNotes,browserNotesDocument:d}=await import('/src/browser/notes-document.ts');const store=await openBrowserNotes(),commit=d.compareExchange;
  d.compareExchange=async(...args)=>{await commit(...args);throw Error('Lost commit acknowledgement');};let refused=false;
  try{await store.replace([{id:'one',kind:'text',title:'Committed once'}]);}catch{refused=true;}finally{d.compareExchange=commit;}
  let replay=false;try{await store.replace([{id:'two',kind:'text',title:'Must not replace'}]);}catch{replay=true;}
  return {refused,replay,ids:(await openBrowserNotes()).list.map(n=>n.id)};
 });expect(result).toEqual({refused:true,replay:true,ids:['one']});
});
test('independent tabs cannot both commit from the same Notes generation',async({page,context})=>{
 const second=await context.newPage();try{await second.goto('/');
 const capture=async(p:typeof page)=>p.evaluate(async()=>{(window as any).capturedNotes=await (await import('/src/browser/notes-document.ts')).openBrowserNotes();return (window as any).capturedNotes.raw;});
 expect(await capture(page)).toBe(await capture(second));
 const write=(p:typeof page,id:string)=>p.evaluate(async id=>{try{await (window as any).capturedNotes.replace([{id,kind:'text',title:id}]);return true;}catch{return false;}},id);
 const results=await Promise.all([write(page,'first'),write(second,'second')]);expect(results.filter(Boolean)).toHaveLength(1);
 const saved=await page.evaluate(async()=>JSON.parse((await (await import('/src/browser/notes-document.ts')).browserNotesDocument.read())!.raw).records);
 expect(saved).toHaveLength(1);expect(saved[0].id).toBe(results[0]?'first':'second');
 }finally{await second.close();}
});
