import type {AospTelephony, MmsReviewProblem, MmsSendResult, TelephonyStatus, SmsThread, SmsMessage, SmsSendResult} from './aosp-telephony';
export type SmsReceipt = SmsSendResult;
export const receiptLabel=(status:SmsReceipt['status'])=>({cancelled:'Cancelled — not sent',denied:'Access changed — not sent',failed:'Failure reported; some parts may have sent. Do not repeat automatically.',unknown:'Outcome unknown. Check the recipient before sending again.',submitted:'Submitted to Android; sending and delivery are not confirmed.',sent:'All parts sent; delivery is not confirmed.',delivered:'All parts have delivery confirmation.'}[status]);
/** MMS has no delivery claim: "sent" is the carrier's send confirmation only. */
export const mmsReceiptLabel=(status:MmsSendResult['status'])=>({cancelled:'Cancelled — MMS not sent',denied:'Access changed — MMS not sent',failed:'Android or the carrier refused this MMS. Nothing is resent automatically.',unknown:'MMS outcome unknown. Check the conversation before sending again.',submitted:'MMS submitted to Android; the carrier has not confirmed it.',sent:'The carrier accepted the MMS; delivery is not confirmed.'}[status]);
export const mmsProblemLabel=(problem:MmsReviewProblem)=>({'no-recipient':'Enter at least one phone number.','invalid-recipient':'Check the phone numbers.','too-many-recipients':'An MMS can go to at most ten people.','empty-body':'Enter a message or add a picture.','empty-message':'Enter a message or add a picture.','body-too-long':'MMS text is limited to 1,600 characters.','invalid-body':'The message contains characters that cannot be sent.','sim-unknown':'No active SIM is available.','sim-required':'Select a SIM for this MMS.','sim-not-selectable':'Select a SIM for this MMS.','too-many-attachments':'An MMS can carry at most five pictures.','attachment-type':'Only JPEG, PNG and GIF pictures can be sent.','attachment-name':'A picture could not be named for sending.','attachment-empty':'A picture is empty.','too-large':'The pictures are larger than an MMS allows (1 MB in total).','mms-unavailable':'This phone cannot send MMS from Alpha. Use Review in messaging app.'}[problem]);
/** Provider content and page cursors exist only during the foreground Messages visit. */
export function createSmsSession(client:AospTelephony,image:boolean,onChange:()=>void,onSendUpdated:(id:string)=>void=()=>{},onMmsSendUpdated:(id:string)=>void=()=>{}){
 let epoch=0,visit=0,observing=false,active=false,stop:(()=>Promise<void>)|null=null;
 let observerTail=Promise.resolve();
 const state:{receipts:SmsSendResult[];rows:SmsMessage[];threads:SmsThread[];thread:string|null;status:TelephonyStatus|null;next:string|null;busy:boolean;message:string}={receipts:[],rows:[],threads:[],thread:null,status:null,next:null,busy:false,message:'Choose SMS access to read messages.'};
 function observe(){if(!active||observing||stop||state.status?.permissions.sms!=='granted')return;observing=true;const token=visit;
  observerTail=observerTail.then(async()=>{if(!active||token!==visit)return;const dispose=await client.observeMessages(()=>void refresh(),onSendUpdated,onMmsSendUpdated);if(!active||token!==visit)await dispose();else stop=dispose;}).catch(()=>{}).finally(()=>{if(token===visit)observing=false;});
 }

 /** Holding the SMS role (the only app Android lets keep read state), Alpha marks an opened
  * conversation's shown received messages read; later arrivals stay unread. A failed mark changes nothing shown. */
 function markShown(thread:string,rows:SmsMessage[],status:TelephonyStatus){
  if(!status.roles?.sms?.held||!rows.some(row=>row.direction==='incoming'&&!row.read))return;
  const through=Math.max(...rows.map(row=>row.date));
  if(Number.isSafeInteger(through)&&through>0)void Promise.resolve().then(()=>client.markThreadRead(thread,through)).catch(()=>{});
 }
 async function refresh(more=false){if(!image||!active)return;const token=++epoch;state.busy=true;onChange();try{
  const status=await client.status();if(token!==epoch||!active)return;state.status=status;
  const receipts=await client.smsSendHistory();if(token!==epoch||!active)return;state.receipts=receipts;
  if(status.permissions.sms!=='granted'){state.rows=[];state.threads=[];state.next=null;state.message='SMS read access has not been granted.';return;}
  const cursor=more&&state.next?state.next:undefined;
  if(state.thread){const page=await client.messagePage(state.thread,cursor);if(token!==epoch||!active)return;state.rows=page.rows;state.next=page.next;markShown(state.thread,page.rows,status);}
  else{const page=await client.threadPage(cursor);if(token!==epoch||!active)return;state.threads=page.rows;state.next=page.next;}
  state.message=(state.thread?state.rows.length:state.threads.length)?'Device messages. MMS attachments open in your messaging app.':'No messages found.';
 }catch{if(token===epoch){state.receipts=[];state.rows=[];state.threads=[];state.next=null;state.status=null;state.message='Messages could not be read completely. Check access or use your system messaging app.';}}finally{if(token===epoch){state.busy=false;onChange();void observe();}}}
 return {state,refresh,openThread(id:string|null){epoch++;state.thread=id;state.rows=[];state.threads=[];state.next=null;void refresh();},setActive(value:boolean){if(active===value)return;active=value;++epoch;++visit;if(value){void refresh();}else{const dispose=stop;stop=null;if(dispose)observerTail=observerTail.then(dispose).catch(()=>{});observing=false;state.receipts=[];state.rows=[];state.threads=[];state.thread=null;state.status=null;state.next=null;state.busy=false;onChange();}},async request(access:'sms'|'sendSms'|'phoneState'){if(!image||!active)return;const token=epoch;await client.requestAccess(access);if(active&&token===epoch)await refresh();}};
}
