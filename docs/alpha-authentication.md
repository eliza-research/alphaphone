# Alpha Phone account authentication

Implementation date: October 19, 2026. This replaces the app's external Eliza
frontend login with Alpha-owned presentation and backend API calls. Deployment
and real-account acceptance are not yet established.

The account section in the app belongs to Alpha Compute / Alpha Phone. Its
Continue with Google action explicitly authorizes this phone to access the Cloud
account. Google uses an isolated Android Custom Tab, with an Alpha-colored
system toolbar, and returns to the app. Google's account chooser and consent
remain Google-controlled; embedding them in the privileged app WebView is not a
supported Google OAuth flow. No Eliza login frontend is opened, and no fallback
silently sends the user there.

The app creates random state and an S256 PKCE verifier, stores the pending attempt
in Android Keystore-encrypted storage, and opens the API worker's
`/steward/auth/oauth/google/authorize`. The backend owns Google's callback and
returns a one-time code in the fragment of the registered Alpha HTTPS app link.
The app verifies exact origin, path, environment and state, then exchanges the
code at `/steward/auth/oauth/exchange`. The interactive identity token completes
`/api/auth/cli-session/{server-issued-id}/complete`; the app retrieves the existing
single-consumption Cloud API credential through the CLI-session API and stores it
securely. The use of this backend API does not involve `/auth/cli-login` or any
frontend. It preserves the existing Cloud credential contract (currently a
90-day organization API key), rather than treating a Steward JWT as a Cloud API
key or adding another account store.

Only one login can run at a time. Cancellation, expiry, malformed responses,
provider denial and lost exchange responses cannot commit a new credential.
Pending state lasts ten minutes and survives process death before exchange.
A cold callback resumes from native encrypted storage without opening another
provider window. After single-use code exchange starts, an ambiguous failure
requires a new login; it is never automatically replayed. Callback URLs carry no
access/refresh tokens, are not logged, and never directly establish identity.
Existing Gmail permissions and dedicated-hosting approval remain separate from
account sign-in.

## Backend and domain deployment

Live read-only check on October 19, 2026: production and staging readiness
endpoints returned JSON 404. The apex account callback and asset association
URLs returned 308 redirects to `www.alphacompute.ai`; follow-up requests to www
returned 403 from this host. These observations do not establish global www
availability. The exact response record is
`docs/evidence/alpha-auth-live-readiness-2026-10-19.json`.

The website repository is `AlphaCompute/alpha-compute`. Its `prod` branch README
documents AWS App Runner hosting, with staging image validation before production
promotion. Its `next.config.ts` defines the apex-to-www redirect for every path.
The rollout must exempt the registered `/alphaphone/` callback/assets paths and
`/.well-known/assetlinks.json` from that redirect, and serve the prepared files
with their required headers. Merely adding static files is insufficient because
the redirect precedes file serving. Alternatively, changing to www requires a
coordinated change to every app/backend/Android/site binding and new verification;
do not mix the hosts. Vercel metadata exists in the website repository, but its
README identifies AWS as the deployed hosting path. Backend deployment ownership
and the distribution signing fingerprint remain unconfirmed.

The prepared `deployment/alpha-auth/website-next-config.patch` implements those
redirect exceptions, four static rewrites and callback privacy headers against
the inspected website config. Its adjacent README provides the asset-copy and
staging/promotion steps. A fixture test checks patch applicability and config
behavior; the website build, CDN behavior and signed domain association are
separate outstanding deployment checks.

The prepared callback host is `alphacompute.ai`, based on the product's existing
brand domain. Confirm ownership/deployment before rollout. Production uses
`https://alphacompute.ai/alphaphone/auth/callback`; staging uses
`https://alphacompute.ai/alphaphone/auth/staging/callback`. The corresponding API
origins are `api.eliza.app` / `api-staging.eliza.app`, with existing tenants
`elizacloud` / `elizacloud-staging`. These are fixed trusted values in
`apps/app/src/runtime/alpha-auth.ts`, not server-supplied arbitrary navigation.

1. Register the exact production return URL with the production Steward tenant
   and the exact staging URL with the staging tenant. Do not add wildcard
   redirects. Backend Google callback URLs remain backend-owned.
