import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

for(const captcha of [false,true])test(`Alpha account screen is local and branded (${captcha?'CAPTCHA':'code-only'})`,async({page})=>{
 await page.addInitScript((captcha)=>{
  const w=window as any;
  w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:['request','cancel'].map(name=>({name,rtype:'promise'}))},{name:'AlphaCaptcha',methods:['verify','cancel'].map(name=>({name,rtype:'promise'}))}],nativePromise:async(_plugin:string,method:string,input:any)=>{
   if(_plugin==='AlphaCaptcha'&&method==='verify'){if(!captcha||input.provider!=='turnstile'||input.action!=='email_otp')throw Error('Unexpected verification');w.verifications=(w.verifications||0)+1;return {token:'fixture-captcha-token'};}
   if(method==='cancel')return {};
   const path=new URL(input.url).pathname;
   if(path==='/steward/auth/providers')return {status:200,data:{ok:true,google:true,email:true,sms:true,...(captcha?{captcha:{enabled:true,provider:'turnstile',siteKey:'fixture-sitekey'}}:{})}};
   if(path==='/steward/auth/email/code/send'){if(captcha&&JSON.parse(input.body).captchaToken!=='fixture-captcha-token')throw Error('Missing verification token');w.codeSends=(w.codeSends||0)+1;return {status:200,data:{ok:true,data:{expiresAt:Date.now()+60000,codeLength:6}}};}
   throw Error('Unexpected fixture request');
  }};
 },captcha);
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByText('Alpha Phone account',{exact:true}).click();
 await page.getByRole('button',{name:'Sign in to Alpha Phone',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('heading',{name:'Welcome to Alpha Phone.'})).toBeVisible();
 await expect(dialog.getByText('ALPHA COMPUTE',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Manage Cloud account',exact:true})).toHaveCount(0);
 await expect(dialog.locator('a[href*="eliza.app"]')).toHaveCount(0);
 await dialog.getByText('Other sign-in options',{exact:true}).click();
 await dialog.getByLabel('Email address',{exact:true}).fill('fixture@example.invalid');
 await dialog.getByRole('button',{name:'Send code',exact:true}).click();
 await expect(dialog.getByLabel('Verification code',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).codeSends)).toBe(1);
 expect(await page.evaluate(()=>(window as any).verifications||0)).toBe(captcha?1:0);
 await dialog.getByRole('button',{name:'Terms of Service',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Terms of Service',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Return to sign-in',exact:true}).first().click();
 await expect(dialog.getByLabel('Verification code',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Privacy Policy',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Privacy Policy',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Return to sign-in',exact:true}).first().click();
 await dialog.getByRole('button',{name:'Cancel code sign-in',exact:true}).click();
 await expect(dialog.getByLabel('Email address',{exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/alpha-auth-surface.png'});
});

for(const environment of ['production','staging'])test(`Alpha Gmail ${environment} return preserves only the bound result`,async({page})=>{
 await page.route('https://alphacompute.ai/**',async route=>{
  const path=new URL(route.request().url()).pathname,file=path.endsWith('.js')?'callback.js':path.endsWith('.css')?'callback.css':'callback.html';
  await route.fulfill({body:readFileSync('deployment/alpha-auth/'+file,'utf8'),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 const path=`https://alphacompute.ai/alphaphone/gmail/${environment==='staging'?'staging/':''}callback`;
 await page.goto(path+'#state='+'s'.repeat(43)+'&result=denied',{waitUntil:'commit'});
 await expect(page.getByRole('link',{name:'Open Alpha Phone'})).toHaveAttribute('href',`alphaphone://gmail/${environment}#state=`+'s'.repeat(43)+'&result=denied');
 expect(new URL(page.url()).hash).toBe('');
 await page.goto(path+'#state='+'s'.repeat(43)+'&result=connected&connectionId=grant-a',{waitUntil:'commit'});
 await expect(page.getByRole('link',{name:'Open Alpha Phone'})).toHaveAttribute('href',`alphaphone://gmail/${environment}#state=`+'s'.repeat(43)+'&result=connected&connectionId=grant-a');
 await page.goto(path+'#state='+'s'.repeat(43)+'&result=connected&connectionId=grant-a&token=unsolicited',{waitUntil:'commit'});
 await expect(page.getByRole('link',{name:'Open Alpha Phone'})).toHaveCount(0);
});

for(const valid of [true,false])test(`Alpha return page ${valid?'hands off a bounded code':'rejects unsolicited token parameters'}`,async({page})=>{
 await page.route('https://alphacompute.ai/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const file=path.endsWith('.js')?'callback.js':path.endsWith('.css')?'callback.css':'callback.html';
  await route.fulfill({body:readFileSync('deployment/alpha-auth/'+file,'utf8'),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.goto('https://alphacompute.ai/alphaphone/auth/callback#code='+ 'c'.repeat(43)+'&state='+ 's'.repeat(43)+(valid?'':'&token=synthetic'),{waitUntil:'commit'});
 if(valid)await expect(page.getByRole('link',{name:'Open Alpha Phone'})).toHaveAttribute('href','alphaphone://auth/production#code='+ 'c'.repeat(43)+'&state='+ 's'.repeat(43));
 else {await expect(page.getByRole('link',{name:'Open Alpha Phone'})).toHaveCount(0);await expect(page.getByRole('status')).toContainText('invalid or incomplete');}
 expect(new URL(page.url()).hash).toBe('');
 await expect(page).toHaveTitle('Return to Alpha Phone · Alpha Compute');
});
