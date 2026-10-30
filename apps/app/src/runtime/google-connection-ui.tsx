import {DailyApps} from '../daily';
import {watchGoogleConnectionReturn,sameGoogleConnectionReturnBinding,type GoogleConnectionReturnBinding} from './google-connection-return';
import {gmailBackgroundStatus,gmailBackgroundMessage,GMAIL_BACKGROUND_CHANGED} from './gmail-background';
import {isAndroid} from '../native';
import {gmailGrantTier,googleAccountAccessLabel} from './gmail-grants';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {holdPhoneInert} from './modal-inert';
import {connectionController} from './connection-ui';
import {createGoogleAccounts,GOOGLE_ACCOUNTS_CHANGED,googleDisconnectConfirmation,googleDisconnectMessage} from './google-accounts';
import {clearGoogleCalendarSelectionForConnection} from './google-calendar-selection';
import {openConnectionBrowser,googleWorkspaceReturnPort} from './native-connection';
import {prepareGoogleWorkspaceReturn,watchGoogleWorkspaceReturn,sameGoogleWorkspaceBinding,type GoogleWorkspaceBinding} from './google-workspace-return';
import {cloudServiceName,type GmailAccount} from './cloud-protocol';
import {googleAgentAccess,publishGoogleAgentAccess,setGoogleAgentAccess} from './google-agent-access';
let opened=false;const listeners=new Set<()=>void>();
export const googleConnectionController={open(){opened=true;for(const listener of listeners)listener();},close(){opened=false;for(const listener of listeners)listener();},subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>opened};
export function googleCalendarAccountKey(){const account=connectionController.getSnapshot().cloudAccount;return account?.organizationId?{environment:account.environment,userId:account.userId,organizationId:account.organizationId}:null;}
function currentGoogleConnectionReturnBinding():GoogleConnectionReturnBinding|null {
 const cloud=connectionController.getCloudClient(),key=googleCalendarAccountKey();
 return cloud&&key?{client:cloud.client,...key,sessionId:cloud.sessionId,credentialId:cloud.credentialId}:null;
}
/** One connection manager for Settings, Inbox and Calendar; provider grants remain in Cloud. */
function currentWorkspaceBinding():GoogleWorkspaceBinding|null {
 const b=currentGoogleConnectionReturnBinding();
 if(!b||(b.environment!=='production'&&b.environment!=='staging'))return null;
 return {environment:b.environment,userId:b.userId,organizationId:b.organizationId,credentialId:b.credentialId,sessionId:b.sessionId};
}
export function GoogleConnectionsPanel(){
 const open=useSyncExternalStore(googleConnectionController.subscribe,googleConnectionController.getSnapshot);
 const connection=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);
 const [background,setBackground]=useState('');
 useEffect(()=>{if(!open)return;let alive=true;const read=()=>void gmailBackgroundStatus().then(value=>{if(alive)setBackground(gmailBackgroundMessage(value));});read();window.addEventListener(GMAIL_BACKGROUND_CHANGED,read);return()=>{alive=false;window.removeEventListener(GMAIL_BACKGROUND_CHANGED,read);};},[open]);
 const [accounts,setAccounts]=useState<GmailAccount[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState<GmailAccount|null>(null),[revision,setRevision]=useState(0);
 const [access,setAccess]=useState(googleAgentAccess);
 // The agent host reads the owner's Google switches; republish whenever device settings load or change.
 useEffect(()=>{const sync=()=>{setAccess(googleAgentAccess());void publishGoogleAgentAccess();};sync();window.addEventListener('alpha:device-settings',sync);return()=>window.removeEventListener('alpha:device-settings',sync);},[]);
 const returnedWorkspaceOwner=useRef<GoogleWorkspaceBinding|null>(null);
 const returnedWorkspace=useRef<{result:'connected'|'denied'|'failed';connectionId?:string}|null>(null);
 const returnWatch=useRef<ReturnType<typeof watchGoogleConnectionReturn>|null>(null);
 const active=useRef<AbortController|null>(null),panel=useRef<HTMLDivElement>(null);
 const cloud=connectionController.getCloudClient(),key=googleCalendarAccountKey();
 const serviceName=cloudServiceName(cloud?.client.environment ?? connection.cloudAccount?.environment ?? 'production');
 const identity=JSON.stringify([connection.cloudAccount,cloud?.sessionId,cloud?.credentialId]);
 const binding:GoogleConnectionReturnBinding|null=cloud&&key?{client:cloud.client,...key,sessionId:cloud.sessionId,credentialId:cloud.credentialId}:null;
 async function load(){
  const returned=sameGoogleWorkspaceBinding(returnedWorkspaceOwner.current??{environment:'production',userId:'',organizationId:'',sessionId:'',credentialId:''},currentWorkspaceBinding())?returnedWorkspace.current:null;
  if(!returned)returnedWorkspace.current=null;
  const requiredConnectionId=returned?.result==='connected'?returned.connectionId:undefined;
  active.current?.abort();const abort=active.current=new AbortController();setAccounts([]);setConfirm(null);
  if(!cloud||!key){setBusy(false);setNotice(`Sign in to ${serviceName} to connect Google.`);return;}
  const current=()=>!abort.signal.aborted&&active.current===abort&&googleConnectionController.getSnapshot()&&sameGoogleConnectionReturnBinding(binding,currentGoogleConnectionReturnBinding());
  setBusy(true);setNotice('Checking Google connections…');
  try{
   if(!current())return;
   const rows=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).list(abort.signal);if(!current())return;setAccounts(rows);
   if(requiredConnectionId&&!rows.some(row=>row.connected&&row.connectionId===requiredConnectionId)){setNotice('Google returned, but that connection could not be verified. Existing connections are unchanged.');return;}
   // Calendar is one merged view: the agent's Calendar reads every calendar these accounts show in Google.
   setNotice(returned?.result==='denied'?'Google authorization was cancelled. Existing connections are unchanged.':returned?.result==='failed'?'Google authorization did not complete. Existing connections are unchanged.':!rows.some(row=>row.connected)?'No Google account connected.':rows.some(row=>row.connected&&row.grantedCapabilities.includes('google.calendar.read'))?'Calendar includes the calendars you show in Google.':'');if(returnedWorkspace.current===returned)returnedWorkspace.current=null;
  }catch(error){if(current()){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Google connections could not be verified. Check sign-in and try again.');}}
  finally{if(active.current===abort)setBusy(false);}
 }
 useEffect(()=>{if(!open)return;void load();return()=>{active.current?.abort();};},[open,identity,revision,cloud?.client]);
 useEffect(()=>{
  if(!open||!binding)return;
  const watcher=watchGoogleConnectionReturn({binding,current:currentGoogleConnectionReturnBinding,foreground:()=>!document.hidden,refresh:()=>setRevision(value=>value+1),
   onVisibilityChange:listener=>{document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);},
   onFocus:listener=>{window.addEventListener('focus',listener);return()=>window.removeEventListener('focus',listener);},
   ...(isAndroid?{onNativeResume:(listener:()=>void)=>DailyApps.addListener('appResumed',listener)}:{}),
  });
  returnWatch.current=watcher;
  return()=>{watcher.close();if(returnWatch.current===watcher)returnWatch.current=null;active.current?.abort();};
 },[open,identity,cloud?.client]);
 useEffect(()=>{
  const port=googleWorkspaceReturnPort,owner=currentWorkspaceBinding();
  if(!port||!owner)return;
  const watcher=watchGoogleWorkspaceReturn(port,owner,currentWorkspaceBinding,result=>{
   returnedWorkspaceOwner.current=owner;returnedWorkspace.current=result;googleConnectionController.open();setRevision(value=>value+1);
  },()=>{if(googleConnectionController.getSnapshot())setNotice('Google return could not be verified. Check Google connections.');});
  return()=>watcher.close();
 },[identity,cloud?.client]);
 useEffect(()=>{if(!open)return;const accountsChanged=()=>setRevision(value=>value+1);window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,accountsChanged);return()=>window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,accountsChanged);},[open]);
 useEffect(()=>{
  if(!open)return;
  const element=panel.current,previous=document.activeElement,phone=document.querySelector<HTMLElement>('.os');
  const releaseInert=holdPhoneInert(phone);
  if(phone&&element){const theme=getComputedStyle(phone);for(const token of ['bg','fg','s2','line','mut','acc'])element.style.setProperty(`--connection-${token}`,theme.getPropertyValue(token==='acc'?'--acct':`--${token}`));}
  element?.focus();
  const back=(event:Event)=>{if(document.querySelector('dialog[open]'))return;event.preventDefault();event.stopImmediatePropagation();active.current?.abort();googleConnectionController.close();};
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){back(event);return;}if(event.key==='Tab'&&element){const items=[...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary')];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}};
  window.addEventListener('alpha-back',back,true);document.addEventListener('keydown',keydown);
  return()=>{window.removeEventListener('alpha-back',back,true);document.removeEventListener('keydown',keydown);releaseInert();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[open]);
 /** Connect asks once for everything Cloud grants (Gmail read and send, Calendar read and edit), so the agent works on first use.
  * Gmail drafts, archive, trash and read state (gmail.compose/gmail.modify) are not in Cloud's Google scope allowlist yet. */
 async function connect(permission:'read'|'modify'|'send'='send',calendarPermission:'read'|'write'='write'){
  if(!cloud){googleConnectionController.close();connectionController.openCloudAccount();return;}
  const watcher=returnWatch.current;if(!watcher)return;
  active.current?.abort();const abort=active.current=new AbortController();let cancelReturn:(()=>void)|undefined;let returnState:string|undefined;let phase:'native-return'|'cloud'|'browser'='native-return';
  const current=()=>!abort.signal.aborted&&active.current===abort&&returnWatch.current===watcher&&watcher.isCurrent()&&googleConnectionController.getSnapshot()&&sameGoogleConnectionReturnBinding(binding,currentGoogleConnectionReturnBinding());
  if(!current())return;
  setBusy(true);setNotice('Opening Google authorization…');
  try{
   const owner=currentWorkspaceBinding();
   const offer=owner?await prepareGoogleWorkspaceReturn(googleWorkspaceReturnPort,owner,currentWorkspaceBinding):undefined;
   returnState=offer?.state;
   phase='cloud';
   const accountsClient=createGoogleAccounts(cloud,()=>connectionController.getCloudClient());
   const authorization=offer?await accountsClient.connectWithReturn(abort.signal,offer.redirectUrl,calendarPermission,permission):{authUrl:await accountsClient.connect(abort.signal,calendarPermission,permission),appReturn:false};
   if(offer&&!authorization.appReturn){await googleWorkspaceReturnPort?.cancel(offer.state);returnState=undefined;}
   const url=authorization.authUrl;
   if(!current())return;
   cancelReturn=watcher.arm(); // Before openExternal; its immediate resolution is not a return.
   phase='browser';
   await openConnectionBrowser(url,abort.signal);abort.signal.throwIfAborted();
   if(current())setNotice(authorization.appReturn?'After authorizing Google, return to Alpha to verify the connection.':'After authorizing Google, return here and check connections.');
  }catch(error){cancelReturn?.();if(returnState)await googleWorkspaceReturnPort?.cancel(returnState).catch(()=>{});if(current()){if(phase==='cloud')connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Google authorization could not start. Check your Cloud sign-in and retry.');}}
  finally{if(active.current===abort)setBusy(false);}
 }
 /** Off only stops agent writes; on uses the existing grant, or asks Google once when it is missing. */
 async function toggleAccess(kind:'gmailChanges'|'calendarEdits',granted:boolean){
  const on=!(access[kind]&&granted);
  try{await setGoogleAgentAccess({[kind]:on});}catch{setNotice('That setting could not be saved. Try again.');return;}
  if(on&&!granted)await connect(accounts.some(account=>gmailGrantTier(account)==='modify')?'modify':'send','write');
 }
 async function disconnect(account:GmailAccount){if(!cloud||!key||!account.connectionId)return;active.current?.abort();const abort=active.current=new AbortController();setBusy(true);setConfirm(null);try{const result=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).disconnect(account.connectionId,abort.signal);if(result.outcome==='disconnected')clearGoogleCalendarSelectionForConnection(key,account.connectionId);setNotice(googleDisconnectMessage(result.outcome,account.label,serviceName));setAccounts(result.accounts||[]);}catch(error){if(!abort.signal.aborted){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Disconnect was not confirmed. Check Google connections before trying again.');}}finally{if(active.current===abort)setBusy(false);}}
 if(!open)return null;
 const connected=accounts.filter(account=>account.connected);
 const gmailGranted=connected.some(account=>account.grantedCapabilities.includes('google.gmail.send')),calendarGranted=connected.some(account=>account.grantedCapabilities.includes('google.calendar.write'));
 const icon={width:20,height:20,display:'inline-block',background:'currentColor',mask:'url(/icons/lucide/x.svg) center / contain no-repeat',WebkitMask:'url(/icons/lucide/x.svg) center / contain no-repeat'};
 return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-google-connections" role="dialog" aria-modal="true" aria-labelledby="google-connections-title" tabIndex={-1} ref={panel}>
  <header><h2 id="google-connections-title">Google accounts</h2><button aria-label="Close Google accounts" onClick={()=>{active.current?.abort();googleConnectionController.close();}}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={icon}/></button></header>
  <p>Connect Gmail and Google Calendar.</p>
  <p role="status">{notice}</p>
  <p>{background}</p>
  {connected.map(account=><section className="alpha-connection-current alpha-google-account" key={account.connectionId}><strong>{account.label}</strong><span>{googleAccountAccessLabel(account)}</span><button className="alpha-google-disconnect" aria-label={`Disconnect Google account ${account.label}`} disabled={busy} onClick={()=>setConfirm(account)}>Disconnect</button></section>)}
  {connected.length>0&&<section aria-label="Agent access to Google"><h3>Agent access</h3><p>Turning a switch off keeps Google connected and reading still works. Alpha asks you to review email sends and Calendar changes, even when “Ask before agent actions” is off.</p>
   {([['gmailChanges','Gmail changes','Send email for you.',gmailGranted],['calendarEdits','Calendar edits','Create and update events.',calendarGranted]] as const).map(([kind,label,detail,granted])=><label className="alpha-google-switch" key={kind}><span><strong>{label}</strong><small>{granted?detail:`${detail} Needs Google approval.`}</small></span><input type="checkbox" role="switch" aria-label={label} checked={access[kind]&&granted} disabled={busy} onChange={()=>void toggleAccess(kind,granted)}/></label>)}
  </section>}
  {confirm&&<section role="alert"><p style={{whiteSpace:'pre-line'}}>{googleDisconnectConfirmation(confirm.label,serviceName)}</p><button disabled={busy} onClick={()=>void disconnect(confirm)}>Confirm disconnect Google account</button><button disabled={busy} onClick={()=>setConfirm(null)}>Keep connected</button></section>}
  <div className="alpha-connection-actions"><button disabled={busy} onClick={()=>void connect()}>{cloud?(accounts.some(account=>account.connected)?'Add Google account':'Connect Google account'):`Sign in to ${serviceName}`}</button><button disabled={busy||!cloud} onClick={()=>setRevision(value=>value+1)}>Check Google connections</button></div>
 </div></div>;
}
