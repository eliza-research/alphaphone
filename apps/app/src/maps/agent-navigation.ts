import { AlphaMapsDeviceNavigation, type MapsDeviceNavigation, type MapsNavigationSurface, type NavigationLimits } from './device-navigation.ts';
import type { MapsProvider, ProviderConfig } from './contracts.ts';

/** Where the phone offers its navigation to the resident agent (`MapsService.registerDeviceNavigation`). */
export interface MapsDeviceNavigationPort { register(navigation: MapsDeviceNavigation | null): void }

/** Launcher-owned navigation offered only during an authenticated resident conversation turn. */
export const residentMapsNavigationPort = {
 relay: false,
 current: null as MapsDeviceNavigation | null,
 register(navigation: MapsDeviceNavigation | null) { this.current = navigation; },
};

/** The installed Eliza Cloud Maps coverage for the signed-in account, if any. */
export type CloudInstallation = Readonly<{ providerId: string; attribution: string }> | undefined;
export type AgentNavigationOptions = Readonly<{
 /** Product Maps path only: Eliza Cloud Maps, never the test-mocks regional gateway. */
 enabled(): boolean;
 installation(): CloudInstallation;
 connection(): { config: ProviderConfig; provider?: MapsProvider };
 onChange(listener: () => void): () => void;
 surface: MapsNavigationSurface;
 port: MapsDeviceNavigationPort;
 limits?: Partial<NavigationLimits>;
}>;

/**
 * Offers navigation to the agent only while Eliza Cloud Maps is installed for the
 * signed-in account. Each provider installation (account) gets its own binding; a change
 * retires the old one (cancelling its in-flight work) before anything else is offered.
 */
export function bindAgentNavigation(options: AgentNavigationOptions) {
 let current: { binding: AlphaMapsDeviceNavigation; provider: MapsProvider } | undefined;
 const installed = () => {
  if (!options.enabled()) return undefined;
  const installation = options.installation(), { config, provider } = options.connection();
  return installation && provider && config.status === 'configured' && config.providerId === installation.providerId && provider.providerId === installation.providerId
   ? { installation, provider } : undefined;
 };
 const retire = () => {
  if (!current) return;
  const old = current; current = undefined;
  options.port.register(null);
  old.binding.retire();
 };
 const sync = () => {
  const next = installed();
  if (current && next?.provider === current.provider) return;
  retire();
  if (!next) return;
  const { installation, provider } = next;
  const binding: AlphaMapsDeviceNavigation = new AlphaMapsDeviceNavigation(options.surface, {
   providerId: installation.providerId,
   attribution: installation.attribution,
   current: (): boolean => current?.binding === binding && installed()?.provider === provider,
  }, options.limits);
  current = { binding, provider };
  options.port.register(binding);
 };
 const unsubscribe = options.onChange(sync);
 sync();
 return {
  registered: () => !!current,
  dispose() { unsubscribe(); retire(); },
 };
}
