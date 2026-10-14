# Eliza Cloud subscription entitlement: proposed contract (issue #410)

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
- Local apps, on-device speech and local tools never depend on an online billing check.
- Nothing is purchased automatically: no overage purchase, upgrade or retry that spends money.

## 1. Entitlement read

`GET https://api.eliza.app/api/v1/subscription/entitlement`
with `Authorization: Bearer <the phone's Cloud CLI key>` and `Accept: application/json`.

- `200 {"entitlement": "<compact JWS>"}` returns the current entitlement. The JWS is at most
  8192 characters.
- `401` means the sign-in is invalid. The phone shows the sign-in action.
- `404`, `405` or `501` means the route is not deployed. The phone then uses the transitional
  account check (section 5).
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

| Condition | Phone result | Agent admitted |
|---|---|---|
| Valid entitlement, plan `active`, `trialing` or `past_due` | Plan name and the Cloud allowance. For `past_due`, also a link to manage the plan | yes |
| Valid entitlement, plan `canceled` or `none` | "No active plan" or "<plan> has ended", with a link to manage the plan in Eliza Cloud. Local orchestration and schedules stay running; Cloud enforces AI access | yes |
| Route not deployed (404) and the transitional account check fails (section 5) | "AI is unavailable for this Eliza Cloud account", with "Open Eliza Cloud billing". No plan wording; local orchestration stays running | yes |
| Billing outage (5xx, timeout, offline) | "Plan status unavailable"; Cloud still decides each request | yes |
| Bad signature, unknown key or bad claims | Reported as unavailable (`invalid`) and never trusted | yes |
| Entitlement issued for another account, at admission | An error asking the owner to sign in again | no |
| Entitlement issued for another account, during background refresh | Refresh stops, the Cloud-bound resident agent is stopped, the Cloud account is detached and the same sign-in error is shown | stopped |
| A verified entitlement lapses while refreshes fail | "Plan status is out of date" (`expired`), kept on every later failed refresh until a check succeeds | unchanged; Cloud decides |
| Sign-in rejected (401), at admission | Sign-in action | no |
| Sign-in rejected (401), during background refresh | Same as an account mismatch during refresh: agent stopped, sign-in shown | stopped |

Background refresh happens at `rfa`, or after 75% of the lifetime. After a failure it retries
after 30 s, then doubles the wait up to 5 minutes. It stops whenever the Cloud account is detached
(every sign-out, expiry, account change or re-admission path), on a plan with no access, on a
rejected sign-in or account mismatch, or when Cloud returns 404 for the route.

## 5. Transitional account check

Until Cloud deploys section 1, a `404` sends the phone to the existing
`GET /api/v1/credits/balance` endpoint. A balance of zero or less displays
the neutral account copy in section 4; the phone never shows the balance. Against deployed Cloud
this account status does not gate the resident runtime, and the billing link opens Cloud's
existing credit billing page. The plan copy applies only once Cloud issues entitlements. Remove
this path once the entitlement route ships.

## 6. Plan management

"Manage plan in Eliza Cloud" (entitlement source) and "Open Eliza Cloud billing" (transitional
account check) both open Cloud's hosted page at `https://cloud.eliza.app/cloud/billing` in the
system browser. Today that page is Cloud's credit billing page. The phone creates no checkout,
upgrade or purchase.

## Gates that remain open

- Eliza Cloud has not implemented sections 1 to 3: entitlement issuance, signing keys, cached
  quotas and token buckets, asynchronous idempotent usage records, or refusal bodies.
- No p50/p95 latency benchmark has been run under the normal, cache-miss, exhausted, expired and
  billing-outage conditions. It needs the deployed Cloud.
- The numeric burst and sustained limits, the allowance and the price are not selected. They must
  be proposed from measured provider cost and pilot traffic, and the owner decides them.
- Retry and reset times on the resident-agent reply path need upstream `ChatTerminalFailure` to
  carry them.
- No real Cloud account, Android device or AOSP image was used for acceptance.
