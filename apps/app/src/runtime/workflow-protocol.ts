import {HostedDigestProtocol} from './hosted-digests';
import {normalizePhoneSpec,type PhoneSpec} from './phone-workflow-authoring';
import {parseWorkflowPhoneReview,type WorkflowDeviceTarget} from './workflow-device-contract';
import {WorkflowClient,type PhoneWorkflowSaveExpectation,type WorkflowRequest,type WorkflowRun} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
import type {PhoneWorkflowCatalog,PhoneWorkflowSpec} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
/** The receipt-checked workflow route client is the shared `@elizaos/contracts/workflow-client`.
 * Alpha only adds the phone-step review read and its digest result routes, and keeps the
 * development enrollment labels (test-mocks builds only) through its spec normalizer. */
export {WorkflowHttpError,WorkflowAdmissionRejected,WorkflowTypedRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,WorkflowActivationRejected} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
export type {RemoteWorkflow,WorkflowRun,WorkflowRunReconciliation,WorkflowRunOccurrence,WorkflowApproval,WorkflowApprovalReceipt,WorkflowMetadataReceipt,WorkflowLifecycleReceipt} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
export class WorkflowProtocol extends WorkflowClient {
 constructor(request:WorkflowRequest){super(request,{normalizePhoneSpec:value=>normalizePhoneSpec(value) as unknown as PhoneWorkflowSpec});}
 // The editor's loosely indexed PhoneSpec is normalized by the shared validator on every path.
 override generatePhone(prompt:string,catalog:PhoneWorkflowCatalog,operations:string[],signal:AbortSignal,existing?:PhoneSpec,device?:WorkflowDeviceTarget){return super.generatePhone(prompt,catalog,operations,signal,existing as unknown as PhoneWorkflowSpec|undefined,device);}
 override validatePhone(spec:PhoneSpec,catalog:PhoneWorkflowCatalog,signal:AbortSignal){return super.validatePhone(spec as unknown as PhoneWorkflowSpec,catalog,signal);}
 override savePhone(spec:PhoneSpec,catalog:PhoneWorkflowCatalog,expected:PhoneWorkflowSaveExpectation,signal:AbortSignal){return super.savePhone(spec as unknown as PhoneWorkflowSpec,catalog,expected,signal);}
 hosted(){return new HostedDigestProtocol(this.request);}
 async phoneReview(run:WorkflowRun,signal:AbortSignal){return parseWorkflowPhoneReview(await this.request(`/api/workflow/executions/${encodeURIComponent(run.id)}/phone-review`,undefined,signal),run);}
}
