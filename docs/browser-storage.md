# Browser storage

The browser MVP must retain every committed change and its matching receipt across
tabs, reload and cancellation. Web Locks around localStorage do not establish that
property: the retained rapid-edit regression reproduced a lost WebKit update.
The browser document store admitted from upstream uses IndexedDB transactions and
revision compare-and-swap. Atomic first imports preserve one revision across concurrent
readers. Alpha supplies domain names and legacy recovery policy.

## Domain contracts

| Domain | Source integration | Behavior and verification scope |
| --- | --- | --- |
| Calendar | `browser/calendar-store.ts`; async Calendar and digest reads; revision-checked backup/reset; cross-tab refresh | Creation/recovery, queued-read cancellation, transaction abort and stable-read-revision browser suites; domain import/recovery unit tests. |
| Hosted digest result notices | `browser/hosted-results.ts`; durable rows and pending-tap token move together; cross-tab notice invalidation | Hosted-result browser suite covers notice flows, duplicate publication, pending taps and failed IndexedDB writes. |
| Media saved-copy request | `runtime/media-copy-intent.ts`; transactional admission and exact cleanup for photo/video copy receipt recovery | Cancelling before dispatch clears only its own request. Recovery preserves legacy bytes and never deletes or recreates media. |
| Workflow client pending requests | `runtime/workflow-intents.ts`; captured account document, atomic admission and exact acknowledgement for run, metadata, lifecycle and approval requests | Legacy request bytes remain recoverable; reset does not replay or undo effects. Concurrency and lifecycle cases belong to the owning browser suite. |
| Owner-bound workflow drafts | `browser/workflow-drafts.ts`; awaited reads and serialized expected-value updates | Workflow-authoring browser suite covers two-tab conflicts and owner changes during pending reads. |
| Reminders and alarms | `browser/reminder-store.ts`; `browser/daily.ts` readers, writes and operation receipts; Calendar/Clock cross-tab refresh; shared backup/reset UI | Empty and unchanged polling retains document revisions. Owning Chromium and Firefox suites cover concurrent writes, atomic receipts, stale resets and interrupted recovery. Alert-sound history has its own migration and recovery boundary below. |
| Reminder creation and action history | `browser/reminder-creation-document.ts`, `browser/reminder-action-document.ts`; shared JSON archive handling over canonical documents | Pending creation, edit, cancellation, completion and snooze identities survive uncertain outcomes. Expected-value acknowledgement refuses replacement records. Separate backup/reset controls never replay actions or undo their effects. Android retains secure compare-exchange. |
| Notification policy, access and history | `browser/notification-store.ts`; policy, device events and redacted history migrate together; reminder delivery and workflow-focus epoch readers await canonical policy | Preserves the active v2 or older partial v1 source for backup/reset. Unchanged reads retain authority and document revision. First reads serialize initialization across tabs. Chromium and Firefox suites cover concurrent initialization, backup/reset, failed writes, and external/focus/Calendar/hosted-result cancellation before and after commit. |
| Workflow notifications | `browser/workflow-notices.ts`, `browser/workflow-history.ts`; async canonical list/history/export and transactional delivery/compaction receipts | Owning history, lifecycle and receipt suites cover stale compaction (including identical-byte restoration), cancellation, concurrent publication and canonical/changed-legacy backups. Changed workflow callers have integration coverage; current-source hosted and engine qualification remain separate gates. |
| Development agent conversations | `browser/development-agent-document.ts`; conversations, scripted replies and message receipts migrate together; protocol, workflow and digest consumers await canonical reads; selected-profile backup/reset | Queued account changes, Home cancellation, two-tab messages, receipt rollback and malformed backup/reset are exercised by the owning browser cases. Real local-agent host data uses its separate runtime store. |
| Development workflows, action proposals and receipts | `browser/development-execution-document.ts`, `browser/development-workflows.ts`, `browser/development-actions.ts`; one owner document for both execution parts | Admission checks read workflow and proposal state from the same transactional snapshot. Captured old-owner journals can finish existing receipts after retirement, but cannot reserve or begin another action. Backup/reset retains or clears both parts together. |
| Development digest execution | `browser/development-digest-document.ts`, `browser/development-digests.ts`; grants, sources, loops, results and acknowledgements in one owner document | Empty/unchanged schedule polling does not create records or advance recovery revisions. Occurrence markers and output cursors commit with results. Read-only lists await canonical data, and late operations recheck connection ownership. Selected-profile backup/reset is available. |
| Development digest authorization UI | `browser/digest-authorization-document.ts`, `browser/digest-delegation-ui.tsx`; owner-scoped pending request with expected-value saves and cross-tab invalidation | Exact legacy bytes remain available for backup; unreadable requests disable new authorization until recovery. Closing or backgrounding the panel aborts pending work while retaining durable requests for recovery. Revision-checked reset does not revoke completed grants. |
| Development digest inbox | `browser/digest-storage.ts`; one account-scoped document containing the result index, saved results and pending request slots; selected-inbox backup/reset in Scheduled digests | Exact older slot bytes are retained inside a JSON archive. Expected-value writes remain serialized; late reads and recovery are bound to the connection. |
| Development Cloud setup | `browser/development-cloud-document.ts`, `browser/development-cloud.ts`; one provisioning document per sample account, shared quote/receipt protocol, selected-account backup/reset | Reads and mutations recheck the captured account session. Atomic edits preserve provisioning receipts, refuse stale quotes and retain exact legacy backups. Empty reads do not claim a revision. |
| Real Cloud setup intents | `runtime/cloud-personal-intent.ts`, `runtime/connection-ui.tsx`; browser owner-scoped activation/cutover intent with revision-bound admission and acknowledgement | Status queries capture the prior intent; late responses cannot clear a replacement request. Failed first writes prevent dispatch; cancelled undispatched admissions can clear only their own revision. Exact legacy backup and reviewed reset are available. Android retains its renderer slot and now compares the expected intent before updates. Real-provider qualification remains a separate gate. |
| Development Cloud account selection | `browser/development-account-document.ts`, `browser/development-identity.ts`; canonical account/session document, invalidated identity snapshot, async admission and restore | Selection publishes only after a committed write. Canonical checks reject stale sessions even without a cross-tab event; delayed hydration cannot replace a newer selection. Exact legacy bytes, malformed-state backup and revision-checked reset remain available. Captured old journals may finish existing receipts but cannot admit new effects. |
| Conversation restart choices | `runtime/conversation-selection.ts`, history restoration and new conversation creation in `runtime/connection-ui.tsx` | Atomic owner-key updates retain other owners, unique revisions refuse stale same-owner completion, and queued writes recheck connection authority. Exact legacy bytes and browser backup/reset are retained. Active chats stay tab-local until retirement. Owning cases cover competing owners, stale same-owner completions, queued cancellation, recovery and history restoration. Native storage keeps its installed format; native and full-product qualification remain separate. |
| Device preferences and roles | `browser/device-preferences.ts`, `browser/device.ts`; canonical writes/readback, ordered cache hydration for synchronous rendering/audio, asynchronous sensor admission and role documents | Unavailable settings keep recovery reachable, mute audio and disable sensor access. Device/storage suites cover ordered hydration, concurrent changes and cancellation during settings or location reads. |
| Browser bookmarks and notification sound history | `browser/preference-documents.ts`; awaited bookmark reads/writes, cross-tab bookmark refresh and transactional sound claims; separate backup/reset controls | Clock/storage suites cover bookmark refresh, sound receipts and recovery. Empty reads and unchanged sound polling do not initialize records; older bytes remain available for backup. |
| Development password provider | `browser/password-provider.ts`, `browser/preference-documents.ts`; asynchronous device status, canonical provider selection, cross-tab retirement and backup/reset | Provider lifecycle, storage and compact large-text suites cover pending dialog cancellation, retired sample fills and recovery. This is the development sample provider, not real Proton credentials or native autofill acceptance. |
| Photo albums | `prototype/browser-camera.ts`, `browser/preference-documents.ts`; canonical album names/membership and revision checks, cross-tab catalogue refresh, exact-byte backup/reset | Album/storage suites cover concurrent creation, cross-tab refresh, failed writes and stale recovery. Saved media remains in its existing IndexedDB database; album reset does not delete photos/videos. Album metadata and media bytes are separate transaction domains. `alpha.browser.albums.v1` holds album names and media membership; photo/video payloads already use a separate IndexedDB store. |

