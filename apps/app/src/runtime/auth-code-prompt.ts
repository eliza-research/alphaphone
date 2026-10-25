/** Ephemeral user interaction shared by account and delegation authentication.
 * No token, password or code is persisted. Abort/expiry retires the exact prompt. */
export interface AuthCodePrompt { id: number; method: 'totp' | 'sms'; expiresAt: number }
export interface AuthCodeAnswer { value: string; recovery: boolean }
let current: AuthCodePrompt | null = null;
let sequence = 0;
let settle: ((code?: AuthCodeAnswer) => void) | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
export const authCodePrompt = {
  snapshot: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; },
  submit(id: number, code: string, recovery = false) {
    if (current?.id !== id || (recovery ? current.method !== 'totp' || !code.trim() : !/^\d{6}$/.test(code))) return;
    settle?.({value:recovery ? code.trim() : code, recovery});
  },
  cancel(id: number) { if (current?.id === id) settle?.(); },
};
export function requestAuthCode(method: AuthCodePrompt['method'], expiresAt: number, signal: AbortSignal): Promise<AuthCodeAnswer> {
  signal.throwIfAborted();
  if (current) return Promise.reject(new Error('Another sign-in verification is active.'));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return Promise.reject(new Error('Sign-in verification expired.'));
  return new Promise((resolve, reject) => {
    const prompt = {id: ++sequence, method, expiresAt};
    let finished = false;
    const finish = (code?: AuthCodeAnswer) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (current === prompt) {current = null; settle = null; publish();}
      if (signal.aborted) reject(signal.reason);
      else if (Date.now() >= expiresAt) reject(new Error('Sign-in verification expired.'));
      else if (code === undefined) reject(new DOMException('Sign-in cancelled.', 'AbortError'));
      else resolve(code);
    };
    const abort = () => finish();
    const expire = () => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      else finish();
    };
    let timer = setTimeout(expire, Math.min(expiresAt-Date.now(), 2_147_483_647));
    signal.addEventListener('abort', abort, {once:true});
    current = prompt; settle = finish; publish();
    if (signal.aborted) abort();
  });
}
