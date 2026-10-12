# Verification guide

Verification applies to the exact source revision, upstream pin and artifacts tested.
This guide defines the gates; it is not a passing test report. See the
[current capability status](mvp-current-status.md), [completion plan](mvp-completion-plan.md)
and [pilot runbook](pilot-acceptance-runbook.md) for remaining product acceptance.

## Source and packaging

Run `npm ci` and `npm run verify` with the toolchain documented in the README.
Prepare the pinned speech assets using [local speech setup](../scripts/local-speech/README.md),
then run `npm run agent:prepare`, `npm run agent:build-workflow-worker`,
`npm run agent:stage-android` and `npm run android:build` with JDK 21 and the configured Android SDK. Plain
`npm run android:build` requires an earlier `npm run agent:prepare` and, for release
verification, `npm run agent:stage-android`.
Validate standalone and launcher distributions, each as debug and unsigned release,
including instrumentation builds, lint and APK inspection. A partial `ELIZAOS_KEYSTORE_*`/
`ELIZAOS_KEY_*` set fails the build. `verify-apks` marks a release distributable only when it
is signed by the certificate recorded in `android/release-signer.json` (`unset` until the
release keys exist) and its versionCode exceeds that file's last recorded release; a signed
release with another certificate or a non-advancing versionCode fails verification.
The committed notices carry only the umbrella runtime entry, so a staged runtime in a
development checkout never makes them stale. `node scripts/generate-licenses.mjs --packaged-runtime`
adds Bun (with its JavaScriptCore LGPL notice and source offer) and every npm package bundled
into the staged agent and workflow worker; the resident workflow runs it after staging, and an
APK built without that step does not carry those notices, and `verify-apks` never marks such a
release distributable. `--check` lists the staged runtime's
entries when one is present. Record the product commit,
`upstream.lock.json` revision, generated input provenance and APK hashes.
Unsigned release APKs require controlled signing before distribution.
The gates downstream of `verify-apks` read that record back through
`scripts/release-blockers.mjs` and name every unresolved blocker: pilot provisioning and
update (`scripts/provision-unit.mjs`, `scripts/pilot-update.mjs`) and AOSP staging
(`scripts/stage-aosp.mjs`) refuse a release that is not distributable, and
`scripts/qualify-head.mjs` records the blockers and reports `releasesDistributable: false`
while one remains. Only the debug emulator rehearsal (`--build debug`) and `--development`
staging of a debug APK proceed without a distributable release, and both are decided from
the APK file, not only its manifest row: `--development` refuses a non-debuggable APK that has
no distributable release row (a missing manifest, a row for other bytes or a row relabelled
`debug` admits nothing), and provisioning and update refuse an APK whose own web-bundle flag,
build type, packaged runtime or signing certificate contradicts the row that admitted it.
`apk-manifest.json` is an unsigned record: speech qualification and licence blockers cannot be
re-derived from the APK, so for those the manifest written by `verify-apks` is the evidence and
must come from the build being installed.

## Browser behavior

Run `npm run test:browser` for the affected flows and inspect the generated reports
and screenshots under `test-results/`. The browser workflow also exercises storage
contracts in Firefox and WebKit. Record the browser, project, test selection and
fixture profile. `scripts/storage-specs.mjs` is the shared storage-spec inventory
for browser lanes and `scripts/qualify-head.mjs`. Qualification requires every
listed spec to execute, passing terminal attempts, matching report counts and no
runner errors, skipped tests or flaky results. A simulated adapter test verifies
its contract, not a live provider.
Visual acceptance requires decoded reference assets and comparable capture geometry;
see [visual verification](prototype-visual-verification.md).

## Android and integrations

Aggregate smoke suites and CI smoke jobs were removed at the owner's request.
For separate native acceptance, use an owned disposable emulator to exercise both APK
variants, native bridge behavior and actual launcher HOME selection and restoration.
Retain terminal instrumentation results and cleanup outcomes. A build or successful
install cannot substitute for these checks.

`npm run test:android:instrumentation -- --owned-emulator --avd <name> --serial emulator-NNNN`
is the one documented instrumentation runner. It refuses physical devices and an
emulator that already has Alpha installed, takes the shared device lease, and for each
variant (standalone, then launcher; they share one package) installs the verified
debug APK with its instrumentation APK (`artifacts/instrumentation/<variant>-androidTest.apk`,
hashed in `apk-manifest.json`), checks the installed bytes, runs each class in its own
`am instrument` process with its explicit opt-in arguments, and uninstalls only what it
installed. `--classes NoMockProduct,Shell,StartupReadiness` names classes (short names
are expanded); the default list covers the product-surface classes; `--all` runs the
whole androidTest suite in one process; `--test-mocks` uses the separate
`artifacts/test-mocks/` pair for fixture-dependent classes such as BrowserAutofill
and the browser loopback cases. `<output>/results.json` (via
`scripts/instrumentation-result.mjs`) records per-class `passed`, `failed`, `skipped`
(every method skipped by its own assumption gate) or `missing`, bound to the commit, a
dirty flag and every installed APK's SHA-256, with raw output per class. It is labelled
emulator class E evidence and is never device or user acceptance. Process-death,
permission-changing and provider-credential campaigns (ReminderTapProcessDeath,
WorkflowNoticeProcessDeath, NotificationChannels, VoicePermissionDenied,
VoicePermissionRevoke, LocalVoiceRecordingLimit, ResidentEgressRedaction) are refused
there with the command of the campaign that owns them; text-scale, bookmark and sign-in restart
phases run through `scripts/test-native-restart.mjs`. Classes that assume a test-mocks app
build (ConnectionChooser, BrowserWebFeatures, CloudVoice and the other loopback-fixture
classes) are refused without `--test-mocks` instead of reporting `skipped`. The reading
classes that give the product a loopback HTTP speech route (BrowserReading,
BrowserSensitiveReading, BrowserIsolatedReading, BrowserUnsupportedReading) are among them:
a build without test mocks answers "Select an available speech route before reading" first,
which is the correct refusal when no HTTPS route exists.

Classes that assert a disposable secondary Android user (HostedProcessRestart,
HostedBackgroundWorker; both also need `--test-mocks` for their loopback HTTP fixture) run in
the runner's secondary-user phase. Per variant it creates a fresh user with the upstream
lifecycle helper the permission, restart and Calendar campaigns use, makes the two installed
packages available to it (`cmd package install-existing --user N`), runs each class and each
of its phases there (`am instrument --user N`), removes the packages from that user and lets
the helper switch back to the owner and remove the user. `results.json` lists each such user
under `secondaryUsers`; a user that is not proven removed fails the run and the console names
the recovery command. RealClock needs AOSP Clock's own notification permission, which the
runner grants (`grantOther` in the registry); the fixture is qualified for API 35 only.

