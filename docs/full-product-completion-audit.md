# Full product completion audit — October 11, 2026

**The product is not complete.** Execution below began at main `f3ccefd3` (PR 393),
upstream `13c98575987a121decc45b161b0c8a4ee698554e`. The user explicitly added
Phone, SMS, Contacts and Wallet to the implementation plan on October 11. Their
existing disabled production entries must stay gated until real capabilities pass.

**Current policy after integrating main `2e5baedc` (PR 427):** the
[approved October 12 plan](owner-approved-mvp-plan-2026-10-12.md) governs current
MVP work. Agent orchestration stays on device; Eliza Cloud provides inference,
subscriptions, Gmail and Maps. Speech must be local in every production entrypoint,
including signed-out/offline use. P-39 agrees with this thread's explicit choice of
ongoing automatic sending after start, and additionally requires local dictation
and barge-in. P-11 measures last input speech sample to first audible response,
including endpointing, with at least 50 simple-query trials. Pixel 10a/Android 17,
AOSP-only Phone/Contacts/SMS and AOSP listening are explicit requirements.
Wallet remains a requested **full-product planning package**, outside the approved
MVP; it is not enabled or a current MVP release gate. Earlier policy questions and
measurement proposals in the chronological log are superseded, not newly open.
The 93 observed native classes remain historical evidence for their exact archived
APKs; the new policy does not turn old Cloud-speech tests into local-speech acceptance.

**Latest merged checkpoint:** `171e79885` includes main through `f348e03c8`
(October 13 pull). Source now includes a permitted photo-library bridge and UI,
AOSP image capability admission and Contacts catalog, a separate AOSP listener,
subscription entitlements, scoped Calendar deletion/Undo and Android's system shade.
These replace earlier source-absence findings; they do not supply installed-device
or release acceptance. Phone/SMS adapters remain gated, and ongoing conversation still hardcodes Cloud despite the approved local-only
requirement. The shared production selector now uses device speech; see the latest
local-selection receipts below.
The audit's native playback helper now waits for confirmed cancel/stop completion;
five focused tests pass, but installed renderer acceptance is still pending.

Historical receipts below retain their exact developer APK and image cohorts.
Before this merge, both variants passed production route/migration refusal and reset
cancellation; destructive reset requires separate external-controller evidence.
The secure-camera fixture passed resource admission and locked capture, while UI
unlock return remained unresolved. Video capture/native decode/range serving passed
but WebView playback failed on H.264/AMR-NB. Accessibility failed unlabelled controls
and reading order. Those results must be rerun where current source changes behavior.
The historical 93-class inventory is not current coverage of the newly merged tests. The refreshed source inventory contains 168 native test classes (109 named-class runner entries, 59 without that admission) and 2,818 overlapping control/handler candidates across 332 renderer source files; these are review queues, not execution counts.
Current fresh-guest receipts now pass Contacts catalog, photo mutation fencing,
ordinary-APK image denial/navigation, installed browser resolution and system shade
on both variants. A separate corrected Photos campaign passes native catalog checks
and the visible Device library scope in both variants. Foreign-UID selected/revoked
media, admitted-image Contacts/telephony and physical acceptance remain open.

**October 12 execution update:** Both developer APK variants build and run on an
owned API 37 Cuttlefish fixture. HOME acceptance passes 7 methods and restores
Launcher3. Settings, Photos batch/multi-share and all four reminder lifecycle
methods now pass on both variants. The corrected 600-file batch flow and Clock
intent handoffs now pass on both variants too, including the fixed-offset UTC
compatibility fix. Assistant, ten-view lifecycle/Notes recreation, browser-share
cancellation and the password origin boundary also pass on both variants. Real
Clock now passes create, firing, snooze, dismiss and exact fixture deletion in
both variants, with all seven stages captured. Physical speaker acceptance remains
separate from this Cuttlefish alarm/UI evidence.
Earlier 33 MiB Notes editor attempts timed out on several cohorts. The merged
capacity fixture now tests a small edit against the genuine 32 MiB encrypted
collection limit, separating storage refusal from giant-textarea layout; see the
latest execution receipts below. Arbitrary 33 MiB textarea usability is not proved.
Both canonical offline speech tests pass on x86_64. Offline transcription/playback,
note read-aloud and cancellation pass in both variants, with network restoration
proven. ARM64 is not qualified.
Resident-agent startup, real Cloud login/Cerebras, physical voice and a
current-source release image remain unverified. These APKs omit the resident
payload and are not distributable. Campaign details below preserve failures,
skips, exact APK hashes and superseded evidence.

**Production speech migration is partial:** `apps/app/src/runtime/voice-selection.ts`
now selects device speech in production regardless of account or legacy Cloud
preferences, with explicit manual recording retained. Notes dictation/transcription
and message read-aloud consumers use that selector. Actual Notes Read aloud/Stop
passes on both x86_64 developer variants with guest networking disabled.
`voice-adapter.ts` still hardcodes Cloud for ongoing conversation, while
`maps/navigation-voice.ts`, `browser/workflow-speech.ts` and the reviewed speech
executor in `prototype/agent-adapter.ts` still call Cloud speech directly. Migrate
these remaining paths without losing explicit start, automatic conversation turns,
interruption, ownership, review and cleanup. No current result qualifies complete
production local voice, ARM64, physical audio or P-11 latency.

The requested architecture is an **Android-resident Eliza agent with Cerebras
inference through Eliza Cloud**, packaged both as a standalone Android application
and in a full AOSP image. A remotely hosted agent, a host-forwarded development
agent and direct Cerebras billing are distinct alternatives, not evidence for it.

This is an ongoing audit. The source/action inventory is a review queue, not a
claim that every control has been executed. It supplements the 53-item
[machine-readable MVP backlog](mvp-remaining-work-2026-10-09.json),
[remaining-work ledger](mvp-remaining-work-2026-10-09.md),
[core-loop audit](core-loop-audit.md), [owner actions](mvp-owner-actions.md),
[flow PRD](flow-audit-and-prd.md), [screen inventory](prototype-screen-inventory.md),
[PRD](prd.md) and [completion plan](mvp-completion-plan.md).

## Revision correction and evidence boundaries

The original working directory is on `codex/upstream-platform-cleanup`, at
`9e3d179b` with substantial preexisting edits. It was over 1,500 commits behind
current main. Its older native provider bridge forces direct Cerebras; **current
main already implements Cloud provider binding and production onboarding**.
Current `AlphaLocalAgentPlugin.applyProviderEnvironment` removes direct-provider
keys for an Eliza Cloud selection, binds the saved credential generation and
expiry, sets Cloud inference/embedding routing and the configured model. Do not
reimplement that route based on the old checkout's findings.

This campaign preserves the original checkout and reviews current source in the
attached `full-product-audit` worktree. Legacy tests and APK builds below cannot
qualify current main. The already-running Alpha Cuttlefish image is also an older
kiosk build; a booted image does not prove source parity with current main.

Evidence categories remain independent: source/fixtures, APK packaging, installed
emulator/HOME behavior, full-image boot, real integrations, physical hardware,
and user/release acceptance. An assumption skip, an unexecuted test or a synthetic
provider response never counts as a real feature pass.

## Highest priority gaps on current main

| Gap | Source status | Required completion |
| --- | --- | --- |
| Resident preparation toolchain | Host Bun 1.3.14 failed the Cloud package import; the declared Bun 1.4.2 completed all 78 tasks and source verification | Use the declared Bun version (`mise exec bun@1.4.2 -- npm run agent:prepare`). No upstream defect or patch is required by this evidence. |
| Current packaged resident runtime | Cloud-aware native bridge, staging and workflow-worker chain exist | Qualified embedding host libraries, complete current-pin payload, ABI/library/model hashes, real native process/IPC startup, shutdown/restart and owner isolation. Latest hosted foundation APKs omit the runtime. MVP-08/21/39 |
| Real Eliza Cloud login and Cerebras route | Production Welcome, subscription entitlements and native provider binding exist | Normal browser login/return, one-use exchange, active subscription entitlement, actual model response through Cloud, serving provider/usage evidence, expiry/revoke/wrong owner/quota exhaustion/replacement during requests; qualify the newly merged P-25 cached subscription authorization without a per-turn billing hop. Do not substitute direct-key inference. MVP-34/37 |
| Voice in both directions | Production selector uses local speech for Notes/dictation and message read-aloud; Maps guidance, workflow speech and reviewed agent speech now use the local adapter; ongoing conversation now uses a local speech port; installed continuous conversation and barge-in acceptance remain open | Ongoing chat auto-send after explicit start is owner-approved. Migrate every production speech entrypoint to local native STT/TTS (P-13/P-29/P-39), then qualify exact runtime on both ABIs; real mic/speaker/Bluetooth/audio focus/echo/Stop/background tests. Historical ARM64 local speech acceptance failed; the current x86_64 candidate passes both offline canonical tests, but the combined runtime remains unqualified until ARM64 acceptance. MVP-01/23/24 |
| Latency | No current device acceptance sample | Cold/warm startup, end-of-speech→first audio, STT, inference TTFT/tokens/sec, TTS first audio, total completion, action/readback, p50/p95 with sample counts, route/model/network and errors. Use P-11: last input speech sample to first audible response, including endpointing and buffering, at least 50 simple-query trials and cold/warm p50/p95. Legacy recording-end helpers do not establish this boundary. MVP-05 |
| Gmail | Current source has substantially complete provider UI/contracts | Deployed Google token exchange previously returned 401; verify/fix the actual operator configuration, authorize test mailbox, read/draft/attachment/send/revoke and ambiguous outcomes. Exact recipient/content authorization is needed for a real send. MVP-35/36 |
| Maps | Regional provider integration exists | Select and deploy a production HTTPS gateway/data coverage/license/update path; production currently has no configured route provider. Real GPS, reroute, offline and voice guidance. MVP-31 |
| Full AOSP delivery | Launcher staging exists; old test-key Cuttlefish image boots | Current-pin image with current APK/runtime/speech and maintained WebView; required system apps/services, roles, permissions and SELinux; reproducible build/boot/upgrade; exact physical SKU/source/kernel/blobs, release signing/AVB/OTA/recovery. MVP-03/40/41/42 |
| Test infrastructure | Native class registry and campaign runners exist | Current-source native campaign; Cuttlefish admission; remaining secondary-user/process-death/provider-specific campaigns; retain skipped/missing/failed cases and exact artifacts. CI-only constraints should be reviewed against this Linux x86_64 host rather than inherited from an earlier ARM Mac. MVP-13/18/20/47 |
| Notes capacity/recovery | Ordinary native flows and forced-write recovery pass; giant-textarea tests are historical. The bounded 32 MiB collection-capacity fixture passes standalone but its launcher renderer wait failed | Resolve the launcher refusal-state wait while preserving existing notes and unsaved text. Keep arbitrary 33 MiB textarea usability separate from storage-capacity acceptance. |
| Scope additions | Contacts has an image-admitted native catalog and editor handoff; Phone/SMS remain unavailable; Wallet remains outside MVP | Implement Contacts/Phone/SMS only on admitted Alpha AOSP images (P-36). Retain Wallet as full-product planning outside MVP (P-38); no simulated action enablement |

## Every view and flow

Each row includes direct controls, assistant context/actions, Cancel/Back/HOME,
loading/empty/error states, permissions/revocation, persistence and late callbacks.
“Implemented” here describes source, not release acceptance.

| Domain and subviews | Current implementation and outstanding acceptance |
| --- | --- |
| Boot, Welcome, account, lock, HOME | Cloud-backed resident onboarding exists. Exercise normal login, local-app-only mode, permission setup/denial, owner switch, cold/warm startup, external HOME change, update preservation, authenticated reset and stock recovery. Lock is Android-owned. |
| Home, installed apps, favorites, search, ongoing activities | Component/profile-aware library and overview exist. Run LauncherLibrary, actual install/remove/disable, duplicate labels, locked/paused work profile, source freshness, long labels, empty/stale state and return from three native apps. |
| Assistant pill/input/sheet/full, history, approvals/results | Source includes owned context, streaming, cancellation, approvals and receipts. Qualify current resident execution, cross-view continuity, missing-detail questions, draft/scroll/IME, interrupted streams, account replacement, unknown outcomes and exact-once recovery. |
| Inbox folders/search/thread/compose/reply/forward/attachment | Provider operations, local encrypted drafts, assistant-to-email and receipt recovery exist. Real OAuth and mailbox/account scope, From/Bcc/reply-all, paging, unsafe content, chosen attachment bytes, send/undo/revoke and lost-response reconciliation remain. |
| Calendar day/month/event/new/edit/invite/availability | CRUD, availability and agent actions exist. Qualify the actual permission/review UI as well as reader tests, selected calendar/account, all-day/DST/recurrence-instance/series, external/read-only events, invitations, conflicts, revision changes and unknown writes. |
| Reminders/detail/completed/snooze and Clock | Native local scheduling and reviewed Clock handoff exist. Test actual post/tap/complete, channels denied, cancel/edit before fire, recurrence/DST, reboot/Doze/force-stop. Independently prove Clock ringing/snooze/dismiss; handoff is not alarm completion. |
| Browser address/tabs/bookmarks/history/downloads/reading/question | Isolated WebView, persistent normal/private profiles, downloads and reviewed context exist. Qualify exact maintained provider, isolated-world injection, live search/provider challenge, uploads/downloads, redirects, stale observations, credential exclusion and real agent summary. Arbitrary booking/purchasing needs a separately reviewed actuator. |
| Passwords/vault/unlock/fill/generation/export/import | Integrated password manager exists; production data transfer is disabled by reset-only policy. Run actual native fill, locked vault, wrong origin, repeat/cancel and secret exclusion; passkeys remain deferred. Third-party providers are separate acceptance paths. |
| Camera photo/video/scan/review/capture question | Native capture/video and OCR/PDF review exist. Qualify capture/readback, mode/camera/zoom/focus/flash capability, permission denial/revoke, late capture, rotation/background/low storage, OCR uncertainty and selected-capture agent question. System secure-camera source/overlay contracts and a historical-platform fixture now pass locked invocation/capture. Unlock return/privacy and physical optics/hardware remain open; the fixture is not a full current-source image. |
| Photos library/albums/search/viewer/edit/batch/trash/share | Owned media, copy editing, filters, batch actions and recovery exist. Qualify native edit/filter/batch/share, exact bytes, selected-only grants, revoked/deleted URI, large catalogs and video. Main now adds the full permitted-library bridge and device-library UI. Qualify full/selected/denied/revoked reads, permission and owner transitions, bounded indexing and stale media handling, with separately reviewed writes/shares. Person search is not implied by library access. |
| Notes list/search/editor/checklist/recording/transcript/Trash | Encrypted native store, query/edit, recorded audio and Trash recovery exist. Production import/export migration is now disabled by reset-only policy; development fixtures are historical/separate. Qualify full-Trash/permanent-erase interruption, storage failures, linked audio/transcript deletion, cursor dictation, real speech, reviewed rewrite/task creation and restart. No app-data backup/transfer is planned. |
| Files recent/folder/search/selection/preview/rename/move/share | SAF and selected-content handling exist. Add missing instrumented folder-question journey; qualify permissions/persisted grants/cloud-offline URI, collisions/Unicode/large or malicious files, exact bytes, failure/restart and bounded selected context. Busy folder controls currently ignore taps without feedback. |
| Maps search/place/saved/route/navigation | Regional source exists, production routing is unconfigured. Qualify real endpoint, coverage, travel modes, location denial/background/revoke, reroute/arrival, offline and audio focus; return to the originating Calendar event. |
| Workflows library/Describe/editor/review/run/approval/history/digests | Typed authoring, embedded execution and durable receipts exist. Current native worker execution, overlap/duplicate triggers/version/disable/cancel/owner changes, process death and real provider inputs remain. A powered-off resident records missed occurrences; it cannot run hosted loops. |
| Notifications panel/attention/deep links/settings | Android owns the only shade; launcher Home delegates its Notifications button to Android. Owner-bound result/approval notices, listener selection and recovery exist. Qualify publication, denied permission/channel/DND, cold/warm/killed taps once, deleted/stale/wrong-owner targets, listener filtering/revoke and lock-screen privacy. New-mail background notifications are not implemented. |
| Settings account/voice/theme/text/privacy/permissions/roles/about/updates | Source controls exist. Exercise every preference across restart and native settings return, actual grant state, diagnostics contents/redaction, authenticated local-reset scope, identity/updates. App-data export/backup is excluded; diagnostic export needs redaction. Release signing, destructive reset and rollback remain separate gates. |
| Phone keypad/recents/voicemail/incoming/in-call | New full-product work package FP-01 below; production currently disabled. |
| Messages list/thread/new/recipient/attachments | New full-product work package FP-02 below; production currently disabled. |
| Contacts list/search/detail/create/edit/picker | Image-admitted catalog, bounded search and native editor handoff now exist. Ordinary APKs remain denied. FP-03 still requires admitted-image provider, permission/revocation, concurrent edit and exact readback acceptance. |
| Wallet cards/passes/payment/history/recovery | New full-product work package FP-04 below; production currently disabled. |

## Newly authorized implementation packages

* **FP-01 Phone:** real Telecom/default-dialer/InCallService lifecycle; incoming,
  outgoing, history, multiple-number resolution, hold/mute/speaker/DTMF, screening
  and voicemail provider contracts; denial/role loss; headset/Bluetooth/background;
  preserve system emergency routes. Use owned telecom endpoints for delivery/audio.
* **FP-02 SMS/MMS:** default-SMS role and real provider/thread adapter; recipient
  disambiguation, durable drafts, multipart/Unicode/MMS attachments, incoming notices,
  send/delivery/failure identity and no resend after unknown outcome; role/permission
  loss, process death and real owned endpoints. Simulator threads are not SMS.
* **FP-03 Contacts:** restore a production native provider adapter for read/create, then implement
  edit/delete/favorites/readback and account restrictions; multiple fields, duplicate
  names, stale selection and contact deletion; wire Phone/SMS/Inbox/Maps with exact
  selected identity. Contacts access must remain optional and revocable.
* **FP-04 Wallet:** select native-wallet handoff or owned wallet and a supported
  provider/custody model; key/credential isolation, token provisioning, transaction
  review/biometric confirmation, NFC/HCE/secure-element capability, receipts,
  unknown outcomes/reversal, loss/recovery and sandbox tests. Pass/boarding-ticket
  files are a distinct feature. No prototype balance or biometric timer is payment
  evidence, and no real transfer is authorized by this planning request.

Current source gates all four in `apps/app/src/prototype/mvp-features.ts`.
`DailyAppsPlugin` comments out Phone, Messages and Contacts handoffs; production
Contacts provider methods are absent. `ContactsFlowInstrumentedTest` is ignored
and assumes a prototype UI. Its existence is historical test intent, not a working
Contacts implementation. Restore/update that campaign only with the real adapter.

### Implementation order and distribution differences

Build FP-03 Contacts first, then FP-01 Phone and FP-02 SMS against the shared
selected-person contract. FP-04 remains outside MVP; its future implementation waits for its provider and hardware gates. Every implemented package needs a real adapter and capability checks before enabling its entry points.

| Package | Standalone Android delivery | Full AOSP delivery | Required negative and recovery evidence |
| --- | --- | --- | --- |
| FP-03 Contacts | Hidden and denied by native/image capability policy; launcher flavor alone is insufficient | Include and configure ContactsProvider and account/sync support; retain user consent and account ownership | Denied/revoked access; read-only account; duplicate/multiple numbers; concurrent edit; deleted person; restart after uncertain write; readback matches reviewed fields |
| FP-01 Phone | Hidden and denied by native/image capability policy; preserve Android emergency facilities | Include Telecom, telephony/modem integration and role provisioning; retain emergency dialer and recovery UI | Role loss; no SIM/service; dual-SIM selection; rejected/missed/cancelled calls; lock/background; audio routing; dropped call; call state after process restart |
| FP-02 SMS/MMS | Hidden and denied by native/image capability policy; no SMS role request | Include telephony providers, carrier/APN/MMS configuration and messaging role provisioning | No SIM/network; airplane mode; segmented Unicode; invalid/group recipient; attachment limits; duplicate receive/status callbacks; role loss; reboot with queued/ambiguous send; no automatic duplicate send |
| FP-04 Wallet (outside MVP) | Future full-product package: explicit supported provider or system-wallet handoff; passes separately from payment cards; sandbox provisioning and transaction review | Admit required NFC/HCE/secure-element components, hardware keys and payment-provider eligibility; installing AOSP alone grants none of these | Unsupported hardware/provider; failed provisioning; locked/expired/revoked credential; declined/unknown transaction; duplicate tap; receipt reconciliation; lost device/recovery and key deletion |

