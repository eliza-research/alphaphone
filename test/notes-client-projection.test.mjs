// The stock plugin-notes client is carried, not rewritten: the projection changes only its dashboard
// transport import, and any reviewed input that changes upstream stops the prepare step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareClientFeatures} from '../scripts/prepare-client-features.mjs';

const upstream=name=>fs.readFileSync(path.join('vendor/eliza',name),'utf8');
test('projected stock notes client differs from upstream only in its transport import',()=>{
 const source=prepareClientFeatures(),stamp=JSON.parse(fs.readFileSync(path.join(source,'.source.json')));
 for(const name of ['plugins/plugin-notes/src/types.ts','plugins/plugin-notes/src/capabilities.ts']){assert.equal(fs.readFileSync(path.join(source,name),'utf8'),upstream(name));assert.equal(stamp.files[name],stamp.sourceFiles[name]);}
 const name='plugins/plugin-notes/src/components/notesData.ts',original=upstream(name).split('\n'),projected=fs.readFileSync(path.join(source,name),'utf8').split('\n');
 assert.equal(projected.length,original.length);
 assert.deepEqual(projected.flatMap((line,index)=>line===original[index]?[]:[[original[index],line]]),[['import { ApiError, client, fetchWithCsrf } from "@elizaos/ui";','import { ApiError, client, fetchWithCsrf } from "../../../../../../apps/app/src/runtime/notes-transport";']]);
 assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(source,name)),'../../../../../../apps/app/src/runtime/notes-transport.ts')),'the projected import resolves to Alpha transport');
 // Only the type declarations the capabilities import are carried from core.
 assert.match(fs.readFileSync(path.join(source,'alpha-voice-core-types.ts'),'utf8'),/export interface ViewCapabilityParameter[\s\S]*export interface ViewCapability \{/);
 assert.equal(fs.existsSync(path.join(source,'packages/core/src/types/plugin.ts')),false);
 for(const excluded of ['NotesView.tsx','useNotesState.ts'])assert.equal(fs.existsSync(path.join(source,'plugins/plugin-notes/src/components',excluded)),false);
});

test('a changed reviewed notes input stops the prepare step before the cache is replaced',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-notes-projection-')),script=fs.readFileSync('scripts/prepare-client-features.mjs','utf8'),copy=path.join(root,'scripts/prepare-client-features.mjs');
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'vendor'));
  fs.symlinkSync(path.resolve('vendor/eliza'),path.join(root,'vendor/eliza'));fs.copyFileSync('upstream.lock.json',path.join(root,'upstream.lock.json'));
  fs.copyFileSync('scripts/upstream-native-source.mjs',path.join(root,'scripts/upstream-native-source.mjs'));
  for(const name of ['plugins/plugin-notes/src/components/notesData.ts','plugins/plugin-notes/src/types.ts','plugins/plugin-notes/src/capabilities.ts','packages/core/src/types/plugin.ts']){
   const pin=script.match(new RegExp(`'${name.replaceAll('.','\\.')}':'[0-9a-f]{64}'`));assert.ok(pin,name+' is pinned');
   fs.writeFileSync(copy,script.replace(pin[0],`'${name}':'${'0'.repeat(64)}'`));
   const {prepareClientFeatures:prepare}=await import(copy+'?'+encodeURIComponent(name));
   assert.throws(()=>prepare({root}),new RegExp('Review changed projection input: '+name.replaceAll('.','\\.')));
   assert.equal(fs.existsSync(path.join(root,'.eliza/client-features')),false);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