`--home-role` is the runner's one phase that changes a device role, and it runs only with
`--owned-emulator` on the launcher variant:
`npm run test:android:instrumentation -- --owned-emulator --avd <name> --serial emulator-NNNN --variants launcher --home-role --classes SettingsRoles,LauncherHome`.
It requires one stock HOME app to hold the role before the run, runs SettingsRoles (which
removes the role, declines and accepts Android's own dialog and restores what it found),
selects the launcher APK with `cmd package set-home-activity`, force-stops it and requires
the HOME key to bring it to the foreground, runs LauncherHome (All-apps drawer, Settings,
the stock dialer, three installed apps with HOME returning each time, Android Settings and
the default-Home chooser still reachable), then puts the original holder back and reads it
back before uninstalling. LauncherHome and SettingsRoles are refused without `--home-role`,
so they cannot be reported as skipped. `results.json` records the original holder, the cold
HOME start and the restoration under `homeRole`; a run is not a pass without both. If the
original holder cannot be proven restored the run fails, nothing is uninstalled,
`home-role-recovery.json` gives the exact recovery command, and the emulator must not be
reused or deleted until it is recovered. This is emulator HOME-role evidence only: not
boot-time HOME, a custom image, or the recovery and emergency routes of a phone.

`test/android-instrumentation-runner.test.mjs` keeps the instrumentation sources reachable:
every class with an `@Test` method under `android/app/src/androidTest` or
`android/app/src/testMocks/androidTest` must have a `CLASS_REGISTRY` entry, be named by one
of the `CAMPAIGN_RUNNERS` scripts, or be listed in `NOT_RUN_BY_A_RUNNER` with the reason
(all three are in `scripts/android-instrumentation.mjs`). A new class with none of these
fails `npm test`, and so does a listed class that has since gained a runner. AccessibilityInstrumentedTest
(ATF plus TalkBack-order checks at 200% font) and RotationInstrumentedTest (which needs
the landscape layout and fails, not skips, without it) run through the same runner. See the [Android/AOSP guide](android-and-aosp.md)
and README for isolated Calendar and reminder regression/upgrade campaigns.

For native browser changes, qualify HTTPS navigation, back/forward/reload,
loading/title/address state, tab/profile isolation, and background/process recovery
on both variants. Exercise TLS failures, disallowed redirects and offline retry
against controlled endpoints. Verify renderer/profile capability admission and
that remote content cannot paint over or receive touches through host controls,
sheets or the keyboard. Phone geometry and real provider behavior require their
own evidence; desktop screenshots cannot establish native isolation.

Calendar CRUD cases run through `scripts/test-calendar-regression.mjs` with
`--case=CalendarCrudInstrumentedTest` or `--case=CalendarAgentCrudInstrumentedTest`.
`--case=` takes a class (every case of it) or `Class#method`. CalendarAgentCrud has two
cases, each with its own gate and result folder: the reviewed create/read/update/delete
method (`calendarAgent`) and `directSaveReadsBackAllDayChosenZoneAndRrule`
(`calendarOptions`). `--case=CalendarAvailabilityInstrumentedTest` runs that whole class,
which skips unless both calendar permissions are granted before it starts.
Set `ALPHA_CALENDAR_TEST_SERIAL`, `ALPHA_CALENDAR_TEST_AVD`, and
`ALPHA_CALENDAR_TEST_ABI` for the owned disposable emulator. Both distributions
run by default; `--variant=standalone` or `--variant=launcher` selects one.
These cases use the built app/test APKs, isolated-user Calendar grants, and
retained instrumentation and cleanup evidence.

The native workflow campaign uses `node scripts/android-workflow-native.mjs` with
`ANDROID_SERIAL`, `ALPHA_WORKFLOW_TEST_AVD`, `ALPHA_WORKFLOW_TEST_ABI`, and
`ALPHA_BUILD_ARCHIVE`. The archive must contain both distributions' debug and
instrumentation APKs plus their filename-to-SHA256 `apk-manifest.json`:
`node scripts/build-archive.mjs test-results/<new>` makes it from the strict build, and
`node scripts/developer-archive.mjs [--test-mocks] test-results/<new>` copies it from a
developer build that verify-apks recorded in `artifacts/` (it admits each APK against
`artifacts/apk-manifest.json` and writes `archive-source.json` saying it is a developer
archive). Evidence is written to a new `ALPHA_CAMPAIGN_OUTPUT` directory beneath
`test-results/`. `--variant=standalone|launcher` and `--phase=workflow|approval-notice`
run part of the campaign after a failure stopped it; such a report carries `selection`
and `selectionPassed`, and its `passed` stays false.
Set `ALPHA_TEST_HOME_PACKAGE` when the image’s stock launcher differs from
`com.android.launcher3` (for example, `com.google.android.apps.nexuslauncher` on
Google APIs images). This also applies to Calendar and permission campaigns.
The runner refuses existing product package registrations, leases the emulator,
and runs each exact method in a fresh secondary user. It retains the fixture if
package termination or cleanup cannot be proven. These synthetic read/draft tests
do not establish paired-host workflow execution.

The default workflow campaign profile is `production`: its recovery phase checks
that a cold signed-out product startup withdraws a previously persisted synthetic
approval, invalidates its old Android tap, and handles an owner change. It does
not claim that an unauthenticated renderer restores the previous owner.
Use a separately archived test-mocks build and
`--profile=authenticated-fixture` for the two restoration cases. Each case first
runs a standard-runner preparation in the same disposable user, persisting an
explicitly synthetic loopback session through the real renderer initializer.
A separate helper process then serves only the local synthetic identity/agent
responses while the main process dies and restarts. One case restores the same
owner and captures the exact native tap route; the other removes that synthetic
credential and verifies settled signed-out withdrawal. The report names its
profile and preserves preparation output separately from the helper result.
Neither profile proves an actual account session, authenticated workflow review,
or execution of a phone action. A test-mocks preparation skip or failure fails
the authenticated fixture profile; it never counts as product acceptance.

Native permission, restart, one-off reminder, and recurrence runners share
`scripts/native-test-fixture.mjs`: AlphaPhone owns the exact archived APK pair
and SDK configuration; upstream owns the emulator lease, isolated user, strict
instrumentation admission, and cleanup. Set `ANDROID_SERIAL`,
`ALPHA_NATIVE_TEST_AVD`, `ALPHA_NATIVE_TEST_ABI`, and the fixture's stock
`ALPHA_TEST_HOME_PACKAGE`. Supply archived app/test APK paths and a fresh output
directory. Permission changes apply only to the temporary user; successful
cleanup removes that user and restores owner 0. `user-verification.json` records
the shared lifecycle, `verification.json` the instrumentation and package
cleanup, and `result.json` the product scenario. Deferred cleanup is a failure
requiring explicit recovery of the owned fixture.

`node scripts/test-native-permissions.mjs <scenario> APP.apk TEST.apk NEW_OUTPUT` sets the
permission before the app process starts and runs one exact method:

| Scenario | Permission state | What runs |
| --- | --- | --- |
| `camera` | CAMERA revoked | denial and explicit retry without a fake preview |
| `settings` | fine location revoked, coarse granted | Accounts handoff and location accuracy readback |
| `channels` | POST_NOTIFICATIONS granted | a blocked channel read back, user recovery and a real notification |
| `voice` | RECORD_AUDIO revoked | the denied recorder state, Open app settings and back, no capture file, typing in the composer still works |
| `voice-revoke` | RECORD_AUDIO granted, revoked while recording, granted again | four phases in separate processes: a baseline capture; a capture during which the runner runs `pm revoke` and requires Android to end that process mid-test; a new process that finds no capture file, no active recording and no note audio; and a capture after the grant is restored |
| `voice-limit` | RECORD_AUDIO granted | the recorder stops at its limit with the full duration decodable |
| `notice` | POST_NOTIFICATIONS granted | a redacted result notice is posted, tapped and consumed once across recreation |
| `notice-denied` | POST_NOTIFICATIONS revoked | the result stays in encrypted history, no notice is posted and none is pending |

Revoking a runtime permission kills the app process, and instrumentation runs in it, so
`voice-revoke` never asks one process to observe both sides and never force-stops the app to
imitate the kill: a recording process that survives `pm revoke` fails the campaign.
`result.json` records the revocation under `revocation`. The temporary user is removed with
its grants, so nothing is restored afterwards. None of this is microphone, speaker or
notification behaviour on a phone.

Process-restart campaigns use `node scripts/test-native-restart.mjs` with `inbox`,
`notes`, `document`, `text-scale`, `tree`, `bookmark`, or `signin`, a matching archived APK pair and a new output directory.
Use the owned-emulator configuration in the README. Require successful prepare,
restore/verify and cleanup phases; Notes and Inbox reports also require distinct
process IDs. Selected-file, text-scale, folder and bookmark native tests assert process boundaries themselves.
The bookmark case also force-stops before `verifyRemoved`, requiring removal to
survive a second process restart.
Activity recreation alone is insufficient. These campaigns are no longer automatic CI
checks. Browser campaigns require a supported WebView; the stock API 35 provider
lacks the browsing-data deletion capability required by bookmark navigation.
Retain provider admission and native phase evidence separately.

Argument-gated instrumentation methods can be skipped by a full-suite invocation.
Use the exact method and explicit gate documented in its current runner/test source;
require matching start/completion identities, a successful terminal result and no
assumptions. A class listing, source count or `OK` summary does not prove the gated
flow ran. Tests needing synthetic providers or debug hooks require separately
archived test-mocks APKs. Their results cannot qualify flag-off production behavior.

Qualify real integrations separately with authorized test accounts and explicit
user actions. Record account scope without secrets, the actual operation, provider
readback, cancellation/revocation behavior and ambiguous-outcome reconciliation.
Do not count a handoff, fixture response or unavailable-provider branch as successful
provider execution. Native recording, actual captured speech and transcription also
require separate evidence; an audio injection request alone does not prove capture.

## Image, release and user acceptance

AOSP staging validates inputs; full image acceptance requires building and booting
that exact custom image and verifying its installed package, signer and HOME policy.
An SDK emulator test does not establish a custom AOSP image boot.
Physical-device qualification must cover radios, camera/audio, suspend/resume,
accessibility, recovery and signed updates/rollback. Production signing, distribution,
device-owner provisioning and target-user task acceptance remain independent gates.

## Round 10 (2026-10-11): native teardown, live search and reading availability, none run

Branch `claude/r10-native-robustness`. Source, compile and browser checks only (class S). No
APK was assembled, no emulator was started and no workflow was dispatched, so nothing here is
class B or class E evidence, and no fix below has been shown to hold on Android.

- **Calls that arrive after a plugin is destroyed.** Round 8 fixed one plugin
  (`AlphaDevicePlugin`) after a `RejectedExecutionException` on Capacitor's bridge thread killed
  the process. Every Java source under `android/app/src/main/java` was read for the same class.
  Found and changed: `AlphaMailAttachmentsPlugin` (`readSelected`, `openReviewed`,
  `retainSourceReference`, `openSourceReference` handed work to the stopped worker with no
  catch) and `AlphaActionJournalPlugin` (`reviewClock`, `confirmClock` used the shared plugin's
  worker, which that plugin stops on destroy); both now reject the call. `BrowserDownloads`
  handed work to two workers that `destroy()` stops and showed its dialogs from completions
  posted by those workers; after `destroy()` it now shows nothing and drops the work.
  `AlphaBrowserPlugin` accepted `create`, `downloads` and the other main-thread methods after
  destroy (its session is cleared then, so `create` built a WebView on the dead activity and
  `downloads` opened a dialog on it); every such call is now rejected as "Browser closed".
  Two smaller ones: `AlphaDevicePlugin.setTextScale` also refuses a destroyed activity, and
  `AlphaHostedResultsPlugin.enable` rejects when Android has no channel-settings page instead
  of throwing on the bridge thread. Already answering a stopped worker before this round:
  `AlphaDevicePlugin` (problem log), `AlphaHostedResultsPlugin`, `AlphaNotificationsPlugin`,
  `AlphaMapsTransportPlugin`, `AlphaVoiceCloudPlugin`, `AlphaLocalAgentPlugin`,
  `AlphaConnectionPlugin`, `AlphaFilesPlugin`, `AlphaNoteDocumentsPlugin`,
  `AlphaNoteAudioPlugin`, `AlphaPhotosPlugin`. Receivers and callbacks (`DeviceAppsPlugin`,
  the browser's autofill callback and WebView listener, the voice plugin's memory callbacks,
  the Maps stop listener) were already released on destroy. `test/native-plugin-teardown.test.mjs`
  scans every source for an executor hand-off outside a `try` that answers the rejection, and
  it fails on the pre-change sources at the eight places named above. It is a source-shape
  guard: no late call was delivered to a destroyed plugin on a device. Three hand-offs are
  listed in the test as reviewed exceptions with the reason for each.
- **Requests that launch through the activity** (found in review of this branch; same class,
  not an executor). A permission request or an activity-result request has no launcher once
  the activity is destroyed: androidx unregisters it then and `launch()` throws
  `IllegalStateException`, on Capacitor's bridge thread (read from the `androidx.activity`
  1.10.1 classes this build resolves; not reproduced on a device). Unguarded before:
  `AlphaHostedResultsPlugin.enable`, `AlphaVoiceCloudPlugin.startRecording`,
  `DailyAppsPlugin.perform` (a selection), Capacitor's own `requestPermissions` on the four
  plugins that declare permissions (the startup access panel calls it on `DailyApps` and
  `AlphaVoiceCloud`), and three plugin methods the app's plugins inherit from shared ones
  (`CalendarPlugin.requestAccess`, `requestWorkflowReadAccess`, `ReminderPlugin.scheduleReminder`).
  Each is now the body of `LateLaunch.ask`, which rejects the call; the inherited ones are
  overridden in the app's subclass, and the shared sources are unchanged. The guard test scans
  every app source for such a request outside `LateLaunch.ask` or a `try` that answers it, and
  reads the shared parent classes so a new inherited request needs its override. **Not
  covered:** the shared camera and location plugins, which the app registers without
  subclassing, make the same permission requests unguarded (`vendor/eliza/plugins`); that
  needs an upstream change, not an edit here. Also changed: `AlphaMapsTransportPlugin.startNavigation`
  refuses after destroy and retires a session it started while destruction ran, so a late
  call cannot leave a navigation notification with no renderer behind it; and the native
  reading review now gives the unavailable answer before it asks for a speech route.
- **BrowserFlow live search** (failed in rounds 7 and 8). The product request is correct:
  search words become `https://www.google.com/search?q=<words>`. The saved result files
  (`f-default/*/BrowserFlow.txt`) show a complete HTTPS page with a body that was not that
  address, and deliberately carry no URL, so which page loaded was **not observed**. The
  likely cause, not confirmed, is Google answering the emulator's network with its own check
  page (`www.google.com/sorry/…`) or consent page (`consent.google.com`), both of which carry
  the interrupted search in `continue`. The method now accepts either the results page as
  before, or one of those two pages when it is HTTPS, on that host, and `continue` is this
  exact search; and in both cases it asserts the product's own request from the page's history
  entry (HTTPS, `www.google.com`, `/search`, `q` equal to the typed words) and the missing
  bridge. A pass records `INSTRUMENTATION_STATUS: browserFlowSearch=results` or
  `=provider-check`, so a campaign can say which it saw; a pass with `provider-check` is not
  evidence that a results page renders. Any other page still fails, now with the host and path
  class of what loaded. If the next campaign fails with `host: other`, the hypothesis is wrong
  and the method needs another look; a failure that reports `www.google.com`, `/search` and a
  short `textLength` would instead mean the results address answered with a page that never
  filled in (a script check that did not complete), which this method does not accept. Not run.