For each package, add renderer contract tests, native integration tests and a
continuous assistant→review→native action→readback journey. Cuttlefish can test roles,
providers and simulated telephony, but real carrier call/SMS delivery, microphone/
speaker audio and contactless payment require separate physical/provider evidence.
Calls and sends use explicitly authorized test endpoints; Wallet uses sandbox
transactions until transaction-specific authorization is supplied.

## Cross-app, interaction and performance review queue

Retain the existing completion-plan A–F and current J01–J05 tests, but distinguish
renderer fixtures from native/providers. Also trace the detailed flow PRD's camera
poster→calendar, recording→transcript→reminder→notification, mail attachment→Files→
summary→Notes, Calendar→Maps→return, Browser→summary→Notes, photo→recipient→share,
mail→workflow→receipt, password fill→sanitized agent, offline→reconnect and owner
change→late-event rejection. Each needs one continuous run with source/object and
receipt identity, not a collection of unrelated passing component tests.

`node scripts/inventory-interactions.mjs OUTPUT.json` enumerates source-hashed
HTML controls, template bindings, DOM properties, dynamically created controls,
and handler/listener candidates. Entries start `unreviewed`; lexical matches are
not proof of reachability or test coverage. Add every dynamic repeated control,
native permission/role dialog, notification action, gesture, hardware button and
background transition during runtime review. For each supported interaction test:
light/dark, empty/loading/error, permission denied/revoked, cancel/double activation,
stale completion, Back/HOME/background, process restart, keyboard/IME, portrait/
landscape, 150%/200% text, TalkBack and Switch Access. Current gaps include launcher
presentation of app subviews, zoom above 200% and connected states beyond mailbox.

Measure before optimizing: monotonic stage timestamps and sanitized request IDs;
report cold/warm and p50/p95 with sample counts, model/provider route and network.
Warm reusable speech/model resources when justified; stream text and first audio,
reuse connections, bound context and eliminate duplicate calls. Preserve turn/owner
binding, Stop and receipt correctness. No latency claim from a build or mock.

## Cuttlefish automation

The current native runner now admits an explicitly owned **fresh** Cuttlefish guest:

```sh
ANDROID_HOME=/path/to/sdk JAVA_HOME=/path/to/jdk21 \
node scripts/android-instrumentation.mjs \
  --owned-cuttlefish --serial 127.0.0.1:6522 \
  --image-fingerprint '<exact expected ro.build.fingerprint>' \
  --classes NoMockProduct,Shell,StartupReadiness \
  --apk-dir artifacts --output test-results/cuttlefish-baseline
```

Admission verifies loopback address, Cuttlefish hardware/product, exact requested
image, boot completion and unlocked foreground user, while retaining the device
lease and artifact hashes. Existing Alpha packages are refused before mutation,
including preinstalled system APKs. Do not point it at the user's existing kiosk.
It installs/tests both variants, accounts for skipped/missing/failed classes and
uses the existing cleanup/HOME restoration logic. This is installed-APK-on-image
qualification, not a release image build or physical-device acceptance.

`--all` remains refused for Cuttlefish. Reviewed secondary-user classes now use
an explicitly leased lifecycle with owner/HOME restoration and cleanup receipts;
unproven cleanup preserves the owned user. Named ordinary classes and the HOME
phase remain supported. Credential,
clock, process-death and provider campaigns retain their specific prerequisites.
`node scripts/inventory-native-campaigns.mjs OUTPUT.json` exports every native
`@Test` class, source hash, registered gates, other campaign references and explicit
Cuttlefish omissions. This revision inventories 153 classes: 75 with named-class
admission and 78 without a general Cuttlefish campaign. Every entry starts
`not-executed`. Next automation work is a
dedicated disposable Cuttlefish instance, execution of the admitted class matrix, source-matched full-image package admission, qualified secondary users,
reboot/Doze/fault injection and real Cloud/audio inputs. No cloud credentials belong
in command arguments, screenshots or result files.

## Initial campaign results and next sequence (before October 12 native execution)

* **Legacy checkout only:** initial 225-test verification and follow-up 227-test
  verification, TypeScript and web build passed. Both debug/unsigned-release APK
  variants and lint built after preparing a fresh pinned source; initial attempts
  failed on toolchain settings and an interrupted prepared checkout. These are not
  current-main qualification.
* **Legacy browser campaign:** stopped after the revision mismatch and host load
  were identified: 137 passed, 10 skipped, 2 interrupted, 1,174 not run; retain the
  failing cases in the original log. A focused rerun passed 6/8 with two timeouts.
  Do not classify them as current-main defects without reproduction.
* **Legacy Cuttlefish:** boot and APK/WebView identity recorded. Secondary-user
  setup/teardown failed before application assertions; `system_server` then failed
  opening removed-user account storage. The exact race/image cause is unresolved.
  Cold container restart without data wipe restored boot, unlocked user 0, only the
  original user, and visually verified Alpha HOME. Raw failure evidence is retained
  in the original checkout's `test-results/completion-audit/`.
* **Current main:** fresh worktree and pinned submodule prepared; `npm run verify`
  passed on the final code: 719 tests passed, 4 TODO, no failures, plus typecheck, web build and the
  production bundle audit (395 files, mocks off). `npm run android:build:local` correctly stops at missing speech AAR;
  plain `npm run android:build` also exits 2 at the same prerequisite. The refreshed input
  report identifies installed speech, embedding-host and signing
  gates; the resident payload has now been staged. Existing published CI evidence for PR 393 is separate from this campaign.
* **Current production renderer:** 10 selected onboarding, resident local-app and
  signed-out voice tests passed with synthetic native/Cloud responses; this tests
  production UI behavior, not real login, billing or provider execution.
* **New runner:** all 22 focused synthetic admission/runner tests pass. No current-main APK has
  been installed by this campaign, and no Cloud login, Cerebras-through-Cloud,
  native speech, current full-image or physical acceptance is claimed.

Next: qualify current build inputs; build immutable matching APK/test pairs; run
fresh-guest Cuttlefish and complete native matrix; normal Cloud login and route
trace; native speech/latency and all application/cross-app journeys; implement
FP-01–04; signed current AOSP, upgrade/recovery, hardware and four-unit pilot.
Accounts/signing/hardware decisions in the existing owner-action ledger remain
visible dependencies, not reasons to leave independent software work undone.

## Follow-up execution — October 11, 2026

| Check | Result and limit |
| --- | --- |
| Production view/core-flow sweep | **95/95 passed**: retained views/subviews in portrait and landscape, Calendar proposal review, Camera/Files and cross-app journeys. Native/provider boundaries are synthetic; no device or live-account claim. |
| Runtime preparation | **Passed** with the declared Bun 1.4.2: all 78 upstream tasks, Cloud package-import verifier and final immutable-source verification. |
| Mobile workflow bundle | **Built and passed** its isolated dependency test; 49 workflow routes found. No Android worker execution. |
| Resident payload | **Staged for ARM64 and x86_64**, with mobile bundle, runtimes, pinned embedding model and workflow artifact (1,115 worker files). Staging is not APK packaging or process startup. |
| Speech candidate | **Both ABIs compiled**, stripped, source/model/notice checks passed, AAR assembled and candidate identity recorded. `deviceExecuted` remains false; no qualification record changed and the candidate is not installed as the production speech AAR. |
| Embedding-host candidate | **Built successfully** with pinned NDK 29 and CMake 4.0.3; preparation receipt and byte comparison retained. Not staged or qualified; ARM64 execution/review is still needed. |
| Documentation consistency | **13/13 passed** after scope updates. |

The initial preparation used host Bun 1.3.14 and failed on an extensionless
`config-env` import in the built Cloud package. A generated-output rewrite made
its verifier pass diagnostically, but a clean rebuild removed that workaround.
The declared Bun 1.4.2 then passed unchanged. **This was a toolchain mismatch,
not a demonstrated upstream defect; no source patch is needed by this evidence.**
An interrupted build also left a wallet lock; its process was confirmed absent
and the upstream lock helper reclaimed it. No source-verification guard was waived.

Logs and input-state reports are under `test-results/full-product-audit/`:
`production-views.log`, `resident-prepare-pinned-bun-retry.log`,
`workflow-worker-build.log`, `workflow-bundle-test.log`, `resident-stage.log`,
`speech-finalize.log`, `embedding-candidate.log` and
`build-inputs-after-staging.json`. The speech candidate is
`.eliza/local-speech/requalification/candidate.json`. Earlier failed logs remain
for diagnosis; they are not the final preparation result.

The remaining strict packaging inputs are the installed/qualified speech runtime,
reviewed embedding-host libraries and release signer. Current-source installed
Cuttlefish execution, real Cloud login/inference/voice and physical acceptance
still have no new pass in this campaign.

### Additional performance findings

`beginVoiceTurn` has no caller outside its own module/tests. Current ongoing voice
uses `BatchVoiceConversation`; the older playback integration's marks do not
initialize a timing record. Wire owned capture/transcript/send/first-token/final/
audio events before collecting timing samples. The aggregator defect is now fixed:
`byRoute` retains independent cold/warm statistics and failed/incomplete-only routes;
overall `sufficient` requires the minimum complete audible samples for every observed
route. Pooled cohorts are explicitly descriptive. CLI exit 2 identifies each
insufficient route and its audio counts. Regression tests cover 20 successful text
turns with only 19 audio starts, mixed local/Cloud samples, abandoned-only routes
and empty exports. This changes measurement admission, not actual latency; entry-point
instrumentation and the agreed measurement boundary remain open.

The implementation must account for the actual batch-conversation boundaries:

- `voice-adapter.ts` owns capture stop and transcription, but the shared conversation
  can aggregate several recorded clips into one committed utterance. Keep clip
  timings until `send(input.turnId)` binds the committed utterance; do not count
  each ASR clip as a separate successful conversational turn.
- `agent-adapter.ts::sendVoiceTurn` receives the real `alphaClient.send` streaming
  callback. Record the first nonempty response there under the same opaque timing
  ID, and final reply only after the request/conversation/message binding passes.
  Do not use a final-response timestamp as a substitute for an absent first token.
- The Cloud `speak` port has a playback-start callback and an abort signal. Bind its
  mark to that utterance and reject late callbacks after Stop, owner/room change,
  another utterance, or a reviewed Notes-read continuation. A synthesis response
  alone must not count as audible playback.
- Test multi-clip utterances, empty ASR, cancellation at every stage, nonstreamed
  replies, stale playback callbacks, speech failures, owner-input review and resume,
  and successful text with no audio. Keep failed/incomplete records in exports.
- Define cold state explicitly (process/service/model initialization and connection
  reuse) in the measurement receipt; the current boolean alone does not explain
  which resources were cold. Keep x86 emulator, ARM physical and network/provider
  cohorts separate. Collect real Cloud samples only after authenticated inference
  and voice work end to end; synthetic timing remains test evidence.

The strict `android:build:local` rerun after staging still exits 2 before Gradle
because no qualified speech AAR is installed. The rebuilt speech and embedding
candidates are ready for execution review; no qualification fields were forged
or release gates disabled. Full verification for the latency-summary change is
recorded separately in `test-results/full-product-audit/verify-latency.log`.

### October 12 continuation

Fetched origin and confirmed the audit base still matches `origin/main` at
`f3ccefd382bd40b29b06117c97da366c1e9b75a7`; audit edits were preserved.
A disposable Cuttlefish fixture now has a rebuilt product partition excluding
the old preinstalled Alpha APK, a rebuilt super image, and a regenerated
`vbmeta_system` signed with the existing AOSP test key. AVB verification passed
for product, system and system_ext without disabling verification. All writes
are under this worktree's ignored fixture directory; the shared OS output and
existing phone container are unchanged. The fixture uses the historical October 3
base, so even a successful boot will not establish current-source AOSP release
qualification. Fresh userdata is requested; none was copied from the phone.

The fixture runs separately as `alphaphone-audit-cuttlefish`, instance 10, with
loopback ADB `127.0.0.1:6529`. The initial streamer-disabled VM did not reach
kernel logging; enabling the streamer reached Android init and fresh F2FS
userdata formatting. The missing `/images/userdata.img` diagnostic was not
itself fatal: Cuttlefish created an 8 GiB instance-local userdata image. Boot
completion and application assertions remain pending. Image hashes and launch
settings are in `test-results/full-product-audit/cuttlefish-fixture-inputs.json`;
separate launch logs retain both attempts. The 9 focused Cuttlefish admission and
voice timing tests pass again (`continuation-focused.log`).

The F2FS attempt made no further progress past discard/formatting during the
bounded boot observation, and ADB remained offline. An ext4 retry was requested
(the base fstab supports ext4), but the disposable container restart has not
returned yet, so that retry is not recorded as executed or passed. No current APK
has been installed. Keep the pending container operations separate from app
defects and preserve the existing phone container.

The container restart subsequently completed and the ext4 retry reached VM
launch. Boot completion is still unverified; retain `disposable-launch-ext4.log`
as the current attempt and earlier attempts as failure evidence.

### Developer APK campaign preparation

Installed the rebuilt speech candidate with the documented
`--allow-unqualified-runtime` option, then started
`mise exec bun@1.4.2 -- npm run android:build -- --allow-unpackaged-runtime`.
This requests both standalone/launcher and their matching instrumentation APKs;
no successful APK result is recorded yet. Source-pin verification passed and
Android sync is running. These outputs will be non-distributable and cannot
prove resident-agent execution. To respect the existing unpackaged-build gate,
the previously staged resident assets and JNI directory were moved intact to
`.eliza/full-audit-build-backup/`; restore them after the campaign. The same
directory preserves the original `runtime-manifest.json`; the installed local
candidate manifest is temporary and must not be committed. The qualified speech
record and embedding qualification remain unchanged.

The ext4 fixture is live but still has not completed boot. The host is running
other emulator/build workloads and swapping heavily; no latency qualification
may be inferred from this run. Current logs: `android-developer-build.log`,
`speech-install-developer.log`, and `disposable-launch-ext4.log`.

### Interaction inventory correction

The original lexical inventory omitted lowercase DOM properties such as
`done.onclick` and `dialog.oncancel`, used by real dynamic dialogs. It also
counted handlers without separately enumerating controls that use delegated
actions or have no handler. The inventory now records both. The refreshed source
queue contains 2,732 overlapping candidates across 303 files: 835 template
bindings, 277 handler candidates, 347 event listeners, 189 DOM property handlers,
167 dynamically created controls, and 917 markup controls. These are not 2,732
unique actions, and none is automatically marked reviewed or passed. Source
offsets and hashes preserve the location for manual/runtime reconciliation.
Two focused regression tests pass for lowercase DOM events, delegated controls,
dynamic buttons, and template casing/quoting. Full verification of this latest
inventory change remains pending the resource-intensive Android campaign.

### Disposable guest boot admission — October 12

The ext4 attempt subsequently completed boot. Read-only admission passed at
15:40:58 UTC: exact expected fingerprint, Cuttlefish hardware, boot completed,
owner user 0 `RUNNING_UNLOCKED`, no installed Alpha app or test package. The
framework overlay remains part of this historical base. Receipt:
`disposable-boot-admission.json`; this is a diagnostic fixture boot, not a
current-source AOSP release or an installed-app test. The long initialization
delay must not be classified as a demonstrated Alpha app failure.

Read-only intent resolution (`disposable-intent-resolution.json`) found Dial,
SMS, Contacts, Camera, Files picker and Clock handlers. The HTTPS handler is
Chromium WebView shell. The tested Calendar time URI and Maps geo URI had no
handlers. These observations identify image/handoff prerequisites; they do not
prove those applications work or imply that Alpha's internal Calendar/Maps
views are absent. No external activity was launched.

`verify-inventory.log` finished with 719 passing tests, 4 TODO and 2 failures
for stale generated notices while the temporary speech candidate was installed.
The candidate manifest and preserved baseline need reconciliation after the
developer packaging campaign; this latest full verify is not a pass.

The notice mismatch was isolated: normalizing only the Sherpa AAR identity
makes the freshly generated notice entries byte-for-byte equivalent as JSON
to the checked-in entries. Candidate-specific notices were generated after
preserving both original notice files under
`.eliza/full-audit-build-backup/licenses/`. All 11 licence tests then passed.
The in-progress first APK build began before that correction and must not be
used as the final campaign pair; resync/rebuild the candidate-specific notices
after it completes, then restore the preserved source inputs after archiving.
The qualified speech record remains unchanged.

### Developer packaging result

The first `android:build -- --allow-unpackaged-runtime` completed with exit 0:
four app APKs, two matching instrumentation APKs, lint and APK verification
completed (`android-developer-build.log`; Gradle 19m 34s). These are explicitly
non-distributable developer builds without the resident payload. A second build
with the corrected candidate-specific notices is now running; retain that final
pair for campaigns instead of the first build. The API 37 guest remains booted
with stock Launcher3 holding HOME, ready for the runner's read-only admission.

### Current APK execution and lock-screen admission correction

The corrected-notice build completed with exit 0 (Gradle 1m 24s). Its four app
APKs, two test APKs, verification manifest and temporary speech/notice inputs
are archived in `test-results/full-product-audit/developer-apks/`. The original
manifest/notices and staged resident payload have been restored; the candidate
AAR is preserved outside shipping inputs. No qualification record changed.

The first native campaign found that `RUNNING_UNLOCKED` describes user storage,
not whether the keyguard covers the UI. A screenshot and window policy showed
`showing=true` and `inputRestricted=true`; activity resume and keyboard tests
failed. That campaign was stopped deliberately, only its installed app/test
packages were removed, and `cuttlefish-foundation/aborted.json` records the
limitation. No complete-campaign pass is claimed for it. Cuttlefish admission
now additionally requires an unambiguous KeyguardServiceDelegate dump with
both flags false, before package mutation. All 24 focused admission/runner
tests pass, including refusal of visible, restricted, missing and ambiguous
keyguard states.

On this disposable guest only, the lock screen was dismissed and charging
stay-awake enabled; previous settings and the resulting policy are recorded
in `cuttlefish-ui-preparation.json`. The fresh campaign uses the same archived
APKs. Standalone NoMockProduct (2), Shell (1), StartupReadiness (1) and DailyApps
(6) passed, including real local reminder delivery/tap and document-picker
cancellation. FilesTree, Notes durability and the launcher repeat are pending.

`npm run verify` completed successfully with restored inputs: 721 tests passed,
4 TODO, no failures, typecheck/build and the 395-file production bundle audit.
The later keyguard guard is additionally covered by the 24 focused tests above.

### First completed current-APK Cuttlefish campaign

`cuttlefish-foundation-unlocked/results.json` records **27 methods passed,
3 failed, no skips** across both variants (10 class/variant passes, 2 failures).
Both variants pass NoMockProduct, Shell, StartupReadiness, DailyApps and FilesTree.
Notes durability passes 2/4 standalone and 3/4 launcher methods: both fail
`fullCollectionShowsNotesStorageIsFullAndKeepsSavedNotes`, which inserts 33 MiB
into the editor and times out waiting for WebView evaluation. Standalone also
times out in the subsequent `rendererBridgeReportsStorageFullCode`; that method
passes on launcher. Native refusal-without-write and forced-failure draft
recovery pass on both. The large-note UI/bridge stress case remains an open
performance/recovery gap; host contention and test isolation remain diagnostic
variables, not grounds to count the failure as a pass. Raw method traces are
retained. The campaign's overall result is **failed**.

The runner removed both of its packages afterward; only the base framework
overlay remains. The separate launcher HOME-role campaign has now started with
SettingsRoles and LauncherHome, using the same archived APK pair.

### Canonical x86_64 local speech result

The unchanged LocalSpeechInstrumentedTest passed both methods on the archived
standalone APK while the disposable guest had no active network: native
transcription/synthesis and model-holder reuse/release. The requalification
tool ingested the exact APK/ABI/test/evidence hashes and now records x86_64
`passed`; ARM64 remains `not-executed`, and aggregate acceptance is `incomplete`.
No `admit` command ran and no qualified manifest was modified. This establishes
CPU engine functionality, not microphone, speaker, perceptual, duplex-conversation,
Cloud or physical-device acceptance. Network settings were restored and the test
packages removed, under the shared device lease.

Evidence is preserved in `speech-x86-run.json`, `speech-x86-run.log`,
`speech-candidate-before-x86.json`, `speech-candidate-after-x86.json` and
`speech-x86-evidence/` beneath `test-results/full-product-audit/`. The executable
campaign wrapper is retained there as `run-local-speech.mjs`. The HOME result in
`cuttlefish-home/results.json` separately records 7/7 methods, a resumed cold HOME
and exact restoration to `com.android.launcher3/.uioverrides.QuickstepLauncher`.

