#!/usr/bin/env node
/** Static inventory, deliberately not a claim of executed interaction coverage. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function inventorySource(file,source){
 const interactions=[];
 const add=(match,details)=>interactions.push({file,line:source.slice(0,match.index).split('\n').length,offset:match.index,...details,status:'unreviewed'});
 if(file.endsWith('.html')){
  for(const match of source.matchAll(/\b(on[A-Za-z]+)\s*=\s*(["'])(.*?)\2/g))add(match,{event:match[1],handler:match[3],kind:'template'});
 }else{
  for(const match of source.matchAll(/\b(on[A-Z][A-Za-z]+)\s*(?:=|:)\s*([^\n]{0,500})/g))add(match,{event:match[1],handler:match[2],kind:'handler-candidate'});
  // DOM properties use lowercase names; these drive many dynamically created dialogs.
  for(const match of source.matchAll(/\.\s*(on[a-z]+)\s*=\s*([^\n]{0,500})/g))add(match,{event:match[1],handler:match[2],kind:'dom-property-candidate'});
  for(const match of source.matchAll(/\.addEventListener\(\s*(['"])([^'"]+)\1/g))add(match,{event:match[2],kind:'listener-candidate'});
  for(const match of source.matchAll(/\.createElement\(\s*(['"])(button|input|select|textarea|a|form|dialog)\1/g))add(match,{element:match[2],kind:'dynamic-control-candidate'});
 }
 // Include controls independently of handlers: delegated and inert controls need review too.
 for(const match of source.matchAll(/<(button|input|select|textarea|a|form|dialog)\b[^>]*>/gi))add(match,{element:match[1].toLowerCase(),markup:match[0],kind:'control-candidate'});
 return interactions.sort((a,b)=>a.offset-b.offset||a.kind.localeCompare(b.kind));
}
function main(){
 const output=process.argv[2];
 if(!output)throw Error('Usage: node scripts/inventory-interactions.mjs OUTPUT.json');
 const files=fs.readdirSync('apps/app/src',{recursive:true}).filter(p=>/\.(?:tsx?|jsx?|html)$/.test(p)).map(p=>path.join('apps/app/src',p)).sort();
 const sources=[],interactions=[];
 for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  sources.push({file,sha256:crypto.createHash('sha256').update(source).digest('hex')});
  interactions.push(...inventorySource(file,source));
 }
const report={generatedAt:new Date().toISOString(),scope:'Static lexical controls/template/handler/event-listener candidate inventory. Controls and handlers are separate overlapping candidates, not unique interaction counts. This is not an AST or runtime reachability analysis. Repeated controls, dynamically registered actions, native intents and runtime reachability require separate review. Unreviewed is not missing or passing.',sources,interactionCount:interactions.length,interactions};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sources:sources.length,interactions:interactions.length,output}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
