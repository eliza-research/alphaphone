import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const root=resolve(import.meta.dirname,'../..');
const text=file=>readFileSync(resolve(root,file),'utf8');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
/** Runs the real policy and native header detector; replaces only the platform facts. */
function imageSource(platform='web',headers=[]){
 const file='apps/app/src/runtime/aosp-image.ts';
 let native=ts(text(file).replace("import { Capacitor } from '@capacitor/core';",`const Capacitor={getPlatform:()=>${JSON.stringify(platform)},PluginHeaders:${JSON.stringify(headers)}};`));
 native=native.replace(/from ['"]@elizaos\/capacitor-system\/sense['"]/,`from '${data(ts(text('.eliza/client-features/plugins/plugin-native-system/src/sense.ts')))}'`);
 return native.replace(/(\bfrom\s*)(['"])(\.\.?\/[^'"]+)\2/g,(_,prefix,quote,spec)=>`${prefix}${quote}${pathToFileURL(resolve(root,dirname(file),spec)).href}${quote}`);
}
export async function aospImageModule(){return import(data(imageSource()));}
