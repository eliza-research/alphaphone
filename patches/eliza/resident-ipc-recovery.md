# Resident IPC recovery is upstream

The reviewed recovery implementation from elizaOS/eliza#37009 is included byte-for-byte
in the current upstream pin. Both service/recovery files match the previously admitted
patch output. Native staging consumes those pinned sources directly; the redundant
consumer patch and special patch slot have been removed.

The review, single-use confirmation, intact archive and interrupted-archive refusal
remain unchanged. Existing component evidence is historical; this pin change does not
establish new device recovery or acceptance.
