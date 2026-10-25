import { parseAlphaAuthCallback, validPending, type AlphaAuthHost } from './alpha-auth.ts';

/** Routing reads the validated return without consuming it. Only the original
 * operation may exchange its code; a URL cannot select an account or agent. */
export async function readAlphaDelegationReturn(host: AlphaAuthHost): Promise<{scope: string; state: string} | null> {
  const pending = await host.read();
  if (!validPending(pending)) return null;
  const purpose = /^delegation:([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{43})$/.exec(pending.purpose ?? '');
  if (!purpose) return null;
  const callback = await host.callback();
  if (!callback || !parseAlphaAuthCallback(callback, pending)) return null;
  return {scope: purpose[1], state: purpose[2]};
}
