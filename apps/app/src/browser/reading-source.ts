import {anyAbortSignal} from '../runtime/abort-signal';
import {sensitiveReadingUrl,sensitiveReadingText,sensitiveReadingDocument} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
export type ReadingSource={text:string;truncated:boolean;blocked?:false}|{blocked:true};
/** A bounded public source fetch. The isolated live frame retains its opaque origin. */
export async function browserReadingSource(address:string,signal:AbortSignal):Promise<ReadingSource|undefined>{
 if(sensitiveReadingUrl(address))return {blocked:true};
 const url=new URL(address);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;
 const request=anyAbortSignal([signal,AbortSignal.timeout(5000)]);
 try{
  const response=await fetch(url.href,{signal:request,mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',headers:{Accept:'text/html,text/plain'}});
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!response.ok||!['text/html','text/plain'].includes(type||'')){await response.body?.cancel();return;}
  if(Number(response.headers.get('content-length')||0)>262144){await response.body?.cancel();return {blocked:true};}
  const reader=response.body?.getReader();if(!reader)return;let bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});let source='';
  try{while(true){request.throwIfAborted();const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>262144)return {blocked:true};source+=decoder.decode(next.value,{stream:true});}source+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(type==='text/html'){
   const template=document.createElement('template');template.innerHTML=source;
   if(sensitiveReadingDocument(template.content))return {blocked:true};
   for(const node of template.content.querySelectorAll('script,style,noscript,template,iframe,object,embed,svg,form,input,textarea,select,option,button,frame,nav,aside,header,footer,head,[contenteditable]:not([contenteditable="false"]),[role="navigation"],[role="textbox"],[role="button"],[hidden],[inert],[aria-hidden="true"]'))node.remove();
   for(const node of template.content.querySelectorAll<HTMLElement>('[style]'))if(node.style.display==='none'||node.style.visibility==='hidden')node.remove();
   const target=template.content.querySelector('article,main,[role="main"]')||template.content;
   const parts:string[]=[];const walk=(node:Node)=>{if(node.nodeType===Node.TEXT_NODE){parts.push(node.textContent||'');return;}if(node instanceof Element&&/^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|BR|TR|BLOCKQUOTE|PRE)$/.test(node.tagName))parts.push('\n');for(const child of node.childNodes)walk(child);if(node instanceof Element&&/^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|TR|BLOCKQUOTE|PRE)$/.test(node.tagName))parts.push('\n');};walk(target);source=parts.join('');
  }
  if(type==='text/plain'&&(source.length>20000||sensitiveReadingText(source)))return {blocked:true};
  const text=source.replace(/\r\n?/g,'\n').replace(/[\t \f\v]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();signal.throwIfAborted();if(!text)return;return {text:text.slice(0,5000),truncated:text.length>5000};
 }catch(error){if(signal.aborted)throw error;return;}
}
