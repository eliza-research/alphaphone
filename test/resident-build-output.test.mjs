import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const upstream=new URL('../vendor/eliza/',import.meta.url);

test('resident knowledge declarations exclude stories that import UI source',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-knowledge-emit-'));
 try {
  const plugin=path.join(root,'plugins/plugin-knowledge');
  const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  const config=JSON.parse(fs.readFileSync(new URL('plugins/plugin-knowledge/tsconfig.build.json',upstream),'utf8'));
  // Use the pinned build's actual include/exclude rules with a minimal source graph.
  const shared=JSON.parse(fs.readFileSync(new URL('plugins/tsconfig.build.shared.json',upstream),'utf8'));
  write(path.join(root,'plugins/tsconfig.build.shared.json'),JSON.stringify(shared));
  config.compilerOptions.types=[];
  write(path.join(plugin,'tsconfig.build.json'),JSON.stringify(config));
  write(path.join(plugin,'src/index.ts'),'export const production = 1;');
  const ui=path.join(root,'packages/ui/src/api/auth/csrf-cookie.ts');
  write(ui,'export const csrf = 1;');
  for(const extension of ['ts','tsx'])write(path.join(plugin,`src/preview.stories.${extension}`),'export {csrf} from "../../../packages/ui/src/api/auth/csrf-cookie";');
  execFileSync(process.execPath,[path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc'),'--noCheck','-p',path.join(plugin,'tsconfig.build.json')],{stdio:'pipe'});
  assert.ok(fs.existsSync(path.join(plugin,'dist/index.d.ts')),'production declarations must still emit');
  assert.deepEqual(fs.readdirSync(path.dirname(ui)),['csrf-cookie.ts'],'build must not emit into authenticated UI source');
  assert.deepEqual(fs.readdirSync(path.join(plugin,'dist')).sort(),['index.d.ts','index.d.ts.map']);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
