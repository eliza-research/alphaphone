import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=transformSync(readFileSync('apps/app/src/browser/deletion-recovery.ts','utf8'),{loader:'ts',format:'esm'}).code;
const {browserDeletionRecovery}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const record={origin:'https://fixture.invalid',ownerId:'owner',agentId:'agent',sessionId:'session',installationId:'install',enrollmentId:'enroll',operation:{type:'calendar_delete',target:{sourceId:'local',sourceRevision:'source',eventId:'event',revision:'rev'}}};
const entry={scope:'scope',proposalId:'proposal',operationId:'operation',operationHash:'hash',attemptId:'attempt',phase:'terminal',status:'unknown',record};
const saved=()=>({id:'operation',owner:'agent:'+JSON.stringify([record.origin,record.ownerId,record.agentId,record.sessionId,record.installationId,record.enrollmentId]),phase:'deleted',target:{sourceRevision:'source',row:{id:'event',revision:'rev'}},journalBinding:{scope:'scope',proposalId:'proposal',operationHash:'hash'}});
test('browser exact deletion receipt recovers verified result, never an undone or unknown write',()=>{
 const result=browserDeletionRecovery(entry,saved());assert.equal(result.status,'succeeded');assert.equal(result.result.calendarResult.eventId,'event');
 assert.equal(browserDeletionRecovery({...entry,phase:'terminal',status:'succeeded'},saved()),null);
 const undo=browserDeletionRecovery(entry,{...saved(),phase:'undone'});assert.equal(undo.status,'failed');assert.deepEqual(undo.result,{operationId:'operation'});
 assert.equal(browserDeletionRecovery(entry,{...saved(),phase:'unknown'}),null);
});
test('scope, proposal, hash, owner, target revision and operation identity cannot cross receipts',()=>{
 for(const field of ['scope','proposalId','operationHash']){const receipt=saved();receipt.journalBinding[field]='other';assert.equal(browserDeletionRecovery(entry,receipt),null);}
 for(const field of ['id','owner']){const receipt=saved();receipt[field]='other';assert.equal(browserDeletionRecovery(entry,receipt),null);}
 const receipt=saved();receipt.target.row.revision='other';assert.equal(browserDeletionRecovery(entry,receipt),null);
});
