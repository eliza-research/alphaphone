/** A ten-second Undo window. Wall time is display metadata, never expiry authority. */
export const DELETE_UNDO_MS=10_000;
export type DeletionClock={continuity:string;elapsed:number;wall:number};
export type DeletionDeadline={continuity:string;createdElapsed:number;expiresElapsed:number;expiresAt:number};
export type DeletePhase='queued'|'paused'|'dispatching'|'undone'|'deleted'|'conflict'|'permission-required'|'owner-changed'|'unknown';
export type PendingDeletion<T>={version:1;id:string;owner:string;target:T;deadline:DeletionDeadline;phase:DeletePhase;acknowledged?:boolean};
function clockValid(clock:DeletionClock){return !!clock&&typeof clock.continuity==='string'&&clock.continuity.length>0&&clock.continuity.length<=200&&Number.isFinite(clock.elapsed)&&clock.elapsed>=0&&Number.isSafeInteger(clock.wall)&&clock.wall>=0;}
export function deletionDeadline(clock:DeletionClock):DeletionDeadline{
 if(!clockValid(clock)||clock.wall>Number.MAX_SAFE_INTEGER-DELETE_UNDO_MS)throw Error('Deletion clock unavailable');
 return {continuity:clock.continuity,createdElapsed:clock.elapsed,expiresElapsed:clock.elapsed+DELETE_UNDO_MS,expiresAt:clock.wall+DELETE_UNDO_MS};
}
export function deletionWindow(deadline:DeletionDeadline,clock:DeletionClock):'open'|'expired'|'clock-changed'{
 if(!clockValid(clock)||!deadline||clock.continuity!==deadline.continuity||!Number.isFinite(deadline.createdElapsed)||deadline.createdElapsed<0||deadline.expiresElapsed!==deadline.createdElapsed+DELETE_UNDO_MS||!Number.isSafeInteger(deadline.expiresAt)||clock.elapsed<deadline.createdElapsed)return 'clock-changed';
 return clock.elapsed<deadline.expiresElapsed?'open':'expired';
}
/** Apply while holding the durable document transaction: Undo and expiry have one winner. */
export function claimDeletion<T>(entry:PendingDeletion<T>,owner:string,clock:DeletionClock,action:'undo'|'dispatch'):boolean{
 if((entry.phase!=='queued'&&!(action==='undo'&&entry.phase==='paused'))||entry.owner!==owner)return false;
 const state=deletionWindow(entry.deadline,clock);
 // Lost clock continuity never authorizes a write. Cancelling a still-unapplied intent is safe.
 if(action==='undo'){if(entry.phase!=='paused'&&state==='expired')return false;entry.phase='undone';return true;}
 if(state!=='expired')return false;
 entry.phase='dispatching';return true;
}
const browserContinuity=crypto.randomUUID();
/** A new renderer cannot prove continuity of an OS clock while it was absent: review again. */
export const browserDeletionClock=():DeletionClock=>({continuity:browserContinuity,elapsed:performance.now(),wall:Date.now()});

export const UNDO_TOO_LATE='Undo was too late. The deletion already went ahead; check the item before relying on it.';
/** Undo is confirmed only by a receipt whose phase is 'undone'; a settled deletion is never shown as kept. */
export function undoConfirmed(result:unknown){return !!result&&typeof result==='object'&&(result as {phase?:unknown}).phase==='undone';}
