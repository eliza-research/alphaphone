/** IPC exposure for existing canonical Notes/Calendar APIs. Domain validation and
 * mutation authority remain in the owning Eliza service and view broker. */
import type {VerifiedSession} from './alpha-client';
export type AppRecordMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface AppRecordPort {
 readonly sessionId: string;
 readonly scope?: string;
 readonly identity: VerifiedSession;
 current(): boolean;
 request(path: string, method: AppRecordMethod, body: unknown | undefined, signal: AbortSignal): Promise<unknown>;
}
const calendar = '/api/lifeops/calendar';
export function isAppRecordPath(path: unknown): path is string {
 return typeof path === 'string' && (path === '/api/notes/state' || path === '/api/views/notes/interact' || path === calendar || path.startsWith(calendar + '/') || path.startsWith(calendar + '?'));
}
export function appRecordRouteAllowed(path: unknown, method: unknown): path is string {
 if(typeof path !== 'string' || path.length > 2048 || !path.startsWith('/') || path.startsWith('//') || /[\\#\s]/.test(path))return false;
 const [rawPath, ...parts] = path.split('?');
 if(parts.length > 1 || /%(?![0-9a-f]{2})/i.test(path))return false;
 const url = new URL(path, 'http://app.invalid');
 if(url.origin !== 'http://app.invalid' || url.pathname !== rawPath)return false;
 const keys = [...url.searchParams.keys()];
 if(new Set(keys).size !== keys.length)return false;
 const query = (allowed: readonly string[]) => keys.every(key => allowed.includes(key));
 if(rawPath === '/api/notes/state')return method === 'GET' && keys.length === 0;
 if(rawPath === '/api/views/notes/interact')return method === 'POST' && keys.length === 0;
 if([calendar + '/feed', calendar + '/calendars', calendar + '/next-context'].includes(rawPath))
  return method === 'GET' && query(['mode','side','grantId','calendarId','includeHiddenCalendars','timeMin','timeMax','timeZone','forceSync']);
 if(rawPath === calendar + '/events')return method === 'POST' && keys.length === 0;
 if(!rawPath.startsWith(calendar + '/events/'))return false;
 let id: string;
 try{id = decodeURIComponent(rawPath.slice((calendar + '/events/').length));}catch{return false;}
 if(!/^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,511}$/.test(id))return false;
 if(method === 'PATCH')return query(['mode','side','grantId','calendarId']);
 return method === 'DELETE' && query(['mode','side','grantId','calendarId','recurrenceScope','notifyAttendees','expectedProviderVersion','idempotencyKey','cancellationMode']);
}
export function assertAppRecordRequestAllowed(path: unknown, method: unknown, body: unknown): asserts path is string {
 if(!appRecordRouteAllowed(path, method) || ((method === 'GET' || method === 'DELETE') && body !== undefined))throw Error('Unsupported app record request. Nothing was sent.');
}
