import {walkthroughProgress, type WalkthroughChoice, type WalkthroughProgress} from '../../../.eliza/client-features/packages/ui/src/components/permissions/permission-walkthrough.ts';
import {startupPermissionKeys, nativeStartupPermissionKeys} from './startup-permission-flow.ts';

/**
 * Alpha's installed walkthrough progress (shared resumable progress, packages/ui permissions).
 * Versions: 1 the four-step list (browser and early native), 2 the historical five-step native
 * list, 3 the current native list with Calendar and Photos. Unfinished native setup resumes on
 * version 3; completed historical installations stay completed.
 */
export const startupPermissionProgressKey = 'alpha:startup-permission-walkthrough:v1';
export type StartupPermissionChoice = WalkthroughChoice;
export type StartupPermissionProgress = WalkthroughProgress & {version: 1 | 2 | 3};
const native = walkthroughProgress(startupPermissionProgressKey, {1: startupPermissionKeys.length, 2: 5, 3: nativeStartupPermissionKeys.length}, 3);
const browser = walkthroughProgress(startupPermissionProgressKey, {1: startupPermissionKeys.length}, 1);
/** Installation UI progress only. Neither this marker nor a previous choice grants platform access. */
export function readStartupPermissionProgress(storage: Pick<Storage, 'getItem'>, isNative = false): StartupPermissionProgress {
  return (isNative ? native : browser).read(storage) as StartupPermissionProgress;
}
/** Use the existing non-secret renderer preference store on WebView and web; await its write/readback before UI advances. */
export function writeStartupPermissionProgress(storage: Pick<Storage, 'getItem' | 'setItem'>, progress: StartupPermissionProgress, isNative = false): void {
  (isNative ? native : browser).write(storage, progress);
}
