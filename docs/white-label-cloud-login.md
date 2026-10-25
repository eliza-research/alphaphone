# App-owned login and configurable Cloud APIs

Review date: October 21, 2026 (Pacific).
Reviewed PR: https://github.com/elizaOS/eliza/pull/36966 at
`0232e112a98908ad418beedb16b4eb1f5ff1dee3`.

## Review and disposition

The PR adds `/alpha/sign-in`, `/alpha/auth/cli-login`, Alpha legal wrappers,
logos and fonts to the shared Cloud renderer. It also adds useful provider
selection and mobile phone/email presentation. Product pages, assets and routing
belong in Alpha Phone; the shared backend must authenticate registered apps
without a product switch. The original PR is closed without merging.

| PR behavior | Alpha Phone implementation |
| --- | --- |
| Google-first login | App-owned connection dialog and backend PKCE exchange; Google uses an isolated system Custom Tab |
| Phone/email disclosure | `cloud-login-ui.tsx`, server-discovered methods and direct email/SMS code APIs |
| Existing enabled-method policy | `cloud-login.ts`; disabled providers cannot send codes; backend remains authoritative |
| SMS / email verification | Explicit send and verify, bounded code entry, expiry and cancellation; SMS/TOTP MFA and TOTP recovery codes are preserved |
| CLI completion and polling | Existing `CloudProtocol.login`, now accepting either Google or code-authenticated interactive identity |
| Terms / Privacy with return | App-owned readable legal sections, preserving login state; bundled backend legal wording and provenance in `cloud-legal-content.json` |
| Branding and focus styles | Alpha renderer CSS; no Alpha assets are added to shared Eliza UI |
| Consent and callback recovery | Existing account PKCE and registered-app delegation review; separate Gmail account/connection binding |

This is a Capacitor app-owned renderer view, not an embedded remote Cloud login
page. Google credentials are entered only in Google's isolated account chooser.
No real login messages, provider grants or paid operations were sent during tests.

## Deployment configuration

Edit `apps/app/src/runtime/cloud-deployment.json` before building. Production
and staging independently select the HTTPS API origin, dedicated-agent DNS
suffix, tenant and recognized delegation authorization origins. Defaults remain
`https://api.eliza.app` and `https://api-staging.eliza.app`. Android's BuildConfig
reads this same file, so account requests, voice, paired speech and background
result delivery use the same deployment. This is release configuration, not a
URL parameter or untrusted callback override.

Changing API origin or tenant selects a separate encrypted credential slot.
Default installed accounts retain their existing slots. Pending Google exchanges
are bound to deployment as well as environment, purpose and state. Dedicated
runtime URLs remain constrained to the configured agent suffix; shared runtime
URLs remain constrained to the configured API origin and exact agent route.
Rebuild both APK distributions after changing configuration. Configure the same
backend API contracts and register the app's exact HTTPS return URLs on that
backend. Alpha's app links remain product-owned; another app supplies its own
package, verified callbacks, consent presentation and legal documents.

Legal text retains the service's identity intentionally: changing a logo or API
origin does not rewrite a service operator's terms. A different deployment needs
its operator's actual legal content in `cloud-legal-content.json`.

## Shared backend replacement

`patches/eliza/white-label-app-auth.patch` targets upstream develop commit
`97d8024b3d5d2763536236719e125c2723717817`; preimage hashes are recorded alongside
it. It is backend-only and is not applied to `vendor/eliza` or the phone runtime.
The submodule remains untouched.

The patch replaces the Alpha-only readiness route with
`/steward/auth/oauth/google/app-readiness`, returning `appAuth: 1`. It accepts
registered HTTPS callbacks for any tenant, subject to existing tenant policy,
redirect registration, provider availability, rate limits and exact error-return
configuration. It neither issues tokens nor relaxes OAuth checks.

Managed connector callbacks use `APP_OAUTH_RETURN_URLS` and `appReturn: 2`.
The exact callback URLs are deployment data. The app requires the generic
contracts and fails closed against an older backend. Deploy the backend change
and migrate the environment variable before releasing this app build. Retain
other applications' exact callback registrations when updating deployment data.
The patch passes 17 upstream OAuth router/PGlite integration tests and eight
Gmail/PGlite tests. Ten existing native email-code integration tests also pass.
Provider boundaries are synthetic; these are not live provider acceptance. Local
tests also apply the readiness patch to an upstream preimage and execute the
handler with synthetic policy boundaries.

Historical Alpha patches under `patches/eliza` are retained as provenance and
are superseded for this direction. They are not the release implementation.

Existing upstream tenant configuration already supports themes (including logo,
font and colors) through `TenantTheme` in
`packages/auth/src/server/shared/index.ts`, and tenant-specific email brand names
and templates through `auth-lifecycle.ts` and `auth/email-templates/custom.ts`.
Use those configuration contracts for each operator rather than adding product
branches. This audit confirms those code paths exist; it does not establish that
a deployed tenant has configured every branding field.

