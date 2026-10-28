/** Browser-profile composition of the shared owner-bound Google host. */
import {createBrowserCloudDevHandler} from './browser-cloud-dev-bridge.ts';
import {createManagedGoogleAgentHost} from '../backend/managed-google-agent-host.ts';
export function createGmailAgentReadHost(profile:string){
 return createManagedGoogleAgentHost(createBrowserCloudDevHandler({profile}));
}
