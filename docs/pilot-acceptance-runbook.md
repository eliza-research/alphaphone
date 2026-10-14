# Alpha Phone physical pilot acceptance

This runbook implements the handoff procedure in steps 14–15 of the [MVP completion plan](mvp-completion-plan.md). It is an execution template, not acceptance evidence. No physical unit, signed image, OTA, latency target or stakeholder signoff is marked passed by this document. Use the current [product status](mvp-current-status.md) to select the candidate; historical emulator results cannot fill physical-unit cells.

## Release entry conditions

Assign an operator, reviewer, support owner and rollback owner before provisioning. Record references to the authorized signing and device-management mechanisms; never copy keys, credentials or recovery codes into the evidence bundle. Select the exact Pixel SKU, hardware revision, Android image and supported device tree. “Pixel 10 or similar” is the product direction, not a claim that every Pixel build is supported.

Freeze the app commit, pinned Eliza source/patch identities, speech/model manifests and generated runtime manifest. Complete `npm run verify` and `npm run android:build`, retain both distribution outputs and test APKs, and obtain successful required CI results for the candidate commit. Identify the separately signed release APK and OS image. Debug signing, unsigned release compilation and launcher-overlay staging are not production image acceptance.

Before changing a physical unit, obtain the owner's consent to the exact provisioning/reset operation and preserve any required personal data using the approved recovery method. Use designated test accounts and synthetic content. Keep stock emergency and recovery access available. Do not flash an image until exact hardware compatibility, signing authority and recovery instructions are established. This runbook deliberately supplies no guessed flashing, bootloader or signing commands.

## Per-unit evidence record

Create one private record for each of four units, using aliases `unit-a` through `unit-d`. Keep raw serial numbers and personal account identifiers out of public PRs. All four rows start **not run**.

| Unit | SKU / hardware / Android fingerprint | App SHA / APK SHA / signer / versionCode | OS image SHA / runtime manifest | Local owner-agent binding evidence | Test report / video / reviewer | Status |
| --- | --- | --- | --- | --- | --- | --- |
| unit-a | pending | pending | pending | pending | pending | not run |
| unit-b | pending | pending | pending | pending | pending | not run |
| unit-c | pending | pending | pending | pending | pending | not run |
| unit-d | pending | pending | pending | pending | pending | not run |

Each run record includes UTC start/end, operator, exact source/artifact identities, network/provider route, engine/model versions, relevant permission/channel state, expected result, observed result, and evidence paths. Use stable synthetic object/run IDs to relate UI, native storage and agent receipts. Record failures and skipped cases explicitly; a missing artifact is unverified. Capture reviewed screens and redacted status/receipt data, not passwords, tokens, OTPs, vault content or unrelated private notifications.

### Provisioning tool

`node scripts/provision-unit.mjs --serial <adb serial> --alias unit-a --apk-manifest <release build>/apk-manifest.json`
installs the launcher release on one unit and writes `test-results/pilot-units/unit-a.json`.
It admits only a release that `verify-apks` recorded as distributable: verified flag-off,
signed by the certificate in `android/release-signer.json`, with a versionCode above the
last recorded release, packaging the resident runtime and its notices, with qualified
speech and no open licence blocker (for example `unresolved-font-licence`). Any other
release is refused before anything is installed, with each unresolved blocker named;
`pilot-update` applies the same admission. Both also read the APK file itself (flag-off web
bundle, build type, packaged runtime, signing certificate) and refuse one that contradicts its
manifest row. It
refuses a unit that already has Alpha installed (use the update tool), checks the
installed bytes and versionCode, opens Android's default-Home chooser for the operator
(`--home-wait-ms` waits for the choice; the tool never makes it), reads the HOME role
holder and the packaged runtime identity (pinned base, patches, agent bundle hash), and
records the device model, SDK and ABI. The record contains no secrets and only the
SHA-256 of the serial and build fingerprint. `--build debug` is an emulator rehearsal of
the same steps, refused on a phone and labelled class E. A provisioning record is not
acceptance of any journey below.

`node scripts/pilot-update.mjs --serial <serial> --alias unit-a --apk-manifest <new build>/apk-manifest.json`
updates that unit in place: the pulled installed APK and the new APK must have the same
apksigner certificate and the new versionCode must be greater; the app is stopped, its
data domains are read back as per-file SHA-256 inventories, `adb install -r` runs, and the
uid, first-install time and every domain must be unchanged (the app is not started in
between). A readback walk that fails, or that finds no app data to compare, fails the update. Android allows that data readback only for debuggable builds, so on a release
unit the update record states that only package identity was read back. The result is
appended to the unit record. Rollback is not offered; the rollback design remains blocked.

