import {test,expect,type Page} from '@playwright/test';
// Renderer contract only. The synthetic bridge does not qualify Android permissions or MediaStore.
async function photosBridge(page:Page,scope='full'){
 await page.addInitScript(scope=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const w=window as any;w.androidBridge={};const calls:any[]=[];const listeners:Record<string,()=>void>={};
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const row={id:'m:external_primary:i:91',name:'Synthetic beach.jpg',kind:'image',image,width:100,height:80,date:Date.now(),revision:'provider:1:100:2:1:2',mutationRevision:'provider:1:100:2:1:2',favorite:true,owned:false};
  const state=w.mediaFixture={scope,calls,emit:()=>listeners['AlphaPhotos:libraryChanged']?.(),row};
  const access=()=>({scope:state.scope,images:state.scope==='partial'?'full':state.scope,videos:state.scope==='partial'?'denied':state.scope});
  const plugins:Record<string,string[]>={AlphaPhotos:['libraryAccess','requestLibraryAccess','openLibrarySettings','listPermitted','list','summary','albums','read'],DeviceApps:['buildInfo','launchInfo','localeInfo','list','resolveDefault'],DailyApps:['surfaceInfo'],AlphaNotifications:['status','list'],AlphaVoiceCloud:['checkPermissions']};
  w.Capacitor={Plugins:{},PluginHeaders:Object.entries(plugins).map(([name,methods])=>({name,methods:[...methods,'addListener','removeListener'].map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),
   nativeCallback:(plugin:string,method:string,input:any,callback:()=>void)=>{if(method==='addListener')listeners[plugin+':'+input.eventName]=callback;return plugin+':'+input.eventName;},
   nativePromise:async(plugin:string,method:string,input:any)=>{
    calls.push({plugin,method,input});
    if(plugin==='AlphaPhotos'){
     if(method==='libraryAccess')return access();
     if(method==='requestLibraryAccess'){state.scope='full';return access();}
     if(method==='listPermitted')return {items:state.scope==='denied'||input?.query&&!row.name.toLowerCase().includes(input.query.toLowerCase())?[]:[row],next:'',access:access()};
     if(method==='list')return {items:state.scope==='denied'||input?.trashed?[]:[row],next:''};
     if(method==='summary')return {favorites:state.scope==='denied'?0:1,videos:0,trash:0,canFavorite:true};
     if(method==='albums')return {items:[]};if(method==='read')return row;
    }
    if(plugin==='DeviceApps')return method==='buildInfo'?{launcher:false}:method==='localeInfo'?{locale:'en-US',hour24:false}:method==='list'?{apps:[]}:{available:false};
    if(plugin==='DailyApps')return {assistant:false,developmentBuild:true,topInset:0,bottomInset:0};
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='AlphaNotifications')return method==='status'?{permissionGranted:true,appEnabled:true}:{items:[]};
    return {};
   }};
 },scope);
 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).click();
}
test('permitted library requests no permission automatically and searches through the provider',async({page})=>{
 await photosBridge(page);await expect(page.getByText('All permitted photos and videos',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(0);
 await page.getByRole('button',{name:'Search photos',exact:true}).click();await page.getByRole('textbox',{name:'Search photos'}).fill('unmatched');
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.calls.some((c:any)=>c.method==='listPermitted'&&c.input.query==='unmatched'))).toBe(true);
});
test('selected access is explicit and only the choice control requests more access',async({page})=>{
 await photosBridge(page,'selected');await expect(page.getByText('Selected photos and videos',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Choose photo access',exact:true}).click();await expect(page.getByText('All permitted photos and videos',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(1);
});
test('revocation clears already rendered Favorites and returns to the owned-only scope',async({page})=>{
 await photosBridge(page);await page.getByRole('button',{name:'Albums',exact:true}).click();await page.getByRole('button',{name:'Favorites',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.scope='denied';f.emit();});
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(0);
});
