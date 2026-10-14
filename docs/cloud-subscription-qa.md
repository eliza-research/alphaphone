# Eliza Cloud sign-in and plan gate: staging QA

Owner requirement (October 2026): every Alpha Phone signs in to Eliza Cloud and holds a plan; a
subscription code grants six months. The phone's behaviour is specified in
[eliza-cloud-subscription-entitlement-contract.md](eliza-cloud-subscription-entitlement-contract.md);
the Cloud side is elizaOS/eliza PR #36125. This page lists the commands for an end-to-end run
against the staging Cloud. Nothing on this page has been run against a real account yet.

## What the staging mechanism is

Staging is reachable only in **test-mocks builds** (`ELIZA_DEV_ALLOW_TEST_MOCKS=1`), the repo's
existing staging switch. Distribution builds fold the staging authority away, and
`scripts/audit-production-bundle.mjs` refuses `api-staging.eliza.app`, `cloud-staging` and the QA
surface strings in a production bundle.

In a test-mocks build, **Subscription gate QA** runs the production sign-in and plan gate (not
the development chooser) against the environment you pick:

| | Staging | Production (test-mocks build) |
|---|---|---|
| API and entitlement issuer | `https://api-staging.eliza.app` | `https://api.eliza.app` |
| Sign-in page | `https://staging.eliza.app/auth/cli-login` | `https://eliza.app/auth/cli-login` |
| Choose a plan | `https://cloud-staging.eliza.app/cloud/billing` | `https://cloud.eliza.app/cloud/billing` |
| Secure slot | `cloud:staging` | `cloud:production` |
| After plan admission | Stops with "Plan admitted on staging (subscription gate QA)". The agent is not started: the native resident inference binding reads only `cloud:production`. | Android: binds the resident agent to Cloud inference and starts it, as in a distribution build. Browser: stops after admission. |

The hosts are the repo's configured authorities (`apps/app/src/runtime/cloud-protocol.ts`); that
the staging deployment serves PR #36125 with its entitlement signing keys and grant-code pepper set
is not verified here.

## Staging APK (test-mocks)

Inputs as in the README (pinned `vendor/eliza`, speech AAR, embedding host libraries).
`npm run android:build:inputs` lists anything missing.

```sh
npm ci
node scripts/android-build-preflight.mjs --before-prepare
npm run agent:build-embedding-host
npm run agent:prepare
npm run agent:build-workflow-worker
npm run agent:stage-android
npm run licenses:packaged-runtime
npm run android:build -- --test-mocks      # writes only artifacts/test-mocks/
npm run android:verify                       # distribution APKs, if built in the same tree
adb install -r artifacts/test-mocks/standalone-debug.apk
# or the Home-role variant:
adb install -r artifacts/test-mocks/launcher-debug.apk
```

`npm run android:build:local` runs the same preparation but always ends in a distribution
(flag-off) build, which cannot reach staging; use the sequence above for the QA APK. Never
install a test-mocks APK on a real user's phone.

On the phone: **Settings › Agent connection › Subscription gate QA**, choose **Staging**, then
**Start subscription gate QA**. The app reloads into the gate. **Leave subscription gate QA** at
the bottom of the gate returns to the development chooser.

## Dev UI against staging (browser)

```sh
npm run dev:ui                    # http://127.0.0.1:5317, test mocks on
```

Open `http://127.0.0.1:5317/`, then **Settings › Agent connection › Subscription gate QA ›
Staging › Start subscription gate QA**. Cloud requests go through the development Cloud bridge
(`scripts/browser-cloud-dev-bridge.ts`), which keeps the staging sign-in key on the Mac in
`$ALPHA_BROWSER_CLOUD_PROFILE` (default `~/.local/share/alphaphone/browser-cloud`) and never in
the browser. The bridge admits the plan routes (identity, entitlement and keys, billing snapshot,
code redemption) and nothing else new. The browser run stops after plan admission.

## End-to-end checklist

Run each on a fresh install (or after **Reset Alpha data**) and record the build, environment and
result. Use a staging account and staging codes minted with
`packages/cloud/scripts/admin/mint-subscription-grant-codes.ts` against the staging database; do
not reuse production codes.

1. First run shows **Welcome to Alpha** with **Sign in with Eliza Cloud** only; Back/Escape do not
   dismiss it.
2. Sign in. With no plan, the gate shows **Choose a plan** with Redeem code, Choose a plan and
   Check plan again; the agent does not start.
3. Redeem an invalid code: one generic answer. Redeem more than five times in 15 minutes: "Too
   many attempts. Try again in …" with Cloud's retry time.
4. Redeem a valid code: "Code redeemed for … It runs until …"; the plan is checked again and the
   gate admits (staging: the QA admission message; production: the agent starts).
5. Redeem the same code again on the same account: "already received" (no second grant).
6. **Choose a plan** opens exactly the billing page above in the system browser; returning to the
   app checks the plan again.
7. Settings › **Eliza Cloud account & plan** shows the account, plan, plan end, sign-in expiry,
   Redeem code, Manage plan and Sign out.
8. Revoke the grant with `revoke-subscription-grants.ts`; on the next return to the app or
   refresh, the gate shows **Choose a plan** or **Your plan has ended** and the agent stops.
9. Airplane mode after a successful admission, then relaunch: **Offline** notice, closable, local
   apps work, no agent. Airplane mode on a never-admitted sign-in: the gate stays.
10. **Reset Alpha data**: the local reset completes; the old key no longer authenticates
    (`GET /api/v1/user` with it returns 401) when Cloud was reachable.
11. Sign-in key expiry warning: shown within 14 days of the key's `expiresAt` (CLI keys last 90
    days); **Approve this phone again** opens a fresh sign-in.

## Automated coverage (no real account)

- `test/browser/native-cloud-subscription.spec.ts`: first-run gate, legacy local-only migration,
  every plan state, billing snapshot fallback, outage and offline grace, redeem success, invalid,
  rate-limited, already redeemed and transport replay, plan panel and Settings data, sign-in
  expiry warning (flag-off Android composition, synthetic native ports and ES256 tokens).
- `scripts/test-cloud-subscription.mjs`, `test/subscription-entitlement.test.mjs`: protocol and
  presentation; `test/connection-routes.test.mjs` with `test/fixtures/ConnectionRoutesTest.java`:
  native allowlist, reset revocation target, direct-provider gating.
- Production lane specs (`*.production.spec.ts`) run the flag-off bundle.

These are an APK-independent renderer and JVM check. They are not an emulator, device, staging or
real-account result.
