import {test,expect,type Page} from '@playwright/test';
import {openLegacyNotes} from './helpers/legacy-notes';
import {recorder} from './voice-fixture';

// Main uses Cloud speech. Legacy persisted local preferences cannot silently select a
// different route. The Cloud binding is synthetic; no request or capture is made.
// The development server is shared and slow on a loaded machine.
test.describe.configure({timeout:120000});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
async function signedInCloud(page:Page){
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  (connectionController as any).getCloudEnvironment=()=>'production';
  (connectionController as any).getCloudClient=()=>({client:{},sessionId:'synthetic-cloud-session',credentialId:'synthetic-credential'});
 });
}
async function openRecorder(page:Page){
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();
 await expect(recorder(page)).toBeVisible();
}
test('Cloud remains the default across reload and legacy local preferences cannot silently switch routes',async({page})=>{
 const cloud:string[]=[];page.on('request',request=>{if(/elizacloud|eliza\.how|\/api\/v1\//.test(request.url()))cloud.push(request.url());});
 await page.goto('/');await signedInCloud(page);await openRecorder(page);
 await expect(recorder(page)).toContainText('Audio stays in this app until you choose Transcribe with Eliza Cloud');
 await expect(page.getByRole('button',{name:'Use Eliza Cloud voice (uses credits)',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Use on-device voice',exact:true})).toHaveCount(0);
 await page.evaluate(()=>localStorage.setItem('alphaphone:voice-route:v1',JSON.stringify({version:1,route:'device',chosenAt:1})));
 await page.reload();await signedInCloud(page);await openRecorder(page);
 await expect(recorder(page)).toContainText('Transcribe with Eliza Cloud');
 await page.reload();await openRecorder(page);
 await expect(recorder(page)).toContainText('Sign in to Eliza Cloud to use voice.');
 await expect(page.getByRole('button',{name:'Connect Eliza Cloud',exact:true})).toBeEnabled();
 expect(cloud).toEqual([]);
});
