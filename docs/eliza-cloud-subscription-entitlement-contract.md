# Eliza Cloud subscription entitlement and plan gate (issue #410)

Status: proposal. This file describes the Alpha phone's side and what the Eliza Cloud server
must provide. The Cloud server work belongs to the Eliza Cloud repository and is not done here.
No price, plan allowance, entitlement lifetime or burst/sustained limit is chosen in this file.
Those values come from measured provider cost and pilot traffic, and the owner selects them.

Alpha source: `apps/app/src/runtime/subscription-entitlement.ts`, `cloud-protocol.ts`
(`subscriptionEntitlement`, `subscriptionEntitlementKeys`, `openSubscriptionManagement`) and
`connection-ui.tsx` (`admitCloudResident`). Tests: `test/subscription-entitlement.test.mjs` and
`test/browser/native-cloud-subscription.spec.ts`.

## Principles (policy P-26)

- Billing is a subscription with server-side rate limits. The phone shows no credit balance,
  top-up or per-token meter.
- An assistant turn never waits on a billing service. Cloud authorises each inference or Maps
  request from its own cached quota or token bucket.
- Every Alpha Phone signs in to Eliza Cloud and holds a plan (owner decision, October 2026). The
  plan gate runs at admission and on return to the app; a turn never does.
- Once a plan was verified on the phone recently, local apps, on-device speech and local tools do
  not depend on an online billing check (offline grace, section 4).
- Nothing is purchased automatically: no overage purchase, upgrade or retry that spends money.

## 1. Entitlement read

`GET https://api.eliza.app/api/v1/subscription/entitlement`
with `Authorization: Bearer <the phone's Cloud CLI key>` and `Accept: application/json`.

- `200 {"entitlement": "<compact JWS>"}` returns the current entitlement. The JWS is at most
  8192 characters.
- `401` means the sign-in is invalid. The phone shows the sign-in action.
- `404`, `405` or `501` means the route is not deployed. The phone then reads the subscription
  section of `GET /api/v1/billing/limits` (section 4).
- Any other status, or a transport failure, is a billing outage (section 4).

The phone reads the entitlement when the resident agent is admitted, then refreshes it in the
background. It never reads it once per turn.

### JWS header

`{"alg":"ES256","typ":"eliza-entitlement+jwt","kid":"<key id>"}`. The phone refuses any other
`alg` or `typ`, and any header that carries `crit`.

### Claims

| Claim | Required | Meaning |
|---|---|---|
| `iss` | yes | Exactly the Cloud API origin, `https://api.eliza.app` |
| `aud` | yes | `eliza-alpha-phone`, either as a string or inside an array |
| `sub` | yes | Cloud user id. It must equal `GET /api/v1/user` `data.id` |
| `org` | when the user has one | It must equal `data.organization_id`. When the user has none, omit it |
| `jti` | yes | Entitlement id, used for idempotent accounting and audit |
| `iat`, `exp` | yes | Times in epoch seconds. The phone allows at most 60 minutes from `iat` to `exp` (an engineering ceiling, not a billing value) and a clock skew of 60 seconds |
| `nbf` | no | Epoch seconds |
| `rfa` | no | Suggested refresh time in epoch seconds, between `iat` and `exp`. Without it, the phone refreshes after 75% of the lifetime |
| `plan` | yes | `{id, name, status}` with `status` one of `active`, `trialing`, `past_due`, `canceled`, `none` |
| `allowance` | no | `{unit: "requests"|"tokens", period: "day"|"week"|"month", limit?: int, used?: int, resetsAt?: epoch seconds}`. The phone shows only the numbers that are present |
| `services` | no | The managed services covered, e.g. `["inference","maps"]` |

The phone verifies the signature before it trusts any claim.

## 2. Verification keys

`GET https://api.eliza.app/api/v1/subscription/entitlement-keys` (no authentication) returns
`{"keys":[JWK,...]}`, at most 16 keys. Each key is a public EC P-256 key with `kid`, `x` and `y`,
and never `d`. The phone caches the keys per issuer for one hour. It fetches them again when an
entitlement names an unknown `kid`, which makes key rotation safe.

## 3. Enforcement and usage (server only)

- Inference (`/api/v1` OpenAI-compatible, used by the resident agent through
  `ELIZAOS_CLOUD_BASE_URL`) and Maps check the caller's quota against a server-side cache or
  token bucket. These checks must not add a synchronous request to the billing service on each
  call.
