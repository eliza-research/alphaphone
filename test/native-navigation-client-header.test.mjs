import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeSource,runJvm,jsonJarSkip,upstreamConnection} from './fixtures/jvm-tools.mjs';

// Execute the actual production raw forwarding method and stream allowlist.
// The JVM service port echoes the request; no enrollment, network or stored credential is used.
test('native JSON and chat-stream forwarding preserve the canonical renderer ID without forwarding authority headers',{skip:jsonJarSkip},()=>{
 const source=fs.readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const start=source.indexOf(' private static JSONObject raw('),end=source.indexOf(' private static JSONObject json(',start);
 assert.ok(start>=0&&end>start,'actual raw request method');
 const raw=source.slice(start,end);
 assert.match(raw,/NativeOwnerTransport\.requestHeaders\(supplied,path,method\)/);
 const stream=source.slice(source.indexOf(' @PluginMethod public void requestStream('),source.indexOf(' /** A single ephemeral voice-only feed'));
 const streamStart=stream.indexOf('if(supplied!=null)for(');assert.ok(streamStart>=0,'stream header allowlist');
 const streamBody=stream.slice(streamStart,stream.indexOf('\n',streamStart));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-navigation-header-'));
 try{const file=path.join(dir,'NativeHeaderTest.java');fs.writeFileSync(file,`package ai.elizaresearch.alphaphone;
import org.json.*;
import ai.eliza.plugins.agent.connection.NativeOwnerTransport;
public class NativeHeaderTest{
 static class ElizaAgentService { static String requestLocalAgent(String request) { return request; } }
 ${raw}
 static JSONObject copy0(JSONObject supplied)throws Exception{return raw("/api/status","GET",null,"synthetic-owner",supplied,1000).getJSONObject("headers");}
 static JSONObject copy1(JSONObject supplied)throws Exception{JSONObject headers=new JSONObject().put("Authorization","Bearer synthetic-owner");${streamBody};return headers;}
 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 public static void main(String[]args)throws Exception{
  for(int i=0;i<2;i++){
   JSONObject supplied=new JSONObject().put("X-ElizaOS-Client-Id","renderer-1._").put("X-Eliza-Device-Id","device-1").put("Authorization","Bearer forged").put("X-Other","no");
   JSONObject out=i==0?copy0(supplied):copy1(supplied);
   check("renderer-1._".equals(out.optString("X-ElizaOS-Client-Id")),"Canonical renderer ID dropped in path "+i);
   check("device-1".equals(out.optString("X-Eliza-Device-Id")),"Device header lost");
   check("Bearer synthetic-owner".equals(out.optString("Authorization"))&&!out.has("X-Other"),"Caller expanded header authority");
   for(String invalid:new String[]{"bad id","bad\\r\\nheader","",new String(new char[129]).replace('\\0','a')}){
    boolean rejected=false;try{JSONObject bad=new JSONObject().put("X-ElizaOS-Client-Id",invalid);if(i==0)copy0(bad);else copy1(bad);}catch(IllegalArgumentException expected){rejected=true;}
    check(rejected,"Invalid renderer identity admitted in path "+i);
   }
  }
  System.out.println("PASS canonical renderer ID in both paths; invalid IDs and caller authority refused");
 }
}`);assert.match(runJvm([upstreamConnection('OwnerRoutePolicy.java'),upstreamConnection('NativeAppReadPolicy.java'),upstreamConnection('NativeAppRequestPolicy.java'),upstreamConnection('NativeOwnerTransport.java'),file],'ai.elizaresearch.alphaphone.NativeHeaderTest',{json:true}),/^PASS canonical renderer/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
