# Legacy checkout audit — October 11, 2026

**Revision correction:** this document describes the dirty `9e3d179b` checkout,
not current main. Current main is over 1,500 commits newer and already implements
Cloud-to-resident provider binding, revised onboarding and an integrated password
manager. Current work continues in
`/home/shaw/.codex/worktrees/full-product-audit/alphaphone`. The Cloud-route and
onboarding absence findings below apply only to this legacy source. Its APK and
browser results cannot qualify current main. The Cuttlefish image was recovered
by cold container restart; user 0 is RUNNING_UNLOCKED, all fixture users removed,
and Alpha HOME was visually verified. No native app test assertions ran.


The product is not complete. This audit expands the implementation plan to include
Phone, SMS, Contacts and Wallet following the user's explicit October 11 direction.
Their existing production gates remain disabled until real implementations qualify.
The primary target is an Android-resident Eliza agent using **Eliza Cloud for
Cerebras inference**, with both standalone APK and Alpha AOSP distributions.
Direct Cerebras inference and a remotely hosted agent are different routes.

This is an active audit, not a claim that every interaction has been exercised.
Historical reports dated September/October 3 must not substitute for current-source
evidence. Source inspection starts at commit `9e3d179b`, with existing uncommitted
Android/AOSP/test changes preserved and upstream pin
`91dc19196c307eb8559b9b58de8dbf63eb47f43f`.

## Requirements reconciliation

Read together: `prd.md` AP-01–15, `implementation-plan.md` AP1–9/E1–6,
`flow-audit-and-prd.md` F01–19/J01–10, `prototype-screen-inventory.md`,
`mvp-scope-and-gap-report.md`, `mvp-completion-plan.md`, `mvp-current-status.md`,
`on-device-agent-plan.md` and original design references. The old flow implementation
table is historical: many of its "missing" features are implemented today.

* AP-04's cloud-only execution and AP7's prohibition of a runtime payload are
  superseded by the resident-agent requirement. Hosted inference remains explicit.
* AP-08 and AP-13 deferrals are now implementation backlog, not scope exclusions.
  Wallet provider/custody/payment-approval design must precede activation.
* A powered-off device cannot run its resident agent. Define remote delegation
  separately from local missed-occurrence/catch-up recovery.
* Local STT/TTS and optional Cloud voice are separate acceptance paths. Neither
  a host speech test nor a synthetic waveform proves device microphone quality.
* A booted test-key Cuttlefish image is real AOSP boot evidence, not production
  signing, physical-device compatibility, OTA rollback or user acceptance.

## Confirmed critical gaps

1. **Resident Cloud inference is not wired.** `AlphaLocalAgentPlugin.configureEnvironment`
   reads `local-agent-provider:v1`, sets `CEREBRAS_API_KEY` and forces
   `ELIZAOS_CLOUD_USE_INFERENCE=false`. The connection UI asks for a direct provider
   key. Cloud service login does not configure this route. Add native-only binding
   of a verified Cloud credential generation to resident startup, explicit model
   routing, expiry/revoke/account-switch handling, and an authenticated inference
   trace proving Cloud selected Cerebras. Never move the key into renderer state
   or equate selecting a model name with observing the serving provider.
2. **Login has no current installed-device acceptance.** Earlier ordinary website
   login and controlled CLI-session tests do not prove phone browser return,
   single-use exchange, persistence, expiry, restart or owner isolation. The
   personal dedicated-agent conductor is a separate hosting flow; local orchestration
   should not require purchasing a hosted agent just to obtain model service.
3. **Build reproduction is broken in this environment.** The initial shell lacked
   SDK/JDK configuration. After supplying the installed toolchain, the default
   prepared runtime failed because its interrupted checkout has no HEAD. Preserve
   it, prepare a fresh authenticated source directory, then build and inspect both
   debug/release variants. Never relabel an old APK as the current build.
4. **Cuttlefish test admission is missing.** Most runners accept only `emulator-N`;
   some Java tests accept only ranchu/sdk/generic. Add explicit Cuttlefish admission
   and isolated fixture ownership, then qualify every opt-in suite. A default run
   with assumption skips must not be reported as testing everything.
5. **Performance acceptance is absent.** Record cold/warm startup, login return,
   TTFT, tokens/sec, STT latency, TTS first audio, end-of-speech to first audible
   response, action/readback latency, memory and thermal/Doze behavior. The prior
   six-second simple-query target needs measured device results. Report sample
   counts, p50/p95, model/route, network and failures; optimize measured bottlenecks.

## Every domain: implementation and remaining work

