import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
// AP-13 / #422: Wallet is outside the MVP in both distributions and on the Alpha AOSP image. Its
// views, deep links, native/payment adapters and agent actions stay unavailable; no payment, card
// or pass-wallet effect can be reached from a product build.
const root=resolve(import.meta.dirname,'..');
const read=name=>readFileSync(join(root,name),'utf8');
const dataModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');

/** The renderer feature gate exactly as shipped, for a standalone/launcher install or the verified image. */
async function features(image){
 const headers=image?[{name:'AlphaTelephony',methods:[{name:'imageCapability'}]}]:[];
 const aosp=stripTypeScriptTypes(read('apps/app/src/runtime/aosp-image.ts').replace("import { Capacitor } from '@capacitor/core';",`const Capacitor={getPlatform:()=>'android',PluginHeaders:${JSON.stringify(headers)}};`),{mode:'transform'});
 const source=stripTypeScriptTypes(read('apps/app/src/prototype/mvp-features.ts'),{mode:'transform'})
  .replace(/from ['"]\.\.\/browser\/dev-profile['"]/,`from '${dataModule('export const browserDevProfile=false;')}'`)
  .replace(/from ['"]\.\.\/runtime\/aosp-image['"]/,`from '${dataModule(aosp)}'`);
 assert.doesNotMatch(source,/from ['"]\.\.?\//,'every renderer dependency is substituted');
 return import(dataModule(source+`\n//${image}`));
}

test('Wallet has no view, deep link or quick command in the standalone, launcher and image renderers',async()=>{
 for(const image of [false,true]){
  const m=await features(image);
  assert.equal(m.isMvpView('wallet'),false,`wallet view (image=${image})`);
  assert.ok(m.DEFERRED_MVP_VIEWS.has('wallet'),'restored routes and deep links drop it');
  m.admitImageContacts(true);
  assert.equal(m.isMvpView('wallet'),false,'admitting an image adapter never admits Wallet');
  for(const prompt of ['open wallet','Open the wallet','show wallet','pay','pay Sam $20','launch wallet'])assert.equal(m.deferredMvpPrompt(prompt),true,prompt);
 }
 // The prototype payment handlers are inert even if a stale state names the view.
 const data=read('apps/app/src/prototype/data-adapter.ts');
 assert.match(data,/startAdd: \(\) => api\.toast\('Wallet is not connected\. No card details are collected\.'\)/);
 assert.match(data,/startPay: \(\) => api\.toast\('Wallet is not connected\. Nothing has been charged\.'\)/);
 assert.match(read('apps/app/src/prototype/native-adapter.ts'),/if \(module === 'wallet'\) \{/);
});

test('neither APK distribution declares a native Wallet, payment or NFC adapter',()=>{
 const sources=join(root,'android/app/src');
 const manifests=[],java=[];
 const visit=dir=>{for(const name of readdirSync(dir)){const file=join(dir,name);if(statSync(file).isDirectory()){if(name!=='build')visit(file);}else if(name==='AndroidManifest.xml')manifests.push(file);else if(/\.(java|kt)$/.test(name)&&!file.includes('/androidTest/')&&!file.includes('/test/'))java.push(file);}};
 visit(sources);
 // main, launcher and standalone flavors (and the test-mocks overlay) are all checked.
 for(const flavor of ['main','launcher','standalone'])assert.ok(manifests.some(file=>file.includes(`/src/${flavor}/`)),`${flavor} manifest present`);
 for(const file of manifests){
  const text=readFileSync(file,'utf8');
  assert.doesNotMatch(text,/android\.permission\.NFC|BIND_NFC_SERVICE|android\.nfc\.|cardemulation|HostApduService|com\.google\.android\.gms\.wallet|android\.permission\.BIND_QUICK_ACCESS_WALLET_SERVICE|QuickAccessWalletService/,file);
 }
 for(const file of java){
  const text=readFileSync(file,'utf8');
  assert.doesNotMatch(text,/HostApduService|android\.nfc\.|PaymentsClient|com\.google\.android\.gms\.wallet|QuickAccessWallet|@CapacitorPlugin\(name="[^"]*(?:Wallet|Payment|Pay)"/,file);
 }
 // MainActivity registers no Wallet or payment bridge in any variant.
 const main=read('android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java');
 for(const match of main.matchAll(/registerPlugin\(([^)]*)\)/g))assert.doesNotMatch(match[1],/wallet|payment|pay\b|nfc/i);
});

test('the resident agent profile used by Alpha loads no Wallet actions in either distribution',async()=>{
 // Product view launch policy and development proposals name no Wallet view.
 const views=JSON.parse(read('config/native-view-declarations.json'));
 assert.ok(Array.isArray(views)&&views.length>0);
 for(const view of views)assert.doesNotMatch(`${view.id} ${view.path} ${view.fallbackFor}`,/wallet|payment/i);
 assert.doesNotMatch(read('apps/app/src/runtime/development-view-contract.ts').split('export const DEVELOPMENT_PROPOSAL_VIEWS')[1],/'wallet'/);
 // The pinned upstream resident restricts every Android runtime (stock APK and the AOSP image
 // variant) to these lists, so @elizaos/plugin-wallet and its transfer/swap actions never load.
 const file=join(root,'vendor/eliza/packages/agent/src/runtime/core-plugins.ts');
 assert.ok(existsSync(file),'pinned upstream plugin policy');
 const policy=await import(dataModule(stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'})));
 const lists=['MOBILE_CORE_PLUGINS','MOBILE_VIEW_PLUGINS','MOBILE_MODEL_PROVIDER_PLUGINS','ELIZAOS_ANDROID_CORE_PLUGINS','ELIZAOS_ANDROID_TERMINAL_PLUGINS'];
 for(const name of lists){
  assert.ok(Array.isArray(policy[name])&&policy[name].length>0,name);
  for(const plugin of policy[name])assert.doesNotMatch(plugin,/wallet|payment|solana|evm/i,`${name} admits ${plugin}`);
 }
});