This table describes implemented contracts and test scope, not a consolidated passing
report. Consult revision-bound results using the [verification guide](verification.md).
It covers the canonical browser domains, not every localStorage key.
Connection selection, prototype state and independent security/operation
stores require their own ownership and synchronization audit. The
[remaining persistence audit](browser-storage-remaining-audit.md) identifies their
writers, invariants and required verification. Do not change a
writer while leaving its synchronous reader pointed at legacy bytes. Never add a
writable localStorage mirror to make old fixtures pass.

## Storage and recovery rules

- Preserve the exact legacy bytes, including malformed or empty values. Never
  reinterpret corrupt data as an empty domain or overwrite it on startup.
- Storage reads must not invent domain records. Calendar may initialize its stable
  source identity without inventing events; digest reads do not initialize it.
- Close older app tabs before migration. A later observed legacy change refuses
  access and retains both versions; legacy snapshots are not transactional.
- Reset requires reviewed captured state and a current revision. Keep a canonical
  tombstone so the retained legacy backup cannot reappear as active data.
- Edit callbacks are not replayed. Cancellation before commit aborts the pending
  transaction; an already committed result retains its receipt.
- Recheck account and UI ownership after asynchronous reads. Cross-tab notices
  invalidate views without taking over an originating action's completion UI.
