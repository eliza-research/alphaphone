import {sourceOf,type Source} from './note-source-adapter';
import {sensitiveReadingUrl} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
export type WebSource={kind:'web-page';version:1;name:string;url:string};
export type RecordingSource={kind:'recording';version:1;name:string;noteId:string;revision:string};
export type SummarySource=Source|WebSource|RecordingSource;
export function recordingSourceOf(value:unknown):RecordingSource|undefined{
 const s=value as RecordingSource|undefined;
 if(!s||s.kind!=='recording'||s.version!==1||typeof s.name!=='string'||!s.name.trim()||s.name.length>120||/[\x00-\x1f\x7f]/.test(s.name)||typeof s.noteId!=='string'||!s.noteId||s.noteId.length>128||/[\x00-\x1f\x7f]/.test(s.noteId)||typeof s.revision!=='string'||!/^[a-f0-9]{64}$/.test(s.revision))return;
 return {kind:'recording',version:1,name:s.name,noteId:s.noteId,revision:s.revision};
}
export async function recordingRevision(note:unknown):Promise<string>{
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(note)));
 return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function webSourceOf(value:unknown):WebSource|undefined{
 const s=value as WebSource|undefined;
 if(!s||s.kind!=='web-page'||s.version!==1||typeof s.name!=='string'||!s.name.trim()||s.name.length>120||/[\x00-\x1f\x7f]/.test(s.name)||typeof s.url!=='string'||s.url.length>4096||/[\x00-\x20\x7f]/.test(s.url))return;
 try{const url=new URL(s.url);if(url.protocol!=='https:'||!url.hostname||url.username||url.password||sensitiveReadingUrl(url.href))return;return {kind:'web-page',version:1,name:s.name,url:url.href};}catch{return;}
}
export function summarySourceOf(value:unknown):SummarySource|undefined{return recordingSourceOf(value)||webSourceOf(value)||sourceOf(value);}
