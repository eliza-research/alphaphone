# Alpha Phone (alphaphone)

Independent Android UI on Eliza, using the Alpha Phone prototype as its design
reference. The current renderer includes native browser, camera,
calendar, reminders, selected files and local notes. Phone, SMS, Contacts and Wallet
entry points are disabled by the documented MVP profile. The connection chooser supports Cloud sign-in, remote pairing, an explicit local
development endpoint, offline use and mock mode. The real local Eliza/Cerebras
protocol is verified; live provider login, Gmail, voice and
complete workflow execution remain acceptance work. The primary architecture is now an
[Android-resident agent](docs/on-device-agent-plan.md), replacing Nitro/TEE hosting;
the native bridge, reproducible mobile payload staging and browser development host are now implemented. See [local agent setup](docs/local-agent-development.md) and the verification ledger for
the exact tested scope rather than treating a successful APK build as acceptance.

The [October 11 full-product audit](docs/full-product-completion-audit.md) tracks
the requested resident-agent/Eliza Cloud integration and Cuttlefish qualification.
Phone, SMS, Contacts and Wallet are now included in its implementation plan;
their production entry points remain gated pending implementation and acceptance.

- [October 1 browser implementation and design review](docs/mvp-browser-review.md)
- [MVP scope and gap report](docs/mvp-scope-and-gap-report.md)
- [MVP completion plan](docs/mvp-completion-plan.md)

- [Current flow research](docs/research-report.md)
- [Detailed flow PRD](docs/flow-audit-and-prd.md)
- [Current implementation plan](docs/flow-implementation-plan.md)
- [Prototype coverage and remaining gaps](docs/prototype-implementation-gaps.md)
- [Current flow verification](docs/flow-verification.md)
- [Complete current acceptance ledger](docs/current-acceptance-ledger.md)
- [Cloud deployment and authentication findings](docs/cloud-production-validation.md)
- [Enclave candidate and signing gates](docs/enclave-candidate-validation.md)
- [Browser autofill and Proton integration](docs/browser-autofill-integration.md)
- [Calendar and reminder recovery audit](docs/calendar-reminder-audit.md)

- [Working PRD](docs/prd.md)
- [Detailed implementation plan](docs/implementation-plan.md)
- [Architecture and upstream ownership](docs/architecture.md)
- [Requirements and open decisions](docs/decisions.md)
- [Verification results and remaining gates](docs/verification.md)
- [Source/design provenance](docs/sources.md)

## Setup

```sh
git clone --recurse-submodules https://github.com/AlphaCompute/alphaphone.git
cd alphaphone
npm ci
npm run verify
npm run dev
```

## Browser development and verification

```sh
npm ci
npx playwright install chromium
npm run verify
npm run test:browser
npm run dev
```

For configured regional Maps, prepare the data once as described in
[regional Maps setup](docs/maps-regional-validation.md), then run `npm run dev:maps`.
This starts the local router, gateway and app together; use `-- --port 5194` to
choose the app port. Ctrl-C stops the services owned by that command.

The desktop browser shows a fitted phone preview; mobile widths fill the viewport.
Use `?mode=mock` for the clearly labeled design fixture and `?theme=dark` to
inspect dark layouts. Use `?mode=dev` for the browser development profile with durable local app data
and device controls. For the complete capability matrix and current verification results, see
[browser development parity](docs/browser-dev-parity.md). Open **Device controls** with the sliders button beside **Tools** or **Dev data** below the phone preview. Its profile buttons switch between app and development data. In **Device controls**, use
Home, Back, Power, Background and Resume to exercise device lifecycle; use Incoming
call/message/email and Post notification to drive incoming events. Location controls
provide a saved Home place and manual movement for location-triggered workflows.
The role buttons persist the development device's selected Home, assistant, dialer
and SMS roles.

In **Settings → Agent connection**, select a development profile to exercise
conversations, approvals and durable receipts without credentials. Use
`?mode=dev&workflows=agent` to exercise the agent workflow UI with that profile.
For real host inference and speech, follow the separate [local agent setup](docs/local-agent-development.md).
**Settings → Character → Wake assistant** opens the recording UI; recording starts
only after Start recording is selected.

The normal app uses browser-local Notes. Notes text import and export use the browser
file picker and downloads; browser note storage is unencrypted and is not synced.
The browser suite covers production navigation, durable note editing, exact-byte
file flows, dialog accessibility, disclosed adapter fixtures and reference design
states. Reports/screenshots are in `test-results/browser-report` and
`test-results/browser`. Browser CI runs independently of Android qualification.

Use Node 24.15.0 and JDK 21. Native builds require Android SDK platform 36 and
build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` on Linux; the scripts also
recognize the usual macOS Homebrew JDK/Android SDK locations. The Gradle 8.13
wrapper is hash-pinned. No Eliza root dependency installation or package
publication is required for this shell.

Before the first Android build, reproduce the pinned speech runtime and model
assets using [the local speech build instructions](scripts/local-speech/README.md).
These generated inputs are intentionally absent from Git. Both ARM64 and x86_64
runtimes are required; Android CI provisions and validates them on a clean checkout.

```sh
npm run android:build
# Signed debug APKs and unsigned release APKs are in artifacts/.
# Install either standalone-debug.apk or launcher-debug.apk for this product.
adb install -r artifacts/standalone-debug.apk
# The launcher flavor can be selected from Android's default Home app settings.
adb install -r artifacts/launcher-debug.apk
```

The variants intentionally share `ai.elizaresearch.alphaphone` and replace one another.
The other product uses a different package and can be installed alongside this one.
Release APKs are intentionally unsigned; do not distribute debug-signed builds as production.

## Emulator verification

```sh
ANDROID_SERIAL=emulator-5554 npm run android:smoke
```

Use a disposable emulator. This installs both flavors in turn, runs real WebView
and native bridge instrumentation, selects and verifies the launcher HOME role,
and restores the original HOME role. Reports/screenshots go to `test-results/android`.
CI first prepares a disposable stock-HOME fixture with explicit phone/tablet geometry;
that setup script refuses to run outside GitHub Actions unless explicitly emulated.

## AOSP integration

```sh
npm run aosp:stage -- --apk artifacts/launcher-debug.apk --development
```

This invokes the Eliza OS custom-launcher admission helper and emits a new vendor
add-on under `artifacts/aosp/`. Copy that directory under an AOSP `vendor/` directory
and inherit its `product.mk` from the selected product. See [build instructions](docs/android-and-aosp.md)
for signing, default-home policy and the full image verification boundary.

## Layout

`apps/app` owns this product's UI. `android` owns its packaging and launcher bridge.
`vendor/eliza` pins shared platform/native/OS code. The inactive app baseline has
been removed; its source commit and file hashes remain in
`docs/eliza-app-baseline-provenance.json` and the original copy remains in Git history.
`design` preserves the supplied references. Use root npm scripts.

GitHub Actions builds both variants, runs emulator instrumentation and uploads
artifacts. A successful APK job does not establish full AOSP image or physical
hardware acceptance. See the verification record for what was actually run.
