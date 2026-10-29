import {DailyApps} from '../daily';
import {watchGoogleConnectionReturn,sameGoogleConnectionReturnBinding,type GoogleConnectionReturnBinding} from './google-connection-return';
import {gmailBackgroundStatus,gmailBackgroundMessage,gmailNotificationSettings,GMAIL_BACKGROUND_CHANGED} from './gmail-background';
import {isAndroid} from '../native';
import {gmailGrantTier,googleAccountAccessLabel} from './gmail-grants';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {holdPhoneInert} from './modal-inert';
import {connectionController} from './connection-ui';
import {createGoogleAccounts,GOOGLE_ACCOUNTS_CHANGED,googleDisconnectConfirmation,googleDisconnectMessage} from './google-accounts';
import {GoogleCalendarReader,type GoogleCalendarBinding,type GoogleCalendarSource} from './google-calendar';
import {clearGoogleCalendarSelectionForConnection,readGoogleCalendarSelection,saveGoogleCalendarSelection,GOOGLE_CALENDAR_SELECTION_CHANGED} from './google-calendar-selection';
import {openConnectionBrowser} from './native-connection';
import {cloudServiceName,type GmailAccount} from './cloud-protocol';
let opened=false;const listeners=new Set<()=>void>();
export const googleConnectionController={open(){opened=true;for(const listener of listeners)listener();},close(){opened=false;for(const listener of listeners)listener();},subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>opened};
export function googleCalendarAccountKey(){const account=connectionController.getSnapshot().cloudAccount;return account?.organizationId?{environment:account.environment,userId:account.userId,organizationId:account.organizationId}:null;}
export function currentGoogleCalendarBinding(connectionId:string):GoogleCalendarBinding|null{const cloud=connectionController.getCloudClient(),account=connectionController.getSnapshot().cloudAccount;if(!cloud||!account?.organizationId)return null;return {...account,organizationId:account.organizationId,connectionId};}
function currentGoogleConnectionReturnBinding():GoogleConnectionReturnBinding|null {
 const cloud=connectionController.getCloudClient(),key=googleCalendarAccountKey();
 return cloud&&key?{client:cloud.client,...key,sessionId:cloud.sessionId,credentialId:cloud.credentialId}:null;
}
/** One connection manager for Settings, Inbox and Calendar; provider grants remain in Cloud. */
export function GoogleConnectionsPanel(){
 const open=useSyncExternalStore(googleConnectionController.subscribe,googleConnectionController.getSnapshot);
 const connection=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);
 const [background,setBackground]=useState('');
 useEffect(()=>{if(!open)return;let alive=true;const read=()=>void gmailBackgroundStatus().then(value=>{if(alive)setBackground(gmailBackgroundMessage(value));});read();window.addEventListener(GMAIL_BACKGROUND_CHANGED,read);return()=>{alive=false;window.removeEventListener(GMAIL_BACKGROUND_CHANGED,read);};},[open]);
 const [accounts,setAccounts]=useState<GmailAccount[]>([]),[sources,setSources]=useState<GoogleCalendarSource[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState<GmailAccount|null>(null),[revision,setRevision]=useState(0);
 const [,refreshSelection]=useState(0);
 const returnWatch=useRef<ReturnType<typeof watchGoogleConnectionReturn>|null>(null);
 const active=useRef<AbortController|null>(null),panel=useRef<HTMLDivElement>(null);
 const cloud=connectionController.getCloudClient(),key=googleCalendarAccountKey();
 const serviceName=cloudServiceName(cloud?.client.environment ?? connection.cloudAccount?.environment ?? 'production');
 const identity=JSON.stringify([connection.cloudAccount,cloud?.sessionId,cloud?.credentialId]);
 const binding:GoogleConnectionReturnBinding|null=cloud&&key?{client:cloud.client,...key,sessionId:cloud.sessionId,credentialId:cloud.credentialId}:null;
 const selected=key?readGoogleCalendarSelection(key):null;
 async function load(){
  active.current?.abort();const abort=active.current=new AbortController();setAccounts([]);setSources([]);setConfirm(null);
  if(!cloud||!key){setBusy(false);setNotice(`Sign in to ${serviceName} to connect Google.`);return;}
  const current=()=>!abort.signal.aborted&&active.current===abort&&googleConnectionController.getSnapshot()&&sameGoogleConnectionReturnBinding(binding,currentGoogleConnectionReturnBinding());
  setBusy(true);setNotice('Checking Google connections…');
  try{
   if(!current())return;
   const rows=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).list(abort.signal);if(!current())return;setAccounts(rows);
   const offered:GoogleCalendarSource[]=[];const warnings:string[]=[];
   for(const account of rows.filter(row=>row.connected&&row.grantedCapabilities.includes('google.calendar.read'))){
    const id=account.connectionId;if(!id)continue;
    const reader=new GoogleCalendarReader(cloud.client,()=>current()?currentGoogleCalendarBinding(id):null);
    const result=await reader.listSources(abort.signal);reader.invalidate();if(!current())return;
    if(result.status==='ready')offered.push(...result.calendars);else warnings.push(result.message);
   }
   setSources(offered);setNotice(warnings.join(' ')||(!rows.some(row=>row.connected)?'No Google account connected.':'Choose a calendar to show alongside local events.'));
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
 // A display preference costs a local render only; grant changes and explicit refresh still reload provider data.
 useEffect(()=>{if(!open)return;const accountsChanged=()=>setRevision(value=>value+1),selectionChanged=()=>refreshSelection(value=>value+1);window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,accountsChanged);window.addEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,selectionChanged);return()=>{window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,accountsChanged);window.removeEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,selectionChanged);};},[open]);
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
 async function connect(permission:'read'|'modify'|'send'='read',calendarPermission:'read'|'write'='read'){
  if(!cloud){googleConnectionController.close();connectionController.openCloudAccount();return;}
  const watcher=returnWatch.current;if(!watcher)return;
  active.current?.abort();const abort=active.current=new AbortController();let cancelReturn:(()=>void)|undefined;
  const current=()=>!abort.signal.aborted&&active.current===abort&&returnWatch.current===watcher&&watcher.isCurrent()&&googleConnectionController.getSnapshot()&&sameGoogleConnectionReturnBinding(binding,currentGoogleConnectionReturnBinding());
  if(!current())return;
  setBusy(true);setNotice('Opening Google authorization…');
  try{
   const url=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).connect(abort.signal,calendarPermission,permission);
   if(!current())return;
   cancelReturn=watcher.arm(); // Before openExternal; its immediate resolution is not a return.
   await openConnectionBrowser(url,abort.signal);abort.signal.throwIfAborted();
   if(current())setNotice('After authorizing Google, return here and check connections.');
  }catch(error){cancelReturn?.();if(current()){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Google authorization could not start. Check your Cloud sign-in and retry.');}}
  finally{if(active.current===abort)setBusy(false);}
 }
 async function disconnect(account:GmailAccount){if(!cloud||!key||!account.connectionId)return;active.current?.abort();const abort=active.current=new AbortController();setBusy(true);setConfirm(null);try{const result=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).disconnect(account.connectionId,abort.signal);if(result.outcome==='disconnected')clearGoogleCalendarSelectionForConnection(key,account.connectionId);setNotice(googleDisconnectMessage(result.outcome,account.label,serviceName));setAccounts(result.accounts||[]);setSources([]);}catch(error){if(!abort.signal.aborted){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Disconnect was not confirmed. Check Google connections before trying again.');}}finally{if(active.current===abort)setBusy(false);}}
 if(!open)return null;
 const icon={width:20,height:20,display:'inline-block',background:'currentColor',mask:'url(/icons/lucide/x.svg) center / contain no-repeat',WebkitMask:'url(/icons/lucide/x.svg) center / contain no-repeat'};
 return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-google-connections" role="dialog" aria-modal="true" aria-labelledby="google-connections-title" tabIndex={-1} ref={panel}>
  <header><h2 id="google-connections-title">Google accounts</h2><button aria-label="Close Google accounts" onClick={()=>{active.current?.abort();googleConnectionController.close();}}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={icon}/></button></header>
  <p>Connect Gmail and Google Calendar.</p>
  <p role="status">{notice}</p>
  <p>{background}</p>
  {isAndroid&&<button onClick={()=>void gmailNotificationSettings().catch(()=>setBackground('Android notification settings are unavailable.'))}>Gmail notification settings</button>}
  {accounts.filter(account=>account.connected).map(account=><section className="alpha-connection-current alpha-google-account" key={account.connectionId}><strong>{account.label}</strong><span>{googleAccountAccessLabel(account)}</span><details><summary>Gmail permissions</summary><p>Extra access is optional. Google will ask you to approve any change.</p>
   <p>{gmailGrantTier(account)==='modify'?'Sending, Gmail drafts and mailbox changes are enabled.':'Gmail changes use one additional consent for sending, drafts, archive, trash and read state.'}</p>
   {gmailGrantTier(account)!=='modify'&&<button disabled={busy} onClick={()=>void connect('modify')}>Enable Gmail changes</button>}
  </details><button className="alpha-google-disconnect" aria-label={`Disconnect Google account ${account.label}`} disabled={busy} onClick={()=>setConfirm(account)}>Disconnect</button></section>)}
  {accounts.some(account=>account.connected&&(!account.grantedCapabilities.includes('google.gmail.send')||!account.grantedCapabilities.includes('google.calendar.write')))&&<section aria-label="Google permission upgrades"><h3>Sending and Calendar sync</h3><p>Approve additional Google access to send email and create or update Calendar events. Alpha still asks you to review email sends and Calendar changes, even when “Ask before agent actions” is off.</p><button disabled={busy} onClick={()=>void connect(accounts.some(account=>gmailGrantTier(account)==='modify')?'modify':'send','write')}>Review Google permission upgrade</button><p>Google shows the account and requested permissions before you approve. Existing local events stay on this device.</p></section>}
  {(!!sources.length||!!selected)&&<section><h3 id="google-calendar-display-title">Calendar to display</h3><p>Show a Google calendar alongside your local events.</p><div className="alpha-google-calendar-choices" role="radiogroup" aria-labelledby="google-calendar-display-title"><label className={`alpha-google-calendar-option${!selected?' is-selected':''}`}><input type="radio" name="google-calendar" aria-label="Local calendars only" checked={!selected} disabled={busy} onChange={()=>{if(key&&!saveGoogleCalendarSelection(key,null))setNotice('Calendar choice could not be saved.');}}/><span>Local calendars only</span></label>{sources.map(source=><label className={`alpha-google-calendar-option${selected?.sourceId===source.id?' is-selected':''}`} key={source.id}><input type="radio" name="google-calendar" aria-label={source.name===source.account?source.name:`${source.name} · ${source.account}`} checked={selected?.sourceId===source.id} disabled={busy} onChange={()=>{if(key&&!saveGoogleCalendarSelection(key,{connectionId:source.connectionId,sourceId:source.id,providerCalendarId:source.providerCalendarId,name:source.name,account:source.account}))setNotice('Calendar choice could not be saved.');}}/><span><strong>{source.name}</strong>{source.name!==source.account&&<small>{source.account}</small>}</span></label>)}</div></section>}
  {confirm&&<section role="alert"><p style={{whiteSpace:'pre-line'}}>{googleDisconnectConfirmation(confirm.label,serviceName)}</p><button disabled={busy} onClick={()=>void disconnect(confirm)}>Confirm disconnect Google account</button><button disabled={busy} onClick={()=>setConfirm(null)}>Keep connected</button></section>}
  <div className="alpha-connection-actions"><button disabled={busy} onClick={()=>void connect()}>{cloud?(accounts.some(account=>account.connected)?'Add Google account':'Connect Google account'):`Sign in to ${serviceName}`}</button><button disabled={busy||!cloud} onClick={()=>setRevision(value=>value+1)}>Check Google connections</button></div>
 </div></div>;
}
