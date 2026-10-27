# Browser development capabilities

Browser development uses Alpha's renderer and the same application-facing plugin
contracts as Android. Run `npm run dev` (which sets `ELIZA_DEV_ALLOW_TEST_MOCKS=1` and starts the local agent; `npm run dev:ui` is renderer-only) and
open `?mode=dev` for the disclosed local device profile; use `?mode=dev&workflows=agent`
for workflow authoring. Both entry points exist only on the development server with the
switch on. The [README](../README.md) describes device controls and the switch, and
[local agent development](local-agent-development.md) covers actual host inference
and speech. Mock mode (`?mode=mock`, switch on only) is a separate design fixture.

Production builds (`npm run build`, and the web payload of every distribution APK) are
built with the switch off and contain none of the surfaces below that are marked
development-only: the development profile, device controls, simulated Phone/SMS/
Contacts/Wallet apps, injected events, manual location, the development password
provider and the local development agent bridge. `npm run test:browser:production`
checks that boundary on the rendered production build.

The browser profile supports development without carrier roles, Android system
permissions or provider credentials. Its local calls, messages, payments, roles
and device settings never cause external side effects. Available browser behavior
does not establish native or production acceptance. See the
[browser review](mvp-browser-review.md) and [requirement status](mvp-current-status.md)
for remaining product gates.

## Capability ownership

| Surface | Browser implementation | Qualification boundary |
| --- | --- | --- |
| Browser | Isolated frames, navigation, bookmarks, downloads, reviewed reading and external-tab handoff | Same-origin and embedding restrictions remain intact; no Android bridge is exposed to remote frames. Web clearing removes Alpha tabs/history only; site-data deletion is unavailable and private tabs do not promise browser-wide cookie erasure. |
| Calendar | Local events, series/occurrence edits, civil dates, guest responses, meeting preview, alerts and reviewed agent actions | IndexedDB documents, cross-tab revisions and explicit recovery; no provider sync, real invitations or conferencing is implied |
| Reminders and Clock | Local schedules, recurrence, Done/Snooze, foreground due checks and alert audio | Closed pages cannot promise delivery; native reboot, Doze and audibility require separate tests |
| Files and Notes | Reviewed local imports, managed trees, text/audio/documents, exact-byte exports and attachment selection | Imported copies do not rewrite their source files; native SAF and secure storage remain separate |
| Camera, Photos and Scan | Browser capture/import, OCR, local libraries, edits, video export, multipage PDFs and draft recovery | Browser permission/media tests do not establish physical camera quality, torch behavior or Android capture lifecycle |
| Voice | Microphone capture, transcription through the local agent (libelizainference) or Cloud, transcript review, explicit local/agent routes, manual fallback and owned playback | Synthetic audio tests are separate from real ASR/TTS integration, physical microphones and latency acceptance |
| Maps | Shared map renderer, configured transport, browser geolocation and manual development locations | Provider/data coverage, license obligations and physical navigation require their own qualification |
| Connection and assistant | Local development profiles, conversation state, reviewed proposals, receipts and optional actual host connections | Simulated profiles do not prove Cloud/provider authentication or native resident execution |
| Inbox | Local development messages, drafts, attachments and send receipts; separate real host adapter | Local send receipts never claim external delivery or consent |
| Workflows and digests | Typed authoring, review, drafts, execution fixtures, schedules, retained results and notification taps | Browser fixtures and actual runtime execution are distinct; owner changes and cancellation must retire pending work |
| Notifications | Local shade/history, reminder/workflow notices, browser permission handling and injected development events | Native channels, background delivery and protected OS access need Android evidence |
| Device and lifecycle | Home, Back, power, lock/unlock, assistant, background/resume, display/sound/radio controls and local role selections | These model app-facing events; they do not grant host privileges or reproduce a full AOSP boot |
| Phone, SMS, Contacts and Wallet | Explicit development-only local simulators behind the deferred shipping scope | No real calls, carrier messages, payments or production route activation |
| Password-provider setup | Local development provider selection, session unlock and sample fill | No collection of real credentials or claim of native password-provider/passkey acceptance |

The [native method inventory](browser-native-method-inventory.md) maps the plugin
contracts. Register browser implementations before consumers register Capacitor
plugins, and preserve the existing native/browser selection boundary. Product
names, routes, namespaces and capability policy stay in Alpha; reusable engines
and platform contracts come from the reviewed upstream pin.

## Storage and lifecycle

Browser state is local to the origin. Preserve selected owner, account and UI
lifetime across asynchronous reads, dialogs and writes. A late completion must
not replace a newer draft, reopen retired UI or silently replay a side effect.
Expose unavailable, failed, cancelled and uncertain outcomes distinctly.

Calendar, owner-bound workflow drafts and hosted-result notices use the upstream
transactional document API with Alpha's import/recovery policy. Other domains
still use the legacy localStorage helper and require migration. The
[storage ownership guide](browser-storage.md) lists those domains and their
coupled readers, writers and recovery paths. Do not treat a Web Lock around
localStorage as proof that every tab observes the latest committed state.

Preserve exact recovery bytes, including malformed data. Resets require explicit
review and a current revision. Closing older tabs avoids competing legacy
writers; observed changes to retained legacy data require recovery. Never create
a writable legacy mirror to satisfy an old reader or test fixture.

## Browser constraints

Remote sites may refuse embedding or deny cross-origin access. Keep browser
security controls intact and offer a normal external-tab action rather than
stripping those restrictions. Directory pickers require supported browser APIs,
permission and user activation; local-tree/import alternatives must describe
copies honestly.

Release owned media tracks, object URLs, dialogs and pending actions when their
owner retires. Manual Wake opens the recording UI; it does not promise continuous
wake-word detection. Device controls simulate lifecycle events without changing
the user's real OS settings.

## Verification

Run `npm run verify`, the owning cases in `test/browser`, and relevant integration
cases after a change. `npm run test:browser -- --browser=firefox` selects an engine;
Chromium is the default and WebKit requires its browser runtime and host libraries.
Keep test source frozen during a campaign because development reloads interrupt
in-flight interactions. Inspect screenshots for changed layouts, including compact
phone sizes, large text, keyboard focus, reachable actions and light/dark themes.

Use explicit fixture profiles. Actual local-agent recording, transcription and
playback require the configured host; a profile-dependent skip is not a pass.
Retain terminal results, failures and exact source identities in `test-results/`.
Historical campaigns in Git and saved reports apply only to their recorded source,
not automatically to current main. Current hosted checks must be inspected
separately from focused local runs.

Run `npm run android:build:local` (the chained build; plain `npm run android:build` stops
before Gradle when an input is missing) for both standalone and launcher distributions after
consumer changes. APK assembly, emulator bridge/HOME-role tests, full AOSP image
boots, real provider integrations and physical-device/user acceptance remain
separate gates. Never use one as evidence for another.

## Web capability policy — October 23

The owner permits device-only operations to be omitted or disabled in web mode.
A web fallback must report what it actually did. Browser site-data deletion is
native-only; clearing Alpha history does not sign the owner out of remote sites.
Private web tabs omit Alpha history persistence without claiming to erase cookies
owned by the embedding browser. Android retains its native profile behavior.

Maps remains foreground-only on web. On Android, an inactive or failed navigation
service update immediately retires screen-off ownership and reports foreground-only
guidance; late replies from a retired route cannot stop its replacement. Cloud
place identifiers remain opaque, bounded strings; provider-specific validation
belongs to the Cloud provider rather than the phone's generic adapter.
