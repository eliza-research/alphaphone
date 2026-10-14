import type {ChatChannel} from './alpha-client';
import {automationsRouteAllowed, isAutomationsPath, type AutomationsMethod} from './automations-route-policy.ts';
import { CloudPersonalProtocol, PersonalProtocolError } from './cloud-personal-protocol.ts';
import { reviewMailAttachment, type MailAttachment } from './inbox-attachment.ts';
import { reviewOpaqueAttachment, type OpaqueMailAttachment } from './inbox-operation.ts';
import { gmailCapabilitiesFor } from './gmail-grants.ts';
import { ENTITLEMENT_KEYS_PATH, ENTITLEMENT_PATH, type EntitlementSource } from './subscription-entitlement.ts';
/** Narrow Alpha adapter for Eliza Cloud. Contracts inspected in v3's
 * cloud/api/auth/cli-session, cloud/api/v1/eliza/{agents,google}, and
 * ui/src/api/client-cloud.ts. Native composition owns HTTP and secure storage.
 * This module never stores credentials in renderer persistence or logs them. */
export type CloudEnvironment = "production" | "staging";
type CloudAuthority = { readonly api: string; readonly web: string; readonly agents: string };
// Staging is a test-mocks surface (ELIZA_DEV_ALLOW_TEST_MOCKS=1). Vite replaces
// import.meta.env at build time, so flag-off bundles fold the staging authority
// away. Node contract tests import this source without Vite and keep both.
const stagingAvailable: boolean = import.meta.env === undefined || import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1';
const authorities: Partial<Record<CloudEnvironment, CloudAuthority>> = {
  production: { api: "https://api.eliza.app", web: "https://eliza.app", agents: "cloud.eliza.app" },
  ...(stagingAvailable ? { staging: { api: "https://api-staging.eliza.app", web: "https://staging.eliza.app", agents: "cloud-staging.eliza.app" } } : {}),
};
/** Whether this build can address the environment. Production builds expose only production. */
export function cloudEnvironmentAvailable(environment: CloudEnvironment): boolean { return authorities[environment] !== undefined; }
export interface CloudCredential {
  /** Local generation identifier, never an authentication credential. */
  credentialId?: string;
  token?: string;
  /** Development host reference; it is never a Cloud bearer credential. */
  credentialReference?: string;
  expiresAt?: number;
  userId?: string;
  organizationId?: string;
}
export interface CloudCredentialStore {
  acceptsReferences?: boolean;
  read(environment: CloudEnvironment): Promise<CloudCredential | null>;
  /** Must atomically reject an aborted signal before committing to native secure storage. */
  write(environment: CloudEnvironment, credential: CloudCredential, signal: AbortSignal): Promise<void>;
  clear(environment: CloudEnvironment): Promise<void>;
}
/** The native adapter must enforce the timeout and AbortSignal, reject redirects,
 * and return decoded JSON. It must never log headers, bodies, or auth URLs. */
export interface CloudNativeRequest {
  (input: { url: string; method: AutomationsMethod; headers: Record<string, string>;
    body?: unknown; credentialReference?: string; signal: AbortSignal; timeoutMs: number; redirect: "error"; expiresAt?: number;
  }): Promise<{ status: number; data: unknown }>;
}
/** Optional transport capabilities. The native transport admits only GET and POST today, so
 * credential self-revocation (DELETE) is reported unsupported unless the host opts in. */
export interface CloudProtocolOptions { deleteRequests?: boolean }
/** Server-side revocation of the CLI-issued credential. `supported:false` means nothing was sent
 * or the deployed Cloud has no self-revocation route; the local credential is cleared either way. */
export type CloudSessionRevocation =
  | { supported: true; revoked: true; credentialId: string | null; revokedAt: string | null }
  | { supported: false; reason: "transport" | "server" | "no-credential" };
export interface CloudLoginAttempt { sessionId: string; expiresAt: number; browserUrl: string }
export interface CloudAgent {
  id: string; name: string | null; status: string; executionTier: string | null;
  /** Only validated REST targets, never internal bridge URLs. Null until available. */
  runtimeUrl: string | null;
}
export interface GoogleConnection {
  configured: boolean; connected: boolean; reason: string;
  connectionId: string | null; grantedCapabilities: string[];
}
export interface GmailInboxCapabilities {
  version:1; from:string; threads:boolean; send:boolean; providerDrafts:boolean;
  mailboxMutations:boolean; attachments:boolean; providerExactlyOnce:false; atomicDraftReplacement:false;
  /** Reviewed mark-read/mark-unread operations. Older servers omit it: false. */
  readState:boolean;
  /** Provider draft listing and content reads. Absent: false. */
  draftsList:boolean;
  /** Forward with the source message's attachments bound to its historyId. Absent: false. */
  forwardAttachments:boolean;
  /** Gmail search can list Trash. Absent: false. */
  searchTrash:boolean;
  /** Opaque byte-copy download of any attachment type under the cap. Absent: false. */
  opaqueAttachments:boolean;
  /** Outgoing attachment policy. Older servers publish maximumOutgoing 1 or omit the policy. */
  attachmentPolicy:{maximumOutgoing:number;maximumBytes:number;maximumTotalBytes:number};
}
/** A provider-extracted link: inert data, never fetched or rendered as HTML. */
export interface GmailLink { href: string; text: string }
export interface GmailDraftSummary { draftId: string; messageId: string; subject: string; to: string[]; snippet: string; updatedAt: string | null }
export interface GmailDraftContent { draftId: string; messageId: string; providerDigest: string; to: string[]; cc: string[]; bcc: string[]; subject: string; bodyText: string; threaded: boolean; attachmentCount: number;
  /** False for an HTML-only draft, whose formatting a plain-text edit would discard. */
  plainText: boolean }
