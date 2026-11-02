import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins.ts';

/**
 * One-tap app update (Settings, Software update). The native AlphaUpdate plugin fetches the one
 * configured manifest (app.config.json updateManifestUrl) and, from the owner's tap, installs the
 * offered APK through Android's PackageInstaller: Android asks the owner to confirm and installs
 * only an APK of this package signed like the installed app. Nothing is privileged, silent or in
 * the background. Every failure is quiet: the row keeps the installed version and a later check or
 * tap retries.
 *
 * Manifest: {schema: "alpha-update/v1", versionCode, versionName, apkUrl (HTTPS), sha256 (64
 * lowercase hex), sizeBytes, notes (optional)}. Only a versionCode above the installed one is offered.
 */
export const UPDATE_SCHEMA = 'alpha-update/v1';
/** AppUpdateTransfer.MAX_BYTES, which the native download enforces, is the same bound. */
export const UPDATE_MAX_BYTES = 1024 * 1024 * 1024;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_KEY = 'alpha.app-update.v1';
export type AppUpdate = {versionCode: number; versionName: string; apkUrl: string; sha256: string; sizeBytes: number; notes: string};

const httpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
/** The update a manifest offers over the installed versionCode, or null for anything not complete, newer and HTTPS. */
export function parseUpdateManifest(value: unknown, installedVersionCode: unknown): AppUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {schema, versionCode, versionName, apkUrl, sha256, sizeBytes, notes = ''} = value as Record<string, unknown>;
  if (schema !== UPDATE_SCHEMA || !Number.isSafeInteger(installedVersionCode) || !Number.isSafeInteger(versionCode) || (versionCode as number) <= (installedVersionCode as number)) return null;
  if (typeof versionName !== 'string' || !/^[^\u0000-\u001f\u007f]{1,64}$/.test(versionName) || typeof notes !== 'string' || notes.length > 500) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0 || (sizeBytes as number) > UPDATE_MAX_BYTES || !httpsUrl(apkUrl)) return null;
  return {versionCode: versionCode as number, versionName, apkUrl, sha256, sizeBytes: sizeBytes as number, notes};
}
/** A day after the last automatic check, or at once when that time is unknown or in the future. */
export function updateCheckDue(checkedAt: number, now: number): boolean {
  return !(now >= checkedAt && now - checkedAt < UPDATE_CHECK_INTERVAL_MS);
}

const updates = registerPlugin<{check(): Promise<{manifest: string}>; install(update: AppUpdate): Promise<{status: 'installing' | 'settings'}>}>('AlphaUpdate');
/** The last manifest a check returned, kept with its time so a restart offers it without checking again. */
let saved: {checkedAt: number; manifest: unknown} | undefined;
function lastCheck() {
  if (saved) return saved;
  try {
    const value = JSON.parse(localStorage.getItem(UPDATE_KEY) ?? 'null');
    if (value && typeof value === 'object' && Number.isFinite(value.checkedAt)) return saved = {checkedAt: value.checkedAt, manifest: value.manifest};
  } catch { /* Unreadable storage only means the next check is due. */ }
  return saved = {checkedAt: Number.NaN, manifest: null};
}
function remember(checkedAt: number, manifest: unknown) {
  saved = {checkedAt, manifest};
  try { localStorage.setItem(UPDATE_KEY, JSON.stringify(saved)); } catch { /* Kept for this session. */ }
}

/** At most one automatic check a day (app start and resume); `force` is the owner's Check for updates. */
export async function checkForUpdate(force: boolean, now = Date.now()): Promise<void> {
  const last = lastCheck();
  if (!Capacitor.isNativePlatform() || !force && !updateCheckDue(last.checkedAt, now)) return;
  remember(now, last.manifest);
  try { remember(now, JSON.parse((await updates.check()).manifest)); } catch { /* Quiet: the next check retries. */ }
}
/** The saved manifest's update over the versionCode Android reports for Alpha (AlphaDevice appVersionCode). */
export function availableUpdate(installedVersionCode: unknown): AppUpdate | null {
  return parseUpdateManifest(lastCheck().manifest, installedVersionCode);
}
/** From the owner's Install update tap only. Without Android's install-unknown-apps permission for Alpha, the plugin opens that Android page instead. */
export async function installUpdate(update: AppUpdate): Promise<void> {
  try { await updates.install(update); } catch { /* Quiet: the row stays and the next tap retries. */ }
}