- Usage is sent asynchronously, keyed by request id, so accounting stays idempotent.
- Revocation takes effect on the server immediately. The phone shows it on its next refresh.
- The phone does not send the entitlement with inference requests. At the pinned revision, the
  upstream `@elizaos/plugin-elizacloud` OpenAI client adds only `Idempotency-Key` and the
  native-application slot headers (`applyNativeApplicationInferenceHeaders` in
  `@elizaos/cloud-sdk`). It has no hook for an entitlement. If Cloud later wants the token on
  each request, that hook must be added upstream first. Cloud can key usage records on the
  `Idempotency-Key` that the client already sends when it has an operation id.

### Refusal bodies

The native transport returns the status and the JSON body only. It does not return headers, so
Cloud must also put any `Retry-After` value in the body:

| Situation | Status | Body |
|---|---|---|
| Burst or sustained rate limit | 429 | `{"error":"rate_limited","retryAfterSeconds":N}` (or `retryAfterMs`, or `retryAt` as ISO time) |
| Period allowance used up | 429 | `{"error":{"code":"allowance_exhausted","resetsAt":"<ISO>"}}` |
| No active plan | 402 | `{"error":"subscription_required"}` |

On a direct HTTP refusal the phone reads these bodies and tells the owner when to retry. It never
retries the message or buys anything.

The resident agent's reply path is narrower. At the pinned upstream revision the agent reports a
refused turn as `failureKind` / `terminalFailure.kind` from upstream `CHAT_FAILURE_KINDS`
(`packages/contracts/src/contracts/chat.ts`), and `terminalFailureContentValue` in
`packages/agent/src/api/chat-routes.ts` keeps only `kind`, `message`, `transient` and `code`.
So on that path:

| Upstream reply | Phone copy |
|---|---|
| `insufficient_credits` (how upstream reports a Cloud 402 today) | Neutral: Eliza Cloud declined the request for the account's billing; check the account in Settings. It does not claim a plan is missing, because the kind does not say whether the plan is missing or its usage is spent |
| `insufficient_credits` with `code` `allowance_exhausted` or `subscription_required` | The specific allowance or no-plan copy |
| `rate_limited` | Rate-limit copy with "wait a moment"; no countdown |
| any other kind | "The agent could not complete this response." |

`retryAfterMs`, `retryAt` and `resetsAt` cannot reach the phone on the reply path until upstream
`ChatTerminalFailure` carries them. That needs an upstream change. Until then the phone shows
retry and reset times only for direct HTTP refusals.

## 4. Phone behaviour by condition

Cloud side: elizaOS/eliza PR #36125 (`POST /api/v1/subscription/redeem`, the entitlement and key
routes, refusal bodies with `retryAfterSeconds`, 402 `allowance_exhausted` with `resetsAt`).

| Condition | Phone result | Agent admitted |
|---|---|---|
| No saved sign-in (first run, signed out) | Sign-in gate. No local-only bypass; the dialog cannot be dismissed | no |
| Valid entitlement, plan `active` or `trialing` | Plan name and the Cloud allowance | yes |
| Valid entitlement, plan `past_due` | Plan name, "Payment is past due" warning and "Manage plan in Eliza Cloud" | yes |
| Valid entitlement, plan `canceled` or `none` | "Needs plan" gate: "<plan> has ended" or "No active plan", with Redeem code, Choose a plan (hosted page) and Check plan again | no |
| Route absent (404/405/501) | `GET /api/v1/billing/limits`, `data.v2.subscription`: `trialing`/`active` admit, `grace`/`past_due`/`unpaid` admit with the warning, `canceled`/`incomplete_expired`/`not_applicable` need a plan | as mapped |
| Route absent and the billing snapshot is absent or reports no known state | "Plan status unavailable" with Check plan again, Redeem code and Choose a plan | no |
| Billing outage (5xx, timeout) after identity succeeded | Admitted when this sign-in had an admitting plan verified within the last 7 days ("Plan status unavailable"); otherwise the needs-plan gate with a retry | as stated |
| Cloud unreachable at start (identity read fails in transport) | With a plan verified for this sign-in within 7 days: "Offline" notice, closable; local apps and on-device speech work, no agent starts. Otherwise the sign-in gate with the error | no |
| Bad signature, unknown key or bad claims | Reported as unavailable (`invalid`), never trusted; needs-plan gate with a retry | no |
| Entitlement issued for another account, at admission | An error asking the owner to sign in again | no |
| Plan reported `canceled`/`none` by a background refresh or a return to the app | The resident agent is stopped and the needs-plan gate is shown | stopped |
| Entitlement issued for another account, during background refresh | Refresh stops, the Cloud-bound resident agent is stopped, the Cloud account is detached and the same sign-in error is shown | stopped |
| A verified entitlement lapses while refreshes fail | "Plan status is out of date" (`expired`), kept on every later failed refresh until a check succeeds | unchanged; Cloud decides |
| Sign-in rejected (401), at admission | Sign-in action | no |
| Sign-in rejected (401), during background refresh | Same as an account mismatch during refresh: agent stopped, sign-in shown | stopped |
| Cloud sign-in key expires within 14 days (`expiresAt` from the CLI login) | Warning in the account panel and Settings, with "Approve this phone again" (a fresh CLI sign-in) | unchanged |