The next current-APK campaign is running as `cuttlefish-apps`: 27 registered
classes on both variants, covering accessibility/text/rotation, Settings, the
launcher library, offline apps, Notes secure storage/Trash, Camera, Photos and
Video, Files batch/PDF, reminders, notifications and Clock handoffs. It uses
the same archived APK hashes and records skips/failures; no result is assumed
before `results.json` is complete. The previously failing Notes stress class
is reserved for a separate diagnosis instead of being silently retried.

## Notes preflight and Cuttlefish fixture follow-up — October 12

The Notes secure-store adapter now rejects JSON values larger than the native
32 MiB slot limit before sending them across Capacitor. It counts serialized UTF-8
bytes, including non-ASCII and escaped characters, and applies to records and
drafts. The native limit is unchanged. Four host tests cover boundaries, definite
write refusal, preserved stored records and native error propagation. Full
`npm run verify` passes 727 tests with 4 TODOs, plus typecheck, production build
and the 395-file mocks-off bundle audit (`verify-notes-preflight.log`). This is
not yet evidence that the unchanged 33 MiB device stress test passes.

The broad Cuttlefish campaign found that SettingsFlow rejects Cuttlefish using
an old AVD-only battery fixture guard. A test-only admission helper now accepts
Cuttlefish only with recognized virtual hardware/device identity and an exact
expected image fingerprint supplied by the runner after its device admission.
No opt-in is supplied for other classes. Host JVM admission cases and runner
tests pass (26 total, `settings-fixture-admission-tests.log`). Both variants rebuilt successfully, including debug/release/instrumentation APKs,
lint and APK verification (`android-notes-settings-build.log`). The exact APKs
are archived separately in `developer-apks-notes-settings`; original qualification
manifests, notices and staged resident assets were restored afterward. These
remain developer APKs without the resident payload. Native reruns are pending.

Additional native failures under investigation are the accessibility action that
does not open the notification panel and Photos long-press selection. The
PhotosMultiShare cleanup unconditionally removes an ActivityMonitor even when
the test failed before registration, masking the original failure. Its cleanup now checks registration, attempts every
fixture deletion and suppresses cleanup errors onto the original failure; this
follow-up is not included in the already archived rebuild. These remain
failed cases; neither a fixture defect nor host tests count as product acceptance.

The first completed standalone half of the broad campaign also exposes a Files
batch paging failure (after moving three items, `file-004.txt` is not among the
250 visible entries out of 598) and an intercepted Clock handoff that records
`failed` instead of the expected sent status. The Clock fixture intercepts intents;
this does not establish creation of real alarms. Both failures require diagnosis
before changing assertions or treating the flows as accepted.

Source review of `apps/app/src/prototype/files-tree-adapter.ts` confirms two
additional large-folder interaction gaps: selection mode omits the `more` row,
so later pages cannot be loaded while retaining a selection; and `moveFolder`
uses only the first `tree.list` page's directories without exposing its cursor
in the destination dialog. Implement paginated selection and destination
browsing, preserving selected IDs/revisions across appended pages and rejecting
stale/revoked scopes. Acceptance must select files spanning at least three pages
and move them into a directory outside the first provider page. The existing
batch test loads every page initially but assumes small numbered filenames are
still visible after mutation refresh; provider order does not guarantee that.
Both the interaction gap and this test assumption need separate fixes.

The final host verification after Settings admission passes 729 tests, 4 TODOs,
zero failures, typecheck/build and the 395-file production audit
(`verify-settings-admission.log`). Photos failure diagnostics now retain bounded
pointer-event types/timestamps, trusted-event flags, hit testing and document
focus; this is instrumentation-only. The follow-up campaign is queued to wait
for the broad campaign's process exit and terminal evidence, then test unchanged
Notes capacity assertions, SettingsFlow, PhotosBatch and PhotosMultiShare on
both variants using separately archived diagnostic APKs. Its normal admission
checks still refuse preexisting app packages or a locked/wrong guest. Queued
work is not passing evidence.

The diagnostic build also completed successfully for all four app APKs and both
instrumentation APKs (`developer-apks-photo-diagnostics-build.log`). Exact
hashes, source diff/new files and qualification limits are archived alongside
them. The build wrapper restored the original runtime manifest, notices and
staged resident assets and removed the candidate speech AAR from build inputs.
The broad campaign is still running; an interim parse has 81 passing methods,
10 failed methods and 4 explicitly skipped methods across 43 completed classes.
This interim count must be superseded by the terminal `results.json`, and skips
are not included in the pass count.

## Completed broad native campaign and Files pagination work

`cuttlefish-apps/results.json` now supersedes the interim count: 54 class/variant
runs, 97 passing methods, 13 failed methods and 4 assumption skips. Failures on
both variants: Accessibility, SettingsFlow (old APK fixture guard), PhotosBatch,
PhotosMultiShare (masked by cleanup), FilesTreeBatch and ClockHandoff. Launcher
also fails ReminderLifecycle's simulated changed-boot repost case: a notification
is still present where the assertion expected null. TextScale process restart and
Notes fresh-install legacy migration were skipped on both variants and need their
own campaigns. The broad campaign did not pass. The queued Notes/Settings/Photos
follow-up has started using the separately archived diagnostic APKs.

Files selection now exposes Load more while keeping picked IDs and revisions.
The move dialog retains the provider cursor, appends deduplicated directories,
exposes Load more folders even when a page contains only files, and closes on
revoked access without submitting a mutation. Changed-folder replies invalidate
the destination. Tests use synthetic paginated browser providers; they are UI
contract evidence, not Android provider acceptance. Native FilesTreeBatch now
loads more after mutation refresh instead of assuming filename order within the
first provider page. Repository verification and native rebuild/rerun of these
Files changes remain pending.

Files browser regression evidence: all 13 focused cases pass, covering the three
new paginated flows plus existing bulk bytes/move/delete, stale revisions,
dialog dismissal/focus and large text (`files-pagination-regression.log`).

The diagnostic native follow-up changes the diagnosis: standalone SettingsFlow
passes with explicit Cuttlefish admission. Notes still times out while populating
the 33 MiB textarea despite the bridge preflight; only renderer pressure remains
proven by that timeout, not a successful capacity recovery. PhotosBatch reports
`hit:false`, `focused:true`, and no pointer events at the thumbnail. Both Photos
touch tests omitted `AppNavigation.declineStartupAccess`, whose existing contract
explicitly warns that the first-run access modal consumes real touches. They now
choose its real Not now action before touches and retain diagnostics.

The launcher reminder failure occurs before restore/repost, at an immediate
assertion after `NotificationManager.cancel`. The fixture now waits up to five
seconds for both exact synthetic notifications to disappear, then retains the
original simulated-reboot and recurrence assertions. This is a fixture timing
fix pending rerun, not proof of reboot acceptance. Clock now also declines the
startup access panel and reports dialog text on failure for diagnosis.

The Files change passes full `npm run verify`: 729 passed, 4 TODOs, zero failures,
typecheck/build and production audit (`verify-files-pagination.log`). Its Android
build is running with the same archived candidate speech runtime and explicit
developer-only/no-resident limit.

The first diagnostic native follow-up is terminal: 9 methods pass, 5 fail, none
skipped. SettingsFlow passes on both variants. All four unchanged Notes durability
methods pass on launcher; standalone passes three but still times out populating
the 33 MiB editor. Both Photos tests fail on both variants with no thumbnail
pointer events and failed hit testing. This run used APKs before the startup
access dismissal fix, which is now included in the next build.

The Files/fixture APK rebuild succeeded for both debug/release variants, both
instrumentation APKs and lint. Artifacts are archived under
`developer-apks-files-pagination` with exact hashes and source; the build wrapper
restored the original runtime manifest, notices and resident assets. The next
sequence is now running: standalone Notes alone on its prior exact APK, then
FilesTreeBatch, PhotosBatch, PhotosMultiShare, ReminderLifecycle and ClockHandoff
on both newly built variants. Those native results remain pending.

## Repeated standalone Notes stress result

`cuttlefish-notes-standalone-repeat/results.json` is terminal and failed: three
methods pass, while the unchanged 33 MiB textarea input still times out. This
repeat used the exact prior diagnostic APK and ran as a separate campaign, not
concurrently with another campaign on this guest. It does not establish isolated
host performance; other user workloads remain untouched.

A separate, synthetic host Chromium textarea probe (`textarea-layout-probe.log`)
measured assignment plus two animation frames at approximately 416 ms for 1 MiB,
1,909 ms for 8 MiB and 4,565 ms for 33 MiB, with only 44 ms spent assigning the
33 MiB string. This is host diagnostic evidence only, not Android performance or
a causal proof for the full timeout. Large-editor layout deserves direct profiling
and bounded rendering that preserves the complete unsaved note and recovery
export; silently truncating text or increasing a timeout is not acceptance.

The Files/Photos/Reminder/Clock campaign is confirmed running on the new APKs.
Voice review also reconfirms the latency gap: `beginVoiceTurn` has no production
caller, while the current `BatchVoiceConversation` adapter exposes transcribe,
send and real speech-start callbacks. End-to-end timing must be connected to
those exact turn identities and boundaries, with cold/warm definitions and
provider route evidence, before the six-second target can be evaluated.

The next campaign confirms both standalone Photos tests pass after declining
the startup access panel: exact selection/favorites, partial trash/undo and
recreation recovery, plus chooser cancellation, cross-UID exact-byte recipient
verification and stale-selection refusal. Launcher results are still pending.

FilesTreeBatch now passes its prior paging point and verifies the real multi-share
intent, then fails expecting `Select files` after chooser cancellation. Source
retains selection on share, as the browser bulk flow also expects. The test now
waits for the Android chooser to own focus before Back, waits for Alpha focus,
asserts both original selections remain, and clicks Exit selection before
selecting deletion fixtures. It keeps the existing byte/provider checks. The
fixture-only rebuild and native rerun are pending.

Clock diagnostics now identify a product compatibility defect: WebView reports
the fixed UTC offset as `+00:00`; native ICU canonical-ID comparison rejected it
as a changed zone. Native comparison now recognizes strict numeric offset IDs
and compares normalized `java.time.ZoneId` values after canonicalizing named
zones. This accepts equivalent fixed zones without equating a seasonal regional
zone to its current offset. Focused JVM tests pass for zero/fractional offsets,
invalid IDs and changed regional rules. Full verification and a stable-source
rebuild/native Clock rerun remain pending.

`developer-apks-files-share-return` is explicitly inadmissible: Clock source
changed while its build finished, so its archived source may not match compiled
bytes. It was never used for a campaign. The audit build wrapper now fingerprints
tracked diffs and new files before and after builds, refusing to archive when
source changes (only the intentional candidate manifest/notices are excluded).
The wrapper still restores all original build inputs in `finally`.

The Files/Photos/Reminder/Clock campaign is terminal: 14 methods passed, 4 failed, 0 skipped. Remaining failures are Files share-return expectations and Clock fixed-offset timezone handling on both variants. Photos and ReminderLifecycle pass on both.

The Clock offset fix passes full repository verification: 730 passing tests,
4 TODOs, zero failures, typecheck, production build and the 395-file bundle
audit (`verify-clock-time-zones.log`). Stable-source Android rebuilding also
succeeded for both variants, both instrumentation APKs and lint. The new
`developer-apks-clock-fixed-offset` archive includes a source fingerprint that
matched before and after the build. Original speech manifests/notices and
resident staging were restored; the candidate AAR was removed from build inputs.

`cuttlefish-clock-files-corrected` is running against that exact archive. On its
terminal completion, the sequence starts `cuttlefish-extended-apps`, covering 23
additional named classes on both variants: assistant lifecycle, journals, Inbox
attachment bounds, synthetic provider handling, browser continuity/sign-in/page
reading/share/password fill, native speech bridge/cancellation/read-aloud and
worker settlement. Registry gates and assumption skips stay visible. Synthetic
provider checks are not Cloud inference acceptance; simulated resident reuse is
not resident process startup; public browser page tests are not account login.

## Current native coverage ledger

`cuttlefish-clock-files-corrected/results.json` passes all six methods across both
variants: the intercepted Clock handoff suite and real 600-entry Files batch
paging/move/share/delete. No real Clock alarm was created by those tests.

`node scripts/summarize-native-evidence.mjs INVENTORY.json OUTPUT.json RESULTS.json...`
now generates a historical coverage matrix and verifies the archived APK bytes
against each receipt before including it. It rejects archives explicitly marked
inadmissible, missing APK bindings, unknown classes and ambiguous inventories.
It keeps variant, image, ABI, SDK and mock-mode cohorts separate, retains every
attempt, reports partial when a nominal class pass contains skipped methods,
and never promotes unobserved classes to passes. Three focused regression tests
pass. This is observed coverage, not automatic current-source qualification.

The first generated `native-coverage-current.json` snapshot has 35 observed
classes and 118 unobserved out of 153. Its latest cohort outcomes are 61 passed,
3 failed and 4 partial; failures are accessibility on both variants and the
standalone Notes stress test. The partial cohorts retain process-restart and
fresh-install migration skips. The separate canonical offline speech receipt
is outside this generic campaign matrix and remains separately recorded.
`cuttlefish-extended-apps` has started against the stable Clock/fixed Files APKs.

Extended campaign findings so far: Assistant's explicit-assist method fails
because its test helper evaluates only the exact MainActivity while the test
launched AlphaAssistActivity. The helper now accepts an explicit Activity class
while preserving exact-class matching and bounded dispatch; Assistant tests
select the intended surface. This fixture correction needs APK/device rerun.
Flow's activity recreation currently fails with a replacement Activity paused;
its runner now enables existing structural lifecycle/window diagnostics for
the next run. The source evidence does not yet identify the covering window or
justify changing permissions/lifecycle assertions. The first runner regression check actually recorded 25 passes and one failure: its lexical gate check did not follow the scenario helper. The earlier reported 26-pass claim was incorrect. The check now specifically follows lifecycleDiagnostics into the referenced helper; the fresh result below supersedes it. The extended run's prior APKs remain unchanged.

The assistant fixture rebuild succeeded for both variants and test APKs with
a stable source fingerprint (`developer-apks-assistant-surface`). Build inputs
were restored. It awaits its dedicated native rerun after the extended campaign.

Further prerequisite findings: the current Cuttlefish WebView reports no
isolated-world injection, preventing the positive private page-reading/review
flows. The negative unsupported-provider flow runs separately. PasswordBrowserFill
rejects this image's missing `ro.kernel.qemu=1` before its boundary assertion;
it needs explicit Cuttlefish admission, not removal of the disposable-device
guard. LocalSpeechBridge and VoiceNoteReadAloud assert that networking is off,
so their mixed online-browser campaign results are prerequisite failures, not
speech-engine failures. They require a separate lease-protected offline campaign
with exact network-state restoration. SpeechSentenceCancellation is independent
of that offline guard. These gaps were not captured completely in the original
registry inventory and must remain visible in campaign planning.

The corrected runner regression is now confirmed: 26 tests pass, zero failures
(`runner-lifecycle-diagnostics-fixed.log`). Full verification after that correction
is running. `cuttlefish-assistant-flow` is queued behind the confirmed live
extended campaign; it will use the stable assistant-surface APK archive and
structural lifecycle diagnostics on both variants.

### Offline campaign admission and Assistant rerun

The full verification after the lifecycle-gate correction completed successfully
(`verify-scenario-gate.log`). The extended campaign is complete; it retains both
variants' browser/provider, lifecycle, password-fixture and offline-prerequisite
failures rather than treating those as coverage successes.

The stable assistant-surface APK rerun now passes all three Assistant methods in
both distributions. Flow still fails recreation in both: the replacement Activity
briefly reaches RESUMED then becomes PAUSED. Structural lifecycle evidence is
saved in `cuttlefish-assistant-flow`; this does not yet identify the competing
window or prove a product fix.

A dedicated `--offline-speech` Cuttlefish campaign now checks the original airplane
and Wi-Fi settings before mutation, observes no active default network before
starting instrumentation, and restores both original settings in a finally block,
including after partial setup failure. A restoration command failure cannot prevent
the other restoration attempt. Readback and offline observation are recorded; both
must succeed for the overall receipt to pass. Mixed online/browser classes are
rejected in this campaign. Host regressions cover unknown initial state, setup
failure, persistent connectivity, restoration failure, explicit CLI admission and
receipt gating. These synthetic checks do not prove device voice operation.

The owned guest's dedicated LocalSpeechBridge, VoiceNoteReadAloud and
SpeechSentenceCancellation run is now active for both variants using the stable
assistant-surface archive. Its offline-only failures in the previous mixed
campaign remain recorded. Full verification is running after the harness changes.

The refreshed completed-campaign inventory (`native-coverage-extended.json`) now
observes 58 of 153 native classes; 95 remain unobserved. Within the comparable
variant/image/ABI/SDK/mock cohorts, the latest receipts contain 85 passed,
15 failed and 14 partial class results. Partial means at least one method was
skipped. These counts exclude the still-running dedicated offline campaign and
remain historical APK evidence, not current-source or release acceptance.
The focused offline/runner suite passes 25 checks, with zero failures.

### Offline voice result and uncovered-dialog diagnostics

The dedicated offline campaign completed: LocalSpeechBridge, VoiceNoteReadAloud
and SpeechSentenceCancellation all pass for both variants (six class results).
`offline-network.json` proves no active network before execution and exact airplane
and Wi-Fi restoration afterward. This is x86 Cuttlefish evidence with candidate
speech binaries, not ARM64 qualification or physical microphone/speaker acceptance.
Full verification completed with 740 passes, four TODOs and no failures
(`verify-offline-network.log`).

A structural foreground observer reproduced the Flow failure and identified
Android's GrantPermissionsActivity covering Alpha after Camera navigation. The
fixture previously continued manipulating the hidden renderer. It now declines
startup access and answers Camera's real denial button before continuing through
all ten apps and recreating Notes. A native rerun is required.

BrowserShare diagnostics captured the real chooser above Alpha's Home screen:
the immediate Back had reached Alpha before the chooser acquired input focus.
The test now waits for the chooser's actual window focus and UI idleness before
Back. It retains exact shared URL/title, private-data isolation, surviving child
document, stale-share rejection and exact canary cleanup assertions. It awaits
native validation; the prior failed attempts remain evidence.

PasswordBrowserFill now admits an explicitly fingerprint-matched Cuttlefish
fixture as well as its original QEMU guard. The new Cuttlefish-only helper rejects
ordinary AVD and physical hardware; no credential or existing provider data is
used. The runner passes the fingerprint only to the two classes that consume it.
All 26 focused admission/runner checks pass. A fresh stable-source developer APK
build is next for these three fixture corrections.

The permission/focus developer build completed successfully for standalone and
launcher debug/release APKs, both instrumentation APKs and lint. Its source
fingerprint remained stable (`developer-apks-permission-focus`); temporary speech
build inputs were restored. It still omits the resident payload and uses unqualified
candidate speech binaries. Both-variant Flow, BrowserShare and PasswordBrowserFill
are now running against these archived bytes. Full verification is running again
after the test-fixture corrections.

The completed offline campaign raises the latest native cohort matrix to 89
passed, 11 failed and 14 partial results across 58 observed classes; 95 source
classes still have no observed receipt (`native-coverage-offline-complete.json`).
This includes retained failures and skips, not just successful methods.

### Permission/focus acceptance and provider evidence

Both variants now pass Flow (ten app surfaces and Notes recreation), BrowserShare
(real chooser cancellation, document retention and stale-share refusal), and
PasswordBrowserFill (native origin boundary). The six class results are in
`cuttlefish-permission-focus/results.json`, bound to the stable developer APK
archive. These fixture corrections do not imply live Cloud login acceptance.

Before testing a replacement WebView, the instrumentation runner now reads the
selected provider version and hashes every provider APK, then rechecks them after
cleanup. Missing, ambiguous or changing provider observations prevent a receipt
from passing. Coverage summaries keep provider identities separate, including
historical receipts where the provider was not recorded. The focused suite passes
26 tests, including failure before mutation and a provider change after cleanup.
This is identity evidence only; it cannot establish isolated-world API support.

A dedicated RealClock campaign is running on the exclusive owned guest for both
variants. Unlike ClockHandoff's intercepted intents, this test creates one uniquely
labelled alarm, waits for actual firing, exercises snooze/dismiss and deletes only
its fixture row, retaining any original disabled alarm rows. Admission refuses
existing enabled alarms or an uninspectable list. No clock/timezone change is made.

