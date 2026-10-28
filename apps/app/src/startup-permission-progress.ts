import {startupPermissionKeys, nativeStartupPermissionKeys} from './startup-permission-flow.ts';

export const startupPermissionProgressKey = 'alpha:startup-permission-walkthrough:v1';
export type StartupPermissionChoice = 'allowed' | 'continued' | 'skipped';
export type StartupPermissionProgress = {version: 1 | 2 | 3; status: 'pending' | 'completed'; step: number; choices?: StartupPermissionChoice[]};
const first = (native: boolean): StartupPermissionProgress => ({version: native ? 3 : 1, status: 'pending', step: 0});
/** Installation UI progress only. Neither this marker nor a previous choice grants platform access. */
export function readStartupPermissionProgress(storage: Pick<Storage, 'getItem'>, native = false): StartupPermissionProgress {
  const raw = storage.getItem(startupPermissionProgressKey);
  if (raw === null) return first(native);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !['status,step,version','choices,status,step,version'].includes(Object.keys(value).sort().join(','))) throw Error('Setup progress is unavailable.');
  const progress = value as StartupPermissionProgress;
  const count = progress.version === 1 ? startupPermissionKeys.length : progress.version === 2 ? 5 : nativeStartupPermissionKeys.length;
  if (!(progress.version === 1 || native && (progress.version === 2 || progress.version === 3)) || !Number.isInteger(progress.step) ||
    progress.status === 'pending' && (progress.step < 0 || progress.step >= count) ||
    progress.status === 'completed' && progress.step !== count ||
    !['pending', 'completed'].includes(progress.status) ||
    progress.choices !== undefined && (!Array.isArray(progress.choices) || progress.choices.length !== progress.step || progress.choices.some(choice => !['allowed','continued','skipped'].includes(choice)))) throw Error('Setup progress is unavailable.');
  // Completed historical v1/v2 installations stay completed. Only unfinished native setup gains current Calendar/Photos.
  return {...progress, version: native && progress.status === 'pending' ? 3 : progress.version};
}
/** Use the existing non-secret renderer preference store on WebView and web; await its write/readback before UI advances. */
export function writeStartupPermissionProgress(storage: Pick<Storage, 'getItem' | 'setItem'>, progress: StartupPermissionProgress, native = false): void {
  const raw = JSON.stringify(progress);
  // Validate both shape and readback through the same reader; no secret/native credential slot is opened.
  readStartupPermissionProgress({getItem: () => raw}, native);
  storage.setItem(startupPermissionProgressKey, raw);
  if (storage.getItem(startupPermissionProgressKey) !== raw) throw Error('Setup progress could not be saved.');
}
