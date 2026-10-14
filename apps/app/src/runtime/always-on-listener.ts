import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { parseAssistantInvocation, parseListenerStatus, type AssistantInvocation, type ListenerStatus } from './always-on-listener-status';

export type { AssistantInvocation, ListenerState, ListenerStatus } from './always-on-listener-status';

type Reply = Promise<Record<string, unknown>>;
const listener = registerPlugin<{ status(): Reply; pause(): Reply; turnOff(): Reply; openSettings(): Promise<{ opened?: unknown }> }>('AlphaListener');
const agent = registerPlugin<{ takeInvocation?(): Reply }>('Agent');

const nativeListener = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlphaListener');
async function ask(method: 'status' | 'pause' | 'turnOff'): Promise<ListenerStatus> {
  if (!nativeListener()) return { available: false };
  try { return parseListenerStatus(await listener[method]()); } catch { return { available: false }; }
}

/** Status of the image's listener; `{available:false}` on the web build and on phones without it. */
export const listenerStatus = () => ask('status');
/** Pauses until the user resumes in the listener's own UI. */
export const pauseListener = () => ask('pause');
/** Turns listening off; consent is kept. Turning it back on happens only in the listener's UI. */
export const turnOffListener = () => ask('turnOff');

/** Opens the listener's consent and settings screen. */
export async function openListenerSettings(): Promise<boolean> {
  if (!nativeListener()) return false;
  try { return (await listener.openSettings()).opened === true; } catch { return false; }
}

/**
 * 'listener' when the wake phrase opened the assistant surface, 'assist' for other assist entries,
 * otherwise null. One-shot: the native side clears the listener origin when it is read, so later
 * calls for the same launch return 'assist'.
 */
export async function assistantInvocation(): Promise<AssistantInvocation> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Agent')) return null;
  try { return parseAssistantInvocation(await agent.takeInvocation?.()); } catch { return null; }
}
