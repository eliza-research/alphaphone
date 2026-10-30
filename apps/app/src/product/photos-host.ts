import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
import {readMediaCopyIntent,admitMediaCopyIntent,acknowledgeMediaCopyIntent,mediaCopyIntentDocument} from '../runtime/media-copy-intent';
import {browserPhotoLibrary} from './browser-photo-library';
import {createBrowserMediaCopyJournal,createBrowserPhotosHost,type PhotosHost} from './photos-upstream';

type Handoffs=Pick<PhotosHost,'ask'|'email'|'registerLibraryAgent'>;
/** Supply this once to BrowserConsumerHostOptions.photos after the real common App is mounted.
 * Runtime/account identity stays with that App; this adapter adds no session or media owner. */
export async function createAlphaPhotosHost(handoffs:Handoffs={}):Promise<PhotosHost|undefined>{
  if(!Capacitor.isNativePlatform()){
    return {...createBrowserPhotosHost(browserPhotoLibrary,createBrowserMediaCopyJournal(await mediaCopyIntentDocument())),...handoffs};
  }
  if(!Capacitor.isPluginAvailable('AlphaPhotos')||!Capacitor.isPluginAvailable('AlphaPhotoLibrary'))return undefined;
  const media=registerPlugin<PhotosHost['media']>('AlphaPhotos');
  const library=registerPlugin<NonNullable<PhotosHost['library']>&{scope():Promise<unknown>;requestAccess():Promise<unknown>}>('AlphaPhotoLibrary');
  return {
    source:'device',media,library,...handoffs,
    access:{scope:()=>library.scope(),requestAccess:()=>library.requestAccess(),openSettings:()=>media.openLibrarySettings()},
    journal:{read:readMediaCopyIntent,reserve:admitMediaCopyIntent,acknowledge:acknowledgeMediaCopyIntent},
    permitsPlayback(url){try{const path=new URL(url);return path.origin===location.origin&&/^\/_alpha_owned_video\/[a-f0-9-]+\.mp4$/.test(path.pathname)&&!path.search&&!path.hash;}catch{return false;}},
  };
}
