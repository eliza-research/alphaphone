# Alpha authentication completion audit

> Historical pre-deployment audit. The October 19 deployment request now uses
> the existing Eliza Cloud OAuth client by explicit owner decision. Dedicated
> Alpha Google/Gmail consent projects are not current rollout requirements.
> The production signing fingerprint has been located, backend PR #37129 is
> implemented and locally verified, and website PRs #70/#72 are merged to staging.
> Current rollout and remaining acceptance gates: [rollout status](../deployment/alpha-auth/rollout-status.md).


Audit: October 19, 2026. Goal remains incomplete.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Alpha-owned in-app login presentation | `connection-ui.tsx`, local browser checks | Implemented and locally tested |
| Use backend APIs, not Eliza frontend login | `alpha-auth.ts`, `cloud-protocol.ts`, direct consent adapter and protocol tests | Implemented locally; deployed backend compatibility not established |
| Account success/denial/cancellation and cold return | PKCE/state tests, prepared error-return patch, Android callback routes | Locally tested; live provider and device acceptance missing |
| Alpha identity during Google consent | Dedicated account-client patch and readiness guard | Prepared, not deployed; Google consent project configuration unconfirmed |
| Gmail internal return, exact connection verification | Gmail contract v2 patch, owner/state parser, multi-account tests | Locally tested; backend not deployed |
| Dedicated Alpha Gmail consent through refresh/reconnect | Pinned shared backend inspected | Incomplete; requires actual backend target and shared-grant migration design |
| Every callback remains branded | Exact Alpha return page and validated-state backend errors | Unknown/expired backend-state failures still retain shared backend fallback; incomplete |
| Verified Android return links | APK manifest checks, certificate-gated site generator | Real certificate association absent; current apex URLs redirect |
| Public callback service | Website config patch, config hooks and exact Next parser test | Prepared; full website build, staging and deployment missing |
| Required build verification | Latest full verify: 261 tests; Android standalone/launcher debug/release | Passed locally; does not prove emulator HOME, AOSP, Google integration or device acceptance |

## Confirmed deployment impediments

The live production and staging readiness endpoints returned 404. The apex
callback and Android association URLs returned 308 to www; www requests from
this host returned 403. See the exact read-only observation in
`evidence/alpha-auth-live-readiness-2026-10-19.json`.

Website ownership is located: `AlphaCompute/alpha-compute`, with AWS App Runner
staging-to-production image promotion documented in that repository. The actual
Eliza authentication/managed-Google deployment repository, revision and owner
have not been established. No Alpha Google client/project or real distribution
certificate fingerprint has been provided. Secret values are not needed in chat.

## Why Gmail cannot be changed by swapping client settings

The pinned source has these coupled behaviors:

- `packages/cloud/shared/src/db/schemas/platform-credentials.ts` uniquely keys
  credential rows by organization, platform and provider user ID, excluding the
  OAuth client and requesting application.
- `services/oauth/providers/oauth2.ts` reconnects that existing row, rotates its
  secrets and retains its old refresh-token reference when Google returns no
  replacement. The credential's source context does not record an OAuth client.
- `services/oauth/connection-adapters/generic-adapter.ts` refreshes stored grants
  through `refreshOAuth2Token`, which selects the provider's shared credentials.

A client switch only at initiation or exchange would leave refresh broken. A
client switch on an existing shared row may affect other applications using that
same grant. Supporting parallel clients or migrating a shared grant requires
coordinated persistence, secret naming/rotation, refresh selection, reconnect and
concurrency behavior in the actual backend. The phone repository's pinned
upstream checkout is not a substitute for that deployment source or its data
migration requirements. It has not been edited.

## Inputs needed to resume deployment work

1. The backend repository and deployment environment that own these endpoints,
   with access or a maintainer able to deploy the reviewed changes and confirm
   shared-grant migration requirements.
2. The Alpha Google OAuth project/client identity and its configured backend
   callback URLs. Store client secrets only in deployment secret management.
3. The public SHA-256 fingerprint of the intended distribution signing
   certificate, plus the website deployment path for qualifying its association.
4. A signed test installation and a user-controlled Google account for live
   acceptance once the backend and domain are ready.

No goal-completion claim is supported. Local synthetic success does not remove
these requirements.
