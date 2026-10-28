/**
 * Alpha AOSP telephony contract (issues #420 and #421): Contacts, Telecom and SMS/MMS on the Alpha
 * AOSP image only. Standalone and other non-image installs have no AlphaTelephony native plugin, and
 * this client refuses every call there before anything reaches native code.
 *
 * Text messaging is device and SIM based. There is no SMS account, OAuth grant or Cloud provider:
 * identity is the device's own subscription (SIM slot, carrier) and the user's selected Android
 * default SMS and dialer roles. Alpha never claims a call was placed or a message was sent from a
 * handoff: the system dialer or the user's SMS app owns that step, and the receipt says so.
 *
 * Messages (#421): bounded reads of SMS/MMS threads and messages from the Android providers with
 * stable IDs, direction and per-message status; coalesced change notices that carry no content; and
 * reviewed native sends when Android permits Alpha to send (status `sendMode: 'direct'`). A native
 * send returns the shared `sms.send.v1` result shape (elizaOS/eliza PR #36178): `submitted` proves only
 * that Android accepted the request, `sent` requires every sent callback, `delivered` every delivery
 * report. A repeated operation ID reads its record and never sends again.
 */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
export type TelephonyRole = 'dialer' | 'sms';
/** `eligible`: Alpha declares the components Android requires before granting the role. Until then
 * a request is not offered, and the user's current dialer or SMS app keeps the role. */
export interface RoleState { available: boolean; held: boolean; eligible: boolean }
/** One active subscription. Only present while the user has granted phone-state access. */
export interface Subscription { id: number; slot: number; displayName: string; carrierName: string; defaultSms: boolean; defaultVoice: boolean }
export interface TelephonyStatus {
  version: 2;
  voiceCapable: boolean;
  smsCapable: boolean;
  permissions: { contacts: PermissionState; phoneState: PermissionState; sms: PermissionState; sendSms: PermissionState };
  /** `direct`: Alpha may send after its native review (SEND_SMS held, SIM readable). Otherwise only the SMS app handoff. */
  sendMode: 'direct' | 'handoff';
  roles: Record<TelephonyRole, RoleState>;
  /** Package Android uses today; null when none or unknown. Alpha may or may not hold it. */
  defaultDialer: string | null;
  defaultSms: string | null;
  /** Null until phone-state access is granted: an unread list is never presented as "no SIM". */
  subscriptions: Subscription[] | null;
  /** Android's default SMS subscription when it is one of the active SIMs above; otherwise null. */
  defaultSmsSubscriptionId: number | null;
}
export interface ContactCard { id: string; lookupKey: string; displayName: string; phoneNumbers: string[]; emailAddresses: string[]; starred: boolean }
export type HandoffStatus = 'handed-off' | 'unavailable' | 'cancelled' | 'failed';
/** A handoff names who owns the effect next. It is never "sent", "delivered" or "called". */
export interface HandoffResult { status: HandoffStatus; target: 'dialer' | 'sms'; handler: string | null; message: string }
export interface AlphaTelephonyPlugin {
  imageCapability(): Promise<unknown>;
  status(): Promise<unknown>;
  requestAccess(options: { access: AccessKind }): Promise<unknown>;
  requestRole(options: { role: TelephonyRole }): Promise<unknown>;
  searchContacts(options: { query: string; limit: number }): Promise<unknown>;
  dial(options: { number: string }): Promise<unknown>;
  composeSms(options: { recipients: string[]; body: string }): Promise<unknown>;
  listThreads(options: { limit: number; before?: number; cursor?: string }): Promise<unknown>;
  listMessages(options: { threadId: string; limit: number; before?: number; cursor?: string }): Promise<unknown>;
  observeMessages(options: { enabled: boolean }): Promise<unknown>;
  sendSms(options: { operationId: string; recipients: string[]; body: string; subscriptionId: number }): Promise<unknown>;
  cancelSmsReview(options:{operationId:string}):Promise<unknown>;
  smsSendHistory(): Promise<unknown>;
  smsSendResult(options: { operationId: string }): Promise<unknown>;
  addListener?(event: 'messagesChanged' | 'smsSendUpdated', listener: (data: unknown) => void): Promise<{ remove(): Promise<void> | void }>;
}
export type AccessKind = 'contacts' | 'phoneState' | 'sms' | 'sendSms';

