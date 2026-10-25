import {productionCloud} from '../apps/app/src/runtime/cloud-deployment.generated.ts';
import {loadElizaConfig,saveElizaConfig} from '../vendor/eliza/packages/agent/src/config/config.ts';
import {buildElizaCloudServiceRoute} from '../vendor/eliza/packages/host/src/contracts/service-routing.ts';
import {updateRoutingPreferences} from '../vendor/eliza/plugins/plugin-native-inference/src/model-catalog/routing-preferences.ts';

/** Project the admitted Android provider into the canonical runtime configuration before boot.
 * The protected native store still owns its credential; only routing is saved here. */
export async function prepareNativeCloudRuntime(){
 const small=process.env.ELIZAOS_CLOUD_SMALL_MODEL,large=process.env.ELIZAOS_CLOUD_LARGE_MODEL,baseUrl=process.env.ELIZAOS_CLOUD_BASE_URL;
 if(!small||!large||baseUrl!==productionCloud.api+'/api/v1')throw Error('Native Cloud inference binding is incomplete');
 const config=loadElizaConfig(),cloud={...config.cloud};
 // A previous desktop-style credential must not shadow the admitted native credential.
 delete cloud.apiKey;
 config.cloud={...cloud,enabled:true,baseUrl};
 config.serviceRouting={...config.serviceRouting,...(process.env.ELIZA_RUNTIME_PROFILE==='cloud'?{embeddings:buildElizaCloudServiceRoute()}:{}),llmText:buildElizaCloudServiceRoute({nanoModel:small,smallModel:small,mediumModel:small,largeModel:large,megaModel:large,responseHandlerModel:small,actionPlannerModel:large})};
 saveElizaConfig(config);
 await updateRoutingPreferences(current=>({
  preferredProvider:{...current.preferredProvider,TEXT_SMALL:'elizacloud',TEXT_LARGE:'elizacloud'},
  policy:{...current.policy,TEXT_SMALL:'manual',TEXT_LARGE:'manual',TRANSCRIPTION:'local-only',TEXT_TO_SPEECH:'local-only'},
 }));
}
