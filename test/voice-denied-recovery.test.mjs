import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const states=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync('apps/app/src/runtime/voice-states.ts','utf8'),{mode:'transform'})).toString('base64'));
const adapter=readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8'),template=readFileSync('apps/app/src/prototype/template.html','utf8');

test('a refused microphone keeps the app settings control on the phone, with no failure line',()=>{
 assert.equal(states.voiceFailure({code:'permission-denied'},false),'denied');
 assert.equal(states.voiceFailure({name:'NotAllowedError'},false),'denied');
 assert.equal(states.voiceFailure({code:'permission-denied'},true),null,'a transcription failure is not a microphone refusal');
 assert.equal(states.voiceFailure(new DOMException('Cancelled','AbortError'),false),null);
 assert.equal(states.deniedSettingsChoice({failure:'denied',stage:'ready',busy:false,native:true}),true);
 // A browser has its own site settings, so no app-settings control is offered there.
 assert.equal(states.deniedSettingsChoice({failure:'denied',stage:'ready',busy:false,native:false}),false);
 for(const other of [{failure:'',stage:'ready',busy:false,native:true},{failure:'no-speech',stage:'recorded',busy:false,native:true},{failure:'denied',stage:'recording',busy:false,native:true},{failure:'denied',stage:'ready',busy:true,native:true}])
  assert.equal(states.deniedSettingsChoice(other),false,JSON.stringify(other));
});
test('the recorder renders that control and it only opens Android settings for the app',()=>{
 assert.match(adapter,/const settingsChoice = deniedSettingsChoice\(\{ failure, stage, busy, native: Capacitor\.isNativePlatform\(\) \}\);/);
 assert.match(adapter,/routeChoice: settingsChoice \|\| /);
 assert.match(adapter,/routeLabel: settingsChoice \? DENIED_SETTINGS_LABEL : /);
 assert.match(adapter,/changeRoute: \(\) => \{ if \(!owned\(\)\|\|stage !== 'ready' \|\| busy\) return; if \(settingsChoice\) \{ openSettings\(\); return; \}/);
 assert.match(adapter,/const openSettings = \(\) => \{ void appSettings\.openSettings\(\{ page: 'privacy' \}\)/);
 // The route slot is the button the template shows for it, named by its label.
 assert.match(template,/<sc-if value="\{\{notes\.rec\.routeChoice\}\}"><button aria-label="\{\{notes\.rec\.routeLabel\}\}" onClick="\{\{notes\.rec\.changeRoute\}\}"/);
});
