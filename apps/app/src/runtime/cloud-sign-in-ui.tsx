import {productionCloud,stagingCloud} from './cloud-deployment.generated';
import type {CloudServiceInfo} from './cloud-service-info';
import type {CloudEnvironment} from './cloud-protocol';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';

/**
 * Alpha's own Eliza Cloud sign-in screens: Google (a Custom Tab that returns to Alpha), or an email
 * code typed here, then a second verification when the account has one. No Eliza Cloud web page.
 * Codes go straight to the controller and are never kept in component state after submission.
 */
export interface CloudSignInActions {
  phone?(number: string): void; google(): void; email(address: string): void; verify(code: string): void; resend(): void; cancel(): void;
}
export function CloudSignInPanel({ view, busy, google, phone, emailEnabled = true, message, error, actions, extra, serviceLoader }: {
  view: SignInView; busy: boolean; google: boolean; phone?: boolean; emailEnabled?: boolean; message: string; error: string; actions: CloudSignInActions;
  /** Optional hosted sign-in entry supplied by the caller's build gate. */
  extra?: ReactNode;
  serviceLoader?: (environment: CloudEnvironment) => Promise<CloudServiceInfo>;
}) {
  const [service,setService]=useState<CloudServiceInfo|null>(null),[serviceError,setServiceError]=useState(false),[retry,setRetry]=useState(0);
  const [legal,setLegal]=useState<'terms'|'privacy'|null>(null);
  const legalHeading=useRef<HTMLHeadingElement>(null),legalTrigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    let current=true;setService(null);setServiceError(false);setLegal(null);
    if(serviceLoader)void serviceLoader(view.environment).then(value=>{if(current)setService(value);},()=>{if(current)setServiceError(true);});
    return ()=>{current=false;};
  },[serviceLoader,view.environment,retry]);
  useEffect(()=>{if(legal)legalHeading.current?.focus();else legalTrigger.current?.focus();},[legal]);
  const phoneInput = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null), code = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  // Resend becomes available when the host's cooldown ends; the countdown is the only timer.
  useEffect(() => {
    if (view.step !== 'code') return;
    // The owner may spend minutes entering an address before this panel reaches the code step.
    // Start the displayed cooldown from the host's new deadline, not this component's mount time.
    setNow(Date.now());
    if (view.resendAt <= Date.now()) return;
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= view.resendAt) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [view]);
  useEffect(() => {
    // Disabled inputs lose focus during verification. Restore it for a wrong-code retry too.
    if (!busy) (view.step === 'code' || view.step === 'mfa' ? code : view.step === 'choose' ? email : null)?.current?.focus();
  }, [view.step, busy]);
  const wait = view.step === 'code' ? Math.max(0, Math.ceil((view.resendAt - now) / 1000)) : 0;
  const submitCode = (event: FormEvent) => { event.preventDefault(); const input = code.current; const value = input?.value || ''; if (input) input.value = ''; actions.verify(value); };
  return <>
    <header><h1 id="cloud-sign-in-title" className="serif">Sign in to {service?.name || (view.environment==='staging'?stagingCloud:productionCloud).name}</h1></header>
    <div hidden={legal !== null}>
    {view.step === 'choose' && <>
      {!google && !phone && !emailEnabled && <p role="status">This service offers no sign-in method supported by this app. Contact the service administrator.</p>}
      <p>Sign in to {service?.name || (view.environment==='staging'?stagingCloud:productionCloud).name} to use AI. Your agent keeps running on this device.</p>
      <p role="note">By continuing, you allow Alpha Phone to access your account and use this service on this device. You can sign out in Settings.</p>
      {google && <div className="alpha-connection-actions"><button disabled={busy} onClick={actions.google}>Continue with Google</button></div>}
      {emailEnabled && <form className="alpha-cloud-sign-in-email" aria-label="Sign in with email" onSubmit={event => { event.preventDefault(); actions.email(email.current?.value || ''); }}>
        <label>Email<input ref={email} type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={320} required disabled={busy} /></label>
        <button disabled={busy}>Email me a code</button>
      </form>}
      {phone && <form aria-label="Sign in with phone" onSubmit={event => { event.preventDefault(); actions.phone?.(phoneInput.current?.value || ''); }}>
        <label>Phone number with country code<input ref={phoneInput} type="tel" name="phone" autoComplete="tel" placeholder="+14155550100" maxLength={16} required disabled={busy} /></label>
        <button disabled={busy}>Text me a code</button>
      </form>}
    </>}
    {view.step === 'google'  && <p>Choose your Google account in the window that opened. When Google returns you to Alpha, sign-in finishes here.</p>}
    {(view.step === 'code' || view.step === 'mfa') && <form className="alpha-cloud-sign-in-code" aria-label={view.step === 'code' ? view.phone ? 'Enter your phone code' : 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p>Enter the six-digit code sent to <strong>{view.phone || view.email}</strong>.</p>}
      {view.step === 'mfa' && <p>{view.method === 'totp' ? 'This account uses an authenticator app. Enter its six-digit code.' : view.method === 'sms' ? 'Enter the six-digit code sent to your phone.' : 'This account’s second verification is not available in Alpha yet.'}</p>}
      {(view.step === 'code' || view.method !== 'passkey') && <>
        <label>Six-digit code<input ref={code} name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy} /></label>
        <button disabled={busy}>Verify</button>
      </>}
      {view.step === 'code' && <button type="button" disabled={busy || wait > 0} onClick={actions.resend}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="alpha-connection-error">{error}</p>}
    <div className="alpha-connection-actions">
      <button className="alpha-connection-cancel" onClick={actions.cancel}>{view.step === 'choose' && !busy ? 'Back' : 'Cancel sign-in'}</button>
      {view.step === 'choose' && extra}
    </div>
    {service && <p>Service documents: <button type="button" disabled={busy} onClick={event=>{legalTrigger.current=event.currentTarget;setLegal('terms');}}>Terms of Service</button> and <button type="button" disabled={busy} onClick={event=>{legalTrigger.current=event.currentTarget;setLegal('privacy');}}>Privacy Policy</button>.</p>}
    {serviceError && <p role="status">Service information is unavailable. <button type="button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>Retry service information</button></p>}
    </div>
    {legal && service && <section aria-labelledby="cloud-legal-title" className="alpha-cloud-legal">
      <button type="button" onClick={()=>setLegal(null)}>Back to sign-in</button>
      <h2 id="cloud-legal-title" tabIndex={-1} ref={legalHeading}>{service[legal].title}</h2>
      <p>{service.name} · Revision {service[legal].revision}</p>
      {service[legal].sections.map((section,index)=><section key={index}><h3>{section.title}</h3>{section.paragraphs.map((paragraph,i)=><p key={i} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{paragraph}</p>)}</section>)}
      <button type="button" onClick={()=>setLegal(null)}>Return to sign-in</button>
    </section>}
  </>;
}
