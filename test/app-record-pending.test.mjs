import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const code=stripTypeScriptTypes(part('export function residentPendingText(','/** Passive surfaces').replace(/^export /gm,''),{mode:'transform'});
const pending=residentAlwaysPresent=>{const box={residentAlwaysPresent,RESIDENT_RECOVERY_PENDING:'recovery',state:{}};vm.runInNewContext(code,box);return state=>{box.state=state;return box.appRecordPendingText('Connect.');};};
test('Calendar and Notes explain a booting agent or a selected agent that keeps no app records',()=>{
 const phone=pending(true);
 assert.equal(phone({kind:'starting',session:null}),'Your agent is starting…');
 assert.equal(phone({kind:'recovering',session:null}),'Your agent stopped. Retry in Settings › Agent connection.');
 assert.equal(phone({kind:'cloud',session:{}}),'Calendar and Notes use the on-phone agent. Start it in Settings › Agent connection.');
 assert.equal(pending(false)({kind:'offline',session:null}),'Connect.','the web preview keeps its own wording');
});
