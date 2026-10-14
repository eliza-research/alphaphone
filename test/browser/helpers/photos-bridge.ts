import {type Page} from '@playwright/test';
// Renderer contract only. The synthetic bridge does not qualify Android permissions or MediaStore.
export async function photosBridge(page:Page,scope='full',openPhotos=true){
 await page.addInitScript(scope=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const w=window as any;w.androidBridge={};const calls:any[]=[];const listeners:Record<string,()=>void>={};
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const row={id:'m:external_primary:i:91',name:'Synthetic beach.jpg',kind:'image',image,width:100,height:80,date:Date.now(),revision:'provider:1:100:2:1:2',mutationRevision:'provider:1:100:2:1:2',favorite:true,owned:false};
  const state=w.mediaFixture={scope,calls,emit:()=>listeners['AlphaPhotos:libraryChanged']?.(),row};
  const access=()=>({scope:state.scope,images:state.scope==='partial'?'full':state.scope,videos:state.scope==='partial'?'denied':state.scope});
  const plugins:Record<string,string[]>={AlphaMailAttachments:['readPhotoSelected','cancelPhotoSelected'],AlphaPhotos:['libraryAccess','requestLibraryAccess','openLibrarySettings','listPermitted','list','summary','albums','read'],DeviceApps:['buildInfo','launchInfo','localeInfo','list','resolveDefault'],DailyApps:['surfaceInfo'],AlphaNotifications:['status','list'],AlphaVoiceCloud:['checkPermissions']};
  w.Capacitor={Plugins:{},PluginHeaders:Object.entries(plugins).map(([name,methods])=>({name,methods:[...methods,'addListener','removeListener'].map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),
   nativeCallback:(plugin:string,method:string,input:any,callback:()=>void)=>{if(method==='addListener')listeners[plugin+':'+input.eventName]=callback;return plugin+':'+input.eventName;},
   nativePromise:async(plugin:string,method:string,input:any)=>{
    calls.push({plugin,method,input});
    if(plugin==='AlphaMailAttachments'){
     if(method==='cancelPhotoSelected')return {};
     if(state.scope==='denied'||input.revision!==row.mutationRevision)throw Error('Photo unavailable');
     const source='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=';
     const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
     return {name:'source.png',mimeType:'image/png',size:bytes.length,sha256:hash,dataBase64:source};
    }
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
 await page.goto('/');if(openPhotos)await page.getByRole('button',{name:'Photos',exact:true}).click();
}
