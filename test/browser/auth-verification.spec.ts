import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const origin='https://alphacompute.ai',base=origin+'/alphaphone/verify/';
for(const provider of ['turnstile','hcaptcha'])test(`isolated ${provider} page returns one token without sending it to its host`,async({page})=>{
 const requests:string[]=[];
 await page.route(base+'**',async route=>{requests.push(route.request().url());const file=new URL(route.request().url()).pathname.split('/').pop()!;await route.fulfill({headers:file==='index.html'?{'Content-Security-Policy':readFileSync('deployment/alpha-auth/verification/csp.txt','utf8').trim()}:{},body:file==='result'?'<p>Native host would intercept this.</p>':readFileSync('deployment/alpha-auth/verification/'+file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.route(/https:\/\/(challenges.cloudflare.com|js.hcaptcha.com)\//,route=>route.fulfill({contentType:'text/javascript',body:`window.${provider}={render:(_,options)=>{window.challengeOptions=options;const b=document.createElement('button');b.textContent='Complete test challenge';b.onclick=()=>{options.callback('fixture-verification-token');options.callback('must-not-replace');};document.querySelector('#challenge').append(b);}};onVerificationReady();`}));
 await page.goto(base+'index.html#'+new URLSearchParams({state:'11111111-1111-4111-8111-111111111111',provider,siteKey:'public-fixture-key',action:'email_otp'}));
 await expect(page.getByRole('status')).toHaveText('Complete the verification above.');expect(new URL(page.url()).hash).toBe('');
 await page.screenshot({path:'test-results/verification-'+provider+'.png'});
 await page.getByRole('button',{name:'Complete test challenge'}).click();
 await expect(page).toHaveURL(/result#.*token=fixture-verification-token/);expect(requests.every(url=>!url.includes('fixture-verification-token'))).toBe(true);
});
test('verification refuses malformed configuration before loading a provider',async({page})=>{
 let providers=0;await page.route(/^https:/,async route=>{const u=new URL(route.request().url());if(u.origin!==origin){providers++;return route.abort();}const file=u.pathname.split('/').pop()!;await route.fulfill({body:readFileSync('deployment/alpha-auth/verification/'+file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.goto(base+'index.html#state=wrong&provider=turnstile&siteKey=public&action=email_otp');await expect(page.getByRole('status')).toContainText('could not start');expect(providers).toBe(0);
});
