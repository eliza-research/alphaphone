import {devSurfacesEnabled} from '../build-flags';
/** Voice failures never reach the screen; a developer build keeps them in its log. */
export function logVoiceFailure(failure:unknown){if(devSurfacesEnabled)console.warn('[Alpha voice]',failure);}