## Remaining functionality and acceptance

- CAPTCHA-required code methods now use a dedicated Android verification WebView
  with app-owned hosting assets and no native bridge. Turnstile/hCaptcha results
  are passed once to the existing Cloud API. The hosting page, CSP and provider
  hostname registration must be deployed and qualified; live acceptance is open.
  No challenge is bypassed. Google SMS/TOTP MFA returns through a PKCE-bound exchange and
  completes in the app-owned verification dialog, including TOTP recovery codes.
  Current backend login responses issue SMS or TOTP challenges; passkey
  verification is a separate authenticated step-up API and is not implemented
  by this login migration. Unexpected challenge types are refused.
- Email uses the existing `/steward/auth/email/code/send` API. It requests a
  code-only email, so no browser magic link can consume the challenge or redirect
  the user to a shared frontend. The app requires the explicit six-digit code
  contract. Older backends lacking this API fail closed and need upgrading.
- Generic backend patch review, upstream full checks and deployment remain open.
  Existing tenant callback registration and rollout requirements still apply.
- The legal copy is a bundled snapshot, not a claim of current operator approval.
- Real Google/SMS/email sign-in, signed Android app-link association, warm/cold
  device returns and user acceptance remain unverified. APK compilation does not
  prove emulator HOME-role behavior, full AOSP boot or real integrations.

The original PR's closure is an architecture decision, not a claim that these
remaining gates are complete.

## Verification checkpoint

`npm run verify` passed 274 tests (with reduced process concurrency after two
load-related fixture timeouts), type checking and the web build. A subsequent
Cloud protocol fixture passed after the transient authentication callback change.
The final `npm run android:build` passed standalone and launcher debug/release,
instrumentation compilation, lint and all four APK inspections. The five focused
account/callback browser scenarios and all three Google MFA scenarios (including recovery codes) passed; the broader
regression suite was not clean under heavy host load.

