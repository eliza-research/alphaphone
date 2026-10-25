import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const fingerprints=process.argv.slice(2);
if(!fingerprints.length || fingerprints.some(value=>!/^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(value)))throw Error('Supply the public SHA-256 signing-certificate fingerprint(s), colon separated. Never pass a signing key.');
const root=resolve('artifacts/alpha-auth-site');
mkdirSync(join(root,'.well-known'),{recursive:true});mkdirSync(join(root,'alphaphone/auth'),{recursive:true});
for(const name of ['callback.html','callback.js','callback.css'])copyFileSync('deployment/alpha-auth/'+name,join(root,'alphaphone/auth',name));
mkdirSync(join(root,'alphaphone/verify'),{recursive:true});
for(const name of ['index.html','verification.js','verification.css'])copyFileSync('deployment/alpha-auth/verification/'+name,join(root,'alphaphone/verify',name));
const {appId}=JSON.parse(readFileSync('app.config.json','utf8'));
writeFileSync(join(root,'.well-known/assetlinks.json'),JSON.stringify([{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:appId,sha256_cert_fingerprints:[...new Set(fingerprints.map(v=>v.toUpperCase()))]}}],null,2)+'\n');
writeFileSync(join(root,'_redirects'),'/alphaphone/auth/callback /alphaphone/auth/callback.html 200\n/alphaphone/auth/staging/callback /alphaphone/auth/callback.html 200\n/alphaphone/gmail/callback /alphaphone/auth/callback.html 200\n/alphaphone/gmail/staging/callback /alphaphone/auth/callback.html 200\n');
writeFileSync(join(root,'_headers'),'/alphaphone/auth/*\n  Cache-Control: no-store, no-transform\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src \'none\'; script-src \'self\'; style-src \'self\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'\n/.well-known/assetlinks.json\n  Content-Type: application/json\n');
console.log('Prepared Alpha callback site at '+root+'. Not deployed.');

const headerFile=join(root,'_headers'), callbackHeaders=readFileSync(headerFile,'utf8').split('/.well-known/assetlinks.json')[0];
writeFileSync(headerFile,readFileSync(headerFile,'utf8')+callbackHeaders.replace('/alphaphone/auth/*','/alphaphone/gmail/*')+'/alphaphone/verify/*\n  Cache-Control: no-store, no-transform\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: '+readFileSync('deployment/alpha-auth/verification/csp.txt','utf8').trim()+'\n');