## Execute on every unit

Perform the following with the release launcher selected as HOME. Qualify the standalone distribution separately on a designated compatible device with its own APK/source identities; it is an alternate installation of the same package, not a second simultaneous app. Preserve user data when switching only if the signed update path explicitly supports it.

| Journey | Required observations | Evidence and failure boundary |
| --- | --- | --- |
| Boot and design | Cold boot reaches usable Alpha HOME; accessible talk/type controls; exact prototype screens for all retained MVP routes; Back/Home, keyboard, large text and rotation where supported; deferred routes cannot reopen from saved state or agent proposals | Unedited recording plus screen inventory. A mock/reference screenshot alone does not prove live data or native behavior. |
| Resident startup and chat | Configure the permitted inference route without exposing its credential; start local agent without requiring Cloud login; verify runtime identity; type and speak requests; selected-view context reaches the intended conversation | Native process/IPC evidence and canonical conversation IDs. Disclose hosted Cerebras inference; local orchestration is not offline inference. |
| Lifecycle and recovery | Background, lock/unlock, lose/restore network, recreate/kill the app, restart the runtime, explicitly stop it and reboot the phone; recover admitted messages/results once under the same owner | No repeat of uncertain external effects, no stale-owner history, no false successful stop/restart. Match the current resident CI worker-survival test separately. |
| Distribution has no mock surfaces | On the installed release candidate (built with `ELIZA_DEV_ALLOW_TEST_MOCKS` off), confirm the connection chooser offers no mock choice; `?mode=mock`, `?fixture=1`, `?mode=dev` and `?start=` have no effect; Settings has no device controls, simulated apps, local development agent (`10.0.2.2:2138`) or Cloud Staging option; `DailyApps.surfaceInfo().developmentBuild` is false | Record `node scripts/verify-apks.mjs` output for the exact APK (no test-mock classes, no cleartext config or fixture-package queries, bundle audit of `assets/public` clean). A rendered absence alone does not prove the bytes are clean, and APK inspection alone does not prove device behavior. |
| Test-mocks isolation (development builds only) | Only on an `artifacts/test-mocks/` APK installed on a disposable emulator or designated test unit: enter mock after live services pause; traverse retained routes; exit to a deliberate live/offline state | No real provider/device mutation from simulated actions; native system chrome appears once; the mock banner does not obscure primary controls. Never install a test-mocks APK on a pilot unit's acceptance image, and never count its results as distribution evidence. |
| Speech and Notes | Real human microphone capture, denied permission, transcript review/correction, save/reopen/edit/delete, read aloud, playback interruption, silence and unavailable-engine recovery | Listener confirms speaker output. Repeat on-device STT/TTS without network; agent inference may remain unavailable offline. Prerecorded CPU-model tests do not qualify physical capture. |
| Calendar | Select an actual authorized account/calendar; create/read/edit/delete a synthetic event, all-day and recurring cases; verify provider readback, time zone and stale edit refusal | UI IDs and provider IDs agree; account isolation; permission denial and interrupted acknowledgement remain recoverable without duplicate events. |
| Reminders | Create with None and numeric alert lead; reload/edit; receive real delivery; snooze, complete/reopen/cancel, recurrence, reboot and time-zone cases | Due time and alert lead remain distinct; None requests no notification permission and schedules no delivery; notification dismissal is not task completion. Preserve exact receipts. |
| Clock | Reviewed native set/show/snooze/dismiss handoff, actual ringing, reboot and relevant DND/time-zone behavior | A listener observes sound/vibration; intended synthetic alarm is removed afterward. An intercepted intent is not ringing evidence. |
| Workflows and results | User-created morning/evening flows, explicit approval, native effect, durable run history, edit/disable/cancel, concurrency and process interruption; reconnect results and scoped notification tap | Distinct occurrence/run/result IDs, terminal receipts, no duplicate effects. Phone-off hosted execution remains a separate unresolved requirement; local missed-occurrence handling cannot be substituted silently. |
| Browser and passwords | Ordinary address/search, tabs, Back/Forward, chosen upload/download, share/cancel, approved selected-page reading, navigation during review; real selected password provider setup/save/fill/lock/cancel/disable | Child content cannot invoke privileged bridge; sensitive pages cannot reach agent/speech. Verify wrong origin, iframe and tab boundaries using synthetic credentials. Passkeys require separate provider/browser identity evidence. |
| Files, capture, photos and Maps | Select/import/export a test-owned file; camera permission/capture/cancel; reopen selected media; local/regional map search and chosen route where configured | Correct object identity, durable selected data, explicit unavailable coverage; no claim of global navigation from a regional fixture. Excluded advanced media features stay inaccessible. |
| Settings and notifications | Permission denial/recovery, notification channel disabled/re-enabled, exact task/result tap after restart, privacy controls and any accepted listening controls | Settings reflect actual native state. Listening requires its separately approved AOSP implementation, consent, visible state, stop behavior and privacy evidence; do not infer it from a microphone button. |
| Email | Email remains required unless an explicit stakeholder-approved scope amendment says otherwise. Verify Gmail account/grant isolation, full thread and draft behavior, reviewed mutations, revocation and interrupted-result recovery | Browser login is insufficient. A live send requires authorization for the exact recipient/message; otherwise retain synthetic-send evidence and leave real-send acceptance open. Resident execution does not remove account consent or the Email requirement. |
| Optional Cloud/remote agent routes | For each retained route in the approved pilot profile, complete real phone exchange and selected owner/agent, remote pairing, revoke/expiry/restart | Record the profile and any explicit scope decision; do not silently waive an earlier requirement. Do not start billable agents without the applicable spending approval. Cloud identity needed for Gmail remains distinct from choosing a remote agent. |