The separate upstream checkout at `/home/shaw/Work/eliza-white-label-app-auth`
passed 17 actual OAuth router/PGlite integration tests. Provider boundaries in
those tests remain synthetic. The auth package typecheck and lint also passed. Root verification passed all 309 tasks, the Cloud Worker dry run and final
repository audits at the rebased PR head. The replacement is draft [PR #37240](https://github.com/elizaOS/eliza/pull/37240),
head `53d93e30e1c89060210c5d8b0b150e9c530c1ca3`. All 35 focused backend tests
passed again at that head. Nothing has been deployed. Evidence and APK hashes are in
[evidence/white-label-cloud-login-2026-10-21.json](evidence/white-label-cloud-login-2026-10-21.json).

### CAPTCHA follow-up checkpoint

The app now has an isolated `AlphaCaptcha` WebView and a `verificationPage` release
setting. The page is product-owned, receives only public sitekey/provider/action
and a nonce, and strips its configuration fragment before loading provider code.
Native cancellation, expiry, navigation checks and request ownership gate the
result. No provider script is loaded into the Capacitor renderer. Tokens are not
written to secure storage or website query strings. Server-side verification is
still performed by the Cloud email/SMS endpoint.

The website candidate is based on current `staging`, which contains the deployed
callback/no-transform changes absent from `master`; it must be reviewed and
qualified on staging before promotion. The public sitekey must permit the page
hostname. The app implementation and synthetic tests do not prove that live
registration, deployment, or Android provider acceptance has happened.

Hosting candidate: [Alpha website PR #74](https://github.com/AlphaCompute/alpha-compute/pull/74),
head `238b647055e573b9a246e2f0053242c0941210f5`. Its 25 tests and production build
passed using a local fixture database, with CMS fallbacks. The built Next server
served all verification assets byte-for-byte with the intended headers and kept
the account callback CSP strict. Three provider-page fixtures passed under that
CSP, and both app account UI fixtures passed. These are not live CAPTCHA or
Android device acceptance. Read-only command-line Cloud provider probes returned Cloudflare 403/1010
(`browser_signature_banned`), not a demonstrated tenant authentication error.
All six reported GitHub checks passed on backend PR #37240 at its reviewed head;
the website draft has no reported CI checks.

### Scope audit against the closed PR

The reviewed `alpha-sign-in-page.tsx` explicitly used
`<StewardLoginSection allowedMethods={["google", "email", "sms"]} />`.
Its selector explicitly disabled passkeys and filtered other OAuth providers.
The app migration preserves that three-method scope; the generic backend keeps
other applications' authentication methods intact. The normal shared Cloud
login page showing more methods does not expand this PR's Alpha presentation.

A connected Pixel 10a currently has Alpha installed under `/product/app/AlphaPhone`
(version code 6), not the candidate APK. A disposable API 35 emulator was
used for native verification tests; this does not qualify the installed phone
image or establish live provider acceptance.

### Native transport qualification

The actual Android transport exposed a missing `X-Steward-Tenant` allowlist entry
that browser fixtures did not exercise. The bridge now accepts that header with
`[A-Za-z0-9_-]{1,100}` validation. A native fixture test passed, observed exactly
one correctly scoped request, and verified that an invalid tenant is rejected
before HTTP. On the rebuilt standalone debug APK, real read-only provider
discovery returned HTTP 200 from both staging and production, with Google, email
and SMS enabled. The command-line Cloudflare rejection does not affect these
observed Android discovery requests. No account sign-in or OTP send occurred.

Three real Android CAPTCHA lifecycle tests passed: bound main-frame settlement,
rejection of wrong state/off-origin callbacks, and owned cancellation/expiry.
They use fixture result tokens and do not establish live provider acceptance.
Full `npm run verify` passed 274 tests, typecheck and web build;
`npm run android:build` passed both distribution variants, debug/release builds,
instrumentation compilation, lint and all four APK inspections.

The remaining rollout gate is unchanged: review/deploy the generic backend and
verification hosting candidates, register the provider hostname/sitekeys as
needed, then perform authorized live login/MFA/CAPTCHA and device acceptance.
Neither draft PR has been merged or deployed by this work. An authenticated
tenant-admin session is still needed for those checks.

### October 22 live follow-up

The user authorized live tests using their own phone and email. One production
website SMS attempt returned “SMS verification is temporarily unavailable”; no
success is claimed. One production email-link request reached the waiting screen.
The user must complete that link privately. A separate staging code-only email
request through the actual Android transport succeeded and returned codeLength 6.
This proves the server accepted the delivery request, not inbox receipt or sign-in.
Empty-body code-route probes returned expected HTTP 400 on both environments.

Backend PR #37240 was merged externally at `35b4dda6b6c5599a3b9641eb63f42c2340acf48c`
on October 21 Pacific (October 22 04:40:36 UTC). Main contains that commit, but the
generic Google app-readiness route still returns HTTP 404 from both live APIs.
The source merge therefore has not established that the Steward service deployed
the route. Railway CLI is unauthorized; its browser is unauthenticated and shows
a platform outage. Do not bypass the deployment gates or widen auth policy.

The verification-hosting candidate was refreshed against current staging, and
Next plus matching packages were patched to 16.4.2 after a confirmed security
advisory blocked the build. DOMPurify was patched to 3.4.17. All 25 website tests,
the fixture-backed production build and exact-byte/header checks passed.
Staging deployment and later production qualification are tracked separately.

Hosting PR #74 merged into staging at
`860e4ff5b553b6afe839e06c4f56405174ae95cf`; rollout run
[39881629787](https://github.com/AlphaCompute/alpha-compute/actions/runs/39881629787)
is the qualification target. Production promotion includes existing staging
newsroom/category, error/status-page, newsletter-template and discovery-metadata
changes; these must be included in the promotion review rather than described as
an auth-only deployment. No production promotion has occurred in this follow-up.

The staging rollout succeeded. `/api/version` reports
`860e4ff5b553b6afe839e06c4f56405174ae95cf`; two complete live checks passed
all three verification assets byte-for-byte, required privacy/security headers,
and the preserved strict account-callback CSP. An initial transition request
failed before the subsequent clean probes. Production promotion is prepared as
[PR #75](https://github.com/AlphaCompute/alpha-compute/pull/75), awaiting approval
of its broader existing staging changes. This is hosting qualification, not live
CAPTCHA or authenticated account acceptance.

A later browser observation showed `cloud.eliza.app/login?returnTo=%2Fcloud`
with another sign-in form. Whether the user completed the emailed production
link is unconfirmed; no authenticated session is claimed.

### October 23 app-focused continuation

Cloud website sign-in is diagnostic/admin access only; it is not a prerequisite
for Alpha Phone account sign-in. Email/SMS codes and MFA belong in the app.
Provider discovery currently returns HTTP 200 in both environments, while the
registered Google app-readiness endpoint returns HTTP 404 in each. Railway CLI
remains unauthorized. No additional live email/SMS was sent in this follow-up.

`node scripts/check-cloud-login-readiness.mjs` performs bounded public GET-only
probes against the configured deployments, checks the exact Google tenant and
callback contract, and returns exit code 1 until readiness passes. It outputs
only public status/boolean fields; it never emits raw API responses, sends codes,
authenticates, or follows redirects. A successful probe is not login acceptance.

App code-login errors now distinguish temporary backend failure and an unsupported
in-app endpoint from invalid account input. Server diagnostic bodies remain hidden.
The regression test covers outage, unsupported endpoint and rate-limit messaging.

The user authorized automation. An hourly chat follow-up named “Finish Alpha Phone
native login” rechecks blockers and continues actionable fixes, staying quiet on
unchanged/non-actionable results. It must not repeatedly send codes or broaden a
production promotion merely because staging has advanced. User-owned sign-in is
completed locally; login codes and tokens are never requested or stored in evidence.
