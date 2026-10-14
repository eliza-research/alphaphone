import { CloudProtocolError, type CloudEnvironment, type GmailAccount, type GoogleCalendarEvent, type GoogleCalendarFeed, type GoogleCalendarRange, type GoogleCalendarSummary } from './cloud-protocol.ts';
import type { CalendarRecord } from '../browser/calendar-records.ts';

/** Identifiers only. Credentials stay in CloudProtocol's secure credential store. */
export interface GoogleCalendarBinding {
  environment: CloudEnvironment;
  userId: string;
  organizationId: string;
  credentialId: string;
  sessionId: string;
  connectionId: string;
}
export interface GoogleCalendarClient {
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]>;
  googleCalendars(grantId: string, signal: AbortSignal): Promise<GoogleCalendarSummary[]>;
  googleCalendarFeed(grantId: string, calendarId: string, range: GoogleCalendarRange, signal: AbortSignal): Promise<GoogleCalendarFeed>;
}
export interface GoogleCalendarSource {
  id: string;
  name: string;
  account: string;
  connectionId: string;
  providerCalendarId: string;
  timeZone: string | null;
  primary: boolean;
  source: 'google';
  readOnly: true;
}
export interface GoogleCalendarRecord extends CalendarRecord {
  source: 'google';
  readOnly: true;
  providerEventId: string;
}
type Failure = { status: 'not-connected' | 'permission-required' | 'unavailable'; message: string };
export type GoogleCalendarSources = Failure | { status: 'ready'; calendars: GoogleCalendarSource[] };
export type GoogleCalendarRead = Failure | { status: 'selection-required'; message: string } | {
  status: 'ready'; calendar: GoogleCalendarSource; events: GoogleCalendarRecord[]; syncedAt: string; truncated: false;
};
const bindingKey = (binding: GoogleCalendarBinding) => JSON.stringify([
  binding.environment, binding.userId, binding.organizationId, binding.credentialId, binding.sessionId, binding.connectionId,
]);
const sourceId = (binding: GoogleCalendarBinding, calendarId: string) => `google:${encodeURIComponent(binding.connectionId)}:${encodeURIComponent(calendarId)}`;
const abortChanged = () => new DOMException('Google Calendar account, connection or selection changed.', 'AbortError');
const disconnected = (): Failure => ({ status: 'not-connected', message: 'Connect Google Calendar to read its calendars.' });
const permissionRequired = (): Failure => ({ status: 'permission-required', message: 'Reconnect Google with Calendar read access to show its events.' });
const readable = (calendar: GoogleCalendarSummary) => ['reader', 'writer', 'owner'].includes(calendar.accessRole);
const sourceKey = (calendar: GoogleCalendarSummary) => JSON.stringify([calendar.calendarId, calendar.accessRole, calendar.timeZone]);
function source(binding: GoogleCalendarBinding, account: GmailAccount, calendar: GoogleCalendarSummary): GoogleCalendarSource {
  return { id: sourceId(binding, calendar.calendarId), name: calendar.summary || 'Google Calendar', account: account.label,
    connectionId: binding.connectionId, providerCalendarId: calendar.calendarId, timeZone: calendar.timeZone,
    primary: calendar.primary, source: 'google', readOnly: true };
}
function failure(error: unknown): Failure {
  if (error instanceof CloudProtocolError) {
    if (error.code === 'credentials-missing' || error.code === 'expired' || error.status === 401) return disconnected();
    if ([403, 404, 409].includes(error.status || 0)) return permissionRequired();
  }
  return { status: 'unavailable', message: 'Google Calendar could not be loaded. Retry before relying on this schedule.' };
}
function record(event: GoogleCalendarEvent, calendar: GoogleCalendarSource): GoogleCalendarRecord {
  let begin = Date.parse(event.startAt), end = Date.parse(event.endAt);
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) throw new CloudProtocolError('invalid-response');
  const timeZone = event.timezone || calendar.timeZone;
  // Cloud normalizes Google's all-day dates to midnight instants in the calendar zone.
  // Alpha stores their civil dates at UTC midnight, including the exclusive end date.
  // Convert each boundary independently: a DST transition can make the provider span
  // 23 or 25 hours without changing the number of calendar days it occupies.
  try {
    if (event.isAllDay) {
      if (!timeZone) throw new CloudProtocolError('invalid-response');
      const format = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
      const civil = (instant: number) => {
        const parts = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]));
        return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
      };
      begin = civil(begin); end = civil(end);
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) throw new CloudProtocolError('invalid-response');
    } else if (timeZone) new Intl.DateTimeFormat('en-US', { timeZone });
  } catch { throw new CloudProtocolError('invalid-response'); }
  return { id: `${calendar.id}:${encodeURIComponent(event.externalId)}`, calendarId: calendar.id,
    providerEventId: event.externalId, title: event.title || 'Untitled event', body: event.description, location: event.location,
    begin, end, allDay: event.isAllDay, timeZone: event.isAllDay ? 'UTC' : event.timezone || calendar.timeZone || 'UTC',
    // Read-only snapshots must never be sent to the local Calendar writer/recurrence engine.
    revision: JSON.stringify([event.externalId, event.startAt, event.endAt, event.status, event.title, event.description, event.location]),
    source: 'google', readOnly: true };
}

