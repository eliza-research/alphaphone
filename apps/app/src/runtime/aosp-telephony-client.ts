import { registerPlugin } from '../platform-plugins';
import { AOSP_TELEPHONY_PLUGIN, aospImage } from './aosp-image';
import { createAospTelephony, registerTelephonyProfile, type AlphaTelephonyPlugin } from './aosp-telephony';
/** The app's telephony client. Off the verified Alpha AOSP image no plugin proxy is even created,
 * and every call rejects with TelephonyUnavailable. */
export const aospTelephony = createAospTelephony(aospImage ? registerPlugin<AlphaTelephonyPlugin>(AOSP_TELEPHONY_PLUGIN) : null, aospImage);
/** Shared Messages and Phone surfaces send and dial only through this reviewed client on the image;
 * an unadmitted client is never registered, so elsewhere they keep their own (hidden) paths. */
registerTelephonyProfile(aospTelephony);
