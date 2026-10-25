/** Canonical owner Automations routes only; the server retains mutation authorization. */
export type AutomationsMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export function automationsRouteAllowed(path: unknown, method: unknown): path is string {
  if (typeof path !== 'string' || path.length > 2048 || /[%\\#\s]/.test(path) || path.includes('..')) return false;
  const id = '[A-Za-z0-9][A-Za-z0-9._:-]{0,199}';
  if (method === 'GET') return path === '/api/automations' || path === '/api/lifeops/reminders' || path === '/api/lifeops/scheduled-tasks?ownerVisibleOnly=1' || new RegExp(`^/api/lifeops/scheduled-tasks/${id}$`).test(path) || new RegExp(`^/api/triggers/${id}(?:/runs)?$`).test(path);
  if (method === 'POST') return path === '/api/lifeops/definitions' || path === '/api/triggers' || new RegExp(`^/api/lifeops/scheduled-tasks/${id}/(?:snooze|skip|complete|dismiss|escalate|acknowledge|edit|reopen|fire)$`).test(path) || new RegExp(`^/api/lifeops/occurrences/${id}/snooze$`).test(path) || new RegExp(`^/api/triggers/${id}/execute$`).test(path);
  if (method === 'PUT') return new RegExp(`^/api/(?:lifeops/definitions|triggers)/${id}$`).test(path);
  return method === 'DELETE' && new RegExp(`^/api/triggers/${id}$`).test(path);
}
export function isAutomationsPath(path: unknown): boolean {
  return typeof path === 'string' && /^\/api\/(?:automations|lifeops|triggers)(?:[/?]|$)/.test(path);
}

const localRefusals=new WeakSet<object>();
/** Created only by trusted local checks before invoking a transport. Never inferred from server JSON. */
export class AutomationRequestNotDispatchedError extends Error {
 constructor(message:string){super(message);this.name='AutomationRequestNotDispatchedError';localRefusals.add(this);}
}
export const isAutomationRequestNotDispatchedError=(error:unknown):boolean=>!!error&&typeof error==='object'&&localRefusals.has(error);
export function assertAutomationRequestAllowed(path:unknown,method:unknown,body:unknown):asserts path is string {
 if(!automationsRouteAllowed(path,method)||((method==='GET'||method==='DELETE')&&body!==undefined))throw new AutomationRequestNotDispatchedError('Unsupported automation request. Nothing was sent.');
}
