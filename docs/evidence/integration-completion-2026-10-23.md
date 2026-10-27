# Integration completion build — October 23, 2026

Native/recovery PRs #611–614 are now merged and consumed. Exact source/APK hashes
and results are in [the receipt](integration-completion-2026-10-23.json).

## Completed

- Staged reviewed speech artifacts and pinned FFI source. Prepared the resident
  and workflow worker with required Bun 1.4.2; shell default 1.3.14 was rejected.
- Staged ARM64 from the admitted embedding receipt and x86_64 after checking every
  size/hash against the committed component receipt. Initial Gradle correctly
  rejected the missing x86_64 app engine.
- The corrected browser credentials/private-tab journey passes on Chromium.
- Repository verification: 1,808 passed, five skipped, zero failures; typecheck,
  renderer build and production bundle audit passed.
- All four standalone/launcher debug/release APKs built and verified with native
  runtime and speech, test mocks disabled. Releases remain unsigned.
- Separate always-on listener builds and lints in debug and release modes.
- Unsigned launcher/listener prepared for AOSP import: payload hashes unchanged,
  JNI/DEX stored and aligned; listener ZIP admission passes. Signing is pending.
- Clean offline emulator campaign: all 12 speech tests across both variants pass
  without skips, covering transcription, synthesis, bridge playback, VAD and cancellation.
- Earlier mixed campaign passed no-mock/startup checks and selected/cold-launched
  Alpha HOME before restoring the original launcher. Signed-in Shell/HOME journeys
  skipped. Speech tests correctly failed with networking enabled; that record is
  preserved separately from the clean, network-disabled rerun.

The emulator was cleaned up and stopped. The physical Pixel was not reinstalled,
flashed or reset. Read-only inspection found its older image lacks AlphaSense as a
system package. These results do not establish physical audio or image acceptance.

## Remaining external inputs and acceptance

- Designated signed-in account and safe provider targets; Maps operator access and
  deployed coverage for real Gmail/Calendar/Maps, revocation and quota tests.
- Production App Link certificate publication: the association document previously
  returned HTTP 404. Publish the actual release certificate, not a placeholder.
- Controlled release signing and platform/APEX/AVB public identities; signed update,
  interruption and recovery evidence. Descriptor fields remain unset.
- Prepared Pixel source and retained factory archive: neither is available at the
  inspected local paths. `/home/shaw/aosp` lacks the locked Pixel device inputs.
  No image compilation was attempted against this different tree.
- Physical microphone/speaker/listening, telephony, image boot and user acceptance.

Raw logs, AOSP preparations and native results remain locally under
`artifacts/integration-completion/`; APKs are in `artifacts/`. Generated packaged-runtime
notices were present while building and restored afterwards as README requires;
the receipt records a dirty build rather than claiming clean release acceptance.
No qualification field was changed to suppress a missing gate.
