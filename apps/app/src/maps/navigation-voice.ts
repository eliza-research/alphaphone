import { NavigationVoice as SharedNavigationVoice } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts';
import { speakDeviceText } from '../runtime/device-speech';
export class NavigationVoice extends SharedNavigationVoice {
 constructor(failed:(error?:unknown)=>void) { let failure:unknown;super(()=>failed(failure),async(text,signal)=>{try{await speakDeviceText(text,signal);}catch(error){failure=error;throw error;}}); }
}
