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

The local joined pin `3de03adb2d88f566e5d4fa9ba9b6294d9867aeb0` includes
the reviewed recovery successor `0c51a899ffb3fce9fc81f7d400aa04f661adcda0`.
It excludes directory timestamps changed by rename from the archive identity,
while retaining leaf identity and timestamp checks. The admission test binds
IpcStartupRecovery to its reviewed SHA-256
`c51152d8b6403622171e4baed30f55cb540cad2c3fd49a8be1171a4b2c015c27`.
The other admitted source hashes are unchanged.

Nine recovery cases and two reconciliation cases passed in separate own-UID
Android emulator fixtures. That proves the isolated fixture paths, not recovery
of an installed Alpha profile or physical-device acceptance. Earlier component
and device evidence remains historical.