export class TelephonyUnavailable extends Error {
  readonly name = 'TelephonyUnavailable';
  constructor(message = 'Phone, Contacts and Messages are available only on the Alpha Phone system image.') { super(message); }
}
const invalid = (what: string) => new Error(`AlphaTelephony returned an invalid ${what}`);
const object = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(what);
  return value as Record<string, unknown>;
};
const bool = (value: unknown, what: string) => { if (typeof value !== 'boolean') throw invalid(what); return value; };
const text = (value: unknown, what: string, max = 256) => { if (typeof value !== 'string' || value.length > max) throw invalid(what); return value; };
const nullableText = (value: unknown, what: string) => value === null || value === undefined ? null : text(value, what);
const PERMISSIONS: readonly PermissionState[] = ['granted', 'denied', 'prompt', 'prompt-with-rationale'];
const permission = (value: unknown, what: string): PermissionState => { if (!PERMISSIONS.includes(value as PermissionState)) throw invalid(what); return value as PermissionState; };

export function parseTelephonyStatus(value: unknown): TelephonyStatus {
  const data = object(value, 'status');
  if (data.version !== 2) throw invalid('status version');
  const permissions = object(data.permissions, 'permissions'), roles = object(data.roles, 'roles');
  const role = (name: TelephonyRole): RoleState => { const r = object(roles[name], `${name} role`); const available = bool(r.available, `${name} role`), held = bool(r.held, `${name} role`), eligible = bool(r.eligible, `${name} role`); if (held && !available) throw invalid(`${name} role`); return { available, held, eligible }; };
  const phoneState = permission(permissions.phoneState, 'phone-state permission');
  let subscriptions: Subscription[] | null = null;
  if (data.subscriptions !== null && data.subscriptions !== undefined) {
    // A list read without phone-state access cannot be trusted as the device's SIM inventory.
    if (!Array.isArray(data.subscriptions) || data.subscriptions.length > 8 || phoneState !== 'granted') throw invalid('subscriptions');
    const seen = new Set<number>();
    subscriptions = data.subscriptions.map(row => {
      const s = object(row, 'subscription');
      if (!Number.isSafeInteger(s.id) || (s.id as number) < 0 || seen.has(s.id as number) || !Number.isSafeInteger(s.slot) || (s.slot as number) < 0) throw invalid('subscription');
      seen.add(s.id as number);
      return { id: s.id as number, slot: s.slot as number, displayName: text(s.displayName, 'subscription name'), carrierName: text(s.carrierName, 'carrier name'), defaultSms: bool(s.defaultSms, 'subscription'), defaultVoice: bool(s.defaultVoice, 'subscription') };
    });
  }
  const sendSms = permission(permissions.sendSms, 'send permission'), smsCapable = bool(data.smsCapable, 'SMS capability');
  if (data.sendMode !== 'direct' && data.sendMode !== 'handoff') throw invalid('send mode');
  // Direct sends need the send permission, a readable SIM list and SMS hardware; a claim without them is refused.
  if (data.sendMode === 'direct' && (sendSms !== 'granted' || phoneState !== 'granted' || !smsCapable)) throw invalid('send mode');
  let defaultSmsSubscriptionId: number | null = null;
  if (data.defaultSmsSubscriptionId !== null && data.defaultSmsSubscriptionId !== undefined) {
    const marked = subscriptions?.filter(sim => sim.defaultSms) ?? [];
    if (marked.length !== 1 || marked[0].id !== data.defaultSmsSubscriptionId) throw invalid('default SMS subscription');
    defaultSmsSubscriptionId = marked[0].id;
  }
  return { version: 2, voiceCapable: bool(data.voiceCapable, 'voice capability'), smsCapable,
    permissions: { contacts: permission(permissions.contacts, 'contacts permission'), phoneState, sms: permission(permissions.sms, 'SMS permission'), sendSms },
    sendMode: data.sendMode, roles: { dialer: role('dialer'), sms: role('sms') },
    defaultDialer: nullableText(data.defaultDialer, 'default dialer'), defaultSms: nullableText(data.defaultSms, 'default SMS app'), subscriptions, defaultSmsSubscriptionId };
}

