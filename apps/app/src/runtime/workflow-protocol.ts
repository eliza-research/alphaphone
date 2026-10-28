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
 /** Raw executions by run id, as the agent last returned them (see `recorded`). */
 private readonly raw:Map<string,Record<string,unknown>>;
 constructor(request:WorkflowRequest){
  const raw=new Map<string,Record<string,unknown>>();
  const keep=(value:unknown)=>{if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as {id?:unknown}).id==='string')raw.set((value as {id:string}).id,value as Record<string,unknown>);};
  super(async(path,body,signal)=>{const value=await request(path,body,signal);if(value&&typeof value==='object'&&!Array.isArray(value)){const v=value as {execution?:unknown;executions?:unknown};keep(v.execution);if(Array.isArray(v.executions))v.executions.forEach(keep);}return value;},{normalizePhoneSpec:value=>normalizePhoneSpec(value) as unknown as PhoneWorkflowSpec});
  this.raw=raw;
 }
 /** A workflow's own output can take any shape, including the recorded missed-occurrence output, so a
  * run is "missed" only when the agent's workflow service wrote the engine-only `missedOccurrenceAt`
  * field on the finished execution (elizaOS/eliza isMissedOccurrenceExecution). The shared client applies
  * the same rule from elizaOS/eliza#38100; once the pin includes it, delete this override and `raw`. */
 private recorded(run:WorkflowRun):WorkflowRun{
  const raw=this.raw.get(run.id);this.raw.delete(run.id);
  if(run.occurrence?.status!=='missed')return run;
  if(raw&&raw.finished===true&&typeof raw.missedOccurrenceAt==='string'&&Number.isFinite(Date.parse(raw.missedOccurrenceAt)))return run;
  // A typed schedule's occurrence is bound to the agent's admission record (its steps' output is a
  // step list, never this record), so the agent's own late-start settlement stays readable as missed.
  const input=raw?.input;if(input&&typeof input==='object'&&!Array.isArray(input)&&(input as {typedSchedule?:unknown}).typedSchedule!==undefined)return run;
  const {occurrence:_untrusted,...rest}=run;return rest;
 }
 override async run(id:string,version:string,signal:AbortSignal,beforeSubmit?:(submissionId?:string)=>void|Promise<void>){return this.recorded(await super.run(id,version,signal,beforeSubmit));}
 override async resubmit(id:string,version:string,submissionId:string,signal:AbortSignal){return this.recorded(await super.resubmit(id,version,submissionId,signal));}
 override async reconcile(id:string,version:string,submissionId:string,signal:AbortSignal){const run=await super.reconcile(id,version,submissionId,signal);return run&&this.recorded(run);}
 override async executions(id:string,signal:AbortSignal){return (await super.executions(id,signal)).map(run=>this.recorded(run));}
 override async cancel(id:string,workflowId:string,signal:AbortSignal){return this.recorded(await super.cancel(id,workflowId,signal));}
 override async receipt(id:string,workflowId:string,signal:AbortSignal){return this.recorded(await super.receipt(id,workflowId,signal));}
 // The editor's loosely indexed PhoneSpec is normalized by the shared validator on every path.
 override generatePhone(prompt:string,catalog:PhoneWorkflowCatalog,operations:string[],signal:AbortSignal,existing?:PhoneSpec,device?:WorkflowDeviceTarget){return super.generatePhone(prompt,catalog,operations,signal,existing as unknown as PhoneWorkflowSpec|undefined,device);}
 override validatePhone(spec:PhoneSpec,catalog:PhoneWorkflowCatalog,signal:AbortSignal){return super.validatePhone(spec as unknown as PhoneWorkflowSpec,catalog,signal);}
 override savePhone(spec:PhoneSpec,catalog:PhoneWorkflowCatalog,expected:PhoneWorkflowSaveExpectation,signal:AbortSignal){return super.savePhone(spec as unknown as PhoneWorkflowSpec,catalog,expected,signal);}
 hosted(){return new HostedDigestProtocol(this.request);}
 async phoneReview(run:WorkflowRun,signal:AbortSignal){return parseWorkflowPhoneReview(await this.request(`/api/workflow/executions/${encodeURIComponent(run.id)}/phone-review`,undefined,signal),run);}
}
