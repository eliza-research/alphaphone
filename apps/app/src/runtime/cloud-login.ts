import { cloudDeployment } from './cloud-deployment.ts';
import type { CloudEnvironment, CloudNativeRequest } from './cloud-protocol';
export type LoginMethod = 'email' | 'sms';
export interface CaptchaRequest { provider: 'turnstile' | 'hcaptcha'; siteKey: string; action: 'email_otp' | 'sms_otp' }
export type CaptchaVerifier = (request: CaptchaRequest, signal: AbortSignal) => Promise<string>;
export interface LoginMethods { google: boolean; email: boolean; sms: boolean; captchaRequired: LoginMethod[]; captcha?: Omit<CaptchaRequest, 'action'> }
export interface LoginChallenge { method: LoginMethod; address: string; expiresAt: number }
export type LoginResult = { token: string } | { mfa: { type: 'totp' | 'sms'; challengeId: string; expiresAt: number } };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Sign-in returned an invalid response.');
  return value as Record<string, unknown>;
};
/** Headless backend adapter. No product identity, browser navigation, persistence or automatic writes. */
export class CloudLogin {
  readonly environment: CloudEnvironment;
  private readonly request: CloudNativeRequest;
  private readonly verifyCaptcha?: CaptchaVerifier;
  constructor(environment: CloudEnvironment, request: CloudNativeRequest, verifyCaptcha?: CaptchaVerifier) {this.environment=environment;this.request=request;this.verifyCaptcha=verifyCaptcha;}
  private async call(path: string, signal: AbortSignal, body?: Record<string, unknown>) {
    signal.throwIfAborted();
    const config = cloudDeployment(this.environment);
    const response = await this.request({ url: `${config.api}/steward/auth/${path}`, method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Steward-Tenant': config.tenant },
      ...(body ? {body: {...body, tenantId: config.tenant}} : {}), signal, timeoutMs: 30_000, redirect: 'error' });
    signal.throwIfAborted();
    if (response.status === 429) throw Error('Too many attempts. Wait before trying again.');
    if (response.status >= 500) throw Error('Sign-in is temporarily unavailable. Try again later.');
    if (response.status === 404) throw Error('This service does not support this in-app sign-in method yet.');
    if (response.status < 200 || response.status >= 300) throw Error('Sign-in could not be completed. Check your details and try again.');
    const data = record(response.data);
    if (data.ok === false) throw Error('Sign-in could not be completed.');
    return data;
  }
  async methods(signal: AbortSignal): Promise<LoginMethods> {
    const data = await this.call('providers', signal);
    const captcha = data.captcha == null ? null : record(data.captcha);
    const required = captcha?.enabled === true ? (captcha.requiredFor ?? ['email_otp', 'sms_otp']) : [];
    if (!Array.isArray(required)) throw Error('Sign-in verification requirements are unavailable.');
    let configuration: LoginMethods['captcha'];
    if (captcha?.enabled === true && required.length) {
      const provider = captcha.provider ?? 'turnstile';
      if ((provider !== 'turnstile' && provider !== 'hcaptcha') || typeof captcha.siteKey !== 'string' || !captcha.siteKey.trim()) throw Error('Sign-in verification is not configured.');
      configuration = {provider, siteKey:captcha.siteKey};
    }
    return { ...(configuration ? {captcha:configuration} : {}), google: data.google === true || (Array.isArray(data.oauth) && data.oauth.includes('google')),
      email: data.email === true, sms: data.sms === true,
      captchaRequired: (['email', 'sms'] as const).filter(method => required.includes(`${method}_otp`)) };
  }
  async send(method: LoginMethod, address: string, signal: AbortSignal): Promise<LoginChallenge> {
    address = address.trim();
    if (method === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254 : !/^\+[1-9]\d{7,14}$/.test(address)) throw Error(method === 'email' ? 'Enter a valid email address.' : 'Use an international phone number, for example +14155550123.');
    const methods = await this.methods(signal);
    if (!methods[method]) throw Error('This sign-in method is unavailable.');
    let captchaToken: string | undefined;
    if (methods.captchaRequired.includes(method)) {
      if (!this.verifyCaptcha || !methods.captcha) throw Error('Sign-in verification is unavailable on this device.');
      captchaToken = await this.verifyCaptcha({...methods.captcha, action:method === 'email' ? 'email_otp' : 'sms_otp'}, signal);
      signal.throwIfAborted();
      if (!captchaToken || /[\r\n]/.test(captchaToken)) throw Error('Sign-in verification failed.');
    }
    const result = await this.call(method === 'email' ? 'email/code/send' : 'sms/send', signal, { [method === 'sms' ? 'phone' : 'email']: address, ...(captchaToken ? {captchaToken} : {}) });
    const data = result.data == null ? result : record(result.data);
    if (method === 'email' && data.codeLength !== 6) throw Error('This service did not confirm an in-app email code. Start sign-in again.');
    const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : Date.parse(String(data.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw Error('The sign-in code has expired. Request a new code.');
    return { method, address, expiresAt };
  }
  async verify(challenge: LoginChallenge, code: string, signal: AbortSignal): Promise<LoginResult> {
    if (challenge.expiresAt <= Date.now()) throw Error('The sign-in code has expired. Request a new code.');
    if (!/^\d{6}$/.test(code)) throw Error('Enter the six-digit code.');
    return parseLoginResult(await this.call(challenge.method === 'email' ? 'email/code/verify' : 'sms/verify', signal,
      { [challenge.method === 'email' ? 'email' : 'phone']: challenge.address, code }));
  }
  async completeMfa(mfa: Extract<LoginResult, {mfa: unknown}>['mfa'], code: string, signal: AbortSignal, recovery = false): Promise<LoginResult> {
    if (mfa.expiresAt <= Date.now()) throw Error('Verification expired. Start sign-in again.');
    if (recovery ? mfa.type !== 'totp' || !code.trim() : !/^\d{6}$/.test(code)) throw Error(recovery ? 'Enter a recovery code from your authenticator setup.' : 'Enter the six-digit code.');
    return parseLoginResult(await this.call(`mfa/${mfa.type}/complete`, signal, {challengeId:mfa.challengeId, ...(recovery ? {recoveryCode:code.trim()} : {code})}));
  }
}
export function parseLoginResult(raw: Record<string, unknown>): LoginResult {
    const data = raw.data == null ? raw : record(raw.data);
    if (data.mfaRequired === true) {
      const mfa = record(data.mfa), expiresAt = Date.parse(String(mfa.expiresAt));
      if (mfa.type !== 'totp' && mfa.type !== 'sms') throw Error('This account requires a verification method unavailable on this device.');
      if (typeof mfa.challengeId !== 'string' || !mfa.challengeId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw Error('Verification expired.');
      return {mfa: {type:mfa.type, challengeId:mfa.challengeId, expiresAt}};
    }
    if (typeof data.token !== 'string' || !data.token.trim() || /[\r\n]/.test(data.token)) throw Error('Sign-in returned an invalid response.');
    return {token:data.token};
  }
