# Daily overview on Home (AP-07, MVP-19)

This maps the daily overview requirement to the cards Home actually renders. It describes
source behavior and browser tests only. It is not APK, emulator, AOSP image, real-provider or
device acceptance evidence; those gates stay open in [current status](mvp-current-status.md).

## Shared ownership (October 27 direction)

The overview domain and cards are upstream elizaOS code that Alpha consumes through the pin
(`scripts/prepare-client-features.mjs` stages them):

- `packages/ui/src/overview/daily-overview.ts`: presenters for every card state (loading, ready,
  empty, stale, error, access off, not connected), agenda selection (`selectOverviewAgenda`:
  overdue reminders first, the next item kept on its own line), the agent-calendar feed states
  (`presentOverviewAgendaFeed`) and the stale rule (`overviewReadIsStale`: the last completed read
  is from an earlier local day). `apps/app/src/prototype/home-cards.ts` only binds Alpha's locale.
- `packages/ui/src/overview/OverviewCards.tsx`: the agenda, attention and brief cards. Home renders
  the agenda and brief cards through `apps/app/src/prototype/home-overview-cards.ts`, which keeps
  Alpha's classes and the installed `data-alpha-home-*` selectors.
- `plugins/plugin-workflow/src/client/hosted-digests.ts`: the digest client, the client-scoped
  result inbox, retained-brief selection and `RetainedBriefStore`, fenced to the current
  connection scope (origin, owner and agent). `apps/app/src/runtime/hosted-digests.ts` keeps only
  Alpha's store binding and the `alpha:retained-digest` event.
- `plugins/plugin-workflow/src/services/hosted-digest-policy.ts`: the occurrence policy (120-second
  run window, not-run records and their texts, source state) used by the agent's admission and by
  the test-mocks development scheduler. Scheduling stays with the agent's durable runtime
  scheduler (TaskService triggers): schedules run only while the phone is on, an occurrence that
  came due while it was off is recorded once as missed at startup and never run late, and no
  second scheduler exists.

The Inbox card still renders through the template with the shared presenter text; its values are
computed by the Inbox adapter.

## Cards

| Card | Source | Attribution and freshness shown | States |
| --- | --- | --- | --- |
| Calendar (`data-alpha-home-calendar`) | The agent's calendar feed (Agent Calendar) when it owns Home; device calendars read by the Calendar adapter in the explicit device scope; reminders from the reminder store. Agent Calendar states: reading, not connected, under review, failed or unavailable (`Open Calendar to retry`, read again on open), fresh (`Agent Calendar`, `As of <time>` in the description), empty only after a complete read, and stale (a partial feed or a snapshot from an earlier day keeps the item with `Not updated since <time>` and `data-alpha-home-calendar-stale="true"`). Under an overdue reminder the agent's next event shows on the `Next:` line | Calendar name beside the date, `Read <time>` beside the event time; the full sentence is the card's accessible description. An upcoming reminder shows `Reminder` and the reminder store's read time instead of a calendar's | Loading, no upcoming events, results limited to the first 2,000 events, read failed with `Open Calendar to retry` (opening Calendar from the card reads it again), access off, not connected |
| Overdue reminder (same card) | Reminders that are due and not done (`overdueReminders`) | Header `Overdue reminder` or `N overdue reminders`, `Due <time>`, `Read <time>` of the reminder store; description names the reminder store | Shown before any event, including one already in progress, until it is completed or cancelled or its due time moves to the future. A snoozed reminder that keeps its original due time stays listed. The next event or reminder still shows below it on a `Next: <title> <time>` line with its own source and read time |
| Workflows (`data-alpha-home-workflows`) | Workflow list from the connected agent; the unified automations list after the user opens Workflows | `Loaded <time>` under the status line once a list was loaded for the current connection; the source is named in the accessible description only | Connect agent, loading, empty, failed with retry, partial, last loaded |
| Inbox (`data-alpha-home-inbox`) | Metadata of the Inbox page the user loaded in Inbox | Account label and `Read <time>`; `From loaded messages` when the page was partial. The time is the completed first-page read; loading more pages or changing read state in Inbox does not move it | Connect email, open to check or load, updating, no unread email, failed with `Open to retry · last read <time>`, reconnect |
| Latest brief (`data-alpha-home-brief`) | Newest scheduled-digest result retained in this app for the current connection (`latestRetainedDigest`) | Agent name and `Ran <time>` or `Failed <time>`. An occurrence the agent recorded without running it (missed time, overlapping run, unavailable source) is a record, not a brief: `rememberRetainedDigests` never retains it, so it does not replace the last brief that ran and produces no card on its own. The presenter still labels such a status `Did not run <time>` if one ever reaches it | Absent when no result is retained; a failed run shows its error text. Opens the scheduled digests list |

