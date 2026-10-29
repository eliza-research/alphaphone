// Source contracts for native deletion admission, notice fences and permitted-media review that
// cannot run on a plain JVM (WorkManager, Capacitor, MediaStore). Behaviour that can run on the
// JVM is covered in deferred-deletion-journal.test.mjs and native-deletion-claim.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const java=name=>readFileSync(`android/app/src/main/java/ai/elizaresearch/alphaphone/${name}.java`,'utf8');
const body=(source,start,end)=>source.slice(source.indexOf(start),end?source.indexOf(end,source.indexOf(start)):undefined);

test('reconcile isolates every row, always schedules the next wake-up and retries failures',()=>{
 const coordinator=java('NativeDeletionCoordinator'),reconcile=body(coordinator,' boolean reconcile()',' void start()');
 assert.equal((reconcile.match(/\}catch\(Exception rowFailed\)\{failed=true;\}\}/g)||[]).length,2,'calendar and reminder rows each have their own catch');
 assert.match(reconcile,/finally\{if\(next\[0\]!=Long\.MAX_VALUE\)schedule\(Math\.max\(1,next\[0\]\)\);\}/,'the next expiry is scheduled even when a row throws');
 assert.equal((reconcile.match(/try\{owned=admitted\(/g)||[]).length,2,'an owner check that throws counts as not admitted in both reminder branches');
 assert.match(java('DeletionWorker'),/reconcile\(\)\?Result\.retry\(\):Result\.success\(\);\}catch\(Exception unavailable\)\{return Result\.retry\(\);\}/);
 assert.doesNotMatch(java('DeletionWorker'),/Result\.failure/);
});

