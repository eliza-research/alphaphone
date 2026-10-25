/** Canonical owner Automations routes only; the server retains mutation authorization. */
import {ownerRouteAllowed} from './owner-route-policy';
export type AutomationsMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const localRefusals=new WeakSet<object>();
/** Created only by trusted local checks before invoking a transport. Never inferred from server JSON. */
export class AutomationRequestNotDispatchedError extends Error {
 constructor(message:string){super(message);this.name='AutomationRequestNotDispatchedError';localRefusals.add(this);}
}
export const isAutomationRequestNotDispatchedError=(error:unknown):boolean=>!!error&&typeof error==='object'&&localRefusals.has(error);
export function assertAutomationRequestAllowed(path:unknown,method:unknown,body:unknown):asserts path is string {
 if(!ownerRouteAllowed('automations',path,method)||((method==='GET'||method==='DELETE')&&body!==undefined))throw new AutomationRequestNotDispatchedError('Unsupported automation request. Nothing was sent.');
}
