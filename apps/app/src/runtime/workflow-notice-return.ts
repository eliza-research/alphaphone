import {workflowApprovalNotice,type WorkflowPhoneReview} from './workflow-device-contract';
import type {WorkflowProtocol} from './workflow-protocol';
export interface SuspendedApprovalNotice {id:string;bindingHash:string;expiresAt:number;route:{scope:string;origin:string;ownerId:string;agentId:string;workflowId:string;runId:string;versionId:string}}
/** Read-only revalidation. No approval context, source content read, execution or provider mutation. */
export async function revalidateApprovalNotice(notice:SuspendedApprovalNotice,client:Pick<WorkflowProtocol,'detail'|'receipt'|'phoneReview'>,actions:(review:WorkflowPhoneReview,signal:AbortSignal)=>Promise<Array<{id:string;expiresAt:number}>>,valid:()=>boolean,signal:AbortSignal,now=()=>Date.now()):Promise<'resume'|'withdraw'|'stale'>{
 if(!valid())return 'stale';
 const route=notice.route,current=await client.detail(route.workflowId,signal);
 if(!valid())return 'stale';
 if(current.removed||current.versionId!==route.versionId||notice.expiresAt<=now())return 'withdraw';
 const run=await client.receipt(route.runId,route.workflowId,signal);
 if(!valid())return 'stale';
 if(run.versionId!==route.versionId||run.finished)return 'withdraw';
 const review=await client.phoneReview(run,signal);
 if(!valid())return 'stale';
 if(review.finished||review.cancellationRequestedAt)return 'withdraw';
 const pending=await actions(review,signal);let matches=false;
 for(const step of pending){const bound=await workflowApprovalNotice(route,step.id);if(bound.id===notice.id&&bound.bindingHash===notice.bindingHash&&step.expiresAt===notice.expiresAt)matches=true;}
 if(!valid())return 'stale';
 return matches&&notice.expiresAt>now()?'resume':'withdraw';
}
