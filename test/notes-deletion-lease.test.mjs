// Notes Trash lease (AP-10, MVP-15). Host-JVM run of the native lease decision, a renderer unit
// check of the lease helpers, and source checks of where each side applies it. Not Android or
// emulator evidence: the WorkManager job and the plugin-load pass have not been run against a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

test('the native passes leave a leased row untouched and finish one whose lease expired',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([nativeSource('NotesDeletionLease.java'),fixture('NotesDeletionLeaseTest.java')],'ai.elizaresearch.alphaphone.NotesDeletionLeaseTest',{json:true}),/^PASS notes deletion lease/);
});

test('finishPermanentDeletions consults the lease before any recording or Notes readback is acted on',()=>{
 const source=readFileSync(nativeSource('AlphaNoteAudioPlugin.java'),'utf8');
 const finish=source.slice(source.indexOf('static int finishPermanentDeletions('),source.indexOf('static List<String> trashEntrySpans('));
 const bound=finish.indexOf('boolean bound=Boolean.TRUE.equals(row.opt("permanent"))&&!NotesDeletionLease.held(row,now)&&');
 // The recording steps are the shared store's (elizaOS plugin-native-media RecordingStore.finishPermanent).
 assert.ok(bound>0&&bound<finish.indexOf('recordings(context).finishPermanent('),'a held row is never bound, so it is kept byte for byte');
 // Both native entry points run the same pass; Trash expiry already skips every row with a recovery row.
 assert.match(source,/private void sweepTrashOnStart\(\)\{[\s\S]*?finishPermanentDeletions\(getContext\(\),System\.currentTimeMillis\(\)\)/);
 assert.match(source,/public Result doWork\(\)\{[\s\S]*?finishPermanentDeletions\(getApplicationContext\(\),System\.currentTimeMillis\(\)\)/);
 assert.match(source,/due=!pending\.has\(id\)&&!liveAudio\.contains\(audioId\);/);
});

test('the renderer leases each step and every row it shows, and lease lengths agree',async()=>{
 const lease=await import('../apps/app/src/runtime/permanent-voice-deletion.ts');
 const java=readFileSync(nativeSource('NotesDeletionLease.java'),'utf8');
 assert.equal(lease.PERMANENT_DELETION_LEASE_MS,20*60*1000);
 assert.match(java,/static final long LEASE_MS=20L\*60\*1000;/);
 const row={id:'a',permanent:true},now=1_000_000;
 const leased=lease.leasedDeletionRow(row,now);
 assert.deepEqual(leased,{id:'a',permanent:true,lease:{until:now+lease.PERMANENT_DELETION_LEASE_MS}});
 assert.equal(lease.deletionLeaseDue(leased,now),false);
 assert.equal(lease.deletionLeaseDue(leased,now+lease.PERMANENT_DELETION_LEASE_MS/2+1),true,'renewed once half has run out');
 assert.equal(lease.deletionLeaseDue(row,now),true,'an unleased row is due');
 assert.equal(lease.sameDeletionRow(leased,row),true,'a lease renewal is the same deletion');
 assert.equal(lease.sameDeletionRow(leased,{...row,audioRequested:true}),false);
 const voice=readFileSync(join(root,'apps/app/src/prototype/voice-adapter.ts'),'utf8');
 assert.match(voice,/row=leasedDeletionRow\(\{id:crypto\.randomUUID\(\)/,'a new row is written leased');
 assert.match(voice,/const dispatched=leasedDeletionRow\(\{\.\.\.row,audioRequested:true as const\},Date\.now\(\)\);await changeAudioDeletion\(row,false,dispatched\);/,'each step renews it');
 assert.match(voice,/if\(deletionLeaseDue\(row,now\)\)try\{await changeAudioDeletion\(row,false,leasedDeletionRow\(row,now\)\);\}/,'rows shown under review stay leased');
 assert.match(voice,/if\(row\.permanent&&!sessionDeletions\.has\(row\.id\)\)\{if\(!await deletionClaimedElsewhere\(row\.id\)\)await settleInterruptedPermanentDeletion\(row,current\);continue;\}/,'another live view\'s row is not settled');
 assert.match(voice,/sessionDeletions\.add\(row\.id\);claimDeletion\(row\.id\);/);
});
