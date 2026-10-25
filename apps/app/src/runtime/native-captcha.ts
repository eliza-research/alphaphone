import { registerPlugin } from '@capacitor/core';
import type { CloudEnvironment } from './cloud-protocol';
import type { CaptchaVerifier } from './cloud-login';
const native = registerPlugin<{
  verify(input:{requestId:string;environment:CloudEnvironment;provider:string;siteKey:string;action:string}):Promise<{token:string}>;
  cancel(input:{requestId:string}):Promise<void>;
}>('AlphaCaptcha');
/** The verification WebView has no Capacitor bridge. Tokens exist only for this send. */
export function nativeCaptchaVerifier(environment:CloudEnvironment):CaptchaVerifier {
  return async (request,signal)=>{
    signal.throwIfAborted();
    const requestId=crypto.randomUUID();
    let rejectAbort:(reason:unknown)=>void=()=>{};
    const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
    const cancel=()=>{void native.cancel({requestId}).catch(()=>{});rejectAbort(signal.reason||new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',cancel,{once:true});
    try {
      const pending=native.verify({requestId,environment,...request});
      if(signal.aborted)cancel();
      const result=await Promise.race([pending,aborted]);signal.throwIfAborted();return result.token;
    } finally {signal.removeEventListener('abort',cancel);}
  };
}
