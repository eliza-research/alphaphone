import {test,expect} from '@playwright/test';
const endpoint='**/__alpha-browser-cloud';
test('empty optional DEV Cloud credential leaves Home usable without choosing or signing in',async({page})=>{
 const calls:string[]=[];await page.route(endpoint,async route=>{const data=route.request().postDataJSON();calls.push(data.operation);expect(data.operation).toBe('secureRead');await route.fulfill({json:{value:null}});});
 await page.goto('/?tools=1');
 const snapshot=await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');await connectionController.initialize();const s=connectionController.getSnapshot();return {open:s.open,busy:s.busy,account:!!s.cloudAccount};});
 expect(snapshot).toEqual({open:false,busy:false,account:false});await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();expect(calls).toEqual(['secureRead']);
});
test('injected native AlphaConnection owns its methods and cannot fall through to the DEV Cloud store',async({page})=>{
 const bridge:string[]=[];await page.route(endpoint,async route=>{bridge.push(route.request().postDataJSON().operation);await route.abort();});
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));const w=window as any;w.nativeStoreReads=0;w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:[{name:'secureRead',rtype:'promise'}]}],nativePromise:async(_p:string,method:string)=>{if(method!=='secureRead')throw Error('Unsupported native method');w.nativeStoreReads++;return {value:null};}};});
 await page.goto('/');
 const result=await page.evaluate(async()=>{const {cloudCredentialStore,secureConnectionStore}=await import('/src/runtime/native-connection.ts');await cloudCredentialStore.read('production');let rejected=false;try{await secureConnectionStore.write('cloud:production',{credentialReference:'synthetic-reference'});}catch{rejected=true;}return {references:cloudCredentialStore.acceptsReferences,rejected,reads:(window as any).nativeStoreReads};});
 expect(result).toEqual({references:false,rejected:true,reads:1});expect(bridge).toEqual([]);
});
test('choosing offline while optional credential discovery is held cannot restore the late account',async({page})=>{
 let release!:()=>void,entered=false;const operations:string[]=[];
 await page.route(endpoint,async route=>{const data=route.request().postDataJSON();operations.push(data.operation);expect(data.operation).toBe('secureRead');entered=true;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{value:JSON.stringify({credentialReference:'browser-cloud-reference:11111111-1111-4111-8111-111111111111',credentialId:'22222222-2222-4222-8222-222222222222'})}});});
 await page.goto('/');await expect.poll(()=>entered).toBe(true);
 await page.evaluate(async()=>{await (await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});release();
 const snapshot=await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;await c.initialize();return {open:c.getSnapshot().open,account:!!c.getSnapshot().cloudAccount,choice:JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')};});
 expect(snapshot).toEqual({open:false,account:false,choice:{kind:'offline'}});expect(operations).toEqual(['secureRead']);
});
test('a changed credential during optional restore cannot verify or publish the old account',async({page})=>{
 const operations:string[]=[];let reads=0;
 // The refused restore opens Alpha's sign-in entry (7a44d7038), whose readiness probe may ask the
 // bridge for sign-in service info and status, and closing it cancels that attempt. Those carry no credential; nothing else may run.
 const readiness=['signInServiceInfo','signInStatus','signInCancel'];
 await page.route(endpoint,async route=>{const data=route.request().postDataJSON();operations.push(data.operation);if(readiness.includes(data.operation)){await route.abort();return;}expect(data.operation).toBe('secureRead');const suffix=++reads===1?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222';await route.fulfill({json:{value:JSON.stringify({credentialReference:'browser-cloud-reference:'+suffix,credentialId:suffix})}});});
 await page.goto('/');const snapshot=await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;await c.initialize();return {account:!!c.getSnapshot().cloudAccount,error:c.getSnapshot().error};});
 expect(snapshot.account).toBe(false);expect(snapshot.error).toContain('Cloud account changed');expect(operations.filter(operation=>!readiness.includes(operation))).toEqual(['secureRead','secureRead']);expect(reads).toBe(2);
});
