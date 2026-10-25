import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
test('callback deployment binds both distributions to explicitly supplied signing certificates',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-auth-site-'));
 try {
  mkdirSync(join(dir,'deployment'),{recursive:true});cpSync('deployment/alpha-auth',join(dir,'deployment/alpha-auth'),{recursive:true});
  writeFileSync(join(dir,'app.config.json'),readFileSync('app.config.json'));
  const script=resolve('scripts/prepare-alpha-auth-site.mjs'),certificate=Array(32).fill('AB').join(':');
  assert.throws(()=>execFileSync(process.execPath,[script],{cwd:dir,stdio:'pipe'}));
  execFileSync(process.execPath,[script,certificate],{cwd:dir,stdio:'pipe'});
  const site=join(dir,'artifacts/alpha-auth-site');
  assert.match(readFileSync(join(site,'alphaphone/verify/verification.js'),'utf8'),/onVerificationReady/);
  const records=JSON.parse(readFileSync(join(site,'.well-known/assetlinks.json')));
  assert.deepEqual(records[0].target,{namespace:'android_app',package_name:'ai.elizaresearch.alphaphone',sha256_cert_fingerprints:[certificate]});
  const routes=readFileSync(join(site,'_redirects'),'utf8');assert.match(routes,/^\/alphaphone\/auth\/callback .* 200$/m);assert.match(routes,/^\/alphaphone\/auth\/staging\/callback .* 200$/m);
  assert.match(routes,/^\/alphaphone\/gmail\/callback .* 200$/m);assert.match(routes,/^\/alphaphone\/gmail\/staging\/callback .* 200$/m);
  const headers=readFileSync(join(site,'_headers'),'utf8');assert.match(headers,/Cache-Control: no-store, no-transform/);assert.match(headers,/Referrer-Policy: no-referrer/);assert.match(headers,/frame-ancestors 'none'/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
