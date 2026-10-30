/** Isolated source-alias integration check; never qualifies a production artifact. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=process.env.ELIZA_PHOTOS_UPSTREAM_SOURCE,expected=process.env.ELIZA_PHOTOS_UPSTREAM_COMMIT;
if(!source||!expected)throw Error('Set the reviewed ELIZA_PHOTOS_UPSTREAM_SOURCE and ELIZA_PHOTOS_UPSTREAM_COMMIT. This source-alias check is non-distributable.');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),expected);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).trim(),'','The upstream source checkpoint must be clean.');
const output=path.join(root,'test-results/shared-photos-consumer');await mkdir(output,{recursive:true});
const exports=['createBrowserPhotoLibrary','createBrowserPhotosHost','createBrowserMediaCopyJournal','createMediaCopyJournal','applyPhotoFilter','validateVideoEdit','drawEditedVideo','renderVideoEdit'];
const publicEntry=await readFile(path.join(source,'packages/app/src/renderer/browser-consumer.tsx'),'utf8');
for(const name of exports)assert.ok(publicEntry.includes(name),`Actual public source export missing: ${name}`);
const aliasEntry=path.join(output,'public-source-entry.ts');
await writeFile(aliasEntry,[
 `export {createBrowserPhotoLibrary} from '${source}/packages/ui/src/media/browser/photo-library.ts';`,
 `export {createBrowserPhotosHost} from '${source}/packages/ui/src/media/browser/photos-host.ts';`,
 `export {createBrowserMediaCopyJournal} from '${source}/packages/ui/src/media/browser/photo-documents.ts';`,
 `export {createMediaCopyJournal} from '${source}/packages/ui/src/media/media-copy-intent.ts';`,
 `export {applyPhotoFilter} from '${source}/packages/ui/src/media/browser/photo-filter.ts';`,
 `export {validateVideoEdit,drawEditedVideo,renderVideoEdit} from '${source}/packages/ui/src/media/browser/video-edit.ts';`,
].join('\n'));
const result=await build({absWorkingDir:root,stdin:{contents:`export {createAlphaPhotosHost} from './apps/app/src/product/photos-host.ts';export {browserPhotoLibrary,importBrowserPhoto} from './apps/app/src/product/browser-photo-library.ts';export {browserPhotoLibrary as captureLibrary} from './apps/app/src/prototype/browser-camera.ts';export * from './apps/app/src/runtime/media-copy-intent.ts';export {Capacitor} from '@capacitor/core';`,resolveDir:root,sourcefile:'alpha-photos-test.ts'},bundle:true,platform:'browser',format:'esm',write:false,metafile:true,define:{'import.meta.env.DEV':'false','import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':'"0"'},alias:{'@elizaos/plugin-files/browser/file-archive':path.join(source,'plugins/plugin-files/src/browser/file-archive.ts'),'@elizaos/plugin-assistant/device-photo-library-contract':path.join(source,'plugins/plugin-assistant/src/services/device-actions/photo-library-contract.ts')},plugins:[{name:'reviewed-photos-source',setup(builder){builder.onResolve({filter:/\.eliza\/browser-consumer\/index\.js$/},()=>({path:aliasEntry}));builder.onResolve({filter:/\.eliza\/client-features\/packages\/ui\/src\/platform\/browser-document-store$/},()=>({path:path.join(source,'packages/ui/src/platform/browser-document-store.ts')}));}}]});
const bytes=result.outputFiles[0].contents;
await writeFile(path.join(output,'source-metafile.json'),JSON.stringify(result.metafile,null,2)+'\n');
const inputs=[];
for(const input of Object.keys(result.metafile.inputs)){
 if(input==='alpha-photos-test.ts')continue;
 if(input.startsWith('(disabled):')){inputs.push({path:input,disabled:true,bytes:result.metafile.inputs[input].bytes});continue;}
 const filename=await realpath(path.resolve(root,input));
 inputs.push({path:filename,sha256:createHash('sha256').update(await readFile(filename)).digest('hex')});
}
inputs.sort((a,b)=>a.path.localeCompare(b.path));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bytes:'<!doctype html><title>Alpha Photos source integration</title>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const actual=await page.evaluate(async()=>{
  localStorage.setItem('alpha.photos.pending-copy.v1','older-operation');
  const api=await import('/bundle.js');
  const same=api.captureLibrary===api.browserPhotoLibrary;
  const canvas=document.createElement('canvas');canvas.width=6;canvas.height=4;const context=canvas.getContext('2d');context.fillStyle='blue';context.fillRect(0,0,6,4);const image=canvas.toDataURL('image/png');
  const row=await api.importBrowserPhoto({image,width:6,height:4},new AbortController().signal);
  const host=await api.createAlphaPhotosHost();const read=await host.media.read({id:row.id});
  const old=await api.readMediaCopyIntent();let blocked=false;try{await api.admitMediaCopyIntent('next-operation');}catch{blocked=true;}
  await api.acknowledgeMediaCopyIntent(old);const next=await api.admitMediaCopyIntent('next-operation');let stale=false;try{await api.acknowledgeMediaCopyIntent(old);}catch{stale=true;}
  const kept=(await host.journal.read()).token==='next-operation'&&localStorage.getItem('alpha.photos.pending-copy.v1')==='older-operation';await api.acknowledgeMediaCopyIntent(next);
  const native=[];api.Capacitor.isNativePlatform=()=>true;api.Capacitor.getPlatform=()=> 'android';api.Capacitor.isPluginAvailable=name=>name==='AlphaPhotos';
  const missingLibrary=await api.createAlphaPhotosHost()===undefined;
  api.Capacitor.isPluginAvailable=name=>['AlphaPhotos','AlphaPhotoLibrary'].includes(name);
  api.Capacitor.PluginHeaders=[{name:'AlphaPhotos',methods:[{name:'openLibrarySettings',rtype:'promise'}]},{name:'AlphaPhotoLibrary',methods:[{name:'scope',rtype:'promise'},{name:'requestAccess',rtype:'promise'}]}];
  api.Capacitor.nativePromise=async(plugin,method,options)=>{native.push({plugin,method,options});return {scope:'selected',images:true,videos:false,locked:false,version:'fixture'};};
  const nativeHost=await api.createAlphaPhotosHost();const scope=await nativeHost.access.scope();await nativeHost.access.requestAccess();await nativeHost.access.openSettings();
  const origin=location.origin;
  const playback=[nativeHost.permitsPlayback(`${origin}/_alpha_owned_video/11111111-1111-4111-8111-111111111111.mp4`),nativeHost.permitsPlayback(`${origin}/_eliza_owned_video/11111111-1111-4111-8111-111111111111.mp4`),nativeHost.permitsPlayback('https://elsewhere.invalid/_alpha_owned_video/a.mp4')];
  await host.dispose();return {same,source:host.source,readId:read.id,id:row.id,old,blocked,stale,kept,missingLibrary,native,scope,playback};
 });
 assert.equal(actual.same,true);assert.equal(actual.source,'app-owned');assert.equal(actual.readId,actual.id);assert.equal(actual.old.token,'older-operation');assert.ok(actual.blocked&&actual.stale&&actual.kept);
 assert.equal(actual.missingLibrary,true);assert.deepEqual(actual.native.map(x=>[x.plugin,x.method]),[['AlphaPhotoLibrary','scope'],['AlphaPhotoLibrary','requestAccess'],['AlphaPhotos','openLibrarySettings']]);assert.equal(actual.scope.scope,'selected');assert.deepEqual(actual.playback,[true,false,false]);
 const evidence={status:'passed',distributable:false,sourceAlias:true,alphaHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),alphaDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),upstream:expected,browser:browser.version(),bundleSha256:createHash('sha256').update(bytes).digest('hex'),inputs,checks:['Camera and Photos share one engine','installed browser namespace and pending copy CAS retained','missing native library refuses the host','actual Alpha native plugin/method mapping','Alpha same-origin playback prefix preserved'],actual};
 await writeFile(path.join(output,'source-integration.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
