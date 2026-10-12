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
