# Browser password autofill

Build45, 2026-09-30: the root-owned build compiled both variants, and `BrowserAutofillInstrumentedTest#frameworkFillsOnlyVisibleCommittedHttpsChild` passed completely on the Pixel-class emulator in both standalone and launcher distributions. This includes genuine framework fill, host exclusion, overlay cancellation and cleartext rejection; exact APKs were archived by the root task. This is Android framework integration, not acceptance of Proton Pass, passkeys, a full owned Chromium build, or a provisioned AOSP image.

## Build49 regression and Build50 correction

The Build49 full suite reproduced the overlay-popup failure intermittently in launcher, despite the focused Build45 passes. This historical pass is not proof that the race was resolved. AOSP API35's `AutofillManager` explains the ordering hazard: `notifyViewExited` updates the service asynchronously, whereas `cancelSessionLocked` clears the current fillable IDs and shown-popup identity. The public `notifyViewVisibilityChanged(view, virtualId, false)` path can hide the anchored popup synchronously while those IDs still exist.

Build50 source therefore reports the actual virtual field invisible before clearing focus or cancelling, and revokes the selected-tab identity before old-tab cleanup can invoke callbacks. No hidden API or reflection is used. The provider-authentication pause path remains unchanged. The actual framework test now repeats three fresh-document suggestion→overlay→dismissal cycles; it still requires a visible suggestion before each cancellation and does not weaken the failed assertion. Build50 execution passed both distributions, including all three popup cycles per variant. Archived terminal logs are `test-results/prototype-build50/autofill/standalone.txt` and `launcher.txt`, with both outcomes in `result.json`. This focused synthetic-provider framework pass corrects the popup regression; it does not relabel the failed Build49 full suite or establish real Proton/vault/passkey acceptance. [AOSP API35 implementation](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r1/core/java/android/view/autofill/AutofillManager.java).

## Product and platform boundary

Alpha retains the prototype's browser chrome. The remote document remains an isolated native child WebView without the Capacitor bridge. Chromium's Android WebView embedder already uses its Android autofill component, so password autofill does not require a full Chromium fork. The component supplies virtual form fields through Android's framework. [Chromium implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/android_autofill/README.md).