export function parseContacts(value: unknown, limit: number): ContactCard[] {
  const data = object(value, 'contacts');
  if (!Array.isArray(data.contacts) || data.contacts.length > limit) throw invalid('contacts');
  const strings = (list: unknown, what: string) => { if (!Array.isArray(list) || list.length > 32) throw invalid(what); return list.map(item => text(item, what)); };
  return data.contacts.map(row => {
    const c = object(row, 'contact');
    return { id: text(c.id, 'contact id', 64), lookupKey: text(c.lookupKey, 'contact lookup key', 512), displayName: text(c.displayName, 'contact name'),
      phoneNumbers: strings(c.phoneNumbers, 'contact numbers'), emailAddresses: strings(c.emailAddresses, 'contact emails'), starred: bool(c.starred, 'contact') };
  });
}

const HANDOFF: readonly HandoffStatus[] = ['handed-off', 'unavailable', 'cancelled', 'failed'];
export function parseHandoff(value: unknown, target: 'dialer' | 'sms'): HandoffResult {
  const data = object(value, 'handoff');
  if (!HANDOFF.includes(data.status as HandoffStatus) || data.target !== target) throw invalid('handoff');
  return { status: data.status as HandoffStatus, target, handler: nullableText(data.handler, 'handoff handler'), message: text(data.message, 'handoff message', 1024) };
}

/** A dialable number: digits with an optional leading +, and the separators people type. Letters,
 * USSD/MMI sequences and pauses are refused here; the system dialer remains available for them. */
export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]{2,40}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[\s().-]/g, '');
  return /^\+?\d{2,20}$/.test(digits) ? digits : null;
}

/** The reviewed content of one outgoing text. The user sees exactly this before anything leaves
 * Alpha, and the SMS app shows it again before its own send. */
export interface SmsReview { recipients: string[]; body: string; subscriptionId: number | null }
export const SMS_MAX_RECIPIENTS = 10, SMS_MAX_BODY = 5000;
/** Bounds of a native send, equal to the shared `sms.send.v1` contract. */
export const SMS_DIRECT_MAX_RECIPIENTS = 5, SMS_DIRECT_MAX_BODY = 1600;
export type SmsReviewProblem = 'no-recipient' | 'invalid-recipient' | 'too-many-recipients' | 'empty-body' | 'body-too-long' | 'invalid-body' | 'sim-unknown' | 'sim-required' | 'sim-not-selectable';
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
/** Validates a draft against the current status. A handoff leaves the SIM to the SMS app, so a SIM
 * choice is refused there rather than silently dropped. A direct send (only while Alpha holds the
 * user-selected SMS role) needs one active SIM, or the user's explicit choice among several; a
 * subscription that is not active now is refused rather than silently replaced. */
export function reviewSms(draft: { recipients: unknown[]; body: unknown; subscriptionId?: unknown }, status: TelephonyStatus, mode: 'handoff' | 'direct' = 'handoff'): { review: SmsReview } | { problem: SmsReviewProblem } {
  if (!Array.isArray(draft.recipients) || !draft.recipients.length) return { problem: 'no-recipient' };
  if (draft.recipients.length > (mode === 'direct' ? SMS_DIRECT_MAX_RECIPIENTS : SMS_MAX_RECIPIENTS)) return { problem: 'too-many-recipients' };
  const recipients: string[] = [];
  for (const raw of draft.recipients) { const number = normalizePhoneNumber(raw); if (!number) return { problem: 'invalid-recipient' }; if (!recipients.includes(number)) recipients.push(number); }
  if (typeof draft.body !== 'string' || !draft.body.trim()) return { problem: 'empty-body' };
  if (draft.body.length > (mode === 'direct' ? SMS_DIRECT_MAX_BODY : SMS_MAX_BODY)) return { problem: 'body-too-long' };
  if (mode === 'direct' && (draft.body.includes('\0') || LONE_SURROGATE.test(draft.body))) return { problem: 'invalid-body' };
  const active = status.subscriptions;
  let subscriptionId: number | null = null;
  const chosen = draft.subscriptionId !== undefined && draft.subscriptionId !== null;
  if (mode === 'handoff') return chosen ? { problem: 'sim-not-selectable' } : { review: { recipients, body: draft.body, subscriptionId: null } };
  if (!active) return { problem: 'sim-unknown' };
  if (chosen) {
    if (!active.some(sim => sim.id === draft.subscriptionId)) return { problem: 'sim-unknown' };
    subscriptionId = draft.subscriptionId as number;
  } else if (active.length !== 1) return { problem: active.length ? 'sim-required' : 'sim-unknown' };
  else subscriptionId = active[0].id;
  return { review: { recipients, body: draft.body, subscriptionId } };
}

