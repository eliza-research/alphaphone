import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { browserConsumerAssets } from '../scripts/browser-consumer-assets.ts';
import { inspectBrowserConsumer, prepareBrowserConsumer } from '../scripts/prepare-browser-consumer.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eliza-app-artifact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'vendor/eliza'); fs.mkdirSync(upstream, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const sourceFiles = {'packages/app/scripts/build-browser-consumer.ts':'producer', 'packages/app/src/renderer/browser-consumer.tsx':'shared App', 'bun.lock':'pinned dependencies'};
  for (const [name, text] of Object.entries(sourceFiles)) { const f = path.join(upstream, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  git('add', '.'); git('commit', '-qm', 'fixture');
  const pin = git('rev-parse', 'HEAD'); fs.writeFileSync(path.join(root, 'upstream.lock.json'), JSON.stringify({commit:pin}));
  const artifact = path.join(root, 'input'); fs.mkdirSync(artifact);
  const files = {'index.js':'export const App = 1;', 'index.d.ts':'export declare const App: number;', 'styles.js':'import "./assets/app.css";', 'assets/app.css':':root {color:black}', 'public/assets/app.css':':root {color:black}'};
  for (const [name, text] of Object.entries(files)) { const f = path.join(artifact, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  const manifest = {schema:'eliza-browser-consumer-v1',revision:pin,distributable:true,diagnostic:false,sourceDiffSha256:hash(''),lockSha256:hash(sourceFiles['bun.lock']),entry:'index.js',types:'index.d.ts',stylesEntry:'styles.js',styles:['assets/app.css'],staticAssets:['assets/app.css'],runtimeImports:['react'],sourceFiles:Object.fromEntries(Object.entries(sourceFiles).map(([k,v])=>[k,hash(v)])),files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,{bytes:Buffer.byteLength(v),sha256:hash(v)}]))};
  const write = () => fs.writeFileSync(path.join(artifact, 'manifest.json'), JSON.stringify(manifest)); write();
  return {root,artifact,pin,manifest,write,git};
}

test('stages the actual emitted graph and checks cached output against the same pin', t => {
  const f=fixture(t), destination=prepareBrowserConsumer(f.root,f.artifact);
  assert.equal(fs.readFileSync(path.join(destination,'index.js'),'utf8'),'export const App = 1;');
  assert.equal(prepareBrowserConsumer(f.root),destination);
  fs.writeFileSync(path.join(destination,'index.js'),'changed');
  assert.throws(()=>prepareBrowserConsumer(f.root),/inventory/);
});
test('refuses diagnostic, wrong-pin, changed source and changed lock receipts', t => {
  const f=fixture(t);
  for (const [key,value,pattern] of [['diagnostic',true,/production/],['revision','0'.repeat(40),/pinned source/],['lockSha256','0'.repeat(64),/dependency lock/]]) {
    const old=f.manifest[key];f.manifest[key]=value;f.write();assert.throws(()=>prepareBrowserConsumer(f.root,f.artifact),pattern);f.manifest[key]=old;
  }
  f.manifest.sourceFiles['packages/app/src/renderer/browser-consumer.tsx']=hash('different');f.write();
  assert.throws(()=>prepareBrowserConsumer(f.root,f.artifact),/source differs from pin/);
});
test('refuses omitted, extra, traversing and symlinked output files', t => {
  const f=fixture(t), source={pin:f.pin,verify(){}};
  fs.writeFileSync(path.join(f.artifact,'extra.js'),'unexpected');assert.throws(()=>inspectBrowserConsumer(f.artifact,source),/inventory/);fs.unlinkSync(path.join(f.artifact,'extra.js'));
  fs.unlinkSync(path.join(f.artifact,'index.js'));assert.throws(()=>inspectBrowserConsumer(f.artifact,source),/entry/);
  fs.symlinkSync(path.join(f.artifact,'styles.js'),path.join(f.artifact,'index.js'));assert.throws(()=>inspectBrowserConsumer(f.artifact,source),/Nonregular/);fs.unlinkSync(path.join(f.artifact,'index.js'));
  fs.writeFileSync(path.join(f.artifact,'index.js'),'export const App = 1;');f.manifest.files['../outside.js']={bytes:0,sha256:hash('')};f.write();assert.throws(()=>inspectBrowserConsumer(f.artifact,source),/inventory/);
});
test('refuses dirty upstream and preserves previous accepted output after a failed replacement', t => {
  const f=fixture(t), destination=prepareBrowserConsumer(f.root,f.artifact), old=fs.readFileSync(path.join(destination,'manifest.json'));
  fs.writeFileSync(path.join(f.artifact,'index.js'),'corrupted');assert.throws(()=>prepareBrowserConsumer(f.root,f.artifact),/inventory/);assert.deepEqual(fs.readFileSync(path.join(destination,'manifest.json')),old);
  fs.writeFileSync(path.join(f.root,'vendor/eliza/bun.lock'),'dirty');assert.throws(()=>prepareBrowserConsumer(f.root),/dirty/);
});
test('refuses an unrecognized destination without deleting its contents', t => {
  const f=fixture(t), d=path.join(f.root,'.eliza/browser-consumer');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'user-file'),'keep');
  assert.throws(()=>prepareBrowserConsumer(f.root,f.artifact));assert.equal(fs.readFileSync(path.join(d,'user-file'),'utf8'),'keep');
});

test('shared public assets preserve product overrides and middleware rejects writes and traversal', t => {
  const f=fixture(t);prepareBrowserConsumer(f.root,f.artifact);
  const plugin=browserConsumerAssets(f.root), emitted=[];
  plugin.generateBundle.call({emitFile(value){emitted.push(value)}});
  assert.equal(emitted.length,1);assert.equal(emitted[0].fileName,'assets/app.css');
  let middleware;plugin.configureServer({middlewares:{use(value){middleware=value}}});
  let next=0,ended,code,headers;const res={writeHead(value,fields){code=value;headers=fields},end(value){ended=value}};
  middleware({url:'/assets/app.css?v=1',method:'GET'},res,()=>next++);assert.equal(code,200);assert.equal(ended.toString(),':root {color:black}');
  middleware({url:'/assets/app.css',method:'POST'},res,()=>next++);assert.equal(res.statusCode,405);
  middleware({url:'/../manifest.json',method:'GET'},res,()=>next++);assert.equal(next,1);
  const local=path.join(f.root,'apps/app/public/assets');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'app.css'),'product');
  const overrides=[];browserConsumerAssets(f.root).generateBundle.call({emitFile(value){overrides.push(value)}});assert.equal(overrides.length,0);
});
