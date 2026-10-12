/** Read-only identity admission for explicitly owned Cuttlefish guests. */
export function admitCuttlefish(serial, properties, expectedFingerprint) {
  if (!/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(serial || '')) throw Error('Select an explicit loopback Cuttlefish ADB endpoint');
  const port=Number(serial.split(':').at(-1));
  if(port<1||port>65535)throw Error('Invalid Cuttlefish port');
  if (!['cutf_cvm', 'cutf_ivshmem', 'cutf_vm'].includes(properties.hardware) ||
      !/^vsoc_/.test(properties.device) || properties.bootCompleted !== '1') throw Error('A booted Cuttlefish image is required');
  if (!expectedFingerprint || /[\r\n]/.test(expectedFingerprint) || properties.fingerprint !== expectedFingerprint) throw Error('Cuttlefish image fingerprint does not match the requested image');
  if(properties.userState!=='RUNNING_UNLOCKED')throw Error('Cuttlefish foreground user must be fully unlocked');
  if(properties.keyguardReady!==true)throw Error('Dismiss the Cuttlefish lock screen before running UI campaigns');
  return properties;
}

/** User storage can be unlocked while the keyguard still blocks application UI.
 * Unknown or ambiguous dumps fail closed; callers must not infer readiness from
 * RUNNING_UNLOCKED alone. This reads Android's KeyguardServiceDelegate dump. */
export function keyguardReadyFromPolicy(policy) {
  const states = [...String(policy).matchAll(/^[ \t]*KeyguardServiceDelegate\r?\n[ \t]*showing=(true|false)\r?\n[ \t]*inputRestricted=(true|false)\r?$/gm)];
  return states.length === 1 && states[0][1] === 'false' && states[0][2] === 'false';
}
