import { cloudDeployment } from './cloud-deployment.ts';
import type { CloudEnvironment, CloudNativeRequest } from './cloud-protocol';
import { alphaAuthConfig } from './alpha-auth.ts';

export type ReadKind = 'email' | 'calendar';
export interface DelegationReview {
  environment: CloudEnvironment;
  appId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  appName: string;
}
const sites = Object.fromEntries((['production', 'staging'] as const).flatMap(environment => cloudDeployment(environment).authorizationOrigins.map(origin => [origin, environment]))) as Record<string, CloudEnvironment>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error('Alpha Phone could not verify the requested read access.'); };
const sameScopes = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every(s => b.includes(s));
function scopesFor(kinds: ReadKind[]) {
  if (!kinds.length || new Set(kinds).size !== kinds.length || kinds.some(k => k !== 'email' && k !== 'calendar')) fail();
  return ['identity', 'google.basic_identity', ...(kinds.includes('email') ? ['google.gmail.triage'] : []), ...(kinds.includes('calendar') ? ['google.calendar.read'] : [])];
}
/** The agent's authorize URL is input data only. It is never navigated to.
 * Only fixed API origins receive requests, and scopes must match the user's selection. */
export async function reviewAlphaDelegation(raw: string, kinds: ReadKind[], request: CloudNativeRequest, signal: AbortSignal): Promise<DelegationReview> {
  signal.throwIfAborted();
  const url = new URL(raw), environment = sites[url.origin];
  if (!environment || url.username || url.password || url.hash || url.pathname !== '/app-auth/authorize') fail();
  const p = url.searchParams;
  const keys = ['app_id', 'client_id', 'redirect_uri', 'state', 'flow', 'scopes'];
  if ([...p.keys()].length !== keys.length || keys.some(k => p.getAll(k).length !== 1) || p.get('flow') !== 'app_delegation') fail();
  const appId = p.get('app_id')!, clientId = p.get('client_id')!, redirectUri = p.get('redirect_uri')!, state = p.get('state')!;
  if (!uuid.test(appId) || !uuid.test(clientId) || !/^[\w-]{43}$/.test(state)) fail();
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash) fail();
  const scopes = p.get('scopes')!.split(' ');
  if (!sameScopes(scopes, scopesFor(kinds))) fail();
  const query = new URLSearchParams({appId, clientId, redirectUri, scopes: scopes.join(' ')});
  const response = await request({url: `${alphaAuthConfig(environment).api}/api/v1/app-auth/delegations/registration?${query}`, method: 'GET', headers: {}, signal, timeoutMs: 30_000, redirect: 'error'});
  signal.throwIfAborted();
  const data = response.data as {success?: unknown; app?: {id?: unknown; name?: unknown}; scopes?: unknown} | null;
  if (response.status !== 200 || data?.success !== true || data.app?.id !== appId || typeof data.app.name !== 'string' || !data.app.name.trim() || data.app.name.length > 200 || !Array.isArray(data.scopes) || !sameScopes(data.scopes, scopes)) fail();
  return {environment, appId, clientId, redirectUri, state, scopes, appName: data!.app!.name as string};
}

/** Call only after the Alpha consent screen's explicit approval. The injected
 * authenticator must obtain an interactive user session, never a stored API key.
 * No retry: an ambiguous POST requires status recovery through the agent. */
export async function approveAlphaDelegation(review: DelegationReview, request: CloudNativeRequest, authenticate: (environment: CloudEnvironment, signal: AbortSignal) => Promise<string>, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const token = await authenticate(review.environment, signal);
  signal.throwIfAborted();
  if (!token || /[\r\n]/.test(token)) fail();
  const response = await request({url: `${alphaAuthConfig(review.environment).api}/api/v1/app-auth/connect`, method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: {flow: 'app_delegation', appId: review.appId, clientId: review.clientId, redirectUri: review.redirectUri, scopes: review.scopes}, signal, timeoutMs: 30_000, redirect: 'error'});
  signal.throwIfAborted();
  const data = response.data as {success?: unknown; codeType?: unknown; code?: unknown} | null;
  if (response.status !== 200 || data?.success !== true || data.codeType !== 'app_delegation_code' || typeof data.code !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(data.code)) fail();
  return data!.code as string;
}
