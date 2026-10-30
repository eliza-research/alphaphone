/** Installed storage compatibility. Index validation, ordering and retention live upstream. */
import { createFilesIndex as createSharedFilesIndex } from '../product/files-upstream';
export { RECENT_LIMIT, compareFilesEntries, matchesFileQuery, recentKey, sortLabel, typeLabel } from '../product/files-upstream';
export type { RecentKind, RecentFile, SortMode } from '../product/files-upstream';
export const filesIndexKey='alpha.files.recent.v1';
export const filesOpenKey='alpha.files.open.v1';
export function createFilesIndex(store?:Pick<Storage,'getItem'|'setItem'|'removeItem'>,now?:()=>number){
 return createSharedFilesIndex({recent:filesIndexKey,open:filesOpenKey},store,now);
}
export const filesIndex=createFilesIndex();
