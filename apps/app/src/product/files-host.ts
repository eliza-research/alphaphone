import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { filesIndex } from '../prototype/files-index';
import {bindNativeFilesPorts,nativeFilesAvailable,type FilesHost} from './files-upstream';

/** Bind the one installed Files engine. No new storage, selection registry or effect owner. */
export function createAlphaFilesHost(ports:Pick<FilesHost,'isCurrent'|'context'|'ask'|'email'|'scan'>={}):FilesHost|undefined {
 const native=Capacitor.isNativePlatform();
 const methods=(Capacitor as typeof Capacitor & {PluginHeaders?:readonly {name:string;methods:readonly {name:string}[]}[]}).PluginHeaders?.find(header=>header.name==='AlphaFiles')?.methods;
 if(native&&!nativeFilesAvailable(methods))return undefined;
 const files=registerPlugin<FilesHost['tree'] & FilesHost['documents']>('AlphaFiles');
 const bound=native?bindNativeFilesPorts(files,methods):{tree:files,documents:files};
 if(!bound)return undefined;
 return {
  label:Capacitor.isNativePlatform()?'This device':'App files',source:Capacitor.isNativePlatform()?'device':'browser',
  ...bound,recent:filesIndex,...ports,
  previewUrl(value){
   if(Capacitor.isNativePlatform())return /^content:\/\//.test(value)||/^file:\/\/\/[^?#]*\/cache\/document-[a-f0-9-]+\.png$/.test(value)?Capacitor.convertFileSrc(value):undefined;
   try{const url=new URL(value);return url.protocol==='blob:'&&url.origin===location.origin?value:undefined;}catch{return undefined;}
  },
 };
}
