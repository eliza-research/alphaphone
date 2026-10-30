/** Explicit non-distributable source integration check. The normal test lane requires a real staged artifact. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=process.env.ELIZA_FILES_UPSTREAM_SOURCE,expected=process.env.ELIZA_FILES_UPSTREAM_COMMIT;
if(!source||!expected)throw Error('Set ELIZA_FILES_UPSTREAM_SOURCE and ELIZA_FILES_UPSTREAM_COMMIT for this non-distributable source check.');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),expected);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).trim(),'','Upstream source must be a clean checkpoint');
const require=createRequire(path.join(source,'package.json'));
const {build}=require('esbuild'),{chromium}=require('playwright');
const cap=require.resolve('@capacitor/core');
const output=path.join(root,'test-results/shared-files-consumer');await mkdir(output,{recursive:true});
const aliasEntry=path.join(output,'files-source-entry.ts');
await writeFile(aliasEntry,`export {createBrowserFiles} from '${source}/plugins/plugin-files/src/browser/files.ts';export * from '${source}/plugins/plugin-files/src/workspace/recent.ts';`);
const bundle=await build({absWorkingDir:root,stdin:{contents:`export {createAlphaFilesHost} from './apps/app/src/product/files-host.ts';export {filesIndex,createFilesIndex,filesIndexKey,filesOpenKey} from './apps/app/src/prototype/files-index.ts';export {registerPlugin} from './apps/app/src/platform-plugins.ts';export {Capacitor} from '@capacitor/core';export {createBrowserFiles} from './apps/app/src/product/files-upstream.ts';export {createFilesWorkspace} from '${source}/plugins/plugin-files/src/workspace/controller.ts';`,resolveDir:root,sourcefile:'alpha-files-test.ts'},bundle:true,platform:'browser',format:'esm',write:false,metafile:true,external:['pdfjs-dist'],alias:{'@capacitor/core':cap},plugins:[{name:'reviewed-files-source',setup(builder){builder.onResolve({filter:/\.eliza\/browser-consumer\/index\.js$/},()=>({path:aliasEntry}));}}]});
const bytes=bundle.outputFiles[0].contents;
const server=createServer((req,res)=>{if(!['/','/bundle.js'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bytes:'<!doctype html><title>Alpha Files source integration</title>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const actual=await page.evaluate(async()=>{
  const api=await import('/bundle.js');
  const Files=api.createBrowserFiles({databaseName:'alpha.browser.files.v1',archiveName:'Alpha files.zip',pdfWorkerUrl:'/unused',pdfAssetsBase:'/unused/',openSelectedDocumentViewer:()=>()=>{},runFilePicker:async(choose,cancelled)=>{try{return await choose(new AbortController().signal);}catch(error){if(error.name==='AbortError')return cancelled;throw error;}},inputFiles:async()=>[new File(['same installed bytes'],'legacy.txt',{type:'text/plain'})]});
  const files=new Files();api.registerPlugin('AlphaFiles',{web:()=>files});const host=api.createAlphaFilesHost();const workspace=api.createFilesWorkspace(host);workspace.activate();await workspace.choose();await workspace.preview();
  const same=host.recent===api.filesIndex,text=workspace.getSnapshot().selected.text,rows=(await files.list({})).entries;
  const key=localStorage.getItem(api.filesIndexKey),open=localStorage.getItem(api.filesOpenKey);workspace.deactivate();
  return {same,text,rows:rows.length,key,open,optional:[host.ask,host.email,host.scan].every(value=>value===undefined)};
 });
 const nativePage=await browser.newPage();await nativePage.goto(`http://127.0.0.1:${server.address().port}`);
 const nativeActual=await nativePage.evaluate(async()=>{
  window.androidBridge={};
  const api=await import('/bundle.js');
  const missing=api.createAlphaFilesHost()===undefined;
  const names=['choose','chooseFile','cancelPicker','list','createFolder','rename','delete','move','changeMany','shareMany','select','forget','describeSelected','readSelected','pdfSelected','renameSelected','openSelected','shareSelected','forgetSelected'];
  api.Capacitor.PluginHeaders=[{name:'AlphaFiles',methods:names.map(name=>({name,rtype:'promise'}))}];
  const calls=[];api.Capacitor.nativePromise=async(plugin,method,options)=>{calls.push({plugin,method,options});return {cancelled:true};};
  const native=api.createAlphaFilesHost();await native.tree.cancelPicker({requestId:'11111111-1111-4111-8111-111111111111'});
  return {missing,calls,preview:[native.previewUrl('file:///data/user/0/alpha/cache/document-11111111-1111-4111-8111-111111111111.png')!==undefined,native.previewUrl('file:///data/user/0/alpha/cache/unowned.png')===undefined]};
 });Object.assign(actual,nativeActual);
 assert.equal(actual.same,true);assert.equal(actual.text,'same installed bytes');assert.equal(actual.rows,1);assert.ok(actual.key.includes('legacy.txt'));assert.ok(actual.open);assert.equal(actual.missing,true);assert.deepEqual(actual.calls,[{plugin:'AlphaFiles',method:'cancelPicker',options:{requestId:'11111111-1111-4111-8111-111111111111'}}]);assert.deepEqual(actual.preview,[true,true]);assert.equal(actual.optional,true);
 const inputs=[];for(const input of Object.keys(bundle.metafile.inputs)){if(input==='alpha-files-test.ts')continue;const filename=await realpath(path.resolve(root,input));inputs.push({path:filename,sha256:createHash('sha256').update(await readFile(filename)).digest('hex')});}
 const receipt={status:'passed',distributable:false,sourceAlias:true,upstream:expected,alphaHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),alphaDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),browser:browser.version(),bundleSha256:createHash('sha256').update(bytes).digest('hex'),inputs,actual};await writeFile(path.join(output,'source-integration.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,distributable:false,actual}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