- **Page reading without isolated-world injection** (WebView 133 on the SDK emulator).
  Nothing was injected into a page's own world before this round and nothing is now; the
  refusal was a toast after a speech route had been prepared, with advice to reload that could
  not help. Now `AlphaBrowser.readingSupport` reports the provider's capability, the browser
  menu carries a note when it is absent, Read aloud and Ask about page say so before doing
  anything else, and the native review refuses with the same sentence (code
  `reading-unsupported`), separately from a page that is merely not ready. The wording is an
  engineering default. `BrowserReadingNavigationInstrumentedTest` has two methods and exactly
  one runs on a given provider: the stale-document method (its assertions unchanged) with the
  capability, and `providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing`
  without it. The other is skipped by assumption and listed as such; the class no longer
  proves stale-document rejection by passing, so read the `ignored` list or
  `browserReadingProvider=isolated-world|no-isolated-world`. Not run.
- Compiled (JDK 21, `--offline`, `npm run agent:prepare -- --source-only`, staged agent
  sources, a locally built unqualified speech AAR as a compile input):
  `./gradlew :app:compileStandaloneDebugJavaWithJavac :app:compileLauncherDebugJavaWithJavac
  :app:compileStandaloneDebugAndroidTestJavaWithJavac :app:compileLauncherDebugAndroidTestJavaWithJavac
  -x :local-speech:preBuild -x :app:stageLocalAgentSources -PELIZA_ALLOW_UNPACKAGED_RUNTIME=1`
  with `-PELIZA_DEV_ALLOW_TEST_MOCKS=0` and again with `=1`: BUILD SUCCESSFUL both times.
  Compilation only.
- Run on a development machine at the reviewed source (after the review additions above; the
  Gradle compile was repeated then too): `npm run verify` exit 0 (695 tests, 691 passed,
  0 failed, 4 todo; bundle audit passed, 395 files, `testMocks=false`);
  `ALPHA_BROWSER_TEST_PORT=7053 npx playwright test --project=chromium --workers=4` on
  `reading-capability`, `browser-navigation`, `reading-review`, `reading-source`,
  `reading-sensitive`, `journey-e-browser-credentials`, `web-summary-note` and
  `browser-signins`: 67 passed. The Chromium specs run the web build, which never asks the
  native capability question; the production project was not run.
- Emulator commands for the integrator (developer APKs; class E when run), with
  `RUN` = `npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN`:
  `RUN --classes BrowserFlow,BrowserReadingNavigation,BrowserSignins,BrowserContinuity,MailAttachment,ClockHandoff`
  (network needed for BrowserFlow); `RUN --test-mocks --classes BrowserDownload,BrowserFlow,BrowserDialogLifecycle,BrowserWebFeatures`;
  `RUN --variants launcher --home-role --classes SettingsRoles,LauncherHome`, repeated, since
  the crash it found appeared once in 22 runs; and, for the plugin methods now routed through
  `LateLaunch`, `RUN --classes DailyApps,ReminderLifecycle,HostedResultsLifecycle,StartupReadiness`
  with the voice permission campaigns of `scripts/test-native-permissions.mjs`. These exercise
  the changed plugins while the activity is alive, and LauncherHome destroys it; none delivers
  a call to a destroyed plugin on purpose, so a pass is regression evidence only.

## Round 10 (2026-10-11): approval notices across process death and owner change, not run

Class S only. Nothing in this section ran on an emulator or a device, and no APK was built.

- Product change: when a different owner connects, the renderer asks the native ledger to
  withdraw the approval notices posted for any other owner
  (`AlphaHostedResults.withdrawOtherOwnerApprovalNotices`, only the owner ID crosses the
  bridge; `WorkflowNoticeDelivery.withdrawOtherOwners`). The notice is cancelled, its tap route
  is released and its receipt stays `withdrawn` in the shared upstream ledger (`NoticeDelivery`)
  until the approval expires, so it is never posted again. Step (result) notices are not
  touched. This is an engineering default, not an owner decision
  ([owner actions](mvp-owner-actions.md), decision 18). Before this change the notice stayed in
  the shade and its tap answered "Connect its original agent".
- `scripts/android-workflow-native.mjs` has a third phase, `approval-notice-recovery`, two
  cases on each distribution (18 cases in all):
  `WorkflowApprovalNoticeProcessDeathInstrumentedTest` under the instrumentation APK's
  `WorkflowNoticeProcessRunner` (the test runs in a helper process of the app and kills the
  main process), and
  `WorkflowApprovalNoticeInstrumentedTest#ownerChangeWithdrawsThePendingApprovalNoticeAndItsTapOpensNothing`.
  Each case runs in its own disposable user from the hash-admitted archive pair, records the
  pair and its runner, and a failed, skipped or missing case stops the campaign and exits
  non-zero. `scripts/android-instrumentation.mjs` names the process-death class as a campaign
  class; `--classes WorkflowApprovalNotice` now runs three methods, two of which post.
- What the process-death case asserts: one receipt and one route before the death; after the
  main process is killed and proven absent, the same OS notice (key, post time, PendingIntent)
  and byte-identical ledgers; the tap starts a new main process whose plugin captures the
  original token with the exact approval ID, binding and route; the capture rewrites no receipt;
  a repeated request posts nothing and rewrites neither ledger; a changed binding or expiry is
  refused. Not covered: the renderer's authenticated read after the capture (the fixture has
  no agent), a decision made after the restart, reboot, and force-stop.
- Source checks run: `test/workflow-approval-notice.test.mjs` (JVM contract of the withdrawal:
  both ledgers, a captured tap of the old owner, a storage fault, invalid owners),
  `test/native-campaign-evidence.test.mjs` (the real runner against a synthetic `adb`: runner
  component, gates, grants, report, selection, failure propagation),
  `test/android-instrumentation-runner.test.mjs`, and
  `test/browser/workflow-notice-taps.spec.ts` (the renderer sends exactly the connected owner's
  ID once, repeats a failed request, and in the `owner-change` scenario asks again with the next
  owner's ID after a different owner connects, whose session never opens the first owner's
  retained tap). The touched Java (three main and three androidTest
  files) was compiled with `javac` against the SDK 36 `android.jar`, Capacitor's sources and the
  Gradle cache's dependency jars with stub `R` and `BuildConfig` classes; the errors that
  remained were all in untouched files that need generated or unstaged inputs. It was not
  compiled by Gradle and no lint ran.
- Review follow-up (same date): the renderer now reads an approval notice's route when the
  request is queued, not when the queue reaches it (`queueApprovalNotices` in
  `workflow-adapter.ts`). A request that waited behind an earlier one while the owner changed
  used to take the next owner's identity, so its notice would have been posted for that owner
  and kept by the withdrawal; a decision's withdrawal likewise keeps the route of the session
  that made it. No browser spec drives the renderer's approval post or withdrawal calls (the
  phone-step specs run without a native platform), so this is covered by the type check only.
  The owner-change instrumented case also refuses to start with an approval route left by an
  earlier test and releases its own routes when it fails.
- Ledger check (MVP-12): the inventory still said no runner grants the Calendar permissions to
  `CalendarAvailabilityInstrumentedTest`. `scripts/test-calendar-regression.mjs` has done so
  since round 8 and the class passed on both flavors in the run recorded below; the entry was
  corrected.

## Round 10 (2026-10-11): the strict build chain at pin `13c98575987a`, on a development machine

Build evidence only, from one macOS arm64 development machine at product source `2560eead`
plus this round's changes. Nothing was installed or run on an emulator or device, no
workflow was dispatched, and **no APK from these runs is distributable or was kept**: two
inputs were local substitutes, as named below. Raw logs were not committed.

What the strict chain (`npm run android:build:local`, no override) needs, and where it
stops on a clean checkout:

| Order | Input | Supplied by | State on a clean checkout |
| --- | --- | --- | --- |
| 1 | Pinned `vendor/eliza` | script (`git submodule update`) | present |
| 2 | Speech AAR matching `runtime-manifest.json` | the reviewed AAR: a person (A-24, MVP-23). A local rebuild: scripts, with `--allow-unqualified-runtime` | missing; the preflight exits 2 here |
| 3 | Reviewed ARM64 embedding host libraries | a person (see below) | missing; `agent:build-embedding-host` exits 3 here |
| 4 | Prepared runtime source | script (`agent:prepare`) | produced |
| 5 | Workflow worker artifact | script (`agent:build-workflow-worker`) | produced |
| 6 | Staged runtime payload and embedding model | script (`agent:stage-android`) | produced |
| 7 | Notices listing the packaged runtime | script (`licenses:packaged-runtime`, new in the chain) | produced |
| 8 | Gradle verification metadata | committed | present |
| 9 | Release signer and signing values | a person (A-06) | unset; the build completes unsigned |

The first input that needs a person is the qualified speech AAR (step 2). With a locally
built, unqualified speech runtime in place, the first step that stops is the embedding
host (step 3), and it is the only one of the three that stops the chain: unqualified speech
and an unset signer leave it running and make its releases `distributable:false`.

The embedding host. `qualified-host.json` names three libraries by SHA-256; they are not in
Git and were not found on this machine. Rebuilt here from the pinned engine
(`elizaOS/llama.cpp` at `ea8b3f2d`, the gitlink of the pin) with NDK `29.0.13113456` and
CMake 4.0.3: `libc++_shared.so` matched the reviewed bytes exactly (which identifies the
NDK), `libelizainference.so` came out at 6,208,400 bytes against the reviewed 6,199,248
and `libelizavoicejni.so` at 1,016,632 against 1,016,376. The rebuilt libraries contain the
absolute build directory (183 source paths in the first, 5 in the second), and the size
differences (9,152 and 256 bytes) are about 50 bytes per embedded path, which is what a
shorter build directory would give. The
reviewed build's directory is recorded only in its receipt, which is not in the
repository, so no script can reproduce those bytes. With the new
`prepare-embedding-host.mjs --remap-build-path`, two builds in different directories were
byte-identical to each other (6,187,152 and 1,009,560 bytes; hashes in
`android/embedding-host/build-toolchain.json` under `unqualifiedCandidateMeasurement`).
Those bytes are not reviewed, not qualified and not staged by any script.

How far the chain got. With an unqualified speech runtime copied from an earlier round's
worktree and, for this run only, the unreviewed local rebuild admitted through an
uncommitted edit of `qualified-host.json` (both reverted afterwards):

- `npm run agent:prepare`, `npm run agent:build-workflow-worker` and
  `npm run agent:stage-android` each exited 0 at the pin.
- `npm run android:deps:write-verification` ran the ten tasks of `VERIFIED_TASKS` with
  `-PELIZA_ALLOW_UNPACKAGED_RUNTIME=0`: `BUILD SUCCESSFUL`, 1,276 tasks executed.
- `npm run android:build` with no option then exited 0 twice with dependency verification
  enforced. Both flavors: debug and unsigned release APKs, both instrumentation APKs, lint,
  and `verify-apks` with the resident runtime `PACKAGED` (1,120 verified entries per
  release, 1,121 per debug APK, upstream commit `13c98575987a`), bundle audit passed.
- The first of those two runs recorded the releases not distributable for five reasons. One
  was a chain defect: "notices lack the packaged runtime", because nothing in
  `android:build:local` ran `generate-licenses.mjs --packaged-runtime` (the hosted
  resident job does). With that step added (660 entries, 66 flagged, exit 0) the second
  run recorded `runtimeNotices: true` and four reasons, all of which need a person: speech
  native bytes not admitted, speech functional acceptance pending or failed, unsigned
  release, release signer unset.
- The build wrote `artifacts/sbom/alphaphone.cdx.json` (1,878 components: 71 Gradle
  coordinates with checksums, 1,154 staged files, Bun, 550 bundled packages, 4 APKs).

