import deployments from './cloud-deployment.json' with { type: 'json' };
import type { CloudEnvironment } from './cloud-protocol';

export interface CloudDeployment { api: string; agents: string; tenant: string; authorizationOrigins: string[]; verificationPage?: string }
/** Release configuration, never supplied by a callback, remote response or URL parameter. */
export function validateCloudDeployment(value: CloudDeployment): Readonly<CloudDeployment> {
  const origin = (raw: string) => {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== raw) throw new Error('Cloud configuration requires an exact HTTPS origin');
    return raw;
  };
  origin(value.api);
  if (value.verificationPage) { const page = new URL(value.verificationPage); if (page.protocol !== 'https:' || page.username || page.password || page.search || page.hash) throw new Error('Invalid verification page'); }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(value.agents) || !/^[A-Za-z0-9_-]{1,100}$/.test(value.tenant)) throw new Error('Invalid Cloud deployment');
  if (!Array.isArray(value.authorizationOrigins) || !value.authorizationOrigins.length) throw new Error('Missing authorization origins');
  return Object.freeze({ ...value, authorizationOrigins: Object.freeze(value.authorizationOrigins.map(origin)) as unknown as string[] });
}
const configured = { production: validateCloudDeployment(deployments.production), staging: validateCloudDeployment(deployments.staging) };
export function cloudDeployment(environment: CloudEnvironment) { return configured[environment]; }
/** Preserve installed default accounts; a different endpoint or tenant always gets a new vault slot. */
export function cloudCredentialSlot(environment: CloudEnvironment, config = cloudDeployment(environment)) {
  const legacy = environment === 'production' ? ['https://api.eliza.app', 'elizacloud'] : ['https://api-staging.eliza.app', 'elizacloud-staging'];
  return config.api === legacy[0] && config.tenant === legacy[1] ? `cloud:${environment}` : `cloud:${environment}:${config.api}:${config.tenant}`;
}
