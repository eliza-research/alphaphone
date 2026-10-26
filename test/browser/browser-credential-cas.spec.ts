import {test,expect} from '@playwright/test';

test('encrypted credential CAS fences concurrent renderer instances even without Web Locks',async({page})=>{
 await page.goto('/?mode=offline');
 const result=await page.evaluate(async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
  const {indexedDbSecretBackend}=await import('/src/runtime/native-connection.ts');
  const slot='remote:https://cas.example.invalid';
  let arrivals=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const subtle={generateKey:crypto.subtle.generateKey.bind(crypto.subtle),decrypt:crypto.subtle.decrypt.bind(crypto.subtle),encrypt:async(...args:any[])=>{if(++arrivals===2)release();await gate;return (crypto.subtle.encrypt as any)(...args);}} as SubtleCrypto;
  const first=indexedDbSecretBackend(indexedDB,subtle),second=indexedDbSecretBackend(indexedDB,subtle);
  const outcomes=await Promise.all([first.compareExchange(slot,null,'first'),second.compareExchange(slot,null,'second')]);
  return {outcomes,value:await first.read(slot)};
 });
 expect(result.outcomes.filter(Boolean)).toHaveLength(1);
 expect(result.value).toBe(result.outcomes[0]?'first':'second');
});

test('browser transport admits only canonical automation writes and rejects host-only credentials',async({page})=>{
 await page.goto('/?mode=offline');
 const result=await page.evaluate(async()=>{
  const {createBrowserConnection}=await import('/src/runtime/native-connection.ts');
  const calls:string[]=[];
  const port=createBrowserConnection({fetch:async(url,init)=>{calls.push(init!.method+' '+url);return new Response('{}',{status:200});}});
  const request=(path:string,method:string,extra={})=>port.request({requestId:crypto.randomUUID(),url:'https://agent.example.invalid'+path,method,headers:{},...extra});
  await request('/api/triggers/owned-id','PUT');await request('/api/triggers/owned-id','DELETE');
  const rejected=[];
  for(const [path,method,extra] of [['/api/admin','DELETE',{}],['/api/triggers/owned-id','PATCH',{}],['/api/automations','GET',{credentialReference:'host-secret'}]] as const){try{await request(path,method,extra);rejected.push(false);}catch{rejected.push(true);}}
  return {calls,rejected};
 });
 expect(result.calls).toHaveLength(2);expect(result.rejected).toEqual([true,true,true]);
});

test('Android cloud cleanup retains the native credential restriction instead of claiming browser CAS support',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.androidBridge={};const fixture=w.nativeCloudCleanup={credential:null,calls:[]};
  w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:['secureRead','secureWrite','secureRemove','secureCompareExchange','addListener','removeListener'].map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))}],nativeCallback:()=> 'native-cleanup-fixture-listener',nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin!=='AlphaConnection')throw Error('Unimplemented fixture plugin');fixture.calls.push({method,slot:input?.slot});
   if(method==='secureRead')return {value:input?.slot==='cloud:production'&&fixture.credential!==null?JSON.stringify(fixture.credential):null};
   if(method==='removeListener')return {};
   if(method==='secureRemove'){fixture.credential=null;return {};}
   if(method==='secureCompareExchange')throw Error('Native credential CAS is not allowed');
   throw Error('Unimplemented fixture method');
  }};
 });
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {cloudCredentialStore,cloudSelfRevocationSupported}=await import('/src/runtime/native-connection.ts'),f=(window as any).nativeCloudCleanup;
  f.credential={credentialId:crypto.randomUUID(),token:'synthetic-native-cloud-key'};const before=f.calls.length;
  const conditional=typeof cloudCredentialStore.clearIfCurrent;await cloudCredentialStore.clear('production');
  return {conditional,supported:cloudSelfRevocationSupported,calls:f.calls.slice(before),credential:f.credential};
 });
 expect(result.conditional).toBe('undefined');expect(result.supported).toBe(true);expect(result.calls).toEqual([{method:'secureRemove',slot:'cloud:production'}]);expect(result.credential).toBeNull();
});

test('deployment-scoped Cloud secrets survive reload without adopting or deleting another deployment',async({page})=>{
 await page.goto('/?mode=offline');
 await page.evaluate(async()=>{
  const {indexedDbSecretBackend,createBrowserConnection}=await import('/src/runtime/native-connection.ts');
  const {cloudStorageSlot}=await import('/src/runtime/cloud-deployment.generated.ts');
  const raw=indexedDbSecretBackend();
  await raw.compareExchange('cloud:production',undefined,'legacy-synthetic-secret');
  await raw.compareExchange('cloud-deployment:other:cloud:production',undefined,'other-synthetic-secret');
  const port=createBrowserConnection();
  if((await port.secureRead({slot:'cloud:production'})).value!==null)throw Error('Adopted an unrelated credential');
  await port.secureWrite({slot:'cloud:production',value:'current-synthetic-secret'});
  if(await raw.read(cloudStorageSlot('cloud:production'))!=='current-synthetic-secret')throw Error('Credential was not scoped');
 });
 await page.reload();
 const result=await page.evaluate(async()=>{
  const {indexedDbSecretBackend,createBrowserConnection}=await import('/src/runtime/native-connection.ts');
  const {cloudStorageSlot}=await import('/src/runtime/cloud-deployment.generated.ts');
  const raw=indexedDbSecretBackend(),port=createBrowserConnection();
  const resumed=(await port.secureRead({slot:'cloud:production'})).value;
  await port.secureRemove({slot:'cloud:production'});
  return {resumed,current:await raw.read(cloudStorageSlot('cloud:production')),legacy:await raw.read('cloud:production'),other:await raw.read('cloud-deployment:other:cloud:production')};
 });
 expect(result).toEqual({resumed:'current-synthetic-secret',current:null,legacy:'legacy-synthetic-secret',other:'other-synthetic-secret'});
});
