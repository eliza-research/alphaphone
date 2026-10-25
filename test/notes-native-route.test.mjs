// Stock plugin-notes owner routes (GET /api/notes/state, POST /api/views/notes/interact). The real
// Android request gate is compiled from AlphaLocalAgentPlugin.java with NotesRoutes.java and run on the
// host JVM; the renderer policy, local bridge and development Cloud guard must admit the same set.
// Host-JVM and Node evidence only, not Android.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,runJvm} from './fixtures/jvm-tools.mjs';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{notesRouteAllowed},{DevelopmentCloudAgentProtocol},{LocalAgentProtocol}]=await loadBrowserModule(['apps/app/src/runtime/notes-route-policy.ts','apps/app/src/runtime/development-cloud-agents.ts','apps/app/src/runtime/local-agent.ts'],{testMocks:true});

const owner='owner-identity',NULL='<null>',BIG='<over-2-MiB>';
// [method, path, body, ownerId, admitted by the native gate]
const cases=[
 ['GET','/api/notes/state',NULL,owner,true],
 ['POST','/api/views/notes/interact','{"capability":"get-notes"}',owner,true],
 ['GET','/api/notes/state',NULL,NULL,false],['GET','/api/notes/state',NULL,'  ',false],
 ['POST','/api/views/notes/interact','{}',NULL,false],['POST','/api/views/notes/interact','{}','',false],
 ['POST','/api/notes/state','{}',owner,false],['GET','/api/views/notes/interact',NULL,owner,false],
 ['GET','/api/notes/state','{}',owner,false],['PUT','/api/notes/state','{}',owner,false],['DELETE','/api/notes/state',NULL,owner,false],
 ['GET','/api/notes/state?x=1',NULL,owner,false],['GET','/api/notes/state/',NULL,owner,false],
 ['POST','/api/views/notes/interact/../x','{}',owner,false],['POST','/api/views/notes/interact?clientId=x','{}',owner,false],
 ['GET','/api/notes%2Fstate',NULL,owner,false],['POST','/api/views/notes%2Finteract','{}',owner,false],['POST','/api/views%2Fnotes/interact','{}',owner,false],
 ['POST','/api/views/calendar/interact','{}',owner,false],['POST','/api/views/notes','{}',owner,false],['GET','/api/views/notes',NULL,owner,false],
 ['POST','/api/views/notes/interact',BIG,owner,false],
];

test('the Android request gate admits exactly the two owner notes routes',()=>{
 const plugin=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8'),request=plugin.slice(plugin.indexOf('@PluginMethod public void request(PluginCall call) {'));
 const approval=plugin.match(/ static boolean calendarApprovalReadAllowed\([^\n]*\}/)[0],decl=request.match(/\n  (boolean notes=NotesRoutes\.owns\(path\),automation=notes\|\|AutomationsRoutes\.owns\(path\),[^\n]*;)\n/)[1];
 const gate=request.match(/\n  if\((.*)\)\{\n   call\.reject\("Unsupported local agent request\."\);return;/)[1];
 assert.match(gate,/^\(automation\? \(notes\?!NotesRoutes\.allowed\(path,method\):!AutomationsRoutes\.allowed\(path,method\)\)\|\|expectedOwner==null\|\|expectedOwner\.trim\(\)\.isEmpty\(\):/,'notes routes take the owner-bound branch');
 const directory=mkdtempSync(join(tmpdir(),'alpha-notes-gate-')),harness=join(directory,'NotesGateHarness.java');
 try{
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public final class NotesGateHarness{
${approval}
 static String value(String v){return "${NULL}".equals(v)?null:"${BIG}".equals(v)?"x".repeat(2*1024*1024+1):v;}
 static boolean refused(String path,String method,String body,String expectedOwner){${decl}return ${gate};}
 public static void main(String[] args){StringBuilder out=new StringBuilder();for(int i=0;i<args.length;i+=4)out.append(refused(args[i+1],args[i],value(args[i+2]),value(args[i+3]))?'R':'A');System.out.print(out);}
}`);
  const native=runJvm([nativeSource('NotesRoutes.java'),nativeSource('AutomationsRoutes.java'),harness],'ai.elizaresearch.alphaphone.NotesGateHarness',{args:cases.flatMap(row=>row.slice(0,4))});
  assert.equal(native,cases.map(row=>row[4]?'A':'R').join(''));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('renderer policy mirrors the native route set exactly',()=>{
 for(const [method,path,body,ownerId,admitted] of cases)assert.equal(notesRouteAllowed(path,method)&&ownerId!==NULL&&!!ownerId.trim()&&!(method==='GET'&&body!==NULL)&&body!==BIG,admitted,`${method} ${path}`);
 const source=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/NotesRoutes.java','utf8');
 assert.match(source,/static boolean owns\(String path\)\{return "\/api\/notes\/state"\.equals\(path\)\|\|"\/api\/views\/notes\/interact"\.equals\(path\);\}/);
 assert.match(source,/static boolean allowed\(String path,String method\)\{return \("GET"\.equals\(method\)&&"\/api\/notes\/state"\.equals\(path\)\)\|\|\("POST"\.equals\(method\)&&"\/api\/views\/notes\/interact"\.equals\(path\)\);\}/);
});

test('the local bridge sends the notes routes only with the verified owner and their own method',async()=>{
 const sent=[];const protocol=new LocalAgentProtocol({start:async()=>({}),request:async input=>{sent.push(input);return {status:200,body:'{"success":true}'};}});
 await assert.rejects(protocol.request('/api/notes/state',undefined,new AbortController().signal,{},'GET'),/Invalid local/);
 protocol.session={sessionId:'session',ownerId:owner,agentId:'agent',origin:protocol.origin};
 for(const [method,path,body] of [['GET','/api/notes/state'],['POST','/api/views/notes/interact',{}],['POST','/api/notes/state',{}],['GET','/api/views/notes/interact'],['PUT','/api/views/notes/interact',{}],['GET','/api/notes/state',{}]]){
  const run=protocol.request(path,body,new AbortController().signal,{},method);
  if(notesRouteAllowed(path,method)&&!(method==='GET'&&body))await run;else await assert.rejects(run);
 }
 assert.deepEqual(sent.map(input=>[input.method,input.path,input.ownerId]),[['GET','/api/notes/state',owner],['POST','/api/views/notes/interact',owner]]);
});

test('the development Cloud phone guard admits the same notes routes',async()=>{
 for(const [method,path] of cases){
  const client=new DevelopmentCloudAgentProtocol('production',async()=>{throw Error('unexpected network');},{read:async()=>{throw Error('guard passed');},write:async()=>{},clear:async()=>{}},async()=>{});
  await assert.rejects(client.phoneRequest({agentId:'agent',origin:'https://agent.invalid',userId:'u',organizationId:'o',credentialId:'c',headers:{}},path,new AbortController().signal,method==='GET'?undefined:{},method),new RegExp(notesRouteAllowed(path,method)?'guard passed':'Invalid phone route'),`${method} ${path}`);
 }
});
