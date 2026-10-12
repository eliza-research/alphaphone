# Secure-store bounded memory patch

Applies to pinned upstream `13c98575987a121decc45b161b0c8a4ee698554e`, file
`plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java`.

The 32 MiB Notes envelope exhausted a 192 MiB Android heap while JSON validation
retained ciphertext and decrypted byte buffers. Committed-write verification also
allocated whole-file copies and slices while plaintext and ciphertext remained live.

The patch verifies committed header, IV and ciphertext in bounded chunks with an
explicit EOF check. Authenticated decoding returns before unchanged JSONTokener
validation, ending the byte-buffer stack lifetimes; plaintext is zeroed before
validation. Limits, synchronization, AES/GCM/AAD, JSON semantics and disk format
remain unchanged. No vendor checkout is edited.

`node --test test/secure-store-memory.test.mjs` runs real 32 MiB encryption,
decryption and CAS under `-Xmx192m`, including malformed/trailing JSON on write
and authenticated read, stale CAS, and corrupted committed IV/ciphertext,
truncation and trailing bytes. Only Android key acquisition and AtomicFile are
host adapters; this does not prove Android Keystore or installed-device behavior.
The unpatched source failed at write readback with the same heap. The patched
capacity test also passed in interpreted JVM mode (`-Xint -Xmx192m`). Native Notes
capacity and recovery reruns remain required before acceptance.

The corrected installed fixture subsequently reproduced an AndroidKeyStore
`BufferAllOutputUntilDoFinalStreamer` allocation failure. The follow-up streams
ciphertext in 16 KiB chunks into the same v1 AES/GCM operation instead of retaining
a whole-file ciphertext buffer alongside the provider's authenticated-output
buffer. Output pieces stay internal until `doFinal` verifies the tag, and are
zeroed on both success and failure. This preserves existing disk bytes, IV/AAD,
JSON validation, slot limits and atomic-write behavior. Host coverage includes
24 MiB of additional live memory during a 32 MiB read and middle/tag/truncation/
trailing-byte tampering across multiple cipher updates. Android proof remains
required; a host crypto provider does not reproduce AndroidKeyStore exactly.

The Alpha wrapper separately serializes renderer storage operations through
`call.resolve`, preventing another reader from decrypting while the previous
32 MiB response is being escaped for Capacitor. Network requests keep their
parallel worker pool. Queued operations are rejected when the wrapper retires.
This is not a claim that full-value Capacitor CAS transport has been qualified;
the installed capacity/recovery campaign must verify the complete route.
