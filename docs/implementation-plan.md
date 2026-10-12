# Alpha Phone implementation plan

Updated 2026-10-12 from the owner's answers to all 32 decision issues. This is the
active implementation plan; conflicting older plans are historical. Approved policy
is in [decisions](decisions.md#october-12-owner-decisions); every concrete TODO,
owner area and dependency is in the [32-issue backlog](owner-approved-mvp-plan-2026-10-12.md).
Approval is not implementation or acceptance. [Verification](verification.md) and
[current status](mvp-current-status.md) retain source-bound evidence and failures.

## Product contract

- Agent execution, history, orchestration, approvals and scheduling are local.
  No hosted agents, dedicated-agent purchases, pairing or remote fallback.
  Schedules only run while the phone is powered on; Doze is a separate constraint.
- Eliza Cloud supplies authenticated text inference, subscription entitlements,
  Gmail integration and shared Maps APIs. Cloud services do not host the agent.
- STT/TTS always run on device through the Android bridge to Eliza's native
  inference/llama.cpp build. Dictation inserts editable text on Stop; voice
  assistant auto-submits at semantic/long-gap endpoints and supports barge-in.
- Pixel 10a / Android 17 is the target. Standalone APK and Alpha AOSP image are
  distinct delivery surfaces; both standalone/launcher packaging variants remain
  qualified. A launcher APK installed elsewhere is not automatically Alpha AOSP.
- Phone, Contacts and SMS/MMS appear only on the Alpha AOSP image. Gmail is in both
  distributions. Wallet is outside MVP. Passkeys, Telegram and Discord are deferred.
- Always-on listening and supported hardware invocation are **AOSP MVP gates**.
  Listening remains opt-in, visible and locally processed, with reliable stop.
- Full permitted photo-library access is available to the local agent. Cloud
  context selection and reviewed writes/shares remain explicit boundaries.
- No app-data import/export/backup/transfer feature; provide confirmed local reset.
  Ordinary Files and mail attachment operations remain daily-tool capabilities.

## Dependency order and work packages

Every issue starts TODO, including work whose source already exists but needs
reconciliation or acceptance. Shared changes are reviewed upstream, then consumed
by a source pin; never modify the vendor checkout.

| Stage / package | Work and issue IDs | Exit evidence |
| --- | --- | --- |
| 1 / AP1 resident identity and service boundary | #396 #406 #415: local-only agent, Cloud service identity, remove hosted onboarding/restore | Real owner-bound sign-in, revoke/restart, no hosted-agent routes, preserved history |
| 1 / AP7 platform and release | #399 #400: Pixel 10a Android 17 input lock, Cuttlefish, release signing/recovery | Four APKs inspected; image boot separately; physical functions, OTA and recovery separately |
| 2 / AP3 native speech | #397 #413: research, native ABI/JNI, streaming STT/TTS, offline assets | Both ABI executions and physical audio; candidate hashes, quality, speed, no speech egress |
| 2 / AP2 voice interaction | #423 #395: separate buttons, Clef turn detection feasibility, long-gap submission, cancellation and true audio latency | Dictation never submits; voice conversation auto-submits and correctly interrupts; measured end-to-end p95 |
| 2 / AP6 service billing and Maps | #410 #412: Cloud subscription/cached quotas and reusable Maps APIs/tools | No billing network hop per turn; real routes with coverage/freshness, local navigation control and rate-limit evidence |
| 3 / AP5 AOSP daily tools | #420 #421: AOSP capability admission; Contacts, Phone, SMS/MMS; Gmail scopes | Standalone cannot invoke hidden AOSP tools; real provider/role readback and owned carrier endpoints |
| 3 / AP6 Inbox and sharing | #405 #419: mailbox actions, attachment handling and reviewed cross-app drafts | Authorized real Gmail send/read/attachment, exact bytes, no automatic repeat after unknown outcome |
| 3 / AP4 Calendar/reminders | #394 #401 #414 #418: powered-on schedules, Clock integration, Undo, availability | Provider readback, ring/snooze/stop, Doze/reboot/missed handling, no false free status |
| 3 / AP5 Browser/passwords/media | #402 #403 #404 #407 #408: cookies, eligible autofill, system secure camera, full library | Origin/vault isolation, private-session erasure, locked camera, full/partial/revoked gallery tests |
| 4 / AP2 platform presentation | #411 #416 #417: responsive matrix, one system shade and Home swipe | Reviewed actual image screenshots, gestures/insets/accessibility and rotation continuity |
| 4 / AP3 AOSP listening | #424: isolated listener ADR, native local speech, consent, indicator, hardware invocation | Physical lock/AOD/background/call/thermal/battery/stop acceptance; required for AOSP MVP |
| 4 / AP4 notices and reset | #398 #425 #409: background reconciliation, owner-return notices, reset-only | Account-switch/restart exactly-once display; reset cannot resurrect data through workers/callbacks |
| 4 / scope cleanup | #422: remove Wallet from all current MVP obligations and capabilities | Wallet disabled in UI/deep links/agent/native in both distributions; no payment fixtures in production |
| 5 / AP8 complete-product acceptance | Parent #381 app completion, #377 AOSP, #378 final QA | Continuous journeys, controlled release and target-user sign-off at exact source/image/config hashes |

Independent preparation can proceed concurrently; these rows are not instructions
to defer AOSP listening or Cloud Maps out of MVP. Complete prerequisite contracts
before integrating a consumer. Subscription pricing/quotas and final model/backend
selection are explicit tasks, with performance evidence before admission.

## Voice state and runtime design

Use the [speech research/native plan](local-speech-research-2026-10-12.md).
Keep capture, VAD, STT, semantic turn scoring and PCM playback native; expose text,
state, timing and control events through the bridge. Reuse Eliza model lifecycle,
C ABI and cancellation, extending shared support where the current build lacks it.

Dictation: idle → recording → finalizing → editable draft; Send stays explicit.
Voice assistant: idle → listening → short-gap decision → submitted → speaking.
A long gap submits; resumed speech from any pending/submitted/speaking state
cancels that response generation and continues capture. Stop closes the mic and
flushes playback. Restore only text/audio the user actually heard, preserve already
completed action receipts and reject obsolete callbacks. Spoken requests do not
bypass separate approval of sends, deletes, calls or other external effects.

Measure last input speech sample→first audible response, including endpointing.
No account/billing lookup may block local STT/TTS. Use cached signed subscription
entitlements refreshed asynchronously; Cloud enforces bounded quotas in its existing
request path, with explicit expired/revoked/limited states and idempotent usage.
No per-turn balance preflight or automatic top-up. Never cache a perpetual entitlement
or bypass server enforcement to meet latency.

## Responsive-surface matrix

Use available width **and height**, keyboard and system insets, large text and focus.
Keep comfortable reading widths and touch targets; orientation alone is not a layout.

| Surface | Adapt | Preserve / do not stretch |
| --- | --- | --- |
| Home/library | Reflow app grid and dock; relocate assistant controls when height is short | Icon/tap-target size, app order, scroll and gesture zones; no miniature portrait phone in landscape |
| Chat/assistant | Widen within a readable maximum, use side-by-side context only when space allows; short screens use full conversation | Draft, caret, selection, scroll anchor, recording and response generation; no duplicate composer |
| Inbox/Notes/Files/Contacts | Wide list-detail split, narrow single-pane stack; editor keeps readable line length | Unsaved edits and source selection; Contacts only on AOSP |
| Calendar | More visible time/day columns if readable; keep agenda fallback at large text | Event identity, selected date, recurrence scope and time-zone; no shrunken seven-column layout on short screens |
| Maps | Map fills available space; move route/turn panel to side in landscape | Route/GPS state, attribution, large guidance controls and local speech; no restarting navigation |
| Photos/video | Fit or deliberately crop media with explicit controls; move thumbnails/tools | Aspect ratio, selection, zoom and playback; never distort images to fill layout |
| Camera/scan | Rotate chrome and respect native sensor/capture geometry | Capture session, orientation metadata and preview aspect ratio; no stretched WebView camera simulation |
| Reviews/settings | Center bounded-width dialogs or use full-height sheets on short screens; scroll content above fixed actions | Readable exact recipients/amounts/files, keyboard access and visible confirm/cancel; no hidden action row |
| Voice/listening | Compact accessible native/renderer controls with continuous indicator | No stop/start, auto-submit or lost mic indicator due to rotation |
| System shade/secure camera/Clock/dialer | Use native image/system layouts and verify return/insets | Never replace secure/native surfaces with responsive web replicas; emergency routing stays system-owned |

Qualify both APK variants and the image at small portrait/landscape, keyboard open,
150%+ text, TalkBack, split/window resizing where available and process recreation.
Visual checks include the system shade and always-on listening lock/AOD indicator.

## Shared versus product ownership

Eliza/fork owns inference C ABI, JNI engine bindings, model loaders, generic voice
turn/cancellation support, native media/Calendar/notification adapters and reusable
agent Maps tools. Eliza Cloud owns subscription/quotas and hosted Maps/Gmail services.
Alpha owns renderer, policy/capability gates, source pins, image admission, UI design
and per-product acceptance. Cloud Maps/inference are services used by the local agent,
not permission to move orchestration off the phone.

The always-on listener gets a separate narrowly privileged package/service and
reviewed SELinux/IPC boundary; this is the only approved exception to nonprivileged
Alpha packaging. It must honor mic privacy, locked-user data boundaries, consent,
revoke, audio focus and crash recovery. Never inherit another product's identity.

## Verification and completion

Run `npm run verify`, `npm run android:build:local` and `npm run android:build` as
appropriate to the documented input chain; inspect standalone/launcher debug and
release outputs and production capability exclusions. Missing qualified native
inputs are recorded as blockers, never replaced with relaxed developer artifacts
and reported as a release pass.

Then qualify native emulator/HOME behavior, Cuttlefish full-image boot, real Cloud
services, Pixel 10a audio/telephony/media/hardware, signing/OTA/recovery and user
acceptance independently. Preserve failed/unrun evidence. Neither this plan nor
issue conversion closes a feature. No new account, subscription purchase, real
message/call/transfer, device flash or production deployment is performed by this
planning change.

### Validation of this policy reconciliation

On 2026-10-12, `npm run verify` passed (717 tests: 713 passed, four TODO,
zero failed; production bundle audit passed). The focused documentation checks
passed 20/20 and `git diff --check` passed. Existing license flags remain reported
by verification; this policy change does not resolve artifact licensing.

Both `npm run android:build:local` and `npm run android:build` were attempted and
stopped at preflight because the qualified
`android/local-speech/libs/sherpa-onnx-1.13.8-no-espeak.aar` is missing. Neither
APK variant was built or qualified in this review. No new emulator, full-image,
physical-device or real-service acceptance is claimed.
