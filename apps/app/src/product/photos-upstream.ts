/** The reviewed full-App artifact is the sole source of shared Photos behavior.
 * Build preparation must stage its verified manifest and index before this module loads. */
export {
  createBrowserPhotoLibrary,
  createBrowserPhotosHost,
  createBrowserMediaCopyJournal,
  createMediaCopyJournal,
  applyPhotoFilter,
  validateVideoEdit,
  drawEditedVideo,
  renderVideoEdit,
} from '../../../../.eliza/browser-consumer/index.js';
export type {PhotosHost,VideoEdit} from '../../../../.eliza/browser-consumer/index.js';
