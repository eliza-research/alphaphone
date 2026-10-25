import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SignInView } from './connection-ui';

/**
 * Alpha's own Eliza Cloud sign-in screens: Google (a Custom Tab that returns to Alpha), or an email
 * code typed here, then a second verification when the account has one. No Eliza Cloud web page.
 * Codes go straight to the controller and are never kept in component state after submission.
 */
export interface CloudSignInActions {
  google(): void; email(address: string): void; verify(code: string): void; resend(): void; cancel(): void;
}
export function AlphaAuthBrand() {
  return <div className="alpha-auth-brand"><span className="alpha-auth-mark" aria-hidden="true"/><span className="serif">Alpha</span></div>;
}
export function CloudSignInPanel({ view, busy, google, message, error, errorIsNotice = false, actions, extra }: {
  view: SignInView; busy: boolean; google: boolean; message: string; error: string; actions: CloudSignInActions;
  errorIsNotice?: boolean;
  /** Optional hosted sign-in entry supplied by the caller's build gate. */
  extra?: ReactNode;
}) {
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
    <AlphaAuthBrand/>
    <header><h1 id="cloud-sign-in-title" className="serif">{view.step === 'choose' ? 'Welcome to Alpha.' : view.step === 'google' ? 'Continue with Google' : 'Check your code.'}</h1></header>
    {view.step === 'choose' && <>
      <p className="alpha-auth-intro">Use your Eliza Cloud account to sign in.</p>
      <div className="alpha-connection-actions alpha-auth-google"><button disabled={busy || !google} onClick={actions.google} aria-describedby={!google ? 'alpha-google-unavailable' : undefined}><span aria-hidden="true" className="alpha-google-icon"/>Continue with Google</button></div>
      {!google && !busy && <p id="alpha-google-unavailable" className="alpha-auth-method-note">Google sign-in is unavailable on this device right now. You can continue with email.</p>}
      <div className="alpha-auth-divider"><span>or sign in with email</span></div>
      <form className="alpha-cloud-sign-in-email" aria-label="Sign in with email" onSubmit={event => { event.preventDefault(); actions.email(email.current?.value || ''); }}>
        <label>Email<input ref={email} type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={320} required disabled={busy} /></label>
        <button disabled={busy}>Email me a code</button>
      </form>
    </>}
    {view.step === 'google' && <p>Choose your Google account in the Android sign-in sheet. Alpha will finish signing you in.</p>}
    {(view.step === 'code' || view.step === 'mfa') && <form className="alpha-cloud-sign-in-code" aria-label={view.step === 'code' ? 'Enter your email code' : 'Enter your verification code'} onSubmit={submitCode}>
      {view.step === 'code' && <p>Enter the six-digit code sent to <strong>{view.email}</strong>.</p>}
      {view.step === 'mfa' && <p>{view.method === 'totp' ? 'This account uses an authenticator app. Enter its six-digit code.' : view.method === 'sms' ? 'Enter the six-digit code sent to your phone.' : 'This account’s second verification is not available in Alpha yet.'}</p>}
      {(view.step === 'code' || view.method !== 'passkey') && <>
        <label>Six-digit code<input ref={code} name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 -]{6,9}" maxLength={9} required disabled={busy} /></label>
        <button disabled={busy}>Verify</button>
      </>}
      {view.step === 'code' && <button type="button" disabled={busy || wait > 0} onClick={actions.resend}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role={errorIsNotice ? 'status' : 'alert'} className={errorIsNotice ? 'alpha-auth-notice' : 'alpha-connection-error'}>{error}</p>}
    <div className="alpha-connection-actions">
      <button className="alpha-connection-cancel" onClick={actions.cancel}>{view.step === 'choose' && !busy ? 'Back' : 'Cancel sign-in'}</button>
      {view.step === 'choose' && extra}
    </div>
  </>;
}
