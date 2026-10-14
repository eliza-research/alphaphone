/**
 * Alpha AOSP telephony contract (issues #420 and #421): Contacts, Telecom and SMS/MMS on the Alpha
 * AOSP image only. Standalone and other non-image installs have no AlphaTelephony native plugin, and
 * this client refuses every call there before anything reaches native code.
 *
 * Text messaging is device and SIM based. There is no SMS account, OAuth grant or Cloud provider:
 * identity is the device's own subscription (SIM slot, carrier) and the user's selected Android
 * default SMS and dialer roles. Alpha never claims a call was placed or a message was sent from a
 * handoff: the system dialer or the user's SMS app owns that step, and the receipt says so.
 */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
export type TelephonyRole = 'dialer' | 'sms';
/** `eligible`: Alpha declares the components Android requires before granting the role. Until then
 * a request is not offered, and the user's current dialer or SMS app keeps the role. */
export interface RoleState { available: boolean; held: boolean; eligible: boolean }
/** One active subscription. Only present while the user has granted phone-state access. */
export interface Subscription { id: number; slot: number; displayName: string; carrierName: string; defaultSms: boolean; defaultVoice: boolean }
export interface TelephonyStatus {
  version: 1;
  voiceCapable: boolean;
  smsCapable: boolean;
  permissions: { contacts: PermissionState; phoneState: PermissionState };
  roles: Record<TelephonyRole, RoleState>;
  /** Package Android uses today; null when none or unknown. Alpha may or may not hold it. */
  defaultDialer: string | null;
  defaultSms: string | null;
  /** Null until phone-state access is granted: an unread list is never presented as "no SIM". */
  subscriptions: Subscription[] | null;
}
export interface ContactCard { id: string; lookupKey: string; displayName: string; phoneNumbers: string[]; emailAddresses: string[]; starred: boolean }
export type HandoffStatus = 'handed-off' | 'unavailable' | 'cancelled' | 'failed';
/** A handoff names who owns the effect next. It is never "sent", "delivered" or "called". */
export interface HandoffResult { status: HandoffStatus; target: 'dialer' | 'sms'; handler: string | null; message: string }
export interface AlphaTelephonyPlugin {
  imageCapability(): Promise<unknown>;
  status(): Promise<unknown>;
  requestAccess(options: { access: 'contacts' | 'phoneState' }): Promise<unknown>;
  requestRole(options: { role: TelephonyRole }): Promise<unknown>;
  searchContacts(options: { query: string; limit: number }): Promise<unknown>;
  dial(options: { number: string }): Promise<unknown>;
  composeSms(options: { recipients: string[]; body: string }): Promise<unknown>;
}

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

export function parseImageCapability(value: unknown): { version: 1; image: true; feature: string } {
  const data = object(value, 'image capability');
  if (data.version !== 1 || data.image !== true) throw invalid('image capability');
  return { version: 1, image: true, feature: text(data.feature, 'image feature') };
}

export function parseTelephonyStatus(value: unknown): TelephonyStatus {
  const data = object(value, 'status');
  if (data.version !== 1) throw invalid('status version');
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
  return { version: 1, voiceCapable: bool(data.voiceCapable, 'voice capability'), smsCapable: bool(data.smsCapable, 'SMS capability'),
    permissions: { contacts: permission(permissions.contacts, 'contacts permission'), phoneState },
    roles: { dialer: role('dialer'), sms: role('sms') },
    defaultDialer: nullableText(data.defaultDialer, 'default dialer'), defaultSms: nullableText(data.defaultSms, 'default SMS app'), subscriptions };
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
export type SmsReviewProblem = 'no-recipient' | 'invalid-recipient' | 'too-many-recipients' | 'empty-body' | 'body-too-long' | 'sim-unknown' | 'sim-required' | 'sim-not-selectable';
/** Validates a draft against the current status. A handoff leaves the SIM to the SMS app, so a SIM
 * choice is refused there rather than silently dropped. A direct send (only while Alpha holds the
 * user-selected SMS role) needs one active SIM, or the user's explicit choice among several; a
 * subscription that is not active now is refused rather than silently replaced. */
export function reviewSms(draft: { recipients: unknown[]; body: unknown; subscriptionId?: unknown }, status: TelephonyStatus, mode: 'handoff' | 'direct' = 'handoff'): { review: SmsReview } | { problem: SmsReviewProblem } {
  if (!Array.isArray(draft.recipients) || !draft.recipients.length) return { problem: 'no-recipient' };
  if (draft.recipients.length > SMS_MAX_RECIPIENTS) return { problem: 'too-many-recipients' };
  const recipients: string[] = [];
  for (const raw of draft.recipients) { const number = normalizePhoneNumber(raw); if (!number) return { problem: 'invalid-recipient' }; if (!recipients.includes(number)) recipients.push(number); }
  if (typeof draft.body !== 'string' || !draft.body.trim()) return { problem: 'empty-body' };
  if (draft.body.length > SMS_MAX_BODY) return { problem: 'body-too-long' };
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

/** The renderer client. Off the verified image every method rejects without reaching native code. */
export function createAospTelephony(plugin: AlphaTelephonyPlugin | null, image: boolean) {
  const native = () => { if (!image || !plugin) throw new TelephonyUnavailable(); return plugin; };
  return {
    available: image && !!plugin,
    async status() { return parseTelephonyStatus(await native().status()); },
    async requestAccess(access: 'contacts' | 'phoneState') { return parseTelephonyStatus(await native().requestAccess({ access })); },
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
  };
}
export type AospTelephony = ReturnType<typeof createAospTelephony>;
