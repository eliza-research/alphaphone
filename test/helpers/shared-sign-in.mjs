import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const compiled=buildSync({stdin:{contents:'export {CloudSignInPanel} from "./apps/app/src/runtime/cloud-sign-in-ui.tsx"; export {NativeCloudSignInController} from "@elizaos/ui/android-cloud/native-cloud-sign-in-controller";',resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'undefined'},external:['react','react/jsx-runtime'],loader:{'.css':'empty'}}).outputFiles[0].text;
const module={exports:{}};new Function('require','module','exports',compiled)(require,module,module.exports);
export const {CloudSignInPanel,NativeCloudSignInController}=module.exports;
export function signInFixture(overrides={}){
 let attempts=0,activated=0,abandoned=0;
 const port={status:async()=>({inApp:true,methodsKnown:true,email:true,phone:true,google:true}),startGoogle:async()=>({status:'authenticated',environment:'production',expiresAt:Date.now()+60000}),startEmail:async()=>({attemptId:`12345678-1234-4234-8234-${String(++attempts).padStart(12,'0')}`,expiresAt:Date.now()+600000,resendAt:Date.now()+30000}),startPhone:async()=>({attemptId:`12345678-1234-4234-8234-${String(++attempts).padStart(12,'0')}`,expiresAt:Date.now()+600000,resendAt:Date.now()+30000}),verifyEmail:async()=>({status:'authenticated',environment:'production',expiresAt:Date.now()+60000}),verifyPhone:async()=>({status:'authenticated',environment:'production',expiresAt:Date.now()+60000}),verifyMfa:async()=>({status:'authenticated',environment:'production',expiresAt:Date.now()+60000}),cancel:async()=>{},...overrides};
 const controller=new NativeCloudSignInController(port,{environment:'production',current:()=>true,activate:()=>{activated++;},abandoned:()=>{abandoned++;}});
 return {controller,port,activated:()=>activated,abandoned:()=>abandoned,props:{controller,dismissible:false,message:'',error:'',errorIsNotice:false}};
}