Afterwards, on the restored checkout, `npm run android:build:local` exited 3 at
`agent:build-embedding-host` in under a second with the message naming who is needed, and
with the speech AAR removed the preflight exited 2 before it.

Not done and not claimed: a strict build with the reviewed embedding host and a qualified
speech runtime; any signed release; any Linux or hosted build with the verification
metadata; any install. `resident-android.yml` (dispatch-only) stages no embedding host and
so cannot pass `:app:verifyEmbeddingHost` either; it was not changed or dispatched.

Review of this package (2026-10-11, same machine; source tests and two offline Gradle
configuration runs, no APK task, no native build, nothing installed):

- The repository review had read only the two root Gradle scripts while stating that "the
  build" declares three repositories. The fifteen included projects have build scripts of
  their own, and five of them name a repository by URL (Maven Central in four upstream
  plugins, the plugin portal in Capacitor). The check now reads every included script and
  the documents say what is declared
  ([dependency audit](dependency-audit.md#gradle-dependency-verification)).
- The instruction printed for the embedding host did not work as written on a clean
  checkout: `stage-embedding-host.mjs --receipt` reads the staged embedding model, which
  only `agent:stage-android` stages and which the chain reaches after the step that stops;
  and it refuses to replace a differing `qualified-host.json`. The message, the README and
  the owner action now say both, and the staging command names the missing model instead
  of failing on a missing file.
- "Rebuilds and stages the libraries on any machine" was more than was measured (three
  directories on one macOS arm64 host). The wording now says that, and that a rebuild is
  staged only when it is byte-identical.
- The step's rebuild-and-stage path (taken only once `remapBuildPath` is true) had no test.
  It now has one with the compile step replaced: an exact reproduction is staged, any
  difference stages nothing and exits 3, `--status` and `--candidate` never stage.
- Two assertions would have failed on the day a person supplied an input (a release host
  with signing values set; the commit that qualifies a remapped host). They now follow the
  committed records.
- The recorded checksums were compared with the origin: the 71 shipped coordinates and the
  three `aapt2` archives were fetched again from Google's Maven repository and Maven Central
  and matched. `android/gradle/verification-metadata.xml` is now part of the build-input
  snapshot (`scripts/source-snapshot.mjs`), and the check accepts one checksum per artifact.
- Gradle was run twice, offline, to see the metadata refuse: with the Android Gradle plugin
  jar's checksum changed `./gradlew help` failed on dependency verification (the file was
  restored). `:app:dependencies` does not verify, because it resolves no artifact. No APK
  task was run in review.
- The embedding host and model entries of the SBOM said `ships-in: apk` in every document,
  including the one written beside the foundation job's unpackaged APKs, which contain
  neither. They now say an APK that packages the resident runtime.
- Still open, unchanged by review: no Linux or hosted build has run with the metadata.

## Round 8 (2026-10-11): runner cases, fixes and hosted jobs, none run

Branch `claude/r8-runner-ci`. This section records source, compile and host-runtime checks
only. No APK was assembled, no emulator was started and no workflow was dispatched, so
nothing below is class B or class E evidence. When this section was written the round 7
results were the latest emulator results; the integration of this branch then ran part of
the campaign, recorded under "Emulator results at 2961bd9e" further down, which is where
each fix named here is shown to hold, to fail or to be still unrun.

- Compiled (JDK 21, `--offline`, staged agent sources, the speech AAR used as a compile
  input): `./gradlew :app:compileStandaloneDebugJavaWithJavac :app:compileLauncherDebugJavaWithJavac
  :app:compileStandaloneDebugAndroidTestJavaWithJavac :app:compileLauncherDebugAndroidTestJavaWithJavac
  -x :local-speech:preBuild -x :app:stageLocalAgentSources -PELIZA_ALLOW_UNPACKAGED_RUNTIME=1`
  with `-PELIZA_DEV_ALLOW_TEST_MOCKS=0` and again with `=1`: BUILD SUCCESSFUL both times.
- CalendarTruncation (failed in round 7, "not triaged"): product defect. `AlphaCalendar.list`
  had returned every instance with `truncated:false` since the shared calendar plugin was
  adopted (`ab780d04`), so the documented 2,000-instance bound no longer existed and the
  warning the test waits for could not appear. `AlphaCalendarPlugin.list` reads through
  `CalendarRangeReader` again. `test/calendar-range-reader.test.mjs` runs that reader on the
  JVM against a stand-in provider (2,000 returned whole, 2,001 reported incomplete, reading
  stops at the first row past the bound). The instrumentation is unchanged and not rerun.
- PasswordBrowserFill, `test-native-restart.mjs notes` and FilesTree (each failed once or
  twice in round 7, "cause not established"): each has a cause read from the saved result
  files and the source, and a fix. The causes, the fixes and the repeat commands that would
  show them hold are in the [core loop audit](core-loop-audit.md), "Repeat runs for the round 7
  failures". One of them changes the product: a document receipt in Notes now waits until the
  page is visible (`test/browser/notes-document-receipt.spec.ts`).
- Runner cases, checked against the synthetic `adb` fixtures only:
  `scripts/test-calendar-regression.mjs` runs `directSaveReadsBackAllDayChosenZoneAndRrule`
  with `calendarOptions=1` and the whole `CalendarAvailabilityInstrumentedTest`;
  `scripts/developer-archive.mjs` assembles the archive `scripts/android-workflow-native.mjs`
  reads from a verify-apks developer build, and that campaign accepts `--variant=` and
  `--phase=`; BrowserDownload left the default class list, because on a build without test
  mocks it can only be skipped and a skipped class fails the run.
- Hosted jobs, linted with `actionlint` and checked by `test/ci-emulator-evidence.test.mjs`,
  never dispatched: `.github/workflows/android-emulator.yml`
  ([CI cost policy](ci-cost-policy.md#emulator-evidence-android-emulatoryml)).
- Host-runtime evidence, not Android: `npm run agent:test-digest-restart` at pin `40dbe96b`
  (the pin of this branch before it was merged with round 9, which moved the pin to
  `13c9857598`; not repeated there), exit 0, one run ([record](local-agent-development.md#isolated-digest-process-recovery-check)).
- Source and browser checks on this branch (class S): `npm run verify` exit 0 at `ce8488f2` (672 tests, 668
  passed, 0 failed, 4 todo; bundle audit passed, 395 files, `testMocks=false`);
  `ALPHA_BROWSER_TEST_PORT=6912 npm run test:browser:production` 175 passed; the Chromium
  project for the Notes specs this round touches (`notes-document-receipt`, `mvp`,
  `notes-document-storage`, `notes-save-failure`, `notes-status-layout`, `notes-trash`,
  `journey-b-voice-note-actions`, `journey-j03-document-analysis`) 51 passed.
- Review of this branch (2026-10-10; the same evidence classes, no emulator and no dispatch).
  Two changes. The Notes failure notice ("Document operation failed. No completed export or
  import is confirmed.") was still issued at once, so a failure that returned while the
  system picker covered the app could be over before anyone saw it, the race the receipts
  had; it now waits for the document to be visible too, and
  `test/browser/notes-document-receipt.spec.ts` has that case (it fails without the change).
  The four third-party actions the older workflows named by major tag are pinned to the
  commits those tags resolved to (`git ls-remote`, 2026-10-10: `android-actions/setup-android`
  v3 = v3.2.2 `9fc6c4e9`, `gradle/actions/setup-gradle` v4 = v4.4.3 `ed408507`,
  `reactivecircus/android-emulator-runner` v2 = v2.38.0 `a421e438`, `oven-sh/setup-bun` v2 =
  v2.2.0 `0c5077e5`), which are the commits `android-emulator.yml` already named, and
  `test/ci-emulator-evidence.test.mjs` now requires a commit in every workflow file.
  Checks on the reviewed tree: `npm run verify` exit 0 (673 tests, 669 passed, 0 failed, 4
  todo; bundle audit passed, 395 files, `testMocks=false`);
  `ALPHA_BROWSER_TEST_PORT=6932 npm run test:browser:production` 175 passed; the same eight
  Chromium Notes specs 52 passed; `actionlint` exit 0 on the seven workflow files; the Gradle
  compile above repeated for both flavors, app and androidTest, with test mocks off and on:
  BUILD SUCCESSFUL twice (compile only, no APK). The digest restart check was not repeated.

## Round 10 (2026-10-11): accessibility gaps (MVP-48), source and browser tests only

Class S throughout: source, Node tests and Chromium on a development server or the flag-off
bundle. No emulator, device, APK or hosted job was used; the emulator rows below are unchanged
history and none of this is evidence for them. Branch `claude/r10-a11y-gaps`, from `2560eead`.

| Finding | What changed | Covered by |
| --- | --- | --- |
| Home's last row under the floating composer at 200% text (emulator, standalone flavor) | Home and the app library end above the dock; the dock's footprint is measured (`runtime/dock-clearance.ts`), 108px stays the minimum | `accessibility-resilience.spec.ts` (both shells at 100%, 150% and 200%, a raised dock, a longer draft, a stacked status line, landscape); rule `obscured-by-dock` in every lane of the sweep |
| A focused control partly under the composer | Focus that did not come from a pointer is scrolled wholly above the dock; app scrollers carry the dock's footprint as scroll padding | rule `focus-obscured` in the tab-order walk of every lane, now also walked at 200%; the Settings focus tests |
| Titles shortened at 200% (Photos, Camera, Password manager; the Home calendar title cut by its clamp) | Above 150% text a screen title takes a row of its own; the Home title's line height opens with the text scale | the title tests in `accessibility-resilience.spec.ts`; no `[data-alpha-app-title]` or `.home-calendar-title` truncation is left in the 200% lane |
| A toast under a top-layer dialog was neither seen nor announced | The topmost modal dialog gets a live region of its own, drawn above it (`runtime/toast-layer.ts`) | rules `toast-not-announced` and `toast-covered`; the dialog toast tests (position, hit test, accessibility tree, Undo, cleanup) |
| Landscape with 200% text was not swept | A lane of its own. It needed one fix, caused by the title row: in landscape the camera's capture rail starts below that row and the camera's message stops at the rail | `accessibility-sweep.spec.ts` |
| Provider-connected states were not swept | Ten states against a synthetic mailbox at the provider boundary. They found two defects, fixed: the email message field ran 16px under the pill, and a connection's status was cut off at 200% text in Settings | `accessibility-sweep.spec.ts`, `test/accessibility-coverage.test.mjs` |
| Launcher flavor: "an accessibility click reaches no page control on this WebView" | Test defect, not a product one; see below | `test/accessibility-stand-in.test.mjs` (source checks only) |

Each new rule is shown to fire on a seeded defect and to stay quiet on corrected markup in
`accessibility-audit.spec.ts`. With the Home rule, the scroll padding and the focus handler
taken out, the Home tests at 200% and the Settings focus test at 100% failed, so they do
detect the defects.

**The dropped accessibility click.** The round 8 result files show `ACTION_CLICK` accepted
on the handle, on an app tile and on the calendar card with no click arriving and focus
staying on the page body, while `ACTION_FOCUS` on the same node did move focus. The cause was
found by reading Chromium source at the image's WebView version (133.0.6943.137), not by a
run:

- `WebContentsAccessibilityImpl.performAction` calls native `Click` and returns `true`
  whatever happens next.
- `BrowserAccessibilityManager::DoDefaultAction` returns without sending anything when the
  node has no default action verb (`BrowserAccessibility::HasDefaultAction`). `SetFocus` has
  no such gate.
- Blink writes the default action verb in `AXObject::SerializeOtherScreenReaderAttributes`,
  which runs only in the screen reader accessibility mode.
- On Android that mode is chosen from `AccessibilityManager.getEnabledAccessibilityServiceList`
  (`AccessibilityState.updateAccessibilityServices`; `SetBrowserAXMode` falls back to the basic
  mode when no listed service looks like a screen reader). UiAutomation is not in that list,
  and the image has no TalkBack.

So on that image WebView was in its reduced mode and dropped every default action; with
TalkBack or Switch Access bound it would not. The product side was checked in Chromium: the
handle is a named, enabled button with no disabled or read-only ancestor in the
accessibility tree, and the event sequence an accessibility click produces (pointerdown,
mousedown, pointerup, mouseup, click on the element) opens the panel in both shells.
`AccessibilityInstrumentedTest` now binds a stand-in screen reader from the instrumentation
APK for that step (`ScreenReaderStandInService`: every event type, spoken feedback, no touch
exploration), connects UiAutomation without suspending other services, requires the click to
open the panel, then requires a single further click to open it again, and restores the two
settings it changes. The click is repeated once a second for at most 20 seconds only while
WebView is still switching modes, because nothing visible to a test says when it has. The
check that the panel reads in order moved to the pull-down step, so it runs in the same
WebView mode as before. None of this has run: the diagnosis is from source and the changed
test is compiled only (`javac` 21 against `android-36`, the Gradle cache's dependency jars
and the app classes of an existing build; no Gradle build, lint or APK).

Run for this branch (class S): `npm run verify` exit 0 (684 Node tests: 680 pass, 0 fail, 4
todo; bundle audit `PASS web-dist`). The Chromium project, every spec file, in nine batches
with four workers: 3099 passed, 12 skipped, 1 failed. The failure is
`local-agent-native-stream.spec.ts` "retained navigation waits for native stream settlement:
ready-failure"; it fails 4 of 4 with the app source of `2560eead` as well and was not
changed here. Two tests for the product side of the accessibility click were added after
that run and passed with their spec (`accessibility-audit` and `accessibility-resilience`
together: 60 passed). In the production project `accessibility-sweep.production.spec.ts` (now with the
dock rules), `production-surface`, `settings`, `home-attention`, `home-daily-overview` and
`journey-core-loops`: 119 passed; the rest of that project was not run.

Open after this round: an emulator run of Accessibility on both flavors (the Home change and
the stand-in step are unproven there; if the click still does not arrive with the stand-in
bound, the failure message now carries the attempts, the running services and the enabled
state of the node and its ancestors); TextScale and Rotation; everything in MVP-48's device
list. Not swept: the launcher presentation of the app views, zoom above 200%, connected
states other than a mailbox. An app page's own content still scrolls under the composer by
design; only Home and the app library end above it.

## Emulator results at 2961bd9e (2026-10-11, round 8 merged with round 9)

Class E only (emulator instrumentation), for these exact APKs. Not distributable-build,
physical-device, AOSP image, real-integration or user acceptance, and not evidence for any
later source. This is the first emulator record at upstream pin `13c98575987a`. It is a
written summary; the result files under `test-results/` are not committed. The sections below
are earlier campaigns and are kept as history.

- Source: branch `claude/r8-finish`, the round 8 packages merged with `main` at `394c4698`
  (round 9). App APKs A were built at `2961bd9e` and ran everything below unless a row says
  otherwise. `008ccf9d` and `f87850fa` change instrumented test source only; after each the
  app APKs were rebuilt byte-identical and only the instrumentation APKs changed. `a326b8dd`
  changes product source (the problem-log rejection found in this run) and `9a1ca161` test
  source; app APKs B were built at `9a1ca161` and ran the "final" rows.
- APKs: **developer builds with an unpackaged resident runtime, never distributable**:
  `npm run agent:prepare -- --source-only`, then `ALPHA_ANDROID_LOW_DISK=1 npm run android:build --
  --allow-unpackaged-runtime` (resident runtime not packaged), with an unqualified locally
  built speech AAR (`0ce9e976…`) and its developer-override `runtime-manifest.json`, which is
  not committed (every result file therefore says `dirty: true`). App APKs A:
  `standalone-debug.apk` `118c2f56…f4b4fff303`, `launcher-debug.apk` `6dfb7ce8…66f4ccd5`; app
  APKs B: `7c6d33f1…bbfaad41f2524` / `47e7c58e…b2867a2a0cb1a0`. Instrumentation APKs
  (standalone / launcher): set 1 at `2961bd9e` `946529ad…` / `f94b0f95…`; set 2 at `008ccf9d`
  `1b39fc2f…` / `592d58f9…`; set 3 at `f87850fa` `0037730b…` / `bc832485…`; final set at
  `9a1ca161` `fde2847b…` / `cb45b093…`. No test-mocks pair was built, so no test-mocks class ran.
- Emulator: AVD `r8_api36`, `system-images;android-36;default;arm64-v8a`, API 36 (Android 16
  `BE2A.250530.026.D1` userdebug), arm64-v8a, WebView `com.android.webview` 133.0.6943.137,
  serial `emulator-5670`. It was created by the round 8 session that stopped before recording
  anything and was reused here; it was left running, with stock HOME `com.android.launcher3`
  read back and no Alpha package installed. The guest was rebooted once (see the restart
  campaigns).
- Host load average was 15 to 40 during these runs (Chromium batches and Gradle beside them).
- Not run: the test-mocks classes, the reading classes that need isolated-world injection
  (no such WebView on this machine), RealClock (API 35 image), reminders, the other
  permission scenarios, `signin` restart, rotation, the media classes, the resident campaign,
  and every hosted job. Nothing was dispatched.

### `npm run test:android:instrumentation`

Results are standalone / launcher, instrumentation set 1 unless a row says otherwise.

| Class | Result | Classification |
| --- | --- | --- |
| LauncherHome (`--home-role`, launcher only) | passed in 21 of 22 runs with app APKs A, and 3 of 3 with app APKs B (5 methods) | The one failure was a process crash, a product defect: a `crashLog` call the page made just before the activity was destroyed reached `AlphaDevicePlugin`'s stopped worker, and the `RejectedExecutionException` on the bridge thread killed the process. The problem-log methods now answer such a call with a rejection (`a326b8dd`, `test/device-plugin-diagnostics.test.mjs`); other plugins that stop a worker in `handleOnDestroy` were not reviewed for the same path. The original HOME holder was read back after every run. |
| SettingsRoles (`--home-role`, launcher only) | with the test as round 8 wrote it: passed in 2 of 7 runs. With the final test: passed in 8 of 8 runs (app APKs A) and 3 of 3 (app APKs B) | Test defect, two conditions not awaited. Every failure was the same step of `homeRequestDeclineAndAcceptMatchRoleHolders`: after the role is accepted and a HOME key is injected, the page did not report the Home view within 20 s, with the one-instance assertions before it passing. (1) A HOME key injected before the page owner's window has input focus again starts nothing: the log shows no HOME start for the 20 s that followed. (2) The navigation helper keeps a 100 ms step pending after its target view renders; a HOME start that lands first is undone when that step finds Home and opens Settings again (with only (1) awaited the class passed 6 of 7 and the failing run had heard the HOME start). Each press now waits for window focus and for the helper to finish, and must be heard by the page as a HOME start (`9a1ca161`), which is stricter than before. Five of the first seven runs were before the guest reboot and two after. |
| Accessibility | **failed / failed** | Open, two different steps. Standalone: `Home at 200% font: reading order goes up from 'All apps' to 'Open conversation'`. At 200% Home has three columns and four rows of apps, and at the top of the scroll the last row is drawn under and below the floating composer, so the composer reads after controls that sit lower on the screen; the last row scrolls clear of the composer. Whether Home should end above the composer at this size is a layout question that was not changed here. Launcher: the same check passes by 16 px; the class then fails at "the accessibility click action opens the panel". The handle is found by name (after the lookup fix below) and `ACTION_CLICK` is accepted, but no click reaches the page. A diagnostic build showed the same for the "Open your calendar" card, while `ACTION_FOCUS` on the handle did move page focus: on this WebView (133) through UiAutomation, `ACTION_CLICK` dispatches no click to any page control, so the step cannot pass on this image. The measured text scale (2), the Home text-overlap and label-split checks and the two swipe checks before it passed on the launcher flavor. |
| Notifications, SettingsSystemFacts | passed / passed | Notifications now opens the panel through the handle. |
| TextScale | passed / passed | The restart method is skipped by its gate, as designed. |
| NoMockProduct, Shell, StartupReadiness, BrowserSignins, BrowserContinuity (default run) | passed / passed | Seven default classes per flavor; no BrowserDownload row. |
| BrowserFlow (default run) | failed 1 of 2 runnable / same | Environment, as in round 7: `submittedSearchUsesRealProviderAndRejectsExecutableAddress` needs a live `www.google.com/search` page; the page that loaded was HTTPS and complete but not that address. The default run therefore exits 1. |
| LocalAgentOfflineApps, NotesStorageDurability, DailyApps, ReminderLifecycle, ClockHandoff, ClockRepeatDays, HostedResultNotice, WorkflowApprovalNotice, InboxOperationJournal, MailAttachment, CameraScan | passed / passed | WorkflowApprovalNotice is the first run against the shared receipt ledger of pin `13c98575987a`. HostedResultNotice skips two methods by assumption. |
| PasswordBrowserFill | passed / passed | Standalone 4 of 4 runs, launcher 1 of 1. The round 7 failure did not recur; four runs do not prove the race closed. |
| FilesTree | passed / passed | Standalone 4 of 4 runs, launcher 1 of 1. Same caveat. |
| NotesTrashBackstop | failed / failed with set 1 (8 of 9 methods); passed / passed with set 2 (9 of 9) | Test defect in a method that had never run (`unreadableStoresMakeThePermanentDeletionPassANoOp`, round 9): it wrote text that is not JSON into the pending slot, and the secure store refuses such a write. The test now asserts that refusal, the unchanged slot and that the pass erases nothing (`008ccf9d`). |
| BrowserReadingNavigation | failed / failed | Environment: this WebView reports `JS_INJECTION_IN_FRAME_AND_WORLD=false`. Hosted job `browser-reading` is the way to run it. |

### Calendar (`scripts/test-calendar-regression.mjs`)

| Case | Result | Classification |
| --- | --- | --- |
| CalendarTruncationInstrumentedTest | passed / passed | Failed in round 7. The product fix of round 8 (`CalendarRangeReader`) holds on this image; the class is unchanged. First run on the launcher flavor. |
| CalendarAvailabilityInstrumentedTest | passed / passed | 4 tests on each flavor. First run of the class. |
| CalendarAgentCrudInstrumentedTest | reviewed method passed; `directSaveReadsBackAllDayChosenZoneAndRrule` (gate `calendarOptions`) failed on standalone with set 1, and both methods passed / passed with set 2 | First run of the options method. Test defect: it expected the recurring row's `DURATION` as `P3600S`; the shared calendar module writes `PT3600S`, which is what its own consumer test asserts (`008ccf9d`). |
| CalendarRangeInstrumentedTest, CalendarFlowInstrumentedTest (5 tests), CalendarCrudInstrumentedTest (2 tests) | passed / passed | They read through the bounded `AlphaCalendar.list`. |

### Campaigns from the developer archive

`node scripts/developer-archive.mjs` assembled the archive from the verified developer pairs
(set 2, and set 3 for `channels`).

| Campaign | Result | Classification |
| --- | --- | --- |
| `test-native-restart.mjs notes` | launcher passed 3 of 3, standalone passed 1 of 1 | After the guest reboot. Before it every campaign that writes a fixture through MediaStore failed with `SQLiteException: Exception thrown by custom scalar function` from the provider's insert, on an emulator that had been up for three hours; those attempts are not counted. Three runs do not prove the round 7 timeout closed. |
| `test-native-restart.mjs document` | standalone passed | The cancellation notice and the import receipt are still observed with the visibility-aware receipts. Launcher not run. |
| `test-native-restart.mjs inbox` | passed / passed | Includes the round 8 step: after the restart with local apps chosen, Inbox's "Connect Eliza Cloud" panel offers "Retry saved connection" and a new sign-in and shows no account. |
| `test-native-permissions.mjs channels` | failed / failed with set 2 (twice); passed / passed with set 3 | Test defect caused by round 8 and missed by its review: the test clicked the first visible button whose text starts with "Notifications", which since round 8 is Home's handle (Home stays laid out under Settings), so it never reached the channel page. `CrossAppNotificationsRestartInstrumentedTest` had the same selector. Both now exclude the handle (`f87850fa`). |
| `android-workflow-native.mjs --phase=approval-notice` | 4 of 4 cases passed (2 per flavor) | A selection: `selectionPassed` true, `passed` false by design. |
| `android-workflow-native.mjs` (WorkflowPhoneNative and approval notice, 14 cases) | failed at its first case twice with set 2; **14 of 14 passed** with app APKs B and the final set (`passed: true`) | Test defect in a class that had never run: `privateReadResultSurvivesRecreationButNeverExpandsPassiveHistory` removed its journal fixture through the page's `AlphaConnection.secureRemove` and asserted success, but that bridge refuses native-only journal slots (`RendererCredentialSlots`). The test now asserts the refusal and removes the fixture through the native store (`9a1ca161`). `deniedCalendarGrantReturnsNoEvents` passed on both flavors (B-25, J01-7). |

### Found and changed in this run

- `AccessibilityInstrumentedTest` looked the handle up with `findAccessibilityNodeInfosByText`,
  which WebView's node provider answers with an empty list; it now walks the tree (`2961bd9e`).
- The test defects named in the tables (`008ccf9d`, `f87850fa`, `9a1ca161`) and one product
  defect, the problem-log rejection (`a326b8dd`). With app APKs B the HOME-role classes, the
  workflow campaign and NoMockProduct, Shell, StartupReadiness, Notifications,
  SettingsSystemFacts, WorkflowApprovalNotice and NotesTrashBackstop (both flavors, all passed)
  ran; nothing else was repeated on them.
- The hand-off fix `66a1a56c` was made by the earlier round 8 session from its own emulator
  run: at the source before it SettingsRoles and LauncherHome both failed because the live
  task was not raised. Its result files are not part of this record.
- Still open from this run: Accessibility on both flavors (two different steps, see its row),
  BrowserFlow's live-search method, and everything listed under "Not run".

## Emulator results at 6dcdde34 (2026-10-10, round 7)

Class E only (emulator instrumentation), for these exact APKs. Not distributable-build,
physical-device, AOSP image, real-integration or user acceptance, and not evidence for any later
source. The section below this one is the first campaign and is kept as history.

- Emulators (all created for this run and deleted afterwards; stock HOME
  `com.android.launcher3` read back before deletion, no Alpha package and no secondary user left):
  - `r7_api36`: `system-images;android-36;default;arm64-v8a`, API 36 (Android 16
    `BE2A.250530.026.D1` userdebug), arm64-v8a, WebView `com.android.webview` 133.0.6943.137.
    Every row below unless it says otherwise.
  - `r7_api35`: `system-images;android-35;default;arm64-v8a`, API 35 (`AE3A.240806.019`),
    WebView `com.android.webview` 124.0.6367.219. RealClock only.
  - `r7_g36`: `system-images;android-36;google_apis;arm64-v8a`, API 36, with
    `com.google.android.webview` 145.0.7632.218 installed over its 133 from the
    `android-37.0;google_apis` image already on this machine. The isolated-world check only.
- APKs: **developer-override builds, never distributable**: `npm run android:build --
  --allow-unpackaged-runtime` (resident runtime `NOT_PACKAGED`; the reviewed embedding host
  libraries are not on the build machine) with a speech runtime installed by
  `install-generated.py --allow-unqualified-runtime`. App APKs built at `55737f3b`:
  `standalone-debug.apk` `d085c16d…c61f0eb`, `launcher-debug.apk` `0e14b5c9…2205cf9`;
  test-mocks pair `57cda4aa…` / `81b580e2…`. The only later change to app source (`51a29979`)
  affects the browser build, not Android. Instrumentation APKs were rebuilt as tests were
  repaired, with the app APKs byte-identical: set B `ccb07e88…` / `5a224a96…` (the campaigns),
  set C at `6dcdde34` `cbdde6cc…` / `60647098…` (the instrumentation runner, the Calendar
  campaign and the notes rerun), test-mocks `559ae5f8…` / `da62c9db…`; RealClock ran with the
  set built at `55737f3b` (`19fe5d0d…` / `bc3c503e…`).
- The fixture campaigns ran from a hand-assembled directory of those APKs with a name-to-hash
  manifest; `scripts/build-archive.mjs` needs the strict build and was not run. The resident
  campaign (owner-held provider key) was not run.
- Host load was 13 to 60 during these runs. On the first attempt at the launcher half the
  emulator's `system_server` was killed by its watchdog (WindowManager blocked for 74 s) and the
  emulator was restarted; nothing from that attempt is counted.

### `npm run test:android:instrumentation`

Results are standalone / launcher. Result files: `test-results/android-instrumentation/r7-main`,
`r7-homerole`, `r7-accessibility`, `r7-mocks`, `r7-realclock-api35`, `r7-pbf-1..3`,
`r7-webview145-reading`.

| Class | Result | Classification |
| --- | --- | --- |
| NoMockProduct, Shell, StartupReadiness, Video, PhotosTrash, SettingsSystemFacts, NotesTrashBackstop, ClockHandoff, ClockRepeatDays, InboxOperationJournal, MailAttachment, NotesStorageDurability, ReminderLifecycle, Notifications, LocalAgentOfflineApps | passed / passed | |
| TextScale | passed 1 of 2 / same; restart phase skipped (restart runner) | |
| BrowserSignins | passed 5 of 6 / same; restart phase skipped (`signin` campaign, below) | |
| BrowserContinuity | passed 1 of 3 / same; two skipped (restart runner, test-mocks) | |
| HostedResultNotice | builders passed; posted and denied notices skipped here (`notice`, `notice-denied` campaigns, below) | |
| NotesSecureStorage | passed 1 of 2 / same; legacy migration skipped (gate, no campaign) | |
| DailyApps | passed 6 of 6 / passed 6 of 6 | Was failing. Test: a reminder tap is retained while the first-run sign-in panel is open and opens when it is answered; the test now asserts both. |
| WorkflowApprovalNotice | passed / passed | Was failing. Two product defects fixed (repeated post of a decided approval kept a tap route; the receipt read the notice list before Android had listed the notice). |
| CameraScan | passed 2 of 2 / same | Was failing. Product defect fixed (the scan model was packaged under the wrong name; see below) and three test defects (fixture PNGs counted as Photos rows, export read back with an unparsed quoted path, pages counted in compressed PDF objects). No duplicate save exists. |
| Accessibility | passed / passed | Was failing. Test: an empty text field's accessible name is its hint, which the checker did not read; on the launcher flavor the shade swipe started under Android's status bar. |
| FilesTree | passed / passed | The earlier standalone failure did not recur (also passed in two earlier round-7 runs); it was recorded at host load 30 to 140. Cause not established. |
| SettingsFlow | passed / passed | Was failing on standalone. Test: the standalone flavor lists no system-only rows by design; it now asserts that and runs the battery handoff on the launcher flavor. |
| Rotation | passed / passed | With the strict clipping rule (whole box inside the viewport and every clipping ancestor after the best scroll alignment). No clipping found. |
| PasswordBrowserFill | failed once then passed 3 of 3 / passed | One standalone run failed its own tap-geometry precondition ("Synthetic form tap stays inside the visible browser"); not reproduced in three reruns. Cause not established. |
| LauncherHome | not applicable / passed 4 of 4 with `--home-role` | HOME selected, cold HOME resumed, original holder restored and read back. |
| SettingsRoles | not applicable / passed 2 of 2 with `--home-role` | Was failing. Test: Android 16's role dialog ignores Back (decline uses Cancel), the row is the node whose text is exactly the app name, and becoming HOME starts a new activity instance. |
| BrowserFlow (flag-off) | failed 1 of 2 runnable / same | Environment: `submittedSearchUsesRealProviderAndRejectsExecutableAddress` needs a live `www.google.com/search` page; the page that loaded was HTTPS and complete but not that address (every run this round). |
| BrowserDownload (flag-off) | skipped / skipped (test-mocks gate) | |
| BrowserReadingNavigation, BrowserPageQuestion (3 of 4) | failed / failed | Environment: no WebView provider on this machine reports `JS_INJECTION_IN_FRAME_AND_WORLD`. 133 (API 36 default image) and 145.0.7632.218 (the newest, from the API 37 image, installed on `r7_g36`) both report false; CI's fixture uses Chromium snapshot 157.0.8083.0 (x86_64). |
| RealClock (`--clock-exclusive`, `r7_api35`) | passed / passed | The fixture is qualified for API 35 and asserts it. It also needs AOSP Clock's notification permission, which the runner now grants. Not run on API 36. |
| Test-mocks: BrowserDownload, ConnectionChooser, BrowserAutofill | passed / passed | BrowserAutofill's intermittent failure was the test's reading of the closing popup window (10 of 10 fresh-data runs passed after the fix; 4 of 8 failed before). |
| Test-mocks: HostedProcessRestart, HostedBackgroundWorker | passed 3 of 3 phases, passed / same | New secondary-user phase: users 11 and 12 created, used and removed. Both classes need the test-mocks build (loopback HTTP fixture). |
| Test-mocks: BrowserFlow | passed 4 of 5 / same | Same live-search dependency; upload, stop/reload and the error page pass. |
| Test-mocks: BrowserReading, BrowserSensitiveReading, BrowserIsolatedReading | failed / failed | Environment: isolated-world injection (above). On a test-mocks build the sensitive-page rejections pass and the classes stop at the review dialog that needs the isolated world. "The product asks for a speech route first" was the correct refusal on a build without test mocks: their synthetic HTTP route is admitted by a test-mocks build only, and they are now registered and asserted that way. |

### Fixture campaigns (fresh secondary user per run)

Result files: `test-results/r7-camp/<campaign>-<flavor>`, `test-results/calendar-regression-1791688*`.

| Campaign | Result (standalone / launcher) | Classification |
| --- | --- | --- |
| `test-native-restart.mjs signin`, `document` | passed / passed | |
| `test-native-restart.mjs notes` | passed / failed then passed | The first launcher run timed out waiting for "Export saved and exact bytes verified." after the system picker; the rerun passed. Cause not established. |
| `test-native-restart.mjs inbox` | passed / passed | Was failing. Test: the Android account panel names the signed-in state differently, Inbox loads the mailbox itself, and after a restart with local apps chosen the saved sign-in is offered as "Retry saved connection" in Settings, not restored. |
| `test-native-permissions.mjs channels`, `settings`, `voice-limit`, `voice-revoke` | passed / passed | |
| `test-native-permissions.mjs camera` | passed / passed | Was failing. Product defect fixed: a second permission dialog opened straight after "Don't allow". |
| `test-native-permissions.mjs voice` | passed / passed | Was failing. Product defect fixed (the "Open app settings" control the denied message names was missing) and the test now signs in through the closed synthetic Cloud transport, because a build without test mocks records only through Eliza Cloud voice. |
| `test-native-permissions.mjs notice`, `notice-denied` | passed / passed | Was failing. Test: the fixture wrote native-only result slots through the page bridge, which refuses them. |
| `test-reminder-one-off.mjs` | passed / passed | |
| `test-reminder-recovery.mjs` | passed / passed | First run. Reboots the emulator. |
| `test-calendar-regression.mjs` CalendarCrud, CalendarAgentCrud, CalendarFlow, CalendarRange, CalendarCreationRecovery | passed / passed | CalendarCrud was failing. Test: the modal access panel covered the real touch, and scroll-driven animations report running forever. |
| `test-calendar-regression.mjs` CalendarTruncation | failed / not run | First run of this class. "Calendar results incomplete" never appears. Not triaged. The runner stops at the first failure, so the launcher cases above were run one by one with `--variant=launcher --case=`. |
| Resident campaign (`ResidentEgressRedaction`, `ResidentService`) | not run | Needs the packaged runtime and reads an owner-held provider key. |

### Product defects found by these runs and fixed on this branch

- The Android asset merger unpacked `ocr/eng.traineddata.gz` and dropped the suffix, so no APK
  carried the name the scan engine requests and every Android scan ended with "The image could
  not be read by the local scan engine". `android:sync` now protects `*.gz` web assets and
  `verify-apks` fails an APK whose gzip assets differ from the web build.
- A repeated post for a decided phone-step approval left a tap route behind; the approval and
  step receipts could record "unknown" for a notice Android was about to show.
- Closing Android's camera permission dialog with "Don't allow" restarted the preview and asked
  again at once.
- The denied-microphone message told the owner to choose "Open app settings", a control lost in
  merge `344d1305`.
- The native browser page stayed above modal host panels (the first-run access panel, the
  connection panel) and remained interactive.

### Observed and left open

- Inbox's "Connect Eliza Cloud" panel offers only a new sign-in when a saved sign-in exists and
  local apps are selected; the saved one is offered in Settings › Agent connection. Owner decision.
- On the launcher flavor a swipe from the very top opens Android's shade and a swipe from just
  below it opens Alpha's. Owner decision for the AOSP image.
- At 200% font the Home card title and app labels overlap or cut (screenshots taken while
  triaging Accessibility; the instrumentation's bounds checks do not catch it). Not fixed.
- Accepting the HOME role starts a second `MainActivity` in the home task while the first stays
  in its own task.

### Round 8 follow-up to "Observed and left open" (source and browser tests only)

Branch `claude/r8-ui-defects`. Nothing in this subsection was run on an emulator: the browser
results are class S, and the instrumented tests named here were compiled
(`:app:compileLauncherDebugJavaWithJavac`, `:app:compileLauncherDebugAndroidTestJavaWithJavac`,
`:app:compileStandaloneDebugAndroidTestJavaWithJavac`) and not run. The four observations above
stand as what the round-7 APKs do; this records what changed in source afterwards.

| Round-7 observation | Classification | Change | Evidence at this source |
| --- | --- | --- | --- |
| Inbox's "Connect Eliza Cloud" panel offers only a new sign-in when a saved one exists | Plain defect, not an owner decision: the same saved sign-in was already offered in Settings | The Inbox panel offers "Retry saved connection" under the Settings panel's rules (`runtime/connection-ui.tsx`) | `saved-signin-retry.production.spec.ts` (flag-off bundle, stubbed Android bridge, both panels). `InboxDraftInstrumentedTest` restart phase asserts the Inbox offer; compiled, not run |
| A top-edge swipe opens Android's shade, a swipe just below opens Alpha's | The zones are decided by the PRD and flow audit (the status shade is Android's); what stays with the owner is listed in [core loop status](core-loop-status.md#gesture-zones-and-the-notifications-panel-round-8) | Alpha's notifications open only from a visible handle on Home ([gesture zones](gesture-zones.md)) | `notifications-handle.spec.ts`, the accessibility sweeps. `AccessibilityInstrumentedTest` covers the zones; compiled, not run |
| At 200% font the Home card title and app labels overlap or cut | Plain defect (PRD AP-15) | Home cards grow with their text, tile grids drop a column when labels stop fitting, both driven by the measured text scale (`runtime/text-scale.ts`, `phone.css`) | `large-text-overlap.spec.ts`; the overlap rules of `accessibility-audit.ts` over every retained view at 100% and 200% (`accessibility-sweep.spec.ts`, production sweep). `AccessibilityInstrumentedTest` reads the measured scale and checks Home overlap in the WebView; compiled, not run |
| Accepting the HOME role starts a second `MainActivity` | Plain defect: two pages over one store, and the in-flight state stayed in the hidden one | The first live instance is kept and later starts are handed to it (`MainActivity`, "One live MainActivity") | `SettingsRolesInstrumentedTest`, `LauncherHomeInstrumentedTest`; compiled, not run |

Other rows of the tables above, re-read for product defects:

- `CalendarTruncation` ("Calendar results incomplete" never appears) is not an owner decision.
  The class assumes "the actual native 2,000-instance cap". The shared upstream reader
  (`plugin-native-calendar`, `CalendarPlugin.list`, read at `40dbe96bd1`) reads every instance
  in the requested range and always answers `truncated: false`, so the 2,002 fixture rows were
  all returned and the renderer's incomplete-result notice (`calendar-adapter.ts`) could not
  appear. This package left it unchanged; the runner package of the same round restored the
  bound in the product (`CalendarRangeReader`, see "Round 8" above), with the class unchanged.
- The first-run failures recorded as "cause not established" (the launcher `notes` restart
  campaign, `PasswordBrowserFill`, `FilesTree`) were left open by this package. The runner
  package of the same round read a cause for each from the saved result files (see "Round 8"
  above); none of those fixes has an emulator run.
- Found while checking large text: in the standalone app the app library left a 44px strip of
  Home visible above it (the library kept the launcher's status-bar offset). Fixed in
  `phone.css`; `large-text-overlap.spec.ts` asserts the library covers the screen.

Independent review of the above (same branch, source and browser tests only; no emulator). It
changed five things:

- `NotificationsInstrumentedTest` and `NotificationChannelsInstrumentedTest` opened Alpha's
  panel with a synthetic swipe from the top band, which the product no longer answers, so both
  would have timed out on the next emulator run. They now go to Home and click the handle.
- The launcher handle's margin below the status bar was computed in canvas pixels against an
  inset in screen pixels. On a screen narrower than the 412px canvas the margin shrank (under
  8px at 360px wide with a 48px bar) and a 100px bar overlapped the handle. The rule now divides
  by the canvas scale; `notifications-handle.spec.ts` measures it on screen at three widths.
- The hand-off read the live instance's kind (home or standard) from the intent the instance
  held when it was created. A relaunch is handed the last intent given to `setIntent`, where the
  Cloud sign-in return is kept, so after a sign-in and then a relaunch (a system font-size
  change, renderer recovery) a home-type instance was treated as standard and a later notice tap
  or sign-in return would have been delivered without Alpha coming to the front. The kind is
  now kept per task id. `LauncherHomeInstrumentedTest` has a method for it; compiled, not run.
- The hand-off could repeat without end. If the bring-to-front start missed the live instance,
  the home-type instance still finished and left the home task empty, and Android would start
  HOME again. The process now stops handing starts off when a front start makes a new instance,
  cannot be made, or goes unreceived three times in a row; a new start then keeps its own
  instance, which is the two-instance state round 7 measured. Whether the front start reaches
  the live task on a given image is still an emulator question (logcat tag `AlphaInstance`).
- Smaller: the front-start marker extra is read without trusting a foreign parcel, and the
  instance that hands off never removes a task it shares with the live one.

The Java at the reviewed head was compiled for both flavors (app and androidTest sources) with
plain `javac` against the Gradle cache's dependency jars and the generated classes of an existing
build of the same base commit, not with Gradle; no APK was assembled and no lint was run on the
review's changes. Every native statement in this subsection is still class S.

Run in review (class S): `npm run verify` exit 0 (647 node tests: 643 pass, 0 fail, 4 todo;
bundle audit `PASS web-dist`); the production Playwright project, 183 passed; in the Chromium
project the accessibility audit, resilience and sweep specs, `large-text-*`,
`notifications-handle`, `home-*`, `root-view-states`, `fixtures-empty-runtime`,
`standalone-shell`, `native-insets`, `compact-viewport` and `design`, 726 passed. The rest of
the Chromium project was not rerun in review. With the fixed card height and the fixed four
columns put back, `large-text-overlap.spec.ts` failed 5 of 11, so the spec does detect the
round-7 defect.

## Emulator results at 73b973a5 (2026-10-10)

Class E only (emulator instrumentation). Not physical-device, AOSP image, real-integration or
user acceptance, and not evidence for any later source.

Scope of this record. It is a written summary by the session that ran the campaign, and it is
the only committed form of it: the runner's `results.json` files and raw logs are not in the
repository, and the APK hashes below are abbreviated. The source ran at upstream pin `352d7a08`,
not the later pins `40dbe96bd1` (round 7) or `13c9857598` (current since round 9). Changes made after `73b973a5` in response to these results
have no run in this section: the approval-notice route release and posted-notice wait, the gzip
packaging of the scan model, the camera resume decision, the "Open app settings" control, hiding
the native browser page under modal panels, the secondary-user phase of the runner, the role
dialog driver in SettingsRoles, and the later test repairs. Rows marked failed or unresolved
describe `73b973a5`; nothing in this section shows them fixed. Their later runs, at pin
`40dbe96bd1`, are the round 7 section above ("Emulator results at 6dcdde34"), which is the same
kind of record: a written summary whose result files under `test-results/` are not committed.

- Emulator: AVD `r3_packaging_api36`, system image `system-images;android-36;default;arm64-v8a`
  (API 36, Android 16 `BE2A.250530.026.D1` userdebug), ABI arm64-v8a, stock HOME
  `com.android.launcher3`, WebView `com.android.webview` 133.0.6943.137.
- APKs: **developer-override builds, never distributable**: `npm run android:build --
  --allow-unpackaged-runtime` (resident runtime `NOT_PACKAGED`: the reviewed embedding host
  libraries are not on the build machine) with a speech runtime installed by
  `install-generated.py --allow-unqualified-runtime`. App: `standalone-debug.apk`
  `3bcac1ad…7ba516b`, `launcher-debug.apk` `666f7a65…c5934e`. Instrumentation APKs at `bef5cd5b`
  `2bf1dcce…` / `3bf3eef7…` (rows marked A) and at `73b973a5` `5b3cdd0e…` / `755acbc2…` (rows
  marked B). Test-mocks pair: `5b126815…` / `8c13d13a…` with `caccd38c…` / `4c0c9cc9…`.
- The fixture campaigns ran from a hand-assembled directory of those APKs with a name-to-hash
  manifest; `scripts/build-archive.mjs` needs the strict build and was not run.
- The machine was heavily loaded (load average 30 to 140), so a timeout seen once is listed as
  not reproduced rather than as a defect.

### `npm run test:android:instrumentation`

Results are standalone / launcher. "skipped" names the gate.

| Class | Result | Classification |
| --- | --- | --- |
| NoMockProduct, Shell, StartupReadiness | passed / passed (A) | |
| TextScale | passed 1 of 2 / same; restart phase skipped (`textScalePhase`, restart runner) (A) | |
| BrowserSignins | passed 5 of 6 / same; restart phase skipped (`signinPhase`) (A) | |
| BrowserContinuity | passed 1 of 3 / same; two skipped (restart runner, test-mocks) (A) | |
| BrowserFlow (flag-off) | 1 of 2 real-HTTPS tests failed / passed (A) | Environment: `submittedSearchUsesRealProviderAndRejectsExecutableAddress` needs a live `www.google.com/search` page; it failed in 3 of 6 runs. The other test passes since the lock selector fix. |
| BrowserDownload (flag-off) | skipped / skipped (test-mocks gate) (A) | |
| Video, PhotosTrash, SettingsSystemFacts | passed / passed (A) | |
| Rotation | passed / passed (B) | Two test defects fixed (see below). |
| SettingsFlow | failed (`Battery` row not found) / passed (B) | Not reproduced on launcher; standalone unresolved. |
| Accessibility | failed / failed (B) | Reaches its TalkBack order check and reports `Home at 200% font: unlabelled control` at the composer area. Open: product accessibility finding or checker limit; not triaged further. |
| NotesTrashBackstop, ClockHandoff, ClockRepeatDays, InboxOperationJournal, MailAttachment | passed / passed (A) | |
| HostedResultNotice | builders passed; posted and denied notices skipped (permission runner) (A) | |
| NotesSecureStorage | passed 1 of 2 / same; legacy migration skipped (gate) (A) | |
| LauncherHome | not applicable / passed 4 of 4 with `--home-role` (A, B) | HOME selected, cold HOME resumed, original holder `com.android.launcher3` restored and read back. |
| SettingsRoles | not applicable / failed 1 of 2 (A, B) | `homeRequestDeclineAndAcceptMatchRoleHolders`: "Home app not changed" never appears after declining Android's role dialog. Unresolved (three runs). |
| LocalAgentOfflineApps, NotesStorageDurability, ReminderLifecycle, Notifications, PasswordBrowserFill | passed / passed on rerun (B) | Each failed once on one flavor in the first run (A) under load; not reproduced. |
| FilesTree | failed twice / passed twice (A, B) | Standalone only: `Open Renamed destination` never appears and the Files view is empty. Unresolved. |
| DailyApps | failed 1 of 6 / same (A, B: three runs) | `localReminderPostsRealNotificationAndTapOpensItsContext`: the notification tap does not open the reminder's Calendar detail. Unresolved. |
| WorkflowApprovalNotice | failed 1 of 2 / same (A, B) | With the notification permission granted it posts, then fails later (`unknown` status, or the route not released). Unresolved. |
| BrowserReading, BrowserSensitiveReading | failed / failed (A) | Test precondition: without a speech route the product answers "Select an available speech route before reading" before the sensitivity check the tests expect. |
| BrowserIsolatedReading, BrowserReadingNavigation, BrowserPageQuestion (3 of 4) | failed / failed (A) | Environment: this WebView reports `JS_INJECTION_IN_FRAME_AND_WORLD=false`; the classes need isolated-world injection. |
| CameraScan | failed 2 of 2 / same (A, B) | Open: the review dialog reports "The image could not be read by the local scan engine" for the fixture pages; a picked image also left a second Photos row. Not triaged to a cause. |
| RealClock (`--clock-exclusive`) | failed / failed (A) | Environment: the fixture asserts API 35; this image is API 36. |
| HostedProcessRestart, HostedBackgroundWorker | refused by the runner | They assert a disposable secondary user no runner creates. |
| Test-mocks: BrowserDownload, ConnectionChooser | passed / passed | |
| Test-mocks: BrowserFlow | passed 5 of 5 / 4 of 5 | Same live-search dependency. |
| Test-mocks: BrowserAutofill | failed / failed in the runner; passed 4 of 4 run alone | The synthetic autofill service fills both fields through the framework every time. The intermittent failure is later: Android's suggestion popup stayed visible for ten seconds after the Menu overlay made the tab ineligible ("Overlay cancels native credential suggestion", cycle 0 or 1). Cause not isolated. |

### Fixture campaigns (fresh secondary user per run)

| Campaign | Result (standalone / launcher) | Classification |
| --- | --- | --- |
| `test-native-restart.mjs signin`, `notes`, `document` | passed / passed (A) | |
| `test-native-restart.mjs inbox` | failed / failed (A, B) | The test waited for the "Cloud services connected" heading removed in `9aa75ce1`. With the wait changed to the signed-in account summary it still times out: the synthetic sign-in never shows a signed-in account. Unresolved. |
| `test-native-permissions.mjs channels`, `settings`, `voice-limit` | passed / passed (A) | |
| `test-native-permissions.mjs voice-revoke` | passed (B) / passed (A) | The first standalone run stopped in the runner, which parsed `cat`'s "No such file" text as the marker; fixed. |
| `test-native-permissions.mjs camera` | failed / failed (A) | Test expects "Tap the shutter to retry"; the product shows "Camera access is off" with Open Android settings and Try again. Stale expectation or changed denial path; unresolved. |
| `test-native-permissions.mjs voice` | failed / failed (A) | "Record without transcription" never offered. Unresolved. |
| `test-native-permissions.mjs notice`, `notice-denied` | failed / failed (A, B) | The test reflected a plugin field that no longer exists (fixed); it now fails on a later bare assertion. Unresolved. |
| `test-reminder-one-off.mjs` | passed / passed (A) | |
| `test-calendar-regression.mjs --case=CalendarAgentCrudInstrumentedTest` | passed / passed (A) | |
| `test-calendar-regression.mjs --case=CalendarCrudInstrumentedTest` | failed twice / not run (A, B) | An event row never satisfies the visible-and-hit-testable condition. Unresolved; the runner stops before the launcher variant. |
| `test-reminder-recovery.mjs`, resident campaign (`ResidentEgressRedaction`, `ResidentService`) | not run | Recovery reboots the emulator (left for last); the resident campaign needs the packaged runtime and reads an owner-held provider key. |

### Confirmed on this image

- `AlphaDevicePlugin.snapshot()` at target SDK 36 returns `wifiEnabled`, `bluetoothEnabled`,
  `airplaneMode`, `locationEnabled`, `mobileDataEnabled`, `interruptionFilter` and
  `adaptiveBrightness`, matching `settings get global` and the Bluetooth service state, and follows
  an airplane-mode change. No read was refused.
- Closing Android's own shade did **not** refresh an open Alpha shade: while `NotificationShade`
  held window focus and after it closed, the page received no `focus`, `blur`, `visibilitychange`
  or `appResumed`, and made no new snapshot call. `MainActivity.onWindowFocusChanged` now tells the
  page. Re-measured with the fix: one `focus` event and one new snapshot call after the system shade
  closed over an open Alpha shade.
- `LocalSpeechInstrumentedTest` passed 2 of 2 on this emulator with networking off against the
  speech candidate rebuilt at this pin (recorded through `requalify-runtime.py run`; not admitted,
  x86_64 not executed).

### Defects found by these runs and fixed on this branch

Runner: classes shared app data and a left-open system shade (now cleared before each class);
secondary-user classes were run to certain failure; `WorkflowApprovalNotice` had no notification
permission; an empty listing was reported "missing" with nothing recorded; `voice-revoke` marker
polling. Tests: nine browser classes selected `svg[aria-label="Secure connection"]` after the icon
became a `role=img` span; Rotation's clipping rule failed portrait Home and compared a quoted
string; gesture tests did not settle the startup access panel; `InboxDraft` and
`HostedResultNotice` referred to removed product details.

## Evidence and reporting

Keep generated logs, screenshots and machine-readable receipts under ignored
`test-results/` or CI artifacts. Link the exact workflow run and commit when reporting
results; consult [GitHub Actions](https://github.com/AlphaCompute/alphaphone/actions)
for hosted status. Record failures, skipped cases and unavailable prerequisites along
with the passing subset. A rerun replaces evidence only for the scope it executes.
Never carry a dated APK or device result forward as proof for changed source.

Report source checks, APK builds, emulator/HOME tests, real integrations, custom
image boot and physical/user acceptance separately. Requirement evidence remains
unset until a retained, revision-bound result supports that requirement's full scope.

## Resident reuse and native runner phases (2026-10-10)

Assistant surface reuse (MVP-16): `Agent.start` attaches a surface to the resident agent that is
already admitted, running, enrolled and launched under the stored provider admission. An attach
keeps the runtime epoch, the owner enrollment and other surfaces' calls and streams; it never
pairs, and cancelling it retires nothing. Any doubt (runtime not listening, restarted runtime,
expiring or missing enrollment, changed or unadmitted provider, retirement in progress, an
unverified earlier attach) takes the ordinary start path. `Agent.residentAttachment` is the
read-only query the renderer uses to skip the stop-and-rebind of an unchanged Cloud provider;
the credit gate still runs first. A surface whose attach did not yield a verified owner session
stops asking to attach, so its retry stops, rebinds and restarts as before. Not covered: two
surfaces starting before any enrollment exists still supersede each other, and a lone surface
recreated after the last one was destroyed pairs again. Source checks: `test/resident-attachment.test.mjs` (JVM
contract of `ResidentAttachment`, renderer contract, start-path guards). The dual-Activity
case is `AssistantResidentReuseInstrumentedTest`; it uses a synthetic runtime observation,
enrollment and streams, so a passing run is emulator-class evidence of surface ownership only,
not of a live inference stream surviving, and never device acceptance.

Native runner phases (MVP-18): `node scripts/test-reminder-upgrade.mjs` now also runs
`WorkflowLegacyReminderUpgradeInstrumentedTest` on both distributions after the candidate verify
phase, against the same upgraded data. Calendar and reminder upgrades admit the candidate app
and instrumentation APK as one verified pair from `artifacts/apk-manifest.json` and
`artifacts/instrumentation/` (`npm run android:build`); shared Gradle outputs are no longer
installed, and companion classes run only while the installed bytes match that pair.
`node scripts/android-workflow-native.mjs` adds an `approval-notice` phase
(`WorkflowApprovalNoticeInstrumentedTest`, both methods, both distributions; the OS-posting
case is granted `POST_NOTIFICATIONS` in its owned user). Each receipt names its phase and APK
hashes; a failed, skipped or missing phase is recorded (`failedPhase` / `failure`) and exits
non-zero. Source checks: `test/installed-upgrade-runner.test.mjs` and
`test/native-campaign-evidence.test.mjs` drive the real scripts against a synthetic `adb`;
they are not emulator evidence. Approval notices across process death and account change had
no native phase at that date; round 10 added one (see "Round 10" above), which has not run.

Review follow-up (same date): an attach keeps the epoch, so a request the attaching surface had
queued earlier is refused before it pairs or is dispatched (`requireOwned`); a lifecycle change
made by another surface during an attach does not make this surface stop the resident on retry.
Both runners bind the bytes upstream pins to the admitted hashes in `preflightVariant`, before
any install, so a build that overwrites the archive after admission fails the run instead of
being recorded under the admitted hashes. These are source checks only, as above.
