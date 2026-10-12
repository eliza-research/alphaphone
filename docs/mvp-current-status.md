# Current MVP status

## October 12 approved policy versus current implementation

All 32 decision choices are resolved in the [approved backlog](owner-approved-mvp-plan-2026-10-12.md).
Older capability observations below describe the source/evidence at their stated
revisions, not current policy. Cloud speech, credits, optional hosted agents and
all-four-view deferral are implementation gaps against the new requirements.
AOSP includes Phone/Contacts/SMS and always-on listening; Wallet is excluded.
The PRD matrix below is updated for that scope. No historical test result is promoted.


The MVP is not complete. This index separates implemented capabilities from
remaining acceptance work. Source ownership is defined in
[architecture.md](architecture.md); browser capabilities and their limits are
listed in [browser-dev-parity.md](browser-dev-parity.md) and
[mvp-browser-review.md](mvp-browser-review.md).

## Product boundaries

- The primary agent runs on Android. Browser development uses a private local
  host. The production Android Welcome dialog offers Cloud sign-in for the on-device
  agent or local apps without AI. Remote pairing is retired on production Android and
  remains a browser and test-mocks development transport (see Connection choices below).
- The upstream pin in `upstream.lock.json` is `13c9857598`, the merge commit of upstream
  pull request 34888, reachable from elizaOS `develop` when
  `scripts/ci/upstream-reachability.json` was recorded (2026-10-11 UTC). It adds the shared
  notification receipt ledger, which `WorkflowNoticeDelivery` now configures with the
  deployed slot names and record formats, to the shared password manager, password
  transfer and Keystore text frames; no local source patch remains (the `patches`
  directory is gone). Results recorded at the earlier pins `40dbe96bd1`, `945209d3`,
  `4148a166` and `352d7a08` are historical, and that includes every entry under
  [current qualification evidence](#current-qualification-evidence) except its first two, the
  round 8 and round 9 integrations, which are the only ones at the current pin. At the
  current pin there are source and browser test results, developer APK builds without the
  resident runtime (not distributable) and one partial emulator campaign on such builds
  ([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9));
  no distribution APK build and no device run is recorded: see MVP-08 in the
  [remaining-work inventory](mvp-remaining-work-2026-10-09.md).
- Local orchestration does not imply local inference. The configured text model
  uses hosted Cerebras; Whisper/Kokoro speech has separate host and Android paths.
- A powered-off phone cannot run its resident agent. Acceptance of missed-occurrence
  recovery in place of powered-off execution remains an explicit product decision
  ([A-09](decisions.md#open-decisions)).
  Optional remote execution needs separate qualification.
- Notes, Calendar, Reminders, Browser/password-provider integration, notifications,
  assistance, workflows, digests, Files and capture remain in scope. Gmail/Email is
  in MVP scope ([P-02](decisions.md#october-7-owner-product-decisions)); its software
  gaps are closed below and real-account acceptance remains open. Telegram,
  Discord, Phone, SMS, Contacts and Wallet are deferred by MVP policy; development
  fixtures do not change that scope.
- October 7 product policies are recorded in
  [decisions](decisions.md#october-7-owner-product-decisions): voice is reviewed and
  sent by the user, not auto-sent; browser tabs keep sign-ins in a persistent profile
  with an ephemeral private-tab option; an integrated password manager is an elizaOS
  upstream component, with Proton Pass optional; deleted notes (text, checklist, link
  and voice, including the voice recording) go to a Trash that empties after 3 days; the browser build gets speech recognition (local preferred,
  cloud only by disclosed opt-in); OCR is English only for now. Cross-app notification
  mirroring stays opt-in, off by default and outside MVP acceptance. These are policy
  decisions, not implementation or acceptance evidence.
- Production builds are the live app. Mock mode, prototype fixtures, the development
  profile, device controls, simulated apps and debug-only native hooks exist only in
  builds made with `ELIZA_DEV_ALLOW_TEST_MOCKS=1` (`npm run dev`, Playwright, explicit
  test-mocks builds). The production web build and all four distribution APKs are built
  with the switch off. The web build is a development/preview surface and the APK
  payload, not a separate product. See the
  [production readiness record](https://github.com/AlphaCompute/alphaphone/blob/51c8157533353a805afd2811f4e3f41b66b7b9fa/docs/production-readiness-2026-10-04.md).

## Capabilities and remaining acceptance

Evidence class codes in the last column follow the classes defined under
[Qualification](#qualification): S source/test, B APK build, E emulator, I AOSP image,
R real integration, D device/user. "Historical" means the class was observed only on an
older build or source revision and does not qualify the current head; a row without a
class has no evidence of that kind for the current head. "E developer APKs" means the class
named passed on an SDK emulator on developer APKs (no packaged resident runtime, unqualified
speech runtime) in a run recorded in [verification](verification.md): "round 8" is the run
at the current pin, whose final APKs were built from the product source of main, and
"round 7" is the run at the earlier pin `40dbe96bd1`, which is historical. Neither is
evidence for a distributable build, an image or a device.

| Area | Implemented boundary | Remaining acceptance | Evidence class |
| --- | --- | --- | --- |
| Home and launcher | Branded Home with clock, agenda cards from real providers and a grid of the enabled Alpha views; the launcher flavor declares the `HOME`/`DEFAULT` filter; quick-setting tiles show the switch states Android reports and open the matching Android Settings page (see Settings). An All-apps drawer with search lists the apps `DeviceAppsPlugin` reports, launches one by package, opens the stock dialer, and shows explicit empty and failed states with a manual retry (`apps/app/src/prototype/home-launcher.ts`; `home-launcher.spec.ts` and `home-native-launcher.spec.ts`, both against a stubbed bridge). A landscape layout places Home and the composer side by side and docks the conversation beside Home (`home-landscape.spec.ts`); `app.config.json` leaves orientation unspecified. | Emulator HOME-role selection, opening three installed apps and returning HOME each time: `LauncherHomeInstrumentedTest` and `SettingsRolesInstrumentedTest` run only in the runner's `--home-role` phase. On developer APKs at the current pin both passed 3 of 3 on the final APKs with the original HOME holder read back, after two unawaited conditions in the SettingsRoles test were awaited and a process crash seen once in 22 LauncherHome runs was fixed ([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)); since round 8 the launcher flavor keeps one live `MainActivity` when the role is granted. Still open: the same phase on a distributable build, default HOME in a full image (class I) and physical use (class D). `RotationInstrumentedTest` passed on both flavors in round 7 ([verification](verification.md#emulator-results-at-6dcdde34-2026-10-10-round-7)) and was not repeated at the current pin. The rest of the installed-app library contract (favorites and order, exact component and profile identity, refresh on package change) is implemented in source (`LauncherLibrary.java`; `home-app-library.spec.ts` against a native stub) and `LauncherLibraryInstrumentedTest` has never run (MVP-53). Whether rotation ships is [A-22](decisions.md#new-decision-items). | S; E developer APKs (HOME-role phase, round 8) |
| Local startup and ownership | Native bridge, reproducible payload preparation, owner enrollment and private browser-host transport. Shared launcher preserves existing tokens and runtime-written configuration. | Current native IPC/process lifecycle, reboot, owner isolation and installed variant identity on the intended image. See [local setup](local-agent-development.md). | S; E developer APKs (Shell and StartupReadiness only, round 8) |
| Connection choices | Android production builds open a Welcome dialog for the on-device agent: sign in to Eliza Cloud for inference credits, or "Use local apps without AI", which reaches Home with no network and persists across restart. Production Android does not pair with or restore a remote or Cloud agent: the controller and `connectRemote` refuse it, the native transport rejects the pairing route and, in a flag-off build, every request whose origin is not exactly `https://api.eliza.app` (`ConnectionRoutes.java`; a dedicated Cloud agent host is refused too, because no production Android path connects a Cloud agent, pending A-16), and a saved remote credential is not read, written or removed. The saved selection itself is ignored and is replaced once the user chooses local apps or the resident agent starts. Cloud sign-out sends Cloud's self-revocation (`DELETE /api/v1/api-keys/current`) once and says "revoked" only when Cloud confirms it; otherwise it says the token was removed on this phone only. The production web build offers remote pairing over HTTPS and Continue offline; Cloud sign-in is stated as unavailable there and a saved Cloud selection or service is signed out without a request; that sign-out also deletes a stored `cloud:production` key from the browser's secret store, best effort, and no other slot. Remote disconnect revokes the device enrollment and owner session and reports an unconfirmed revocation as such. Resident, remote, local and Cloud connections negotiate verified phone actions at enrollment; a Cloud runtime that does not advertise them stays chat-only. Synthetic coverage: `test/browser/connection-boundaries.production.spec.ts`, `test/browser/connection.production.spec.ts`, `test/connection-routes.test.mjs`. | Cloud self-revocation has not run against live Eliza Cloud, and the native route guard, origin guard and DELETE admission are compiled and JVM-tested but not exercised in an APK or on a device. The web build cannot revoke a Cloud credential. Real-device wrong-owner/origin, expired and reused token, and callback tests; managed endpoint ([A-02](decisions.md#open-decisions)). | S |
| Chat and retained context | Typed conversations, selected-source context, reviewed actions with durable receipts, and conversation-bound local composer drafts with explicit conflict recovery. Stop closes the client stream, discards the late reply and, for resident, local and remote agents, asks the agent to cancel once through upstream's `POST /api/turns/:roomId/abort`; Cloud agents and agents without that route get the in-chat notice that the agent may still finish. Either way the chat shows the state and one read of the conversation shows the reply if it finished; nothing is resent. A dropped response is reconciled once by repeating the identical request under the same client message ID. The composer keeps the text through every failure before the message is posted (no agent, expired session, offline or rate-limited conversation setup, changed screen or owner, Stop before the post), and remote, Cloud and resident connections restore the saved conversation on connect (with older pages except on Cloud). A send that fails after the post is reported as an unknown outcome with a history check, never as unsent. | Emulator and device acceptance of draft, Stop, history and Back/HOME/keyboard continuity (browser source evidence only: `test/browser/chat-continuity.spec.ts`, `test/browser/assistant-draft-dispatch.spec.ts`). The read after Stop matches the stopped message by text and time because upstream history rows do not expose the client message ID; Cloud history has no older-page cursor and no cancel route. Broad model quality, missing-detail clarification, target-device performance and complete physical user journeys. | S; R local Cerebras (historical) |
| Speech and recording (J02) | Flag-off builds use Eliza Cloud for chat voice, Notes transcription and read-aloud (P-07; `apps/app/src/runtime/voice-selection.ts` returns the Cloud route whenever test mocks are off). Signed out, voice says that Cloud sign-in is needed and captures nothing (`production-surface.spec.ts`). Editable transcript review; separate Send, summary save and reminder draft. An ongoing Cloud conversation sends each new spoken turn (`chat-voice-mode.spec.ts`), which differs from P-01's record, review, send; the conflict is MVP-01 and is not resolved here. Owned playback rejects stale completions. Resident Browser reading retains native reviewed text and uses bounded local synthesis chunks. On-device Whisper and Kokoro code is packaged but is not the flag-off route. | Failed functional acceptance: `LocalSpeechInstrumentedTest` ran 2 tests on arm64-v8a and 1 failed (the synthesized sentence was recognized as "lady's" instead of "lazy"), so `functionalAcceptance.passed` is false in `android/local-speech/qualified-runtime-manifest.json` and x86_64 runtime execution is unverified. The cause is addressed by deterministic VITS synthesis in upstream PR #34743, now included in the pin; the unchanged test then passed on an arm64 Android emulator against a rebuilt runtime candidate that is recorded but not admitted. That emulator pass was at the earlier pin `352d7a08`; it is not physical-device acceptance, and no candidate has run at the current pin. For x86_64, round 8 added a dispatch-only hosted job (`android-emulator.yml`, suite `local-speech`) that has never been dispatched, and admission is a named reviewer's step. Packaged byte identity does not waive that failure. Both ABIs must pass before speech is accepted. Physical microphone/audio quality, Bluetooth/echo, language support, interruption and latency. Manual send means the latency method or six-second target must be settled first ([A-10](decisions.md#open-decisions)). Browser-build speech recognition is in scope; any cloud route requires disclosed opt-in. Host synthesis does not qualify Android playback or native permission behavior. | S; D failed on arm64-v8a (the physical Android 16 ARM64 device recorded under `nativeExecution`, x86_64 not executed) |
| Notes, Calendar and Reminders | Durable editing, selected reads, reviewed actions and recovery. Calendar shows only calendars held by the Android CalendarProvider (on the phone or synced there by an Android account) on Android, and the browser-local calendar in the web build; calendars connected through Eliza Cloud are not shown. Native Calendar and Reminders delegate to shared upstream plugins while retaining product storage and provider identity. | Current installed-data upgrade, timezone/recurrence, ambiguous writes, real provider and physical-device behavior. Notes Trash with automatic 3-day emptying covers text, checklist, link and voice notes (P-06): a voice note's recording is trashed, restored and erased with its Trash entry, and the native 30-day audio sweep is only a backstop. A permanent voice deletion interrupted by process death is settled from saved-storage readback at the next start (`apps/app/src/runtime/permanent-voice-deletion.ts`; `notes-permanent-delete-backstop.spec.ts`, browser build), and Android has its own pass for a committed tombstone (`AlphaNoteAudioPlugin.finishPermanentDeletions`), whose four instrumented cases passed with the rest of `NotesTrashBackstopInstrumentedTest` (9 of 9, both flavors) on developer APKs on an emulator in round 8 ([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)); the full-Trash refusal has a browser test for the entry limit and for the byte limit (`notes-trash-full.spec.ts`) (MVP-15). In the same run the Calendar campaign (CalendarCrud, both CalendarAgentCrud methods, CalendarAvailability, CalendarTruncation, CalendarRange, CalendarFlow), NotesStorageDurability, ReminderLifecycle and the `notes` restart campaign passed on both flavors; the reminder one-off and reboot-recovery campaigns and NotesSecureStorage passed only in round 7. Acceptance of all of it on a distributable build and a device remains open, as does the full-Trash dialog on an installed APK. Browser notification delivery is not alarm qualification. | S; E developer APKs (round 8, reminder campaigns round 7 only) |
| Browser persistence | Calendar, reminders/alarms and their creation/action histories, notification policy/history, hosted-result notices, workflow drafts and pending workflow requests, workflow notification receipts, conversation restart choices, Cloud setup intents, media saved-copy requests, bookmarks and notification sound history, device preferences and roles, the development password provider, photo album metadata and the development agent, execution, digest and Cloud documents use the upstream transactional document store. Revision-bound recovery preserves exact older bytes. The contracts and owning suites are in [browser-storage.md](browser-storage.md). | Engine-by-engine qualification of each domain on the integrated head, and the independent preferences and native Clock handoff history described in [browser-storage.md](browser-storage.md#independent-preferences). The development-only documents ship only in test-mocks builds. | S |
| Clock | Reviewed handoff to Android Clock with truthful opened semantics. | Actual ringing, snooze/dismiss, reboot, timezone and DND behavior; Clock owns final alarm creation. | S; E developer APKs (handoff classes round 8, RealClock round 7 only on API 35) |
| Typed workflows | Phone-authored workflows have manual triggers only (`apps/app/src/runtime/phone-workflow-authoring.ts` accepts `trigger.kind: 'manual'`). Bounded generated candidates, separate Use/Save/Run, approved device effects and retained results. Calls, SMS, payments, Contacts, arbitrary code and email to unnamed recipients are refused on the phone before any generation request when their wording is recognized (`apps/app/src/prototype/workflow-scope.ts` is a phrase filter; the typed catalog bounds everything else). A run or save request for which the agent reports no receipt has an explicit disposition: an owner-confirmed resend under its original identity (the agent applies one submission or mutation identity at most once; agents without submission identities are never sent a repeat), closure of a run request as not run once the workflow version has changed, or closure of an edit as not saved when the agent refuses it by identity. Interrupted runs are reported as outcome unknown (or worker still running) and are never replayed: side-effecting workflows stay blocked until each interrupted run is explicitly cancelled, removal first cancels them, and only a read-only digest offers a separately confirmed new run. | Broad model reliability, real interrupted-worker behavior on the resident runtime and current compiler/runtime release qualification. Arbitrary code and an unrestricted workflow IDE remain outside MVP. | S; E developer APKs (workflow campaign 14 of 14, round 8, synthetic reads and drafts) |
| Notify and Speak | Native delivery ledger and executor; browser transactional notices and exact receipt recovery without reposting. Workflow step and approval notice receipts are kept by the shared upstream ledger (`NoticeDelivery` in `plugin-native-notifications`), which `WorkflowNoticeDelivery` configures with the installed slot names and record formats; host JVM tests read receipts as the retired in-app ledger stored them (`test/workflow-approval-notice.test.mjs`, `test/workflow-notice-delivery.test.mjs`). | Native OS posting/audio and interrupted-delivery acceptance. Against the shared ledger `WorkflowApprovalNoticeInstrumentedTest` and the approval-notice phase of the workflow campaign passed on both flavors of the developer APKs in round 8 ([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)); `WorkflowNoticeTapInstrumentedTest` has not run and `WorkflowNoticeProcessDeathInstrumentedTest` runs only in the hosted `recovery-ui` job, which has never been dispatched (MVP-08). Uncertain speech must not be replayed or inferred complete. | S; E developer APKs (approval notice only, round 8) |
| Digests and schedules | Typed workflows are never scheduled: scheduled execution exists for digests, and prompt automations keep their own separately reviewed agent schedule. Local digest schedules, retained results, client-scoped acknowledgement and explicit outcome-unknown records after interrupted work. A scheduled time that passes while the host is not running is recorded once as missed and is never run later; the panel labels it as not run. The development scheduler (test-mocks builds only) follows the pinned agent's admission: one `unavailable` record and a paused schedule for a revoked or expired source, a 120-second run window, and each occurrence settled once across clock changes. | Real-provider interruption, native lock/battery/Doze, physical power loss and account-source routing. Preserving an unknown outcome does not establish automatic completion after a worker crash. `npm run agent:test-digest-restart` (a resident worker killed at an admission or execution boundary) passed on the host with a synthetic model at upstream `352d7a08` (round 5) and again at `40dbe96b` (round 8, one run each); it has not been repeated at the current pin `13c9857598` and is in no automated lane. Home shows the latest retained brief on its own card (`apps/app/src/prototype/home-cards.ts`; `home-daily-overview.spec.ts` and its production spec, synthetic provider data); `home-brief-result.production.spec.ts` runs on the flag-off build from a digest result returned by a stubbed resident agent to that card, by both result routes (the Android result inbox, and the renderer's own read and acknowledgement of the agent's result page), with only the Android bridge stubbed; no resident scheduler, native result inbox, delivery worker or real digest has run behind the card (MVP-19). Running while the phone is off is [A-09](decisions.md#pending-owner-decisions). | S |
| Browser and passwords | Isolated native browsing, reviewed reading, sensitive-source rejection and provider setup/status. Implemented for P-04: normal tabs keep sign-ins in one persistent browser profile (separate from the host profile) and restore after a cold start (engineering choice); private tabs are ephemeral; Clear browsing data and per-site clearing are confirmed; pop-ups open as tabs and app links hand off to Android. Integrated password manager (P-05, shared upstream module) supplies a Keystore-bound vault, Settings management and an Android Autofill provider with exact origin/app binding and a fresh unlock per fill; Browser Autofill is unavailable without native per-field origins; Show and Copy remain available. Proton Pass remains optional. | October 7 policy is decided, not accepted: On developer APKs on an emulator BrowserSignins, BrowserContinuity and PasswordBrowserFill passed on both flavors at the current pin (round 8, [verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)); the sign-in restart campaign (sign-in persistence and private-tab cleanup, P-04) and BrowserAutofill on the test-mocks pair passed only in round 7. BrowserFlow fails on its live-search method, and the reading classes need a WebView with isolated-world injection that no image used has; the hosted job for them has never been dispatched. P-04 and P-05 are implemented, not accepted on a distributable build or a device. BiometricPrompt, provider selection and save prompts still require device qualification. Passkeys are not implemented. Real-site password/passkey/autofill and installed isolated-world/consent behavior. Setup UI does not prove filling succeeds. | S; E developer APKs (round 8, sign-in restart and Autofill round 7 only) |
| Email/Gmail | In MVP scope ([P-02](decisions.md#october-7-owner-product-decisions)). Owner/grant-aware contracts with controlled provider-boundary coverage. Inbox loads on open and has Refresh, provider-cursor paging (Load more) and a Sent view (`in:sent`). It offers a confirmed disconnect, in Inbox and Settings → Connections, that reads back the account state. Failures are classified as offline, revoked or stale, each with an explicit Retry. Left swipe and the archive button both go through the reviewed archive flow. Share by email from Notes opens a prefilled local draft. Compose has a From switcher when more than one account is connected. The Home unread badge reflects loaded Inbox data. Opening a message marks it read through the reviewed `mark-read`/`mark-unread` operation when the server advertises `readState`. The send review lists From, To, Cc, Bcc, body and attachments and is confirmable only while the composer still holds exactly the reviewed draft; a provider-confirmed send removes the retained local copy; Trash and its undo are reviewed operations with the same unknown-outcome rule as send; a refused or mismatched attachment is never saved (`journey-f-reviewed-send.spec.ts`, `journey-f-email-notifications.spec.ts`, `inbox-hostile-attachment.spec.ts`, `scripts/test-inbox-sent-cleanup.mjs`; all against a synthetic provider). While Inbox is behind the conversation, a finished agent reply offers `Use in email`: a reviewed insert into the intended draft that never replaces draft text and never prepares or sends anything (`use-in-email.spec.ts` in the development lane; `use-in-email.production.spec.ts` on the flag-off build with only the Android bridge stubbed and a synthetic mailbox; MVP-14). | Real Google OAuth (the code exchange currently returns 401), deployment of the managed Cloud routes, including the pinned upstream read-state operations, and a real mailbox: send/reply, label changes, revoke and response-loss recovery. Ambiguous sends are never retried. Shared Files/Photos items are not attached automatically. External messages require explicit recipient/message authorization. | S; R open (OAuth 401) |
| Files, camera, scans and media | Selected import/export, exact-byte media, scan correction and reviewed searchable PDF flows. On Android, Camera offers image selection through the system picker straight into scan review (nothing is copied to Photos) and the multi-page scan document builder (`camera-adapter.ts`, `scan-document.ts`). | Native provider/camera/storage access, real data volumes, OCR quality, fonts and product usability. OCR covers English only for now (October 7 policy). | S; E developer APKs (CameraScan and FilesTree round 8, Video and PhotosTrash round 7 only) |
| Poster to Calendar (J01) | Suggestions for explicit English dates, times, same-day ranges and labeled venues. With the device clock as reference, year-less and weekday dates, today/tomorrow, and printed IANA or UTC-offset times (converted, with the source zone shown) are suggested; dated posters without a time are suggested all-day and repeat wording is an unticked hint. Every inference is listed; separate Calendar review and Save remain the only write. Ambiguous numeric dates and zone abbreviations stay blank. | Arbitrary-photo OCR quality, broader languages and phrasing, and native provider acceptance. Suggestions never authorize saving. | S |
| Document analysis (J03) | Selected-content review, separate editable summary-note approval and verified source references. Changed/deleted source files fail closed. Native references use existing selected-document access only. | Live Gmail retrieval, installed permission retention/revocation, cross-process reopening and broad PDF/image task quality. Fingerprint-only sources require reselection. | S; E developer APKs (document restart, standalone, round 8) |
| Schedule to travel (J04) and Maps | Selected event location enters Maps once; route choice and origin remain explicit. Stale search/navigation work is cancelled. "Back to event" returns to exactly the originating event (`maps-event-return.spec.ts`), and the travel-mode buttons expose their selected state. A flag-off build has no Maps provider (`VITE_MAPS_BASE_URL` is unset and the emulator gateway exists only in test-mocks builds), so the address reaches Maps and the user reads "Connect a Maps provider to search places and plan routes."; no route can be produced (`journey-core-loops.production.spec.ts`). | A production Maps provider and its licence, which no build has ([A-23](decisions.md#new-decision-items)); then production endpoint/TLS, licensed data coverage, location permissions, offline behavior and physical navigation. See [regional Maps setup](maps-regional-validation.md). | S; E historical only |
| Web research to note (J05) | Bounded public-page or pasted-text review, separate question Send and explicit note Save with a source link. | Installed native reading/consent and real-site coverage: `BrowserPageQuestionInstrumentedTest` covers the native excerpt up to Send; in its one recorded run (round 7) one of four methods passed and three stopped because the emulator's WebView has no isolated-world injection, and the hosted job that installs a newer WebView has never been dispatched; the agent's answer and the note save after it have no native test. CORS-denied content needs user-supplied text; a link is provenance, not an immutable archive. | S |
| Design and accessibility | Themed bounded dialogs, visible actions, keyboard-scrollable content and large-text checks across core flows. | Complete current-source subviews, error/empty states, Pixel geometry, physical accessibility and user task acceptance. Browser assertions alone are not design approval. On an emulator `AccessibilityInstrumentedTest` fails on both flavors of the developer APKs at the current source ([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)): on standalone the last Home row is drawn under the floating composer at 200% text, and on launcher an accessibility click reaches no page control on that image's WebView. TextScale passed there; Rotation passed in round 7 only (MVP-48). | S; E developer APKs (Accessibility fails on both flavors, round 8) |
| Settings | Settings includes connection management, per-connection privacy disclosure, third-party licences and the password manager pages. Shade tiles and Settings rows show the Wi-Fi, Bluetooth, airplane mode, device location, mobile data and Do Not Disturb states that Android reports to an ordinary app, and each opens its own Android page (Wi-Fi, Bluetooth, mobile network, airplane mode, location, Do Not Disturb, display, sound, battery, app notifications, app permissions). Alpha changes none of them; the flashlight is the only direct control. To assistive technology a handoff tile is a button named with its reported state ("Wi-Fi, on, opens Android settings"), not a toggle; only the flashlight exposes a pressed state. A state Android does not report is labelled as a handoff, never as off. About shows the packaged version and Android's install time and states that Alpha does not check for updates. Settings offers no memory-erase control ([A-19](decisions.md#new-decision-items) is undecided). | Emulator and device qualification of each Android handoff and readback: the readable settings and the pages an image provides differ by Android version and vendor. On developer APKs on an API 36 emulator SettingsSystemFacts, SettingsRoles and the `channels` campaign passed at the current pin (round 8, [verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)); SettingsFlow and the `settings` campaign passed only in round 7. No distributable build or device has run them. An update check waits on [A-06](decisions.md#pending-owner-decisions). | S; E developer APKs (round 8, SettingsFlow round 7 only) |
| Privacy and outbound context | Approval/context binding, native secure storage, contact references and credential redaction contracts. The resident Android agent starts with the upstream `ELIZA_SECRET_SWAP_ENABLED` and `ELIZA_PII_SWAP_ENABLED` switches on by default; the browser development host keeps both off unless both are set to `true` on qualified source. Privacy disclosure is per connection: hosted Cerebras inference is disclosed, and no connection claims that data stays local. Browser development storage is disclosed as unencrypted. | Re-run resident redaction on the current APK (emulator, then device, as separate gates) and broaden category/provider coverage. The host default stays off until its enablement campaign passes. Inspect the selected runtime's actual configuration; a past host snapshot does not prove present settings or that data stays local. | S; E historical only |
| Release | Pinned upstream source, standalone/HOME packaging and source-admitted runtime staging. Distribution builds exclude mock/fixture/developer surfaces and debug-only native hooks; release signing and version come from `ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`, `ELIZAOS_KEY_ALIAS`, `ELIZAOS_KEY_PASSWORD`, `ELIZAOS_VERSION_CODE` and `ELIZAOS_VERSION_NAME` (unsigned `*-release-unsigned.apk` without all four signing values). | No distribution APK build exists at the current pin `13c9857598`; only developer builds do: the strict build stops at the reviewed embedding host libraries, which are not in Git and have no build step (MVP-39). Hosted Android foundation run 38131665152 assembled and verified the four flag-off developer APKs at `f87850fa` (the round 8 integration), and a development machine built both flavors with their instrumentation APKs at `2961bd9e` and `9a1ca161` for the round 8 emulator run. Before that, hosted Android foundation run 38118499272 assembled and verified the standalone and launcher debug and unsigned release APKs with the flag off at `c0b19147` (the round 9 integration; `npm run android:build -- --allow-unpackaged-runtime --skip-instrumentation`, so no instrumentation APKs), and a development machine built the same four with both instrumentation APKs and lint at `dc58b4b2` (MVP-08). Earlier developer builds: hosted run 38109307871 at main `dfacccb3` (pin `40dbe96bd1`; job and step conclusions read, not its log), `1de85a13` (pin `4148a166`, PR #385) and `d3dc9977` (pin `945209d3`); round 5 compiled the Java of both flavors and their instrumentation at pin `352d7a08` without assembling an APK. Every one of these used `--allow-unpackaged-runtime` and none had an admitted, accepted speech runtime, so none is distributable (`verify-apks` in the hosted run at the current pin: no packaged runtime, speech native bytes not admitted, speech functional acceptance pending or failed), and none was installed. The pinned Calendar plugin compiled in the hosted build at the current pin. A distribution build requires qualified speech assets, the staged resident runtime and the reviewed embedding host; speech functional acceptance failed (see the Speech row). Provisioning, pilot update and AOSP staging refuse a release that `verify-apks` does not mark distributable (`scripts/release-blockers.mjs`). Then: controlled release key and signed artifacts, installed-data upgrade from earlier (including mock-state) installs, image/hardware qualification, App Links verification on a real domain, signed update/rollback (rollback is not offered by `scripts/pilot-update.mjs`), support and pilot acceptance. | S; B developer APKs only (not distributable) |
| Licenses | Settings renders `apps/app/public/licenses/third-party-notices.json` (name, version, license, source, text, flags and what each flag obliges) with an explicit unavailable fallback; `THIRD_PARTY_NOTICES.txt` accompanies it and lists every flagged entry at the top. Open-source licences are included and flagged, and never stop a build or block a release ([P-09](decisions.md#october-10-owner-product-decision)): the committed notices have 109 entries, 15 flagged, and a run on the staged resident runtime at pin `40dbe96bd1` produced 660 entries, 66 flagged, exit 0 ([dependency audit](dependency-audit.md#licence-flags-p-09)). The Denton typeface is proprietary; it is recorded on the owner's statement that the licence is held outside the repository, flagged `proprietary-licence-held-outside-repo`, and blocks nothing (A-21, closed). | Included and flagged is not legal review. Still open: review of the notices; meeting the obligations the flags name (corresponding source for the GPL, AGPL and LGPL components, a replaceable library for LGPL, network source offer for AGPL); the one resident-runtime package under non-commercial terms (`@metamask/sdk`); and the separate native-app/OS-image notices in [native-app distribution](native-app-distribution.md). The Denton licence document is not in the repository and was not seen; a reference to it would complete the record ([dependency audit](dependency-audit.md#denton-typeface-mvp-43)). | S |
| Phone, SMS, Contacts and Wallet | Deferred by MVP policy. Source and design references are retained; app entries, `open_view` destinations and agent actions are disabled. Emergency calling stays with the system. | Restoring any of them needs a recorded scope change, then native role, permission, recipient and return-to-HOME acceptance; Wallet also needs provider, key custody and transaction-approval decisions ([A-08](decisions.md#open-decisions)). | not applicable |

## PRD requirement status

Status of each [PRD](prd.md) requirement, mirrored in `docs/requirements.json` and checked by
`test/docs-requirements-consistency.test.mjs`. Status describes software, not acceptance:
*implemented* (only acceptance in other classes remains), *partial* (named software gaps remain),
*deferred* (out of the MVP by policy) or *blocked* (needs an external decision or resource).

| Requirement | Status | Status rows | Next gate |
| --- | --- | --- | --- |
| AP-01 | partial | Home and launcher; Design and accessibility | E: LauncherLibrary, which has never run, and the HOME-role phase (SettingsRoles, LauncherHome) on a distributable launcher APK; then D on the selected phone |
| AP-02 | partial | Home and launcher; Local startup and ownership; Connection choices; Release | B: four distribution APKs build at the current pin and pass scripts/verify-apks.mjs; then E: install both modes, open apps and return HOME repeatedly |
| AP-03 | partial | Connection choices; Local startup and ownership | S: local-only service onboarding and subscription policy, then R/D authentication and latency |
| AP-04 | partial | Chat and retained context; Connection choices; Privacy and outbound context | E then D: resident lifecycle, history, missed occurrences and no duplicate effects |
| AP-05 | partial | Chat and retained context; Design and accessibility | E: soft-keyboard resize, Back and HOME without keyboard obstruction on an installed APK; then D |
| AP-06 | partial | Speech and recording (J02) | S: native speech/turn integration, then E both ABIs and D audio/latency/listening |
| AP-07 | partial | Home and launcher; Digests and schedules | R: real provider agenda and digests with loading, empty, stale and error states; then D |
| AP-08 | partial | Phone, SMS, Contacts and Wallet | S: AOSP capability gates and providers, then E roles and D real carrier endpoints |
| AP-09 | partial | Email/Gmail; Notes, Calendar and Reminders | R: real Google OAuth grant, managed Cloud Gmail routes and a real mailbox; then D: a real synced calendar account on a phone |
| AP-10 | partial | Browser and passwords; Files, camera, scans and media; Schedule to travel (J04) and Maps; Notes, Calendar and Reminders | S: Cloud Maps, full media and browser-policy integration, then R/E/D journeys |
| AP-11 | partial | Typed workflows; Digests and schedules | E then D: interrupted-worker behavior on the resident runtime with real receipts |
| AP-12 | partial | Settings; Privacy and outbound context; Licenses | S: reset/subscription/shade policy, then E/D persistence and recovery |
| AP-13 | deferred | Phone, SMS, Contacts and Wallet | No MVP delivery gate; verify Wallet remains unavailable |
| AP-14 | blocked | Release | I and D: pinned Pixel 10a inputs, signing, listener, hardware and update/recovery |
| AP-15 | partial | Design and accessibility; Home and launcher | E: Accessibility, which fails on both flavors at the current source, and Rotation at the current pin; then D: TalkBack, large font, touch and keyboard, offline, killed process, rotation and repeated HOME navigation |

## Qualification

Run `npm run verify` and the Android build (`npm run android:build:local`; plain
`npm run android:build` stops before Gradle when an input is missing), including standalone
and launcher debug/release outputs. The production-surface gates are:

| Gate | Command | What it qualifies | What it does not qualify |
| --- | --- | --- | --- |
| Production bundle audit | `node scripts/audit-production-bundle.mjs web-dist` (`--expect-test-mocks` for a deliberate test-mocks build) | The web bundle has no mock/developer strings, fixture names, `img/` fixture images or source maps, and `web-dist/build-flags.json` reports `testMocks: false`. | Runtime behavior, APK contents (see below) or any device result. |
| Production browser lane | `npm run test:browser:production` | Rendered production build (switch off): no mock choice, no `?mode=mock`/`?fixture=1`/`?mode=dev`/`?start=` entry, no device controls; honest empty and unconnected states; legacy `{kind:'mock'}` selection opens the chooser. | Android WebView, native plugins or real accounts. |
| APK verification | `node scripts/verify-apks.mjs` (run by `npm run android:build`) | APK bytes for all four distribution APKs: identities, HOME filter, debug flags and signatures, no test-mock native classes, cleartext config or fixture-package queries, and the bundle audit on each APK's extracted `assets/public`. | Installation, emulator HOME role, image boot or device behavior. |
| Head qualification | `node scripts/qualify-head.mjs` | Repository verification, distribution builds and their audits for the exact checked-out commit. | Any later commit, hosted CI, emulator, AOSP image, real integration or device acceptance. |
| Core loop journeys | `npx playwright test test/browser/journey-<id>-<slug>.spec.ts --project=chromium --workers=2`; flag-off: `npx playwright test test/browser/journey-core-loops.production.spec.ts --project=production` | Each loop A–F and J01–J05 driven through rendered controls with the development profile and synthetic providers, and what each loop does in the flag-off bundle with the Android bridge stubbed ([core loop status](core-loop-status.md), [core loop audit](core-loop-audit.md)). | A real agent, account, provider, native plugin, APK, emulator or device. |
| Emulator instrumentation | `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN` and the campaign runners listed in the [verification guide](verification.md) | Class E results bound to the commit and the installed APK hashes, per class. | Device or user acceptance, a custom image, real accounts or a distributable build. One partial run on developer APKs is recorded at the current pin (round 8); it does not include the test-mocks classes, the reading classes, the reminder campaigns or any hosted job. |

Results for these gates at the October 4 integrated head (source/test and APK build classes
only) are in the archived
[production readiness record](https://github.com/AlphaCompute/alphaphone/blob/51c8157533353a805afd2811f4e3f41b66b7b9fa/docs/production-readiness-2026-10-04.md#integrated-head-qualification).
That record was removed from the tree in PR #385 and describes an older source and pin; it
qualifies nothing at the current head.

Test-mocks builds (`ELIZA_DEV_ALLOW_TEST_MOCKS=1 npm run build`,
`npm run android:build -- --test-mocks` into `artifacts/test-mocks/`) exist for
development and instrumentation only and never qualify a distribution artifact. Exercise the owning changed contracts and inspect the
terminal hosted result for the reviewed source. Use the commit's PR and
[GitHub Actions runs](https://github.com/AlphaCompute/alphaphone/actions) for
source-specific results; old pass counts and cancelled runs cannot qualify new code.

APK assembly, emulator bridge/HOME behavior, full AOSP boot, real integrations and
physical-device/user acceptance are independent gates. A source pin rollback does
not establish installed-data or OS rollback compatibility. Browser fixture and
synthetic-provider results must remain distinguishable from real account access
and physical hardware observations.

Evidence classes stay separate: (S) source/test (`npm run verify`, Playwright lanes,
bundle audit); (B) APK build and byte inspection; (E) emulator HOME-role and
instrumentation; (I) full AOSP image build and boot; (R) real integrations (accounts,
providers, OAuth grants); (D) physical-device and user acceptance. A result in one class
never stands in for another.

### Current qualification evidence

Ledger refresh of 2026-10-11 at main `2560eead` (the merge of pull request #392): this
refresh re-derived the table above and the other ledgers from source, tests and the dated
sections of [verification](verification.md). It ran the docs tests and `npm run verify` and
produced no evidence of any other class. The newest evidence is the round 8 entry below.

Round 8 integration, 2026-10-11 UTC: pull request #392 (branch `claude/r8-finish`), the
round 8 packages merged after round 9, upstream pin `13c9857598`. The hosted runs are at
commit `f87850fa`; the commits after it change one Android plugin method, instrumented test
source, one node test and documents, and the development-machine checks were repeated at
`9a1ca161`.

- Class S, hosted at `f87850fa` (Browser MVP run 38131665096): Repository verification
  passed with 678 tests, 674 passed, 0 failed, 4 TODO, and the bundle audit passed (395
  files, `testMocks=false`). The three Chromium shards passed 967, 970 and 974 tests (2911)
  and failed none; 12 were skipped (host speech profile; the disclosure spec ran in that
  profile on shard 1, 7 passed). The `production` project passed 193.
- Class S, development machine: `npm run verify` exited 0 at `9a1ca161` (679 tests, 675
  passed, 0 failed, 4 TODO; bundle audit 395 files, `testMocks=false`) and the `production`
  project passed 193. The Chromium project ran in eight batches of spec files with 4 workers
  at the merge commit `8a0c5b61`, whose browser source is that of `9a1ca161`: 2906 passed, 12
  skipped and 5 failed in four spec files (`browser-cloud-dev`, `connection-preference-storage`,
  `journey-c-alarms`, `local-agent-native-stream`) while Gradle and an emulator ran beside
  them. Repeated five times each, the same specs failed at a similar rate on `main` at
  `394c4698` on the same machine, and all passed on the hosted shards.
- Class B, hosted at `f87850fa` (Android foundation run 38131665152): standalone and
  launcher debug and unsigned release APKs assembled with the flag off and verified as
  developer builds, not distributable. On a development machine
  `npm run agent:prepare -- --source-only` and
  `npm run android:build -- --allow-unpackaged-runtime` built and verified both flavors with
  their instrumentation APKs and an unqualified local speech AAR: developer builds without
  the resident runtime, not distributable.
- Class E: one partial campaign on those developer APKs on one API 36 arm64 SDK emulator
  ([verification](verification.md#emulator-results-at-2961bd9e-2026-10-11-round-8-merged-with-round-9)).
  It is not evidence for a distributable build or a device. Open from it: Accessibility
  fails on both flavors and BrowserFlow fails on its live-search method; the test-mocks
  classes, the reading classes and the hosted jobs did not run.
- Classes I, R and D: none.

Round 9 integration, 2026-10-11 UTC: pull request #391 (branch `claude/r9-integration`),
upstream pin `13c9857598`. The hosted runs and `npm run verify` ran at commit `c0b19147`,
the other development-machine runs at `c0b19147` or `3aeb9f99`; those two commits and the
one that carries this entry differ only in documentation. With the round 8 entry above it
is one of the two entries at the current pin.

- Class S, hosted (Browser MVP run 38118499274): Repository verification passed with 644
  tests, 640 passed, 0 failed, 0 skipped, 4 TODO, and the bundle audit passed (395 files,
  `testMocks=false`). The three Chromium shards passed 955, 959 and 963 tests (2877) and
  failed none; 12 were skipped because they need the host speech profile, and the one
  disclosure spec among them ran in that profile on shard 1 (7 passed). The `production`
  project passed 185. Resident preparation (`npm run agent:prepare`) passed in run
  38118499310.
- Class S, development machine: `npm run verify` exited 0 with the same counts. All 2889
  Chromium tests ran, in two invocations with 4 workers: the first was stopped after 2243
  had passed, to free disk space, and the second ran the 74 spec files it had not
  finished. 2877 passed, 12 were skipped (the same host-profile tests) and none failed;
  the `production` project passed 185. Gradle compiled the app and instrumentation Java of
  the standalone and launcher debug variants (the four `compile…JavaWithJavac` tasks only,
  with the speech-runtime digest check excluded and a speech AAR that is not the qualified
  one; no APK was assembled).
- Class B, hosted (Android foundation run 38118499272):
  `npm run android:build -- --allow-unpackaged-runtime --skip-instrumentation` assembled the
  standalone and launcher debug and unsigned release APKs with the flag off and
  `verify-apks` passed them as developer builds. It records the releases as not
  distributable (no packaged runtime, speech native bytes not admitted, speech functional
  acceptance pending or failed) and they are unsigned; no instrumentation APK was built and
  nothing was installed.
- Classes E, I, R and D: none. The instrumentation sources were compiled, not built into
  an APK, and none of them ran.

The entries below are earlier and are kept as recorded.

Recorded for the ledger refresh of 2026-10-10 on branch `claude/r6-ledger`, based on
`4ec513b1` (PR #389), upstream pin `40dbe96bd1`. That branch was then merged with main at
`042265c9`, which contains PR #388; the results below predate that merge unless they say
otherwise.

- Class S: `npm run verify` exited 0 at `fdac4ea1` on this branch on 2026-10-10: 548 tests,
  544 passed, 0 failed, 0 skipped, 4 TODO; typecheck, the flag-off build and the production
  bundle audit passed (395 files, `testMocks=false`), and the audit printed the Denton
  licence release blocker. That commit differs from this record only by this paragraph. Ten journey specs, the flag-off journey spec and
  the per-step classification are in [core loop audit](core-loop-audit.md): of 140 steps
  that this repository, an emulator or CI can close, 105 have a test (75%), 30 need an
  emulator run and 5 a hosted CI run; 23 further steps need a person and 13 a phone. That
  percentage measures class S evidence, not completion on a phone. The Playwright suites
  were not re-run for this refresh; PR #389 records its own runs.
- Class B: none at pin `40dbe96bd1` when this was recorded. Afterwards hosted Android
  foundation run 38109307871 built four flag-off developer APKs at main `dfacccb3`, the
  same pin (job and step conclusions read, not its log). The last recorded developer APK
  builds before that are at `1de85a13` (pin `4148a166`) and `d3dc9977` (pin `945209d3`).
  All used the explicit unpackaged-runtime option and an unqualified speech input;
  unsigned releases are not distributable.
- Class S on the merge with main `042265c9` (2026-10-10, before the merge commit): `npm run
  verify` exited 0 with 614 tests, 610 passed, 0 failed, 4 TODO, and the bundle audit passed
  (395 files, `testMocks=false`). Playwright, 4 workers: the Inbox, Gmail, Calendar, mail and
  journey specs 360 passed; Notes Trash, Home, context-selection and accessibility-sweep
  specs 552 passed; the `production` project 173 passed.
- Class E: none at the current source. The last committed emulator result is six
  journal/photo test cases across both variants on a disposable stock API 35 emulator at
  `d3dc9977` (encrypted journal persistence, Activity recreation, replay refusal, history
  redaction and seven photo filters); it is historical. Password save/fill was recorded
  there as failing before save/unlock and has not been re-run. A campaign on an
  API 36 arm64 emulator is summarized in [verification](verification.md#emulator-results-at-73b973a5-2026-10-10):
  source `73b973a5` at the earlier pin `352d7a08`, developer-override APKs, results mixed
  with several failures unresolved, and no raw result files committed. It is historical:
  the fixes made after it were run in a second campaign (round 7), summarized in
  [verification](verification.md#emulator-results-at-6dcdde34-2026-10-10-round-7): source
  `6dcdde34` at the current pin, developer-override APKs on owned API 35 and 36 arm64
  emulators, again a written summary with no raw result files committed. That section lists
  what passed, what failed and what did not run; it is class E for those APKs only, not
  for a distributable build and not for any later source.
- CI: no passing run of the `native` or `recovery-ui` job of
  `.github/workflows/resident-android.yml` is recorded for the current source.
- Classes I, R and D: none. No AOSP image has been booted, no real account or provider
  has been used and no physical-device or user acceptance exists. HOME-role acceptance is
  also separate. Focused campaigns are in the [verification guide](verification.md); the
  commands that close each open step are in
  [core loop audit](core-loop-audit.md#emulator-and-ci-campaigns), and what only the owner
  can do is in [owner actions](mvp-owner-actions.md).

## Remaining external items

These cannot be completed in software from this repository; they are prepared but open:

- Release signing key custody and signed release APKs (`ELIZAOS_*` signing values held by
  the release owner), plus signed OS image, OTA/update and rollback drill.
- App Links: publishing `assetlinks.json` on an owned domain with the release signer
  fingerprint, and verifying it on an installed signed build.
- Gmail OAuth: production client/consent configuration and a real account grant,
  revoke and recovery ([runbook](pilot-acceptance-runbook.md)). Deployment of the managed
  Gmail Cloud routes, including the pinned upstream read-state operations
  (read state stays unavailable until the server advertises `readState`).
- Cerebras key provisioning for the resident agent on pilot devices, without exposing the
  key in evidence.
- Password provider real-site save/fill/passkey on a recognized browser and signed build.
- A production Maps provider: none is configured in any flag-off build, and choosing and
  licensing one is pending decision A-23. Then the regional gateway (HTTPS
  `VITE_MAPS_BASE_URL`), data licence review and physical navigation.
- Emulator and physical-device upgrade from earlier installs that saved mock state.
- Resident redaction re-run on current APKs; physical speech, latency, battery and soak.
- Stakeholder decisions listed under [pending owner decisions](decisions.md#pending-owner-decisions),
  starting with powered-off scheduling (A-09) and the voice latency method (A-10); review
  of the flagged licence notices (P-09 makes them non-blocking, not reviewed); and the
  four-unit physical pilot.
- The reviewed embedding host libraries for the strict build: three native libraries that
  are not in Git and have no build step. Until someone supplies them with their
  qualification receipt, every APK is a developer build with no resident runtime.
- Speech admission, if A-24 keeps on-device speech: a hosted x86_64 run, the arm64-v8a run
  of the same candidate and a named reviewer's admission. None has happened at the current pin.
- Emulator and hosted CI campaigns: of the 140 core-loop steps this repository, an emulator
  or CI can close, 131 are evidenced, 4 need an emulator run (three in loop E and one in J05) and 5 a
  dispatched `resident-android.yml` run (two in loop A and one each in C, D and F; the
  [core loop audit](core-loop-audit.md) lists them). No hosted emulator job has ever been dispatched,
  and every emulator result so far is on developer APKs, so each campaign still has to be
  repeated on the distributable build.

The complete, ordered list of what only the owner or a person with access or hardware can
do is [owner actions](mvp-owner-actions.md).

The [completion plan](mvp-completion-plan.md),
[verification gates](verification.md), [Android/AOSP guide](android-and-aosp.md)
and [on-device agent plan](on-device-agent-plan.md) define the remaining work.
No historical result or documentation cleanup waives those requirements.
