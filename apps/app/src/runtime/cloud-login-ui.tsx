import { useEffect, useRef, useState } from 'react';
import { CloudLogin, type LoginChallenge, type LoginMethod, type LoginMethods, type LoginResult } from './cloud-login';
import { nativeCaptchaVerifier } from './native-captcha';
import { nativeCloudRequest } from './native-connection';
import type { CloudEnvironment } from './cloud-protocol';

export function CloudLoginOptions({environment, busy, google, complete}: {environment:CloudEnvironment; busy:boolean; google:()=>void; complete:(token:string)=>Promise<void>}) {
  const [methods,setMethods]=useState<LoginMethods|null>(null), [error,setError]=useState(''), [working,setWorking]=useState(false);
  const [method,setMethod]=useState<LoginMethod>('email'), [address,setAddress]=useState(''), [code,setCode]=useState(''), [recovery,setRecovery]=useState(false);
  const [challenge,setChallenge]=useState<LoginChallenge|null>(null), [mfa,setMfa]=useState<Extract<LoginResult,{mfa:unknown}>['mfa']|null>(null);
  const operation=useRef<AbortController|null>(null);
  const client=new CloudLogin(environment,nativeCloudRequest,nativeCaptchaVerifier(environment));
  useEffect(()=>{const c=new AbortController();void new CloudLogin(environment,nativeCloudRequest).methods(c.signal).then(value=>{if(!c.signal.aborted){setMethods(value);if(!value.email&&value.sms)setMethod('sms');}}).catch(()=>{if(!c.signal.aborted)setError('Sign-in options are unavailable. Close and reopen sign-in to retry.');});return()=>{c.abort();operation.current?.abort();};},[environment]);
  const reset=()=>{operation.current?.abort();operation.current=null;setWorking(false);setChallenge(null);setMfa(null);setCode('');setRecovery(false);setError('');};
  async function submit(){
    if(operation.current||busy)return;
    const c=new AbortController();operation.current=c;setWorking(true);setError('');
    try {
      if(!challenge&&!mfa){const next=await client.send(method,address,c.signal);c.signal.throwIfAborted();setChallenge(next);}
      else {
        const result=mfa?await client.completeMfa(mfa,code,c.signal,recovery):await client.verify(challenge!,code,c.signal);
        c.signal.throwIfAborted();setCode('');
        if('mfa' in result){setMfa(result.mfa);setRecovery(false);}
        else {await complete(result.token);c.signal.throwIfAborted();setChallenge(null);setMfa(null);setAddress('');}
      }
    }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Sign-in failed.');}
    finally{if(operation.current===c){operation.current=null;setWorking(false);}}
  }
  const disabled=busy||working;
  return <section className="alpha-sign-in-action">
    {!methods&&!error&&<p role="status">Loading sign-in options…</p>}
    {methods?.google&&<><button disabled={disabled} onClick={()=>{reset();google();}}>Continue with Google</button><p>Google opens its secure account chooser, then returns you here. Continuing authorizes this phone to access your Cloud account.</p></>}
    {methods&&(methods.email||methods.sms)&&<details><summary>Other sign-in options</summary>
      <form onSubmit={e=>{e.preventDefault();void submit();}}>
        {!challenge&&!mfa?<>
          <label>Sign-in method<select value={method} disabled={disabled} onChange={e=>{setMethod(e.target.value as LoginMethod);setAddress('');setError('');}}>
            {methods.email&&<option value="email">Email</option>}{methods.sms&&<option value="sms">Phone</option>}
          </select></label>
          <label>{method==='email'?'Email address':'Phone number'}<input type={method==='email'?'email':'tel'} autoComplete={method==='email'?'email':'tel'} value={address} onChange={e=>setAddress(e.target.value)} disabled={disabled} required/></label>
          <button disabled={disabled||!methods[method]}>Send code</button>
          {methods.captchaRequired.includes(method)&&<p>A verification check will open in the app before sending your code.</p>}
        </>:<><p>{recovery?'Enter an unused recovery code from your authenticator setup.':mfa?(mfa.type==='totp'?'Enter the code from your authenticator.':'Enter the SMS verification code.'):`Enter the code sent to ${challenge!.address}.`}</p>
          <label>{recovery ? 'Recovery code' : 'Verification code'}<input inputMode={recovery ? 'text' : 'numeric'} autoComplete={recovery ? 'off' : 'one-time-code'} pattern={recovery ? undefined : '[0-9]{6}'} maxLength={recovery ? undefined : 6} value={code} onChange={e=>setCode(e.target.value)} disabled={disabled} required/></label>
          <button disabled={disabled}>Verify and sign in</button>
          {mfa?.type==='totp'&&<button type="button" disabled={disabled} onClick={()=>{setCode('');setRecovery(!recovery);setError('');}}>{recovery?'Use authenticator code':'Use a recovery code'}</button>}</>}
      </form>
      {(working||challenge||mfa)&&!busy&&<button onClick={reset}>Cancel code sign-in</button>}
    </details>}
    {methods&&!methods.google&&!methods.email&&!methods.sms&&<p>No supported sign-in methods are enabled.</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
