import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authCodePrompt } from './auth-code-prompt';

/** Browser/Android WebView modal; showModal makes the underlying app inert. */
export function AuthCodeDialog() {
  const prompt=useSyncExternalStore(authCodePrompt.subscribe,authCodePrompt.snapshot);
  const dialog=useRef<HTMLDialogElement>(null), [code,setCode]=useState(''), [recovery,setRecovery]=useState(false);
  useEffect(()=>{
    const element=dialog.current;
    if(!prompt||!element)return;
    setCode('');setRecovery(false);element.showModal();
    return()=>{element.close();};
  },[prompt?.id]);
  if(!prompt)return null;
  return <dialog ref={dialog} className="alpha-auth-code-dialog" aria-labelledby="auth-code-title" onCancel={event=>{event.preventDefault();authCodePrompt.cancel(prompt.id);}}>
    <h2 id="auth-code-title">Verify your account</h2>
    <p>{recovery?'Enter an unused recovery code from your authenticator setup.':prompt.method==='totp'?'Enter the code from your authenticator.':'Enter the SMS verification code.'}</p>
    <form onSubmit={event=>{event.preventDefault();authCodePrompt.submit(prompt.id,code,recovery);setCode('');}}>
      <label>{recovery ? 'Recovery code' : 'Verification code'}<input autoFocus inputMode={recovery ? 'text' : 'numeric'} autoComplete={recovery ? 'off' : 'one-time-code'} pattern={recovery ? undefined : '[0-9]{6}'} maxLength={recovery ? undefined : 6} value={code} onChange={event=>setCode(event.target.value)} required/></label>
      <button type="submit">Continue sign-in</button>
      {prompt.method==='totp'&&<button type="button" onClick={()=>{setCode('');setRecovery(!recovery);}}>{recovery?'Use authenticator code':'Use a recovery code'}</button>}
      <button type="button" onClick={()=>{setCode('');authCodePrompt.cancel(prompt.id);}}>Cancel verification</button>
    </form>
  </dialog>;
}
