/** Requires the reviewed Files workspace revision in the canonical consumer artifact. */
export {
  createBrowserFiles,
  createFilesIndex,
  compareFilesEntries,
  matchesFileQuery,
  recentKey,
  sortLabel,
  typeLabel,
  RECENT_LIMIT,
} from '../../../../.eliza/browser-consumer/index.js';
export type {
  FilesHost, FilesIndex, FilesIndexKeys, RecentKind, RecentFile, SortMode,
} from '../../../../.eliza/browser-consumer/index.js';