The first RealClock run stopped at its explicit API35 guard on this API37 guest
in both variants, before creating an alarm. It is a fixture-compatibility failure,
not firing/snooze/dismiss evidence. This guard was noted in the registry but not
represented as an executable SDK admission gate; that remains a harness gap.
The test must be qualified for the owned API37 fixture, or run on an owned API35
image, before actual clock acceptance can be claimed. Its receipt now records
WebView 145.0.7632.218 and provider APK hashes.

Full verification for the prior permission/focus fixture changes completed:
740 passes, four TODOs, zero failures (`verify-permission-focus.log`). Verification
for the new provider-identity checks is running separately. Latest historical
coverage now observes 59 classes, with 94 unobserved; its cohort counts include the
two new SDK-prerequisite failures (`native-coverage-permission-focus.json`).

RealClock's new admission retains API35 and adds only API37 with the recognized
Cuttlefish hardware/device and exact runner-admitted image fingerprint. It does
not admit arbitrary API37 phones/emulators or claim API37 functional qualification.
The existing enabled-alarm refusal, visible-list boundary, real firing, snooze,
dismiss and exact-row cleanup assertions remain intact. This closes the concrete
SDK mismatch for an explicitly owned test fixture; a new APK and successful native
execution are still required. The runner sends the image argument only to its
three named consumers. The API37 fixture candidate is being rebuilt.

The API37 Clock fixture developer build completed successfully with a stable source
fingerprint and restored temporary build inputs (`developer-apks-real-clock-api37`).
Its both-variant real-clock campaign is now running. The focused admission/provider
suite passed 30 tests. Full verification is being rerun against restored baseline
inputs: the preceding provider verification completed successfully but overlapped
with the temporary candidate-speech build setup, so it is not used as the final
baseline verification receipt.

The exact repository-pinned Chromium development WebView archive is downloading
for a separate disposable browser fixture. Archive/APK hashes and the developer
certificate must verify before any install; provider version or source declarations
alone will not establish isolated-world or video support. The historical stock
provider and current guest remain separate from that future test configuration.

### Clock transitions and browser fixture preparation

The API37 campaign is terminal: both variants reached `04-fired` in the Clock
fixture log, then failed before snooze/dismiss acceptance. Standalone failed on a
null accessibility root immediately after shade dismissal; its first cleanup read
also saw an enabled row during the removal transition. Launcher subsequently
passed initial no-active-alarm admission and recorded `07-cleaned` for its own
fixture. The complete campaign remains failed, with no snooze/dismiss claim.

The fixture now waits for a stable non-SystemUI root and never sends another Back
merely because a transition yields a null root. Cleanup waits for the exact
original disabled-row baseline; it still fails if that baseline does not return.
The test publishes only its generated external-files UUID directory, and the
runner validates that path before copying its event log/screenshots prior to app
removal. Missing events or invalid paths cannot be reported as successful artifact
collection. The focused artifact/runner suite passes 22 checks. These corrections
require a fresh native run.

The separately copied browser fixture images are built with the pinned development
WebView 157.0.8083.0. The exact archive/APK hashes, developer APK-v2 certificate,
x86_64 ABI, SDK metadata and absence of external static-library dependency verified.
The replacement product image and vbmeta_system retain the original AOSP test-key
trust and enabled AVB verification; the original guest images are unchanged. The
new image has not booted, and is not a current-source AOSP or release image.

Baseline verification before the new Clock transition/artifact changes completed
with 745 passes, four TODOs and zero failures (`verify-clock-provider-final.log`).

The transition/artifact developer build completed successfully for both variants,
including release/debug APKs, instrumentation APKs and lint. Its source fingerprint
remained stable (`developer-apks-clock-transition`), and baseline build inputs were
restored. Both real-clock variants are now rerunning with host-side fixture artifact
capture. Full baseline verification is running after these changes.

The separate browser container `alphaphone-audit-browser-cuttlefish` is created
with the verified candidate images and a loopback-only ADB port 6530. It is not
started; the existing audit guest remains on its stock provider at port 6529.
The next browser boot will use instance 11/CID13 after the clock campaign, so
those campaigns do not compete for guest memory.

The corrected standalone RealClock run now passes the full sequence. Its captured
`events.jsonl` includes create, actual fire, snooze, dismiss and cleanup; screenshots
for all seven stages were copied before app removal. Visual inspection of the
snoozed state confirms the exact fixture row alongside the unchanged disabled
baseline alarms. Launcher is still running. This is Cuttlefish alarm/UI evidence,
not physical speaker acceptance.

A bounded switch script waits for the confirmed clock runner process and requires
its final passing receipt before stopping only the owned stock audit VM (retaining
its instance directory). It then starts the separately created provider guest,
checks boot identity and exact installed provider bytes, and records a distinct
boot receipt. Any failed clock receipt leaves the stock guest available for
investigation. The personal `alphaphone-cuttlefish` container is not involved.

Both transition-corrected RealClock variants passed, including all seven captured
stages. Full verification completed with 748 passes, four TODOs and no failures
(`verify-clock-transition.log`). The stock audit VM was then stopped successfully
with its instance directory retained. The browser guest's first launch rejected
an unsupported `enable_webrtc` flag before starting a VM. Local `assemble_cvd`
flag documentation identifies `start_webrtc`; the corrected launch is in progress.
No boot or isolated-world capability is claimed until readback verifies it.

### Browser provider boot and network admission

The separate API37 guest booted and read back the exact pinned WebView157 APK,
with the expected hardware, image fingerprint and ABI. Its development test-key
boot is not a current-source release image. Browser runtime qualification remains
pending. Initial network inspection found no default network: container resources
were provisioned only through instance10, while this isolated guest uses instance11.
The resource count is now explicitly 11 inside this container, and the guest is
restarting with the correctly configured interfaces. No browser campaign starts
until guest connectivity is observed.

A separate test-mocks developer APK archive is being built for synthetic provider,
reading, download and voice-boundary campaigns. These tests require the explicit
mock build flag and cannot prove real Eliza Cloud login, billing or inference.
The normal distribution APK archives remain unchanged. The build restores the
flag-off web assets as well as the baseline runtime/notice inputs afterward.

The guest restart completed with the expected provider bytes and a default network.
Production BrowserPageQuestion, BrowserReadingNavigation and Video are running
on both variants against WebView157. The network fix is confined to the separate
browser container; the stock audit guest remains stopped and recoverable.

The test-mocks Android build succeeded and restored the flag-off assets, but the
archive wrapper expected distribution-style instrumentation subdirectories. This
build emits test APKs beside app APKs instead. The incomplete archive is explicitly
marked unusable; baseline runtime inputs were restored. The wrapper now uses the
correct test-mocks layout and is rebuilding into a new archive to obtain a complete,
stable-source receipt. No partial archive was used in a device campaign.

### WebView157 runtime findings

BrowserPageQuestion passes all four methods in both distributions, and the
isolated-world stale-navigation method in BrowserReadingNavigation passes on both.
Its unsupported-provider method is intentionally skipped on this capable provider;
the stock provider's separate negative-path results remain distinct evidence.
Video fails the recorded-clip playback assertion on both variants; its other
method passes on both. The host
media-error filter did not capture a specific decoder error, so this run does not
yet establish its cause. Do not infer a codec diagnosis solely from historical CI.
The provider cannot be treated as qualifying all browser/media requirements.

The corrected mock archive completed successfully (`developer-apks-browser-mocks-complete`),
with a stable source fingerprint, matching APK hashes, and flag-off web/runtime
inputs restored. Its dedicated campaign is now running after the production-provider
run, covering fifteen named browser and synthetic-voice classes in both variants.
BrowserUnsupportedReading is deliberately reserved for the stock provider, whose
lack of isolated-world support is that test's explicit prerequisite. Live Cloud
login, Cerebras usage/billing and physical voice remain unverified.

The first five standalone mock-enabled classes passed: dialog lifecycle, download,
reading, isolated-world reading and sensitive-page rejection. The broader campaign
continues. Video diagnostics are being strengthened before its follow-up: capture
the media error code before the product removes a failed video element, plus
ready/network state and AVC/VP9 support. The diagnostic deliberately omits source
URLs, playback capability tokens and media bytes. No playback assertion is relaxed,
and no codec cause is assumed from the existing timeout alone.

The mock HTTP-authentication test fails to observe its native prompt on both
variants. The other tested browser capabilities continue independently. No origin,
HTTPS, foreground or credential-handling guard has been relaxed. A diagnostic
rerun will count only fixture `/auth` requests and report structural browser state
plus boolean refusal/startup-panel indicators; it will not record Authorization
headers, passwords or page content. The hypothesis remains open until that evidence
identifies whether the fixture, provider callback or product presentation failed.

The production video diagnostic build completed successfully and restored baseline
inputs (`developer-apks-video-diagnostics`). Its both-variant rerun is queued after
the mock campaign. It adds observation only; video decoding/playback assertions are
unchanged. A separate mock diagnostic archive is being built for HTTP auth.

### Completed provider diagnostics and mock campaign

The fifteen-class mock campaign (`cuttlefish-browser-mocks157/results.json`) is
complete in both variants. HTTP authentication fails in both; launcher BrowserFlow
also records an HTTP-error retry-link callback timeout with an unknown dispatch
outcome. That action was not retried automatically. Successful synthetic voice and
connection tests do not establish production Cloud authentication, credits,
Cerebras inference, billing isolation or physical microphone/speaker performance.

The coverage snapshot `native-coverage-mocks157.json` records 73 observed native
classes and 80 unobserved, with 126 passing, 10 failing and 16 partial latest
variant/provider/build cohorts. These are historical observations across multiple
source snapshots, not a clean current-source acceptance count.

The completed video diagnostic rerun reports media error code 4, readyState 0 and
networkState 3 in both variants before the failed video element is removed. The
provider reports empty AVC support, generic MP4 “maybe” and VP9 “probably”. This
is evidence of an unsupported-source playback failure and a provider capability
gap; it does not independently prove the captured file's exact codec or exclude a
media-serving defect. A codec-qualified provider or verified compatible capture/
playback path remains required. Recording alone is not playback acceptance.

The initial HTTP-auth diagnostic observes one fixture request and a hidden child
WebView with no host startup-access panel or host refusal text. Native loading/error
messages are separate from host DOM text, so those booleans cannot exclude native
refusal. Additional test-only diagnostics now inspect native foreground, selected
tab, dialog, loading, status and known error-category flags. They exclude URLs,
realms, authorization headers and passwords. Authentication guards are unchanged.

The diagnostic authentication rerun is complete: BrowserWebFeatures still fails
its auth method in both variants; all ten BrowserFlow methods pass across the
two variants. The earlier launcher retry timeout remains an unresolved intermittent
result, not erased by this repeat. The preceding broad mock campaign recorded
47 passing methods and three failing methods across 30 class/variant results.

### Verification and next isolated campaigns

`verify-browser-diagnostics.log` completed successfully: 748 passing tests, four
TODOs, no failures; production web asset verification also passes. The next native
auth diagnostic APK archive builds successfully for both distributions and retains
the developer-only/no-resident-payload limitation. Its diagnostic additions compile
in both instrumentation APKs; their device results remain separate acceptance.

The device queue runs authentication first, canonical LocalSpeech with networking
disabled/restored second, then NotesStorageDurability on WebView157. The latter
keeps the exact 33 MiB editor input and saved-data invariants so a provider change
can be evaluated without relaxing the existing storage test. Each campaign uses
archived APK hashes and its own output directory.

The native auth-state run confirms an explicit native cancellation in both
variants, before any authentication attempt (`authAttempts=0`), with no insecure
connection or timeout error. The renderer previously started navigation immediately
after closing the editor while tab presentation waited for a 100 ms geometry tick.
Foreground navigation now awaits the renderer commit and native presentation before
starting the request, and rechecks the selected tab after those asynchronous steps.
Background restoration and all native auth guards are unchanged. Four browser
navigation regression tests pass; native auth acceptance awaits rebuilt APKs.

`cuttlefish-canonical-speech157/results.json` passes both LocalSpeech methods in
both variants, including actual offline ASR/TTS and model-holder reuse/release.
This remains x86_64 candidate-runtime evidence, not ARM or physical audio acceptance.

The Notes provider comparison completed: three durability methods pass per variant,
but the exact 33 MiB textarea assignment/input dispatch times out on both WebView157
variants. Its result is unknown after dispatch and is not retried. This reproduces
the input responsiveness problem on the newer provider; it is not fixed by that
provider upgrade. The earlier single launcher pass is retained as historical evidence.

The presentation-order change reaches the auth dialog in the standalone rerun;
the former missing-prompt failure is replaced by an unclickable “Sign in” fixture
control. The native test helper selected the same-text dialog title and stopped
searching before the button. Its action lookup now continues past non-actionable
labels. Full wrong-password/retry/success acceptance still requires a new native
run; this intermediate failure is retained. The requirements JSON now has a dated
execution overlay for its exact native-class references, without promoting any
requirement to complete. All eight documentation-consistency tests pass.

### Calendar campaign admission

The original 75 named Cuttlefish classes now all have observations; the provider75
summary records 75 observed and 78 unobserved, with historical failures and partial
runs retained. Unsupported-browser reading recovery passes both variants on the
stock WebView145. This does not imply all 75 classes pass.

CalendarCrud is newly admitted as an explicit named campaign after source review:
its opt-in gate is `calendarCrud=1`; its events have random fixture names, cleanup
targets those records, and calendar ACL revocation affects only a calendar created
by the fixture. It does not invite attendees or contact a remote account. The
campaign checks creation/edit identity, concurrent edits, stale deletion review,
cancellation, recreation and local calendar ACL revocation. All 23 runner/summary
tests pass after admission; device execution is queued after browser auth.

The flag-off developer APK build at `developer-apks-browser-presentation-production`
completed both standalone and launcher distributions, instrumentation and lint.
It preserves the no-resident-payload/not-distributable limitation.

The browser guest resume command exceeded its 180-second observation deadline.
The VM remained live; read-only inspection subsequently confirmed boot complete
and user 0 unlocked. The same guest was admitted after dismissing keyguard and
checking the exact WebView APK hash. It was not restarted. The original queued
auth/Calendar wrappers stopped without running tests because their prerequisite
receipt was absent; replacement wrappers continue from the verified live guest,
using the original fresh campaign output paths.

BrowserStorageFormat is also admitted as a named, explicit fixture with
`disposableBrowserStorageFixture=1`. It refuses existing bookmark/session records
and key aliases before writing; checks the installed AES-GCM storage format using
Android Keystore; never opens an Activity or website; and clears only its fixture
records/keys in finally. The host verifier now recognizes assertion-style gates as
well as assumption-style gates. All 23 runner/summary tests pass. Device execution
is queued after Calendar CRUD; admission is not a passing device result.

The retained ContactsFlow test is not current Contacts acceptance: it attempts to
grant READ_CONTACTS/WRITE_CONTACTS and open a view that production explicitly
disables, while the main manifest removes those permissions. FP-03 must update the
capability/permission/role contract and test together. Do not count this legacy
fixture as implementation, or enable the view merely to make the fixture run.

The auth-click rerun confirms `httpAuthenticationUsesANativePrompt` passes on
launcher: cancellation, wrong-password retry and accepted synthetic credentials
complete with the presentation fix and actionable-button lookup. Standalone ended
before reaching that method and cannot count as a pass. Both variants failed the
site-permission camera prompt; launcher passed the other five methods. Standalone
recorded zero method passes before its incomplete run ended. The host load average
was about 47 during this run, so no performance conclusion follows. The camera
failure is separate and needs media-request state diagnostics; it must not be
hidden by treating the authentication method's pass as a whole-class pass.

BrowserStorageFormat passes on both variants using real Android Keystore. Calendar
CRUD passes both methods on standalone; launcher fails the native event tap after
recreation (pointer events reach the page but have no event-button label). The
launcher calendar ACL-revocation test passes. Those distinct outcomes remain open
in the raw receipts. `verify-calendar-admission.log` completed with 748 passes,
four TODOs and no failures, plus production web asset verification.

BrowserWebFeatures now runs every listed method independently with confirmed fresh
app data before each. This addresses a standalone Android input-dispatch ANR that
prevented the suite from reaching authentication. Independent failures remain in
the merged class result and do not prevent other methods from executing; dependent
phased campaigns keep their stop-on-failure behavior. A runner regression test
proves fresh-data ordering, continuation after failure, complete listed count and
preservation of the earlier failure. All 20 runner tests pass. This changes test
isolation, not product permissions or browser security policy.

Independent browser execution reaches the standalone auth method, but it still
observes a hidden selected surface and cancellation before authAttempts increments.
The fixture now explicitly answers the first-run access panel before using browser
controls, as required for native interactions; JavaScript dispatch alone can act
behind a host modal. Diagnostics also record modal/document visibility and a
whitelist of getUserMedia outcome names, never media, credentials or arbitrary
page text. The hypothesis requires another device run.

Calendar's native tap fixture now scrolls only its timeline container rather than
all ancestors through scrollIntoView. Expected geometry and actual pointer evidence
are retained. It still requires a real injected click on the exact event button;
no JavaScript-click fallback or retry was added. This is a fixture correction
awaiting verification, not a claimed product fix.

The independent-method campaign completed: five BrowserWebFeatures methods pass
in each variant, including site camera permissions; only HTTP authentication fails
with fresh app data. Thus the previous launcher auth pass was not fresh-install
acceptance, and the previous camera failure does not reproduce under independent
method isolation. The new startup-panel handling is queued for full verification,
APK build and a both-variant browser/Calendar run.

SelectedDocument is admitted after reviewing its synthetic MediaStore writes,
exact-URI cleanup, persisted-grant release, real DocumentsUI selection, rename, PDF
render/malformed-byte rejection and test-only share receiver. It uses independent
methods; the process-restart method keeps its explicit assumption skip because it
requires the separate multi-process runner. No remote recipient or agent send is
performed. Twenty-five runner/summary tests pass, including mixed pass/skip and
skip/missing cases; missing methods cannot become passing through aggregation.
The ordinary campaign is queued on flag-off developer APKs after browser/Calendar.

The latest completed coverage snapshot records 77 observed classes and 76
unobserved. SelectedDocument's new admission raises the named registry to 78,
but its pending execution is not included in those observed counts.

The new Calendar geometry evidence identifies a coordinate conversion defect in
the fixture: the target was at CSS (226, 431), but injected pointer events arrived
at approximately (197.48, 376.60), before any hit on the event button. Both axes
were reduced by the same ratio, contradicting a scrolling-only explanation.
The fixture now converts through devicePixelRatio and visualViewport scale/offset
instead of WebView width divided by layout innerWidth, which can differ when the
layout viewport is wider than the visible viewport. A real pointer hit and the
provider lifecycle assertions remain required; this fix awaits a device rerun.

### Fresh browser methods and selected-document observations

`cuttlefish-browser-calendar-fixtures157/results.json` records all six
BrowserWebFeatures methods passing independently with fresh app data in both
variants, including native HTTP Basic authentication. This is not Eliza Cloud
login acceptance. CalendarCrud still failed its real-touch method in both
variants; the captured CSS/native coordinates identified a fixture pixel-scale
mismatch. A devicePixelRatio/visualViewport conversion is queued for verification.

`cuttlefish-selected-document157/results.json` records three passing methods per
variant: real PDF rendering/malformed rejection, rename, and persisted-grant
recreation/forget. Both variants failed `selectingSecondRealDocumentClearsFirstPreview`
before the first preview appeared. No cause is yet established. The explicit
process-restart method skipped and needs its separate campaign. Structural-only
view/modal/navigation diagnostics have been added for the next test APK.

`native-coverage-selected-document.json` now records 78 observed classes and 75
unobserved; latest historical cohorts are 136 passing, 14 failed, and 16 partial.
These counts separate variant/image/provider/mock cohorts, retain skips and prior
failures, and do not establish current-source parity or comprehensive acceptance.

Calendar's corrected pixel conversion now passes both native methods in both
variants (`cuttlefish-calendar-pixel-scale157/results.json`). This preserves real
pointer injection and exact provider identity/ACL checks; no product behavior or
assertion was bypassed. The corresponding source-stable developer archive is
`developer-apks-calendar-pixel-scale`: full verification reported 750 passing
tests, zero failures and four TODOs; the Android build/lint and four APK artifact
checks passed. Its resident payload is omitted and speech remains an unqualified
candidate. These APKs are not release or full-image acceptance.

The diagnostic document rerun reached the first preview in standalone, then
failed in `ShareFlowAssertions.awaitMainForeground` after chooser cancellation.
The helper waited for top-resumed Activity but not chooser input focus—the same
API 37 distinction already observed in other sharing fixtures. It now requires
the real ChooserActivity window to own focus before sending Back. Exact bytes,
read-only URI grants, actual share chooser and local cross-UID recipient checks
remain intact. This fixture correction is awaiting rebuilt execution; the earlier
first-preview timeout is still unexplained and is not reclassified as passing.