- Tests must inspect the canonical store and inject actual IndexedDB failures.
  Legacy initialization fixtures should seed once, preserving reload behavior.

## Required evidence

Keep terminal results and failed reproductions, tied to source commits. Require
real multi-document concurrency, unique receipts, malformed-byte recovery,
write failure, tab death, stale reset and cancellation cases. Run the owning UI
journeys across Chromium, Firefox and WebKit, then repository verification and
current hosted checks. The shared domain atomicity suite covers rapid cross-tab
writes, unique receipts,
failed commits and tab closure against the canonical store. Domain-specific
journeys must still verify their callers; passing Calendar does not qualify
another domain. Browser CI runs the canonical domain and development Cloud
setup cases in Firefox and WebKit alongside the full Chromium shards.
Browser evidence does not prove
Android process, Keystore, reboot, Doze or physical-device acceptance.

## Development simulator ownership

The prototype application reducers intentionally use one origin-wide Web Locks
writer lease. A second development tab can inspect data but must close the writer
and reload before saving or resetting. Recovery uses the same writer instance;
reset checks the loaded and current bytes, verifies removal, then retires the
writer before reload so queued stale reducers cannot recreate the old snapshot.
Malformed bytes remain available for backup until an explicit successful reset.
This contract applies to development fixtures, not native application storage.
The reset ownership browser suite exercises the writer lifecycle. Its results apply only to the tested source and engine.

## Notes and audio deletion

Browser Notes uses upstream `DocumentNotesStore` through the product
`browser/notes-document.ts` adapter. IndexedDB owns the saved envelope; the
synchronous editor list is only an optimistic view. Collection IDs, record
revisions, deletion tombstones and metadata retain their existing format.
Original v2, v1 and daily bytes remain verbatim in the archive and localStorage.
Later changes to retired Notes sources stop normal access. Unrelated daily
receipts do not invalidate Notes. Confirmed reset creates a new empty collection
without reimporting retained sources or deleting recording bytes.

Audio-deletion pending records use a separate canonical document, and recovery
reads the same authoritative Notes envelope as the editor. The independent
`alpha.notes-audio-effects.v1` lock still serializes deletion, restoration and
reconciliation. Storage transactions alone do not authorize replaying an audio
effect. Exact backup and confirmed reset are available from Notes; unsaved text
must be copied or exported before a reset reloads the app.

The owning suites cover independent tabs, stale editors, exact archives,
malformed recovery, failed writes, lost acknowledgements, deletion receipts,
retained unknown outcomes and restoration against newer notes. Browser CI runs
the document/save-failure and audio-recovery suites across its configured
engines. Android retains the encrypted adapter and requires separate qualification.