/**
 * Outgoing message states. A handoff ends Alpha's part; a direct send (only possible while Alpha
 * holds the user-selected SMS role) records the radio's report. `outcome-unknown` and `handed-off`
 * are terminal for Alpha: neither may be repeated automatically, because the message may exist.
 */
export type SmsSendState = 'reviewed' | 'handed-off' | 'dispatched' | 'sent' | 'delivered' | 'failed' | 'outcome-unknown';
const SMS_NEXT: Record<SmsSendState, readonly SmsSendState[]> = {
  reviewed: ['handed-off', 'dispatched', 'failed'],
  dispatched: ['sent', 'failed', 'outcome-unknown'],
  sent: ['delivered'],
  'handed-off': [], delivered: [], failed: [], 'outcome-unknown': [],
};
export function advanceSmsState(from: SmsSendState, to: SmsSendState): SmsSendState {
  if (!SMS_NEXT[from].includes(to)) throw new Error(`An outgoing message cannot move from ${from} to ${to}`);
  return to;
}
/** Only a review that never left Alpha, or a send the radio definitively refused, may be offered again,
 * and then only as a new explicit review. */
export function smsMayBeReviewedAgain(state: SmsSendState): boolean { return state === 'reviewed' || state === 'failed'; }

// ---- Messages: provider reads -----------------------------------------------------------------

export type MessageDirection = 'incoming' | 'outgoing';
/** Incoming: received or read. Outgoing: pending, sent, failed or delivered (SMS delivery report only). */
export type MessageStatus = 'received' | 'read' | 'pending' | 'sent' | 'failed' | 'delivered';
export interface SmsThread { id: string; date: number; messageCount: number; snippet: string; unread: boolean; addresses: string[] }
export interface SmsMessage {
  /** Stable: `sms:<row>` or `mms:<row>`. */
  id: string; kind: 'sms' | 'mms'; threadId: string; direction: MessageDirection; status: MessageStatus;
  date: number; read: boolean; subscriptionId: number | null; addresses: string[]; body: string;
  /** SMS only: the delivery report Android recorded. MMS delivery is never claimed. */
  deliveryReport: 'none' | 'pending' | 'complete' | 'failed' | null;
  attachments: number;
}
export const SMS_MAX_THREADS = 50, SMS_MAX_MESSAGES = 50;
const THREAD_ID = /^thread:[1-9]\d{0,17}$/, MESSAGE_ID = /^(sms|mms):[1-9]\d{0,17}$/;
const count = (value: unknown, what: string) => { if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(what); return value as number; };
const addresses = (value: unknown) => { if (!Array.isArray(value) || value.length > 20) throw invalid('message addresses'); return value.map(item => text(item, 'message address', 64)); };
export function parseThreads(value: unknown, limit: number): SmsThread[] {
  const data = object(value, 'threads');
  if (!Array.isArray(data.threads) || data.threads.length > limit) throw invalid('threads');
  const seen = new Set<string>();
  return data.threads.map(row => {
    const t = object(row, 'thread'), id = text(t.id, 'thread id', 32);
    if (!THREAD_ID.test(id) || seen.has(id)) throw invalid('thread id');
    seen.add(id);
    return { id, date: count(t.date, 'thread date'), messageCount: count(t.messageCount, 'thread count'), snippet: text(t.snippet, 'thread snippet', 160), unread: bool(t.unread, 'thread'), addresses: addresses(t.addresses) };
  });
}
const INCOMING: readonly MessageStatus[] = ['received', 'read'], OUTGOING: readonly MessageStatus[] = ['pending', 'sent', 'failed', 'delivered'];
const REPORTS = ['none', 'pending', 'complete', 'failed'] as const;
export function parseMessages(value: unknown, threadId: string, limit: number): SmsMessage[] {
  const data = object(value, 'messages');
  if (!Array.isArray(data.messages) || data.messages.length > limit) throw invalid('messages');
  const seen = new Set<string>();
  return data.messages.map(row => {
    const m = object(row, 'message'), id = text(m.id, 'message id', 32);
    const kind = m.kind, direction = m.direction, status = m.status as MessageStatus;
    if (!MESSAGE_ID.test(id) || seen.has(id) || !id.startsWith(`${kind}:`) || m.threadId !== threadId) throw invalid('message id');
    seen.add(id);
    if (direction !== 'incoming' && direction !== 'outgoing') throw invalid('message direction');
    if (!(direction === 'incoming' ? INCOMING : OUTGOING).includes(status)) throw invalid('message status');
    const report = m.deliveryReport === null ? null : m.deliveryReport as SmsMessage['deliveryReport'];
    // Delivery reports exist only for outgoing SMS, and "delivered" only with a complete one.
    if (report !== null && (kind !== 'sms' || direction !== 'outgoing' || !REPORTS.includes(report))) throw invalid('delivery report');
    if (kind === 'sms' && direction === 'outgoing' && report === null) throw invalid('delivery report');
    if (status === 'delivered' && report !== 'complete') throw invalid('message status');
    const subscriptionId = m.subscriptionId === null ? null : count(m.subscriptionId, 'message subscription');
    return { id, kind: kind as 'sms' | 'mms', threadId, direction, status, date: count(m.date, 'message date'), read: bool(m.read, 'message'), subscriptionId,
      addresses: addresses(m.addresses), body: text(m.body, 'message body', 2000), deliveryReport: report, attachments: count(m.attachments, 'attachments') };
  });
}

