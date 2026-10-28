import {formatTime, formatShortDate} from './locale-time.ts';

/** What needs attention, from the mail provider adapter (P06 inboxAttention()). */
export interface HomeAttentionSummary {
  state: 'not-connected' | 'loading' | 'ready' | 'stale' | 'error';
  /** Unread messages in the inbox; required when ready, last known value when stale. */
  unread?: number;
  /** Provider or account label, for example "Gmail" or "work@example.com". */
  source?: string;
  /** Epoch milliseconds or ISO time of the last successful read. */
  updatedAt?: number | string;
  /** Provider-supplied failure text for the error state. */
  message?: string;
}
/** Latest retained scheduled brief (P05 latestRetainedDigest()). */
export interface HomeBriefSummary { summary: string; ranAt: string | number; agent: string; status: string }

const instant = (value: unknown) => { const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) && at > 0 ? at : null; };
/** "3:04 PM" today, otherwise "Wed, Oct 8 3:04 PM". */
export function whenLabel(at: number, now: number) {
  const date = new Date(at), today = new Date(now);
  return date.toDateString() === today.toDateString() ? formatTime(date) : `${formatShortDate(date)} ${formatTime(date)}`;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function presentHomeAttention(summary: HomeAttentionSummary | null | undefined, now: number) {
  const updated = instant(summary?.updatedAt);
  const source = typeof summary?.source === 'string' && summary.source.trim() ? summary.source.trim().slice(0, 60) : 'Inbox';
  const unread = Number.isSafeInteger(summary?.unread) && Number(summary?.unread) >= 0 ? Number(summary?.unread) : null;
  switch (summary?.state) {
    case 'ready':
      if (unread === null) break;
      return {action: 'inbox' as const, count: String(unread),
        text: `${unread ? 'unread' : 'Nothing unread'} · ${source}${updated ? ` · ${whenLabel(updated, now)}` : ''}`,
        // Stable accessible name; source and read time are in the visible text line.
        label: `Open Inbox: ${plural(unread, 'unread email', 'unread emails')}`};
    case 'stale': {
      // With no completed read there is no last count to report, whatever number came with it.
      const last = updated ? unread : null;
      return {action: 'inbox' as const, count: last === null ? '—' : String(last),
        text: updated ? `Not updated since ${whenLabel(updated, now)}` : 'Not updated recently',
        label: `Open Inbox: ${source} has not updated${updated ? ` since ${whenLabel(updated, now)}` : ''}${last === null ? '' : `; ${plural(last, 'unread email', 'unread emails')} when last read`}`};
    }
    case 'error': {
      const message = typeof summary.message === 'string' && summary.message.trim() ? summary.message.trim().slice(0, 120) : `${source} could not be checked`;
      return {action: 'inbox' as const, count: '!', text: message, label: `Open Inbox to retry: ${message}`};
    }
    case 'loading':
      return {action: 'inbox' as const, count: '…', text: `Checking ${source}…`, label: `Open Inbox: checking ${source}`};
  }
  return {action: 'connections' as const, count: '—', text: 'Set up Gmail', label: 'Set up Gmail in Connections to see what needs your attention'};
}

/** How a retained digest result ended. The agent also records occurrences it skipped (a missed
 * time, an overlapping run, an expired or revoked source); those are results, not runs. */
export function briefOutcome(status: unknown): 'ran' | 'failed' | 'not-run' {
  const text = typeof status === 'string' ? status : '';
  return /fail|error|cancel/i.test(text) ? 'failed' : /^(missed|overlap|unavailable)$/i.test(text.trim()) ? 'not-run' : 'ran';
}
const BRIEF_VERB = {ran: 'Ran', failed: 'Failed', 'not-run': 'Did not run'} as const;

export function presentHomeBrief(brief: HomeBriefSummary | null | undefined, now: number) {
  const summary = typeof brief?.summary === 'string' ? brief.summary.replace(/\s+/g, ' ').trim() : '';
  const ran = instant(brief?.ranAt);
  if (!brief || !summary || !ran) return {title: 'No brief yet', time: 'Workflows', source: '', label: 'Open workflows', has: false};
  const agent = typeof brief.agent === 'string' && brief.agent.trim() ? brief.agent.trim().slice(0, 40) : 'Your agent';
  const verb = BRIEF_VERB[briefOutcome(brief.status)];
  const title = summary.length > 56 ? `${summary.slice(0, 55).trimEnd()}…` : summary;
  return {title, time: `${verb} ${whenLabel(ran, now)}`, source: agent, has: true,
    label: `Open workflows. Latest brief from ${agent}, ${verb.toLowerCase()} ${whenLabel(ran, now)}: ${summary.slice(0, 280)}`};
}

/** The Home brief card: the newest result retained in this app for the current connection. It is
 * shown only when one exists; it never stands for a fresh run. A failed run says so, and a result
 * that records a skipped occurrence says it did not run. */
export function presentHomeBriefCard(brief: HomeBriefSummary | null | undefined, now: number) {
  const base = presentHomeBrief(brief, now);
  if (!base.has) return {has: false as const, title: '', status: '', failed: false, label: ''};
  const summary = String(brief!.summary).replace(/\s+/g, ' ').trim();
  const outcome = briefOutcome(brief!.status);
  return {has: true as const, title: summary.length > 96 ? `${summary.slice(0, 95).trimEnd()}…` : summary, failed: outcome === 'failed',
    status: `${base.source} · ${base.time}`,
    label: `Open scheduled digests. Latest brief from ${base.source}, ${BRIEF_VERB[outcome].toLowerCase()} ${whenLabel(Number(instant(brief!.ranAt)), now)}: ${summary.slice(0, 280)}`};
}

/** Source and freshness of the Home calendar card. `origin` (which calendar, or that the item is
 * a reminder) sits beside the date. Successful read timestamps stay in the accessible description;
 * `description` is the full sentence exposed as the card's accessible description. Times are when
 * this app last read the source on this device, never a provider sync claim. A reminder comes from
 * the reminder store, so it carries that store's read time and never the calendar's. An overdue
 * reminder is already named in the card header. */
export function presentHomeCalendarSource(input: {state: 'ready' | 'loading' | 'error' | 'other'; overdue: boolean; reminder?: boolean; reminderReadAt?: number | null; readAt: number | null; now: number; native: boolean; calendar?: string | null; truncated?: boolean}) {
  const {state, overdue, readAt, now, native} = input;
  const reminder = () => {
    const at = instant(input.reminderReadAt);
    return {origin: overdue ? '' : 'Reminder', read: '',
      description: `${overdue ? 'Overdue reminder' : 'Reminder'} saved on this ${native ? 'device' : 'browser'}${at ? `, read ${whenLabel(at, now)}` : ''}`};
  };
  if (overdue) return reminder();
  // A failed calendar read stays visible above an upcoming reminder: events may be missing before it.
  if (state === 'error') return {origin: '', read: 'Open Calendar to retry', description: 'Calendar could not be read. Open Calendar to retry.'};
  if (input.reminder) return reminder();
  if (state !== 'ready' || !readAt) return {origin: '', read: '', description: ''};
  const name = typeof input.calendar === 'string' && input.calendar.trim() ? input.calendar.trim().slice(0, 60) : '';
  return {origin: name === 'In this app' || name === 'This app' ? '' : name, read: '',
    description: `${name ? `${name}. ` : ''}Read ${whenLabel(readAt, now)} from ${native ? 'calendars on this device' : 'the calendar saved in this app'}${input.truncated ? '; only the first 2,000 events were read' : ''}`};
}
/** The secondary line of the Home calendar card while an overdue reminder holds it: the first item
 * that is not overdue, so an overdue reminder never hides the next event. `source` names where and
 * when that item was read (presentHomeCalendarSource for it), never the reminder's store. */
export function presentHomeNext(input: {title: string; begin: number; allDay: boolean; now: number; provenance: {origin: string; read: string; description: string}}) {
  const {begin, now, provenance} = input, date = new Date(begin), today = date.toDateString() === new Date(now).toDateString();
  const title = input.title.replace(/\s+/g, ' ').trim() || 'Untitled event';
  const time = begin <= now ? (input.allDay ? 'All day' : 'Now') : input.allDay ? (today ? 'All day' : formatShortDate(date)) : today ? formatTime(date) : `${formatShortDate(date)} ${formatTime(date)}`;
  return {text: `Next: ${title} ${time}`, source: [provenance.origin, provenance.read].filter(Boolean).join(' · '),
    description: `Next: ${title}, ${time}${provenance.description ? `. ${provenance.description}` : ''}`};
}
/** Name of the calendar an event on the Home card was read from: the display source whose id is
 * the event's `calendarId` in the same completed read. Null when the event names no calendar, when
 * no source in that read has that id (a calendar removed or hidden from the provider since, or a
 * read that returned none), or when the matching source has no name; the card omits the label. Ids are compared exactly as strings: the provider reports both as
 * strings, and a name is never borrowed from another calendar. */
export function homeCalendarName(sources: unknown, calendarId: unknown): string | null {
  if (typeof calendarId !== 'string' || !calendarId || !Array.isArray(sources)) return null;
  const found = sources.find(source => !!source && typeof source === 'object' && (source as {id?: unknown}).id === calendarId) as {name?: unknown} | undefined;
  return typeof found?.name === 'string' && found.name.trim() ? found.name.trim() : null;
}
/** Header of the Home calendar card: the item's day, or that reminders are overdue. */
export function homeAgendaHeader(dateLabel: string, overdue: number) {
  return overdue > 1 ? `${overdue} overdue reminders` : overdue === 1 ? 'Overdue reminder' : dateLabel;
}
/** "Due 9:00 AM" today, otherwise "Due Mon, Oct 5 9:00 AM". */
export function overdueDueLabel(at: number, now: number) { return `Due ${whenLabel(at, now)}`; }

/** When the Home workflows card's rows were loaded from the agent (and, for the unified list, this
 * phone). Empty until a list has actually been loaded for the current connection. With no agent
 * connected the unified list holds only this phone's reminders, and says so. */
export function presentHomeWorkflowFreshness(input: {loadedAt: number | null | undefined; now: number; unified: boolean; agent?: boolean}) {
  const at = instant(input.loadedAt);
  if (!at) return {visible: '', description: ''};
  const when = whenLabel(at, input.now);
  const source = !input.unified ? 'Workflows from your agent' : input.agent === false ? 'Reminders on this phone' : 'Automations from your agent and reminders on this phone';
  return {visible: `Loaded ${when}`, description: `${source}, loaded ${when}`};
}

/** Status line of the Home Inbox card. It describes only metadata the user already loaded in
 * Inbox: which account, whether the loaded page was complete, and when it was read. */
export function presentHomeInboxStatus(input: {failure: boolean; pending: boolean; cached: {more: boolean; label: string; readAt: number | null} | null; connected: boolean; unchecked: boolean; now: number}) {
  const {failure, pending, cached, now} = input;
  const read = cached?.readAt && Number.isFinite(cached.readAt) && cached.readAt > 0 ? whenLabel(cached.readAt, now) : '';
  if (failure) return `Open to retry${read ? ` · last updated ${read}` : ''}`;
  if (pending) return 'Updating email…';
  if (cached) return [cached.more ? 'Recent email' : cached.label, read ? `Updated ${read}` : ''].filter(Boolean).join(' · ');
  return input.connected ? 'Open to load email' : input.unchecked ? 'Open to check email' : '';
}

/** Calendar adapter status strings (calendar-adapter nativeCalendarStatus) mapped to card states. */
export type CalendarCardState = 'ready' | 'loading' | 'denied' | 'error' | 'unavailable' | 'not-connected';
export function calendarCardState(status: unknown): CalendarCardState {
  const text = typeof status === 'string' ? status : '';
  if (/denied/i.test(text)) return 'denied';
  if (/could not be loaded|failed|unavailable\b/i.test(text)) return 'error';
  if (/^Loading/i.test(text)) return 'loading';
  if (/connected|limited/i.test(text) && !/^Not connected/i.test(text)) return 'ready';
  if (/available in the Android app/i.test(text)) return 'unavailable';
  return 'not-connected';
}
/** Title of the Home calendar card when it shows no item. `hidden`: the app calendar is hidden in
 * Calendar's display settings. A refused or unconnected device calendar says so; a failed read and
 * a calendar this build cannot reach are both "unavailable". */
export function homeCalendarEmptyTitle(source: {loading?: boolean; ready?: boolean; error?: boolean; truncated?: boolean; native?: boolean; status?: unknown} | null | undefined, hidden = false) {
  if (!source || source.loading) return 'Loading events…';
  if (source.ready) return hidden ? 'No visible events' : source.truncated ? 'Results limited' : 'No upcoming events';
  if (source.error) return 'Calendar unavailable';
  const state = calendarCardState(source.status);
  return state === 'denied' ? 'Calendar access is off' : state === 'not-connected' && source.native ? 'Connect your calendar' : 'Calendar unavailable';
}
export interface HomeAgenda { title: string; begin: number; allDay: boolean; video: boolean; people: string[]; overdue?: boolean }
export function presentHomeCalendar(input: {state: CalendarCardState; agenda: HomeAgenda | null; readAt: number | null; now: number; device: string}) {
  const {state, agenda, readAt, now, device} = input;
  const source = state === 'ready' && readAt ? `Read ${whenLabel(readAt, now)} from ${device}` : '';
  if (agenda) {
    const date = new Date(agenda.begin);
    const time = agenda.overdue ? 'Overdue' : agenda.begin <= now ? (agenda.allDay ? 'All day' : 'Now')
      : date.toDateString() === new Date(now).toDateString() ? (agenda.allDay ? 'All day' : formatTime(date)) : formatShortDate(date);
    // Accessible names stay stable ("Open calendar event: <title>" / "Open your calendar"); the
    // visible time, state and source lines carry the rest.
    return {title: agenda.title, time, source, video: agenda.video, people: agenda.people, label: `Open calendar event: ${agenda.title}`};
  }
  const empty = (title: string, time: string) => ({title, time, source, video: false, people: [] as string[], label: 'Open your calendar'});
  switch (state) {
    case 'denied': return empty('Calendar access is off', 'Access denied');
    case 'error': return empty('Calendar could not be read', 'Tap to retry');
    case 'loading': return empty('Reading your calendar…', 'Calendar');
    case 'ready': return empty('Nothing coming up', 'Calendar');
    case 'unavailable': return empty('Your calendar', 'Calendar');
  }
  return empty('Connect your calendar', 'Calendar');
}
/** At most three attendee initials, with a "+N" overflow, derived only from event attendee names. */
export function attendeeInitials(names: unknown[]): string[] {
  const initials = names.filter((name): name is string => typeof name === 'string' && !!name.trim()).map(name => {
    const parts = name.trim().replace(/[<(].*$/, '').trim().split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase();
  }).filter(Boolean);
  return initials.length > 3 ? [...initials.slice(0, 2), `+${initials.length - 2}`] : initials;
}
