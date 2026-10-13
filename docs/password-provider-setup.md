# Password manager and provider setup

October 7 owner decision ([decisions](decisions.md#october-7-owner-product-decisions), P-05): an integrated password manager is in scope as a reusable elizaOS upstream component consumed by Alpha. Proton Pass, described below, remains an optional alternative provider. The implementation below is decided and built, not yet accepted on a device (see Evidence boundary).

Settings → Password manager (also opened from the Browser menu) now has two parts: Alpha's own
**integrated password manager**, built on the shared upstream `plugin-native-passwords` plugin,
and **Other password providers**, the existing Proton Pass setup/status flow. Both remain
available; Android lets the user select exactly one Autofill provider.

## Integrated password manager

Implementation: the shared upstream `plugins/plugin-native-passwords` module, consumed from
Alpha's reviewed Eliza pin. Alpha owns identity and policy:
`android/app/src/main/res/values/eliza_passwords.xml` (vault directory `passwords` under the
no-backup directory, Keystore alias and AAD `alpha.passwords.vault.v1`, 60 s unlock window,
biometric allowed, host identifies itself as a browser), the service declaration in `AndroidManifest.xml`,
`PasswordsPlugin` registration in `MainActivity`, the top-level-origin extra in
`AlphaBrowserPlugin.CredentialWebView`, and the renderer screens in `apps/app/src/passwords`.

| Capability | Behavior |
| --- | --- |
| Unlock | Platform BiometricPrompt: strong biometric or the device credential. Requires a secure screen lock. The Keystore key itself requires user authentication within the 60 s window and an unlocked device; an in-process grant (also ≤60 s) must exist too. Leaving the password pages, backgrounding Alpha or stopping the Activity locks. |
| List and search | Metadata only: name, username, bindings (website host or app label), update time. Search is local over that metadata. |
| Add, edit, delete | Name, username, one or more exact HTTPS websites (`https://host[:port]`), and a typed (write-only) or natively generated password. App bindings come only from a save capture and can be kept or removed, not hand-entered. Delete needs a second tap. |
| Generate | Native `SecureRandom`, 16/20/32 characters, every character class present, ambiguous glyphs excluded. The value is stored directly and never returned to the renderer. |
| Show and copy | Native only. Show opens a FLAG_SECURE dialog that hides after 30 s or when Alpha stops. Copy marks the clip sensitive and attempts to clear it after 45 s. If Android hides clipboard ownership, clearing waits until Alpha resumes. A replaced or unidentifiable clip is never deleted. |
| Damaged vault | If the key is lost or permanently invalidated (for example, the screen lock was removed), the vault is reported as undecryptable. The only action is "Delete saved passwords and start over": two taps and a fresh unlock, and native code refuses it while the vault is still readable. |
| Set as autofill service | Opens Android's own confirmation (`Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE` for Alpha's package, falling back to Settings). The status row reports only what `AutofillManager#getAutofillServiceComponentName` reads back on refresh or resume. Opening the screen is never treated as selection. |
| Fill | Native app fields through Android Autofill. Browser fields without verified native origins are refused. |
| Save | "Save password?" is offered by Android after a sign-in; Alpha's prompt names the site or app and username, and writes only after Save and a fresh unlock. Save and Fill close their own grants after completion. Same binding and username updates the existing entry. |
| Export | None in this version. Any future export must require explicit confirmation and a fresh authentication. |

Fill rules (implemented in the shared `PasswordFormPolicy`, tested on a JVM):

- A fill request never opens the vault. Android shows one "Fill with a saved password" choice with
  no values; selecting it opens the FLAG_SECURE picker, which always asks for a fresh unlock (an
  earlier unlock in Settings or another fill is not reused) and lists only entries bound to the
  exact request subject. Every fill needs that authentication and an explicit choice.
- Websites: accepted only from a trusted native adapter that reports the exact origin of
  every login field. Standard WebView does not supply that information; Alpha's browser
  is therefore unsupported. Top-level origin or domain metadata alone is insufficient.
  No third-party browser is trusted by default.
- Apps: the framework-reported package, matched only if `PackageManager#hasSigningCertificate`
  confirms the signer recorded at save time (rotation-aware). Alpha's own native UI and its
  renderer WebView are never filled.
- Matching is exact: `accounts.example.com` and `example.com` are different bindings,
  as are origins on different ports. Native field-origin metadata must preserve that distinction.

### Threat model

| Asset / boundary | Protection | Residual risk |
| --- | --- | --- |
| Vault at rest | One AES-256-GCM frame (`PasswordVaultFrame`, random 96-bit IV generated by Keystore per write) with host AAD in the no-backup directory; non-exportable Keystore key requiring user authentication and an unlocked device; `allowBackup=false` and data-extraction rules exclude everything. | Root or a compromised OS. StrongBox is not asserted. Removing the screen lock permanently invalidates the key; the vault becomes unreadable (reported as `key-invalidated`) and can only be deleted. Because the device credential is always accepted, the key is bound to the lock-screen secure ID, so enrolling a new biometric does not invalidate it (enrolling already requires the credential). Any device unlock also opens the Keystore window; the in-app grant from Alpha's own prompt is still required. |
| Agent, model, logs, journal, notifications, crash data | No bridge method resolves with a secret; the shared client rebuilds responses from allowlisted fields and rejects any secret-like key; errors never echo input; native code has no logging; nothing is written to view state, storage, toasts, notifications or the action journal; the agent observation is `sensitive` (no view, no selection) on every password page, and the agent client then refuses to send. No agent action, workflow step or backend code can reach the vault bridge (static test). | A password the user is typing exists in renderer memory until save/leave. The agent sees no labels or origins at all in this version. |
| Fill into the wrong origin | App signer binding and explicit native per-field origins for any browser adapter, one-shot in-memory tokens (Intents carry only a random token), user choice per fill. Standard WebView fields are refused. | Browser Autofill is unavailable until a native browser adapter supplies verified field origins, including ports. Never synthesize these from the top-level URL or page JavaScript. A site can read a password that the user manually enters or pastes. |
| Save capture | Captured values stay in memory behind a one-shot token (5 min), consumed once; nothing is written without Save and unlock. | Process death drops the capture (fails closed). |
| Reveal / clipboard | FLAG_SECURE, timed hide, sensitive clip flag (Android 13+ hides previews), timed clearing. | Expiry is best effort: other apps may have clipboard access on older Android versions, and Android may defer ownership checks until Alpha resumes. Alpha never clears a replaced or unidentifiable clip. |
| Renderer compromise | Cannot read secrets; cannot mint app bindings; can trigger unlock prompts and native reveal/copy only after a real unlock. | A compromised renderer could rename/delete entries while unlocked. |

### Export and import

Alpha registers the shared `ElizaPasswordTransfer` plugin from the reviewed upstream
pin. Export uses Android's document picker, requires fresh authentication after the
picker returns, and asks for confirmation before writing an unencrypted CSV. The
native implementation streams bounded rows rather than building a second full vault
copy. A failed export warns that the selected file may still contain passwords.

Import reads a user-picked CSV, reviews every admitted HTTPS origin, and adds entries
atomically without replacing saved website/username pairs. Invalid origins, app bindings,
duplicate entries and unsupported rows are skipped. Input is bounded to 2 MiB and
1,000 rows. Backgrounding cancels the operation; the native worker keeps exclusive
ownership until it exits. Only counts cross the bridge, checked by the shared client.
Alpha refreshes vault state after an interrupted import or export.

[Upstream PR #34879](https://github.com/elizaOS/eliza/pull/34879) contains the exact-head
CSV, streaming, atomic-store and native consumer evidence. Four consumer cases and
the separate native store case passed on API 35. These establish the shared module's
fixture behavior, not integrated Alpha, biometric or physical-device acceptance.

### Passkeys

Passkeys are outside MVP under the approved #402 policy. Alpha's browser disables
WebAuthn even where the installed provider supports it. Use a password or the
explicit Open in another browser action; private tabs ask before handing over
the address. Alpha does not detect passkey-only pages. Future system-provider
support requires separate browser/image qualification.
The integrated password manager does not provide passkeys or store TOTP secrets.

### Evidence boundary

`npm run verify` runs the JVM custody/policy tests, the shared client tests and the Alpha
boundary tests; Playwright covers the Settings UI with the flag-only development vault
(`?mode=dev`, `ELIZA_DEV_ALLOW_TEST_MOCKS=1`) and a controlled native bridge. The upstream native consumer fixture passed three tests at
`352d7a0855b713319cbe1acdab5fbf556fb85aa8` on API 35: Android app save, device-credential
unlock, cancellation during authentication, retry, explicit account choice and fill. See
[upstream PR #34835](https://github.com/elizaOS/eliza/pull/34835) for the recording, exact APK hashes
and cleanup evidence. This does not establish Alpha WebView, cross-origin iframe, biometric or
physical-device acceptance. The production bundle audit refuses the development vault strings.

Browser Autofill through Alpha's standard WebView is **unavailable**. Standard WebView does not provide authoritative native per-field origins. The shared provider therefore requires the existing native
`PasswordAutofillPolicy.FIELD_ORIGIN` contract for every login field and refuses standard
WebView structures. A top-level URL alone cannot establish a field's origin or port.
Settings reports this limit; users can use native Show or Copy for saved website passwords.
Native-app Save and Fill remain separate supported paths. A future browser adapter must
provide engine-authenticated field origins and pass the full browser/iframe tests before
browser Autofill can be accepted.

`PasswordBrowserFillInstrumentedTest` checks the real framework's unavailable result for
standard top-level and cross-origin forms. Both standalone and launcher pass on API 35
with the reviewed upstream pin. The test temporarily disables augmented Autofill so the
selected provider’s null response produces an unavailable callback, then restores the
prior setting. It also verifies that synthetic edits do not produce a Save offer.
This rejection test does not establish successful browser filling.

## Other password providers (Proton Pass)
Alpha Settings → Password manager reports a read-only Android snapshot. The Browser menu opens the same detail page. The UI distinguishes an absent, disabled, publisher-unrecognized or verified Proton package; no provider, another provider, or Proton selection; and Android autofill availability. Unknown observations remain unknown. A selected package is named as verified Proton only when its publisher matches the pinned certificate. A disabled verified package is labeled disabled.

The original Proton publisher SHA256 is pinned in `config/native-apps.json`. Android's rotation-aware `PackageManager.hasSigningCertificate` verifies that identity; package visibility is limited to `proton.android.pass`. No vault, passwords, form contents or unlock state is queried or sent to the agent. These metadata observations can become stale, so launch/setup authenticates the package again and the UI refreshes on app resume or explicit Refresh.

Choose password provider opens Android's public provider picker when the verified provider and autofill are available. Missing picker handlers fall back to Android Settings with search guidance. Without a verified provider, the Settings handoff remains generic. Android owns confirmation, selection and cancellation. Alpha never sets secure settings, forces a grant, enables a service or treats opening the picker as successful selection. The install action opens Proton's official download page; it does not download/install an APK. Open Proton Pass requires the pinned publisher again at dispatch.

Browser-only builds explain that the browser/OS manages passwords, offer no fake native installation/selection controls, and cannot report Android provider state. Mock mode, which exists only in `ELIZA_DEV_ALLOW_TEST_MOCKS=1` builds, keeps its simulated UI and does not install the live setup adapter. The development sample password provider is likewise flag-only; production builds and distribution APKs show only the real Android provider status.

This is onboarding, not official-provider acceptance. The embedded Alpha browser is distinct from a browser on Proton's recognized-browser list. Preserve any provider warning. Setup does not establish password saving/filling, cross-origin matching, unlock/resume or release-signed/physical-device compatibility; those remain the password acceptance gates in `browser-autofill-integration.md` and the MVP completion plan. Alpha neither restyles nor bypasses provider-owned vault/security UI.

Primary references:

- [AutofillManager](https://developer.android.com/reference/android/view/autofill/AutofillManager): `isAutofillSupported` and `getAutofillServiceComponentName` report device/user support and selected service. `hasEnabledAutofillServices` is deliberately not used: it asks whether the calling app itself provides the selected service.
- [Android autofill setup](https://developer.android.com/identity/autofill/autofill-services): user enablement and public provider picker.
- [AOSP15 CredentialsPickerActivity](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/android15-release/src/com/android/settings/applications/credentials/CredentialsPickerActivity.java) and [Settings manifest](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/android15-release/AndroidManifest.xml): exported package-scheme request action routes into the combined picker. Alpha does not infer selection from activity results.
- [PackageManager signing verification](https://developer.android.com/reference/android/content/pm/PackageManager#hasSigningCertificate(java.lang.String,%20byte[],%20int)): publisher verification respects proof of signing-key rotation.
- [Proton Android setup](https://proton.me/support/pass-setup-android) and the pinned provider constraints in `browser-autofill-integration.md`.
