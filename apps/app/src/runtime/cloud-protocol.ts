import { cloudDeployment } from './cloud-deployment.ts';
import { CloudPersonalProtocol, PersonalProtocolError } from './cloud-personal-protocol.ts';
import { gmailReturnURL } from './alpha-gmail.ts';
import { reviewMailAttachment, type MailAttachment } from './inbox-attachment.ts';
/** Narrow Alpha adapter for Eliza Cloud. Contracts inspected in v3's
 * cloud/api/auth/cli-session, cloud/api/v1/eliza/{agents,google}, and
 * ui/src/api/client-cloud.ts. Native composition owns HTTP and secure storage.
 * This module never stores credentials in renderer persistence or logs them. */
export type CloudEnvironment = "production" | "staging";
export interface CloudCredential {
  /** Local generation identifier, never an authentication credential. */
  credentialId?: string;
  token: string;
  expiresAt?: number;
  userId?: string;
  organizationId?: string;
}
export interface CloudCredentialStore {
  read(environment: CloudEnvironment): Promise<CloudCredential | null>;
  /** Must atomically reject an aborted signal before committing to native secure storage. */
  write(environment: CloudEnvironment, credential: CloudCredential, signal: AbortSignal): Promise<void>;
  clear(environment: CloudEnvironment): Promise<void>;
}
/** The native adapter must enforce the timeout and AbortSignal, reject redirects,
 * and return decoded JSON. It must never log headers, bodies, or auth URLs. */
