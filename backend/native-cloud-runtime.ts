import {productionCloud} from '../apps/app/src/runtime/cloud-deployment.generated.ts';

/** Alpha's admitted Cloud deployment for the resident's text inference. The shared
 * upstream runtime profile (packages/app native-runtime-profile.ts) owns every routing
 * decision; the protected native store keeps the credential. */
export const nativeCloudRuntime=Object.freeze({apiBaseUrl:productionCloud.api+'/api/v1'});
