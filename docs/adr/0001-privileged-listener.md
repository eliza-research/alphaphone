# ADR 0001 — Privileged always-on listener in the Alpha AOSP image

- **Status:** Accepted direction (owner policy P-40, 2026-10-12, issue [#424](https://github.com/AlphaCompute/alphaphone/issues/424)). The privilege, permission, IPC and user boundary below is implemented in source. The SELinux boundary is **deferred** (stock `priv_app`, gate G7), and two of the research spec's indicator rules (SystemUI op-list patch, independent Listening chip) are **open**. Image-build, boot and device evidence are still open (see "Acceptance gates").
- **Scope:** the Alpha AOSP image only. The standalone APK and the launcher APK on ordinary Android are unchanged.
- **Supersedes:** the "additive, nonprivileged" admission rule in [decisions.md](../decisions.md) item 5 **for the listener package only**. The ordinary Alpha app stays nonprivileged.
- **Background:** [AOSP always-on listening spec](../market-research/12-aosp-always-on-listening.md) and [technical feasibility](../market-research/10-always-on-tech-feasibility.md). Those are research inputs; this ADR is the decision.

## Decision

Always-on listening is delivered by a separate, small package, `ai.elizaresearch.alphaphone.sense`
(source `android/sense`, image configuration `android/aosp/listener`). It is the only component
that gets microphone privileges beyond an ordinary app.

| Property | Decision |
| --- | --- |
| Package | `ai.elizaresearch.alphaphone.sense`, built by `./gradlew :sense:assembleRelease`. Never a dependency of `:app`; never in the standalone or launcher APK. |
| Partition and privilege | `system_ext` privileged app (`android_app_import`, `privileged: true`, presigned). `android:persistent="true"` and `directBootAware`. |
| Signer | The same release key as the Alpha launcher APK (`ELIZAOS_KEYSTORE_*`). Staging refuses any other signer. The listener's control permission is signature-level. |
| Privileged permissions | Exactly `CAPTURE_AUDIO_HOTWORD` and `START_ACTIVITIES_FROM_BACKGROUND` (privapp allowlist). |
| Never granted | `INTERNET`, `ACCESS_NETWORK_STATE`, `CAPTURE_AUDIO_OUTPUT`, `CAPTURE_MEDIA_OUTPUT`, `CAPTURE_VOICE_COMMUNICATION_OUTPUT`, `BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION`, `EXEMPT_FROM_AUDIO_RECORD_RESTRICTIONS`, `RECORD_BACKGROUND_AUDIO`, `MODIFY_AUDIO_ROUTING`, `READ_PHONE_STATE`. No ambient/audio-intelligence role. No power-save exemption. |
| Runtime permission | `RECORD_AUDIO` is **not** pre-granted. The listener requests it only after the user opts in on its consent screen. |
| Users | Installed for the system (primary) user only (`install-in-user-type`). The persistent user-0 process also stops capture whenever user 0 is not the foreground user (`UserManager.isUserForeground`, re-checked on `ACTION_USER_FOREGROUND`/`BACKGROUND`), so it never processes a guest's or secondary user's speech. |
| SELinux | **Deferred, not an exact boundary.** Phase 1 uses the stock `priv_app` domain; no custom policy is added. Network isolation comes from the absent `INTERNET` permission (no inet group, so the kernel refuses inet sockets). A dedicated `alpha_sense_app` coredomain with network `neverallow`s is a tracked hardening step (gate G7), not a precondition: the Eliza tree's custom domain attempt hit about 30 neverallows. |
| IPC | One exported provider, `ai.elizaresearch.alphaphone.sense.control`, guarded by the signature permission `…sense.permission.LISTENER_CONTROL` and re-checked in `call()`. Methods: `status`, `pause`, `turnOff`. It returns state text only and **cannot** turn listening on or resume it. **Open:** Alpha's renderer adapter for these calls (`apps/app/src/runtime/always-on-listener.ts`) is not yet wired into a Settings surface; until it is, status, Pause and Turn off are available from the listener's notification, Quick Settings tile and its own settings screen. `allow-association` limits associations to Alpha, SystemUI, PermissionController and Settings (whether the consent flow needs more is a G2 check). |
| Invocation | Only while the phone is unlocked (never behind the keyguard), on the wake phrase the listener starts Alpha's existing `AlphaAssistActivity` (ACTION_ASSIST) by explicit component, sharing its identity, with **no extras, data or clip**. Alpha marks the surface `invocation=listener` only when Android reports the listener as caller and the signatures match, ignores the reported caller when the activity is recreated, and reports it once per launch (`takeInvocation` consumes it). |
| Audio handling | 16 kHz mono PCM in RAM only. Local energy VAD and turn segmentation, then the same audited local speech runtime as Alpha (`:local-speech`), then a wake-phrase check. Frames, utterances and transcripts are zeroed/dropped after use. Nothing is written to storage; nothing can leave the device from this package. |
| Capture source | `AUDIO_SOURCE_HOTWORD` (with `CAPTURE_AUDIO_HOTWORD`), which yields to every other client. In addition the listener releases the microphone whenever any other recording is active, pauses while the phone rings and for calls (audio mode) and pauses while its own capture is silenced (microphone privacy toggle). Wake detection is suppressed while any speech-capable playback is active (media, which includes Alpha's WebView voice, assistant, navigation, games, calls, unknown usages). |
| Indicator | The listener's own ongoing foreground-service notification (DEFAULT-importance silent channel, public on the lock screen, status only) with Pause and Turn off usable without unlock and Resume requiring unlock. Listening never runs without it: consent needs `POST_NOTIFICATIONS` as well as `RECORD_AUDIO`, the policy stays in `NOTIFICATIONS_REQUIRED` while the permission, the app's notifications or the channel are denied, blocked, lowered to silent or minimised, or hidden from the lock screen, or while the device-wide lock-screen notification setting is off, and dismissing the notification pauses listening. Android sends no broadcast for a lowered or hidden channel, so while the microphone is held the service re-checks the indicator at least every 15 s (`ListenerPolicy.INDICATOR_RECHECK_MS`), observes the lock-screen setting, and drops any utterance recognised while the indicator is hidden. The image sets `ro.hotword.detection_service_required=true` so HOTWORD capture is attributed to the `RECORD_AUDIO` op, and overlays all six indicator-exempt roles (`config_system{AmbientAudio,Ui,Audio,Notification,Text,Visual}Intelligence`) to empty; staging refuses an overlay that leaves one set or names an Alpha package. `verify-aosp-listener.mjs` refuses an image where any of those roles has a holder or `privacy/camera_mic_icons_enabled` is `false` (AOSP default true; there is no flag-push service on the image). **Open:** the SystemUI patch adding `OP_RECORD_AUDIO_HOTWORD`/`OP_RECORD_AUDIO_SANDBOXED` to the indicator op lists and the independent Listening chip (spec §3.4 rules 3 and 5). Until G3 passes, the consent text says the system indicator is *expected* to show, not that it does. |

### Hardware invocation

The overlay sets press-and-hold power to the default assistant (`config_longPressOnPowerBehavior=5`,
user-changeable in Settings) and keeps power + volume up as the power menu
(`config_keyChordPowerVolumeUp=2`) so shutdown, restart and Emergency stay reachable. Emergency SOS
(repeated power presses) and the double-press-power camera gesture are not overridden; staging
refuses an overlay that changes them. The assistant role holder is Alpha (existing provisioning
overlay), so press-and-hold reaches the same `AlphaAssistActivity`. The standalone APK on ordinary
Android uses only permitted entrypoints: the ACTION_ASSIST activity when the user selects Alpha as
assistant, and the in-app microphone.

### Listener states

`OFF → (consent, permission) → WAITING_FOR_UNLOCK → LISTENING ⇄ PAUSED_{USER, CALL, MIC_IN_USE, MIC_UNAVAILABLE}`,
plus `PERMISSION_REQUIRED`, `SPEECH_UNAVAILABLE` and `STOPPED_AFTER_ERRORS`. The rules are in
`ListenerPolicy` (pure Java, tested on the JVM):

- Off by default; consent is versioned (`CONSENT_VERSION`) so a change in what is captured or where it goes requires opting in again. Withdrawal clears the record.
- Before first unlock after boot the listener never captures and says "Listening starts after unlock".
- Revoking `RECORD_AUDIO` stops capture (Android also kills the process); restarts without the permission are not counted as crashes.
- Crash loop: three unclean exits (a capture session left open in the same boot by the same install) within ten minutes stop listening until the user turns it back on. Shutdowns (`ACTION_SHUTDOWN` closes the marker), reboots, OTAs and package updates are not counted. The trip is sticky; ageing out never restarts capture.
- The listener's notification must be visible (`NOTIFICATIONS_REQUIRED` otherwise) and user 0 must be the foreground user (`PAUSED_OTHER_USER` otherwise).
- Timed pauses run on the monotonic clock, so a wall-clock change cannot end them early; a timed pause from an earlier boot lasts until the user resumes.
- Saying "Alpha, stop listening" pauses until resumed.

## Consequences

- Alpha (`ai.elizaresearch.alphaphone`) gains no privileged permission. It holds only the listener's signature permission and package visibility for it; on phones without the listener everything reports unavailable.
- The listener APK packages its own copy of the speech runtime and model through `:local-speech`. Sharing one image-resident model file is an optimisation, not part of this decision.
- Production staging (`npm run aosp:stage -- --production`) requires `--listener-apk` and a reviewed `--listener-descriptor` pinning the listener's `apkSha256` and `certificateSha256`, and refuses a listener APK without `assets/local-speech/v1/manifest.json` or whose packaged speech natives differ from `android/local-speech/qualified-runtime-manifest.json`. The listener has no apk-manifest/qualification row of its own yet.

## Acceptance gates (not established by source changes)

| Gate | Evidence needed |
| --- | --- |
| G1 Image build | `vendor/alphaphone` with the staged listener builds; privapp enforcement accepts the allowlist. |
| G2 Boot and grants | `node scripts/verify-aosp-listener.mjs --serial S --user 0` passes on the booted image: system, privileged, persistent, `CAPTURE_AUDIO_HOTWORD` granted, no network permission, Alpha nonprivileged, indicator property set; no listening before consent. |
| G3 Indicator | The system microphone indicator and the listener notification are visible while listening, on the lock screen and AOD, including with "hide silent notifications" on (AOD and HOTWORD may need the open SystemUI op-list patch and Listening chip, spec §3.4 rules 3 and 5). HOTWORD attribution under `ro.hotword.detection_service_required` is checked at the pinned AOSP tag. Pixel `PixelConfigOverlay*` must not re-assign the cleared roles. |
| G4 Hardware invocation | Press-and-hold power opens Alpha's assistant surface; power + volume up opens the power menu; Emergency SOS and double-press camera unchanged — on a physical Pixel 10a. |
| G5 Coexistence | User switch to a guest or secondary user stops capture; ringing, calls, another recording app, Alpha's own voice turn, media playback and Bluetooth routing; the listener pauses and recovers; assistant speech does not re-invoke it (echo). |
| G6 Reliability and power | Stop/pause reliability from notification, tile and lock screen; reboot before unlock; crash-loop behaviour; battery and thermal cost over a multi-hour and a 24-hour listening run. |
| G7 Hardening | Optional custom `alpha_sense_app` SELinux domain and isolated speech process, evaluated after G1–G2. |

APK builds, image staging, an image boot, real integrations and device/user acceptance are separate
gates; none of them proves another.

Persistence failures latch listening off and stop the service. Capturing starts only after the open-session marker saves successfully. A fresh listener process requires explicit opt-in again, even when disk contains older consent, so a failed stop save cannot resurrect capture after restart. The consent screen discloses this restart behavior.
