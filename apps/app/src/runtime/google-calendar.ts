import { CloudProtocolError } from './cloud-protocol.ts';
import type { CalendarRecord } from '../browser/calendar-records.ts';
import {
  GoogleCalendarReader as SharedGoogleCalendarReader,
  type GoogleCalendarBinding,
  type GoogleCalendarClient,
  type GoogleCalendarErrorKind,
  type GoogleCalendarRange,
  type GoogleCalendarRead as SharedGoogleCalendarRead,
  type GoogleCalendarReadEvent,
} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/google-reader.ts';

export type {
  GoogleCalendarBinding,
  GoogleCalendarClient,
  GoogleCalendarSource,
  GoogleCalendarSources,
} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/google-reader.ts';

/** A read-only Google event as an Alpha Calendar display record. */
export type GoogleCalendarRecord = GoogleCalendarReadEvent & CalendarRecord;
export type GoogleCalendarRead =
  | Exclude<SharedGoogleCalendarRead, { status: 'ready' }>
  | (Omit<Extract<SharedGoogleCalendarRead, { status: 'ready' }>, 'events'> & { events: GoogleCalendarRecord[] });

/** Alpha's Cloud failures: a missing, expired or rejected credential is disconnected; a refused grant asks for
 * Calendar access again; a credential switch cancels the read. */
function classify(error: unknown): GoogleCalendarErrorKind {
  if (!(error instanceof CloudProtocolError)) return 'unavailable';
  if (error.code === 'account-changed') return 'account-changed';
  if (error.code === 'credentials-missing' || error.code === 'expired' || error.status === 401) return 'not-connected';
  if ([403, 404, 409].includes(error.status || 0)) return 'permission-required';
  return 'unavailable';
}

/** Read-only display of one owner-chosen Google calendar (@elizaos/plugin-calendar/linked-sync) on Alpha's
 * Cloud client. It never writes local Calendar storage or grants agent access. */
export class GoogleCalendarReader extends SharedGoogleCalendarReader {
  constructor(client: GoogleCalendarClient, getBinding: () => GoogleCalendarBinding | null) {
    super(client, getBinding, { classify });
  }
  override read(range: GoogleCalendarRange, signal: AbortSignal): Promise<GoogleCalendarRead> {
    return super.read(range, signal);
  }
}
