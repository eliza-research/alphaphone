import { registerPlugin } from './platform-plugins';
import { Capacitor } from '@capacitor/core';
import type { System as UpstreamSystem } from "../../../vendor/eliza/plugins/plugin-native-system/src/index";
const System = registerPlugin<typeof UpstreamSystem>("ElizaSystem");
/** Android profile an entry belongs to when it is not the current user's own. */
export type InstalledAppProfile = 'work' | 'private' | 'clone' | 'other';
/** One launchable entry. `icon` is a small PNG data URL when the platform can render one.
 * `activityName` names the exact launcher activity; `user` is the Android user serial of another
 * profile; `locked` marks a profile that is paused or not yet unlocked. */
export type InstalledApp = { packageName: string; label: string; icon?: string; activityName?: string; user?: string; profile?: InstalledAppProfile; locked?: boolean };
/** Why native refused a launch; carried as the rejection `code`. */
export type LaunchRefusal = 'not-installed' | 'disabled' | 'no-launcher' | 'profile-locked' | 'profile-unavailable' | 'failed';
/** Default-handler roles Alpha hands off to instead of implementing itself. */
export type DefaultAppRole = 'dial';
export type DefaultApp = { role: DefaultAppRole; available: boolean; packageName?: string; label?: string; icon?: string };
export const DeviceApps = registerPlugin<{
  list(options?: { icons?: boolean }): Promise<{ apps: InstalledApp[] }>;
  /** Opens exactly the named component (and profile). Without `activityName`, the package's default launcher activity. */
  launch(options: { packageName: string; activityName?: string; user?: string }): Promise<void>;
  /** `appsChanged` fires when a package is added, removed, changed, or a profile is paused/unlocked. */
  addListener(event: 'appsChanged', listener: (change: { packageName?: string; reason?: string }) => void): Promise<{ remove(): Promise<void> }>;
  /** Resolves, without launching, the handler Android would use for the role. */
  resolveDefault(options: { role: DefaultAppRole }): Promise<DefaultApp>;
  /** Opens the role's handler with no data (an empty dial pad for 'dial'). */
  openDefault(options: { role: DefaultAppRole }): Promise<void>;
  buildInfo(): Promise<{ launcher: boolean; version: string }>;
  platformCapabilities(): Promise<{aospImage: boolean; phone: false; contacts: false; sms: false}>;
  /** How the Activity was opened; `assistant` for ACTION_ASSIST or the 'alpha.assistant' extra. */
  launchInfo(): Promise<{ assistant: boolean }>;
  /** Device locale (BCP 47) and Android's 24-hour setting. */
  localeInfo(): Promise<{ locale: string; hour24: boolean }>;
}>("DeviceApps");
export const isAndroid = Capacitor.getPlatform() === "android";
/** False only when a native DeviceApps is present without listener support. Capacitor turns a
 * listener on such a plugin into a rejection its caller cannot catch, and the returned promise
 * never settles. Every Android `Plugin` declares `addListener`, so this is true on a phone. */
export const deviceAppsListens = (() => {
  const header = (Capacitor as typeof Capacitor & { PluginHeaders?: { name: string; methods?: { name: string }[] }[] }).PluginHeaders?.find(entry => entry.name === "DeviceApps");
  return !header || !!header.methods?.some(method => method.name === "addListener");
})();
export { System };