| Requirement / views | Present implementation | Missing behavior or qualification to close |
| --- | --- | --- |
| F01 setup, boot, lock, HOME | Standalone/launcher packaging, connection chooser, native secure store | First-run permission/role walkthrough; Cloud-to-resident setup; real login/revoke/restart; secure lock behavior; upgrade/data migration; recovery launcher and ownership diagnostics |
| F02 Home, library, search, ongoing activities | Branded home, real app discovery, context cards, native handoff | Current source add/remove/work-profile app inventory; genuine agenda/attention freshness; ongoing task return; long labels, empty/stale/loading/error states; repeated physical HOME/Back |
| F03 assistant pill/input/sheet/full | Streaming, owned context, proposals, cancellation, durable receipts | Installed resident process/IPC evidence; Cloud inference; full cross-view context and missing-detail clarification; offline/network loss/process death; exactly-once results; real voice/keyboard continuity |
| F04 Phone / keypad / recents / voicemail / incoming / in-call | Deferred production entry, native handoff and development simulation | Default dialer/InCallService/Telecom adapter; genuine call state/history; multi-number choice; permission/role denial; emergency system routing; hold/mute/speaker/DTMF; call screening/voicemail provider; incoming/background/headset/device telecom acceptance |
| F05 Messages / threads / new / attachments | Deferred production entry, SMS handoff and simulator | Default SMS role/provider; real incoming/outgoing thread data; recipient disambiguation; SMS/MMS delivery/failure receipts; multipart/Unicode/attachments; draft persistence; revoke/role loss; no resend after ambiguous delivery; owned endpoint tests |
| F06 Inbox / folders / thread / compose / attachments | Cloud grant adapter, local encrypted drafts, provider controls, receipt recovery | Real Gmail OAuth/read/search/page/attachment/draft/reply/forward/send/archive/trash/undo; account switch/revoke; ambiguous send reconciliation; correct From/Bcc/reply-all; provider retention and scope consent. Telegram/Discord need separate adapters/requirements |
| F07 Calendar / day / month / event / invite / create/edit | Native calendar/provider integration, local editing, reviewed CRUD and receipts | Actual image provider readback; recurring instance versus series; DST/timezone/all-day; read-only/revoked calendars; invitation/RSVP and account sync; meeting links; concurrent edits; unknown create/delete outcome |
| F08 Browser / address / tabs / bookmarks / history / reading | Isolated WebView, tabs, navigation, selected reading and local speech route | Maintained signed provider on exact image; upload/download/popups/deep links; same/cross-origin stale-state tests; genuine model summary; observation/action/submit boundary; booking remains unsupported until real reviewed actuation and outcome reconciliation exist |
| F09 Password setup / autofill / passkeys | Provider setup/status and native settings handoff | Distributable provider and release signer authorization; actual vault unlock/fill/save/passkey create/use; wrong-origin/cancel/recovery/rotation; secret exclusion in context/logs; user-controlled provider enablement |
| F10 Camera / photo / video / scan / capture review | Native preview/capture/catalog, video, OCR/edit/review/PDF paths | Current Cuttlefish capture/retake/save/readback; permission denial/revoke; rotation/background/process death/low storage; OCR language/accuracy; reviewed image analysis; physical optics/flash/focus and secure lock camera |
| F11 Photos / library / albums / search / viewer / editor / trash | Selected media, owned albums/favorites, batch actions, copy edits, trash/restore | Actual provider grants/revocation; selected-only versus broad access; large catalogs; video editing where required; semantic/person search requires real index/consent; exact shared bytes; external delete/restore semantics |
| F12 Notes / editor / checklist / recording / transcript | Encrypted Android notes, browser local store, voice attachments, import/export, reviewed mutations | Installed restart/migration/storage failure; cursor dictation versus retained audio; native ASR/TTS/correction and task extraction; audio/text separate deletion; sync/conflict/backup if required; large records and low storage |
| F13 Reminders / schedule / completed / detail / Clock | Local scheduler, recurrence, snooze/completion, notification routing; reviewed Clock handoff | Actual fire/tap/complete and reboot/Doze/force-stop/time changes; notification/channel denied; missed occurrence policy; actual alarm ringing/snooze/dismiss distinct from reminders; geofencing if added |
| F14 Shade / attention / notifications | Own notices, listener controls, owner/object-bound taps and recovery | Listener consent and selected apps on image; secure notification filtering; cold/warm/kill/reboot tap once; stale/deleted/wrong-owner targets; DND/lock-screen; non-GMS remote delivery strategy |
| F15 Workflows / library / Describe / editor / review / run / history / digests | Typed authoring, approvals, durable execution state and embedded worker packaging | Current native real worker execution (historical SIGSYS must be retested); triggers/overlap/version/disable/cancel; provider sources; unknown outcomes; schedules in Doze/reboot; two actual digest loops; remote delegation while device off if retained |
| F16 Files / folder / search / selection / document preview | SAF selected files/trees, import/export, preview, rename/move/share, sandboxed content | Real DocumentsUI and remote providers; persisted grant/revoke/offline; collisions/Unicode/large files; exact bytes; rename/move/delete recovery; process death; provider semantics and low storage |
| F17 Contacts / list / detail / edit / picker | Deferred production entry; native read/create adapter exists | Restore only with real provider controls; exact readback/edit/delete/favorites; duplicate/multiple-field selection; read-only accounts; permission revoke; contact changed/deleted during cross-app work; Phone/SMS integration |
| F18 Settings and all subpanels | Connection, voice, appearance, permissions, provider setup, system settings | Every preference restart/readback; account/source scopes; native return; actual diagnostics export/redaction; precise local/provider delete boundaries; updater/signature/version/rollback status; TalkBack and keyboard traversal |
| F19 Wallet / cards / passes / payment / recovery | Production deferred; prototype/development states only | Decide native-wallet handoff versus owned wallet; payment/custody provider; secure key/credential boundary; token provisioning; biometric transaction-specific approval; NFC/HCE policy; device attestation if claimed; receipts/reversal/unknown outcome; loss/recovery and sandbox qualification before real transactions |
| Maps / search / place / route / navigation / saved | Regional map/router, saved places, navigation/voice contracts | Production TLS/data coverage/license/update plan; real GPS/background permission; reroute/offline/arrival; supported travel modes; voice/audio focus; physical driving/walking accuracy; explicit unsupported regions |