The 7-day offline grace is an engineering bound for offline use, not a billing decision: Cloud
refuses every AI request without a plan. The record behind it (`alpha.connection.plan-admission.v1`)
holds the environment, local credential generation id, user and organization ids, plan name and
status, and the verification time; no credential.

Background refresh happens at `rfa`, or after 75% of the lifetime. After a failure it retries
after 30 s, then doubles the wait up to 5 minutes. It also runs when the owner returns to the app.
It stops whenever the Cloud account is detached (every sign-out, expiry, account change or
re-admission path), on a plan with no access, on a rejected sign-in or account mismatch, or when
the plan state came from the billing snapshot.

## 5. Subscription codes

`POST /api/v1/subscription/redeem` with the phone's Cloud CLI key and
`{"code": "<normalized>", "idempotencyKey": "<UUID>"}`.

- The phone normalizes like Cloud (trim, upper case, remove spaces and hyphens, O→0, I/L→1) and
  refuses text that cannot be a 16–64 character code locally, with the same generic copy.
- Each owner submission gets a fresh idempotency key. Only a transport failure (the request may
  have arrived) is retried, once, with the same key; Cloud answers a replay with the original grant.
- `400` (unknown, expired, disabled, used up or malformed): "This code could not be redeemed."
  `409 subscription_grant_already_redeemed`: already received. `429`: "Too many attempts. Try
  again in …" from `retryAfterSeconds`. `403`: account copy. Anything else: try again later.
- The code is never logged, stored, put in an error or echoed.
- On success the phone reads the entitlement again and admits the agent when the plan allows.
  When a paid plan takes precedence, the copy says so.

The native transport and the renderer allowlist admit exactly this POST (body required, no query),
and `GET /api/v1/billing/limits`. The credit balance route is no longer admitted.

## 6. Plan management

"Choose a plan" (needs plan) and "Manage plan in Eliza Cloud" (past due, Settings) open exactly
`https://cloud.eliza.app/cloud/billing` (staging QA: `https://cloud-staging.eliza.app/cloud/billing`)
in the system browser. The phone creates no checkout, upgrade or purchase, and checks the plan
again when the owner returns.

Settings › Eliza Cloud account & plan shows the account, plan, the plan's end when Cloud reported
it (billing snapshot period end or redeemed grant end), the sign-in expiry, and Redeem code,
Manage plan and Sign out. Reset Alpha data asks Cloud to revoke this phone's key
(`DELETE /api/v1/api-keys/current`, one attempt, 3 s timeouts, 8 s overall deadline) after the
reset is recorded; a failure never blocks the local reset.

## Gates that remain open

- elizaOS/eliza PR #36125 implements redemption, entitlement issuance, signing keys and the
  refusal bodies on `develop`. Whether production and staging have deployed it, with the
  `ELIZA_ENTITLEMENT_*` and grant-code pepper secrets set, is not verified here.
- No real-account end-to-end run (sign-in, redeem a real staging code, plan gate, agent admission)
  has been made; docs/cloud-subscription-qa.md lists the commands.
- No p50/p95 latency benchmark has been run under the normal, cache-miss, exhausted, expired and
  billing-outage conditions. It needs the deployed Cloud.
- The numeric burst and sustained limits, the allowance and the price are not selected. They must
  be proposed from measured provider cost and pilot traffic, and the owner decides them.
- Retry and reset times on the resident-agent reply path need upstream `ChatTerminalFailure` to
  carry them.
- No real Cloud account, Android device or AOSP image was used for acceptance.
