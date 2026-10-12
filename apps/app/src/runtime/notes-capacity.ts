/** Product-owned encrypted Notes slot limit, also enforced by AlphaCredentialStore. */
export const NOTES_SLOT_MAX_BYTES = 32 * 1024 * 1024;

/** Count the exact JSON UTF-8 bytes without allocating another encoded copy.
 * This is only an early refusal: the native store remains the authority. */
export function notesValueFits(value: unknown, limit = NOTES_SLOT_MAX_BYTES): boolean {
  const json = JSON.stringify(value);
  // Leave non-JSON values to the vault's existing validation.
  if (json === undefined) return true;
  let bytes = json.length;
  if (bytes > limit) return false;
  for (let i = 0; i < json.length; i++) {
    const unit = json.charCodeAt(i);
    if (unit < 0x80) continue;
    if (unit < 0x800) bytes++;
    else {
      bytes += 2;
      if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < json.length) {
        const next = json.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) i++;
      }
    }
    if (bytes > limit) return false;
  }
  return true;
}
