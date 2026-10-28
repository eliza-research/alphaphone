# Resident IPC recovery is upstream

The recovery implementation from elizaOS/eliza#37009 was consumed without a
consumer patch at pin `5c36344786274ce1a0b0e2ebcb560bc2da6ac0ab`.
The current pin `3d6f68a129702a1a2779cc087c93a80ba0f2332e` is its reviewed
successor from elizaOS/eliza#37198. It repairs launch/stop ordering in
ElizaAgentService, IpcStartupRecovery and WorkflowSurvivorInventory. The source
admission test binds all three files to the reviewed hashes; it does not assert
that the earlier service/recovery bytes are unchanged.

Native staging consumes the pinned sources directly. The redundant consumer
patch and special patch slot remain removed. Single-use recovery confirmation,
intact archive and interrupted-archive refusal retain their existing authority.

Earlier component and device evidence remains historical. The new source review
and regression tests do not establish new installed-device recovery or acceptance.


The October 26 integration candidate uses Eliza `6293e29bf398603d0ea233871edbdeb57e5c2405`.
Its reviewed service now chooses the Bun target from APK provenance, rejects
adoption when the socket peer's executable/bundle identity cannot be verified,
and passes the device time zone to the resident. The survivor inventory keeps
bounded, per-stop executable digest observations with held-FD/path identity
checks and preserves unproven processes. `IpcStartupRecovery` itself is unchanged.
Alpha stages the newly required `AndroidBunTarget` helper with the same product
package relocation. Hash admission records these new source bytes; it does not
transfer earlier runtime, recovery, stop or physical-device acceptance.
