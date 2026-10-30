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
export async function mobileViewFeatures(image=false,dev=false){
 const headers=image?[{name:'AlphaTelephony',methods:[{name:'imageCapability'}]}]:[];
 const native=imageSource('android',headers);
 let source=ts(text('apps/app/src/prototype/mvp-features.ts'))
 .replace(/from ['"]\.\.\/browser\/dev-profile['"]/,`from '${data(`export const browserDevProfile=${dev};`)}'`)
 .replace(/from ['"]\.\.\/runtime\/aosp-image['"]/,`from '${data(native)}'`)
 .replace(/from ['"]@elizaos\/ui\/mobile-shell\/core['"]/,`from '${data(ts(text('.eliza/client-features/packages/ui/src/mobile-shell/view-policy.ts')))}'`);
 const result=await import(data(source+`\n//${image}:${dev}`));
 const model=text('apps/app/src/prototype/model.js');
 for(const match of model.matchAll(/registerView\("([a-z]+)", \{([\s\S]*?)(?=\nregisterView\(|$)/g))result.registerMobileCompatibilityView(match[1],!/^\s*prototypeOnly: true/m.test(match[2]));
 return result;
}
