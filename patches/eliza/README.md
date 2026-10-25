# Alpha authentication backend patch

> Historical pinned-source artifacts. The product owner selected the existing
> Eliza Cloud Google OAuth client for the current rollout. Do not apply the
> dedicated Alpha client/readiness sequence below for deployment. Current
> upstream implementation: https://github.com/elizaOS/eliza/pull/37129.
> See `deployment/alpha-auth/rollout-status.md` for the active release plan.


`alpha-auth-error-return.patch` targets the pinned Eliza source
`91dc19196c307eb8559b9b58de8dbf63eb47f43f`. It is an explicit backend-only patch,
not a modification to `vendor/eliza` and not part of the resident runtime build.

It adds an opt-in return policy for OAuth failures whose callback was recovered
from validated server-owned state. With `STEWARD_OAUTH_APP_ERROR_REDIRECTS` set to
exact registered return URL(s), errors return to that app via an error/state
fragment. It never reflects a provider's error description. Without the setting,
behavior is unchanged. Unknown/stale state cannot select a return address.

`node --test test/alpha-auth-backend-patch.test.mjs` applies the patch in a temporary
source tree and tests the actual helper. Full upstream endpoint tests, review,
and deployment are still required; this helper test is not a deployed backend
claim. See `docs/alpha-authentication.md` for the domain and tenant rollout.

## Alpha Google account client

`alpha-google-client.patch` selects a dedicated Google OAuth client for the two
exact Alpha account return URLs. Apply alongside `alpha-auth-error-return.patch`.
Configure `STEWARD_ALPHA_GOOGLE_REDIRECTS` to the environment's exact account
callback, and supply `STEWARD_ALPHA_GOOGLE_CLIENT_ID` and
`STEWARD_ALPHA_GOOGLE_CLIENT_SECRET` through the backend's secret management.
No secret belongs in this repository or the Android app. The Google project must
have Alpha's consent identity and authorize the existing backend Google callback.

Both authorization and code exchange select this client. Callback selection uses
the validated return URL recovered from server-owned state. The provider identity
remains `google`, preserving the existing account provisioning path. Other apps
and providers retain their shared configuration. An Alpha target with missing
configuration fails instead of silently selecting the shared client. Existing
tenant login policy and redirect registration checks still apply.

`test/alpha-google-client-patch.test.mjs` checks composition with the error-return
patch, configuration isolation, missing settings, and both route selection
expressions. It does not execute the complete upstream HTTP route or Google
exchange. Live review and deployment remain required. This patch covers account
sign-in; managed Gmail has a separate provider credential configuration that
still needs Alpha-specific deployment support.

## Account readiness

Apply `alpha-auth-readiness.patch` after both account patches above. Its read-only
Google readiness route returns `alphaAuth: 1` only for the correct tenant/return
pair with allowed tenant policy, registered redirect, Alpha client settings and
app error returns. It returns no credentials and uses `Cache-Control: no-store`.
Alpha Phone requires this response before opening a new Google sign-in. Older
deployments therefore display an error inside the app. The client-patch test also
executes the patched readiness handler with synthetic policy/registration/rate
limit boundaries and tests missing credentials and error-return configuration.
No Google network call is made by readiness; deployed consent branding and app
links still require independent acceptance.

## Managed Gmail return contract

`alpha-gmail-return.patch` targets the same pin and is also backend-only. It adds
an opt-in `ALPHA_OAUTH_RETURN_URLS` setting (comma-separated, exact HTTPS callback
URLs without query or fragment). Managed Google initiation supplies one of those
URLs with a single `state` query parameter containing a random 43-character
base64url app nonce. The backend stores it in its existing OAuth state.
The patched initiation endpoint adds `alphaReturn: 2` only when that exact
return target is enabled. Alpha Phone requires this marker before opening
Google, so an old or unconfigured backend cannot silently send it to the
existing Eliza frontend return flow.

The generic callback validates the cached provider, age, account context and
exact return target. Success, denial and processing failure return only
`#state=...&result=connected|denied|failed`; successful returns also include
`connectionId`, an opaque database identifier. No token or provider description
is included. The app must verify that exact ID through its authenticated
connector list, not treat the URL as proof of permissions. Denial and failure retire recoverable state. Success
still invalidates the connector caches. Other clients retain their existing
behavior. Missing/untrusted state cannot choose an Alpha return target.

`node --test test/alpha-gmail-backend-patch.test.mjs` applies the patch in a
temporary tree and executes the patched callback handler with synthetic cache,
provider and database boundaries. It also tests the redirect helper directly.
This does not run the real provider exchange or database. Full backend review,
integration testing and deployment remain required. App-side Gmail callback
wiring and domain routes must be deployed before enabling this setting.

## October 21: generic application authentication

The current direction supersedes the historical Alpha-only readiness/client
sequence. `white-label-app-auth.patch` removes product branching from readiness
and uses `APP_OAUTH_RETURN_URLS` / `appReturn` for connector returns. Its exact
upstream base and hashes are in `white-label-app-auth.json`. See
[`docs/white-label-cloud-login.md`](../../docs/white-label-cloud-login.md) for
configuration, migration, local tests and remaining acceptance requirements.
Do not apply this newer backend patch to the older pinned mobile submodule.
