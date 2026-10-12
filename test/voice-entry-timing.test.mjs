import test from 'node:test';
// October 12 owner decision: ongoing chat auto-sends after explicit start.
// Entry/retirement behavior has separate tests; source-bound timing is still missing.
for (const view of ['Home', 'Calendar', 'Notes']) {
  test.todo(`Ongoing voice from ${view}: explicit start, automatic committed turn, source-bound latency marks`);
}
test.todo('Ongoing voice: Stop abandons unfinished timing and rejects late playback marks');
