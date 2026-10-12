import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{
  const {BrowserFiles}=await import('/src/browser/files.ts');
  const entry=(id:string,directory=false)=>({id,parentId:'root',name:id,mimeType:directory?'vnd.android.document/directory':'text/plain',directory,size:1,revision:'revision-'+id,canCreate:directory,canRename:true,canDelete:true,canMove:true});
  const state=(window as any).__paging={calls:[],moves:[],revoked:false};
  (BrowserFiles.prototype as any).list=async function(input:any={}){
   state.calls.push(input);
   if(state.revoked)return {status:'revoked',message:'Folder access ended'};
   const id=input.id||'root';
   if(id==='Destination')return {status:'ready',message:'Ready',folder:entry(id,true),entries:[]};
   const page=Number(input.cursor||0);
   return {status:'ready',message:'More entries available',folder:entry('root',true),entries:page===0?[entry('first.txt')]:page===1?[entry('middle.txt')]:[entry('last.txt'),entry('Destination',true)],cursor:page<2?String(page+1):undefined};
  };
  (BrowserFiles.prototype as any).changeMany=async function(input:any){state.moves.push(input);return {status:'moved',message:'Moved fixture files'};};
 });
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByText('App files',{exact:true}).first().click();
});
test('selection retains exact revisions while appending three provider pages',async({page})=>{
 await page.getByRole('button',{name:'Select files',exact:true}).click();
 await page.getByRole('button',{name:'Select first.txt',exact:true}).click();
 for(const name of ['middle.txt','last.txt']){
  await page.getByRole('button',{name:'Load more entries',exact:true}).click();
  await page.getByRole('button',{name:'Select '+name,exact:true}).click();
  await expect(page.getByRole('button',{name:'Deselect first.txt',exact:true})).toBeVisible();
 }
 await page.getByRole('button',{name:'Move selected',exact:true}).click();
 await page.getByRole('button',{name:'Move into Destination',exact:true}).click();
 await page.getByRole('button',{name:'Move here',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__paging.moves)).toEqual([{action:'move',destinationId:'Destination',confirmPermanent:false,items:['first.txt','middle.txt','last.txt'].map(id=>({id,expectedRevision:'revision-'+id}))}]);
});
test('move picker can reach a destination beyond two pages of files',async({page})=>{
 await page.getByRole('button',{name:'Select files',exact:true}).click();
 await page.getByRole('button',{name:'Select first.txt',exact:true}).click();
 await page.getByRole('button',{name:'Move selected',exact:true}).click();
 for(let i=0;i<2;i++)await page.getByRole('button',{name:'Load more destination folders',exact:true}).click();
 await page.getByRole('button',{name:'Move into Destination',exact:true}).click();
 await page.getByRole('button',{name:'Move here',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__paging.moves[0].destinationId)).toBe('Destination');
});
test('revoked destination paging closes the dialog without submitting a move',async({page})=>{
 await page.getByRole('button',{name:'Select files',exact:true}).click();
 await page.getByRole('button',{name:'Select first.txt',exact:true}).click();
 await page.getByRole('button',{name:'Move selected',exact:true}).click();
 await page.evaluate(()=>(window as any).__paging.revoked=true);
 await page.getByRole('button',{name:'Load more destination folders',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Move file',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__paging.moves)).toEqual([]);
});