2. Review and apply `patches/eliza/alpha-auth-error-return.patch` to the backend
   source (tested against pinned commit
   `91dc19196c307eb8559b9b58de8dbf63eb47f43f`). Configure
   `STEWARD_OAUTH_APP_ERROR_REDIRECTS` to the exact Alpha return URL for each
   environment. This opt-in makes errors with validated server-owned state
   return directly to the app using the same fragment transport as success.
   Other apps retain existing error behavior. Missing/invalid server state cannot
   safely redirect to an unverified application. The patch is a backend deployment
   artifact; it is not applied to `vendor/eliza` or the Android resident runtime.
   Helper behavior and patch applicability are tested; full upstream route/DB
   integration tests and deployment review remain required.
3. Publish the callback assets and Android domain association on the Alpha domain.
   Run `node scripts/prepare-alpha-auth-site.mjs PUBLIC_CERT_SHA256` with the real
   distribution signing certificate's colon-separated fingerprint. Multiple
   approved certificates can be supplied. Both variants use the same package ID.
   Use a debug certificate only for an explicitly controlled development host/test;
   do not publish a development association as production signing approval.
   The generated `artifacts/alpha-auth-site` has static-host `_redirects` and
   `_headers`; other servers must reproduce these exact rewrites/headers. Serve
   both callback paths without changing them or adding a trailing slash, and
   serve `/.well-known/assetlinks.json` directly as JSON over HTTPS.
4. The fallback return page is Alpha-branded, strips URL credentials from history,
   loads no analytics and hands off to `alphaphone://auth/{environment}`. PKCE
   prevents an app intercepting that fallback from exchanging the code. Verified
   HTTPS App Links are the preferred distribution path.
5. The current rollout uses the existing Eliza Cloud Google OAuth configuration,
   as explicitly selected by the product owner on October 19, 2026. Alpha Phone
   owns the app screens and return pages; Google's consent screen retains the
   existing OAuth project's identity. Do not provision a dedicated Alpha client
   or apply `alpha-google-client.patch` for this rollout.

