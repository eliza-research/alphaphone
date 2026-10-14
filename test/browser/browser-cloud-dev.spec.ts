import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createBrowserCloudDevHandler} from '../../scripts/browser-cloud-dev-bridge';

// Closed Cloud/media fixture: normal production adapters, no external request or media device.
test('browser restores an existing host Cloud account, uses canonical voice and preserves explicit logout',async({page},info)=>{
 test.setTimeout(45000);
 const profile=await mkdtemp(join(tmpdir(),'alpha-browser-cloud-ui-')),secret='synthetic-cloud-ui-credential',owner='11111111-1111-4111-8111-111111111111',organizationId='22222222-2222-4222-8222-222222222222',credentialId='33333333-3333-4333-8333-333333333333',reference='browser-cloud-reference:44444444-4444-4444-8444-444444444444',session=randomUUID(),calls:string[]=[];
 await writeFile(join(profile,'credential'),secret,{mode:0o600});await writeFile(join(profile,'initial-credential.json'),JSON.stringify({environment:'production',credentialFile:join(profile,'credential'),credentialSha256:createHash('sha256').update(secret).digest('hex'),userId:owner,organizationId,credentialReference:reference,credentialId}),{mode:0o600});
 const handler=createBrowserCloudDevHandler({profile,request:async(url,input={})=>{
  const path=new URL(String(url)).pathname;calls.push(path);
  if(path==='/api/auth/cli-session')return Response.json({sessionId:session,expiresAt:new Date(Date.now()+60000).toISOString()});
  if(path==='/api/auth/cli-session/'+session)return Response.json({status:'authenticated',apiKey:secret});
  expect(new Headers(input.headers).get('Authorization')).toBe('Bearer '+secret);
  if(path==='/api/v1/user')return Response.json({success:true,data:{id:owner,organization_id:organizationId,email:'owned@example.invalid'}});
  if(path==='/api/v1/credits/balance')return Response.json({balance:4});
  if(path==='/api/v1/eliza/google/accounts')return Response.json([]);
  if(path==='/api/v1/voice/stt'){expect(input.body).toBeInstanceOf(FormData);expect((input.body as FormData).get('audio')).toBeInstanceOf(File);return Response.json({transcript:'Closed fixture transcript'});}
  if(path==='/api/v1/voice/tts'){expect(JSON.parse(String(input.body))).toEqual({text:'Closed fixture text',format:'mp3'});return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});}
  throw Error('Unexpected closed fixture Cloud route');
 }});
 const server=await createServer({configFile:resolve('vite.config.ts'),cacheDir:resolve('test-results/browser-cloud-dev/vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'owned-closed-cloud-fixture',enforce:'pre',configureServer(server){server.middlewares.use('/__alpha-browser-cloud',(req,res)=>{void handler(req,res);});}}]});
 try{
  await server.listen();const address=server.httpServer!.address()as {port:number};
  await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'none'}));(window as any).openedCloudURLs=[];window.open=((url:string)=>{(window as any).openedCloudURLs.push(url);return {opener:null};})as typeof window.open;});
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await expect.poll(()=>page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;return c.getSnapshot().cloudAccount?.userId;})).toBe(owner);
  expect(calls.filter(p=>p.startsWith('/api/auth/cli-session'))).toEqual([]);
  const voice=await page.evaluate(async()=>{
   const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),binding=c.getCloudClient()!,{BrowserVoice}=await import('/src/browser/voice.ts'),v=new BrowserVoice();
   (v as any).recognizer.transcribe=()=>{throw Error('Local Whisper must not run');};
   (v as any).capture.clips.set('closed-fixture',{blob:new Blob(['closed fixture'],{type:'audio/webm'}),durationMs:10});
   const options={environment:'production',credentialId:binding.credentialId,requestId:crypto.randomUUID()};
   const transcript=await v.transcribeRecording({...options,recordingId:'closed-fixture'});const prepared=await v.synthesize({...options,requestId:crypto.randomUUID(),text:'Closed fixture text'});
   const balance=await binding.client.creditBalance(new AbortController().signal);await binding.client.openSubscriptionManagement(new AbortController().signal);await v.releaseLocalSpeech();
   return {transcript,prepared:!!prepared.playbackId,balance:balance.balance,publicStorage:JSON.stringify(localStorage),opened:(window as any).openedCloudURLs};
  });
  expect(voice.transcript).toEqual({text:'Closed fixture transcript',local:false});expect(voice.prepared).toBe(true);expect(voice.balance).toBe(4);expect(voice.publicStorage).not.toContain(secret);expect(voice.opened).toEqual(['https://cloud.eliza.app/cloud/billing']);
  await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;c.openCloudAccount();});
  const account=page.getByRole('dialog',{name:'Eliza Cloud',exact:true});await expect(account.getByText('owned@example.invalid',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('existing-cloud-account.png'),animations:'disabled'});
  await account.getByRole('button',{name:'Sign out of Eliza Cloud',exact:true}).click();await page.reload();
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().cloudAccount)).toBeNull();
  await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.openCloudAccount());
  await page.getByRole('dialog',{name:'Eliza Cloud',exact:true}).getByRole('button',{name:'Sign in with Eliza Cloud',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Eliza Cloud',exact:true}).getByText('owned@example.invalid',{exact:true})).toBeVisible();
  expect(calls.filter(p=>p.startsWith('/api/auth/cli-session'))).toHaveLength(2);
  await info.attach('closed-cloud-requests',{body:JSON.stringify({calls,mediaCapture:false,playback:false,providerRequests:false}),contentType:'application/json'});
 }finally{await server.close();await rm(profile,{recursive:true,force:true});}
});
