import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

// Real voice-selection source with a synthetic Cloud session and an in-memory Storage.
// "Restart" evaluates the source again in a fresh context over the same stored bytes.
function storage(bytes = new Map()) {
  return {bytes, getItem: key => bytes.has(key) ? bytes.get(key) : null, setItem: (key, value) => { bytes.set(key, String(value)); }, removeItem: key => { bytes.delete(key); }};
}
function load(store, f = {account: true, dev: false}) {
  const events = [];
  const box = {
    testMocksEnabled: false, localStorage: store, Date, JSON, Number, Event: class { constructor(type) { this.type = type; } },
    window: {dispatchEvent: event => { events.push(event.type); return true; }},
    get browserDevProfile() { return f.dev; },
    connectionController: {getCloudEnvironment: () => f.account ? 'production' : null, getCloudClient: () => f.account ? {sessionId: 'synthetic-session', credentialId: 'synthetic-credential'} : null},
  };
  const source = fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export type', 'type');
  vm.runInNewContext('{' + stripTypeScriptTypes(source, {mode: 'transform'}) + '\nglobalThis.api={selectVoiceRoute,chooseVoiceRoute,voiceRoutePreference,speakRepliesEnabled,setSpeakReplies,cloudVoiceAvailable,voicePreferenceKeys,cloudSpeechDisclosure};}', box);
  return {...box.api, events, f};
}

test('production preserves the Cloud route regardless of account, legacy preferences or requested fallback', () => {
  for (const account of [true, false]) for (const dev of [true, false]) {
    const v=load(storage(), {account,dev});
    for(const requested of ['default','device','manual','agent']) assert.equal(v.selectVoiceRoute(requested),'cloud');
    assert.equal(v.chooseVoiceRoute('cloud'),false);
    assert.equal(v.chooseVoiceRoute('cloud',{disclosed:'cloud-speech-uses-credits'}),true);
    assert.equal(v.chooseVoiceRoute('device'),true);
    assert.equal(v.selectVoiceRoute(),'cloud','legacy preference cannot silently override current production policy');
    assert.match(v.cloudSpeechDisclosure(),/counts toward your plan allowance/);
  }
});

test('legacy preference persistence detects dropped or unavailable storage', () => {
  for(const store of [{getItem:()=>null,setItem(){}},{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}]) {
    const v=load(store);assert.equal(v.chooseVoiceRoute('cloud',{disclosed:'cloud-speech-uses-credits'}),false);assert.equal(v.selectVoiceRoute(),'cloud');
  }
});

test('Speak replies is opt-in, persisted and off for anything but an explicit enable', () => {
  const store = storage(), v = load(store);
  assert.equal(v.speakRepliesEnabled(), false);
  assert.equal(v.setSpeakReplies(true), true);
  assert.equal(load(store).speakRepliesEnabled(), true);
  assert.equal(v.setSpeakReplies(false), true);
  assert.equal(load(store).speakRepliesEnabled(), false);
  store.bytes.set('alphaphone:speak-replies:v1', '{"version":1,"enabled":"yes"}');
  assert.equal(load(store).speakRepliesEnabled(), false);
});