While the app calendar is hidden in Calendar's display settings (browser only; device calendars
have no in-app toggle), Home leaves its events out as Calendar does and shows `No visible events`
when nothing else is due. Reminders are not affected.

Times are when this app read the data on this device. They are not provider sync times.
A read from an earlier day shows its date.

## Boundaries

- Home never reads mail. The Inbox card changes only after the user loads or refreshes Inbox,
  and it never shows message bodies. `test/browser/home-daily-overview.spec.ts` counts provider
  reads while Home is rendered, re-rendered and refocused.
- The brief card shows a retained result. Showing it reads nothing and runs nothing. Opening it
  opens the scheduled digests list, which syncs retained results with the agent as it does when
  opened from Settings; it does not run a digest.
- No card has fixture avatars, a placeholder brief or sample agenda text outside builds made
  with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`.
- New-mail notifications and background mail checks depend on open decision A-05 and are not
  implemented.

## Tests

- `test/home-cards.test.mjs`: presentation of every card state.
- `scripts/test-inbox-cloud-flow.mjs` (run by `test/adapter-contracts.test.mjs`): the Inbox read
  time across a first page, a later page and a refresh.
- `test/home-cards.test.mjs` also covers `homeCalendarName`, the lookup of the calendar an event
  was read from: the event's own calendar id in the same read, exact string ids, no name for an
  unknown calendar, a calendar without a display name or a read that returned no calendars, and
  the latest read's name after a rename.
- `test/browser/home-daily-overview.spec.ts` (development lane, synthetic provider data). The
  brief card is covered in two halves: the card renders a retained result placed directly in the
  retained-result store, and the digest panel is checked to publish the connected development
  profile's newest retained result to that store and withdraw it on disconnect.
- `test/browser/journey-d-digests.spec.ts` (development lane): the development scheduler runs a
  digest and the rendered Home card is asserted at each stage. The development profile reads the
  same `latestRetainedDigest` source as the product profile.
- `test/browser/home-daily-overview.production.spec.ts` (flag-off build, fresh profile).
- `test/browser/home-brief-result.production.spec.ts` (flag-off build, Android bridge stubbed by
  `test/browser/flag-off-android.ts`; nothing is placed in the renderer or the retained-result
  store):
  - One run from a digest result to the card, by both result routes. `native`: the stubbed Android
    result inbox (`AlphaHostedResults.syncInbox`) returns what the agent produced. `renderer`:
    background delivery could not be configured, so the renderer reads the agent's result page over
    the bridge, commits each result to the secure store and acknowledges it. In both, the digest
    panel publishes the newest result that ran and Home renders it with the connected agent's name
    and the run's completion time. Later missed, overlapping and unavailable records reach the
    digests list and leave the card unchanged; with only missed and unavailable records there is no
    card; a newer run and a failed run replace the card; the card returns after the renderer
    restarts. No request that would start or change a schedule, a source or a delegation is made,
    before or after that restart: the stub records and refuses every such request, and answers only
    the digests list's read of pending Google access revocations.
  - The calendar name: a named device calendar, a rename seen on the next read after the app
    resumes, an event whose calendar the read did not return (`Device`, and no other calendar's
    name), a calendar the provider reports without a display name (`Unnamed calendar`), permission
    revoked between reads (`Connect your calendar`, no event, name or read time), and permission
    denied on request (`Calendar access is off`), then granted.
  The stub is not the resident runtime, its scheduler, `HostedDeliveryWorker`, the native inbox
  journal or Android CalendarProvider. No digest ran and no device calendar was read.

## Still open

- Real Gmail, device-calendar and scheduled-digest transitions on an installed build.
- Calendar access denied, not connected and device calendar names are Android-only states. Unit
  tests cover the status mapping, the card title, the source line and the name lookup, and the
  flag-off browser spec covers them with the Android bridge stubbed. There is no instrumented or
  device run: nothing here has read Android CalendarProvider.
- TalkBack reading of the card descriptions on a device.
- A digest result travelling from a real agent (the resident scheduler, a real run and the native
  delivery path) to the brief card on an installed build. The browser tests cover that run only
  with a stubbed agent and bridge (see Tests).
