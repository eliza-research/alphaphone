import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
test('backend error-return patch applies to pinned source and preserves bound errors',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-auth-patch-'));
 const path='packages/auth/src/server/api/src/routes';
 try {
  mkdirSync(join(dir,path),{recursive:true});
  writeFileSync(join(dir,path,'auth.ts'),readFileSync('vendor/eliza/'+path+'/auth.ts'));
  execFileSync('git',['apply','--unsafe-paths','-'],{cwd:dir,input:readFileSync('patches/eliza/alpha-auth-error-return.patch')});
  const {buildOAuthAppErrorReturn:rawBuild}=await import(pathToFileURL(join(dir,path,'oauth-app-error-return.ts')).href);
  const build=(url,state,code)=>rawBuild(url,state,code,url);
  assert.equal(rawBuild('https://other.example/callback','state','access_denied','https://alphacompute.ai/callback'),null);
  const result=new URL(build('https://alphacompute.ai/alphaphone/auth/callback?old=discard#token=discard','s'.repeat(43),'oauth_authorization_failed'));
  assert.equal(result.search,'');assert.equal(result.hash,'#error=oauth_authorization_failed&state='+ 's'.repeat(43));
  for(const url of ['javascript:alert(1)','https://user:password@alphacompute.ai/callback','invalid'])assert.equal(build(url,'state','access_denied'),null);
  assert.equal(build('https://alphacompute.ai/callback','','access_denied'),null);
  assert.equal(build('https://alphacompute.ai/callback','state','<provider text>'),null);
  const route=readFileSync(join(dir,path,'auth.ts'),'utf8');assert.match(route,/if \(options.redirectUrl && options.appState\)/);assert.match(route,/if \(target\) return c.redirect\(target, 302\)/);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