export interface CloudNativeRequest {
  (input: { url: string; method: "GET" | "POST"; headers: Record<string, string>;
    body?: unknown; signal: AbortSignal; timeoutMs: number; redirect: "error";
  }): Promise<{ status: number; data: unknown }>;
}
export interface CloudLoginAttempt { sessionId: string; expiresAt: number }
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
}
export interface GmailInboxReceipt {
  requestId:string; kind:'send'|'draft-create'|'draft-replace'|'draft-delete'|'archive'|'unarchive'|'trash'|'untrash';
  reviewDigest:string; state:'prepared'|'dispatched'|'succeeded'|'rejected'|'outcome-unknown';
  providerResult:Record<string,unknown>|null; rejectionCode:string|null;
}
export interface GmailAccount extends GoogleConnection { label: string }
export interface GmailMessage {
  id: string; threadId: string; subject: string; from: string; fromEmail: string | null;
  to: string[]; cc?: string[]; replyTo?: string | null; snippet: string; receivedAt: string; unread: boolean;
}
export class CloudProtocolError extends Error {
  constructor(readonly code: "invalid-response" | "http" | "expired" | "credentials-missing" | "credential-consumed" | "login-active", readonly status?: number, readonly data?: unknown) {
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
  async phoneRequest(target: CloudPhoneTarget, path: string, signal: AbortSignal, body?: unknown): Promise<Record<string,unknown>> {
    if (!/^\/api\/(?:client-devices|workflow|conversations)(?:\/|\?|$)/.test(path) || path.includes('..') || /[\\#\s]/.test(path)) throw new Error('Invalid phone route');
    const credential = await this.credentials.read(this.environment); signal.throwIfAborted();
    if (!credential || credential.credentialId !== target.credentialId) throw new Error('Cloud account changed');
    const identity = await this.identity(signal);
    if (identity.userId !== target.userId || identity.organizationId !== target.organizationId) throw new Error('Cloud owner changed');
    const agent = await this.agentDetail(target.agentId, signal);
    if (agent.runtimeUrl !== target.origin || !['dedicated-lazy','dedicated-always','custom'].includes(agent.executionTier || '')) throw new Error('Verified dedicated runtime unavailable');
    const result = await this.call(path, signal, {authenticated:true,runtimeBase:target.origin,body,timeoutMs:120000,headers:{...target.headers,'X-Eliza-Phone-Protocol':'1'},credentialId:target.credentialId});
    if ((await this.credentials.read(this.environment))?.credentialId !== target.credentialId) throw new Error('Cloud account changed');
    signal.throwIfAborted(); return result;
  }
  private activeLogin: AbortController | null = null;
  constructor(readonly environment: CloudEnvironment, private readonly request: CloudNativeRequest,
    private readonly credentials: CloudCredentialStore,
    private readonly authenticate?: (signal: AbortSignal) => Promise<string>) {}
  private get authority() { return cloudDeployment(this.environment); }
  private async requestData(path: string, signal: AbortSignal, options: { body?: unknown; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string; onStatus?: (status:number)=>void } = {}) {
    signal.throwIfAborted();
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (options.authenticated) {
      const credential = await this.credentials.read(this.environment);
      signal.throwIfAborted();
      if (!credential) throw new CloudProtocolError("credentials-missing");
      if (options.credentialId && credential.credentialId !== options.credentialId) throw new Error("Cloud account changed");
      if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
      headers.Authorization = `Bearer ${credential.token}`;
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.request({ url: (options.runtimeBase ?? this.authority.api) + path,
      method: options.body === undefined ? "GET" : "POST", headers, body: options.body,
      signal, timeoutMs: options.timeoutMs ?? 30_000, redirect: "error" });
    signal.throwIfAborted();
    if (response.status < 200 || response.status >= 300) throw new CloudProtocolError("http", response.status, response.data);
    options.onStatus?.(response.status);
    return response.data;
  }
  private async call(path: string, signal: AbortSignal, options: { body?: unknown; authenticated?: boolean; runtimeBase?: string; timeoutMs?: number; headers?: Record<string,string>; credentialId?: string } = {}) {
    return object(await this.requestData(path, signal, options));
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
  async login(signal: AbortSignal, onWaiting?: (attempt: CloudLoginAttempt) => void, authenticate = this.authenticate): Promise<void> {
    if (this.activeLogin) throw new CloudProtocolError("login-active");
    signal.throwIfAborted();
    const controller = new AbortController();
    this.activeLogin = controller;
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!authenticate) throw new Error("Alpha Phone sign-in is unavailable on this platform.");
      const identityToken = string(await authenticate(controller.signal));
      controller.signal.throwIfAborted();
      // The server issues the UUID; client-chosen IDs are deliberately ignored.
      const created = await this.call("/api/auth/cli-session", controller.signal, { body: {} });
      const sessionId = uuid(created.sessionId);
      const expiresAt = timestamp(created.expiresAt);
      if (expiresAt <= Date.now()) throw new CloudProtocolError("expired");
      expiryTimer = setTimeout(() => controller.abort(new CloudProtocolError("expired")), Math.min(expiresAt - Date.now(), 2_147_483_647));
      onWaiting?.({ sessionId, expiresAt });
      const completed = await this.call(`/api/auth/cli-session/${sessionId}/complete`, controller.signal,
        { body: {}, headers: { Authorization: `Bearer ${identityToken}` } });
      if (completed.success !== true) throw new CloudProtocolError("invalid-response");
      while (true) {
        let response: ObjectValue;
        try { response = await this.call(`/api/auth/cli-session/${sessionId}`, controller.signal); }
        catch (error) {
          if (error instanceof CloudProtocolError && (error.status === 404 || error.status === 410)) throw new CloudProtocolError("expired");
          throw error;
        }
        const data = response.data == null ? response : object(response.data);
        if (data.status === "authenticated") {
          const token = ["token", "accessToken", "stewardToken", "sessionToken", "apiKey"]
            .flatMap(key => [response[key], data[key]]).find(value => typeof value === "string" && value.trim());
          if (!token) throw new CloudProtocolError("credential-consumed");
          const credential: CloudCredential = { token: string(token) };
          if (data.expiresAt != null) credential.expiresAt = timestamp(data.expiresAt);
          if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) throw new CloudProtocolError("expired");
          if (data.userId != null) credential.userId = string(data.userId);
          if (data.organizationId != null) credential.organizationId = string(data.organizationId);
          controller.signal.throwIfAborted();
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
  private runtimeUrl(value: unknown, id: string, tier: string | null): string | null {
    if (value == null) return tier === "shared" ? `${this.authority.api}/api/v1/eliza/agents/${id}` : null;
    let url: URL;
    try { url = new URL(string(value)); } catch { throw new CloudProtocolError("invalid-response"); }
    const sharedPath = `/api/v1/eliza/agents/${id}`;
    const dedicated = url.hostname === `${id}.${this.authority.agents}` && (url.pathname === "/" || url.pathname === "");
    const shared = url.origin === this.authority.api && url.pathname.replace(/\/$/, "") === sharedPath;
    if (url.protocol !== "https:" || url.username || url.password || (url.port && !shared) || url.search || url.hash || (!dedicated && !shared)) throw new CloudProtocolError("invalid-response");
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
  async identity(signal: AbortSignal): Promise<{ userId: string; organizationId?: string }> {
    const data = object(this.success(await this.call("/api/v1/user", signal, { authenticated: true })));
    return { userId: uuid(data.id), ...(data.organization_id == null ? {} : { organizationId: uuid(data.organization_id) }) };
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
    options: { metadata?: Record<string, unknown>; clientMessageId?: string; signal: AbortSignal },
  ): Promise<{ text: string; agentName: string; interrupted?: boolean; noResponseReason?: "ignored"; failureKind?: unknown; terminalFailure?: unknown }> {
    if (!text.trim()) throw new TypeError("Message must not be empty");
    const response = await this.runtimeCall(agentId,
      `/api/conversations/${encodeURIComponent(string(conversationId))}/messages`, options.signal,
      { text, channelType: "DM", ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}) });
    if (typeof response.text !== "string" || typeof response.agentName !== "string") throw new CloudProtocolError("invalid-response");
    if (response.terminalFailure || response.failureKind) throw new CloudProtocolError("invalid-response");
    return { text: response.text, agentName: response.agentName,
      ...(response.interrupted === true ? { interrupted: true } : {}),
      ...(response.noResponseReason === "ignored" ? { noResponseReason: "ignored" as const } : {}) };
  }
  async initiateGmail(signal: AbortSignal, permission: 'read'|'send'|'drafts'|'mailbox' = 'read', returnState?: string): Promise<string> {
    if (!returnState) throw new CloudProtocolError('invalid-response');
    const response = await this.call("/api/v1/eliza/google/connect/initiate", signal, { authenticated: true,
      body: { side: "owner", redirectUrl: gmailReturnURL(this.environment, returnState), capabilities: ["google.basic_identity", "google.gmail.triage", ...(permission === "read" ? [] : [permission === "send" ? "google.gmail.send" : permission === "drafts" ? "google.gmail.drafts" : "google.gmail.mailbox"])] } });
    // Older/unconfigured backends return to an Eliza frontend. Stay inside Alpha
    // rather than opening Google unless this exact app-return contract is enabled.
    if (response.appReturn !== 2) throw new CloudProtocolError('invalid-response');
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
      snippet: data.snippet, receivedAt: string(data.receivedAt), unread: data.isUnread };
  }
  async gmailSearch(grantId: string, query: string, signal: AbortSignal, maxResults: 25 | 50 = 25): Promise<{ messages: GmailMessage[]; syncedAt: string }> {
    const params = new URLSearchParams({ side: "owner", grantId: string(grantId), query: string(query), maxResults: String(maxResults) });
    const data = await this.call(`/api/v1/eliza/google/gmail/search?${params}`, signal, { authenticated: true });
    if (!Array.isArray(data.messages)) throw new CloudProtocolError("invalid-response");
    return { messages: data.messages.map(value => this.gmailMessage(value)), syncedAt: string(data.syncedAt) };
  }
  async gmailRead(grantId: string, messageId: string, signal: AbortSignal): Promise<{ message: GmailMessage; bodyText: string }> {
    const params = new URLSearchParams({ side: "owner", grantId: string(grantId), messageId: string(messageId) });
    const data = await this.call(`/api/v1/eliza/google/gmail/read?${params}`, signal, { authenticated: true });
    if (typeof data.bodyText !== "string") throw new CloudProtocolError("invalid-response");
    const message = this.gmailMessage(data.message);
    if (message.id !== messageId) throw new CloudProtocolError("invalid-response");
    return { message, bodyText: data.bodyText };
  }
  async gmailInboxCapabilities(grantId:string,signal:AbortSignal):Promise<GmailInboxCapabilities> {
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/capabilities?${new URLSearchParams({grantId})}`,signal,{authenticated:true});
    if(data.version!==1||data.providerExactlyOnce!==false||data.atomicDraftReplacement!==false||['threads','send','providerDrafts','mailboxMutations','attachments'].some(key=>typeof data[key]!=='boolean'))throw new CloudProtocolError('invalid-response');
    return {version:1,from:string(data.from),threads:data.threads as boolean,send:data.send as boolean,providerDrafts:data.providerDrafts as boolean,mailboxMutations:data.mailboxMutations as boolean,attachments:data.attachments as boolean,providerExactlyOnce:false,atomicDraftReplacement:false};
  }
  async gmailThread(grantId:string,threadId:string,signal:AbortSignal,cursor?:{offset:number;historyId:string}) {
    const params=new URLSearchParams({grantId,threadId});if(cursor){params.set('offset',String(cursor.offset));params.set('historyId',cursor.historyId);}
    const data=await this.call(`/api/v1/eliza/google/gmail/inbox-v1/thread?${params}`,signal,{authenticated:true});
    if(data.version!==1||data.threadId!==threadId||!Array.isArray(data.messages)||data.messages.length>25||!Number.isSafeInteger(data.total)||!Number.isSafeInteger(data.offset)||data.offset!==(cursor?.offset??0))throw new CloudProtocolError('invalid-response');
    const messages=data.messages.map(row=>{const item=object(row),message=this.gmailMessage(item.message);if(message.threadId!==threadId||typeof item.bodyText!=='string')throw new CloudProtocolError('invalid-response');return {message,bodyText:item.bodyText,historyId:typeof item.historyId==='string'?item.historyId:null,attachments:Array.isArray(item.attachments)?item.attachments.map(value=>{const a=object(value);if(typeof a.name!=='string'||typeof a.mimeType!=='string'||typeof a.size!=='number'||typeof a.supported!=='boolean')throw new CloudProtocolError('invalid-response');return {partId:typeof a.partId==='string'?a.partId:(()=>{throw new CloudProtocolError('invalid-response')})(),name:a.name,mimeType:a.mimeType,size:a.size,supported:a.supported};}):[]};});
    const total=data.total as number,offset=data.offset as number;if(total<offset+messages.length||total>2000||data.nextOffset!==(offset+messages.length<total?offset+messages.length:null))throw new CloudProtocolError('invalid-response');
    const historyId=string(data.historyId);if(cursor&&cursor.historyId!==historyId)throw new CloudProtocolError('invalid-response');return {messages,total,offset,historyId,nextOffset:data.nextOffset as number|null};
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
    const data=object(value);if(data.requestId!==requestId||!['send','draft-create','draft-replace','draft-delete','archive','unarchive','trash','untrash'].includes(String(data.kind))||!['prepared','dispatched','succeeded','rejected','outcome-unknown'].includes(String(data.state))||typeof data.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.reviewDigest))throw new CloudProtocolError('invalid-response');
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