Run wrong-owner, revoked permission, stale target and lost-response cases against designated fixtures. An unexpected result is not a reason to replay a write. Record unknown outcome, inspect the durable receipt/provider state, and recover through the product's intended UI. Do not weaken SELinux, signature checks, browser isolation, capability gates or release security to get a pass.

## Upgrade from earlier mock state

Earlier development builds could persist mock state. Verify upgrade to the distribution
build separately on a disposable emulator and on a designated physical unit; an emulator
pass is not device evidence, and neither replaces the other.

1. On the earlier build, create the legacy state: select mock in the chooser (persisting
   `alpha.connection.selection.v1` as `{kind:'mock'}`), where the earlier build exposed the development profile also create
   simulated-app data under `alpha.dev.app.*` keys (otherwise seed one such key through
   the WebView debugging tools of the disposable install and record that it was seeded),
   and confirm notification collection is paused by mock entry.
2. Install the distribution APK over it with `adb install -r` (same package and signer).
3. Expect: the app starts at the connection chooser (selection rewritten to
   `{kind:'none'}`), no mock surface is reachable, `alpha.dev.app.*` data is not read or
   displayed by the product, and notification collection stays paused until the user
   makes an explicit connection choice and resumes it. Existing Notes, reminders and
   other real records remain intact.
4. Record the before/after APK hashes, the observed selection value and the collection
   status. Never clear app data to make this pass.

| Gate | Emulator (disposable) | Physical unit |
| --- | --- | --- |
| Saved `{kind:'mock'}` opens chooser | not run | not run |
| `alpha.dev.app.*` not surfaced; real data preserved | not run | not run |
| Paused collection not auto-resumed | not run | not run |

## External integration runbooks

Each entry below needs real accounts, keys or domains and cannot be completed from the
repository. Record operator, date, exact APK/source identity and redacted results.

