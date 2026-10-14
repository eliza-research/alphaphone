import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/google-authorization.ts','utf8'),{mode:'transform'});
const {googleAuthorizationUrlAllowed:allowed}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const params={client_id:'synthetic.apps.googleusercontent.com',response_type:'code',state:'owned-synthetic',redirect_uri:'https://api.eliza.app/api/v1/oauth/google/callback',scope:'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly'};
const url=(patch={})=>'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({...params,...patch});
test('only managed Google consent opens in the browser',()=>{assert.equal(allowed(url()),true);assert.equal(allowed(url({redirect_uri:'https://api-staging.eliza.app/api/v1/oauth/google/callback'})),true);});
test('foreign callbacks, account deletion scopes and non-code or unbound flows are refused',()=>{
 for(const patch of [{redirect_uri:'https://attacker.invalid/api/v1/oauth/google/callback'},{redirect_uri:'https://api.eliza.app/other'},{redirect_uri:'https://user:pass@api.eliza.app/api/v1/oauth/google/callback'},{redirect_uri:params.redirect_uri+'?target=other'},{scope:'https://mail.google.com/'},{response_type:'token'},{state:''},{client_id:''}])assert.equal(allowed(url(patch)),false,JSON.stringify(patch));
 for(const value of [url().replace('accounts.google.com','attacker.invalid'),url()+'&state=duplicate',url()+'#fragment',url().replace('/o/oauth2/v2/auth','/other')])assert.equal(allowed(value),false);
});