SettingsNative and NotificationChannels are now admitted to the fresh-package
Cuttlefish runner after review of their effects. SettingsNative verifies approximate
location, grants precise location, opens Android's account settings without adding
an account, and verifies return/readback. NotificationChannels creates one UUID
channel, toggles that exact channel in Android Settings, checks native readback,
posts/taps a synthetic local notification and deletes its channel in finally.
The named-class runner now rejects an unconfirmed app-data reset before any
instrumentation; a regression test verifies abort plus owned-APK cleanup. These
new admissions remain pending, not counted as observed until receipts exist.

The chooser-focus correction passes all four ordinary SelectedDocument methods in
both variants (`cuttlefish-document-chooser-focus157/results.json`). Process restart
remains an explicit skip, so each variant is partial in the coverage summary. The
previous first-preview timeout is retained as historical evidence, not explained
away. SettingsNative also passes both variants. NotificationChannels fails both
because the fixture cannot identify the exact channel toggle on this Settings
version; recovery has not been demonstrated.

CalendarAvailability, CalendarRange and CalendarTruncation are additionally admitted
after reviewing their local UUID-calendar inserts, permission assumptions and exact
calendar cleanup. They cover chosen-source free/busy privacy and bounds, distant
date navigation with overlapping reads, and a real 2,002-instance truncation case
that must not falsely report a free day. Their execution is pending. The native
runner's 22 focused tests pass after these admissions and reset-failure handling.

All three additional Calendar classes now pass in both variants
(`cuttlefish-calendar-reads157/results.json`): four availability methods plus one
range-navigation and one truncation method per variant. The coverage snapshot
`native-coverage-calendar-reads.json` records 83 observed classes and 70 unobserved;
83 named classes are admitted. This remains historical emulator evidence, with
failures and skipped methods retained, not all-application acceptance.

### October 12 voice-send decision

The user explicitly chose: “Keep ongoing voice with automatic sending after the user starts it.” This supersedes the earlier manual-Send requirement for chat. The PRD, P-01/A-10, MVP plan/status/ledger and acceptance TODOs now follow that choice. Notes review/save and native action approvals remain separate. Production timing hooks, real Cloud samples, route/fallback requirements and physical voice acceptance are still open. No latency result is inferred from this policy decision.

Verification after the runner admissions: `verify-calendar-reads.log` completed
successfully with 751 passing tests, zero failures and four TODOs, plus the
production bundle audit. The owner-policy reconciliation additionally passed
20 focused documentation/timing tests with four retained timing TODOs
(`voice-policy-reconciliation.log`). The TODOs now require ongoing automatic
turn commitment after explicit start and Stop/late-playback handling, rather
than the superseded manual-send behavior. Latest developer APK build/lint
and all four artifact checks passed in `developer-apks-document-chooser-focus`;
no resident payload or release qualification is implied.

### Integration of upstream approved decisions

Main `2e5baedc` (PR 427) was fetched and integrated after preserving the complete
audit checkpoint `ea7e377b`. Its 32 approved decisions supersede the prior open
policy questions. No native/runtime code or pinned upstream revision changed in
that upstream commit. The audit's product fixes, runner changes, exact evidence
receipts and full-product Wallet planning remain preserved. Its newer local-speech,
subscription, AOSP-only daily tools, Pixel 10a/Android 17, always-on listening and
true input-audio-to-output-audio requirements now govern completion. The original
Cloud speech campaigns remain evidence of existing code, not of the required route.

The notification-channel fixture now searches bounded nested Settings rows for the
exact Allow/Show label and requires one switch in that row. It cannot climb through
a page containing unrelated switches. Both variants previously failed before any
channel change; the rebuilt rerun must still prove channel importance changes,
unchanged global app permission, real notification tap and exact fixture cleanup.

`approved-policy-checklist.json` inventories all 109 clauses in the 32 approved
issue checklists, with exact source lines and source SHA-256. Every clause remains
explicitly unverified at the requirement level; historical narrow method passes
are not substituted for the full clause. This extends the original 53-item and
153-native-class inventories without dropping the new scope.

The nested-row NotificationChannels rerun still fails both variants: the helper
finds a candidate, but exact native channel importance stays enabled (3). It does
not establish channel recovery. The next fixture adds only selected switch/row
resource IDs, checked/desired state and known dialog-button presence; no user text.
This separates a stale/wrong candidate from a confirmation or dispatch failure.

The legacy timing aggregator is now explicitly insufficient for P-11 regardless
of count. `sampleCountsSufficient` retains old diagnostic counts; overall
`sufficient` is false, `qualifyingTrials` is zero, and the CLI exits 2 because v1
lacks actual last-speech/first-audible samples and device/model/network/thermal
identity. Old stage sums are renamed as legacy diagnostics. Six focused tests
pass, including 50 complete legacy records that still cannot qualify. Native
P-11 instrumentation and a new export format remain required; no timing pass is
fabricated from these changes.

Full verification after the P-11 diagnostic correction completed with 752 passing
tests, zero failures and four retained TODOs (`verify-latency-p11.log`). The
source-stable `developer-apks-notification-switch-state` archive completed both
variants' debug/release builds and lint. Its resident payload is omitted and
speech remains an unqualified candidate; the release artifacts are unsigned.
The exact archive, rather than subsequently edited documentation, identifies the
next notification fixture's source.

Additional campaign review: CalendarCreationRecovery requires a secondary Android
user and explicitly rejects user 0; its existing runner only admits owned AVDs,
so it cannot be routed through the current Cuttlefish campaign unchanged.
CalendarFlow additionally mutates/restores the device timezone and contains an
older CSS-to-native touch calculation. SettingsCrashLog's real-crash method needs
a two-phase crash/readback runner that does not erase app data between phases.
None of these reviews counts as execution or removes their unobserved status.

The switch-state diagnostic fails in both variants with the same evidence:
`com.android.settings:id/switchWidget` reports unchecked, but neither it nor the
bounded labeled row is clickable; native importance remains 3. The helper had
returned without dispatching an action. It now requires an actionable control
inside the exact labeled row before accepting checked state. A rebuilt rerun is
required; native importance, global app permission and recipient assertions remain.

CameraFlow and CloudDelegationCallback are now admitted after reviewing their
permissions, storage and cleanup. Each method runs with independently reset app
data. Camera covers CameraX capture, JPEG decoding, sharing/viewer recreation and
permission denial/settings recovery on the virtual sensor; it removes only images
newly owned by this fresh installation. Cloud callback tests use random synthetic
states and codes, validate cold/warm delivery, malformed-link rejection and
state-matched clearing, and do not exchange authorization or prove real login.
Their first owned-Cuttlefish execution is pending.

The actionable-control rerun still fails both variants before any channel change:
both Settings switch candidates are found, but the helper rejects every click
target. Inspection found a second selector restriction: an intermediate clickable
frame was required to contain the label itself, although the label may be its
sibling inside the already-validated unique row. The helper now allows clickable
ancestors only up to that exact row, without repeating the descendant-label test
on each intermediate frame. This correction awaits rebuilt evidence. The 22
focused runner tests passed after Camera/Cloud callback admissions.

`cuttlefish-camera-callback157/results.json` completes both variants: both Cloud
callback methods pass, and both Camera permission recovery methods pass. The
Camera capture method fails in both after real JPEG publication/decoding, viewer
and share assertions, at the selected-photo question image. The dialog reports
the missing-image fallback. Native read/revision/blob-shape diagnostics are added
for the synthetic photo before/after sharing; the fixture also declines the
startup access panel explicitly. Neither cause nor correction is claimed yet.
The updated native snapshot is `native-coverage-camera-callback.json`: 85 observed
classes, 68 unobserved; failures remain failures.

The photo diagnostic narrows the failure: native reads succeed, the image is local,
and both revision fields are identical before/after sharing, but `fetch(data:...)`
throws TypeError. The app now decodes native inline JPEG/PNG/WebP bytes directly
into a Blob; browser blob URLs keep their existing fetch path. Revision checks,
local-only source admission and cancellation remain. Focused tests cover exact
bytes without a data-URL fetch, malformed/external inputs and cancelled blob reads.
Device confirmation of the fix is still pending.

Both diagnostic variants confirm successful native reads with unchanged revision
and mutationRevision, followed by TypeError from inline-image fetch. Declining
startup access does not remove that failure. Full verification of the direct
inline-image decoder passes: 755 tests, zero failures, four retained TODOs and
production bundle audit (`verify-local-photo-image.log`). NotificationChannels
still fails to find an actionable Settings target in both diagnostic variants;
no recovery pass is claimed.

Local AOSP Settings source explains the notification selector's premature stop:
`SettingsMainSwitchBar` extends `MainSwitchBar`, whose constructor makes the bar
clickable; the inner `frame` contains the label and switch. `performClick()` on
the Settings bar delegates to its switch. The fixture had accepted the first
uniquely labeled frame and therefore never reached the clickable bar above it.
It now keeps climbing within its bounded search until the unique labeled row is
visible, enabled and clickable, and excludes invisible switch candidates.
A rebuilt native-channel readback is still required.

`cuttlefish-local-photo-image157/results.json` verifies the complete Camera class
on standalone: all three methods pass, including the previously failing photo
question review, draft placement and viewer recreation. Launcher passes both
permission methods but its capture method stops earlier at the cross-UID share
recipient receipt. That timeout does not prove a byte mismatch: the helper never
observed the combined success/hash marker. Launcher therefore has not confirmed
the image-review fix in this cohort. A fresh run on the completed clickable-bar
archive preserves this failure and exercises both Camera and NotificationChannels.
No physical camera or real agent response is implied by these tests.

The clickable-bar run still selects an unchecked control while the exact native
channel remains enabled; no channel recovery is proven. The next fixture rejects
a candidate whose checked state disagrees with that channel's native importance,
and records the bounded matched Settings labels and row class before selection.
This does not weaken the subsequent native readback or global-permission checks.
It remains pending rebuilt execution.

The clickable-bar archive repeats the complete Camera pass on standalone and
the launcher cross-UID receipt timeout. Launcher image-review acceptance remains
open. Share receipt failures now record only foreground package, presence of the
known success marker and expected/observed SHA-256 values, without image bytes
or arbitrary UI text. Rebuilt execution will distinguish missing recipient UI
from an actual hash mismatch. Both notification variants still fail native
readback in this cohort; the new native-state candidate guard remains pending.

The native-state diagnostic passes the full notification recovery method on
standalone. It exposes the false match: a banner-description sentence containing
“show notifications” was accepted by substring search. The real control is
`android:id/switch_widget` inside `com.android.settings:id/main_switch_bar`, with
the exact label “Show notifications”. The fixture now requires an exact matching
label in addition to visibility, one-switch row, clickability and native-state
agreement. Launcher and rebuilt exact-label execution remain pending.

`cuttlefish-native-state-share-receipt157/results.json` passes NotificationChannels
and all three CameraFlow methods in both variants. This confirms the local image
decoder through selected-photo review and draft/viewer continuation on launcher
as well as standalone. Previous launcher share-receipt timeouts remain unexplained
historical failures; the diagnostic rerun does not erase them. Notification native
importance toggles, unchanged global permission, real recipient tap and exact
fixture cleanup pass. The stricter exact-label selector still needs its final run.
The snapshot `native-coverage-photo-notification.json` records 85 observed classes,
68 unobserved, and latest historical cohorts of 151 passed, 11 failed, 18 partial.

`cuttlefish-secondary-user-lifecycle.json` separately proves creation of disposable
user 10, unlocked secondary Launcher3, restoration of owner 0 and its HOME role,
and removal of only that exact test user. Before/after user inventories match.
This is not package isolation or provider execution: the main runner's secondary
Cuttlefish guard remains until the lifecycle is integrated and failure cleanup
receives tests and installed-package evidence. No pinned upstream source changed.

The final exact-label notification campaign passes both variants. The integrated
secondary-user campaign also passes CalendarCreationRecovery and ClockAgentReview
on standalone/user 11 and launcher/user 12; both users are removed, owner/HOME
restored, and package cleanup confirmed (`cuttlefish-secondary-provider157`).
This adds real provider receipt-loss recovery and intercepted native approval
coverage, not live-account or alarm-execution acceptance. Five lifecycle tests
and 22 runner tests pass; the broader native-campaign suite reports 45 passing
tests. The runner now saves secondary-user identity before installing packages
into it and persists the final cleanup state, with focused durability assertions.

ReminderDeletionStorage is admitted next after reviewing its fresh-user encrypted
slots, exact-value compare/exchange cleanup, recreation, and 256 KiB/1 MiB UTF-8
boundaries. It never reads real credentials or creates reminders. Its device
execution remains pending. No upstream checkout was changed.

`cuttlefish-secondary-storage157` passes ReminderDeletionStorage on launcher/user
14. Standalone/user 13 fails before storage acceptance: its strict-not-null waiter
accepts an undefined JavaScript result, followed by JSON parsing of null. Both
users are removed and owner/HOME restored; their per-variant lifecycle receipts
are written to disk. The fixture now reads and validates one result snapshot,
without replaying the storage operation. A rebuilt rerun is required.
`native-coverage-secondary-storage.json` records 88 observed classes, 65 unobserved;
latest historical cohorts are 156 passed, 12 failed, 18 partial. Ninety classes
are admitted by the runner; admission is not execution or acceptance.

Full verification after secondary-user admission stopped on one obsolete parser
assertion that required Cuttlefish to reject every secondary-user class. The
lifecycle/runner tests passed. The contract test now admits reviewed secondary
classes while retaining ownership, mock-build, unknown-class, clock and physical
device gates. Because verification stopped, that queued APK build/storage rerun
did not start. Main PR 426 was fetched during this review; its integration follows
a saved audit checkpoint, with prior APK evidence kept at its original source.

Main `7427d958` (PR 426) is integrated after audit checkpoint `6c88c9d0`. The
merge retains this audit's tested Files paging/chooser and Photos multi-share
cleanup, and uses the equivalent upstream exact-Activity WebView driver with
additional assistant assertions. Upstream adds bounded secure-store staging via
an authenticated explicit patch, serialized storage bridge replies, native/browser
accessibility fixes, cookie policy qualification and Calendar large-text geometry.
These additions do not make this audit's earlier failures pass retroactively.
Fresh verification/builds are required; `vendor/eliza` remains at the same pin.


The actual merge tip is `ca76ac67` (PR 432, including PR 426), recorded by merge
`73b003a55b0269c58aedda82fe1901d56d6c9252`. The preceding `7427d958`
reference identifies the included PR 426 ancestor, not the final merged main tip.
Fresh `npm run verify` passes 808 tests with four existing TODOs
(`verify-merge426.log`). `npm run android:build -- --allow-unpackaged-runtime`
completes both debug/release variants, instrumentation, lint and APK audits in
`developer-apks-merge426`. These remain unsigned developer fixtures with no resident
payload and an unqualified speech candidate. The archive records its temporary
candidate manifest/notices patch; the product source fingerprint hashes an empty diff at this
merge commit. Source inputs and resident assets were restored after the build.

On those APKs, `cuttlefish-merge426-storage157` passes ReminderDeletionStorage in
both variants. Standalone user 15 and launcher user 16 are removed, owner/HOME
restored, and durable lifecycle receipts report no deferred cleanup. This supersedes
the earlier result-waiter failure for this exact source/APK cohort. It proves
synthetic encrypted-slot capacity/CAS/recreation behavior, not reminder delivery.
`cuttlefish-merge426-cookies157` passes both BrowserCookiePolicy methods in each
variant with WebView 157: normal-profile third-party cookie sharing, private blocking,
host isolation and no privileged iframe bridge. All responses are intercepted
synthetic HTTPS content; this is not live Eliza Cloud login acceptance.

PR 432 also provides the system secure-camera source/overlay contracts. Read-only
verification of `/home/shaw/os/.aosp-shadow` passes the reviewed source contract
(`secure-camera-source-merge432.json`, contract SHA-256
`9091be889c89692b6176d15864f1a16adb093db687dbb677787afc4971dd0250`).
The owned Cuttlefish image fails the separate installed-image check
(`secure-camera-image-merge432.log`): SystemUI's `config_cameraGesturePackage`
resolves to an empty string rather than Camera2. No image settings were changed.
This old fixture has not consumed the new overlay; source verification does not
prove a current-source image, locked capture or physical power-button invocation.

`cuttlefish-merge426-accessibility157` still fails both variants at Home: the native
accessibility tree does not satisfy the single final Assistant controls group
assertion. The merged upstream qualification on its other provider/device remains
separate evidence. Our WebView 157 Cuttlefish result is a retained compatibility
failure; subsequent shade/Settings/composer checks were not reached. Font-scale and
accessibility-service restoration stay in the fixture's cleanup path.


`cuttlefish-merge426-notes-storage157` passes all four NotesStorageDurability
methods on standalone. Launcher passes three, but its real collection-capacity
case times out evaluating the storage-full renderer state after the small edit;
the already-dispatched operation is not replayed. The native cleanup runs without
a reported suppressed failure. This is improved standalone storage evidence, not
both-variant capacity acceptance or a claim that the historical 33 MiB editor is
usable. The launcher compatibility/performance failure remains open.

The refreshed merged-source inventory has 154 native classes (91 admitted by name,
63 without an admitted Cuttlefish campaign). `native-coverage-postmerge432.json`
retains 89 observed classes and 65 unobserved; exact archived APK hashes and all
older attempts remain attached. The renderer source inventory is refreshed at
`interactions-postmerge432.json`: 2,734 overlapping lexical candidates across
305 source files. Those are review candidates, not unique actions or runtime passes.


### Accessibility native-name investigation

`cuttlefish-accessibility-groups-diagnostics157` confirms that the assistant DOM
container is visible, enabled, not inert and named, with its child buttons present
in Android's tree. `cuttlefish-accessibility-screenreader157` still fails the old
text/content-description group lookup after binding the instrumentation-only spoken
service before Activity launch. A longer wait and screen-reader mode alone do not
resolve it. Those historical failures remain in the coverage ledger.

Chromium's Android implementation maps named containers to `containerTitle`
([primary source](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/accessibility/browser_accessibility_android.cc),
`ComputeAndroidNameTo` / `GetAndroidContainerTitle`). The fixture now reads public
AccessibilityNodeInfo objects, including that API on Android 34+, instead of losing
it through UiAutomator 2.3's text/description-only interface. Older name mappings
remain accepted. The same one-group, ancestry, final-region, control-label and
within-region geometry assertions remain. It keeps the stand-in bound throughout
traversal and restores both prior secure settings, font size and automation flags.
No renderer or upstream source changed for this correction.

Both variants in `cuttlefish-accessibility-native-tree157` pass the single final
group assertion, proving that the earlier missing-group conclusion was a fixture
compatibility issue on this provider. They still fail Home at 200% on unlabelled
full-screen clickable nodes and upward traversal. The next investigation must
identify those exact native nodes and whether assistive technology reaches them;
there is no geometry/class exception or blanket skip. Later shade/Settings/composer
checks remain unexecuted in this cohort. Screenshots are retained as
`accessibility-native-tree-standalone.png` and `accessibility-native-tree-launcher.png`;
only their exact owned guest files were removed after retrieval. Post-run readback
shows font scale 1.0 and no enabled accessibility service. APK inputs were restored.
The initial native-tree build failed a CharSequence conversion at compile time;
`developer-apks-accessibility-native-tree-fixed` is the completed archive used above.

Full verification of the native-tree correction passes 808 tests with four existing
TODOs (`verify-accessibility-native-tree.log`); the completed Android build includes
both debug/release variants, instrumentation, lint and APK audits. These remain
unqualified developer artifacts without the resident payload. Updated coverage
`native-coverage-accessibility-native-tree.json` retains 89 observed classes,
65 unobserved and historical latest cohorts of 160 passed, 12 failed and 18 partial.


### Exact accessibility nodes and Calendar agent operations

`cuttlefish-accessibility-node-diagnostics157` still fails both variants, with the
same assertions. Exact-node diagnostics fix the previous empty-label lookup, which
could select an unrelated ancestor. The unlabelled nodes are a root View and an
empty TextView spanning the screen; both report clickable=true, focusable=false,
screenReaderFocusable=false and important=false. Native buttons also report
important=false on this provider, so filtering that bit would incorrectly omit real
controls. No such filter, geometry exemption or blanket class skip was added.
`accessibility-node-diagnostics157-metadata.log` preserves the structural evidence.
Further work must distinguish inherited/delegated click metadata from actual
assistive-technology focus targets before changing the traversal oracle.

