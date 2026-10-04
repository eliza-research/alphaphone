import {test,expect} from '@playwright/test';
test('powered-off browser hides workflow notifications and rejects their actions until unlock',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');
 const row=await page.evaluate(async()=>{const {publishWorkflowNotice}=await import('/src/browser/workflow-notices.ts');return publishWorkflowNotice('screen-off','Private workflow text',new AbortController().signal);});
 await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Power',exact:true}).click();await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Power',exact:true}).click();await expect(page.getByRole('button',{name:'Wake',exact:true})).toBeVisible();
 // A hidden earlier matching control must not mask the visible Wake control.
 await page.evaluate(()=>{const stale=document.createElement('button');stale.setAttribute('aria-label','Unlock with fingerprint');stale.hidden=true;document.body.prepend(stale);});
 const result=await page.evaluate(async row=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const notices=registerPlugin<any>('AlphaNotifications');const item=(await notices.list()).items.find((item:any)=>item.id===row.id);const errors=[];for(const method of ['open','dismiss']){try{await notices[method]({id:row.id,revision:row.revision,source:'own'});errors.push(false);}catch{errors.push(true);}}return {item,errors};},row);
 expect(result.item).toMatchObject({text:'',title:'Workflows',canOpen:false});expect(result.errors).toEqual([true,true]);
 await page.getByRole('button',{name:'Wake',exact:true}).click();await page.getByRole('button',{name:'Unlock with fingerprint',exact:true}).click();expect(await page.evaluate(async()=>{const {listWorkflowNotices}=await import('/src/browser/workflow-notices.ts');return (await listWorkflowNotices())[0].text;})).toBe('Private workflow text');
});