`AlphaBrowserPlugin.CredentialWebView` allows framework structure requests and incoming fill values only for the selected, visible, committed, finished HTTPS document with no load error. Its current native URL must match the recorded document URL. Chromium supplies frame-specific domain metadata; Alpha neither fabricates a web domain nor retrieves form values. Child views use an Activity context, required by WebView for autofill. The privileged local host WebView explicitly excludes its descendants from autofill. [WebView API](https://developer.android.com/reference/android/webkit/WebView).

Tab changes, overlays, user-entered navigation, document errors, renderer loss, closing and destruction cancel eligible framework sessions. A page-initiated main-frame navigation of the selected, eligible tab commits the session (`AutofillManager.commit()`) instead, so the selected provider can offer to save a sign-in that navigates; the provider still asks the user. Cancellation excludes the child, clears native focus, reports the actual virtual-field exit and then cancels; late framework popup callbacks for an ineligible child repeat that revocation. During Activity pause, the child is hidden and ineligible for structure/fill delivery. The same-document session is retained because a password provider can legitimately open its own unlock/authentication Activity; unconditional cancellation on pause would break that flow. Eligibility returns only when the resumed selected document is presented. Real provider unlock/resume still requires device qualification.

Browser profiles implement the October 7 owner decision ([decisions](decisions.md#october-7-owner-product-decisions), P-04): normal tabs share a persistent profile, so a sign-in completed with autofill persists; private tabs are ephemeral ([sign-ins, private tabs and site data](prototype-browser-integration.md#sign-ins-private-tabs-and-site-data)). Autofill itself stores nothing in Alpha, and the browser does not block the platform autofill framework in either tab type. P-05 adds an integrated elizaOS password manager with Proton Pass as an optional alternative; it is built as the shared `plugin-native-passwords` provider described below and in [password-provider-setup.md](password-provider-setup.md) (implemented, device acceptance pending). No field values, vault items, credential handles, provider structures or passwords are added to the agent bridge. The current browser agent context remains an opaque tab identity/revision. The website itself necessarily receives fields that the user elects to fill; this is not a promise that website scripts cannot read their own form.

## Alpha password manager

Alpha's own provider (`ElizaPasswordAutofillService` from the shared password plugin, see
[password-provider-setup.md](password-provider-setup.md)) treats Alpha as a trusted browser
only through `CredentialWebView`: when the child is eligible, it adds the committed top-level
origin (`PasswordFormPolicy.TOP_ORIGIN_EXTRA`, `https://host[:port]` of the presented URL) to
its own autofill node after Chromium has built the virtual structure. The provider refuses the
request unless that origin's host equals the single HTTPS web domain of every web node, so a
cross-origin frame (a second domain) is never filled, and uses that origin (with its port, which
Android's field metadata lacks) as the exact binding to match. The privileged renderer WebView remains
excluded, and no field values or vault data are added to the agent bridge. Device
qualification of real Chromium structures (including cross-origin iframes), provider
selection, unlock/resume and save prompts remains open.

## Proton Pass qualification

Alpha's [password-provider setup flow](password-provider-setup.md) now exposes installation/publisher, selected-provider and Android support metadata, with explicit picker/open/download handoffs. [Qualification evidence](mvp-reading-provider-qualification.md) distinguishes rendered onboarding from real provider acceptance.

Prefer the unmodified official APK already pinned in `config/native-apps.json`, retaining its identity and update authority. Alpha can style its own setup/status surfaces. Android and Proton own provider selection, vault unlock, warnings, credential selection and save UI. Preinstallation alone does not enable autofill or unlock a vault. [Proton Android setup](https://proton.me/support/pass-setup-android).

Source reviewed at Proton Android commit `cb4bc258f5b3e4091548a66215f3d23e3506366e`: neither Alpha package is in `BrowserList.kt`. `AutoFillHandler` marks requests containing a web URL from an unrecognized browser package as dangerous; `AutofillAppViewModel` presents its warning before filling. This is an actual integration gate, not merely an unknown framework toggle. Preserve that warning during qualification. Do not spoof Chrome's package, associate every website credential with the Alpha package, or silently weaken provider policy. An upstream browser registration or maintained derivative requires independent review, signing/update decisions and real-flow tests. [Browser list](https://github.com/protonpass/android-pass/blob/cb4bc258f5b3e4091548a66215f3d23e3506366e/pass/autofill/impl/src/main/kotlin/proton/android/pass/autofill/BrowserList.kt), [classification](https://github.com/protonpass/android-pass/blob/cb4bc258f5b3e4091548a66215f3d23e3506366e/pass/autofill/impl/src/main/kotlin/proton/android/pass/autofill/AutoFillHandler.kt#L165), [warning](https://github.com/protonpass/android-pass/blob/cb4bc258f5b3e4091548a66215f3d23e3506366e/pass/autofill/impl/src/main/kotlin/proton/android/pass/autofill/ui/autofill/AutofillAppViewModel.kt#L149).

Android's service guidance requires attention to source domain, app identity/certificate and website association, and permits verified browser allowlists. Embedded third-party login requests can require explicit warnings. A WebView domain alone does not establish that arbitrary browser packages deserve silent access. Ordinary apps cannot silently choose the user's provider; expose Android's settings flow. Passkeys need separate Credential Manager/WebAuthn qualification. [Autofill service security and enablement](https://developer.android.com/reference/android/service/autofill/AutofillService).

## Concrete verification

`BrowserAutofillInstrumentedTest#frameworkFillsOnlyVisibleCommittedHttpsChild` exercises the actual Android framework with `SyntheticAutofillService` from `android/app/src/testMocks`, attached to the debug variant and its instrumentation only when Gradle receives `ELIZA_DEV_ALLOW_TEST_MOCKS=1` (`npm run android:build -- --test-mocks`). The service remains dormant until native instrumentation arms it. It accepts only the target package's HTTPS example.com virtual fields, emits one synthetic dataset, and never persists, logs, uploads or saves structures or credentials.

The test temporarily selects this debug provider and restores the previous provider in `finally`. It loads example.com over actual validated HTTPS, creates an instrumentation-only form in that child, taps its username field, selects the visible native dataset and checks filled values as booleans. Nothing is submitted to the website. It verifies the host cannot see the form, checks overlay cancellation, reload clears the fixture, failed navigation removes eligibility, and a real cleartext loopback form has no dataset or filled values. This does not use a production JavaScript form-reading API and does not bypass TLS validation.

Run both distribution variants through the root build/test owner. Retain terminal results separately from this source description. Additional acceptance remains: official Proton login/unlock/warning/save/re-fill; cross-origin iframe matching; provider authentication pause/resume; background/recreation; tab-switch stale dataset rejection; TLS-certificate failure; physical Pixel compatibility; and explicit AOSP default-provider provisioning if selected. No real provider account or APK installation is part of this change.

## Passkeys outside MVP

The October 12 approved policy (#402) defers passkeys; integrated password save,
fill, exact-origin binding and unlock requirements remain acceptance gates. Alpha
Browser disables WebAuthn even when the installed provider supports browser mode.
Its menu states the limitation and offers an explicit HTTPS-page handoff to
another installed browser. Private tabs first disclose that the receiving browser
can retain the address and use its own accounts; Alpha cookies and tab storage
are not transferred. An absent handler produces an honest refusal.

A future system-credential-provider integration requires separate browser/image
qualification, including provider failure, passkey creation/use, origin binding
and private-profile behavior. Alpha is not a passkey provider. This source policy
and handoff do not establish live passkey or password acceptance.
