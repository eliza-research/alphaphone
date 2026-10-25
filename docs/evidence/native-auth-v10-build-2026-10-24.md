# Native authentication version 10 build

Source: `9f845b5d8` on `codex/finish-integrations`. The merged deployment source
preserves the Pixel version 9 runtime: eliza `c95a37be8d56fb672825df7e9e9a742b59567bbb`
and llama.cpp `0d9fd4b9db239bbf851068f98c99f4263f8c05c5`.

Sign in opens Alpha's own email form even when optional Google readiness fails.
The hosted Cloud login fallback is removed. Google requests the upstream MFA
exchange contract and resumes second-factor verification inside Alpha, bound to
the active, unexpired native attempt.

Validation completed October 24, 2026:

- `npm run verify`: 1,819 tests, 1,813 passed, six skipped, zero failed; typecheck
  and 408-file production bundle audit passed.
- `npm run android:build`: standalone and launcher, debug and release APKs,
  lint and APK verification passed. Build used `ELIZAOS_APP_LINK_HOST=eliza.app`,
  version code 10, version name `0.1.0-native-auth-9f845b5`.
- All four merged manifests contain the HTTPS autoVerify filter for
  `eliza.app/alphaphone/auth/callback`.
- AOSP-prepared launcher development APK signature and 16 KiB zip alignment
  verified. APK SHA-256:
  `d9f710f957abc4b9e0a05b2eb006df0b7022458a4b20d0ff1da3ad8334a0a7e1`.
- Signing certificate SHA-256:
  `2242994d2d237f98d01927999157067df4e2495a8f980451ac3de5d40642584a`;
  matches the previously installed version 9 development signer.

Local artifact: `artifacts/pixel-native-auth-v10/launcher-aosp-development.apk`.
This is a development-signed application update, not a production release or a
new full AOSP image. Earlier version 9 image deployment is recorded separately.

Installation and device UI/App Link verification are pending: ADB lost the
Pixel before installation and subsequently listed no devices. No version 10
device acceptance or successful user authentication is claimed.

Live authentication additionally requires the two operator configuration fixes
in [Cloud diagnosis](cloud-native-auth-diagnosis-2026-10-24.md): restore the
intended active mobile app registration and allow the exact Google tenant
callback. The scoped registration repair rolled back; it did not repair production.
