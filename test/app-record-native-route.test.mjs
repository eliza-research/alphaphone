// Canonical Notes and Calendar routes (app-record-route-policy.ts). The real Android request gate is
// compiled from AlphaLocalAgentPlugin.java with AppRecordRoutes.java and run on the host JVM; it must admit
// exactly what the renderer policy admits, owner-bound. Host-JVM and Node evidence only, not Android.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,runJvm} from './fixtures/jvm-tools.mjs';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{appRecordRouteAllowed}]=await loadBrowserModule(['apps/app/src/runtime/app-record-route-policy.ts'],{testMocks:true});

const owner='owner-identity',NULL='<null>';
const C='/api/lifeops/calendar';
// [method, path, body]
const routes=[
 ['GET','/api/notes/state',NULL],['POST','/api/views/notes/interact','{}'],
 ['GET',C+'/feed?side=owner&timeMin=2026-10-25T00%3A00%3A00Z&timeMax=2026-10-26T00%3A00%3A00Z&timeZone=Europe%2FBerlin',NULL],
 ['GET',C+'/calendars?includeHiddenCalendars=true',NULL],['GET',C+'/next-context',NULL],
 ['POST',C+'/events','{}'],['PATCH',C+'/events/grant%3Aevent-1?side=owner&calendarId=primary','{}'],
 ['DELETE',C+'/events/eliza-1?recurrenceScope=instance&idempotencyKey=k',NULL],
 ['GET','/api/notes/state','{}'],['POST','/api/notes/state','{}'],['GET','/api/notes/state?x=1',NULL],
 ['GET',C+'/feed?side=owner&side=owner',NULL],['GET',C+'/feed?unknown=1',NULL],['POST',C+'/feed','{}'],
 ['DELETE',C+'/events/x','{}'],['PATCH',C+'/events/%2Fetc','{}'],['PATCH',C+'/events/a%2',NULL],
 ['GET',C+'/../notes/state',NULL],['GET',C+'//feed',NULL],['GET',C+'/feed?a=1?b=2',NULL],['GET',C+'/feed#x',NULL],
 ['PUT',C+'/events/x','{}'],['GET',C+'/events',NULL],['POST',C+'/events/x/extra','{}'],
];

test('the Android request gate admits the canonical Notes and Calendar routes exactly as the renderer policy, owner-bound',()=>{
 const plugin=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8'),request=plugin.slice(plugin.indexOf('@PluginMethod public void request(PluginCall call) {'));
 const approval=plugin.match(/ static boolean calendarApprovalReadAllowed\([^\n]*\}/)[0],decl=request.match(/\n  (boolean record=AppRecordRoutes\.owns\(path\),automation=record\|\|AutomationsRoutes\.owns\(path\),[^\n]*;)\n/)[1];
 const gate=request.match(/\n  if\(([^\n]+)\)\{\n/)[1];
 const directory=mkdtempSync(join(tmpdir(),'alpha-record-gate-')),harness=join(directory,'RecordGateHarness.java');
 const cases=[...routes.map(([m,p,b])=>[m,p,b,owner]),...routes.slice(0,8).map(([m,p,b])=>[m,p,b,NULL])];
 try{
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public final class RecordGateHarness{
${approval}
 static String value(String v){return "${NULL}".equals(v)?null:v;}
 static boolean refused(String path,String method,String body,String expectedOwner){${decl}return ${gate};}
 public static void main(String[] args){StringBuilder out=new StringBuilder();for(int i=0;i<args.length;i+=4)out.append(refused(args[i+1],args[i],value(args[i+2]),value(args[i+3]))?'R':'A');System.out.print(out);}
}`);
  const native=runJvm([nativeSource('AppRecordRoutes.java'),nativeSource('AutomationsRoutes.java'),harness],'ai.elizaresearch.alphaphone.RecordGateHarness',{args:cases.flat()});
  const expected=cases.map(([m,p,b,o])=>o!==NULL&&appRecordRouteAllowed(p,m)&&!((m==='GET'||m==='DELETE')&&b!==NULL)?'A':'R').join('');
  assert.equal(native,expected);
  assert.equal(expected.slice(0,8),'AAAAAAAA','every canonical route is admitted with an owner');
  assert.equal(expected.slice(routes.length),'R'.repeat(8),'no route is admitted without an owner');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