## Cross-app and interaction completion

J01 camera→OCR→calendar, J02 recording→transcript→reminder→notification,
J03 email attachment→Files→summary→Notes, J04 calendar→Maps→return,
J05 Browser→reviewed summary→Notes, J06 photo→recipient→share,
J07 mail→workflow→durable receipt, J08 provider unlock→Browser→sanitized agent,
J09 offline edit→reconnect without spontaneous sends, and J10 account switch→reject
late results each need a continuous installed-device run with source-object and
receipt identity checks. Single component passes do not close these journeys.

For every root view, subview, dialog and control: check happy path, empty/loading/
error/unavailable state, denial and revocation, Cancel/Back/Home/background,
double activation, stale result, process restart, light/dark, keyboard, 150% text,
rotation and TalkBack. Inventory template, JSX and native actions separately;
dynamic/repeated controls must be reviewed at runtime. Run
`node scripts/inventory-interactions.mjs OUTPUT.json` to create a source-hashed
static queue. Its entries deliberately start **unreviewed**.

## Automated execution and delivery order

1. Reproduce source and both APK variants; retain hashes and complete logs.
2. Inventory the installed Cuttlefish image and use secondary users for native
   tests. `ANDROID_SERIAL=127.0.0.1:6520 node scripts/cuttlefish-audit.mjs OUTPUT --run`
   starts the shell/all-enabled-view baseline with separate skip accounting and
   restores the original user. Omit `--run` for read-only image/APK/WebView identity.
3. Extend per-domain native campaigns to Cuttlefish and qualify fixtures, permissions,
   lifecycle and cleanup; do not weaken physical-device admission indiscriminately.
4. Bind normal Cloud sign-in to resident inference; prove native process location,
   credential isolation, Cloud route and actual Cerebras provider with harmless
   test prompts. Test revoke/account switch before adding provider writes.
5. Qualify local and Cloud voice separately, then all native applications and J01–10.
6. Implement newly included telecom/contact/wallet capabilities behind truthful
   capability gates; use controlled providers and owned test recipients.
7. Measure and optimize latency, then device battery/thermal/accessibility/soak.
8. Reproduce signed AOSP image with runtime, speech models, required system apps,
   maintained WebView, default-role provisioning and recovery; qualify clean boot,
   update/rollback and physical target hardware. Complete user task acceptance.

Image release additionally needs exact SKU/source/kernel/blob/firmware locks,
SELinux policy, AVB keys/rollback indexes, OTA signing and interruption recovery,
camera/audio/GPS/Bluetooth/Wi-Fi/modem/NFC/sensors, emergency facilities, secure
lock, encryption, licensing/model redistribution, diagnostics and support ownership.
No emulator test establishes these physical or operational properties.

## Current campaign evidence

Logs live under `test-results/completion-audit/`. The initial `npm run verify`
passes 225 tests, TypeScript and web build. With a freshly prepared pinned source
directory, `npm run android:build` passes both standalone/launcher debug and
unsigned release builds, instrumentation APK builds, lint and APK inspection.
The 1,332-case browser campaign is ongoing. Five early tests timed out; four
pass on a focused rerun, while Camera persistence still times out. Host load is
high, so this is not yet attributed to a Camera implementation defect.

The initial connected image was Alpha `userdebug/test-keys`, x86_64, `cutf_cvm`,
boot complete, using WebView 145.0.7632.218. The runner records installed APK
hashes, not an assumed match to this checkout. The native campaign has **not run
app assertions**: user creation first timed out; a subsequent secondary-user
switch/cleanup was followed by `system_server` failure opening
`/data/system_ce/11/accounts_ce.db` and media provider storage. The failure could
involve asynchronous fixture teardown and requires isolation before attributing
it solely to the image. Fixture users were subsequently removed; emulator
recovery is in progress. Preserve `cuttlefish-system-crash.txt` and failed run
reports. Added preflight requires the foreground user to be fully unlocked;
cleanup waits for foreground restoration and checks unique fixture ownership.

The static source-hashed interaction queue currently contains 1,131 lexical
candidates across 207 renderer files. These are **unreviewed candidates**, not
1,131 passing actions; native intents and dynamic/repeated controls require
additional enumeration and runtime review.
Live Cloud login, Cloud-routed Cerebras, native real speech and physical acceptance
remain unverified. This document must be updated from terminal evidence as work proceeds.
