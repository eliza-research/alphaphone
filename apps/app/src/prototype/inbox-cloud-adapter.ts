import { registerPlugin } from '../platform-plugins';
const attachmentNative=registerPlugin<{openReviewed(input:Record<string,unknown>):Promise<{message:string}>;cancel():Promise<void>}>('AlphaMailAttachments');
import {reviewMailContext,validateMailContext,type ReviewedMailContext,type MailContextSource} from '../runtime/reviewed-mail-context';
import { inboxProviderControls } from './inbox-provider-controls';
import { inboxDrafts } from './inbox-drafts';
import { connectionController } from '../runtime/connection-ui';
import type { GmailAccount, GmailMessage } from '../runtime/cloud-protocol';
import { alphaGmailHost } from '../runtime/native-connection';
import { beginAlphaGmail, finishAlphaGmail, pendingGmailReturn, activeGmailAttempt, cancelAlphaGmail } from '../runtime/alpha-gmail';
import { DailyApps } from '../daily';

type Bag = Record<string, any>;
/** Managed Gmail reads and explicit encrypted local drafts in the reference Inbox layout. Provider content lives
 * only in this closure, never prototype persistence or automatic agent context. */
export function installInboxCloudAdapter(Component: any, views: Record<string, Bag>) {
  const view = views.inbox, p = Component.prototype;
  view.persist = [];
  view.state = { ...view.state, mails: [], sent: [], open: null, compose: null, q: null, nativeMailSelection: null };
  view.reply = () => null;
  let shell: Bag | undefined, api: Bag | undefined;
  let accounts: GmailAccount[] = [], messages: GmailMessage[] = [];
  let loadedQuery = '', loadedLimit: 25 | 50 = 25;
  let thread: {id:string;previousOffsets:number[];offset:number;historyId:string;nextOffset:number|null;total:number;messages:{message:GmailMessage;bodyText:string;historyId:string|null;attachments?:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[]}[]}|null=null;
  let contextReview:ReviewedMailContext|null=null,contextBusy=false;
  let attachmentView:{name:string;text:string;hash:string;external:boolean;open:()=>void}|null=null;
  let selected = '', body: { message: GmailMessage; bodyText: string; historyId?:string|null;attachments?:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[] } | null = null;
  let status = 'Sign in to Alpha Phone to use Gmail', phase = 'idle', revision = '';
  let agentSession = connectionController.getSnapshot().session?.sessionId;
  let operation: AbortController | null = null, generation = 0, sessionId: string | undefined;
  let gmailWaiting=false;
  const publish = (patch: Bag = {}) => shell?.vset('inbox', { nativeMailTick: Date.now(), ...patch });
  const provider = inboxProviderControls(() => publish(), text => api?.toast(text));
  const drafts = inboxDrafts(() => publish(), text => api?.toast(text), provider);
  provider.setEditor((proposal,reference)=>drafts.editProvider(proposal,reference));
  function clear() {
    void attachmentNative.cancel().catch(()=>{});contextReview=null;attachmentView=null;provider.reset(); drafts.reset();
    generation++; operation?.abort(); operation = null;
    gmailWaiting=false;
    thread=null; accounts = []; messages = []; selected = ''; loadedQuery = ''; loadedLimit = 25; body = null; phase = 'idle'; revision = '';
    status = 'Sign in to Alpha Phone to use Gmail';
    publish({ mails: [], sent: [], open: null, compose: null, nativeMailSelection: null });
  }
  function cancelRead() {
    // Cancelling a provider read does not retire this owner/session or its drafts.
    // Invalidate first so even a transport that ignores abort cannot publish later.
    generation++; operation?.abort(); operation = null;
    void attachmentNative.cancel().catch(()=>{}); contextReview=null; attachmentView=null;
    thread=null; messages=[]; body=null; loadedQuery=''; loadedLimit=25; revision='';
    phase='ready'; status='Gmail request cancelled';
    publish({ open:null, nativeMailSelection:null });
  }
  async function work(label: string, task: (binding: NonNullable<ReturnType<typeof connectionController.getCloudClient>>, signal: AbortSignal, valid: () => boolean) => Promise<void>) {
    if (operation) return;
    const binding = connectionController.getCloudClient();
    if (!binding) { connectionController.open(); return; }
    const token = ++generation, controller = new AbortController();
    operation = controller; phase = 'busy'; status = label; publish();
    const valid = () => token === generation && !controller.signal.aborted && binding.sessionId === connectionController.getCloudClient()?.sessionId;
    try { await task(binding, controller.signal, valid); }
    catch (error) {
      if (valid() && connectionController.rejectCloudSession(binding.sessionId, error)) {
        status = 'Alpha Phone sign-in expired. Sign in again to continue.'; publish(); return;
      }
      if (valid()) {
        messages = []; body = null; phase = 'error';
        status = 'Gmail unavailable. Check your account and retry.';
        publish({ open: null, nativeMailSelection: null });
      }
    } finally { if (token === generation) { operation = null; if (phase === 'busy') phase = 'ready'; publish(); } }
  }
  async function refreshAccounts() {
    await work('Checking Gmail connection…', async ({ client }, signal, valid) => {
      const result = await client.gmailAccounts(signal);
      if (!valid()) return;
      accounts = result; messages = []; body = null;
      if (!accounts.some(a => a.connectionId === selected && a.connected && a.grantedCapabilities.includes('google.gmail.triage'))) selected = accounts.find(a => a.connected && a.grantedCapabilities.includes('google.gmail.triage'))?.connectionId || '';
      void provider.bind(selected); void drafts.bind(selected, accounts.find(a => a.connectionId === selected)?.label || '');
      status = selected ? 'Gmail connected. Tap Load Inbox.' : 'Connect Gmail to read your inbox';
      publish({ open: null, nativeMailSelection: null });
    });
  }
  async function connect(permission:'read'|'send'|'drafts'|'mailbox'='read') {
    await work('Confirm Gmail access in Google’s secure account chooser', async ({ client }, signal, valid) => {
      const owner=connectionController.getSnapshot().cloudAccount;
      if(!owner)throw Error('Sign in to Alpha Phone first');
      await beginAlphaGmail(owner,permission,alphaGmailHost,state=>client.initiateGmail(signal,permission,state),signal);
      if(valid())gmailWaiting=true;
      if (valid()) status = 'Waiting for Google. You’ll return to Alpha Phone when authorization finishes.';
    });
  }
  let checkingReturn=false;
  async function checkGmailReturn():Promise<boolean> {
    if(checkingReturn||operation||!shell)return false;
    const owner=connectionController.getSnapshot().cloudAccount,binding=connectionController.getCloudClient();
    if(!owner||!binding)return false;
    checkingReturn=true;
    try {
      const waiting=!!await activeGmailAttempt(owner,alphaGmailHost);
      if(binding.sessionId!==connectionController.getCloudClient()?.sessionId)return false;
      if(waiting!==gmailWaiting){gmailWaiting=waiting;publish();}
      if(!await pendingGmailReturn(owner,alphaGmailHost)||binding.sessionId!==connectionController.getCloudClient()?.sessionId)return false;
      await work('Checking the returned Gmail permissions…',async({client},signal,valid)=>{
        if(shell?.S().view!=='inbox')shell?.openView('inbox');
        const outcome=await finishAlphaGmail(owner,alphaGmailHost,()=>client.gmailAccounts(signal),signal);
        if(!outcome||!valid())return;
        gmailWaiting=false;
        if(outcome.accounts){accounts=outcome.accounts;selected=accounts.find(a=>a.connectionId===outcome.connectionId&&a.connected&&a.grantedCapabilities.includes('google.gmail.triage'))?.connectionId||'';void provider.bind(selected);void drafts.bind(selected,accounts.find(a=>a.connectionId===selected)?.label||'');}
        status=outcome.result==='connected'?'Gmail permissions confirmed. Tap Load Inbox.':outcome.result==='denied'?'Gmail authorization was cancelled.':outcome.result==='missing-permission'?'Google returned, but the requested Gmail permission is not confirmed. Review access and try again.':'Gmail authorization could not finish. Try connecting again.';
        publish({open:null,nativeMailSelection:null});
      });
      return true;
    } catch {return false;}
    finally {checkingReturn=false;}
  }
  async function load(more = false) {
    if (!selected) { await refreshAccounts(); return; }
    const accountId = selected;
    const query = String(api?.get('inbox')?.q || '').trim() || 'in:inbox';
    const limit = more && query === loadedQuery ? 50 : 25;
    await work('Loading Gmail…', async ({ client }, signal, valid) => {
      const result = await client.gmailSearch(accountId, query, signal, limit);
      if (!valid() || selected !== accountId || (String(api?.get('inbox')?.q || '').trim() || 'in:inbox') !== query) return;
      loadedQuery = query; loadedLimit = limit;
      messages = result.messages; revision = result.syncedAt; body = null;
      status = messages.length ? `${messages.length} messages loaded · up to ${limit} results` : 'No messages match this search';
      publish({ open: null, nativeMailSelection: null });
    });
  }
  async function open(message: GmailMessage) {
    const accountId = selected;
    thread=null; await work('Loading message…', async ({ client }, signal, valid) => {
      const result = await client.gmailRead(accountId, message.id, signal);
      if (!valid() || accountId !== selected) return;
      body = result;
      if(provider.capabilities()?.threads){const page=await client.gmailThread(accountId,message.threadId,signal);if(!valid()||accountId!==selected)return;thread={id:message.threadId,previousOffsets:[],...page};const exact=page.messages.find(row=>row.message.id===message.id);if(exact)body=exact;}
      publish({ open: message.id, openLocal: true,
        nativeMailSelection: { kind: 'email', id: message.id, accountId, revision } });
    });
  }
  function mailContext():MailContextSource {if(!body||!selected||!body.historyId)throw new Error('Refresh this message before sharing');return {accountId:selected,messageId:body.message.id,revision:body.historyId,from:body.message.from,to:body.message.to,subject:body.message.subject,bodyText:body.bodyText};}
  async function askAgent(){try{const destination=connectionController.getSnapshot().session;if(!destination)throw new Error('Connect an agent first');const source=mailContext(),token=generation;const review=await reviewMailContext(source,destination);if(token!==generation||JSON.stringify(source)!==JSON.stringify(mailContext()))throw new Error('Message changed');contextReview=review;publish();}catch(error){api?.toast((error as Error).message);}}
  async function sendContext(){if(!contextReview||contextBusy)return;contextBusy=true;publish();try{const review=contextReview,destination=connectionController.getSnapshot().session;if(!destination)throw new Error('Agent disconnected');const text=await validateMailContext(review,mailContext(),destination);if(contextReview!==review)throw new Error('Review closed');contextReview=null;publish();if(!api)throw new Error("Inbox closed");await api.sendReviewedMail(text,destination);}catch(error){api?.toast((error as Error).message);}finally{contextBusy=false;publish();}}
  async function openAttachment(source:NonNullable<typeof body>,attachment:NonNullable<NonNullable<typeof body>['attachments']>[number]){
    if(!attachment.supported||!source.historyId){api?.toast('Supported attachments are PDF, PNG, JPEG, WebP or TXT up to 5 MiB.');return;}const accountId=selected;
    await work('Loading selected attachment…',async({client},signal,valid)=>{const file=await client.gmailAttachment(accountId,source.message.id,attachment.partId,source.historyId!,signal);if(!valid()||accountId!==selected||body!==source)return;attachmentView={name:file.name,text:file.text??`${file.mimeType} · ${file.size} bytes. Open a temporary read-only copy in an installed viewer. The viewer receives this file.`,hash:file.sha256,external:file.text===undefined,open:()=>{if(accountId!==selected||body!==source)return;void attachmentNative.openReviewed({...file,reviewed:true}).then(result=>api?.toast(result.message)).catch(error=>api?.toast(error.message));}};publish();});
  }
  async function nextThreadPage(previous=false){
    const prior=thread,accountId=selected;if(!prior||(!previous&&prior.nextOffset===null))return;
    await work('Loading next thread page…',async({client},signal,valid)=>{
      const page=await client.gmailThread(accountId,prior.id,signal,{offset:previous?(prior.previousOffsets.at(-1)??0):prior.nextOffset!,historyId:prior.historyId});
      if(!valid()||accountId!==selected||thread!==prior)return;
      thread={id:prior.id,previousOffsets:previous?prior.previousOffsets.slice(0,-1):[...prior.previousOffsets,prior.offset],...page};body=page.messages[0]||null;publish({open:body?.message.id||null,nativeMailSelection:null});
    });
  }
  function changeQuery(query: string | null) {
    generation++; operation?.abort(); operation = null;
    thread=null; messages = []; body = null; loadedQuery = ''; loadedLimit = 25;
    phase = 'ready'; status = query === null ? 'Tap Load Inbox to read this account' : 'Tap Search Gmail to load results';
    publish({ q: query, open: null, nativeMailSelection: null });
  }
  const unsupported = () => api?.toast('Gmail is read-only here. No message has been changed or sent.');
  view.back = (st: Bag, current: Bag) => {
    if(contextReview){contextReview=null;publish();return true;}
    if(attachmentView){attachmentView=null;publish();return true;}
    if (provider.close()) return true;
    if (drafts.close()) return true;
    if (st.open != null) { body = null; current.set({ open: null, nativeMailSelection: null }); return true; }
    if (st.q != null) { changeQuery(null); return true; }
    return false;
  };
  view.onLeave = () => { void attachmentNative.cancel().catch(()=>{}); contextReview=null;attachmentView=null;generation++; operation?.abort(); operation = null; drafts.close(); messages = []; body = null; publish({ open: null, nativeMailSelection: null }); };
  view.render = (st: Bag, current: Bag) => {
    api = current;
    const binding = connectionController.getCloudClient();
    if (phase === 'idle' && binding && current.isActive()) {
      phase = 'scheduled'; queueMicrotask(() => { if (api?.isActive()) void refreshAccounts(); });
    }
    const chip = (label: string, action: () => void, on = false) => ({ label, on,
      css: on ? 'background:var(--fg);color:var(--bg)' : 'background:var(--s2);color:var(--fg)', pick: action });
    const chips: Bag[] = binding ? [
      chip('Connect Gmail', () => void connect()),
      ...(gmailWaiting?[chip('Cancel Gmail connection attempt',()=>void work('Cancelling Gmail connection attempt…',async(_binding,_signal,valid)=>{const owner=connectionController.getSnapshot().cloudAccount;if(owner)await cancelAlphaGmail(owner,alphaGmailHost);if(valid()){gmailWaiting=false;status='Stopped waiting for Google. Previously granted access is unchanged.';}}))]:[]),
      chip('Check connection', () => void checkGmailReturn().then(found=>{if(!found)void refreshAccounts();})),
      ...(selected&&!provider.capabilities()?.send?[chip('Authorize Gmail sending',()=>void connect('send'))]:[]),
      ...(selected&&!provider.capabilities()?.providerDrafts?[chip('Authorize Gmail drafts',()=>void connect('drafts'))]:[]),
      ...(selected&&!provider.capabilities()?.mailboxMutations?[chip('Authorize mailbox changes',()=>void connect('mailbox'))]:[]),
      ...accounts.filter(a => a.connectionId).map(a => chip(a.label, () => {
        if (operation) return;
        void attachmentNative.cancel().catch(()=>{});contextReview=null;attachmentView=null;selected = a.connected && a.grantedCapabilities.includes('google.gmail.triage') ? a.connectionId! : ''; void provider.bind(selected); void drafts.bind(selected, a.label); messages = []; body = null;
        status = selected ? 'Tap Load Inbox to read this account' : 'This account needs Gmail authorization';
        publish({ open: null, nativeMailSelection: null });
      }, a.connectionId === selected)),
      ...(selected ? [chip(st.q ? 'Search Gmail' : 'Load Inbox', () => void load())] : []),
      ...(messages.length >= 25 && loadedLimit === 25 ? [chip('Load up to 50 results', () => void load(true))] : []),
      ...(messages.length ? [chip(`${messages.length} loaded · max ${loadedLimit}`, () => api?.toast('Cloud search supports up to 50 results. Refine your search to find other messages.'))] : []),
    ] : [chip('Sign in to Alpha Phone', () => connectionController.open())];
    chips.push(...drafts.chips(chip), ...provider.chips(chip));

    if (operation) chips.push(chip('Cancel', cancelRead));
    const date = (value: string) => { const d = new Date(value); return Number.isNaN(d.valueOf()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    const activeBody = st.open && body?.message.id === st.open ? body : null;
    const rows = messages.map(m => ({ name: m.from, ini: m.from.slice(0, 1).toUpperCase(), subj: m.subject || '(no subject)',
      snip: m.snippet, time: date(m.receivedAt), nameW: m.unread ? '700' : '500', subjCss: 'color:var(--fg)',
      dot: m.unread ? 'var(--acct)' : 'transparent', clip: false, tx: 0, down: () => {}, up: () => {},
      label: `${m.from}, ${m.subject}`, open: () => void open(m) }));
    return { contextReviewOpen:!!contextReview,contextReview:contextReview?{source:`From: ${contextReview.source.from}\nTo: ${contextReview.source.to.join(', ')}\nSubject: ${contextReview.source.subject}\n\n${contextReview.source.bodyText}`,destination:`${contextReview.destination.origin} · agent ${contextReview.destination.agentId} · owner ${contextReview.destination.ownerId}`,send:()=>void sendContext(),busy:contextBusy,close:()=>{contextReview=null;publish();}}:null,attachmentOpen:!!attachmentView,attachment:attachmentView?{...attachmentView,close:()=>{attachmentView=null;publish();}}:null,chips, rows, searching: st.q != null, notSearching: st.q == null, q: st.q || '', hasQ: false,
      openSearch: () => changeQuery(''), closeSearch: () => changeQuery(null), onQ: (e: Bag) => changeQuery(e.target.value),
      compose: () => drafts.begin(), empty: rows.length === 0, emptyIcon: 'M4 6h16v12H4zM4 6l8 6 8-6', emptyText: status,
      emptyAdd: false, addAcct: () => void connect(), detail: !!activeBody, ...drafts.render(), ...provider.render(),
      d: activeBody ? { hasThread:!!thread,threadRows:thread?thread.messages.map(row=>chip(`${row.message.from}: ${row.message.subject}`,()=>{body=row;publish({open:row.message.id,nativeMailSelection:null});})):[], hasPreviousThread:!!thread&&thread.previousOffsets.length>0,previousThread:()=>void nextThreadPage(true),hasNextThread:thread?.nextOffset!=null, nextThread:()=>void nextThreadPage(), threadStatus:thread?`${thread.total} messages in this thread`:'', subj: activeBody.message.subject || '(no subject)', name: activeBody.message.from,
        ini: activeBody.message.from.slice(0, 1).toUpperCase(), meta: `To ${activeBody.message.to.join(', ')} · ${date(activeBody.message.receivedAt)}`,
        body: activeBody.bodyText || '(Empty message)', noPerson: true, hasPerson: false, hasAtt:!!activeBody.attachments?.length,atts:(activeBody.attachments||[]).map(a=>({name:a.name,size:`${a.size} bytes · ${a.supported?'Review attachment':'Unsupported type or size'}`,open:()=>void openAttachment(activeBody,a)})),
        canArchive: !!provider.capabilities()?.mailboxMutations&&!!activeBody.historyId, canAsk:!!body?.historyId&&!!connectionController.getSnapshot().session,ask:()=>void askAgent(),reply: () => drafts.begin(activeBody.message),canReplyAll:true,replyAll:()=>drafts.begin(activeBody.message,'reply-all'), forward: ()=>drafts.begin(activeBody.message,'forward',activeBody.bodyText), del: ()=>{if(!activeBody.historyId){unsupported();return;}void provider.prepare({kind:'trash',messageId:activeBody.message.id,expectedHistoryId:activeBody.historyId});}, archive: ()=>{if(!activeBody.historyId){unsupported();return;}void provider.prepare({kind:'archive',messageId:activeBody.message.id,expectedHistoryId:activeBody.historyId});} } : null };
  };
  const mount = p.componentDidMount, unmount = p.componentWillUnmount;
  p.componentDidMount = function () {
    mount.call(this); shell = this; sessionId = connectionController.getCloudClient()?.sessionId;
    this.inboxConnectionUnsubscribe = connectionController.subscribe(() => {
      const next = connectionController.getCloudClient()?.sessionId;
      if (next !== sessionId) { sessionId = next; clear(); void checkGmailReturn(); }
      const nextAgent = connectionController.getSnapshot().session?.sessionId;
      if (nextAgent !== agentSession) { contextReview=null;agentSession = nextAgent; publish({ nativeMailSelection: null }); }
    });
    void checkGmailReturn();
    this.inboxResume = DailyApps.addListener('appResumed', () => { void checkGmailReturn().then(found=>{if(!found&&api?.isActive()&&!operation)void refreshAccounts();}); }).catch(() => null);
  };
  p.componentWillUnmount = function () {
    this.inboxConnectionUnsubscribe?.(); void this.inboxResume?.then((handle: Bag) => handle?.remove());
    shell = undefined; clear(); unmount?.call(this);
  };
}