// ---- Messages: reviewed native sends (shared `sms.send.v1` contract) ---------------------------

export type SmsPartState = 'unknown' | 'success' | 'failed';
export interface SmsSendResult {
  kind: 'sms-send'; operationId: string; subscriptionId: number; bindingHash: string;
  status: 'cancelled' | 'denied' | 'failed' | 'unknown' | 'submitted' | 'sent' | 'delivered';
  parts: { index: number; recipientIndex: number; partIndex: number; sent: SmsPartState; delivery: SmsPartState }[];
  createdAt: number;
}
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** The shared contract's binding text: fixed field order, hashed as UTF-8 SHA-256 by the native journal. */
export function smsBindingText(review: SmsReview & { subscriptionId: number }): string {
  return JSON.stringify({ body: review.body, recipients: review.recipients, subscriptionId: review.subscriptionId, type: 'sms_send' });
}
export async function smsBindingHash(review: SmsReview & { subscriptionId: number }): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(smsBindingText(review)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const exact = (value: Record<string, unknown>, keys: string[]) => { if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid('SMS send result'); };
const PART_STATES: readonly SmsPartState[] = ['unknown', 'success', 'failed'];
/** Mirrors `validateSmsResult` of the shared contract: binding, part order and status evidence. */
export function parseSmsSendResult(value: unknown, review: SmsReview & { subscriptionId: number }, operationId: string, bindingHash: string): SmsSendResult {
  const v = object(value, 'SMS send result');
  exact(v, ['kind', 'operationId', 'subscriptionId', 'bindingHash', 'status', 'parts', 'createdAt']);
  const status = v.status as SmsSendResult['status'];
  if (v.kind !== 'sms-send' || v.operationId !== operationId || !OPERATION_ID.test(operationId) || v.subscriptionId !== review.subscriptionId || v.bindingHash !== bindingHash || !/^[a-f0-9]{64}$/.test(bindingHash)
    || !['cancelled', 'denied', 'failed', 'unknown', 'submitted', 'sent', 'delivered'].includes(status) || !Number.isSafeInteger(v.createdAt) || (v.createdAt as number) <= 0 || !Array.isArray(v.parts) || v.parts.length > 50) throw invalid('SMS send result');
  const counts = review.recipients.map(() => 0);
  let previous = 0;
  const parts = v.parts.map((raw, index) => {
    const p = object(raw, 'SMS part');
    exact(p, ['index', 'recipientIndex', 'partIndex', 'sent', 'delivery']);
    const recipient = p.recipientIndex as number;
    if (p.index !== index || !Number.isInteger(recipient) || recipient < previous || recipient > previous + 1 || recipient >= counts.length || (index === 0 && recipient !== 0)
      || p.partIndex !== counts[recipient] || counts[recipient] >= 10 || !PART_STATES.includes(p.sent as SmsPartState) || !PART_STATES.includes(p.delivery as SmsPartState)
      || (p.delivery === 'success' && p.sent !== 'success')) throw invalid('SMS part evidence');
    counts[recipient]++; previous = recipient;
    return { index, recipientIndex: recipient, partIndex: p.partIndex as number, sent: p.sent as SmsPartState, delivery: p.delivery as SmsPartState };
  });
  if ((['cancelled', 'denied'].includes(status) && parts.length) || (['submitted', 'sent', 'delivered'].includes(status) && counts.some(n => !n))
    || (['sent', 'delivered'].includes(status) && parts.some(p => p.sent !== 'success')) || (status === 'delivered' && parts.some(p => p.delivery !== 'success'))) throw invalid('SMS send status');
  return { kind: 'sms-send', operationId, subscriptionId: review.subscriptionId, bindingHash, status, parts, createdAt: v.createdAt as number };
}
/** Display-only journal metadata. Never use this in place of a request-bound action receipt. */
export function parseSmsJournal(value: unknown): SmsSendResult[] {
 const data=object(value,'SMS journal');
 if(!Array.isArray(data.receipts)||data.receipts.length>200)throw invalid('SMS journal');
 const seen=new Set<string>();
 return data.receipts.map(raw=>{
  const row=object(raw,'SMS journal receipt');
  if(typeof row.operationId!=='string'||seen.has(row.operationId)||!Number.isSafeInteger(row.subscriptionId)||(row.subscriptionId as number)<0||typeof row.bindingHash!=='string'||!Array.isArray(row.parts))throw invalid('SMS journal receipt');
  seen.add(row.operationId);
  let recipients=1;
  for(const rawPart of row.parts){const part=object(rawPart,'SMS journal part');if(!Number.isInteger(part.recipientIndex)||(part.recipientIndex as number)<0||(part.recipientIndex as number)>4)throw invalid('SMS journal recipient');recipients=Math.max(recipients,(part.recipientIndex as number)+1);}
  return parseSmsSendResult(row,{recipients:Array(recipients).fill('display-only'),body:'',subscriptionId:row.subscriptionId as number},row.operationId,row.bindingHash);
 });
}

/** The renderer client. Off the verified image every method rejects without reaching native code. */
export function createAospTelephony(plugin: AlphaTelephonyPlugin | null, image: boolean) {
  const native = () => { if (!image || !plugin) throw new TelephonyUnavailable(); return plugin; };
  return {
    available: image && !!plugin,
    async status() { return parseTelephonyStatus(await native().status()); },
    async requestAccess(access: AccessKind) { return parseTelephonyStatus(await native().requestAccess({ access })); },
    async requestRole(role: TelephonyRole) { return parseTelephonyStatus(await native().requestRole({ role })); },
    async searchContacts(query: string, limit = 25) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Contact search limit must be 1 to 100');
      return parseContacts(await native().searchContacts({ query: String(query).slice(0, 128), limit }), limit);
    },
    /** Opens the user's dialer with the number filled in. The person places the call there; the
     * system dialer also handles emergency numbers. */
    async dial(number: string) {
      const plugin = native(); const normalized = normalizePhoneNumber(number);
      if (!normalized) throw new RangeError('Not a dialable phone number');
      return parseHandoff(await plugin.dial({ number: normalized }), 'dialer');
    },
    /** Opens the user's SMS app with the reviewed recipients and text. Sending happens there. */
    async composeSms(review: SmsReview) {
      const plugin = native();
      // The SMS app chooses or asks for the SIM; a handoff cannot honour a choice made here.
      if (review.subscriptionId !== null) throw new RangeError('Choose the SIM in your messaging app; a handoff cannot select it');
      return parseHandoff(await plugin.composeSms({ recipients: review.recipients, body: review.body }), 'sms');
    },
    async listThreads(limit = 20, before?: number) {
      const plugin = native();
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > SMS_MAX_THREADS) throw new RangeError('Thread limit must be 1 to 50');
      if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) throw new RangeError('Invalid page cursor');
      return parseThreads(await plugin.listThreads(before === undefined ? { limit } : { limit, before }), limit);
    },
    async listMessages(threadId: string, limit = 25, before?: number) {
      const plugin = native();
      if (!THREAD_ID.test(threadId)) throw new RangeError('Invalid thread');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > SMS_MAX_MESSAGES) throw new RangeError('Message limit must be 1 to 50');
      if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) throw new RangeError('Invalid page cursor');
      return parseMessages(await plugin.listMessages(before === undefined ? { threadId, limit } : { threadId, limit, before }), threadId, limit);
    },
    async threadPage(cursor?: string) {
      const plugin = native();
      if (cursor !== undefined && !/^\d{1,16}:thread:[1-9]\d{0,17}$/.test(cursor)) throw new RangeError('Invalid thread cursor');
      const value = object(await plugin.listThreads({ limit: 50, ...(cursor ? {cursor} : {}) }), 'thread page');
      const rows = parseThreads(value, 50), next = value.next;
      if (next !== null && (typeof next !== 'string' || !/^\d{1,16}:thread:[1-9]\d{0,17}$/.test(next))) throw invalid('thread cursor');
      if (next && (!rows.length || next === cursor)) throw invalid('thread progress');
      return { rows, next: next as string | null };
    },
    async messagePage(threadId: string, cursor?: string) {
      const plugin = native();
      if (!THREAD_ID.test(threadId) || (cursor !== undefined && !/^\d{1,16}:(sms|mms):[1-9]\d{0,17}$/.test(cursor))) throw new RangeError('Invalid message cursor');
      const value = object(await plugin.listMessages({ threadId, limit: 50, ...(cursor ? {cursor} : {}) }), 'message page');
      const rows = parseMessages(value, threadId, 50), next = value.next;
      if (next !== null && (typeof next !== 'string' || !/^\d{1,16}:(sms|mms):[1-9]\d{0,17}$/.test(next))) throw invalid('message cursor');
      if (next && (!rows.length || next === cursor)) throw invalid('message progress');
      return { rows, next: next as string | null };
    },
    /** Change notices carry no message content; re-read a bounded page. Returns the stop function. */
    async observeMessages(onChange: () => void, onSendUpdated?: (operationId: string) => void) {
      const plugin = native();
      if (!plugin.addListener) throw new TelephonyUnavailable();
      const handles = [await plugin.addListener('messagesChanged', () => onChange())];
      if (onSendUpdated) handles.push(await plugin.addListener('smsSendUpdated', data => {
        const id = (data as { operationId?: unknown } | null)?.operationId;
        if (typeof id === 'string' && OPERATION_ID.test(id)) onSendUpdated(id);
      }));
      try { await plugin.observeMessages({ enabled: true }); }
      catch (error) { for (const handle of handles) await handle.remove(); throw error; }
      return async () => { for (const handle of handles) await handle.remove(); await plugin.observeMessages({ enabled: false }); };
    },
    /** A reviewed native send. Alpha's native dialog shows the exact content again before anything is sent.
     * Reusing an operation ID returns its record and never sends twice. */
    async sendSms(review: SmsReview, operationId: string) {
      const plugin = native();
      if (!OPERATION_ID.test(operationId)) throw new RangeError('Invalid operation ID');
      if (review.subscriptionId === null || !Number.isSafeInteger(review.subscriptionId)) throw new RangeError('A native send needs the reviewed SIM');
      if (review.recipients.length > SMS_DIRECT_MAX_RECIPIENTS || review.body.length > SMS_DIRECT_MAX_BODY) throw new RangeError('Too large for a native send');
      const bound = { ...review, subscriptionId: review.subscriptionId };
      const hash = await smsBindingHash(bound);
      return parseSmsSendResult(await plugin.sendSms({ operationId, recipients: review.recipients, body: review.body, subscriptionId: review.subscriptionId }), bound, operationId, hash);
    },
    async smsSendHistory() { return parseSmsJournal(await native().smsSendHistory()); },
    /** Reads the journaled result; never sends. */
    async smsSendResult(review: SmsReview & { subscriptionId: number }, operationId: string) {
      const plugin = native();
      if (!OPERATION_ID.test(operationId)) throw new RangeError('Invalid operation ID');
      return parseSmsSendResult(await plugin.smsSendResult({ operationId }), review, operationId, await smsBindingHash(review));
    },
  };
}
export type AospTelephony = ReturnType<typeof createAospTelephony>;
