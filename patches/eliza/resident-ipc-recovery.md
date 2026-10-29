# Resident IPC recovery is upstream

Alpha carries no resident IPC recovery patch. Native staging reads
`ElizaAgentService`, `IpcStartupRecovery`, `WorkflowSurvivorInventory` and
`AndroidBunTarget` directly from the pinned elizaOS/eliza develop source named
in `upstream.lock.json` (currently `45576216509e7126c915ee5b2026b4b906f035b1`).
`test/resident-native-patch-admission.test.mjs` binds all four files to their
reviewed SHA-256 hashes, and refuses the retired consumer patch and its patch
slot. A pin move that changes any of these bytes fails that test until the new
source is reviewed and its hash recorded.

The bytes admitted at the current pin were last changed upstream by:

- `ElizaAgentService`: 69367adefb (keep fallback inference startup behind
  packaged model verification). The service chooses the Bun target from APK
  provenance, rejects adoption when the socket peer's executable or bundle
  identity cannot be verified, and passes the device time zone to the resident.
- `IpcStartupRecovery`: b1cdaa5e32 (carries elizaOS/eliza #37979 and #37981: verify
  directory timestamps after recovery publication).
- `WorkflowSurvivorInventory`: a681dc583f (bounded, per-stop executable digest
  observations with held-FD/path identity checks; unproven processes are
  preserved).
- `AndroidBunTarget`: a95cd4d28e (verified native Android Bun runtime
  deployment). Alpha stages it with the same product package relocation as the
  service.

The recovery design itself came upstream in elizaOS/eliza #37009, with the
launch/stop ordering repair in #37198. Single-use recovery confirmation, intact
archive and interrupted-archive refusal keep their existing authority.

This is source admission only. Earlier component, runtime, recovery, stop and
physical-device evidence stays bound to the source and artifacts it was
recorded against; hash admission at a new pin does not transfer it, and no
installed-device recovery or acceptance is claimed here.