The reviewed CalendarAgentCrud class is now admitted only inside a disposable
secondary user for these Cuttlefish runs, with explicit Calendar permissions and
both fixture gates. `cuttlefish-calendar-agent-crud157` passes all three methods
in both variants: native reviewed create/read/update/delete, cancelled delete,
stale-revision rejection, direct all-day and chosen-time-zone/RRULE provider
readback, duplicate creation identity and invalid recurrence refusal. The Calendar
editor handoff is intercepted before delivery, including its synthetic attendee;
no invitation or real-account event is sent. These are provider/native-review
checks, not a resident LLM planning or external-calendar-sync result.

Standalone user 17 and launcher user 18 are removed, owner/HOME restored, and both
lifecycle receipts have cleanupDeferred=false. The ownership/admission/runner suite
passes 35 tests. `native-coverage-calendar-agent-crud.json` now records 90 observed
native classes and 64 unobserved, with 162 passed, 12 failed and 18 partial latest
historical cohorts. The inventory has 92 admitted named classes and 62 without an
admitted Cuttlefish campaign; admission remains distinct from observed execution.


Full verification first reports 807 passing tests, one failed microphone-revocation
runner test, and four existing TODOs (`verify-node-diagnostics-calendar-admission.log`).
The interruption verifier observed zero test-start records. Inspection found two
races in the fake ADB fixture: it rewrote shared JSON in place while recording
polled it, and emitted the test-start event only after recording ended. The fixture
now replaces state atomically and synchronously emits start before publishing the
recording marker, then emits only the terminal event after revocation. Neither
real-device runner nor interruption assertions were relaxed. Both focused revocation
tests pass (`voice-revoke-fixture-ordering.log`). The full rerun passes 808 tests
with four existing TODOs (`verify-node-diagnostics-calendar-admission-fixed.log`),
including microphone revocation. Both developer APK variants built in
`developer-apks-accessibility-node-diagnostics`; subsequent changes affect only
host campaign admission, the fake ADB fixture and audit records. No resident or
release qualification is inferred.


### Connection storage and synthetic transport acceptance

Connection is now admitted in a disposable secondary user with the explicit native
slot-isolation gate. `cuttlefish-connection-flagoff157` passes both native storage
methods on standalone and launcher. Ten reserved namespace fixtures reject renderer
read, write, compare/exchange and removal without altering native bytes; a permitted
workflow-draft slot retains public storage access. Encrypted draft persistence,
stale compare/exchange rejection and Activity recreation pass. Two loopback HTTP
methods correctly assume-skip on each flag-off APK, so each class cohort is partial.

`developer-apks-connection-mocks` separately archives both test-mocks debug/release
variants and matching instrumentation at `0a756235`, with the runner-admission diff
recorded. The build restores the flag-off web bundle and Android assets afterward;
`web-dist/build-flags.json` reads testMocks=false. Original resident assets, native
libraries, speech manifest and notices were restored too. The archive is explicitly
non-distributable, without resident payload, and uses the unqualified speech candidate.

`cuttlefish-connection-mocks157` passes all four methods in both variants. In addition
to storage isolation, it proves cancellation of a blocked synthetic request,
redirect rejection before the destination is contacted, capability-header validation,
authenticated synthetic profile read/write, stale-revision refusal without replay,
wrong-identity rejection, and rejection of invalid methods/URLs before HTTP delivery.
All server identities and tokens are generated fixtures on loopback; this is neither
live Eliza Cloud login nor Cerebras inference. No real account was accessed. Real
provider acceptance still needs an identified dedicated test account through normal
sign-in, plus the previously recorded resident-package/ARM64 prerequisites.

Flag-off users 19/20 and test-mocks users 21/22 were removed, owner/HOME restored,
and all four durable lifecycle receipts have cleanupDeferred=false. The refreshed
snapshot `native-coverage-connection.json` records 91 observed classes, 63 unobserved,
and latest historical cohorts of 164 passed, 12 failed and 20 partial. The inventory
has 93 admitted named classes and 61 without an admitted Cuttlefish campaign.
Full verification passes 808 tests with four existing TODOs
(`verify-connection-admission.log`); no requirement status is promoted to complete.


## October 12: microphone-denial recovery on Cuttlefish

`VoicePermissionDenied` now has named Cuttlefish admission with its explicit gate,
a fresh secondary user, and RECORD_AUDIO revoked before launch. The runner clears
user-set/user-fixed permission flags after revocation, scopes every command to that
user, and rejects owner/invalid user IDs. The same preconditions are reapplied after
independent-method resets. Runner tests exercise actual reset/revoke/flag/launch
ordering and durable cleanup. Mid-recording revocation remains a separate campaign.

`cuttlefish-voice-denial157` passes `deniedMicrophoneShowsSettingsRecoveryAndKeyboard`
on both standalone and launcher using the existing flag-off
`developer-apks-accessibility-node-diagnostics` archive. No Android source changed
for this admission, and no new APK build is claimed. The fixture exercises denied
microphone guidance, the real Android app-settings round trip, retry availability,
and keyboard fallback. It checks that microphone permission stays denied and no
Cloud voice recording file is created. Its intercepted Activity uses a synthetic
signed-in Cloud transport without network access. This does not qualify real login,
speech recognition/synthesis, recording recovery after granting permission, or the
approved signed-out/offline local speech policy.

Users 23/24 were removed with owner/HOME restored; both durable receipts record
cleanupDeferred=false. `native-coverage-voice-denial.json` now records 92 observed
classes, 62 unobserved, and latest historical cohorts of 166 passed, 12 failed and
20 partial. `native-campaigns-voice-denial.json` lists 94 admitted named classes and
60 without an admitted Cuttlefish campaign. Requirement completion statuses remain
unchanged. The previous accessibility and Notes-capacity failures remain recorded.

Full `npm run verify` passes 809 tests, zero failures and four existing TODOs
(`verify-voice-denial-admission.log`), including the flag-off web build/audit. Focused
report checks pass 24 tests (`voice-denial-report-checks.log`). Android packaging
remains qualified only to the previously archived developer builds described above.


## October 12: real Notes document picker campaign

`NotesDocument` now runs as a named Cuttlefish class in a fresh secondary user,
with app-data isolation before each independently listed method. Its UUID text
fixtures use actual DocumentsUI grants; export checks independently verify name,
MIME type, byte count, modification time and exact UTF-8 bytes before deleting only
the selected owned file. This is ordinary document handling, not app-data backup.
The process-restart method remains an explicit assumption skip: its dedicated
`test-native-restart.mjs notes` runner currently requires an owned AVD and has not
been admitted to Cuttlefish. No restart acceptance is inferred from recreation.

`cuttlefish-notes-document157` uses the existing flag-off
`developer-apks-accessibility-node-diagnostics` archive; no Android source or APK
changed for this runner admission. Both variants pass oversized-file and invalid
UTF-8 refusal without creating notes. Launcher also passes import/export, both
picker cancellations, independent exact exported bytes, re-import creating a new
note, and Activity recreation. Its class result remains partial due to the restart
skip. Standalone fails waiting for the visible export receipt
(`window.__notesReceiptSeen===true`): Notes reports storage ready and the document
visible, but the observer never records the expected success notice. Cleanup then
reacquires the exact file through DocumentsUI, verifies its bytes and removes it;
no suppressed cleanup failure is reported. This is not proof that the original
native callback or receipt was delivered. Keep the failure open rather than retrying
an export or relaxing the receipt assertion.

Next diagnosis should capture bounded native result category and renderer receipt
visibility/epoch transitions around the original operation, without recording note
contents or replaying the write. Source inspection shows a visibility-delayed
receipt and a 1.9-second toast, but neither alone establishes the failure's cause.
Both secondary users (25/26) were removed and owner/HOME restored, with durable
cleanupDeferred=false receipts. The inventory now admits 95 named classes and
leaves 59 without a Cuttlefish campaign. `native-coverage-notes-document.json`
records 93 observed classes, 61 unobserved, and historical latest cohorts of
166 passed, 13 failed and 21 partial. No requirement status becomes complete.
Full verification passes 809 tests with four existing TODOs, including the flag-off
web build/audit (`verify-notes-document-admission.log`). Prior developer Android
build evidence remains separate from this host-runner-only change.


## October 12: Notes receipt diagnostics and early warning observation

Two fresh developer builds, `developer-apks-notes-receipt-diagnostics` and
`developer-apks-notes-receipt-observer`, package both debug/release variants and
instrumentation, with lint and archive checks passing. Both wrappers completed and
restored the original speech manifest, notices, native libraries and resident assets.
These remain non-distributable APKs with resident payload omitted and unqualified
speech candidates. Only instrumentation changed; no product behavior was altered.

The first diagnostic run, `cuttlefish-notes-receipt-diagnostics157`, passes standalone
export but misses the oversized-file warning. Launcher passes invalid-file refusal
but reproduces the export-receipt timeout. Its bounded DOM trace records a visible
notice classified as other, not the expected success text, after returning from the
picker. Exact owned-export cleanup succeeds. This narrows the observation but does
not prove which notice replaced the confirmation or whether the native callback
was delivered. No writes were replayed to obtain a success result.

The invalid-file checks previously inspected body text only after picker return,
which can outlive a 1.9-second notice. They now arm the existing receipt observer
before opening the picker and require the exact expected warning with visible
bounds, while retaining the unchanged Notes-envelope assertion. This improves the
test's observation window without weakening the outcome. The export observer's
success predicate is unchanged. Diagnostics use at most 16 structural snapshots,
four nodes each, fixed message categories and bounded text lengths/match flags;
they do not retain arbitrary toast text, document names or contents. Instrumentation
status carries these diagnostics directly into the archived test output.

`cuttlefish-notes-receipt-observer157` passes both ordinary methods on both variants:
real import/export/cancel/exact bytes/re-import/Activity recreation, and oversized/
invalid-UTF-8 refusal. Captured warning and export receipts match exactly with visible
bounds. Process restart is still explicitly skipped on both, so both class cohorts
are partial. Prior standalone and launcher export timeouts remain unexplained and
retained; this passing run is not a demonstrated product fix. Other notices of
81 characters appear around some picker transitions, but length alone does not
identify their source. Further diagnosis must establish the native result and
renderer notice ordering rather than guessing from text length.

All four secondary users (27–30) were removed with owner/HOME restored and durable
cleanupDeferred=false receipts. Full verification after the final change passes
809 tests with four existing TODOs, including flag-off web build/audit
(`verify-notes-receipt-observer.log`). No requirement status is promoted to complete.

The refreshed `native-coverage-notes-observer.json` retains 93 observed and 61
unobserved classes, with latest historical cohorts of 166 passed, 12 failed and
22 partial. Earlier failed attempts remain in their cohort histories. Report checks
pass 24 tests (`notes-observer-report-checks.log`).

## October 12: separate secure-camera image fixture built; boot pending

The reviewed source contract passes again (`secure-camera-source-fixture.json`).
A separate `artifacts/cuttlefish-secure-camera-fixture` consumes the product's
`writeSecureCameraOverlay` values, packages them as two fixture-only static runtime
overlays targeting framework and SystemUI, and rebuilds product, super and
vbmeta_system. The exact recipe is
`test-results/full-product-audit/build-secure-camera-fixture.py`; generated resource,
APK and image hashes are in the fixture receipt. No shared AOSP checkout or previous
fixture image was modified. The older platform/WebView base remains historical;
this is not a full current-source AOSP build or a release image. Runtime-overlay
packaging is a test-fixture adaptation, not proof of production makefile consumption.

AVB test-key trust is retained, flags remain zero, and offline `avbtool verify_image`
passes the new product and retained system/system_ext hashtrees
(`secure-camera-avb-verify.log`). Image construction does not prove boot or gesture
behavior. The existing browser fixture VM was stopped cleanly, retaining its data.
New owned container `alphaphone-audit-secure-camera-cuttlefish` uses instance 12,
CID 14 and localhost ADB 6531; personal targets were not touched.

At the recorded observation, launch session 80931 and run_cvd/crosvm are still live,
ADB is offline, kernel output stops after early module loading and logcat is empty.
`secure-camera-boot-observation.json` records this pending state. Do not infer a
terminal failure or restart from this observation timeout. Resume by checking that
same process/container, then verify the loaded secure-camera resources once Android
boots. No image-contract, power-gesture, locked-capture, unlock-privacy or physical
acceptance is claimed. Browser-fixture ADB 6530 is currently unavailable because its
VM was intentionally stopped to keep one audit VM active.

### Secure-camera fixture boot diagnosis: encrypted data initialization

The same launch session 80931 remains live. Comparing the kernel trace with the
working browser fixture identifies the wait after `vold cryptfs encryptFstab`,
first-boot encrypted userdata creation. The older fixture took about 140 seconds
at this stage; that duration is not a deadline for the new run. A single crosvm
power-button wake event was accepted but did not change the visible boot state.
No VM restart or image change was performed.

Although vCPUs wait in KVM and the kernel log remains unchanged, crosvm write I/O
advanced from 5,779,554,304 to 6,541,533,184, then 7,696,019,456 and 8,447,533,056
bytes. This is measurable progress during initialization of the 8 GB data partition,
not evidence of a camera-overlay failure. `secure-camera-boot-io-observation.json`
records the latest process and I/O observation. Android ADB remains offline and
boot/resource/gesture acceptance remains unproven. Continue by polling the same
launch handle and live I/O before considering recovery.


## October 12: first secure-camera fixture booted; signature-sidecar fix rebuilding

Launch session 80931 finished successfully. Android reported sys.boot_completed=1
and orange verified-boot state, as expected for this unlocked test fixture. Offline
AVB verification remains separate from that unlocked state. The runtime camera
contract failed because SystemUI's camera gesture package was still empty
(`secure-camera-image-fixture-error.log`). Detailed PackageManager logs identify a
concrete fixture packaging defect: both new overlays were rejected during APK v4
certificate collection after fs-verity measurement was denied. The SDK signer had
written `.apk.idsig` sidecars into the product tree. The framework resource appeared
in early static overlay resolution, but PackageManager did not admit the packages;
that partial loading is not a passing image contract.

`build-secure-camera-fixture-v2.py` rebuilds a separate image without v4 sidecars
(`--v4-signing-enabled false`), retaining APK v3 signatures, test-key AVB and its
hashtrees. Original fixture images are unchanged. The new images are also reflinked
under the existing mounted image directory at `/images/secure-camera-v2`. After a
clean stop, instance 12 was relaunched from that path with live session 35229.
Cuttlefish explicitly reported its old disk overlay incompatible with the changed
base images and discarded that disposable overlay; despite requesting resume, the
initialized data was not retained. Only this empty owned fixture is affected.
The replacement is therefore undergoing first-boot data initialization again.
No signature/SELinux/AVB enforcement was disabled to make the packages load.

While waiting, `summarize-native-evidence.mjs` now checks exclusion receipts beside
test APKs as well as in their parent archive. Previously it could miss an excluded
test APK stored flat in a separate archive. CLI regression tests cover flat,
nested-parent and nested-local exclusions, require no output on rejection, and
admit the same hashes only after their explicit evidenceUsable flag is true.
Focused tests pass five checks; full verification passes 810 tests, four existing
TODOs and the flag-off web audit (`verify-flat-archive-admission.log`). This is a
host evidence-tool change, so the existing developer APK build receipts remain
separate. No coverage count or requirement status is promoted by it.

## October 12: corrected secure-camera fixture boots and invokes while locked

Launch session 35229 completed. The v2 image reports boot complete and the expected
Cuttlefish identity. `secure-camera-fixture-v2-boot.json` binds the image hashes,
installed overlay APK hashes, image-contract result and invocation result. Both
installed overlay APKs match their rebuilt source artifacts byte for byte. The
resource check now passes: framework double-power camera is enabled, SystemUI
resolves Camera2, both secure camera actions resolve SecureCameraActivity, and Alpha
is not a secure-camera handler. This confirms the v4 sidecar packaging diagnosis.
The old failed image and its evidence remain preserved.

`test-secure-camera-invocation.py` exercises the standard power-key path on owned
instance 12, owner user 0. It first verifies an empty lock credential, installs a
public synthetic fixture PIN, locks the emulator, then sends two power-key presses
150 ms apart. SecureCameraActivity becomes top-resumed while TrustManager still
reports deviceLocked=1 and keyguard remains showing. The exact prior lock-disabled
setting is restored, the fixture PIN is cleared and empty-credential verification
passes. Camera2 is stopped and the fixture returns to HOME. The receipt is
`secure-camera-invocation.json`. Initial preflight-only attempts found shell empty-
argument/exit-code handling differences before installing any PIN; those logs are
retained separately. The successful run uses a correctly quoted empty credential.

No shutter action, photo access or external side effect occurred. Locked capture,
prior-photo exclusion, unlock return/privacy and physical power-key/camera behavior
remain unverified. This historical-platform fixture with two current resource
values is not a full current-source AOSP image, production overlay-build proof,
release signing qualification or resident-agent acceptance. Current active audit
ADB is 6531; the unchanged browser fixture at 6530 remains stopped.


## October 12: one synthetic photo captured while secure keyguard remains locked

`secure-camera-ui-inspection.json` confirms Camera2 exposes a real enabled shutter
while SecureCameraActivity is resumed above the locked keyguard. The synthetic
fixture's MediaStore was empty before capture. `test-secure-camera-capture.py`
uses the observed shutter resource ID/bounds, after the standard double-power
invocation and a temporary fixture PIN; no arbitrary screen coordinates are used.

`secure-camera-locked-capture.json` records one shutter attempt producing one
Camera2-owned image, 38,350 bytes, JPEG, 1392×1856. TrustManager reports deviceLocked=1
before invocation, after invocation and after capture. The trusted ADB test harness
reads only that new URI and Pillow verifies its JPEG structure and dimensions.
This privileged harness read is not proof that the locked UI can access the wider
library. The exact row's identity and owner are rechecked before deletion; an empty
image store is then confirmed. The fixture PIN is removed, empty-credential
verification passes, and the previous lock-disabled setting is restored before
returning HOME. The result is bound to the v2 boot receipt and script hashes.
An initial host-Python attempt lacked Pillow and stopped before device mutation;
the successful run uses the bundled dependency runtime.

This is narrow emulator locked-capture evidence. Prior-photo exclusion, secure
session gallery behavior, unlock return/privacy, real optics and physical power
buttons remain unverified. The platform base is still historical, the overlays are
fixture-packaged, and the image is unlocked/test-key signed. No full current-source
AOSP, release, resident-agent or device acceptance follows. No product source
changed in this run; existing 810-pass/four-TODO source verification and developer
APK build evidence remain separate.


## October 12: secure-session photo visibility and lockscreen return, partial

The exploratory session-privacy campaign retains four separate attempts and their
UI hierarchies. The first two expected an Unlock placeholder before any capture in
a fresh secure session; instead, one swipe closed the mode drawer and the next
left the preview visible. These assertions failed without showing a prior photo.
Their single owned media rows and temporary PINs were cleaned up. The failed
expectation is retained, not relabelled as a passing privacy test.

The diagnostic comparison in `secure-camera-session-privacy-v3` and the follow-up
`secure-camera-session-privacy-v4` each create two synthetic Camera2 photos in
separate secure sessions. Both JPEGs are fully decoded by Pillow. A fresh session
keeps the device locked while the earlier photo remains stored. After a capture
in the current session, the same left-swipe gesture reaches the filmstrip. Its UI
hierarchy contains one photo caption matching the current filename timestamp,
with a distinct earlier timestamp excluded from the observed captions, plus a
visible, clickable Unlock to Camera placeholder. This is a bounded UI observation,
not proof that every prior-library access route is sealed.

The v4 run taps that observed placeholder. The next hierarchy is Android's
`element:lockscreen`, reports Device locked, and TrustManager remains locked. It
does not expose gallery content. No PIN-entry control was observed in this step;
credential entry and return after a real UI unlock remain untested. Therefore
priorPhotoIsolationVerified and unlockReturnVerified remain false in the receipt.
The receipt binds the script and v2 fixture boot hashes and records the narrower
current-caption match and lockscreen-return observations separately.

Six synthetic rows across all four attempts were removed by exact recorded ID,
owner and display name. Every attempt restored the previous lock-disabled setting,
removed its fixture PIN and verified an empty image store. No personal target or
media was used. The latest evidence is
`test-results/full-product-audit/secure-camera-session-privacy-v4/result.json`;
failed attempts and comparison hierarchies remain alongside it. No product or
shared AOSP source changed, and no overall camera/privacy requirement is completed.


## October 12: refreshed main and remaining secure-camera unlock gap

Merged main through `7bf27cc9` at `344dff84`, retaining the audit's atomic fake-ADB
state publication and full-product Wallet planning outside MVP. The incoming
changes enforce exact managed-service routes, remove production hosted-agent
connections, add native authenticated reset and startup-marker recovery, and
isolate browser cookie policy. Their checked-in reset and cookie receipts remain
source-bound upstream evidence, not reruns on this audit's current APKs.

