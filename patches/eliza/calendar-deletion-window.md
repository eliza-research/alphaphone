# Reviewed Calendar deletion patch

This explicit patch applies to the pinned Eliza source named in
`native-manifest.json`; the submodule is unchanged. The manifest authenticates the
patch and every input/output Java file.

The host persists a deletion claim before dispatch. A single provider transaction
asserts the reviewed calendar, recurrence family, attendees and reminders before
performing the scoped mutation. An uncertain outcome cannot be replayed as a new
operation. Null provider cursors are unavailable, never evidence of deletion.

For synced recurring events, occurrence deletion creates or cancels the exact
provider exception through the public app API. This is local provider evidence,
not confirmation that a remote organizer accepted a change.

On the API35 test provider, inserting an exception for a local series without a
sync ID damaged the cached instance expansion. Updating only the parent's DTSTART
also produced an incorrect zero-duration instance. Neither result is accepted.
The replacement path for a local series without existing exceptions adds the exact
original UTC occurrence to EXDATE, preserving existing exclusions and supplying the
unchanged recurrence/time fields in the same checked update. It verifies both the
stored exclusion and the absence of that occurrence. It does not create an
invitation or invent a replacement event.

RDATE-only occurrence deletion, nonlocal series still awaiting a sync ID,
local unsynced families with existing exceptions,
and local occurrences not aligned to whole seconds require Android Calendar
editor review. Inspection returns `external`, so the existing renderer handoff
opens the editor and states that Alpha has deleted nothing. Series deletion
continues to target the exact reviewed family.

`test/scoped-calendar-snapshot.test.mjs` exercises transaction contents, stale
snapshots, unavailable queries and unsupported-family refusal against authenticated
patched sources. `ScopedCalendarDeletionInstrumentedTest` exercises the real
provider with disposable local and synthetic-account calendars, Undo, expiry,
readback and stale-target refusal. Native validation of the replacement EXDATE
path is pending; earlier failed runs are retained in the PR evidence. Journal
reconstruction in this fixture is not an actual process-death test.
