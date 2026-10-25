#!/usr/bin/env node
/** Static inventory, deliberately not a claim of executed interaction coverage. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const output=process.argv[2];
if(!output)throw Error('Usage: OUTPUT.json');
const files=fs.readdirSync('apps/app/src',{recursive:true}).filter(p=>/\.(?:tsx?|jsx?|html)$/.test(p)).map(p=>path.join('apps/app/src',p)).sort();
const sources=[],interactions=[];
for(const file of files){
 const source=fs.readFileSync(file,'utf8');
 sources.push({file,sha256:crypto.createHash('sha256').update(source).digest('hex')});
 if(file.endsWith('.html')){
  for(const match of source.matchAll(/\b(on[A-Z][A-Za-z]+)="([^"]*)"/g))interactions.push({file,line:source.slice(0,match.index).split('\n').length,event:match[1],handler:match[2],kind:'template',status:'unreviewed'});
 }else{
  // Lexical candidates: include ordinary assigned handler props as well as JSX.
  // Runtime review distinguishes executable controls from source examples.
  for(const match of source.matchAll(/\b(on[A-Z][A-Za-z]+)\s*(?:=|:)\s*([^\n]{0,500})/g))interactions.push({file,line:source.slice(0,match.index).split('\n').length,event:match[1],handler:match[2],kind:'handler-candidate',status:'unreviewed'});
  for(const match of source.matchAll(/\.addEventListener\(\s*(['"])([^'"]+)\1/g))interactions.push({file,line:source.slice(0,match.index).split('\n').length,event:match[2],kind:'listener-candidate',status:'unreviewed'});
 }
}
const report={generatedAt:new Date().toISOString(),scope:'Static lexical template/handler/event-listener candidate inventory. This is not an AST or runtime reachability analysis. Repeated controls, dynamically registered actions, native intents and runtime reachability require separate review. Unreviewed is not missing or passing.',sources,interactionCount:interactions.length,interactions};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sources:sources.length,interactions:interactions.length,output}));
