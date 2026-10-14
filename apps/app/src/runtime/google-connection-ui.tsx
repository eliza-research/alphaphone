import {gmailGrantTier} from './gmail-grants';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {holdPhoneInert} from './modal-inert';
import {connectionController} from './connection-ui';
import {createGoogleAccounts,GOOGLE_ACCOUNTS_CHANGED,googleDisconnectConfirmation,googleDisconnectMessage} from './google-accounts';
import {GoogleCalendarReader,type GoogleCalendarBinding,type GoogleCalendarSource} from './google-calendar';
import {clearGoogleCalendarSelectionForConnection,readGoogleCalendarSelection,saveGoogleCalendarSelection,GOOGLE_CALENDAR_SELECTION_CHANGED} from './google-calendar-selection';
import {openConnectionBrowser} from './native-connection';
import type {GmailAccount} from './cloud-protocol';
let opened=false;const listeners=new Set<()=>void>();
export const googleConnectionController={open(){opened=true;for(const listener of listeners)listener();},close(){opened=false;for(const listener of listeners)listener();},subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>opened};
export function googleCalendarAccountKey(){const account=connectionController.getSnapshot().cloudAccount;return account?.organizationId?{environment:account.environment,userId:account.userId,organizationId:account.organizationId}:null;}
export function currentGoogleCalendarBinding(connectionId:string):GoogleCalendarBinding|null{const cloud=connectionController.getCloudClient(),account=connectionController.getSnapshot().cloudAccount;if(!cloud||!account?.organizationId)return null;return {...account,organizationId:account.organizationId,connectionId};}
/** One connection manager for Settings, Inbox and Calendar; provider grants remain in Cloud. */
export function GoogleConnectionsPanel(){
 const open=useSyncExternalStore(googleConnectionController.subscribe,googleConnectionController.getSnapshot);
 const connection=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);
 const [accounts,setAccounts]=useState<GmailAccount[]>([]),[sources,setSources]=useState<GoogleCalendarSource[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState<GmailAccount|null>(null),[revision,setRevision]=useState(0);
 const active=useRef<AbortController|null>(null),panel=useRef<HTMLDivElement>(null);
 const cloud=connectionController.getCloudClient(),key=googleCalendarAccountKey();
 const identity=JSON.stringify([connection.cloudAccount,cloud?.sessionId,cloud?.credentialId]);
 const selected=key?readGoogleCalendarSelection(key):null;
 async function load(){
  active.current?.abort();const abort=active.current=new AbortController();setAccounts([]);setSources([]);setConfirm(null);
  if(!cloud||!key){setBusy(false);setNotice('Sign in to Eliza Cloud to connect Google.');return;}
  const current=()=>!abort.signal.aborted&&connectionController.getCloudClient()?.sessionId===cloud.sessionId&&connectionController.getCloudClient()?.credentialId===cloud.credentialId;
  setBusy(true);setNotice('Checking Google connections…');
  try{
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
 useEffect(()=>{if(!open)return;void load();return()=>{active.current?.abort();};},[open,identity,revision]);
 useEffect(()=>{if(!open)return;const changed=()=>setRevision(value=>value+1);window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,changed);window.addEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,changed);return()=>{window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,changed);window.removeEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,changed);};},[open]);
 useEffect(()=>{if(!open)return;const element=panel.current,previous=document.activeElement;const releaseInert=holdPhoneInert(document.querySelector<HTMLElement>('.os'));element?.focus();const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){active.current?.abort();googleConnectionController.close();}if(event.key==='Tab'&&element){const items=[...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}};document.addEventListener('keydown',keydown);return()=>{document.removeEventListener('keydown',keydown);releaseInert();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[open]);
 async function connect(permission:'read'|'modify'='read'){if(!cloud){googleConnectionController.close();connectionController.openCloudAccount();return;}active.current?.abort();const abort=active.current=new AbortController();setBusy(true);setNotice('Opening Google authorization…');try{const url=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).connect(abort.signal,'read',permission);await openConnectionBrowser(url,abort.signal);abort.signal.throwIfAborted();setNotice('After authorizing Google, return here and check connections.');}catch(error){if(!abort.signal.aborted){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Google authorization could not start. Check your Cloud sign-in and retry.');}}finally{if(active.current===abort)setBusy(false);}}
 async function disconnect(account:GmailAccount){if(!cloud||!key||!account.connectionId)return;active.current?.abort();const abort=active.current=new AbortController();setBusy(true);setConfirm(null);try{const result=await createGoogleAccounts(cloud,()=>connectionController.getCloudClient()).disconnect(account.connectionId,abort.signal);if(result.outcome==='disconnected')clearGoogleCalendarSelectionForConnection(key,account.connectionId);setNotice(googleDisconnectMessage(result.outcome,account.label));setAccounts(result.accounts||[]);setSources([]);}catch(error){if(!abort.signal.aborted){connectionController.rejectCloudSession(cloud.sessionId,error);setNotice('Disconnect was not confirmed. Check Google connections before trying again.');}}finally{if(active.current===abort)setBusy(false);}}
 if(!open)return null;
 const icon={width:20,height:20,display:'inline-block',background:'currentColor',mask:'url(/icons/lucide/x.svg) center / contain no-repeat',WebkitMask:'url(/icons/lucide/x.svg) center / contain no-repeat'};
 return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="google-connections-title" tabIndex={-1} ref={panel}>
  <header><h2 id="google-connections-title">Google accounts</h2><button aria-label="Close Google accounts" onClick={()=>{active.current?.abort();googleConnectionController.close();}}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={icon}/></button></header>
  <p>Connect Gmail and Google Calendar to your signed-in Eliza Cloud account. This does not change your agent’s inference provider.</p>
  <p role="status">{notice}</p>
  {accounts.filter(account=>account.connected).map(account=><section className="alpha-connection-current" key={account.connectionId}><strong>{account.label}</strong><span>Connected · Gmail: {account.grantedCapabilities.includes('google.gmail.triage')?'Read access':'Not authorized'} · Calendar: {account.grantedCapabilities.includes('google.calendar.read')?'Read access':'Not authorized'}</span><details><summary>Gmail permissions</summary><p>Extra access is optional. Google will ask you to approve any change.</p>
   <p>{gmailGrantTier(account)==='modify'?'Sending, Gmail drafts and mailbox changes are enabled.':'Gmail changes use one additional consent for sending, drafts, archive, trash and read state.'}</p>
   {gmailGrantTier(account)!=='modify'&&<button disabled={busy} onClick={()=>void connect('modify')}>Enable Gmail changes</button>}
  </details><button disabled={busy} onClick={()=>setConfirm(account)}>Disconnect Google account {account.label}</button></section>)}
  {(!!sources.length||!!selected)&&<section><h3>Calendar to display</h3><p>Read-only Google events stay separate from local calendars.</p><label><input type="radio" name="google-calendar" checked={!selected} disabled={busy} onChange={()=>{if(key&&!saveGoogleCalendarSelection(key,null))setNotice('Calendar choice could not be saved.');}}/> Local calendars only</label>{sources.map(source=><label key={source.id}><input type="radio" name="google-calendar" checked={selected?.sourceId===source.id} disabled={busy} onChange={()=>{if(key&&!saveGoogleCalendarSelection(key,{connectionId:source.connectionId,sourceId:source.id,providerCalendarId:source.providerCalendarId,name:source.name,account:source.account}))setNotice('Calendar choice could not be saved.');}}/> {source.name} · {source.account}</label>)}</section>}
  {confirm&&<section role="alert"><p style={{whiteSpace:'pre-line'}}>{googleDisconnectConfirmation(confirm.label)}</p><button disabled={busy} onClick={()=>void disconnect(confirm)}>Confirm disconnect Google account</button><button disabled={busy} onClick={()=>setConfirm(null)}>Keep connected</button></section>}
  <div className="alpha-connection-actions"><button disabled={busy} onClick={()=>void connect()}>{cloud?(accounts.some(account=>account.connected)?'Add Google account':'Connect Google account'):'Sign in to Eliza Cloud'}</button><button disabled={busy||!cloud} onClick={()=>setRevision(value=>value+1)}>Check Google connections</button></div>
 </div></div>;
}
