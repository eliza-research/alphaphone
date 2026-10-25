# Alpha Phone internal authentication rollout

Updated October 19, 2026 (Pacific). Deployment is in progress, not accepted as live sign-in.

## Decisions

Use the existing Eliza Cloud Google OAuth client, as requested by the product owner. Alpha Phone owns its login UI and Alpha Compute owns the return pages. Google's consent identity remains that of the existing OAuth project. Do not deploy the historical dedicated-client patch.

## Backend

- Candidate: https://github.com/elizaOS/eliza/pull/37129
- All five candidate GitHub CI checks passed. The PR was merged externally by lalalune at 04:26:33 UTC on October 20, merge commit `37bb88c22fc08f0a5c8bc1a9ceacad4a3174c675`. Develop Full run 39369595379 passed all required checks. Exact-source release reconciliation run 39371847468 is running. Railway was inspected; deployment/configuration status is recorded below.
- Source commit: `61bf5e3fcb` on `codex/alpha-internal-auth`, targeting `develop`.
- Real account/PGlite integration: 16 passed; Gmail grant publication/callback integration: 8 passed. Provider boundaries remain synthetic.
- Full auth package tests, repository verification, package lint, auth/API/shared typechecks and production Worker dry run passed locally.
- Cloud Wrangler config includes exact environment-specific Gmail returns.
- Steward is a separate Railway project: https://railway.com/project/294525e3-7f01-4a5a-a3cf-b4a44210336b
- GitHub deployment records show both Steward environments deployed the same develop commit simultaneously. Automatic deployment has been disabled while source tracking is corrected; Cloud's staging gate does not control Steward.

In Steward staging, preserve existing settings and register the exact account callback for tenant `elizacloud-staging`: `https://alphacompute.ai/alphaphone/auth/staging/callback`. Add that exact URL to `STEWARD_OAUTH_APP_ERROR_REDIRECTS`.

In Steward production, preserve existing settings and register the exact account callback for tenant `elizacloud`: `https://alphacompute.ai/alphaphone/auth/callback`. Add that exact URL to `STEWARD_OAUTH_APP_ERROR_REDIRECTS`.

Use tenant-owner configuration or the normal administrator deployment path. Do not broaden callbacks to wildcard origins, replace other clients' redirect lists, or expose secret values. Existing shared Google credentials remain in their current secret management.

After Develop Full and release tracking pass, promote through the repository's staging workflow and qualify readiness, authorization, denial, exchange, Gmail exact-connection return and refresh. Only then promote staging to production using its existing qualified-source workflow. Verify both Cloud and separate Steward deployments at each stage.

## Callback website

- Staging PR: https://github.com/AlphaCompute/alpha-compute/pull/70 (merged).
- Staging source: `864d6df57c65169fe947a7b7484368f20336b681`.
- Staging rollout: https://github.com/AlphaCompute/alpha-compute/actions/runs/39369017797
- Production promotion: https://github.com/AlphaCompute/alpha-compute/pull/71 (merged after corrected staging verification; production verified).
- Local production build, 25 tests, changed-file lint, and production-server HTTP checks passed. Repository-wide lint has 28 existing errors outside the patch.
- All four callback routes must serve directly, with no marketing redirect and no-store/no-transform/no-referrer. The production signing fingerprint comes from the existing public Android association configuration; no debug signing certificate is published.
- Production must use the exact qualified staging image. This promotion also contains the newsroom category/Events visibility change already on staging.

## App validation

`npm run verify` passed all 261 tests and renderer checks. Android build passed both standalone and launcher variants, debug and release, after selecting a fresh isolated prepared runtime at the pinned upstream commit. The default generated runtime directory was incomplete and was preserved. No upstream submodule edits were made.

An APK build is not emulator HOME-role testing, AOSP boot qualification, real Google/Gmail acceptance, or device/user acceptance. Those remain separate evidence requirements.

The first staging rollout passed infrastructure checks but live HTML comparison found Cloudflare beacon injection, blocked by CSP. PR #72 (https://github.com/AlphaCompute/alpha-compute/pull/72) adds no-transform; the corrected build passed locally and on live staging. Production promotion was authorized by that exact live-byte verification.

Railway automatically deployed merge commit `37bb88c22fc08f0a5c8bc1a9ceacad4a3174c675` to both Steward environments after the external merge. Staging deployment 7191528986 succeeded at 04:28:08 UTC; production deployment 7191528916 succeeded at 04:28:31 UTC. Read-only probes through both Cloud APIs now reach the new readiness endpoint but return HTTP 503 with `Alpha Phone sign-in unavailable`. Configuration remains unqualified. Cloud Gmail code has not yet been promoted by this task.

Corrected website staging deployment 39369017797 succeeded. The post-rollout live probe passed all seven assets byte-for-byte, with direct URLs and no-store/no-transform/no-referrer/CSP for callback assets. PR #71 was merged to production after this check; production rollout 39370318591 succeeded. Two subsequent live probes passed all seven assets byte-for-byte with direct URLs and privacy headers. An initial probe during rollout saw mixed old/new responses; post-completion probes are clean.

With the user's authenticated Railway session, automatic deployment from develop was disabled in both Steward environments. Pending configuration is staged, not deployed: staging source branch `staging`, production source branch `main`, Wait for CI enabled in each, and each environment's exact `STEWARD_OAUTH_APP_ERROR_REDIRECTS`. Each environment has three pending changes. Do not apply production configuration against an older main branch; finish the qualified branch promotions first.

The tenant-specific redirect registration API requires a tenant owner/admin session and recent MFA. Railway access alone is not this application session. No global redirect list was broadened and no tenant MFA gate was bypassed. A question identifying the existing tenant admin login is pending with the user.

Production website evidence: `docs/evidence/alpha-auth-production-callbacks-2026-10-19.json`. The live image reports qualified staging SHA `864d6df57c65169fe947a7b7484368f20336b681`; production merge is `fec32f884d8b4307a9176cf3b350bc87a7d7b3d3`. Deployment: https://github.com/AlphaCompute/alpha-compute/actions/runs/39370318591. This establishes callback hosting, not live OAuth acceptance.

Promotion preflight found five merge conflicts because production recovery fixes had not reached develop. Reconciliation PR https://github.com/elizaOS/eliza/pull/37140 merges main `e0ddf22c07` and staging `aa2beb5a4f` into develop source `37bb88c22f`, preserving both sets of changes. Candidate `aee981975047c0d345fb812fe25b925333a1597b` is under validation. The three conflicted implementation/workflow files match production main exactly. Do not promote the earlier tree over those production fixes.

Reconciliation PR #37140 now includes main `5eadb98b08` and develop `a49cfee45f`; head `c49e357d9f67d2732db11373d3199a167fada0ad` has source tree `00291fa353231c60f79802f491372396ad2a14af`. Full repository verification passed for that tree. Both destination merge-tree checks preserve it exactly. Local script suite: 1,604 passing tests, two failures in unchanged develop files (testing-package import and stale setup-node SHA assertion). Latest PR CI is queued. Superseded reconciliation/image runs 39371847468 and 39371971759 were canceled after develop advanced; they must not qualify the new tree.
