/** Private Google tool transport shared by browser and signed native hosts. */
import type {IncomingMessage,ServerResponse} from 'node:http';
import {CalendarAgentWriteRefused} from '../vendor/eliza/plugins/plugin-calendar/src/service/managed-calendar-host.ts';
import type {createManagedGoogleAgentHost} from './managed-google-agent-host.ts';
export function createManagedGoogleAgentBroker(options:{host:ReturnType<typeof createManagedGoogleAgentHost>;authorized(value:string|undefined):Promise<boolean>}){
 const reader=options.host;
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const controller=new AbortController();const closed=()=>{if(!res.writableEnded)controller.abort();};res.once('close',closed);
  try{
   if(req.method!=='POST'||!['','/','/__alpha-owner-gmail'].includes(req.url||'')||req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')){send(403,{error:'Private agent request required'});return;}
   if(!await options.authorized(req.headers.authorization)){send(401,{error:'Agent authentication required'});return;}
   const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){const part=Buffer.from(chunk);bytes+=part.length;if(bytes>256*1024)throw Error('Agent request too large');chunks.push(part);}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['limit','query','since','messageId','calendar','send','mailbox'].includes(key))||input.query!==undefined&&(typeof input.query!=='string'||input.query.length>4096)||input.since!==undefined&&typeof input.since!=='string'||input.send===undefined&&bytes>8192)throw Error('Invalid Google tool request');
   controller.signal.throwIfAborted();
   let result:unknown;
   if(input.mailbox!==undefined){
    if(Object.keys(input).length!==1||!input.mailbox||typeof input.mailbox!=='object'||Array.isArray(input.mailbox)||Object.keys(input.mailbox).sort().join()!=='kind,messageId,requestId'||['kind','messageId','requestId'].some(k=>typeof input.mailbox[k]!=='string'))throw Error('Invalid mailbox operation');
    result={mailbox:await reader.mailbox(input.mailbox,controller.signal)};
   }else if(input.send!==undefined){
    if(Object.keys(input).length!==1||!input.send||typeof input.send!=='object'||Array.isArray(input.send))throw Error('Invalid send operation');
    const s=input.send,keys=Object.keys(s).sort().join();
    if(s.operation==='prepare'&&keys==='bodyText,operation,requestId,subject,to')result={send:await reader.prepareSend(s,controller.signal)};
    else if(s.operation==='dispatch'&&keys==='bodyText,id,operation,reviewDigest,subject,to')result={send:await reader.dispatchSend(s,controller.signal)};
    else if(s.operation==='receipt'&&keys==='id,operation'&&typeof s.id==='string')result={send:await reader.sendReceipt(s.id,controller.signal)};
    else throw Error('Unsupported send operation');
   }else if(input.calendar!==undefined){
    if(Object.keys(input).length!==1||!input.calendar||typeof input.calendar!=='object'||Array.isArray(input.calendar))throw Error('Invalid Calendar read');
    const c=input.calendar;
    if(['write-capabilities','write-target','write-execute'].includes(c.operation))result=await reader.calendarWrite(c,controller.signal);
    else if(c.operation==='sources'&&Object.keys(c).length===1)result={calendars:await reader.calendarSources(controller.signal)};
    else if(c.operation==='feed'&&Object.keys(c).sort().join()===['operation','grantId','calendarId','timeMin','timeMax','timeZone'].sort().join()&&['grantId','calendarId','timeMin','timeMax','timeZone'].every(key=>typeof c[key]==='string'&&c[key].length<=1024))result={feed:await reader.calendarFeed(c,controller.signal)};
    else throw Error('Unsupported Calendar operation');
   }else if(input.messageId!==undefined){if(typeof input.messageId!=='string'||Object.keys(input).length!==1)throw Error('Invalid exact-message read');result={message:await reader.message(input.messageId,controller.signal)};}else result={items:await reader.list(input,controller.signal)};
   controller.signal.throwIfAborted();const body=JSON.stringify(result);if(Buffer.byteLength(body)>256*1024)throw Error('Gmail result too large');
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);
  }catch(error){
   if(error instanceof CalendarAgentWriteRefused&&!res.writableEnded&&!res.destroyed){send(200,{calendarFailure:error.refusal});return;}
   const failure=error as {code?:unknown;status?:unknown;data?:{error?:unknown}}|null;
   const unavailable=failure?.code==='http'&&failure.status===404&&failure.data?.error==='Not found';
   if(!res.writableEnded&&!res.destroyed)send(409,{error:'Google request could not be verified. Check the current account, permissions, and any saved operation receipt before retrying.',...(unavailable?{reason:'provider-route-unavailable'}:{})});
  }
  finally{res.removeListener('close',closed);}
 };
}
