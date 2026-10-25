// Renderer secure-slot names against the native compare-exchange allow-list (LOOP-B, CRITIC notes
// draft). Class S: it parses the renderer and Java sources; it does not run Android. A slot the
// renderer writes with secureConnectionStore.compareExchange(Raw) that AlphaConnectionPlugin does
// not admit is refused on Android with 'Secure draft update failed' while every browser test passes;
// that is how the note-origins link shipped broken ('The link to its note could not be saved').
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {root,nativeSource} from './fixtures/jvm-tools.mjs';

const source=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
const credentialStore=readFileSync(nativeSource('AlphaCredentialStore.java'),'utf8');
const slotsJava=readFileSync(nativeSource('RendererCredentialSlots.java'),'utf8');

/** The admission predicate parsed from secureCompareExchange: exact names, prefixes and patterns. */
function nativeAllowList(){
 const method=source.slice(source.indexOf('@PluginMethod public void secureCompareExchange('),source.indexOf('@PluginMethod public void secureRemove('));
 const condition=method.match(/if\(name==null\|\|!\((.*?)\)\|\|!call\.getData\(\)\.has\("expectedValue"\)/);
 assert.ok(condition,'secureCompareExchange keeps one allow-list expression');
 const constant=name=>{const found=credentialStore.match(new RegExp(`static final String ${name}="([^"]+)"`));assert.ok(found,`AlphaCredentialStore.${name} resolves`);return found[1];};
 const rules=condition[1].split('||').map(clause=>{
  let match;
  if((match=clause.match(/^name\.equals\("([^"]+)"\)$/)))return {kind:'exact',value:match[1]};
  if((match=clause.match(/^name\.equals\(AlphaCredentialStore\.(\w+)\)$/)))return {kind:'exact',value:constant(match[1])};
  if((match=clause.match(/^name\.startsWith\("([^"]+)"\)$/)))return {kind:'prefix',value:match[1]};
  if((match=clause.match(/^name\.matches\("([^"]+)"\)$/)))return {kind:'pattern',value:new RegExp(`^(?:${match[1].replace(/\\\\/g,'\\')})$`)};
  assert.fail(`unparsed allow-list clause: ${clause}`);
 });
 return {rules,admits:slot=>rules.some(rule=>rule.kind==='exact'?slot===rule.value:rule.kind==='prefix'?slot.startsWith(rule.value):rule.value.test(slot))};
}
function nativeOnlyNamespaces(){
 const list=slotsJava.match(/NATIVE_NAMESPACES = \{([\s\S]*?)\};/);assert.ok(list);
 return [...list[1].matchAll(/"([^"]+)"/g)].map(match=>match[1]);
}

const files=[];
(function walk(directory){for(const name of readdirSync(directory)){const path=join(directory,name);if(statSync(path).isDirectory())walk(path);else if(/\.(ts|tsx)$/.test(name))files.push(path);}})(join(root,'apps/app/src'));
const exported=new Map();
for(const file of files)for(const match of readFileSync(file,'utf8').matchAll(/export const (\w+)\s*=\s*(['"])([^'"]+)\2/g))exported.set(match[1],match[3]);

// A dynamic part (a SHA-256 hex digest, an owner or a scope) is sampled as 64 hex digits, which every
// renderer derivation produces or the native prefix rule admits.
const SAMPLE='a'.repeat(64);
function evaluate(expression,text,depth=0){
 expression=expression.trim().replace(/^await\s+/,'');
 assert.ok(depth<6,`slot expression resolves: ${expression}`);
 let match;
 if((match=expression.match(/^(['"])([^'"]*)\1$/)))return [match[2]];
 if((match=expression.match(/^`([^`]*)`$/)))return [match[1].replace(/\$\{[^}]*\}/g,SAMPLE)];
 if((match=expression.match(/^(['"])([^'"]*)\1\s*\+\s*(?:this\.)?\w+$/)))return [match[2]+SAMPLE];
 // A static key derivation (Class.method(args)) resolves through its one-line return.
 if((match=expression.match(/^(?!this\.)\w+\.(\w+)\([^()]*\)$/))){
  const body=text.match(new RegExp(`static\\s+(?:async\\s+)?${match[1]}\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+([^;]+);`));
  assert.ok(body,`static slot function ${match[1]} resolves`);return evaluate(body[1],text,depth+1);
 }
 if((match=expression.match(/^(?:this\.)?(\w+)\(\)$/))){
  const body=text.match(new RegExp(`(?:\\b${match[1]}\\s*\\(\\)\\s*\\{\\s*return\\s+([^;]+);|\\b${match[1]}\\s*=\\s*\\(\\)\\s*=>\\s*([^;,]+))`));
  assert.ok(body,`slot function ${match[1]} resolves`);return evaluate(body[1]??body[2],text,depth+1);
 }
 if((match=expression.match(/^\w+$/))){
  const name=expression;
  const destructured=text.match(new RegExp(`const \\[${name},\\w+\\]=\\w+\\?\\[(\\w+),[^\\]]+\\]:\\[(\\w+),`));
  if(destructured)return [...evaluate(destructured[1],text,depth+1),...evaluate(destructured[2],text,depth+1)];
  const local=text.match(new RegExp(`(?:const|let|,)\\s*${name}\\s*=\\s*((?:\\(\\)\\s*=>\\s*)?(?:(['"\`])[^'"\`]*\\2(?:\\s*\\+\\s*\\w+)?|\\w+\\(\\)))`));
  if(local)return evaluate(local[1].replace(/^\(\)\s*=>\s*/,''),text,depth+1);
  if(exported.has(name))return [exported.get(name)];
 }
 assert.fail(`unresolved renderer slot expression: ${expression}`);
}

// Receivers that reach the native secure store. Browser-only stores are listed so a new receiver
// must be classified here before it can ship.
// inboxLocalStore delegates to secureConnectionStore with the same slot on Android (runtime/inbox-local-store.ts).
const nativeReceivers=new Set(['secureConnectionStore','inboxLocalStore','calendarLinkStorage','vault','storage','this.storage','this.deps.store','store']);
const browserOnly=new Set(['this.documents','browserDocuments','backend','store()','slot']);
function rendererSlots(){
 const found=[];
 for(const file of files){
  const text=readFileSync(file,'utf8'),where=relative(root,file);
  for(const match of text.matchAll(/([A-Za-z_.()]+)\.compareExchange(?:Raw)?\(\s*([^,]+),/g)){
   const receiver=match[1];
   // Pure cache CAS exchanges a whole document; the platform factory's hashed slot is checked separately.
   if(where.endsWith('runtime/service-read-cache.ts')&&receiver==='this.store')continue;
   if(browserOnly.has(receiver))continue;
   // These typed canonical Notes adapters exchange a document revision; they do not name a secure slot.
   if(where.endsWith('prototype/legacy-notes-access.ts')&&receiver==='port'){assert.match(text,/port:NotesDocumentPort/);assert.equal(match[2].trim(),'expected');continue;}
   if(where.endsWith('prototype/legacy-notes-access.ts')&&receiver==='vault'){assert.match(text,/SecureNotesStore\.open\(guarded/);assert.equal(match[2].trim(),'key');continue;}
   assert.ok(nativeReceivers.has(receiver),`${where}: classify compareExchange receiver ${receiver}`);
   // The capacity wrapper passes its caller's key through; the shared store's slot is checked below.
   if(where.endsWith('runtime/notes-secure-store.ts')&&match[2].trim()==='key')continue;
   // The Inbox local store passes its caller's slot through; its callers' slots are checked.
   if(where.endsWith('runtime/inbox-local-store.ts')&&match[2].trim()==='slot')continue;
   if(where.endsWith('runtime/service-read-cache-store.ts')&&match[2].trim()==='slot'){found.push({slot:'connected-read-cache:v1:'+SAMPLE,where});assert.ok(text.includes("slot='connected-read-cache:v1:'+hash"));continue;}
   // The Calendar adapter accepts only this exact owner/source-derived namespace.
   if(where.endsWith('runtime/calendar-linked-storage.ts')&&match[2].trim()==='slot'){
    assert.ok(text.includes('calendar-linked-sync:v1:[a-f0-9]{64}'));
    continue;
   }
   // InboxOperation.discardUnsent writes the same per-owner slot as the instance's key() (one storeKey).
   if(where.endsWith('runtime/inbox-operation.ts')&&match[2].trim()==='key'){
    assert.match(text,/const key = await InboxOperation\.storeKey\(owner, grantId\);/);
    for(const slot of evaluate('InboxOperation.storeKey(owner, grantId)',text))found.push({slot,where});
    continue;
   }
   for(const slot of evaluate(match[2],text))found.push({slot,where});
  }
 }
 // The shared Notes store writes its collection to config.secureSlot through the vault above.
 const notes=readFileSync(join(root,'apps/app/src/runtime/notes-secure-store.ts'),'utf8');
 assert.match(notes,/secureSlot:SECURE_NOTES_SLOT/);
 found.push({slot:exported.get('SECURE_NOTES_SLOT'),where:'apps/app/src/runtime/notes-secure-store.ts (shared store)'});
 return found;
}

test('every renderer compare-exchange slot is admitted by the native allow-list and is not native-only',()=>{
 const {admits}=nativeAllowList(),namespaces=nativeOnlyNamespaces(),slots=rendererSlots();
 assert.ok(slots.length>=12,'the scan found the renderer call sites');
 for(const {slot,where} of slots){
  assert.ok(admits(slot),`${where}: ${slot} is admitted by AlphaConnectionPlugin.secureCompareExchange`);
  for(const namespace of namespaces)assert.ok(slot!==namespace&&!slot.startsWith(namespace+':'),`${where}: ${slot} is not in native-only namespace ${namespace}`);
 }
});

test('the Notes draft and note-origin slots are named, used by the renderer and admitted natively',()=>{
 const {rules,admits}=nativeAllowList(),slots=rendererSlots().map(entry=>entry.slot);
 for(const slot of ['notes-draft:v1:device','note-origins:v1:device']){
  assert.ok(slots.includes(slot),`the renderer writes ${slot}`);
  assert.ok(admits(slot),`${slot} is admitted`);
  assert.ok(rules.some(rule=>rule.kind==='exact'&&rule.value===slot),`${slot} is admitted by an exact rule, not a pattern`);
 }
 // saveDraft, clearDraft and the Notes recovery reset all use the draft slot.
 const notes=readFileSync(join(root,'apps/app/src/runtime/notes-secure-store.ts'),'utf8'),agent=readFileSync(join(root,'apps/app/src/prototype/agent-adapter.ts'),'utf8');
 assert.equal([...notes.matchAll(/vault\.compareExchange\(SECURE_NOTES_DRAFT_SLOT,/g)].length,2,'saveDraft and clearDraft');
 assert.match(agent,/\[SECURE_NOTES_SLOT,captured\.saved\]:\[SECURE_NOTES_DRAFT_SLOT,captured\.draft\]/,'the recovery reset');
});

test('the parser fails closed: removing a slot from the allow-list is detected',()=>{
 const {rules}=nativeAllowList();
 for(const slot of ['notes-draft:v1:device','note-origins:v1:device']){
  const without=rules.filter(rule=>!(rule.kind==='exact'&&rule.value===slot));
  const admits=value=>without.some(rule=>rule.kind==='exact'?value===rule.value:rule.kind==='prefix'?value.startsWith(rule.value):rule.value.test(value));
  assert.equal(admits(slot),false,`without its rule ${slot} would be refused`);
 }
});

test('the note-origin slot has its own native size bound above the renderer 200-link limit',()=>{
 assert.match(credentialStore,/static final String NOTE_ORIGINS="note-origins:v1:device";/);
 assert.match(credentialStore,/if\(NOTE_ORIGINS\.equals\(name\)\)return 512\*1024;/);
 const origin=readFileSync(join(root,'apps/app/src/runtime/note-origin.ts'),'utf8');
 assert.match(origin,/200/,'the renderer keeps its 200-link bound');
});

test('browser Cloud conditional cleanup is isolated from the native credential CAS namespace',()=>{
 const native=readFileSync(join(root,'apps/app/src/runtime/native-connection.ts'),'utf8'),browser=readFileSync(join(root,'apps/app/src/browser/cloud-connection.ts'),'utf8');
 assert.match(native,/browserCloudHost\?\{clearIfCurrent:[^\n]*clearBrowserCloudCredentialIfCurrent/);
 assert.doesNotMatch(native,/secureConnectionStore\.compareExchange\(`cloud:/);
 const start=browser.indexOf('export async function clearBrowserCloudCredentialIfCurrent('),end=browser.indexOf('\n}',start);assert.ok(start>=0&&end>start);const cleanup=browser.slice(start,end);
 assert.match(cleanup,/host=new BrowserCloudConnection\(\)/);assert.match(cleanup,/host\.secureCompareExchange\(/);assert.doesNotMatch(cleanup,/secureConnectionStore|registerPlugin|nativePromise/);
 const {admits}=nativeAllowList();assert.equal(admits('cloud:production'),false);assert.equal(admits('cloud:staging'),false);
});
