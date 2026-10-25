import { parseLoginResult, type LoginResult } from './cloud-login.ts';
import { cloudCredentialSlot, cloudDeployment } from './cloud-deployment.ts';
import type { CloudEnvironment, CloudNativeRequest } from './cloud-protocol';

/** Alpha-owned presentation; only backend endpoints participate in authentication. */
export const alphaAuthConfig = (environment: CloudEnvironment) => ({
  ...cloudDeployment(environment),
  redirect: `https://alphacompute.ai/alphaphone/auth/${environment === 'staging' ? 'staging/' : ''}callback`,
});
export interface AlphaAuthPending { environment: CloudEnvironment; state: string; verifier: string; expiresAt: number; purpose?: string; deployment?: string }
export interface AlphaAuthHost {
  read(): Promise<AlphaAuthPending | null>;
  write(value: AlphaAuthPending): Promise<void>;
  clear(): Promise<void>;
  open(url: string): Promise<void>;
  callback(): Promise<string | null>;
  clearCallback(): Promise<void>;
  completeMfa?(challenge: Extract<LoginResult, {mfa:unknown}>['mfa'], signal: AbortSignal): Promise<string>;
}
export class AlphaAuthError extends Error {
  readonly code: 'unavailable' | 'expired' | 'denied' | 'invalid-response';
  constructor(code: AlphaAuthError['code']) { super(`Alpha Phone sign-in ${code}`); this.code = code; }
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function random() { return base64(crypto.getRandomValues(new Uint8Array(32))); }
export function validPending(value: AlphaAuthPending | null): value is AlphaAuthPending {
  return !!value && ['production', 'staging'].includes(value.environment) && /^[A-Za-z0-9_-]{43}$/.test(value.state) && /^[A-Za-z0-9_-]{43}$/.test(value.verifier) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 600_000;
}
/** Success arrives in a fragment; the backend's error recovery uses a query. Never accept both. */
export function parseAlphaAuthCallback(raw: string, pending: AlphaAuthPending): { code?: string; error?: string } | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const config = alphaAuthConfig(pending.environment);
  const expected = new URL(config.redirect);
  const https = url.origin === expected.origin && url.pathname === expected.pathname;
  const fallback = url.protocol === 'alphaphone:' && url.hostname === 'auth' && url.pathname === `/${pending.environment}`;
  if ((!https && !fallback) || url.username || url.password || url.port || (url.search && url.hash)) return null;
  const params = new URLSearchParams((url.hash || url.search).slice(1));
  const keys = [...params.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || params.get('state') !== pending.state) return null;
  if (params.has('code') && /^[A-Za-z0-9_-]{43}$/.test(params.get('code')!)) return { code: params.get('code')! };
  if (params.has('error') && /^[a-z0-9_]{1,100}$/.test(params.get('error')!)) return { error: 'denied' };
  return null;
}
function pause(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 300);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Single caller is enforced by CloudProtocol. Pending PKCE lives in encrypted native storage,
 * allowing a cold Activity callback to resume. Credentials never travel in callback URLs. */
export async function authenticateAlpha(environment: CloudEnvironment, request: CloudNativeRequest, host: AlphaAuthHost, signal: AbortSignal, purpose = 'account'): Promise<string> {
  signal.throwIfAborted();
  let pending = await host.read();
  signal.throwIfAborted();
  // A different operation must never consume or replace another operation's PKCE return.
  if (validPending(pending) && (pending.environment !== environment || (pending.purpose ?? 'account') !== purpose)) throw new AlphaAuthError('unavailable');
  const deployment = JSON.stringify([cloudDeployment(environment).api, cloudDeployment(environment).tenant]);
  if (validPending(pending) && (pending.deployment !== undefined ? pending.deployment !== deployment : cloudCredentialSlot(environment) !== `cloud:${environment}`)) throw new AlphaAuthError('unavailable');
  const resume = validPending(pending) && pending.environment === environment;
  if (!resume) pending = { environment, state: random(), verifier: random(), expiresAt: Date.now() + 600_000, purpose, deployment };
  const attempt = pending!;
  const config = alphaAuthConfig(environment);
  try {
    if (!resume) {
      const readinessParams = new URLSearchParams({ tenant_id: config.tenant, redirect_uri: config.redirect });
      const readiness = await request({ url: `${config.api}/steward/auth/oauth/google/app-readiness?${readinessParams}`, method: 'GET', headers: { Accept: 'application/json' }, signal, timeoutMs: 15_000, redirect: 'error' });
      signal.throwIfAborted();
      const ready = readiness.data as Record<string, unknown> | null;
      if (readiness.status !== 200 || ready?.ok !== true || ready.appAuth !== 1 || ready.tenantId !== config.tenant || ready.redirectUri !== config.redirect) throw new AlphaAuthError('unavailable');
      await host.clearCallback();
      await host.write(attempt);
      signal.throwIfAborted();
      const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attempt.verifier))));
      const params = new URLSearchParams({ tenant_id: config.tenant, redirect_uri: config.redirect, response_type: 'code', mfa: 'exchange', code_challenge_method: 'S256', code_challenge: challenge, state: attempt.state });
      signal.throwIfAborted();
      await host.open(`${config.api}/steward/auth/oauth/google/authorize?${params}`);
    }
    while (true) {
      signal.throwIfAborted();
      if (Date.now() >= attempt.expiresAt) throw new AlphaAuthError('expired');
      const raw = await host.callback();
      signal.throwIfAborted();
      if (raw) {
        const callback = parseAlphaAuthCallback(raw, attempt);
        await host.clearCallback();
        if (callback) {
          if (callback.error) throw new AlphaAuthError('denied');
          // Retire before a single-use exchange: ambiguous network results require a fresh sign-in.
          await host.clear();
          signal.throwIfAborted();
          const result = await request({ url: `${config.api}/steward/auth/oauth/exchange`, method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: { code: callback.code, redirect_uri: config.redirect, tenant_id: config.tenant, code_verifier: attempt.verifier }, signal, timeoutMs: 30_000, redirect: 'error' });
          signal.throwIfAborted();
          const data = result.data as Record<string, unknown> | null;
          if (result.status !== 200 || data?.ok !== true) throw new AlphaAuthError('invalid-response');
          const login = parseLoginResult(data);
          if ('token' in login) return login.token;
          if (!host.completeMfa) throw new AlphaAuthError('unavailable');
          const token = await host.completeMfa(login.mfa, signal);
          signal.throwIfAborted();
          if (!token.trim() || /[\r\n]/.test(token)) throw new AlphaAuthError('invalid-response');
          return token;
        }
      }
      await pause(signal);
    }
  } finally { await host.clear(); await host.clearCallback(); }
}
