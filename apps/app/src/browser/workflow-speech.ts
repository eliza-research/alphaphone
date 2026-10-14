export {speakDeviceText as speakWorkflowText} from '../runtime/device-speech';

/** Dev pickup is explicit; events while hidden or locked cannot release private speech. */
export function waitForWorkflowPickup(signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{window.removeEventListener('alpha:dev-pickup',pickup);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(new DOMException('Pickup cancelled','AbortError'));};
  const pickup=()=>{if(document.hidden||document.documentElement.dataset.devBackground==='true'||Array.from(document.querySelectorAll('[aria-label="Unlock with fingerprint"], [aria-label="Wake"]')).some(element=>element.getClientRects().length))return;cleanup();resolve();};
  window.addEventListener('alpha:dev-pickup',pickup);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 });
}