export interface GmailInboxReceipt {
  requestId:string; kind:'send'|'draft-create'|'draft-replace'|'draft-delete'|'archive'|'unarchive'|'trash'|'untrash'|'mark-read'|'mark-unread';
  reviewDigest:string; state:'prepared'|'dispatched'|'succeeded'|'rejected'|'outcome-unknown';
  providerResult:Record<string,unknown>|null; rejectionCode:string|null;
}
export interface GmailAccount extends GoogleConnection { label: string }
export interface GmailMessage {
  id: string; threadId: string; subject: string; from: string; fromEmail: string | null;
  to: string[]; cc?: string[]; replyTo?: string | null; snippet: string; receivedAt: string; unread: boolean;
  /** Search hint from a multipart/mixed container; absent on older servers. */
  hasAttachments?: boolean;
}
/** Only absolute http(s) links without credentials are kept; anything else is dropped as untrusted. */
export function safeMailLink(value: unknown): GmailLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.href !== "string" || row.href.length > 2048 || typeof row.text !== "string") return null;
  let url: URL;
  try { url = new URL(row.href); } catch { return null; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters from untrusted labels.
  const text = row.text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return { href: url.href, text: text || url.hostname };
}
function mailLinks(value: unknown): GmailLink[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) throw new CloudProtocolError("invalid-response");
  const seen = new Set<string>(), links: GmailLink[] = [];
  for (const row of value) { const link = safeMailLink(row); if (link && !seen.has(link.href)) { seen.add(link.href); links.push(link); } }
  return links.slice(0, 50);
}
export class CloudProtocolError extends Error {
  constructor(readonly code: "invalid-response" | "http" | "expired" | "credentials-missing" | "credential-consumed" | "login-active" | "account-changed", readonly status?: number, readonly data?: unknown) {
    super(`Eliza Cloud ${code}${status ? ` (${status})` : ""}`);
    this.name = "CloudProtocolError";
  }
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloudProtocolError("invalid-response");
  return value as ObjectValue;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new CloudProtocolError("invalid-response");
  return value;
}
function optionalString(value: unknown): string | null { return value == null ? null : string(value); }
function uuid(value: unknown): string {
  const id = string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new CloudProtocolError("invalid-response");
  return id;
}
function timestamp(value: unknown): number {
  const parsed = Date.parse(string(value));
  if (!Number.isFinite(parsed)) throw new CloudProtocolError("invalid-response");
  return parsed;
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export interface CloudPhoneTarget {
  agentId: string; origin: string; userId: string; organizationId: string;
  credentialId: string; headers: Record<string,string>;
}
export class CloudProtocol {
  private phoneTarget: CloudPhoneTarget | null = null;
  setPhoneTarget(target: CloudPhoneTarget | null) { this.phoneTarget = target; }
  async phoneRequest(target: CloudPhoneTarget, path: string, signal: AbortSignal, body?: unknown, method: AutomationsMethod = body === undefined ? 'GET' : 'POST'): Promise<Record<string,unknown>> {
    signal.throwIfAborted();
    const automation = isAutomationsPath(path);
    if (automation ? !automationsRouteAllowed(path, method) : !['GET','POST'].includes(method) || !(/^\/api\/(?:client-devices|workflow|conversations)(?:\/|\?|$)/.test(path)||/^\/api\/views\/interact-(claim|result)$/.test(path)) || path.includes('..') || /[\\#\s]/.test(path)) throw new Error('Invalid phone route');
    if ((method === 'GET' || method === 'DELETE') && body !== undefined) throw new Error('Invalid phone request body');
    const credential = await this.credentials.read(this.environment); signal.throwIfAborted();
    if (!credential || credential.credentialId !== target.credentialId) throw new Error('Cloud account changed');
    const identity = await this.identity(signal);
    if (identity.userId !== target.userId || identity.organizationId !== target.organizationId) throw new Error('Cloud owner changed');
    const agent = await this.agentDetail(target.agentId, signal);
    if (agent.runtimeUrl !== target.origin || !['dedicated-lazy','dedicated-always','custom'].includes(agent.executionTier || '')) throw new Error('Verified dedicated runtime unavailable');
    const result = await this.call(path, signal, {authenticated:true,runtimeBase:target.origin,body,method,timeoutMs:120000,headers:{...target.headers,'X-Eliza-Phone-Protocol':'1'},credentialId:target.credentialId});
    if ((await this.credentials.read(this.environment))?.credentialId !== target.credentialId) throw new Error('Cloud account changed');
    signal.throwIfAborted(); return result;
  }
  private activeLogin: AbortController | null = null;
  constructor(readonly environment: CloudEnvironment, private readonly request: CloudNativeRequest,
    private readonly credentials: CloudCredentialStore,
    private readonly openExternal: (url: string, signal: AbortSignal) => Promise<void>,
    private readonly options: CloudProtocolOptions = {}) {}
  private get authority(): CloudAuthority {
    const authority = authorities[this.environment];
    if (!authority) throw new Error("This Eliza Cloud environment is unavailable in this build.");
    return authority;
  }
  private async requestData(path: string, signal: AbortSignal, options: { body?: unknown; method?: AutomationsMethod; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; expiresAt?: number; onStatus?: (status:number)=>void } = {}) {
    signal.throwIfAborted();
    let credentialReference: string | undefined;
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (options.authenticated) {
      const credential = await this.credentials.read(this.environment);
      signal.throwIfAborted();
      if (!credential) throw new CloudProtocolError("credentials-missing");
      if (options.credentialId && credential.credentialId !== options.credentialId) throw new Error("Cloud account changed");
      if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
      if(credential.credentialReference){
        if(!this.credentials.acceptsReferences || credential.token)throw new CloudProtocolError("invalid-response");
        credentialReference=credential.credentialReference;
      }else if(credential.token)headers.Authorization = `Bearer ${credential.token}`;
      else throw new CloudProtocolError("credentials-missing");
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.request({ url: (options.runtimeBase ?? this.authority.api) + path,
      method: options.method ?? (options.body === undefined ? "GET" : "POST"), headers, body: options.body,
      signal, credentialReference, timeoutMs: options.timeoutMs ?? 30_000, redirect: "error", ...(options.expiresAt === undefined ? {} : {expiresAt:options.expiresAt}) });
    signal.throwIfAborted();
    if (response.status < 200 || response.status >= 300) throw new CloudProtocolError("http", response.status, response.data);
    options.onStatus?.(response.status);
    return response.data;
  }
  private async call(path: string, signal: AbortSignal, options: { body?: unknown; method?: AutomationsMethod; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; expiresAt?: number } = {}) {
    return object(await this.requestData(path, signal, options));
  }
  /** Transitional pre-subscription account check. Used only while Cloud has not deployed the
   * subscription entitlement route; the UI shows plan state, never a credit balance or top-up.
   * The credential ID binds the snapshot to one login; it is not a spend authorization. */
  async creditBalance(signal: AbortSignal): Promise<{ balance: number; credentialId: string }> {
    signal.throwIfAborted();
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (!credential?.credentialId) throw new CloudProtocolError("credentials-missing");
    const data = await this.call("/api/v1/credits/balance", signal, {
      authenticated: true, credentialId: credential.credentialId,
    });
    await this.assertSameCredential(credential.credentialId, signal);
    const balance = typeof data.balance === "number" ? data.balance
      : typeof data.balance === "string" && data.balance.trim() ? Number(data.balance) : NaN;
    if (!Number.isFinite(balance)) throw new CloudProtocolError("invalid-response");
    return { balance, credentialId: credential.credentialId };
  }
  private async assertSameCredential(credentialId: string, signal: AbortSignal) {
    const current = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (current?.credentialId !== credentialId) throw new CloudProtocolError("account-changed");
    if (current.expiresAt !== undefined && current.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
  }
  /** Cloud API origin, used as the entitlement issuer. */
  get entitlementIssuer(): string { return this.authority.api; }
  /** Short-lived signed subscription entitlement (proposed Cloud contract, issue #410). Read at
   * admission and by the background refresher, never per assistant turn. `null` means the
   * deployed Cloud does not offer the route yet (404/405/501). */
  async subscriptionEntitlement(signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted();
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (!credential?.credentialId) throw new CloudProtocolError("credentials-missing");
    let data: ObjectValue;
    try { data = await this.call(ENTITLEMENT_PATH, signal, { authenticated: true, credentialId: credential.credentialId }); }
    catch (error) {
      if (error instanceof CloudProtocolError && error.code === "http" && [404, 405, 501].includes(error.status ?? 0)) return null;
      throw error;
    }
    await this.assertSameCredential(credential.credentialId, signal);
    if (typeof data.entitlement !== "string" || !data.entitlement || data.entitlement.length > 8192) throw new CloudProtocolError("invalid-response");
    return data.entitlement;
  }
  /** Public ES256 verification keys for entitlements. Never private material. */
  async subscriptionEntitlementKeys(signal: AbortSignal): Promise<JsonWebKey[]> {
    const data = await this.call(ENTITLEMENT_KEYS_PATH, signal);
    if (!Array.isArray(data.keys) || data.keys.length > 16) throw new CloudProtocolError("invalid-response");
    return data.keys.filter((key): key is JsonWebKey => !!key && typeof key === "object" && !Array.isArray(key)
      && (key as ObjectValue).kty === "EC" && (key as ObjectValue).crv === "P-256" && (key as ObjectValue).d === undefined
      && typeof (key as ObjectValue).kid === "string" && typeof (key as ObjectValue).x === "string" && typeof (key as ObjectValue).y === "string");
  }
  /** Entitlement ports for checkEntitlement, bound to this client. */
  entitlementSource(): EntitlementSource {
    return { issuer: this.entitlementIssuer,
      entitlement: signal => this.subscriptionEntitlement(signal),
      entitlementKeys: signal => this.subscriptionEntitlementKeys(signal),
      legacyAccountUsable: async signal => (await this.creditBalance(signal)).balance > 0 };
  }
  /** Opens Cloud's hosted plan management page. No checkout, upgrade or overage purchase is created here. */
  async openSubscriptionManagement(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.openExternal(`https://${this.authority.agents}/cloud/billing`, signal);
    signal.throwIfAborted();
  }
  /** Scoped personal onboarding, using the existing native credential transport. */
  async personal(signal: AbortSignal): Promise<CloudPersonalProtocol> {
    const credential = await this.credentials.read(this.environment);
    if (!credential?.credentialId) throw new PersonalProtocolError('account-changed');
    const identity = await this.identity(signal);
    if (!identity.organizationId) throw new PersonalProtocolError('account-changed');
    const owner = Object.freeze({ environment:this.environment, credentialId:credential.credentialId,
      userId:identity.userId, organizationId:identity.organizationId });
    const assertCurrent = async () => {
      signal.throwIfAborted();
      const current = await this.credentials.read(this.environment);
      if (current?.credentialId !== owner.credentialId) throw new PersonalProtocolError('account-changed');
    };
    await assertCurrent();
    return new CloudPersonalProtocol(owner, async (path, requestSignal, body) => {
      await assertCurrent(); requestSignal.throwIfAborted();
      const currentOwner=await this.identity(requestSignal);
      await assertCurrent();
      if(currentOwner.userId!==owner.userId||currentOwner.organizationId!==owner.organizationId)throw new PersonalProtocolError('account-changed');
      let status=200;
      try {
        const data=await this.requestData(path,requestSignal,{authenticated:true,credentialId:owner.credentialId,body,onStatus:value=>{status=value;}});
        await assertCurrent(); requestSignal.throwIfAborted(); return {status,data};
      } catch(error) {
        await assertCurrent(); requestSignal.throwIfAborted();
        if(error instanceof CloudProtocolError && error.code==='http')return {status:error.status!,data:error.data};
        throw error;
      }
    }, async (target, requestSignal, expectedApiBase) => {
      await assertCurrent();
      const agent=await this.agentDetail(target,requestSignal);
      await assertCurrent();
      if(!['dedicated-lazy','dedicated-always','custom'].includes(agent.executionTier??'') ||
        (expectedApiBase!==undefined && (this.runtimeUrl(expectedApiBase,target,agent.executionTier)!==expectedApiBase || (agent.runtimeUrl!==null && agent.runtimeUrl!==expectedApiBase))) || (agent.status==='running'&&!agent.runtimeUrl)) throw new PersonalProtocolError('invalid-response');
      return agent.status;
    });
  }
  cancelLogin(): void { this.activeLogin?.abort(new DOMException("Login cancelled", "AbortError")); }
  /** Only one poller may claim the server's single-consumption credential. A
   * cancelled/lost claim is not retried automatically; start a fresh login. */
  async login(signal: AbortSignal, onWaiting?: (attempt: CloudLoginAttempt) => void): Promise<void> {
    if (this.activeLogin) throw new CloudProtocolError("login-active");
    signal.throwIfAborted();
    const controller = new AbortController();
    this.activeLogin = controller;
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The server issues the UUID; client-chosen IDs are deliberately ignored.
      const created = await this.call("/api/auth/cli-session", controller.signal, { body: {} });
      const sessionId = uuid(created.sessionId);
      const expiresAt = timestamp(created.expiresAt);
      if (expiresAt <= Date.now()) throw new CloudProtocolError("expired");
      expiryTimer = setTimeout(() => controller.abort(new CloudProtocolError("expired")), Math.min(expiresAt - Date.now(), 2_147_483_647));
      const browserUrl = `${this.authority.web}/auth/cli-login?session=${encodeURIComponent(sessionId)}`;
      onWaiting?.({ sessionId, expiresAt, browserUrl });
      await this.openExternal(browserUrl, controller.signal);
      if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
      while (true) {
        controller.signal.throwIfAborted();
        if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
        let response: ObjectValue;
        try { response = await this.call(`/api/auth/cli-session/${sessionId}`, controller.signal, {expiresAt}); }
        catch (error) {
          if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
          if (error instanceof CloudProtocolError && (error.status === 404 || error.status === 410)) throw new CloudProtocolError("expired");
          throw error;
        }
        if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
        const data = response.data == null ? response : object(response.data);
        if (data.status === "authenticated") {
          const token = ["token", "accessToken", "stewardToken", "sessionToken", "apiKey"]
            .flatMap(key => [response[key], data[key]]).find(value => typeof value === "string" && value.trim());
          const reference=data.credentialReference ?? response.credentialReference;
          if(!token && !(this.credentials.acceptsReferences && typeof reference==="string" && /^browser-cloud-reference:[0-9a-f-]{36}$/.test(reference)))throw new CloudProtocolError("credential-consumed");
          const credential: CloudCredential = token ? {token:string(token)} : {credentialReference:string(reference)};
          if (data.expiresAt != null) credential.expiresAt = timestamp(data.expiresAt);
          if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
          if (data.userId != null) credential.userId = string(data.userId);
          if (data.organizationId != null) credential.organizationId = string(data.organizationId);
          controller.signal.throwIfAborted();
          if (Date.now() >= expiresAt) throw new CloudProtocolError("expired");
          await this.credentials.write(this.environment, credential, controller.signal);
          return;
        }
        if (data.status === "expired") throw new CloudProtocolError("expired");
        if (data.status !== "pending") throw new CloudProtocolError("invalid-response");
        await delay(Math.min(1500, Math.max(1, expiresAt - Date.now())), controller.signal);
      }
    } finally {
      clearTimeout(expiryTimer);
      signal.removeEventListener("abort", abort);
      this.activeLogin = null;
    }
  }
  async disconnect(): Promise<void> { this.cancelLogin(); await this.credentials.clear(this.environment); }
  /** Revokes the presented CLI-issued key with Cloud's self-revocation route
   * (`DELETE /api/v1/api-keys/current`), then clears local storage. One attempt, never retried:
   * a lost response is reported as an error and the local credential is still cleared. */
  async revokeSession(signal: AbortSignal): Promise<CloudSessionRevocation> {
    this.cancelLogin();
    const credential = await this.credentials.read(this.environment);
    signal.throwIfAborted();
    if (!credential) return { supported: false, reason: "no-credential" };
    try {
      if (!this.options.deleteRequests) return { supported: false, reason: "transport" };
      let data: unknown;
      try {
        data = await this.requestData("/api/v1/api-keys/current", signal, { authenticated: true, method: "DELETE",
          ...(credential.credentialId ? { credentialId: credential.credentialId } : {}) });
      } catch (error) {
        if (error instanceof CloudProtocolError && error.code === "http" && (error.status === 404 || error.status === 405 || error.status === 501)) return { supported: false, reason: "server" };
        throw error;
      }
      const result = object(data);
      if (result.success !== true || (result.status !== undefined && result.status !== "revoked")) throw new CloudProtocolError("invalid-response");
      return { supported: true, revoked: true, credentialId: typeof result.credentialId === "string" ? result.credentialId : null, revokedAt: typeof result.revokedAt === "string" ? result.revokedAt : null };
    } finally {
      const current = await this.credentials.read(this.environment);
      if (current?.credentialId === credential.credentialId && current?.token === credential.token) await this.credentials.clear(this.environment);
    }
  }
  private runtimeUrl(value: unknown, id: string, tier: string | null): string | null {
    if (value == null) return tier === "shared" ? `${this.authority.api}/api/v1/eliza/agents/${id}` : null;
    let url: URL;
    try { url = new URL(string(value)); } catch { throw new CloudProtocolError("invalid-response"); }
    const sharedPath = `/api/v1/eliza/agents/${id}`;
    const dedicated = url.hostname === `${id}.${this.authority.agents}` && (url.pathname === "/" || url.pathname === "");
    const shared = url.origin === this.authority.api && url.pathname.replace(/\/$/, "") === sharedPath;
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || (!dedicated && !shared)) throw new CloudProtocolError("invalid-response");
    return url.href.replace(/\/$/, "");
  }
  private agent(value: unknown): CloudAgent {
    const data = object(value), id = uuid(data.id ?? data.agentId);
    const tier = optionalString(data.executionTier);
    return { id, name: optionalString(data.agentName), status: string(data.status), executionTier: tier,
      runtimeUrl: this.runtimeUrl(data.webUiUrl, id, tier) };
  }
  private success(response: ObjectValue): unknown {
    if (response.success !== true) throw new CloudProtocolError("invalid-response");
    return response.data;
  }
  async listAgents(signal: AbortSignal): Promise<CloudAgent[]> {
    const data = this.success(await this.call("/api/v1/eliza/agents", signal, { authenticated: true }));
    if (!Array.isArray(data)) throw new CloudProtocolError("invalid-response");
    return data.map(value => this.agent(value));
  }
  async agentDetail(id: string, signal: AbortSignal): Promise<CloudAgent> {
    const agent = this.agent(this.success(await this.call(`/api/v1/eliza/agents/${uuid(id)}`, signal, { authenticated: true })));
    if (agent.id !== id) throw new CloudProtocolError("invalid-response");
    return agent;
  }
  /** Authenticated identity is server-derived, never inferred from entered email. */
  async identity(signal: AbortSignal): Promise<{ userId: string; organizationId?: string;email?:string }> {
    const data = object(this.success(await this.call("/api/v1/user", signal, { authenticated: true })));
    return { userId: uuid(data.id), ...(typeof data.email==='string'&&data.email.trim()&&data.email.length<=320?{email:data.email.trim()}:{}), ...(data.organization_id == null ? {} : { organizationId: uuid(data.organization_id) }) };
  }
  private async runtimeCall(agentId: string, path: string, signal: AbortSignal, body?: unknown) {
    if (this.phoneTarget?.agentId === agentId) return this.phoneRequest(this.phoneTarget, path, signal, body);
    const agent = await this.agentDetail(agentId, signal);
    if (!agent.runtimeUrl) throw new CloudProtocolError("invalid-response");
    // Hosted shared REST lives on the API host. Dedicated REST lives on its
    // returned per-agent subdomain, whose proxy validates the same cloud token.
    return this.call(path, signal, { authenticated: true, runtimeBase: agent.runtimeUrl, body, timeoutMs: 120_000 });
  }
  async listConversations(agentId: string, signal: AbortSignal): Promise<Array<{ id: string; title?: string }>> {
    const response = await this.runtimeCall(agentId, "/api/conversations", signal);
    if (!Array.isArray(response.conversations)) throw new CloudProtocolError("invalid-response");
    return response.conversations.map(value => {
      const conversation = object(value);
      return { id: string(conversation.id), ...(typeof conversation.title === "string" ? { title: conversation.title } : {}) };
    });
  }
  async messages(agentId: string, conversationId: string, signal: AbortSignal): Promise<{ messages: Record<string, unknown>[] }> {
    const data = await this.runtimeCall(agentId, `/api/conversations/${encodeURIComponent(string(conversationId))}/messages`, signal);
    if (!Array.isArray(data.messages)) throw new CloudProtocolError("invalid-response");
    return { messages: data.messages.map(object) };
  }
  async createConversation(agentId: string, title: string, signal: AbortSignal): Promise<{ id: string; title?: string }> {
    const response = await this.runtimeCall(agentId, "/api/conversations", signal, { title });
    const conversation = object(response.conversation);
    return { id: string(conversation.id), ...(typeof conversation.title === "string" ? { title: conversation.title } : {}) };
  }
  /** Never replay a send automatically. Shared Cloud currently ignores metadata;
   * the dedicated host accepts it. Caller must not treat shared context as delivered. */
  async send(agentId: string, conversationId: string, text: string,
    options: { metadata?: Record<string, unknown>; clientMessageId?: string; channelType?:ChatChannel; signal: AbortSignal },
  ): Promise<{ text: string; agentName: string; messageId?:string;userMessageId?:string;actionResults?:readonly unknown[];interrupted?: boolean; noResponseReason?: "ignored"; failureKind?: unknown; terminalFailure?: unknown }> {
    if (!text.trim()) throw new TypeError("Message must not be empty");
    const response = await this.runtimeCall(agentId,
      `/api/conversations/${encodeURIComponent(string(conversationId))}/messages`, options.signal,
      { text, channelType: options.channelType ?? "DM", ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}) });
    if (typeof response.text !== "string" || typeof response.agentName !== "string") throw new CloudProtocolError("invalid-response");
    if (response.terminalFailure || response.failureKind) throw new CloudProtocolError("invalid-response");
    for(const key of ['messageId','userMessageId'])if(response[key]!==undefined&&typeof response[key]!=='string')throw new CloudProtocolError('invalid-response');
    return { text: response.text, agentName: response.agentName,
      ...(typeof response.messageId==='string'?{messageId:response.messageId}:{}),
      ...(typeof response.userMessageId==='string'?{userMessageId:response.userMessageId}:{}),
      ...(Array.isArray(response.actionResults)?{actionResults:response.actionResults}:{}),
      ...(response.interrupted === true ? { interrupted: true } : {}),
      ...(response.noResponseReason === "ignored" ? { noResponseReason: "ignored" as const } : {}) };
  }
  /** Starts Google consent. `read` asks for read access only; `modify` is the one incremental step
   * for approved mailbox changes (gmail-grants.ts). The single-capability values remain for callers
   * that ask for one change capability. */
  async initiateGmail(signal: AbortSignal, permission: 'read'|'modify'|'send'|'drafts'|'mailbox' = 'read'): Promise<string> {
    const capabilities = permission === "read" || permission === "modify" ? gmailCapabilitiesFor(permission)
      : ["google.basic_identity", "google.gmail.triage", permission === "send" ? "google.gmail.send" : permission === "drafts" ? "google.gmail.drafts" : "google.gmail.mailbox"];
    const response = await this.call("/api/v1/eliza/google/connect/initiate", signal, { authenticated: true,
      body: { side: "owner", capabilities } });
    let url: URL;
    try { url = new URL(string(response.authUrl)); } catch { throw new CloudProtocolError("invalid-response"); }
    if (url.origin !== "https://accounts.google.com" || url.username || url.password || url.hash) throw new CloudProtocolError("invalid-response");
    return url.href;
  }
  private googleConnection(value: unknown): GmailAccount {
    const data = object(value);
    if (typeof data.configured !== "boolean" || typeof data.connected !== "boolean" || !Array.isArray(data.grantedCapabilities)) throw new CloudProtocolError("invalid-response");
    const identity = data.identity == null ? {} : object(data.identity);
    return { configured: data.configured, connected: data.connected, reason: string(data.reason),
      connectionId: optionalString(data.connectionId), grantedCapabilities: data.grantedCapabilities.map(string),
      label: optionalString(identity.email) ?? optionalString(identity.name) ?? "Google account" };
  }
  async gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]> {
    const data = await this.requestData("/api/v1/eliza/google/accounts?side=owner", signal, { authenticated: true });
    if (!Array.isArray(data)) throw new CloudProtocolError("invalid-response");
    return data.map(value => this.googleConnection(value));
  }
  private gmailMessage(value: unknown): GmailMessage {
    const data = object(value);
    if (!Array.isArray(data.to) || typeof data.isUnread !== "boolean" || typeof data.subject !== "string" || typeof data.snippet !== "string") throw new CloudProtocolError("invalid-response");
    return { id: string(data.externalId), threadId: string(data.threadId), subject: data.subject,
      from: string(data.from), fromEmail: optionalString(data.fromEmail), to: data.to.map(string), cc: Array.isArray(data.cc)?data.cc.map(string):[], replyTo:optionalString(data.replyTo),
      snippet: data.snippet, receivedAt: string(data.receivedAt), unread: data.isUnread,
      ...(data.hasAttachments === undefined ? {} : typeof data.hasAttachments === "boolean" ? { hasAttachments: data.hasAttachments } : (() => { throw new CloudProtocolError("invalid-response"); })()) };
  }
  /** One page of results. `nextPageToken` is the provider's opaque cursor for the same query, or null. */
  async gmailSearch(grantId: string, query: string, signal: AbortSignal, maxResults: 10 | 25 | 50 = 25, pageToken?: string): Promise<{ messages: GmailMessage[]; syncedAt: string; nextPageToken: string | null }> {
    if (pageToken !== undefined && (typeof pageToken !== "string" || !pageToken || pageToken.length > 4096)) throw new TypeError("Invalid Gmail page token");
    const params = new URLSearchParams({ side: "owner", grantId: string(grantId), query: string(query), maxResults: String(maxResults) });
    if (pageToken !== undefined) params.set("pageToken", pageToken);
    const data = await this.call(`/api/v1/eliza/google/gmail/search?${params}`, signal, { authenticated: true });
    if (!Array.isArray(data.messages)) throw new CloudProtocolError("invalid-response");
    const next = data.nextPageToken;
    if (next != null && (typeof next !== "string" || !next || next.length > 4096 || next === pageToken)) throw new CloudProtocolError("invalid-response");
    return { messages: data.messages.map(value => this.gmailMessage(value)), syncedAt: string(data.syncedAt), nextPageToken: next == null ? null : next };
  }
  /** Revokes Eliza Cloud's stored Google grant for one owner connection. It does not delete mail and
   * cannot remove the app from the user's Google Account permissions; callers verify with gmailAccounts. */
  async disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void> {
    const data = await this.call("/api/v1/eliza/google/disconnect", signal, { authenticated: true, body: { side: "owner", connectionId: string(connectionId) } });
    if (data.ok !== true) throw new CloudProtocolError("invalid-response");
  }
  async gmailRead(grantId: string, messageId: string, signal: AbortSignal): Promise<{ message: GmailMessage; bodyText: string; links: GmailLink[] }> {
    const params = new URLSearchParams({ side: "owner", grantId: string(grantId), messageId: string(messageId) });
    const data = await this.call(`/api/v1/eliza/google/gmail/read?${params}`, signal, { authenticated: true });
    if (typeof data.bodyText !== "string") throw new CloudProtocolError("invalid-response");
    const message = this.gmailMessage(data.message);
    if (message.id !== messageId) throw new CloudProtocolError("invalid-response");
    return { message, bodyText: data.bodyText, links: mailLinks(data.links) };
  }
  async gmailInboxCapabilities(grantId:string,signal:AbortSignal):Promise<GmailInboxCapabilities> {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/capabilities?${new URLSearchParams({grantId})}`,signal,{authenticated:true});
    if(data.version!==1||data.providerExactlyOnce!==false||data.atomicDraftReplacement!==false||['threads','send','providerDrafts','mailboxMutations','attachments'].some(key=>typeof data[key]!=='boolean'))throw new CloudProtocolError('invalid-response');
    for(const key of ['readState','draftsList','forwardAttachments','opaqueAttachments','searchTrash'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw new CloudProtocolError('invalid-response');
    const policy=data.attachmentPolicy===undefined?{}:object(data.attachmentPolicy),limit=(value:unknown,fallback:number,max:number)=>{if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||(value as number)<1||(value as number)>max)throw new CloudProtocolError('invalid-response');return value as number;};
    const maximumBytes=limit(policy.maximumBytes,5*1024*1024,25*1024*1024),attachmentPolicy={maximumOutgoing:limit(policy.maximumOutgoing,1,20),maximumBytes,maximumTotalBytes:limit(policy.maximumTotalBytes,maximumBytes,25*1024*1024)};
    return {version:1,from:string(data.from),threads:data.threads as boolean,send:data.send as boolean,providerDrafts:data.providerDrafts as boolean,mailboxMutations:data.mailboxMutations as boolean,attachments:data.attachments as boolean,providerExactlyOnce:false,atomicDraftReplacement:false,readState:data.readState===true,draftsList:data.draftsList===true,forwardAttachments:data.forwardAttachments===true,opaqueAttachments:data.opaqueAttachments===true,searchTrash:data.searchTrash===true,attachmentPolicy};
  }
  async gmailThread(grantId:string,threadId:string,signal:AbortSignal,cursor?:{offset:number;historyId:string}) {
    const params=new URLSearchParams({grantId,threadId});if(cursor){params.set('offset',String(cursor.offset));params.set('historyId',cursor.historyId);}
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/thread?${params}`,signal,{authenticated:true});
    if(data.version!==1||data.threadId!==threadId||!Array.isArray(data.messages)||data.messages.length>25||!Number.isSafeInteger(data.total)||!Number.isSafeInteger(data.offset)||data.offset!==(cursor?.offset??0))throw new CloudProtocolError('invalid-response');
    const messages=data.messages.map(row=>{const item=object(row),message=this.gmailMessage(item.message);if(message.threadId!==threadId||typeof item.bodyText!=='string')throw new CloudProtocolError('invalid-response');return {message,bodyText:item.bodyText,links:mailLinks(item.links),historyId:typeof item.historyId==='string'?item.historyId:null,attachments:Array.isArray(item.attachments)?item.attachments.map(value=>{const a=object(value);if(typeof a.name!=='string'||typeof a.mimeType!=='string'||typeof a.size!=='number'||typeof a.supported!=='boolean')throw new CloudProtocolError('invalid-response');return {partId:typeof a.partId==='string'?a.partId:(()=>{throw new CloudProtocolError('invalid-response')})(),name:a.name,mimeType:a.mimeType,size:a.size,supported:a.supported};}):[]};});
    const total=data.total as number,offset=data.offset as number;if(total<offset+messages.length||total>2000||data.nextOffset!==(offset+messages.length<total?offset+messages.length:null))throw new CloudProtocolError('invalid-response');
    const historyId=string(data.historyId);if(cursor&&cursor.historyId!==historyId)throw new CloudProtocolError('invalid-response');return {messages,total,offset,historyId,nextOffset:data.nextOffset as number|null};
  }
  /** Opaque byte copy of any type under the server cap. The bytes are never
   * previewed or interpreted; only the name, size and SHA-256 are checked here. */
  async gmailOpaqueAttachment(grantId:string,messageId:string,partId:string,historyId:string,signal:AbortSignal):Promise<OpaqueMailAttachment>{
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/attachment?${new URLSearchParams({grantId,messageId,partId,historyId,opaque:'1'})}`,signal,{authenticated:true});
    if(data.version!==1||data.opaque!==true||data.messageId!==messageId||data.partId!==partId||data.historyId!==historyId)throw new CloudProtocolError('invalid-response');
    let checked:OpaqueMailAttachment;try{checked=await reviewOpaqueAttachment({name:string(data.name),mimeType:typeof data.mimeType==='string'?data.mimeType:'',dataBase64:string(data.dataBase64)});}catch{throw new CloudProtocolError('invalid-response');}
    if(checked.sha256!==data.sha256||checked.size!==data.size)throw new CloudProtocolError('invalid-response');return checked;
  }
  /** One page of provider drafts. Metadata only; open one with gmailDraftContent. */
  async gmailDrafts(grantId:string,signal:AbortSignal,pageToken?:string):Promise<{drafts:GmailDraftSummary[];nextPageToken:string|null}>{
    if(pageToken!==undefined&&(!pageToken||pageToken.length>4096))throw new TypeError('Invalid Gmail page token');
    const params=new URLSearchParams({grantId});if(pageToken!==undefined)params.set('pageToken',pageToken);
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/drafts?${params}`,signal,{authenticated:true});
    if(data.version!==1||!Array.isArray(data.drafts)||data.drafts.length>50)throw new CloudProtocolError('invalid-response');
    const next=data.nextPageToken;if(next!=null&&(typeof next!=='string'||!next||next.length>4096||next===pageToken))throw new CloudProtocolError('invalid-response');
    const drafts=data.drafts.map(row=>{const d=object(row);if(!Array.isArray(d.to)||typeof d.subject!=='string'||typeof d.snippet!=='string')throw new CloudProtocolError('invalid-response');return {draftId:string(d.draftId),messageId:string(d.messageId),subject:d.subject,to:d.to.map(string),snippet:d.snippet,updatedAt:optionalString(d.updatedAt)};});
    return {drafts,nextPageToken:next==null?null:next};
  }
  /** Exact provider draft content and its raw-MIME digest from one snapshot. */
  async gmailDraftContent(grantId:string,draftId:string,signal:AbortSignal):Promise<GmailDraftContent>{
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/draft?${new URLSearchParams({grantId,draftId,content:'1'})}`,signal,{authenticated:true});
    if(data.id!==draftId||typeof data.providerDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.providerDigest))throw new CloudProtocolError('invalid-response');
    const content=object(data.content),list=(value:unknown)=>{if(!Array.isArray(value)||value.length>50)throw new CloudProtocolError('invalid-response');return value.map(string);};
    if(typeof content.subject!=='string'||typeof content.bodyText!=='string'||typeof content.threaded!=='boolean'||!Number.isSafeInteger(content.attachmentCount)||typeof content.plainText!=='boolean')throw new CloudProtocolError('invalid-response');
    return {draftId,messageId:string(data.messageId),providerDigest:data.providerDigest,to:list(content.to),cc:list(content.cc),bcc:list(content.bcc),subject:content.subject,bodyText:content.bodyText,threaded:content.threaded,attachmentCount:content.attachmentCount as number,plainText:content.plainText};
  }
  async gmailAttachment(grantId:string,messageId:string,partId:string,historyId:string,signal:AbortSignal){
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/attachment?${new URLSearchParams({grantId,messageId,partId,historyId})}`,signal,{authenticated:true});
    if(data.version!==1||data.messageId!==messageId||data.partId!==partId||data.historyId!==historyId)throw new CloudProtocolError('invalid-response');
    const file={name:string(data.name),mimeType:data.mimeType,dataBase64:string(data.dataBase64)} as MailAttachment;const checked=await reviewMailAttachment(file);if(checked.sha256!==data.sha256||checked.size!==data.size)throw new CloudProtocolError('invalid-response');return {...checked,dataBase64:file.dataBase64};
  }
  async gmailDraft(grantId:string,draftId:string,signal:AbortSignal){
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/draft?${new URLSearchParams({grantId,draftId})}`,signal,{authenticated:true});
    if(data.id!==draftId||typeof data.providerDigest!=='string'||!/[a-f0-9]{64}/.test(data.providerDigest))throw new CloudProtocolError('invalid-response');return {draftId,messageId:string(data.messageId),providerDigest:data.providerDigest};
  }
  private gmailInboxReceipt(value:unknown,requestId:string):GmailInboxReceipt {
    const data=object(value);if(data.requestId!==requestId||!['send','draft-create','draft-replace','draft-delete','archive','unarchive','trash','untrash','mark-read','mark-unread'].includes(String(data.kind))||!['prepared','dispatched','succeeded','rejected','outcome-unknown'].includes(String(data.state))||typeof data.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.reviewDigest))throw new CloudProtocolError('invalid-response');
    const providerResult=data.providerResult===null?null:object(data.providerResult);if((data.state==='succeeded')!==(providerResult!==null))throw new CloudProtocolError('invalid-response');
    return {requestId,kind:data.kind as GmailInboxReceipt['kind'],state:data.state as GmailInboxReceipt['state'],reviewDigest:data.reviewDigest,providerResult,rejectionCode:data.rejectionCode===null?null:string(data.rejectionCode)};
  }
  async gmailPrepareOperation(grantId:string,requestId:string,proposal:Record<string,unknown>,signal:AbortSignal) {
    const data=await this.call('/api/v1/eliza/google/gmail/inbox-v1/operations',signal,{authenticated:true,body:{grantId,requestId,proposal}});if(data.version!==1||data.providerExactlyOnce!==false)throw new CloudProtocolError('invalid-response');return {receipt:this.gmailInboxReceipt(data.receipt,requestId),review:object(data.review)};
  }
  /** One explicit reviewed dispatch. The caller persists its intent before calling.
   * Any lost/aborted response must use gmailOperation, never an automatic send retry. */
  async gmailDispatchOperation(grantId:string,requestId:string,reviewDigest:string,proposal:Record<string,unknown>,signal:AbortSignal) {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/operations/${encodeURIComponent(requestId)}/dispatch`,signal,{authenticated:true,body:{grantId,reviewDigest,proposal},timeoutMs:45000});if(data.version!==1||data.providerExactlyOnce!==false)throw new CloudProtocolError('invalid-response');return this.gmailInboxReceipt(data.receipt,requestId);
  }
  async gmailOperation(grantId:string,requestId:string,signal:AbortSignal) {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/operations/${encodeURIComponent(requestId)}?${new URLSearchParams({grantId})}`,signal,{authenticated:true});if(data.version!==1||data.providerExactlyOnce!==false)throw new CloudProtocolError('invalid-response');return this.gmailInboxReceipt(data.receipt,requestId);
  }
  async gmailStatus(signal: AbortSignal): Promise<GoogleConnection> {
    const data = await this.call("/api/v1/eliza/google/status?side=owner", signal, { authenticated: true });
    if (typeof data.configured !== "boolean" || typeof data.connected !== "boolean" || !Array.isArray(data.grantedCapabilities)) throw new CloudProtocolError("invalid-response");
    return { configured: data.configured, connected: data.connected, reason: string(data.reason),
      connectionId: optionalString(data.connectionId), grantedCapabilities: data.grantedCapabilities.map(string) };
  }
}
