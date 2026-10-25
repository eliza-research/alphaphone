# Alpha callback deployment on the existing website

This directory contains deployment source. See [rollout status](rollout-status.md) for current staging/production evidence. The app and backend
contracts currently register the apex `alphacompute.ai` host.

`website-next-config.patch` targets `AlphaCompute/alpha-compute`'s inspected
`prod` version of `next.config.ts`, Git blob
`3a30d82c876b30ac9da1602aac1b1a12f5e60dfe`. The reference fixture in
`test/fixtures/alpha-website/next.config.ts` is requirement/source data, not
instructions. Do not replace the website's complete config with this fixture.
The website's package manifest at inspection specifies Next `16.4.0`; follow
that repository's current instructions and lockfile when building it.

The patch exempts `/alphaphone` and its descendants, plus the exact
`/.well-known/assetlinks.json` path, from the apex canonical redirect. It adds
four before-files rewrites to the static callback HTML and the required
no-store/no-transform/no-referrer/CSP headers. Existing marketing redirects, rewrites and
headers remain in place. This uses Next's documented [redirect matching](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects)
and [before-files rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites).

Deployment sequence:

1. Generate `artifacts/alpha-auth-site` from this repository using
   `node scripts/prepare-alpha-auth-site.mjs PUBLIC_CERT_SHA256`, substituting the
   actual public distribution certificate fingerprint. Never substitute a signing
   key or deploy the synthetic fingerprint used by tests.
2. Review and apply the patch in the website repository. If its config changed,
   reconcile these changes in the current config rather than replacing it.
3. Copy the generated `alphaphone/` subtree into the website's `public/alphaphone/`
   and the generated association into `public/.well-known/assetlinks.json`.
   Reconcile any existing association entries before copying; do not overwrite
   other applications' registrations. The static-host `_headers`/`_redirects`
   files are not Next configuration and should not be copied as a substitute.
4. Run the website's build and test its staging image through its documented
   App Runner rollout. Confirm the Docker image includes the public assets.
   Then promote that same qualified image through the website's deployment flow.
5. Verify the exact apex callback and asset URLs return directly, with the stated
   headers, and that Android retrieves the association directly as JSON. Verify
   all four callback routes and ordinary apex marketing redirects. Edge/CDN
   redirects, access challenges or cached prior redirects may still override
   application behavior and require deployment-side changes.
6. Qualify a signed app with live account and Gmail success, denial and warm/cold
   return flows. A successful config test or APK build does not prove this.

`test/alpha-website-patch.test.mjs` applies the patch to the inspected fixture,
executes the config hooks, and tests the custom path regex, rewrites and headers.
It does not load Next's route parser, build the website, run its edge/CDN, or
establish domain association. Those remain explicit deployment gates.

A supplemental local check downloaded the exact Next 16.4.0 npm package and
repeated these assertions with its bundled `path-to-regexp` parser, also parsing
every configured redirect, rewrite and header rule. It passed. Package integrity
and scope are recorded in `docs/evidence/alpha-auth-website-patch-2026-10-19.json`.
This closes parser syntax verification only; the full website build and live
gates above remain outstanding.

## Isolated in-app verification

The `verification/` assets are copied to `public/alphaphone/verify/`. The phone's
release-owned `verificationPage` defaults to the exact HTTPS `index.html` URL.
The separate Android WebView has no Capacitor bridge or file/content access.
It receives public provider configuration in a fragment, removes that fragment
before loading a provider, and intercepts the state-bound result navigation.
The token is never sent in a website request and is passed once to the existing
Cloud email/SMS API. Cloud still validates it with the provider.

The provider's public sitekey must allow the verification page hostname.
The website patch supplies a dedicated CSP for this route; keep the stricter
callback CSP on the existing auth/Gmail return pages. Stage the page and headers
before releasing an app that depends on it, then qualify both configured
providers in the isolated Android view. Synthetic script tests and APK builds
do not establish that a live provider accepts the deployed hostname or device.