The current upstream implementation is [eliza PR #37129](https://github.com/elizaOS/eliza/pull/37129),
commit `61bf5e3fcb`, based on the current develop tree. It supersedes the prepared
pinned-source account readiness/client patches for deployment. The historical
patches remain reference artifacts and are not applied to `vendor/eliza`.

Before a new provider window opens, the app calls the read-only backend
`/steward/auth/oauth/google/alpha-readiness` endpoint. It requires contract version
1 with the exact tenant and return URL. The backend checks tenant login policy,
registered redirect, existing Google provider configuration and app error returns.
Missing or older deployments fail inside the Alpha screen. The response is not
cached and contains no credential. A returning pending callback can still exchange
its code without a second readiness request. Readiness is a configuration check,
not proof of domain association or provider availability.

Managed Gmail also retains the existing Eliza Cloud Google client, including
exchange and refresh for existing connections. Alpha callback contract version 2
returns the exact saved connection ID to the app for authenticated verification.
No dedicated Gmail client migration is required for this rollout.

Local upstream validation passed real PGlite account integration (16 tests), real
Gmail grant publication/callback integration (8 tests), full auth package tests,
auth/API/shared type checks, package lint and repository verification. Provider
HTTP and cache/secret-store boundaries in these integrations are synthetic.
These checks do not prove live Google sign-in or device acceptance.

Deployment remains in progress. The separate Steward Railway project must have
exact tenant redirects and `STEWARD_OAUTH_APP_ERROR_REDIRECTS` configured; confirm
its staging/production branch tracking before merging develop. The Alpha callback
website and Android association must be deployed and live returns qualified.

## Remaining callback scope

This change covers account Google sign-in, in-app scheduled-read consent and
the app-side managed Gmail handoff. The deployed backend's behavior is not
verified. Its pinned source defaults Gmail returns to Cloud frontend pages;
the explicit patch below must be reviewed, applied and configured before the
new app-side return flow can work live.

### Confirmed integration contracts

The following findings are from the pinned upstream source, not live endpoint
tests. They define the remaining work without weakening backend consent checks.

- Scheduled reads parse the agent's `/app-auth/authorize` URL as input data,
  without navigating to it. The backend exposes
  `GET /api/v1/app-auth/delegations/registration` for validating `appId`,
  `clientId`, `redirectUri` and `scopes`, followed by
  `POST /api/v1/app-auth/connect` with `flow: "app_delegation"` and those
  bindings. The latter requires a non-anonymous interactive session and rejects
  API-key authorization. The Alpha consent screen displays the registered app
  and requested scopes, and obtains explicit approval before this POST.
  It uses an interactive identity token and delivers the one-time code directly
  to the existing agent delegation completion contract. Account sign-in does
  not approve delegation. Persisted login state includes the agent and pending
  request purpose, so a cold delegation return cannot be consumed by ordinary
  account login. After process death, restoring the matching agent opens the
  scheduled-read screen when a valid Google return is retained. The screen
  resumes only an explicitly approved request, revalidates its registration,
  and completes the API handoff without another approval click. A changed
  registration requires a new review. Wrong-agent returns do not switch agents
  or approve access. Callback routing reads but never consumes the code.
- Managed Gmail initiation accepts `redirectUrl`, but
  `api/v1/oauth/generic-callback.ts` handles provider denial before loading
  server-owned OAuth state, and sends denial and processing failures to Cloud
  settings. Success checks `getDefaultPlatformRedirectOrigins()`; Alpha is not
  in its default list. Merely passing an Alpha URL in the app is insufficient.
  A reviewed backend change must recover and validate the original state on
  denial, permit exact Alpha return targets, consume state consistently, and
  return only bounded outcome markers. Unknown state cannot supply a trusted
  redirect destination. The app must verify the pending account and environment
  and refresh authenticated connector status; URL success markers alone must
  never establish that Gmail is connected.
- The account callback paths and parser implemented here deliberately accept
  only the account PKCE contract. Gmail's current `google_connected`, `platform`
  and `connection_id` query parameters are not compatible with it. Integration
  callbacks need their own explicit routes and pending-operation binding.

The backend side of this Gmail contract is now prepared as
`patches/eliza/alpha-gmail-return.patch`. It is opt-in through
`ALPHA_OAUTH_RETURN_URLS`, configured to exact callback URLs (proposed production
`https://alphacompute.ai/alphaphone/gmail/callback` and staging
`https://alphacompute.ai/alphaphone/gmail/staging/callback`). Initiation appends a
random `state` nonce. The returned fragment contains that nonce and a
`connected`, `denied` or `failed` result. Successful returns additionally include
the backend-issued `connectionId`; it is a lookup hint, never a credential. The app must independently refresh
authenticated connector status. The patch has not been deployed. App-side Gmail
return parsing, native routes and callback-site wiring are implemented. Unknown
or unavailable backend state cannot safely select an Alpha
return address and retains the existing backend fallback.

Gmail initiation now requires a fresh return nonce and supplies the exact Alpha
callback to the backend. The app persists environment, account, credential
generation, requested permission and ten-minute expiry in encrypted storage.
Google opens in a Custom Tab; no Eliza frontend is opened by the app. Matching
returns reopen Inbox after warm resume or account restoration. The app checks
authenticated connector capabilities on that exact returned connection before reporting success and never loads
mail automatically from a callback. Denial/failure clears the local attempt;
a failed status read preserves it for read-only retry. Cancelling an attempt
stops local waiting and does not revoke prior Google grants. An old account,
credential, environment or nonce cannot consume another attempt.
The patched initiation endpoint must explicitly return `alphaReturn: 2` for
the configured target; otherwise the app stops before opening Google. This
keeps older or unconfigured deployments from falling back to an Eliza frontend.
The fallback page also revalidates fragment changes on an already-open page and
removes any prior link before presenting a new one.

Gmail contract version 2 binds success to the backend-issued connector ID.
The authenticated status check requires that exact ID to be connected and have
the requested capabilities. An older connection cannot mask missing permissions
on the returned one. Inbox selects that connection rather than the first entry.
Denial/failure must not contain a connector ID; success without an ID is rejected.
The app requires `alphaReturn: 2` before opening Google, so version 1 deployments
stay in the app with an error until the matching backend patch is enabled.

Publish the two Gmail callback paths alongside the account paths. The same
Alpha static return page validates the separate Gmail fragment contract and
hands off to `alphaphone://gmail/{environment}`. Android has matching verified
HTTPS app-link and fallback intent filters for both distributions. Domain
association still requires the real distribution signing certificate.

Source references: upstream
`packages/cloud/api/v1/app-auth/connect/route.ts`,
`packages/cloud/api/v1/app-auth/delegations/registration/route.ts`,
`packages/cloud/api/v1/oauth/generic-callback.ts`, and
`packages/cloud/shared/src/lib/security/redirect-validation.ts`.
`apps/app/src/runtime/alpha-delegation.ts` implements the direct delegation
registry review and interactive-session approval API adapter. Its tests reject
untrusted origins, expanded permissions, altered app identity, wrong code types,
and aborted approval, and verify staging isolation and no automatic POST retry.
It is connected to the consent UI. Browser fixtures exercise explicit approval
after reload and agent-switch isolation during interactive authentication,
alongside existing code/status recovery and revocation scenarios. These fixtures
do not prove backend deployment or real Google consent. Live integration and
device acceptance remain required.

## Acceptance

Website routing follow-up: `npm run verify` passed 261 tests, TypeScript and the
web build. Both Android distributions passed debug/release builds, instrumentation
compilation, lint and APK inspection. The prepared website patch applies to the
inspected config; its config-hook test and an additional check using Next 16.4.0's
actual bundled path parser passed. The website itself was not built or deployed.
See `docs/evidence/alpha-auth-website-patch-2026-10-19.json` for parser/package
provenance and the remaining live gates.

Account-readiness follow-up: full `npm run verify` passed 260 tests, TypeScript
and the production web build. Five focused account/callback browser scenarios
passed. Both Android distributions passed debug/release builds, instrumentation
compilation, lint and APK inspection. Client tests cover missing/mismatched
readiness, cancellation before a late response, and cold callback recovery without
another provider window. The patched readiness handler is tested with synthetic
policy and redirect-registration boundaries. Backend deployment, live Google
consent, emulator HOME, AOSP boot and physical-device acceptance remain unverified.

Dedicated account-client follow-up: `npm run verify` passed 258 tests,
TypeScript and the web build. `npm run android:build` passed standalone and
launcher debug/release, instrumentation compilation, lint and APK inspection.
This backend-only patch is not included in the Android runtime and has not been
deployed. The focused patch test uses synthetic credentials and executes client
selection, not a real Google exchange. No emulator, AOSP or device qualification
was performed in this follow-up.

Gmail connection-binding follow-up: `npm run verify` passed all 257 tests,
TypeScript and the production web build. Five focused account/callback browser
scenarios passed. Both Android distributions built in debug and release, and
all four APK manifests retained the account and Gmail callback paths. The
multi-account fixture verifies that an older grant cannot satisfy the returned
connection's requested permissions and that Inbox selects the returned ID.
See `docs/evidence/alpha-gmail-connection-binding-2026-10-19.json` for current APK
hashes and qualification boundaries. This supersedes the earlier evidence's
remaining connector-ID gap; it does not establish deployment or live acceptance.

Run `npm run verify`, `npm run android:build` (both distributions, debug/release,
instrumentation compilation and lint), and the focused browser tests. Synthetic
protocol/browser tests prove local behavior, not real Google authorization.
Separately qualify live success, denial, cancellation, expiration, duplicate and
wrong-state callbacks, warm/cold launch, and process death on both distributions.
Verify installed-domain association with the actual signed APK. A build does not
prove emulator HOME-role behavior, an AOSP boot, real integrations or device/user
acceptance. Record those results separately.

## Local verification record — October 19, 2026

Gmail app wiring: final `npm run verify` passed 256/256, including type checking
and production web build. All 21 account/hosting/callback browser scenarios
passed with frozen source. Both Android variants built in debug/release with
instrumentation compilation and lint. The Inbox adapter fixture verifies cold
return routing, a failed permissions-read retry, and no automatic mail read.
The first browser run exposed a stale fallback link on fragment-only navigation;
the page now revalidates hash changes, and both environment tests passed.
See `docs/evidence/alpha-gmail-app-2026-10-19.json`. The multi-account connector
binding gap and live/deployment/device acceptance remain open.

Gmail backend preparation: patch applicability and the patched callback handler
passed tests with synthetic cache/provider/database boundaries, including
success, denial, missing code, provider failure, exact-target rejection and
recovery after a preliminary cache-read failure. The backend was not deployed
or tested against a real Google account. Both Android distributions built in
debug/release after adding this backend-only artifact; their runtime does not
apply the patch.
The ordinary `npm run verify` attempt passed 246/248 tests, with the same Maps
timeout and workflow-publication wait failures seen under disk contention. The
isolated recheck passed all five cases. A serialized full test run is used below
to check the complete suite without concurrent fixture processes; it does not
change the concurrent-writer behavior inside the publication test itself.
The serialized full run passed 247/248; the publication wait still failed.
This follow-up therefore does not claim a green full suite. Type checking,
the Gmail patch test and both Android builds passed; publication timing remains
an unresolved verification limitation outside the authentication changes.

Cold consent recovery follow-up: three routing tests reject unrelated,
wrong-state, expired and wrong-environment returns and preserve the callback for
its original operation. The delegation browser fixture also passed automatic
completion after reload for a previously approved request and refusal to approve
an unapproved review from a callback. An initial browser run timed out on its
first control before reaching these scenarios; the unchanged-code rerun passed.
This is simulated process-reload coverage, not physical Android process-death
or live Google acceptance.
The four existing scheduled-digest browser journey tests also passed. The first
full verification run had 245/247 passing: Maps fixture timeout and workflow
source-publication wait exhaustion were outside authentication. Their isolated
recheck passed all five cases. The final full `npm run verify` rerun passed
247/247 tests, TypeScript and the production web build. Final
`npm run android:build` passed standalone and launcher debug/release, including
instrumentation compilation, lint and APK inspection. These build results do
not prove an emulator HOME role, AOSP boot or live/provider/device acceptance.

Internal-consent UI follow-up: `npm run verify` passed with 244 tests. The
delegation browser fixture passed review/approval after reload, legacy callback
and status recovery, owner-switch isolation during interactive authentication,
and expiry before the approval POST. Its registered app and identity responses
are synthetic. The rendered review was inspected at 412px width.
The account/hosting regression run passed 20 scenarios; two navigation timeouts
(`quote-change` and `account-switch`) passed on a source-frozen recheck (2/2).
Their initial snapshots showed the home screen while waiting for connection
controls, not a consent API failure. Source refresh during the initial run is
a suspected cause; the recheck is the evidence for those two scenarios.
The final source-frozen `npm run android:build` passed for standalone and launcher
debug/release, with instrumentation compilation, lint and APK inspection. No
emulator or real Google consent was exercised by that build.

Follow-up delegation adapter verification: `npm run verify` passed with 243
tests (including six new direct-consent contract tests), TypeScript and the web
build. `npm run android:build` passed for both distributions in debug/release.
No consent UI change or live integration claim is covered by this follow-up.

- `npm run verify`: passed, 237 tests, TypeScript checking and production web build.
- Focused Playwright account, personal-hosting and packaging scenarios: 22 passed
  with `--timeout=90000`; the separate compact-viewport connection-dialog
  keyboard/theme test also passed. HTTP, native storage and provider responses
  in these account tests are disclosed fixtures.
- The auth-specific tests exercise PKCE, exact callback binding, staging
  isolation, cold pending-state recovery, denial, cancellation, malformed
  callbacks, late exchange responses, backend patch applicability and static-site
  signing association generation.
- Final `npm run android:build`: passed for standalone and launcher in debug
  and release, including instrumentation compilation, lint and APK inspection.
  Callback manifest inspection also passed for both distributions in debug and
  release. No emulator instrumentation was executed.
- No live Google sign-in, deployed Alpha callback, emulator HOME-role run, AOSP
  image boot or physical-device/user acceptance was performed for this change.

This host required explicit `ANDROID_HOME=/home/shaw/Android/Sdk` and
`JAVA_HOME=/usr/lib/jvm/java-21-openjdk`. Its pre-existing default runtime source
was interrupted; it was preserved. A fresh immutable copy was prepared with:

```sh
ALPHA_LOCAL_AGENT_SOURCE_DIR="$PWD/artifacts/alpha-auth-runtime-source" \
ALPHA_RUNTIME_GIT_CACHE="$PWD/vendor/eliza" \
node scripts/prepare-local-agent.mjs --source-only

ALPHA_LOCAL_AGENT_SOURCE_DIR="$PWD/artifacts/alpha-auth-runtime-source" \
ANDROID_HOME=/home/shaw/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk \
npm run android:build
```

Early runs exposed a missing test-harness auth dependency (fixed), an expired
account section collapsing its recovery controls (fixed), a development-server
reload while source was being edited (rerun with frozen source), and disk-bound
fixture timeouts (isolated rechecks and the final full verify passed). The final
passing runs above supersede those early failures.