Two further secure-camera attempts (`secure-camera-session-privacy-v5` and `v6`)
reached the same locked Android screen after the current-session filmstrip's
Unlock control. A swipe and a subsequent campaign using the observed clickable
lock control did not expose the expected PIN entry. Both campaigns failed that
assertion before entering the synthetic credential. Unlock return remains
unverified; this does not establish a privacy leak or a successful unlock.
Both receipts bind their scripts and the v2 fixture boot receipt. All four exact
owned photo rows were deleted and both temporary PINs removed in cleanup. An
independent post-run check confirmed the empty credential and empty image store.
The earlier locked-capture evidence remains separate from this failed navigation.

The refreshed strict-build input report still names missing qualified speech,
reviewed ARM64 embedding-host libraries and release signing. Prepared resident
sources, worker, staged payload and embedding model exist, but that is not evidence
of resident execution in an APK. Live Cloud login/Cerebras, end-to-end voice latency,
physical hardware and full current-source image acceptance remain open.

Validation after the merge: `npm run verify` passed 815 tests with zero failures
and four TODOs, including the flag-off production bundle audit. The strict
`npm run android:build` stopped at the missing speech AAR. The explicit
`--allow-unpackaged-runtime` developer build then completed standalone and launcher
debug/unsigned-release APKs plus instrumentation, archived in
`test-results/full-product-audit/developer-apks-reset-merge` at source `6875e84b`.
The wrapper verified source stability and restored the original runtime inputs.
These APKs omit the resident payload and use unqualified speech; neither a release
nor installed behavior is qualified by their successful build. Earlier Notes
migration passes predate the new production prohibition and remain historical.


## October 12: installed production boundaries after reset-policy merge

The rebuilt flag-off APKs from `developer-apks-reset-merge` were installed on the
owned secure-camera v2 fixture (`127.0.0.1:6531`). Both variants pass three Connection
methods, including explicit native validation rejection of dedicated/remote hosts,
hosted-agent paths and unreviewed Cloud routes before network dispatch. Reserved
native storage and encrypted draft boundaries also pass. Two development loopback
HTTP methods skip intentionally. This is not real Cloud authentication/inference.

Both variants pass the two ordinary NotesDocument methods on the new production
branch: import/export controls and native migration are refused without starting
DocumentsUI or changing saved Notes. The method names retain historical migration
wording, so their passes must not be described as working production import/export.
The development-only restart phase is skipped. Users 10 and 11 were removed and
owner restoration is recorded in
`test-results/full-product-audit/cuttlefish-reset-policy-boundaries157/results.json`.

This guest shares a fingerprint with an older fixture but has different image
bytes. New runner receipts now record the observed `ro.boot.vbmeta.digest`;
coverage summaries keep differing digests and historical unknown digests in
separate cohorts. Admission rejects malformed nonempty values. The value is an
observed image discriminator, not proof of verified-boot enforcement, complete
partition identity or release qualification. The boundary campaign began before
that addition and is not folded into the older image's historical coverage totals.


ResetPolicy's first installed run passed isolated marker persistence but failed
both variants before cancellation: an exact `By.text("Cancel")` lookup returned
null. The test now waits for Android's negative-dialog resource and verifies its
Cancel label case-insensitively before clicking. It does not change the app or
weaken reset authorization. Rebuilt standalone and launcher artifacts at `d69483bf`
then pass both methods with no skips: cancellation returns cancelled, preserves the
selection and real pending-marker state, refuses migration plugins, and the isolated
marker survives reopening. The owned application/test packages were removed.

Failed and passing receipts are retained respectively under
`cuttlefish-reset-cancellation157` and `cuttlefish-reset-negative-action157` in
`test-results/full-product-audit`. Both bind the boot metadata digest and exact APK
hashes. These checks do not prove destructive system reset, pending-worker deletion,
credential acceptance or the future separate listener package's reset contract.
Existing upstream external-controller evidence remains independently source-bound.
The older coverage snapshot is not regenerated or presented as current exhaustive
coverage by this addition.

Full source verification passed 817 tests, zero failures and four TODOs, including
the production bundle audit. Both developer APK variants rebuilt successfully with
the updated instrumentation. As before, they omit the resident payload and use
unqualified speech; strict distribution, real Cloud/Cerebras and physical gates
remain open. Original runtime inputs were restored by the build wrapper.


## October 12: video codec and serving boundary isolated on the current fixture

The rebuilt `developer-apks-video-codec-range` instrumentation preserves the
original playback assertion and adds an independent recorded-media byte-range
oracle. It emits only track MIME/dimensions/audio-rate/channel metadata, never
source URLs, capability tokens or media content. Both variants record H.264
(`video/avc`) at 1280×720 plus AMR-NB (`audio/3gpp`) at 8 kHz mono. Native metadata
and decoded-frame checks pass. The independent renderer request through
AlphaPhotos and its same-origin capability endpoint returns HTTP 206 with exactly
the expected bytes 16–31 and one 16-byte Content-Length. Leaving Camera finalizes
recording rather than leaving capture running.

The original renderer playback assertion still fails in both variants with media
error 4 before positive playback time/width. The provider reports empty AVC
support. This rules out failure of the independently tested nonzero range as the
cause of that check, but does not prove every media request/seek/lifecycle path.
No playback, audio output, pause/seek or restoration acceptance is claimed.
The campaign has two passing methods and one failing method per variant, with no
skips, and remains failed overall. Exact receipts are in
`test-results/full-product-audit/cuttlefish-video-codec-range157/results.json`.
All six synthetic recordings were removed; a post-run MediaStore video query is
empty.

Read-only copies of both active `/vendor/etc/media_profiles_V1_0.xml` and
`media_profiles_vendor.xml` have SHA-256
`f5b8e7d177169e977c0c1767bac3f328e36587e243a37070453aa800a1ef4219`.
Both contain 16 AMR-NB profile entries and no AAC profile entries; the copies and
counts are recorded in `video-codec-platform-profiles.json`. No platform file was
changed. This makes the remaining AOSP work concrete: qualify the actual camera
encoder/profile, muxed audio and video tracks, and the chosen playback engine
together. A newer WebView version alone is insufficient admission. Any maintained
provider or reviewed native-playback implementation must demonstrate the actual
recorded format, audible output, pause/seek, background stop, recreation and owned
media access/revocation on both APK variants and the image. Physical microphone,
camera and audio acceptance remain separate. Native decoding of a frame is not
an acceptable substitute for the required user-facing playback flow.

Validation: full `npm run verify` remains 817 passed, zero failed and four TODOs;
both developer variants rebuilt with the instrumentation changes. The build wrapper
restored original inputs. These APKs still omit resident payload and carry
unqualified speech, so this adds no release, Cloud or resident-agent qualification.


## October 12: native recording deadline on both Cuttlefish variants

LocalVoiceRecordingLimit is now admitted through the generic runner only with an
explicit owned guest, a fresh secondary Android user, the localVoiceRecording=1
gate and microphone permission granted before launch. The specialized permission
runner remains available; mid-recording permission revocation still requires its
own process-death orchestration. No recording test was added to default campaigns.

Both variants pass the existing native deadline test from the exact
`developer-apks-video-codec-range` archive. A native recorder is started with a
29,000 ms limit; its event must arrive within 36 seconds without a renderer timer.
The entire recording is decoded into mono 16 kHz PCM and must contain between
27 and 30 seconds of samples, with no truncation. This proves the asserted bounds,
not an exact measured per-run duration: the generic campaign retains the raw test
result, while the fixture-local JSON is deleted with its user. Users 12 and 13
were removed and owner restoration confirmed. The receipt is
`test-results/full-product-audit/cuttlefish-voice-deadline157/results.json`.

This reuses unchanged native APK bytes and qualifies only recording/decode duration
on the owned x86_64 fixture. It does not qualify ASR accuracy, VAD/semantic endpointing,
barge-in, physical input/output, the resident agent or Cloud. The required P-11
last-speech-sample to first-audible-sample campaign still has no qualifying trials.
No requirement status or historical coverage snapshot is upgraded by this run.

Validation: `npm run verify` passed 818 tests, zero failures and four TODOs,
including the production bundle audit. Only runner admission, its regression test
and audit documentation changed; installed tests reuse the already-built and
hash-admitted standalone/launcher APKs. Release prerequisites remain unresolved.


## October 12: saved voice-note lifecycle and production routing failures

NoteAudio now runs only on explicitly owned guests in disposable secondary users,
with fresh storage per method, pre-start microphone grant and the explicit
`audioFence=true` fixture gate. The current developer APKs were reused unchanged.
Both variants execute all seven methods: five pass and two fail, with no skips.

Passing native boundaries include actual local microphone capture retained after
recording-draft revocation; visible saved-recording playback start and stop on
leaving; saved audio/transcript across Activity recreation and owned undo; expired
deletion refusing restore/play; purge refusing a foreign operation/wrong note or
live asset, then erasing owned audio/transcript idempotently; and retired deletion
operations refusing to re-delete restored audio after reload. Synthetic WAVs and
manually supplied transcript text are clearly separate from ASR. Native MediaPlayer
start is not physical audible-output acceptance.

The offline Notes UI and selected-text dictation methods both fail waiting for
Record without transcription, before their capture/transcript/cursor assertions.
Source inspection confirms production `selectVoiceRoute()` returns Cloud while
only test-mocks may explicitly select device/manual; chat destinations directly
select Cloud in the adapter. The legacy manual-path tests are retained as failed
observations, not rewritten into development-only passes. They do not establish
that the approved local-transcription UI exists or that cursor insertion works.
The missing production local route must be implemented and its actual updated UI
qualified, including signed-out operation, permission denial/revoke, cancellation,
no speech egress, and distinct dictation versus ongoing conversation behavior.

Raw per-method logs, APK hashes and boot metadata are retained under
`test-results/full-product-audit/cuttlefish-note-audio157/results.json`.
Users 14 and 15 were removed and the owner restored. Exact fixture cleanup is
backstopped by removal of those disposable users. No real account or provider
request was used; current-source release and physical speech remain unqualified.

Validation: full source verification passed 819 tests, zero failures and four TODOs,
including the production bundle audit. These source checks do not override the
four installed UI failures across the two variants. Native APK bytes were unchanged
and reused from the previously built, hash-verified two-variant archive.

## October 13 latest-main merge and installed regression campaign

Merged main `f348e03c8` at `171e79885`, preserving the native speech drain fix
`c09b3b89a`. Resolved the accessibility overlap using Android's system shade while
keeping the screen-reader stand-in bound through all traversal checks. Corrected
new ContactsCatalog/PhotosLibrary runner entries to use disposable secondary users.
Main's browser navigation fixture omitted newly required UI-commit and native-selection
callbacks; `08abbe31c` supplies these, checks their ordering before navigation, and
makes unexpected reported errors fail the fixture rather than disappear.

`verify-merge-f348-retry.log`: `npm run verify` passed, 975 tests passed, zero failed,
four TODOs; production bundle audit passed. The first run's browser harness failure
is retained in `verify-merge-f348.log`. Strict `npm run android:build` stopped at the
missing speech AAR. `developer-apks-merge-f348` archives standalone/launcher debug,
unsigned release and instrumentation APKs built at `08abbe31c`; both packaging
variants passed build verification. They omit the resident payload and use the
unqualified speech candidate. Qualified ARM64 speech/embedding host and signing
remain separate gates. Source inputs were restored after the build.

The owned secure-camera Cuttlefish fixture was restarted after a host interruption;
its boot digest remains `dac3ff7f7138c93daaa14c9e9724588c96d6bf1c964f6787c4d1127280e1968a`
and WebView is `157.0.8083.0`. Initial campaign admission correctly refused the locked
screen. `cuttlefish-merge-f348-retry` then produced **partial standalone evidence**:

- PhotoLibrary reached the final visible “Device library / Full access” assertion
  and failed there. Earlier native scope, 60-row pagination/uniqueness, stable IDs,
  literal search, inspect/revision, changed/deleted record and refresh checks passed.
  This is not a passing Photos flow or foreign-UID/selected-permission acceptance.
- BrowserInstalledResolver passed its one installed-handler visibility test.
- SystemShade passed all three methods, including ordinary-APK refusal and actual
  Android shade interaction. This is standalone evidence only in this campaign.
- ImageCapabilities passed native denial/role/handoff checks but its developer-query
  navigation method failed with a dispatched WebView evaluation timeout. No proof
  of telephony execution or image admission is implied.
- Secondary-user setup then crashed the guest system process. The SyncManager
  USER_UNLOCKED receiver could not create `/data/system_ce/10/accounts_ce.db`;
  permission-controller initialization also failed with a missing path, followed
  by zygote termination. ContactsCatalog/PhotosLibrary were not executed and the
  launcher variant was not reached. The runner's final WebView evidence read failed,
  so no successful campaign summary exists. Preserve the raw class reports and
  `merge-f348-guest-crash.log`, not a fabricated aggregate pass.

Recovery removed the exact campaign user 10 and both campaign APK packages; owner 0
and the unchanged image overlays remained. A follow-up owner-only campaign was
refused while owner 0 was still BOOTING after the framework crash. A full guest
reboot was requested to recover the fixture before any further campaign. These
platform failures are distinct from application assertions and current-source
AOSP/Pixel qualification. The full-product goal remains open.


## October 13 fresh-guest recovery and completed new-feature checks

The previous fixture's secondary-user failure reproduced after a full reboot:
`cuttlefish-merge-provider-recovery` again encountered missing credential-encrypted
user directories and a framework crash before either requested class executed.
That guest was stopped with `stop_cvd --clear_instance_dirs=false`; its disks, user
recovery record and logs are preserved in `alphaphone-audit-secure-camera-cuttlefish`.
The original failed campaign is not relabeled as passing.

Created a separate owned container `alphaphone-audit-merge-cuttlefish`, instance 13,
ADB `127.0.0.1:6532`, using the same historical secure-camera v2 images read-only,
with fresh encrypted userdata. It booted to RUNNING_UNLOCKED, WebView 157 and the
same image digest. `merge-fresh-cvd-boot.json` records its identity. This is fresh
fixture recovery, not a current-source AOSP build or a fix to Android's storage bug.

At `783d0bbdf`, ImageCapabilities now dispatches each query navigation once and uses
the existing navigation-aware StartupDocumentProbe before reading the new page.
The old evaluation crossed document replacement and could lose its callback.
Photos now opens Albums before checking the Device library tile; `af7463bda` selects
the icon-only Albums button by its accessible label rather than nonexistent text.
No Photos product behavior or capability gate was weakened to pass the test.

`cuttlefish-photos-albums-fresh/results.json`, using archived
`developer-apks-photos-albums`, records 18 passing methods and two Photos fixture
failures across both variants. Both temporary users (10 and 11) were removed and
owner 0 restored. In each variant:

- ContactsCatalog: two methods pass bounded/literal provider search, exact identity
  and revision review, and invalid/stale refusal on synthetic contacts. This does
  not prove the production AOSP editor or a live account sync.
- PhotosLibrary: one method passes real provider-generation change detection before
  observer delivery, including stale page/cursor refusal.
- ImageCapabilities: two methods pass ordinary-APK native role/tool/editor denial
  without Android action dispatch and refusal of developer-query entry routes.
- BrowserInstalledResolver: one method passes installed generic HTTPS-handler
  visibility; it does not launch a website or external app.
- SystemShade: three methods pass outcome mapping, flavor-specific permission and
  actual shade behavior, including launcher interaction and standalone refusal.

`cuttlefish-photos-accessible-tab/results.json`, using archived
`developer-apks-photos-accessible-tab` at `af7463bda`, then passes PhotoLibrary's one
method in each variant. It checks full grant scope, 60 synthetic images paged without
duplicate/missing identities, stable IDs, literal search, thumbnail/inspect revision,
changed/deleted record detection, refresh requirement and the visible Albums > Device
library / Full access disclosure. Fixtures are created and cleaned by the app UID;
this does not establish separate-UID foreign-media visibility, selected-only grants,
revocation/process death, secure-folder boundaries or real-agent image selection.
Both campaign packages were removed. Do not collapse the two exact APK cohorts into
a single run or erase the intermediate failures.

`verify-photos-accessible-tab.log`: full `npm run verify` passes (975 passes, zero
failures, four TODOs), including production bundle audit. Both developer packaging
variants and their instrumentation APKs build and pass archive checks. Their
resident payload remains absent, speech candidate unqualified and releases unsigned.
The refreshed ignored inventories are `native-inventory-merge-f348.json` and
`interaction-inventory-merge-f348.json`; lexical candidate counts remain explicitly
unreviewed. Production local speech routing, real resident startup/Cloud login/
Cerebras, P-11 voice latency, image/physical/OTA and remaining view/flow gates are open.

## October 13 production local selection and actual Notes voice acceptance

`22fadc83d` changes the shared production speech selector from Cloud to device.
Account presence, legacy disclosed Cloud preferences and a requested agent fallback
cannot override it; explicit manual recording remains available without an account
or speech engine. New production Cloud preference writes are refused without erasing
retained data. Notes dictation/transcription and message read-aloud consumers now use
local speech. This is a partial migration: ongoing conversation and direct Cloud
speech calls from Maps, workflow speech and reviewed agent speech still need changes.

The renderer contract exercises actual selection/Notes adapter sources over synthetic
ports: local transcription without uploads, edited transcript retention after failed
persistence, exact selected-text replacement without changing note kind/pinning,
signed-out manual recording and no automatic chat send. Message reply tests now
expect device execution. These are contract checks, not microphone/ASR evidence.
The first full run retained two tests expecting the superseded Cloud route; corrected
contracts and the passing retry are archived, not treated as provider failures.

Added an installed method to VoiceNoteReadAloud that creates a synthetic note through
real Notes controls, invokes Read aloud, observes the real native synthesis/playback
and acknowledged cancel/stop calls, then stops a longer passage with the visible
Stop reading control. The observation wrapper delegates native calls unchanged;
it does not synthesize their result or invoke speech directly. It asserts no Cloud
speech method was called and no active network throughout. The original direct
bridge method remains separate in that class.

`cuttlefish-local-notes-reading/results.json` passes both methods in both variants
using `developer-apks-local-selection` at `22fadc83d`. `offline-network.json` proves
radio/network isolation and restoration. `cuttlefish-local-selection-note-audio`
passes all seven NoteAudio methods per variant with no skips: actual capture/retained
playback, recreation, deletion/Undo/purge ownership and late-operation fencing,
manual selected-text replacement/caret/recreation, and manually transcribed audio
saved and replayed from the signed-out Notes UI. The last two formerly failed before
the local-selection change. This separate NoteAudio campaign uses the app's offline
selection but does not disable guest networking; it is not a network-egress proof.
Its temporary users 12/13 and both APK packages were removed, with owner 0 restored.

The cleanup audit found an additional failure path: Notes read-aloud returned a
settled failure without retaining an unconfirmed native drain. A fault-injected
actual-renderer-source test failed before the fix (`note-cleanup-fault-before.log`).
`80050eeca` retains that rejected cleanup barrier, so subsequent note and message
speech cannot start; the test then passes. Native fault injection is not claimed.
Normal installed playback/Stop was repeated on the rebuilt
`developer-apks-note-drain-barrier` archive at `022c20004`:
`cuttlefish-note-drain-barrier/results.json` again passes two methods per variant,
with offline state observed and network restoration confirmed.

`verify-note-cleanup-barrier.log`: full verification passes with 977 tests, zero
failures and four TODOs; production bundle audit passes. Both developer distribution
variants and their instrumentation APKs build and pass archive checks. These retain
the unqualified x86_64/ARM64 speech candidate, omit the resident payload and have
unsigned releases. They are not release artifacts. Speech recognition accuracy,
physical speakers/microphone/Bluetooth, ARM64 functional qualification, streaming/
barge-in, all production speech paths and P-11 end-to-end latency remain unproved.

## October 13 shared app speech migration

Maps guidance, workflow read-aloud and reviewed agent speech now call the same
local speech adapter. It requires local models and device execution on Android,
without a Cloud sign-in, billing request or speech fallback. Account and foreground
changes still cancel owned playback. Queued requests wait for confirmed native
cleanup; an unconfirmed cleanup failure prevents subsequent requests from starting.

`test/device-speech.test.mjs` exercises the actual adapter with synthetic native
ports: signed-out operation, missing models/plugin, background/lock refusal, owner
change, queued cancellation and failed cleanup. Together with the native drain
contract tests, all 11 focused tests pass (`device-speech-focused.log` under
`test-results/full-product-audit`). This is source-level behavior evidence, not
installed Maps/workflow/agent end-to-end or physical speaker acceptance.

