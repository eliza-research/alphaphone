import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { filesIndex } from '../prototype/files-index';
import type { FilesHost } from './files-upstream';

/** Bind the one installed Files engine. No new storage, selection registry or effect owner. */
export function createAlphaFilesHost(ports:Pick<FilesHost,'isCurrent'|'context'|'ask'|'email'|'scan'>={}):FilesHost|undefined {
 if(Capacitor.isNativePlatform()){
  const methods=(Capacitor as typeof Capacitor & {PluginHeaders?:readonly {name:string;methods:readonly {name:string}[]}[]}).PluginHeaders?.find(header=>header.name==='AlphaFiles')?.methods;
  const required=['choose','chooseFile','cancelPicker','list','createFolder','rename','delete','move','changeMany','shareMany','select','forget','describeSelected','readSelected','pdfSelected','renameSelected','openSelected','shareSelected','forgetSelected'];
  if(!required.every(name=>methods?.some(method=>method.name===name)))return undefined;
 }
 const files=registerPlugin<FilesHost['tree'] & FilesHost['documents']>('AlphaFiles');
 return {
  label:Capacitor.isNativePlatform()?'This device':'App files',source:Capacitor.isNativePlatform()?'device':'browser',
  tree:files,documents:files,recent:filesIndex,...ports,
  previewUrl(value){
   if(Capacitor.isNativePlatform())return /^content:\/\//.test(value)||/^file:\/\/\/[^?#]*\/cache\/document-[a-f0-9-]+\.png$/.test(value)?Capacitor.convertFileSrc(value):undefined;
   try{const url=new URL(value);return url.protocol==='blob:'&&url.origin===location.origin?value:undefined;}catch{return undefined;}
  },
 };
}
