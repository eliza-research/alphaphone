import {type PluginListenerHandle} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
import {createOnDeviceVoice} from './local-voice';
import {speakDeviceText} from './device-speech';

type Clip={recordingId:string;durationMs:number};
const recorder=registerPlugin<{
  startRecording(input:{maxDurationMs:29000}):Promise<{recordingId:string;maxDurationMs:number}>;
  stopRecording():Promise<Clip>;
  getRecordingMetrics(input:{recordingId:string}):Promise<{recordingId:string;peak:number;rms?:number}>;
  cancelRecording():Promise<unknown>;
  cancel(input:{requestId:string}):Promise<unknown>;
  addListener(event:'recordingStopped',callback:(clip:Clip)=>void):Promise<PluginListenerHandle>;
}>('AlphaVoiceCloud');

/** The bridge name is historical: this port never calls its Cloud speech methods. */
export function createLocalConversationVoice(assertCurrent:()=>void){
  const local=createOnDeviceVoice();
  if(!local)throw Error('On-device speech is unavailable. Use the keyboard to continue.');
  return {
    async ready(signal:AbortSignal){assertCurrent();const ready=await local.ready(signal);assertCurrent();if(!ready)throw Error('On-device speech models are unavailable. Use the keyboard to continue.');},
    async startRecording(){assertCurrent();const value=await recorder.startRecording({maxDurationMs:29000});assertCurrent();return value;},
    async stopRecording(){assertCurrent();const value=await recorder.stopRecording();assertCurrent();return value;},
    async getRecordingMetrics(recordingId:string){
      assertCurrent();const value=await recorder.getRecordingMetrics({recordingId});assertCurrent();
      if(value.recordingId!==recordingId||!Number.isFinite(value.peak)||value.peak<0||value.peak>1||(value.rms!==undefined&&(!Number.isFinite(value.rms)||value.rms<0||value.rms>1)))throw Error('Recording metrics were not verified.');
      return value;
    },
    async transcribe(recordingId:string,signal:AbortSignal){assertCurrent();const value=await local.transcribe(recordingId,signal);assertCurrent();return value;},
    cancel:(input:{requestId:string})=>recorder.cancel(input),
    cancelRecording:()=>recorder.cancelRecording(),
    addListener:(event:'recordingStopped',callback:(clip:Clip)=>void)=>recorder.addListener(event,value=>{try{assertCurrent();}catch{return;}callback(value);}),
    speak:(text:string,signal:AbortSignal,onStarted?:()=>void)=>speakDeviceText(text,signal,onStarted,false,assertCurrent),
  };
}