| Entry | Preconditions | Procedure | Evidence and boundary |
| --- | --- | --- | --- |
| Gmail OAuth | Production OAuth client and consent screen approved for the release package/signer; designated test Google account | Authorize from Settings, read a synthetic thread, create a draft, revoke from the Google account, confirm the app returns to recovery without deleting local data; repeat after app restart | Grant/revoke observations and receipt IDs. Browser login alone is insufficient; a real send requires authorization for the exact recipient/message. |
| Password provider real-site filling | Signed build, verified Proton Pass installed, test vault with synthetic credentials | Choose provider through Android's picker, save and fill a credential on a designated test site, lock/cancel/disable, test wrong-origin and iframe boundaries | Provider-owned UI screenshots without secrets. Setup status does not prove filling. Passkeys are outside the MVP; confirm only the one-time unsupported notice and Open in another browser (including the no-other-browser message and the private-tab warning). Alpha does not detect passkey-only pages. |
| Cerebras key provisioning | Key issued to the pilot program; operator-only channel | Enter the key through the resident agent's provider setup on each unit; confirm the key is stored natively and never appears in logs, screenshots or evidence; rotate once | Provider readiness state and a hosted-inference disclosure check. Do not copy the key into any record. |
| Signed update | Release signer held by the release owner (`ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`, `ELIZAOS_KEY_ALIAS`, `ELIZAOS_KEY_PASSWORD`); increasing `ELIZAOS_VERSION_CODE` | Install version N, create real data, install signed N+1 over it, verify data and resident startup; run the approved rollback drill | Signer certificate digests and version codes for both APKs. See [Signed update and recovery](#signed-update-and-recovery). |
| App Links verification | Owned HTTPS return host; `assetlinks.json` generated from `android/app/src/main/assetlinks.template.json` with the release signer fingerprint. The `autoVerify` intent filter is prepared but commented out in the manifest; the `alphaphone://cloud-delegation` custom scheme remains the active return path until it is enabled in a reviewed change | Publish the file, enable the prepared filter with the real host, build and sign, install, check `adb shell pm get-app-links ai.elizaresearch.alphaphone` reports the domain verified, open a link from another app | Verification state per domain. Debug or unsigned builds cannot verify. |
| Resident redaction re-run | Current distribution APK; synthetic contact and credential fixtures only | Run the resident redaction instrumentation (`ResidentEgressRedactionInstrumentedTest`) on a disposable emulator, then repeat the documented synthetic probes on a designated unit | Leak booleans only, never bodies. Emulator results and device results are separate gates; host redaction checks do not qualify the resident path. |

## Performance and stability

Use the approved #395 boundary: last user speech audio sample to first audible response sample, including endpoint detection and playback buffering. Collect at least 50 successful simple-query native audio trials per source/model/device/environment cohort, including at least 20 warm and five cold observations. Preserve failed and cancelled trials. Report p50/p95 and maximum, network/thermal conditions and exact source, engine and model hashes. Dictation stop-to-editable-text is a separate measurement.

`node scripts/aggregate-voice-latency.mjs <exports...> --out summary.json` accepts `alpha-native-voice-timing-v1` evidence; `scripts/native-voice-latency.mjs` defines the native monotonic mark/provenance contract. Exit 0 requires sufficient evidence with every trial within the six-second upper budget and no failures/cancellations; exit 2 means insufficient/rejected evidence, and exit 3 means a budget/reliability failure. Legacy renderer exports remain diagnostic and cannot pass this qualification. A successful tool result still requires review of real capture/playback provenance and target-device acceptance: calling `MediaPlayer.start()` is not evidence of the first audible sample. The native collector and actual audio campaign remain unfinished.

Complete an agreed battery/thermal/background soak on the exact release image. Record crashes, ANRs, missed deliveries and recovery results with elapsed time and conditions. Synthetic audio, emulator speed or a single successful conversation does not replace physical latency or soak evidence.

## Signed update and recovery

The release operator records the approved old and new APK/OS identities, signing certificates, version rules and expected data migrations. Exercise the authorized signed update on a designated unit, verify resident startup, existing Notes, conversations, approvals, workflow receipts and scheduled state, then execute the approved recovery/rollback drill. Android version/signature and encrypted-data migration rules may prevent a simple downgrade; use the documented release-specific procedure. Preserve previous artifacts and recovery access until this drill passes. Verify the remaining units independently after rollout.

## Handoff and exit

A reviewer other than the implementation operator reproduces the setup and a representative complete journey using the source/setup/deployment guides and the recorded release manifest. Capture at least a five-minute unedited physical demonstration without private content. Reconcile every required journey, every failed/skipped case, and the agreed P0/P1 list against evidence from the actual candidate. Record stakeholder decisions for any explicit requirement change, including powered-off scheduling, rather than treating implementation choices as scope approval.

Deliver source and reviewed upstream references, dependency/license and speech/browser/provider provenance, app/OS build instructions, authorized provisioning guide, per-unit manifests, results and video, update/recovery procedure, support contact and the stakeholder acceptance record. All four units must be independently paired and usable. No open required P0/P1, missing physical evidence or unresolved mandatory scope requirement can be marked complete by this runbook.
