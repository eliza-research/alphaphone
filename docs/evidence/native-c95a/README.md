# October 24 native source update

Eliza main snapshot: `c95a37be8d56fb672825df7e9e9a742b59567bbb`.
Native engine: `0d9fd4b9db239bbf851068f98c99f4263f8c05c5` (ABI 19).
The Android speech module moved to `plugins/plugin-local-inference/native/android`.
Alpha retains its renderer, identity and native policy. No vendor source was edited.

Both native engines and the full Alpha JNI bridge were built from clean sources
with NDK 28.2.13676358 and CMake 4.0.3. The preparation receipts record compiler
commands, identity binding, 16 KiB alignment and exact hashes. The first build from
a staged symlink encountered CMake Git-index path regeneration; independent clean
engine checkouts succeeded. This is not cross-host reproducibility evidence.

The unmodified Phonon converter reproduced upstream's new 208,932,352-byte b5x3t7
model under ARM64 Python/NumPy emulation. The initial x86 conversion passed tensor
checks but failed the pinned whole-file hash and was not admitted. The admitted
model exactly matches `c0f6ad42f0a5b481904416077dde0a1a78e5b8642295fdf2356ace822588c3df`.

## Current execution

The Pixel and API35 x86_64 emulator both passed the full Alpha JNI embedding test:
two open/close cycles, 384 finite dimensions, repeat/semantic comparisons, Unicode
and NUL handling. The Pixel passed all 101 recognition utterances (40/2,064 word
errors, 1.938% WER) and all 230 synthesis round-trip sentences (169/3,753 word
errors, 4.503% WER). Silence recognition was empty. No thresholds or sample limits
were overridden. The emulator passed all 101 recognition utterances (44/2,064 errors, 2.132% WER) and all 230 round-trip sentences (166/3,753 errors, 4.423% WER); silence was empty.
The three upstream streaming/plugin contract tests also passed.

`npm run verify` passed: 1,806 tests passed, five skipped, zero failed; typecheck,
renderer build and production bundle audit passed. All four standalone/launcher,
debug/release APK variants built with the resident runtime, native profile and
mocks disabled. The image APKs are separately normalized and development-signed.

## Limits

These tests use pinned corpus audio and generated PCM. They do not establish
physical microphone/speaker acceptance, real provider login/inference, complete
product workflows or user acceptance. `qualified` remains false. Image build,
flash and boot results are recorded separately; APK tests do not establish them.

A fresh packaged audit reports a high Zod 4.6.5 advisory
`GHSA-mrhx-c7xc-m3w5`. It remains pending, with no exception. Together with
production signing and device acceptance, it blocks production release approval.
The runtime lock itself is unchanged from the previous pin; advisory metadata is
new. This is a development deployment, not a production qualification claim.

## Pixel image deployment

The rebuilt AOSP `android-17.0.0_r1` image was flashed without wiping user data.
Android boot completed, Alpha v9 retained HOME and resumed successfully, and the
installed launcher, system launcher, listener and SystemUI hashes matched the
verified build. SELinux is enforcing. See the
[v9 deployment receipt](../pixel-version9-aosp-deployment-2026-10-24.json).
The unchanged incremental base timestamp is not used as deployment identity.