Ongoing voice conversation still directly selects Cloud capture/transcription and
synthesis. Its local migration, barge-in and measured speech-to-audio latency remain
open. Earlier entries record the state before this migration.

Validation at source `d1d3e1aed`:

- `npm run verify` passes: 987 tests, 983 pass, zero failures and four TODOs;
  production web distribution audit passes (`verify-device-speech.log`).
- Both standalone and launcher debug/release-unsigned APKs and test APKs build
  in `developer-apks-device-speech`. The qualification record explicitly retains
  `developerOnly: true`, `residentPayloadPackaged: false` and
  `speechCandidateQualified: false`. Its dirty flag reflects the temporary speech
  manifest substitution; the application source fingerprint is the empty diff.
- `cuttlefish-device-speech-regression/results.json` records both installed
  `VoiceNoteReadAloud` methods passing in each variant, zero failures/skips,
  production test-mocks flag off. This regression checks actual Notes read-aloud
  completion/Stop plus the direct native playback test, not the newly migrated
  Maps/workflow/agent interaction paths.
- The owned SDK 37 x86_64 Cuttlefish guest used the previously recorded historical
  image (boot digest `dac3ff7f7138c93daaa14c9e9724588c96d6bf1c964f6787c4d1127280e1968a`).
  `offline-network.json` confirms offline observation and restored network state.
  These receipts do not qualify ARM64, a current-source full image, physical audio,
  resident agent execution, real login/Cerebras or P-11 latency.

## October 13 ongoing conversation local speech migration

Explicit Start voice conversation now selects the local recorder/transcription
port and local reply playback. The native recorder receives a 29-second cap to
fit the current local decoder. Pausing after speech still automatically sends the
transcript through the existing owner-bound agent turn, and the matching reply
plays before capture resumes. Missing local models stop the operation; there is no
production conversation speech fallback to Cloud. The explicit Cartesia development
branch remains separately gated. Text inference remains the resident agent's service
responsibility; local speech alone does not establish resident/Cloud connectivity.

Six tests in `test/local-conversation-flow.test.mjs` load the actual renderer and
authenticated prepared batch-conversation engine with synthetic microphone, local
ASR/TTS and agent ports. They prove automatic turn submission/local reply routing
without a Cloud speech account, missing-model refusal, cancellation and owner change
during transcription, invalid recording-metrics refusal, and waiting for speaker
cleanup before the next capture. They do not prove microphone quality, installed
continuous voice, actual agent inference, network egress or physical audio timing.

The current batch engine deliberately keeps the microphone off during playback.
True barge-in, semantic turn completion and the required P-11 measured latency
acceptance remain incomplete. Its existing post-playback rearm delay is retained;
no latency improvement is claimed from synthetic timer tests. The earlier entries
listing a direct Cloud conversation speech route are historical.

Validation at source `1143f0acb`:

- `verify-local-conversation.log`: full `npm run verify` passes, 993 tests total,
  989 passed, zero failures, four TODOs; production bundle checks pass.
- `developer-apks-local-conversation` contains both variants' debug and unsigned
  release APKs plus instrumentation. As before, this is an explicitly unqualified
  speech candidate without the resident payload; release acceptance is not implied.
- `cuttlefish-local-conversation-recorder/results.json`: one native recording-limit
  test passes per variant, zero skips. The native timer fires without renderer
  timers, and the full decoded recording is between 27 and 30 seconds without
  truncation. This is a direct native capture/decoder test, not a renderer voice
  conversation or ASR quality test.
- Disposable users 14 and 15 were removed and owner 0 restored, as recorded in
  each variant's `secondary-user.json`. The image remains the historical SDK 37
  x86_64 fixture. No personal devices or real Cloud accounts were used.

## October 13 signed-out local microphone denial acceptance

The installed `VoicePermissionDenied` test still encoded the retired requirement
that production voice must first sign in to Cloud. It now uses the actual production
activity with no fixture transport, selects recording without transcription while
signed out, and exercises the native permission denial and recovery controls.
Manual recording isolates the permission flow from model readiness; this does not
establish local ASR or ongoing conversation acceptance.

At source `539bd2bbd`, `verify-local-voice-denial.log` records 989 passing tests,
zero failures and four TODOs (993 total), with production distribution checks passing.
Both APK variants build in `developer-apks-local-voice-denial`, retaining the same
developer-only, unqualified speech and absent resident-payload limitations.

`cuttlefish-local-voice-denial/results.json` records one installed method passing
for each variant, zero skips. The assertions cover denied guidance, Open app settings,
Back to Alpha, available typing, permission remaining denied, no raw recording file,
and zero Cloud speech method calls. The guest had networking available; the latter
is a bridge-method observation, not a packet-level egress proof. Fresh users 16 and
17 were removed and owner 0 restored; application/test packages were removed.

This corrected an obsolete test before attempting continuous conversation coverage.
A complete installed local-conversation test still needs controlled agent transport
and microphone input. No real login/Cerebras, physical audio, barge-in, latency or
current-source full AOSP acceptance is implied by this permission test.

## October 13 installed local conversation capture lifecycle

`LocalConversationLifecycleInstrumentedTest` now drives the installed production
renderer's Talk and Stop voice conversation controls. Its test-APK-only activity
substitutes a closed synthetic Cloud identity and resident identity/history protocol.
The fixture explicitly rejects inference; the production speech plugins, local
model readiness and native capture are unchanged. This fixture is not evidence of
real login, resident execution, Cloud inference or Cerebras.

The initial campaign (`cuttlefish-conversation-lifecycle`) failed both variants
after fixture sign-in because a startup-access helper searched for the exact
MainActivity class instead of the fixture subclass. That failure is retained.
After evaluating startup access in the fixture WebView, the campaign at source
`49b6af201` (`cuttlefish-conversation-lifecycle-activity/results.json`) passes one
method per variant, zero skips. Talk starts real local capture with the reported
29-second cap; the actual UI identifies local transcription; Stop closes the voice
UI and leaves no capture file. No Cloud speech bridge call or inference dispatch
was observed. This is Start/capture/Stop acceptance, not an utterance, ASR, auto-send,
reply playback, barge-in or end-to-end latency acceptance.

Full verification at `c4c784ac5` passed 989 tests, zero failures, four TODOs (993
total), including production bundle checks. The subsequent change only corrected
the Java fixture's startup-access evaluation; both distribution variants rebuilt
successfully in `developer-apks-conversation-lifecycle-activity`. Developer-only
speech-candidate and absent resident-payload limitations remain unchanged.

Disposable users 20/21 were removed and owner 0 restored; target app and test
packages were removed. The guest is still the historical x86_64 SDK 37 image.
A full installed conversation needs controlled speech input and an inference
transport, followed separately by the real Cloud/Cerebras acceptance environment.

## October 13 controlled Cuttlefish microphone input

The owned guest already runs WebRTC and exposes a VirtIO capture device. The new
`scripts/test-cuttlefish-microphone.mjs` drives its microphone control from a fresh
headless Chromium instance configured exclusively with the prerecorded speech
fixture. It never requests the host's physical microphone. The probe acquires the
shared Android device lease and checks the Docker-bound ADB port, exact image,
Cuttlefish hardware, configured WebRTC device and guest serial before capture.
It requires an explicit owned-device flag and a new output directory.

The stricter run (`test-results/full-product-audit/cvd-microphone-bound/result.json`)
records 10.069 seconds of actual guest ALSA/VirtIO capture at mono 48 kHz PCM16.
Its first three seconds of fixture audio match the captured amplitude envelope at
0.96598 correlation, above the probe's 0.85 threshold, with an offset of 5.21 seconds.
The browser loops the 6.625-second known fixture; the initial delayed connection
means the entire passage does not necessarily fit inside this ten-second capture.
That is why the probe checks a specified three-second segment, not a complete
passage or merely non-silent bytes. Fixture and capture hashes are retained.

The microphone was released, browser closed and exact temporary guest file removed.
This establishes a reusable controlled virtual microphone input without replacing
the application's recorder. It does not prove MediaRecorder recognition, ASR,
automatic sending, reply playback, physical sound, barge-in or latency. Next, join
this input with the installed conversation fixture and a clearly synthetic reply
transport; real Cloud/Cerebras remains a separate acceptance gate.

`verify-cvd-microphone.log` records full verification passing: 989 tests passed,
zero failures, four TODOs (993 total), with production bundle checks passing.
The required strict `npm run android:build` attempt is retained in
`cvd-microphone-strict-android-build.log`: it refuses the absent qualified speech
AAR before building. No application/native source changed in this microphone-probe
turn, and no new APK or release qualification is claimed.

## October 13 installed utterance integration and recorder stall

Added `LocalConversationUtteranceInstrumentedTest` and a closed synthetic reply
protocol to the test APK. The production renderer, MediaRecorder, local ASR, local
TTS and playback remain real. The test requires the known fixture word `nightfall`,
exactly one automatic VOICE_DM send, one local synthesis/playback completion,
rearmed capture, and Stop cleanup. No real resident runtime, Cloud sign-in or
Cerebras inference is exercised by the synthetic identity/history/reply transport.

The new `scripts/test-cuttlefish-voice-conversation.mjs` coordinates the normal
instrumentation runner and prerecorded WebRTC input under one device lease. A
worker keeps synchronous ADB instrumentation from blocking the browser controller.
It verifies container/ADB/WebRTC identity and uses a fresh fake-audio-only Chromium
process per capture-ready marker. Input hashes and start/stop/close timestamps are
recorded beside instrumentation receipts. The current controller pads the known
WAV with three seconds of leading and four seconds of trailing silence and waits
for the Cuttlefish microphone control to enable and acknowledge input.

Evidence and failures are deliberately separate:

- `cuttlefish-conversation-utterance`: standalone passes the complete controlled
  utterance; launcher reaches transcription/send/reply playback but fails the
  known-word assertion. The ad hoc feeder reused one browser input cursor.
- `cuttlefish-conversation-utterance-coordinated`: both variants reach the turn
  but fail recognition of the expected word. Recorded transcripts show clipped
  or misrecognized speech. The assertion was not weakened.
- `cuttlefish-conversation-utterance-padded`: launcher passes; standalone receives
  no recognized speech and repeatedly cycles capture. This exposed a feeder race:
  a visible microphone button can still be disabled before connection completes.
- `cuttlefish-conversation-utterance-ready`: after waiting for control readiness,
  standalone stalls and the campaign stops before launcher. The retained Java
  main-thread stack is in `MediaRecorder.stop()` via
  `AlphaCloudVoiceCapture.stopAutomatically()` at the native recording deadline.
  Main lifecycle commands cannot dispatch. Capture operations must be moved off
  the UI thread with explicit pending/failed cleanup ownership; simply timing out
  and admitting a new recorder would be unsafe and would not fix this failure.

There is no stable both-variant passing aggregate yet. Separate successful methods
are not acceptance for repeatable continuous conversation, physical sound, general
ASR quality, barge-in or P-11 latency.

The last campaign initially could not confirm removal of disposable user 28.
`conversation-utterance-user28-recovery2.json` records force-stop, stopped/removed
user 28, then readback showing only owner 0 and no app/test package even with `-u`.
Subsequent uninstall attempts returned DELETE_FAILED_INTERNAL_ERROR because those
packages had already disappeared with the removed user; the original failure
receipt is preserved. No new campaign was started over uncertain cleanup.

`verify-conversation-utterance.log` initially caught missing class-local opt-in
declarations after helper extraction. The corrected full verification runs
`verify-conversation-utterance-gated.log` and `verify-conversation-coordinator.log`
pass 989 tests, zero failures, four TODOs, with production bundle checks passing.
Both APK variants were built in `developer-apks-conversation-utterance-coordinated`
at `7dea90705`; later changes are host input coordination only. Developer-only
unqualified speech and absent resident-payload limits still apply.


## Latest-main integration and recorder-thread repair (October 13 continuation)

The requested pull fetched and merged `origin/main` at `8aa3e3e82` into this
isolated audit branch (`058022f30`). The original product checkout was not changed.
The merge includes the upstream Gmail/Calendar, subscription, Photos, Notes and
native voice-latency work. Conflict resolution retains production on-device speech,
explicit manual recording, automatic ongoing voice sending, and route-specific
legacy diagnostics. New native audio-boundary aggregation remains separate from
legacy renderer timing; a synthetic parser pass is not real latency acceptance.
The upstream issue audit is a main-branch snapshot, not a replacement for the
additional implementation and exact-artifact evidence recorded here.

The merge exposed a Clock verifier call that omitted the newly required expected
image fingerprint. `22097db0f` supplies the pinned expectation and updates the
system-package fixture. All 14 launcher-verifier tests pass. The focused speech
routing/native and legacy latency tests pass all 16 cases. After installing the
updated lockfile dependencies (including DOMPurify), full `npm run verify` passes
1,053 tests, zero failures, four TODOs, plus the production bundle audit
(`verify-merge-oct14-final.log`). Earlier missing-dependency and Clock-failure logs
are retained; they are not reported as passing runs.

`be8d941b9` addresses the observed Android main-thread stall in MediaRecorder.stop:
native capture operations and deadlines now run on one process-wide serial capture
thread. A replacement activity cannot overtake blocked cleanup or remove its
pending draft. Start rechecks cancellation after native start; cancellation still
waits for native capture cleanup and the speech-worker barrier before confirming.
A hung native recorder can still block the capture queue; this repair preserves UI
responsiveness and refuses premature admission rather than proving recovery of
Android's audio service.

Strict `npm run android:build` still fails preflight for the absent qualified speech
AAR (`strict-android-merge-oct14.log`). The separate developer build at `22097db0f`
succeeded for standalone and launcher debug/unsigned-release APKs and both test
APKs (`developer-apks-capture-thread-merged`). Its temporary packaging inputs were
restored. Its speech runtime remains unqualified and resident payload absent.
The wrapper initially refused changed license notices; the old backup was retained
and refreshed with the verified current notices, whose added entry is DOMPurify.

On owned Cuttlefish `127.0.0.1:6532`, `cuttlefish-capture-thread-settlement` passes
all four VoiceWorkerSettlement methods on each variant. The new installed fault
test holds native Stop open and verifies main-thread responsiveness, pending-file
protection across surface construction, rejected new recording during drain,
no premature cancellation acknowledgement, and eventual file/owner cleanup.
This is controlled native fault evidence on the historical image, not a current
full-image boot, real microphone, resident agent, Cloud login or Cerebras result.


The `cuttlefish-capture-thread-regression` campaign passes the actual native
29-second recording-limit method on both variants. In NoteAudio, four storage/
deletion/recreation methods pass per variant; three UI methods fail at selecting
Notes (`actualNativeCaptureSaveAndDraftRevocationDoNotDeleteSavedAudio`,
`dictationReplacesSelectionAndKeepsTextNoteAcrossRecreation`, and
`offlineNotesUiRecordsManualTranscriptAndSavesActualAudio`). The merged production
sign-in/plan gate no longer accepts the old fixture's signed-out offline selection.
These six failures are retained, and require an account/plan-bound fixture update;
they are not reclassified as successful recorder UI tests. Disposable users were
removed and readback shows only owner 0.

The separate conversation fixture now explicitly enables a closed synthetic
subscription case: authenticated entitlement GET returns 404, authenticated billing
limits GET returns a current active Plus snapshot, and the real renderer's plan
gate must request that snapshot. No real account, grant, payment, subscription
purchase or provider request occurs. All other requests retain the fixture's
allowlist. `developer-apks-capture-thread-plan` packages this test-only update at
`e58cc5bf8`; production capture code remains the verified `22097db0f` code.


`cuttlefish-capture-thread-conversation` initially failed both variants before
recording because the new fixture loaded its static owner before assigning the run
UUID. The screenshot `conversation-plan-gate.png` shows the invalid-response gate.
`b10140e55` fixes initialization order; the rebuilt
`developer-apks-capture-thread-plan-owner` then passes actual synthetic plan
admission and reaches the real local listening UI.

The subsequent `cuttlefish-capture-thread-conversation-owner` campaign still fails
both spoken-turn assertions. Standalone reports three starts/two cancels; launcher
reports seven starts/six cancels. Both report zero transcripts, local synthesis or
playbacks and zero Cloud speech calls. Their WebViews answer the final observation,
without the prior main-thread lifecycle timeout. Both browser injection receipts
have start/stop timestamps and browserClosed=true; this proves the input attempt,
not successful guest delivery. Users 33/34 were removed and owner restored.

The separate `cvd-microphone-after-capture-thread` probe captures 10.069 seconds
through the real virtual ALSA microphone but fails fixture identity: envelope
correlation 0.466955, below the unchanged 0.85 requirement (previous admitted probe
was 0.96598). Its guest temporary capture and browser were cleaned. This currently
unqualified virtual input cannot establish local ASR correctness or failure from
the zero-transcript turns. Next work must restore/requalify the controlled input
path before repeating the spoken-turn test; it must also migrate signed-out local
UI fixtures through the new required plan gate. Native responsive-stop and
recording-limit passes do not establish barge-in, real Cloud/Cerebras, P-11 timing,
current-source full AOSP or physical acceptance.


## Preconnected virtual microphone and observed activity (October 13 continuation)

The preceding turn made concrete progress (merged source, native stop-thread repair,
installed fault/deadline evidence and preserved failures). No live build or voice
campaign remained at the start of this continuation.

The old Chromium file-capture path delivered distorted timing: separate one-second
segments of the known WAV increasingly drifted from their expected positions in
the 10-second guest capture. Disabling browser enhancement improved one probe to
0.8310 but still failed the unchanged 0.85 threshold (`cvd-microphone-unprocessed`).
Requesting mono 48 kHz did not work as requested: Chromium reported stereo 44.1 kHz,
and the correlation fell to 0.4034 (`cvd-microphone-48k`). Neither run is qualified.

`b0c90fa8d` adds observation-only native metrics/ASR counters to the installed
conversation fixture. Both developer APK variants and test APKs built in
`developer-apks-capture-metrics`, with the same unqualified-runtime/no-resident
limits as before. `cuttlefish-capture-metrics` then reports 3,414 native metric
samples, peak 0.010071, seven starts/six cancels, and zero ASR attempts/failures.
The existing activity threshold is 0.012. Thus the absence of transcription in this
run precedes ASR dispatch; it is not an observed ASR rejection. Android audio-service
readback shows the active stream not silenced and microphone mute flags false
(`capture-metrics-audio-service.txt`). No activity threshold was lowered.

`96c5be1b0` adds a shared controlled audio feed in
`scripts/lib/cuttlefish-fixture-audio.mjs`. It creates a silent WebAudio destination
stream, waits for connected WebRTC with outbound audio packets, and triggers exactly
one known PCM buffer only after the installed fixture reports capture readiness.
No host microphone or speaker is used. This removes the late peer connection and
uncontrolled looping file cursor. The coordinator excludes historical capture
markers, records start/end/settings, closes its browser and retains the device
lease throughout. The direct microphone probe also waits for capture completion
before removing its guest file.

Three consecutive raw guest microphone probes pass the unchanged first-three-second
0.85 correlation gate: 0.904633, 0.914836 and 0.958766
(`cvd-microphone-primed-pcm`, `-2`, `-3`). A separate read-only whole-fixture envelope
analysis reports 0.924717, 0.932788 and 0.970212, with capture/source hashes retained
in `primed-pcm-full-envelope.json`. These establish controlled virtual input in the
raw ALSA probe, not physical audio quality or every Android recording consumer.

`cuttlefish-conversation-primed-pcm` uses that feed against the exact diagnostic APK
archive. Standalone passes its complete installed known-utterance turn: local
transcription containing the fixture word, one automatic synthetic-agent send,
local synthesis/native playback, rearm, explicit Stop and no Cloud speech calls.
Launcher reaches the reply/rearm condition and exactly one send but recognizes
only `both`, failing the unchanged `nightfall` assertion. The aggregate therefore
fails. This is not stable two-variant voice acceptance and does not establish real
resident/Cloud/Cerebras inference. The next diagnostic needs the exact stopped
MediaRecorder audio presented to ASR on the failing launcher turn, to distinguish
recorded-input truncation/endpointing from recognition quality. No extra delayed
start or weaker transcript assertion was used to manufacture a pass.

Both disposable users were removed and the coordinator reports browserClosed=true.
Full verification at `96c5be1b0` passes 1,053 tests, zero failures, four TODOs and the
397-file production bundle audit (`verify-primed-audio.log`). The signed-out Notes
fixture migration, native speech qualification, true barge-in, P-11 actual audio
boundary trials, real login/Cerebras and current-source full AOSP/Pixel acceptance
remain open as previously recorded.
