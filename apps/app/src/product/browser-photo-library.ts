import {createBrowserPhotoLibrary} from './photos-upstream';
import {albumDocument} from '../browser/preference-documents';

/** Installed media and receipts stay in the same database; Camera and Photos share this engine. */
export const browserPhotoLibrary=createBrowserPhotoLibrary({
  databaseName:'alpha.browser.photos.v1',albums:albumDocument,appName:'Alpha',
});
export const importBrowserPhoto=browserPhotoLibrary.importPhoto;
export const saveBrowserMedia=browserPhotoLibrary.saveLocally;
const unavailable=async()=>{throw Error('This operation is not available for browser photos. The original is unchanged.');};
/** Temporary old Camera widget shape; every implemented operation delegates to the shared store. */
export const browserLibrary=new Proxy(browserPhotoLibrary,{get(target,key){return Reflect.get(target,key)??unavailable;}});