/** Read-only Cloud adapter. It never writes local Calendar storage or grants agent access.
 * UI owners must call invalidate on disconnect/unmount and selectSource for an explicit
 * source choice; getBinding is also checked after every await to reject account switches. */
export class GoogleCalendarReader {
  private epoch = 0;
  private selected: string | null = null;
  private selectionOwner: string | null = null;
  private offered = new Map<string, GoogleCalendarSummary>();
  constructor(private readonly client: GoogleCalendarClient, private readonly getBinding: () => GoogleCalendarBinding | null) {}

  invalidate(): void { ++this.epoch; this.selected = null; this.selectionOwner = null; this.offered.clear(); }
  selectSource(id: string | null): void {
    const binding = this.getBinding();
    if (id !== null && (!binding || this.selectionOwner !== bindingKey(binding) || !this.offered.has(id))) throw new Error('Choose a currently listed Google calendar.');
    ++this.epoch;
    this.selected = id;
  }
  private ticket(signal: AbortSignal) {
    signal.throwIfAborted();
    const binding = this.getBinding();
    if (!binding || Object.values(binding).some(value => !value)) return null;
    const key = bindingKey(binding), epoch = this.epoch;
    const current = () => {
      signal.throwIfAborted();
      const active = this.getBinding();
      if (this.epoch !== epoch || !active || bindingKey(active) !== key) throw abortChanged();
    };
    return { binding: { ...binding }, key, current };
  }
  private async account(binding: GoogleCalendarBinding, signal: AbortSignal, current: () => void): Promise<GmailAccount | Failure> {
    const accounts = await this.client.gmailAccounts(signal); current();
    const account = accounts.find(item => item.connectionId === binding.connectionId);
    if (!account?.connected) return disconnected();
    if (!account.grantedCapabilities.includes('google.calendar.read')) return permissionRequired();
    return account;
  }
  async listSources(signal: AbortSignal): Promise<GoogleCalendarSources> {
    const ticket = this.ticket(signal);
    if (!ticket) { this.invalidate(); return disconnected(); }
    const { binding, key, current } = ticket;
    try {
      const account = await this.account(binding, signal, current);
      if ('status' in account) { this.invalidate(); return account; }
      const calendars = (await this.client.googleCalendars(binding.connectionId, signal)).filter(readable); current();
      const latest = await this.account(binding, signal, current);
      if ('status' in latest) { this.invalidate(); return latest; }
      const offered = new Map(calendars.map(calendar => [sourceId(binding, calendar.calendarId), calendar]));
      if (this.selectionOwner !== key || (this.selected && !offered.has(this.selected))) {
        ++this.epoch;
        this.selected = null;
      }
      this.selectionOwner = key;
      this.offered = offered;
      return { status: 'ready', calendars: calendars.map(calendar => source(binding, latest, calendar)) };
    } catch (error) { current(); if (error instanceof CloudProtocolError && error.code === 'account-changed') throw abortChanged(); return failure(error); }
  }
  async read(range: GoogleCalendarRange, signal: AbortSignal): Promise<GoogleCalendarRead> {
    const ticket = this.ticket(signal);
    if (!ticket) { this.invalidate(); return disconnected(); }
    const { binding, key, current } = ticket;
    const selected = this.selected, chosen = selected && this.selectionOwner === key ? this.offered.get(selected) : undefined;
    if (!chosen) return { status: 'selection-required', message: 'Choose a Google calendar to show its events.' };
    const start = Date.parse(range.timeMin), end = Date.parse(range.timeMax);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new TypeError('Choose a valid Calendar range.');
    new Intl.DateTimeFormat('en', { timeZone: range.timeZone });
    const window = { ...range };
    try {
      const account = await this.account(binding, signal, current);
      if ('status' in account) { this.invalidate(); return account; }
      const before = (await this.client.googleCalendars(binding.connectionId, signal)).find(calendar => calendar.calendarId === chosen.calendarId && readable(calendar)); current();
      if (!before || sourceKey(before) !== sourceKey(chosen)) { this.invalidate(); return permissionRequired(); }
      const feed = await this.client.googleCalendarFeed(binding.connectionId, chosen.calendarId, window, signal); current();
      const latest = await this.account(binding, signal, current);
      if ('status' in latest) { this.invalidate(); return latest; }
      const after = (await this.client.googleCalendars(binding.connectionId, signal)).find(calendar => calendar.calendarId === chosen.calendarId && readable(calendar)); current();
      if (!after || sourceKey(after) !== sourceKey(before)) { this.invalidate(); return permissionRequired(); }
      if (feed.calendarId !== chosen.calendarId || !Number.isFinite(Date.parse(feed.syncedAt))) throw new CloudProtocolError('invalid-response');
      const calendar = source(binding, latest, after), seen = new Set<string>();
      const events = feed.events.filter(event => event.status !== 'cancelled').map(event => {
        if (event.calendarId !== chosen.calendarId || seen.has(event.externalId)) throw new CloudProtocolError('invalid-response');
        seen.add(event.externalId); return record(event, calendar);
      }).filter(event => event.begin < end && event.end > start).sort((a, b) => a.begin - b.begin || a.id.localeCompare(b.id));
      return { status: 'ready', calendar, events, syncedAt: feed.syncedAt, truncated: false };
    } catch (error) { current(); if (error instanceof CloudProtocolError && error.code === 'account-changed') throw abortChanged(); return failure(error); }
  }
}
