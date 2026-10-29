# #662 Build and sign the distributable release APKs (H-10)

Owner preparation for [issue #662](https://github.com/eliza-research/alphaphone/issues/662),
[human actions](../human-actions.md) H-10. This is the release owner's procedure on the release
build host. It records no result. Everything it produces is **APK-build evidence only**: not an
emulator HOME-role test, an image boot, a device result or user acceptance.

## Read-only state on 2026-10-28 (main 94676c82, Eliza pin 1f2a922f)

### The pin contains the merged cycle-1 upstream branches

`upstream.lock.json` pins elizaOS/eliza `1f2a922f86e2a1f3d6cd62e097145492bd49ebfc` (2026-10-28
14:04 -07:00). Every cycle-1 upstream pull request is merged into `develop` and its merge commit is
an ancestor of the pin (`git merge-base --is-ancestor <merge> 1f2a922f`):

| PR | Branch | Merge commit | In pin |
| --- | --- | --- | --- |
| [#38051](https://github.com/elizaOS/eliza/pull/38051) | claude/alpha-c1-settings | 98c249ce | yes |
| [#38053](https://github.com/elizaOS/eliza/pull/38053) | claude/alpha-c1-aosp | 7ade77c8 | yes |
| [#38054](https://github.com/elizaOS/eliza/pull/38054) | claude/alpha-c1-cloud | 9eecca02 | yes |
| [#38055](https://github.com/elizaOS/eliza/pull/38055) | claude/alpha-c1-browser | 51cbb9fb | yes |
| [#38056](https://github.com/elizaOS/eliza/pull/38056) | claude/alpha-c1-mail-calendar | 746ca770 | yes |
| [#38057](https://github.com/elizaOS/eliza/pull/38057) | claude/alpha-c1-media | 4264eda7 | yes |
| [#38058](https://github.com/elizaOS/eliza/pull/38058) | claude/alpha-c1-overview | 36361110 | yes |
| [#38059](https://github.com/elizaOS/eliza/pull/38059) | claude/alpha-c1-packaging | 0b2fa450 | yes |
| [#38060](https://github.com/elizaOS/eliza/pull/38060) | claude/alpha-c1-telephony | e87a3a73 | yes |
| [#38061](https://github.com/elizaOS/eliza/pull/38061) | claude/alpha-c1-maps | 7b30463a | yes |
| [#38062](https://github.com/elizaOS/eliza/pull/38062) | claude/alpha-c1-a11y | 8e4a76b6 | yes |
| [#38063](https://github.com/elizaOS/eliza/pull/38063) | claude/alpha-c1-shell | 5ee50559 | yes |
| [#38065](https://github.com/elizaOS/eliza/pull/38065) | claude/alpha-c1-speech | 4ee22a25 | yes |
| [#38066](https://github.com/elizaOS/eliza/pull/38066) | claude/alpha-c1-assistant | 988be865 | yes |
| [#38067](https://github.com/elizaOS/eliza/pull/38067) | claude/alpha-c1-workflows | ea827def | yes |
| [#38068](https://github.com/elizaOS/eliza/pull/38068) | claude/alpha-c1-agent | 860b8f79 | yes |
| [#38069](https://github.com/elizaOS/eliza/pull/38069) | codex/alpha-runtime-compatibility-20261028 | 88ee1c26 | yes |
| [#38070](https://github.com/elizaOS/eliza/pull/38070) | claude/alpha-c1-notes-clock | 89f6107c | yes |
| [#38083](https://github.com/elizaOS/eliza/pull/38083) | claude/shared-host-review-fixes | fa9dfb05 | yes |
| [#38084](https://github.com/elizaOS/eliza/pull/38084) | claude/grace-generic-host | 0d6828a9 | yes |

The cycle-1 PR list is the orchestration's record of upstream PRs; the merge state and commits were
read from GitHub. This prerequisite of the issue is met at this pin; a later repin must re-check it.

### `npm run android:build:inputs`

| State | Input | Supplied by |
| --- | --- | --- |
| ready | pinned upstream checkout (`vendor/eliza` at the pin) | script |
| **PERSON** | on-device voice outputs in `.eliza/paradee-voice/native` (not staged; Gradle `:app:verifyVoiceHost` rejects a distribution build) | H-18: `node scripts/android-stage-voice-models.mjs --from <directory>` ([fused speech](../fused-speech.md)) |
| **PERSON** | on-device voice host qualified (`android/voice-host/qualified-voice-host.json` is `qualified: false`) | H-18 named reviewer |
| script | embedding host libraries (`libelizainference.so`, `libelizavoicejni.so`, `libc++_shared.so`) | `npm run agent:build-embedding-host` (part of `android:build:local`) |
| script | prepared resident runtime source, workflow worker, staged resident payload, embedding model | `android:build:local` chain |
| ready | Gradle dependency verification metadata | committed |
| **PERSON** | release signer (`android/release-signer.json` is `unset`; no `ELIZAOS_KEYSTORE_*` set) | H-08/H-09 (#661), then H-10 signing |

Three person-supplied inputs are missing: the voice outputs, the voice host qualification and the
release signer. The embedding host (H-19) is script-supplied at this pin.

### `npm run human:status` (release rows)

- H-09 `open`: 12 of 12 release digests unset.
- H-10 `open`: no `artifacts/apk-manifest.json` in this checkout; no `lastRelease`; no
  `ELIZAOS_KEYSTORE_*` variable; `ELIZAOS_APP_LINK_HOST` unset.
- H-18 `open`: `qualified: false` (device executed: true, emulator executed: true, user accepted: false).
- H-19 `not needed`: script-supplied while `remapBuildPath` is true.

No agent ran the build chain or Gradle for this issue.

## Decisions for the owner

### D1. Gradle signing or post-build signing?

| Option | How | What it changes |
| --- | --- | --- |
| Gradle (`ELIZAOS_KEYSTORE_PATH`, `ELIZAOS_KEYSTORE_PASSWORD`, `ELIZAOS_KEY_ALIAS`, `ELIZAOS_KEY_PASSWORD`) | Needs a keystore (PKCS#12/JKS) holding `alphaphone_app`, which the ceremony does not produce: someone must convert the decrypted `.pk8` + certificate into a keystore | Passwords sit in the build environment for the whole Gradle run; an extra keystore file must be created and destroyed. Gradle refuses a partial set. |
| Post-build `sign-release-apks.mjs --keys-dir /dev/shm/keys` (default for option A custody) | Build unsigned, then sign with the ceremony layout decrypted by `decrypt-release-keys.ts --only alphaphone_app` | No keystore conversion; the key is in tmpfs only for the signing step; the script removes unsigned files only after the signer matches the recorded digest and re-runs `verify-apks` and the SBOM. |
| Post-build `sign-release-apks.mjs --pkcs11-config <file> --key-label <label>` (custody B/C) | PIN only via `ELIZAOS_PKCS11_PIN` | No private key on disk. |

Documented default: none chosen; the recommendation is the post-build signer matching the H-01
custody choice, because it is the path tested against ceremony-layout keys and re-verifies the
result.

### D2. Version code and name

`ELIZAOS_VERSION_CODE` must exceed `lastRelease.versionCode` (currently `null`, so any positive
integer is admitted). The highest development versionCode recorded in `docs/evidence` is 17.
Recommendation: a code above every development build that pilot units may still have installed
(for example 100), and a `ELIZAOS_VERSION_NAME` that names the Alpha commit and Eliza pin. What it
changes: once H-32 records this release as `lastRelease`, every later build and every
`pilot-update` must advance it; a code that is too low cannot be undone.

### D3. App Links host

H-10 builds with `ELIZAOS_APP_LINK_HOST=eliza.app`; without it, builds declare no verified App
Links filters and H-13 cannot be verified on the device. Default: set it.

## Procedure (release owner, release build host)

Prerequisites: #661 done (H-09 `done`), H-18 admitted, this pin (or a later one re-checked).

1. On a clean checkout of the release commit: `git submodule update --init vendor/eliza`; confirm
   `npm run android:build:inputs` shows the pin `ready`.
2. Stage the person inputs it lists:
   `node scripts/android-stage-voice-models.mjs --from <directory of the recorded voice outputs and models>`
   (H-18; see [fused speech](../fused-speech.md)). Re-run `npm run android:build:inputs`: the only
   remaining `PERSON` row must be the release signer (it does not stop the build).
3. `npm run verify`.
4. Build both distribution variants with the strict chain (never `--allow-unpackaged-runtime`,
   never `ELIZA_DEV_ALLOW_TEST_MOCKS=1`):
   ```sh
   ELIZAOS_VERSION_CODE=<D2> ELIZAOS_VERSION_NAME=<D2> ELIZAOS_APP_LINK_HOST=eliza.app \
     npm run android:build:local
   ```
   (with the four `ELIZAOS_KEYSTORE_*` variables only if D1 chose Gradle signing).
5. Sign (if D1 chose post-build signing):
   ```sh
   # option A: decrypt only the application key into tmpfs for this job
   node vendor/eliza/packages/os/scripts/android/decrypt-release-keys.ts --input <bundle> \
     --output /dev/shm/keys --passphrase-file /dev/shm/pass --only alphaphone_app
   node scripts/sign-release-apks.mjs --keys-dir /dev/shm/keys --dry-run
   node scripts/sign-release-apks.mjs --keys-dir /dev/shm/keys
   node scripts/sign-release-apks.mjs --keys-dir /dev/shm/keys --apk <prepared Sense listener APK> --out <signed listener APK>
   shred -u /dev/shm/keys/* /dev/shm/pass; rmdir /dev/shm/keys
   # option B/C: --pkcs11-config <file> --key-label <label>, PIN only via ELIZAOS_PKCS11_PIN
   ```
6. Check: both release rows (`standalone`, `launcher`) of `artifacts/apk-manifest.json` read
   `distributable: true`; `node scripts/audit-production-bundle.mjs` passes; `npm run human:status`
   shows H-10 `done`.
7. Do **not** run `scripts/record-release.mjs --write` yet: `lastRelease` is recorded only after
   distribution (H-32).
8. Keep `artifacts/apk-manifest.json`, both APKs, the signed listener APK and the build log as the
   release build record; these feed H-21 (#672).

## Draft decision entries

```markdown
- **P-5x — H-10 ([#662](https://github.com/eliza-research/alphaphone/issues/662)), decided <YYYY-MM-DD> by Shaw:**
  Release APKs are signed <in Gradle from a keystore | after the build with scripts/sign-release-apks.mjs
  using <key files in tmpfs | PKCS#11 token>>. The first pilot release uses versionCode <N> and
  versionName <name>; ELIZAOS_APP_LINK_HOST=eliza.app. Policy only, not build evidence.
```

## Remaining human steps

1. Finish #661 (custody, ceremony, enrollment).
2. H-18 reviewer: stage and admit the on-device voice outputs (`qualified: true`).
3. Release owner: choose D1/D2, then run the procedure above on the release build host.
4. Confirm both `distributable: true` rows and H-10 `done`; hand the manifest and APKs to the image
   host operator for #672.
