import {test,expect} from '@playwright/test';
import {installCloudVoiceFixture} from './cloud-voice-fixture';

// Main's ongoing Cloud conversation has its own playback lifecycle (chat-voice-mode.spec.ts).
// P-39: Read replies aloud (Settings) speaks only the reply to a message dictated with
// Transcribe and sent as placed. A typed conversation never starts audio, whatever the stored
// preference says.
for(const enabled of [false,true])test(`Read replies aloud ${enabled?'on':'off'} never autoplays a typed reply`,async({page})=>{
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await installCloudVoiceFixture(page,'Unused synthetic transcript',true);
 await page.evaluate(async enabled=>{
  const {setSpeakReplies}=await import('/src/runtime/voice-selection.ts');setSpeakReplies(enabled);
  const {alphaClient}=await import('/src/runtime/alpha-client.ts');
  const f=(window as any).typedReplyFixture={posts:0};
  alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.example'},
   send:async({onText}:any)=>{f.posts++;onText('Thinking');return {text:'Your next event is at noon.'};},
   execute:async()=>{throw Error('No action may execute');}});
 },enabled);
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('What is my next event?');await input.press('Enter');
 await expect(page.locator('[data-alpha-layer="conversation"]').getByText('Your next event is at noon.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>({posts:(window as any).typedReplyFixture.posts,speech:(window as any).cloudVoiceFixture.speech}))).toEqual({posts:1,speech:[]});
});

test('Read replies aloud shows the stored choice, saves it, and reports a save that storage refused',async({page})=>{
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Character',exact:true}).click();
 const toggle=page.getByRole('button',{name:'Read replies aloud',exact:true});
 await expect(toggle).toHaveAttribute('aria-pressed','false');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alphaphone:speak-replies:v1')||'null'))).toEqual({version:1,enabled:true});
 await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Character',exact:true}).click();
 await expect(toggle).toHaveAttribute('aria-pressed','true');
 // A refused write keeps the stored position and says so.
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key:string,value:string){if(key==='alphaphone:speak-replies:v1')throw new DOMException('Full','QuotaExceededError');return set.call(this,key,value);};});
 await toggle.click();
 await expect(page.getByText('Read replies aloud could not be saved. Try again.',{exact:true})).toBeVisible();
 await expect(toggle).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alphaphone:speak-replies:v1')||'null'))).toEqual({version:1,enabled:true});
});