test('owner network reads happen before the coordinator lock, never while holding it',()=>{
 const coordinator=java('NativeDeletionCoordinator');
 for(const [start,end] of [[' boolean reconcile()',' void start()'],[' JSONObject undo(',' /** Whether any row'],[' JSONObject dismiss(',' JSONObject undo(']]){
  const method=body(coordinator,start,end),lock=method.indexOf('synchronized(this)');
  assert.ok(lock>0,start+' takes the lock explicitly');
  assert.doesNotMatch(method.slice(lock),/agentOwner\(\)|agentOwnerOrNull\(\)|agentOwnerFor\(/,start+' performs no owner-route read under the lock');
 }
 assert.doesNotMatch(coordinator,/synchronized (void|boolean) reconcile|synchronized JSONObject (undo|dismiss)\(/);
 assert.doesNotMatch(coordinator,/private boolean current\(|private boolean canUndo\(/,'no per-row owner network read helpers remain');
});

test('a deterministic stage refusal never leaves a permanent agent claim',()=>{
 const deletions=java('AlphaDeletionsPlugin'),positive=body(deletions,'NativeDeletionCoordinator coordinator=NativeDeletionCoordinator.get(getContext());String operationId;','}).create();');
 assert.ok(positive.indexOf('coordinator.stageAdmissible(owner)')<positive.indexOf('NativeDeletionClaim.check('),'owner and selection are checked before the claim');
 assert.match(positive,/\}catch\(Exception failure\)\{outcome\[0\]=unstaged\(coordinator,operationId\);\}/);
 assert.match(deletions,/return staged==null\?new JSONObject\(\)\.put\("status","not-staged"\):new JSONObject\(\)\.put\("status","queued"\)/,'not-staged only without a receipt for the exact operation');
 assert.match(deletions,/if\(retired\|\|review!=null\|\|!foreground\(\)\)\{resolveStatus\(call,"unavailable"\);return;\}/);
 assert.match(deletions,/resolveStatus\(call,"stale"\);return;/);
 const calendar=java('AlphaCalendarPlugin'),enqueue=body(calendar,'enqueueReviewedDeletion(','@Override @PluginMethod public void executeAgent');
 assert.ok(enqueue.indexOf('stageAdmissible(owner)')<enqueue.indexOf('NativeDeletionClaim.check('),'calendar checks the owner before claiming');
 assert.match(enqueue,/staged=coordinator\.receipt\("calendar",id\)/,'a persisted calendar stage is never reported as unchanged');
 const agent=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 assert.match(agent,/if\(reminderDeletionRefusal\(queued\.status\)\)return \{status:'failed',summary:'Deletion was not queued\. Nothing changed\.'\};/);
 const adapter=readFileSync('apps/app/src/prototype/reminder-adapter.ts','utf8');
 assert.match(adapter,/const refusal=reminderDeletionRefusal\(reviewed\.status\);/);
 const runtime=readFileSync('apps/app/src/runtime/deletions.ts','utf8');
 for(const status of ['stale','unavailable','not-staged'])assert.match(runtime,new RegExp(`status==='${status}'\\?`));
 assert.doesNotMatch(runtime,/status==='unknown'\?/,'unknown remains an uncertain outcome');
});

test('both notice owner fences are written even when workflow cancellation fails',()=>{
 const plugin=java('AlphaHostedResultsPlugin'),method=body(plugin,'public void withdrawOtherOwnerApprovalNotices','@PluginMethod public void resumeWorkflowApprovalNotice');
 assert.match(method,/try\{withdrawn=WorkflowNoticeTapsFactory\.delivery\(getContext\(\)\)\.withdrawOtherOwners\([^;]*;\}catch\(Exception workflowFailure\)\{failed=workflowFailure;\}/);
 assert.match(method,/try\{notices\(\)\.withdrawOtherOwners\(owner\);\}catch/);
 assert.match(method,/if\(failed!=null\)throw failed;/);
});

test('reviewed photo changes use the shared resume-gated review with Alpha\'s launch gate',()=>{
 // Resume gating and rejection codes are the shared native media module's PermittedMediaReview (tested there).
 // AlphaPhotos registers the shared PhotosPlugin; its launch gate answers with Alpha's LateLaunch wording.
 const photos=java('AlphaPhotosPlugin'),bridge=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/PhotosPlugin.java',import.meta.url),'utf8');
 assert.match(bridge,/mediaReview = new PermittedMediaReview\(getBridge\(\), permitted, worker, this::ask\);/);
 assert.match(bridge,/protected final boolean ask\(PluginCall call, Runnable launch\) \{\n {4}try \{\n {6}launch\.run\(\);\n {6}return true;\n {4}\} catch \(IllegalStateException closed\) \{\n {6}call\.reject\(closedMessage\(\)\);/);
 assert.match(photos,/@Override protected String closedMessage\(\)\{return LateLaunch\.CLOSED;\}/);
});

test('album listing reads permitted members in batches and fences only the metadata',()=>{
 // Custom albums are the shared OwnedAlbums; batched member reads are PermittedMediaCatalog.albumItems.
 const photos=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/PhotosPlugin.java',import.meta.url),'utf8');
 assert.match(photos,/albums = new OwnedAlbums\(getContext\(\), config, owned, permitted\);/);
 const albums=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/OwnedAlbums.java',import.meta.url),'utf8');
 const rows=body(albums,'  private JSArray permittedRows(','  private static boolean hasPermitted(');
 assert.match(rows,/permitted\.albumItems\(wanted\)/);assert.doesNotMatch(rows,/albumItem\(/,'no per-member fenced read');
 const custom=body(albums,'  public JSObject list(','  public JSObject change(');
 assert.ok(custom.indexOf('permitted.requireCurrent(fence);')>0&&custom.indexOf('permitted.requireCurrent(fence);')<custom.indexOf('permitted.albumItem(key, row.getString("identity"), true)'),'thumbnails load after the metadata fence');
 // PhotosTrashInstrumentedTest stalls real album writers on the plugin's gate: it must be the shared write lock.
 assert.match(photos,/public static final Object ALBUMS_LOCK = OwnedAlbums\.LOCK;/);
 assert.match(albums,/public static final Object LOCK = new Object\(\);/);
 assert.match(body(albums,'  public JSObject change(','\n}\n'),/synchronized \(LOCK\)/);
});
