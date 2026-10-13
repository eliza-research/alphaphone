import { registerPlugin } from '../platform-plugins';
const attachmentNative=registerPlugin<{openReviewed(input:Record<string,unknown>):Promise<{message:string}>;saveReviewed(input:Record<string,unknown>):Promise<{status:string;message:string}>;cancel():Promise<void>}>('AlphaMailAttachments');
import {reviewMailContext,validateMailContext,type ReviewedMailContext,type MailContextSource} from '../runtime/reviewed-mail-context';
import { inboxProviderControls } from './inbox-provider-controls';
import { presentHomeInboxStatus } from './home-cards';
import { inboxDrafts, type ComposePrefill, type SuggestionTarget } from './inbox-drafts';
import { classifyGmailFailure, disconnectGmailAccount, disconnectMessage, gmailReadable, setGmailReadState, GMAIL_ACCOUNTS_CHANGED, type GmailFailureKind } from '../runtime/gmail-mailbox';
import { connectionController } from '../runtime/connection-ui';
import { safeMailLink, type GmailAccount, type GmailDraftContent, type GmailDraftSummary, type GmailLink, type GmailMessage } from '../runtime/cloud-protocol';
import { reviewOpaqueAttachment } from '../runtime/inbox-operation';
import { openConnectionBrowser } from '../runtime/native-connection';
import { DailyApps } from '../daily';

type Bag = Record<string, any>;
/** A suggestion destination with the account it belongs to. Tokens stay inside the renderer. */
export type EmailTarget = SuggestionTarget & { accountId?: string; account?: string };
/** What Home may show about mail. Only counts, the account label and a time leave the Inbox closure;
 * no subject, sender or body. `unreadMore` means the bounded query or loaded pages did not see every message. */
export interface InboxAttention {
  state: 'not-connected' | 'loading' | 'ready' | 'error' | 'stale';
  unread: number; unreadMore: boolean; source: string | null; updatedAt: string | null;
}
let attention: InboxAttention = { state: 'not-connected', unread: 0, unreadMore: false, source: null, updatedAt: null };
const attentionListeners = new Set<() => void>();
let openInboxHandler: (() => void) | null = null;
function setAttention(next: Partial<InboxAttention>) {
  const value = { ...attention, ...next };
  if (JSON.stringify(value) === JSON.stringify(attention)) return;
  attention = value;
  for (const listener of [...attentionListeners]) { try { listener(); } catch { /* a listener failure never blocks Inbox */ } }
}
/** Home attention summary, computed from the connected account and the last explicitly loaded Inbox page. */
export function inboxAttention(): InboxAttention { return { ...attention }; }
export function subscribeInboxAttention(listener: () => void): () => void { attentionListeners.add(listener); return () => { attentionListeners.delete(listener); }; }
/** Opens the Inbox list (Home's triage tile). A no-op until the Inbox adapter is installed. */
export function openInbox(): void { openInboxHandler?.(); }
/** Plain-text https URLs in a message body, trimmed of trailing punctuation. Nothing is fetched. */
export function linkifyMailText(text: string): GmailLink[] {
  const links: GmailLink[] = [], seen = new Set<string>();
  for (const match of String(text || '').matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    // Trailing punctuation is trimmed in one linear pass (hostile bodies may end a URL with a long run
    // of ")"); a ")" stays while it closes a "(" in the URL.
    const raw = match[0];
    let end = raw.length, open = 0, close = 0;
    for (const c of raw) { if (c === '(') open++; else if (c === ')') close++; }
    while (end > 0 && '.,;:!?)]}>'.includes(raw[end - 1])) { if (raw[end - 1] === ')') { if (open >= close) break; close--; } end--; }
    const link = safeMailLink({ href: raw.slice(0, end), text: raw.slice(0, end) });
    if (link && !seen.has(link.href)) { seen.add(link.href); links.push(link); }
    if (links.length >= 50) break;
  }
  return links;
}
/** The link text names a different site than the destination (a common phishing pattern). */
export function linkTextMismatch(link: GmailLink): boolean {
  let host: string;
  try { host = new URL(link.href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return true; }
  const named = link.text.toLowerCase().match(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,63})(?=[\/:\s]|$)/);
  if (!named) return false;
  const shown = named[1].replace(/^www\./, '');
  return shown !== host && !host.endsWith('.' + shown);
}
/** Managed Gmail reads and explicit encrypted local drafts in the reference Inbox layout. Provider content lives
 * only in this closure, never prototype persistence or automatic agent context. */
export function installInboxCloudAdapter(Component: any, views: Record<string, Bag>) {
  const view = views.inbox, p = Component.prototype;
  view.persist = [];
  view.state = { ...view.state, mails: [], sent: [], open: null, compose: null, q: null, nativeMailSelection: null };
  view.reply = () => null;
  let shell: Bag | undefined, api: Bag | undefined;
  let accounts: GmailAccount[] = [], messages: GmailMessage[] = [], accountsChecked = false;
  type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash';
  const MAILBOX_CHANGED = 'Newer mail arrived while this list was loading and is not shown yet. Load newer mail to read the list again.';
  let newerMail = false;
  const folderQuery: Record<Folder, string> = { inbox: 'in:inbox', sent: 'in:sent', drafts: 'in:drafts', archive: 'in:archive', trash: 'in:trash' };
  let loadedQuery = '', nextPageToken: string | null = null, folder: Folder = 'inbox';
  // Provider drafts are listed separately from messages.
  let providerDrafts: GmailDraftSummary[] = [];
  // Only a boolean leaves this closure: the Home badge reflects the last loaded Inbox page(s).
  // Home retains only metadata from Inbox pages the user already loaded, never message bodies.
  let inboxPreview: {sessionId:string;accountId:string;messages:Pick<GmailMessage,'id'|'subject'|'from'|'unread'>[];more:boolean;readAt:number|null}|null=null;
  let homeFailure:GmailFailureKind|null=null;
  let hasUnread = false;
  let failure: { kind: GmailFailureKind; retry: () => void } | null = null;
  // A moved email (From switcher) names its target account and how to return it to the source.
  type PendingCompose = ComposePrefill & { account?: string; returnTo?: GmailAccount; restore?: () => void };
  let pendingCompose: PendingCompose | null = null, lastCompose: unknown = null, disconnecting = false, resumeDraftFor = '';
  // Read-state requests are keyed by account and message. One may be in flight per message, and an
  // automatic mark-read whose outcome was not confirmed is never sent again for that message.
  const readStateInFlight = new Set<string>(), readStateUnconfirmed = new Set<string>();
  let seenCursors = new Set<string>();
  /** Drops a pending moved email back to its source account (in memory, rewritten on rebind). */
  const returnPending = () => { pendingCompose?.restore?.(); pendingCompose = null; };
  let thread: {id:string;previousOffsets:number[];offset:number;historyId:string;nextOffset:number|null;total:number;messages:{message:GmailMessage;bodyText:string;links?:GmailLink[];historyId:string|null;attachments?:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[]}[]}|null=null;
  let contextReview:ReviewedMailContext|null=null,contextBusy=false;
  // Link rows per opened body: the body text is scanned once, not on every render.
  const linkRowCache=new WeakMap<object,{label:string;href:string;host:string;mismatch:boolean;open:()=>void}[]>();
  let attachmentView:{name:string;text:string;hash:string;external:boolean;open:()=>void;save:()=>void;saveDisabled:boolean;saveStatus:string}|null=null;
  let selected = '', body: { message: GmailMessage; bodyText: string; links?: GmailLink[]; historyId?:string|null;attachments?:{partId:string;name:string;mimeType:string;size:number;supported:boolean}[] } | null = null;
  let status = 'Connect Eliza Cloud to use Gmail', phase = 'idle', revision = '';
  let agentSession = connectionController.getSnapshot().session?.sessionId;
  let operation: AbortController | null = null, generation = 0, sessionId: string | undefined;
  const publish = (patch: Bag = {}) => shell?.vset('inbox', { nativeMailTick: Date.now(), ...patch });
  const provider = inboxProviderControls(() => publish(), text => api?.toast(text));
  const drafts = inboxDrafts(() => publish(), text => api?.toast(text), provider);
  provider.setEditor((proposal,reference)=>drafts.editProvider(proposal,reference));
  provider.setComposer(()=>drafts.email());
  const readable = () => accounts.filter(gmailReadable);
  const currentQuery = () => String(api?.get('inbox')?.q || '').trim() || folderQuery[folder];
  const accountLabel = (id = selected) => accounts.find(a => a.connectionId === id)?.label || null;
  // `fresh` marks a completed first-page provider read. Later pages and local recounts keep that
  // time, so the time shown is never newer than the oldest data counted; no time is invented.
  const recountUnread = (more=inboxPreview?.more??nextPageToken!==null,fresh=false) => {
    if (loadedQuery === 'in:inbox') inboxPreview={sessionId:connectionController.getCloudClient()?.sessionId||'',accountId:selected,messages:messages.map(({id,subject,from,unread})=>({id,subject,from,unread})),more,readAt:fresh?Date.now():inboxPreview?.readAt??null};
    if(loadedQuery==='in:inbox')setAttention({state:'ready',unread:messages.filter(m=>m.unread).length,unreadMore:more,source:accountLabel(),updatedAt:revision||new Date().toISOString()});
    hasUnread=!!inboxPreview?.messages.some(m=>m.unread);
  };
  drafts.setFromSwitch({ count: () => readable().length, cycle: () => void switchFrom() });
  provider.setObservers({
    // A provider-confirmed send removes the local copies of exactly the draft it was sent from.
    sent: (source, proposal, grant) => void drafts.settleSent(source.draftId, proposal, grant), sentNote: source => drafts.sentNote(source.draftId),
    // A stale review was discarded without dispatch; reload the open message so the user sees its current state.
    stale: () => { if (body) void open(body.message); else void load(); },
    receipt: receipt => {
      const id = typeof receipt.providerResult?.messageId === 'string' ? receipt.providerResult.messageId : '';
      if (!id || !['archive', 'trash'].includes(receipt.kind) || !messages.some(m => m.id === id)) return;
      messages = messages.filter(m => m.id !== id);
      if(inboxPreview?.accountId===selected)inboxPreview.messages=inboxPreview.messages.filter(m=>m.id!==id);
      recountUnread();
      if (body?.message.id === id) { body = null; thread = null; publish({ open: null, nativeMailSelection: null }); } else publish();
    },
  });
  provider.onRestored(() => { if (selected && !draftsView()) void load(); });
  function clear() {
    providerDrafts = [];
    setAttention({ state: connectionController.getCloudClient() ? 'loading' : 'not-connected', unread: 0, unreadMore: false, source: null, updatedAt: null });
    void attachmentNative.cancel().catch(()=>{});contextReview=null;attachmentView=null;provider.reset(); drafts.reset();
    generation++; operation?.abort(); operation = null;
    thread=null; accounts = []; accountsChecked = false; messages = []; selected = ''; loadedQuery = ''; nextPageToken = null; body = null; phase = 'idle'; revision = '';
    hasUnread = false; inboxPreview=null;homeFailure=null; failure = null; pendingCompose = null; disconnecting = false; resumeDraftFor = '';
    readStateInFlight.clear(); readStateUnconfirmed.clear(); seenCursors = new Set();
    status = 'Connect Eliza Cloud to use Gmail';
    publish({ mails: [], sent: [], open: null, compose: null, nativeMailSelection: null });
  }
  function cancelRead() {
    // Cancelling a provider read does not retire this owner/session or its drafts.
    // Invalidate first so even a transport that ignores abort cannot publish later.
    generation++; operation?.abort(); operation = null;
    void attachmentNative.cancel().catch(()=>{}); contextReview=null; attachmentView=null;
    thread=null; messages=[]; body=null; loadedQuery=''; nextPageToken=null; revision=''; failure=null;
    phase='ready'; status='Gmail request cancelled';
    publish({ open:null, nativeMailSelection:null });
  }
  /** One provider read at a time. `retry` is offered after a classified failure; `keep` leaves the
   * loaded list in place when only a message, attachment or later page failed. */
  async function work(label: string, task: (binding: NonNullable<ReturnType<typeof connectionController.getCloudClient>>, signal: AbortSignal, valid: () => boolean) => Promise<void>, retry?: () => void, keep = false, kept = '') {
    if (operation) return;
    const binding = connectionController.getCloudClient();
    if (!binding) { connectionController.openCloudAccount(); return; }
    const token = ++generation, controller = new AbortController();
    operation = controller; phase = 'busy'; status = label; failure = null; homeFailure=null;publish();
    const valid = () => token === generation && !controller.signal.aborted && binding.sessionId === connectionController.getCloudClient()?.sessionId;
    try { await task(binding, controller.signal, valid); }
    catch (error) {
      if (valid() && connectionController.rejectCloudSession(binding.sessionId, error)) {
        status = 'Eliza Cloud sign-in expired. Connect Eliza Cloud to continue.'; publish(); return;
      }
      if (valid()) {
        const classified = classifyGmailFailure(error, 'read');
        homeFailure=classified.kind;
        if(classified.kind==='revoked'){inboxPreview=null;hasUnread=false;}
        if (!keep) { messages = []; nextPageToken = null; }
        body = null; thread = null; phase = 'error'; status = classified.message + (keep && messages.length ? kept : '');
        failure = retry ? { kind: classified.kind, retry } : null;
        if (keep && messages.length) api?.toast(status);
        publish({ open: null, nativeMailSelection: null });
      }
    } finally { if (token === generation) { operation = null; if (phase === 'busy') phase = 'ready'; publish(); } }
  }
  async function refreshAccounts(preserveSelection=false) {
    let loadAfter = false;
    await work('Checking Gmail connection…', async ({ client }, signal, valid) => {
      const result = await client.gmailAccounts(signal);
      if (!valid()) return;
      const previous=selected;accounts = result; accountsChecked = true;
      if (!accounts.some(a => a.connectionId === selected && a.connected && a.grantedCapabilities.includes('google.gmail.triage'))) selected = accounts.find(a => a.connected && a.grantedCapabilities.includes('google.gmail.triage'))?.connectionId || '';
      if(previous!==selected){inboxPreview=null;hasUnread=false;}
      const retained=preserveSelection&&!!selected&&selected===previous;
      if(!retained){void attachmentNative.cancel().catch(()=>{});attachmentView=null;contextReview=null;thread=null;messages=[];body=null;}
      void provider.bind(selected); void drafts.bind(selected, accounts.find(a => a.connectionId === selected)?.label || '');
      if(!retained){status = selected ? 'Loading Gmail…' : 'Connect Gmail to read your inbox';nextPageToken=null;loadedQuery='';providerDrafts=[];if(!selected){hasUnread=false;setAttention({state:'not-connected',unread:0,unreadMore:false,source:null,updatedAt:null});}}
      loadAfter = !!selected && !retained;
      publish(retained?{}:{ open: null, nativeMailSelection: null });
    }, () => void refreshAccounts(preserveSelection));
    // Opening Inbox or connecting an account shows its messages without another tap.
    if (loadAfter && api?.isActive()) await load();
  }
  function selectAccount(a: GmailAccount, force = false) {
    if (operation && !force) return;
    if (operation) { generation++; operation.abort(); operation = null; phase = 'ready'; }
    void attachmentNative.cancel().catch(()=>{});contextReview=null;attachmentView=null;inboxPreview=null;homeFailure=null;hasUnread=false;selected = gmailReadable(a) ? a.connectionId! : ''; void provider.bind(selected); void drafts.bind(selected, a.label); messages = []; body = null; thread = null; nextPageToken = null; loadedQuery = ''; failure = null;
    status = selected ? 'Loading Gmail…' : 'This account needs Gmail authorization';
    publish({ open: null, nativeMailSelection: null });
    if (selected) void load();
  }
  /** Continues an open new email under the next connected account. Nothing is sent or saved remotely. */
  async function switchFrom() {
    const eligible = readable(); if (operation || disconnecting || eligible.length < 2) return;
    const index = eligible.findIndex(a => a.connectionId === selected), previous = eligible[index], next = eligible[(index + 1) % eligible.length];
    if (!previous || next.connectionId === previous.connectionId) return;
    const content = await drafts.transfer(); if (!content) return;
    const { savedRemains, restore, ...moved } = content;
    // The account changed while the draft was being moved: keep it with the account it came from.
    if (selected !== previous.connectionId || disconnecting) { restore(); resumeDraftFor = previous.connectionId!; selectAccount(previous, true); return; }
    // A read that started meanwhile must not keep the composer on the previous account.
    selectAccount(next, true);
    returnPending();
    pendingCompose = { ...moved, moved: true, account: next.connectionId!, returnTo: previous, restore,
      status: `From changed to ${next.label}. Review before sending; nothing has been sent.${savedRemains ? ` A saved local copy remains with ${previous.label}.` : ''}` };
    publish();
  }
  async function disconnect() {
    const account = accounts.find(a => a.connectionId === selected);
    if (operation || !account?.connectionId) return;
    if (!window.confirm(`Disconnect ${account.label} from Alpha Phone?\n\nEliza Cloud deletes its stored Gmail access for this account and this phone stops reading it. No mail is deleted. Local drafts stay on this phone until you discard them.`)) return;
    const id = account.connectionId, label = account.label;
    disconnecting = true;
    await work(`Disconnecting ${label}…`, async ({ client }, signal, valid) => {
      const result = await disconnectGmailAccount(client, id, signal);
      if (!valid()) return;
      if (result.accounts) accounts = result.accounts;
      if (result.outcome === 'disconnected') {
        void attachmentNative.cancel().catch(()=>{}); contextReview = null; attachmentView = null;
        messages = []; body = null; thread = null; nextPageToken = null; loadedQuery = ''; hasUnread = false; providerDrafts = [];inboxPreview=null;
        selected = readable()[0]?.connectionId || '';
        setAttention(selected ? { state: 'stale', unread: 0, unreadMore: false, source: accountLabel(), updatedAt: null } : { state: 'not-connected', unread: 0, unreadMore: false, source: null, updatedAt: null });
        void provider.bind(selected); void drafts.bind(selected, accounts.find(a => a.connectionId === selected)?.label || '');
      }
      status = disconnectMessage(result.outcome, label);
      api?.toast(status);
      window.dispatchEvent(new CustomEvent(GMAIL_ACCOUNTS_CHANGED, { detail: { source: 'inbox' } }));
      publish({ open: null, nativeMailSelection: null });
    }, () => void refreshAccounts());
    disconnecting = false; publish();
  }
  async function connect(permission:'read'|'send'|'drafts'|'mailbox'='read') {
    await work('Complete Gmail authorization in your browser', async ({ client }, signal, valid) => {
      const url = await client.initiateGmail(signal,permission);
      if (!valid()) return;
      await openConnectionBrowser(url, signal);
      if (valid()) status = 'After authorizing Gmail, tap Check connection.';
    });
  }
  const draftsView = () => folder === 'drafts' && !String(api?.get('inbox')?.q || '').trim();
  /** Provider drafts list: metadata only until one is opened for editing. */
  async function loadDrafts(more = false) {
    const accountId = selected, pageToken = more && loadedQuery === 'in:drafts' ? nextPageToken : null;
    if (more && !pageToken) return;
    if (operation) return;
    if (!provider.capabilities()?.draftsList) { messages = []; providerDrafts = []; nextPageToken = null; loadedQuery = 'in:drafts'; phase = 'ready'; status = 'This server cannot list Gmail drafts yet. Local drafts stay on this device.'; publish({ open: null, nativeMailSelection: null }); return; }
    if (pageToken) nextPageToken = null;
    await work(more ? 'Loading more drafts…' : 'Loading Gmail drafts…', async ({ client }, signal, valid) => {
      const result = await client.gmailDrafts(accountId, signal, pageToken || undefined);
      if (!valid() || selected !== accountId || !draftsView()) return;
      const seen = new Set(pageToken ? providerDrafts.map(d => d.draftId) : []);
      providerDrafts = pageToken ? [...providerDrafts, ...result.drafts.filter(d => !seen.has(d.draftId))] : result.drafts;
      messages = []; body = null; loadedQuery = 'in:drafts';
      const next = result.nextPageToken; nextPageToken = next && !seenCursors.has(next) ? next : null; if (nextPageToken) seenCursors.add(nextPageToken);
      status = providerDrafts.length ? `${providerDrafts.length} Gmail drafts` : 'No Gmail drafts';
      publish({ open: null, nativeMailSelection: null });
    }, () => void loadDrafts(), more);
  }
  /** Opens one provider draft in the composer as an editable Gmail draft. Replies and drafts with
   * attachments stay in Gmail: their thread headers or bytes cannot be reproduced exactly here. */
  async function openDraft(summary: GmailDraftSummary) {
    if (api?.swallowed?.()) return;
    const accountId = selected, holder: { content: GmailDraftContent | null } = { content: null };
    await work('Opening Gmail draft…', async ({ client }, signal, valid) => {
      const value = await client.gmailDraftContent(accountId, summary.draftId, signal);
      if (!valid() || accountId !== selected) return;
      holder.content = value; status = providerDrafts.length ? `${providerDrafts.length} Gmail drafts` : status;
    }, () => void openDraft(summary), true);
    const draft = holder.content;
    if (!draft || accountId !== selected) return;
    if (draft.threaded || draft.attachmentCount > 0 || !draft.plainText) { api?.toast('This Gmail draft is a reply, has attachments or formatting. Open it in Gmail to edit it; nothing was changed.'); return; }
    const opened = await drafts.editProvider({ mode: 'compose', to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, bodyText: draft.bodyText, attachments: [] }, { draftId: draft.draftId, providerDigest: draft.providerDigest });
    if (!opened && !drafts.render().composing) api?.toast('Save or discard the open email first. The Gmail draft was not opened.');
  }
  async function load(more = false) {
    if (!selected) { await refreshAccounts(); return; }
    if (draftsView()) { await loadDrafts(more); return; }
    const accountId = selected, query = currentQuery();
    const pageToken = more && query === loadedQuery ? nextPageToken : null;
    if (more && !pageToken) return;
    if (operation) return;
    // A cursor is used once. If its page fails (for example an expired cursor), Load more is not
    // offered again with it; Retry reloads the list from the first page instead.
    if (pageToken) nextPageToken = null;
    await work(more ? 'Loading more messages…' : 'Loading Gmail…', async ({ client }, signal, valid) => {
      const result = await client.gmailSearch(accountId, query, signal, 25, pageToken || undefined);
      if (!valid() || selected !== accountId || currentQuery() !== query) return;
      const seen = new Set(pageToken ? messages.map(m => m.id) : []);
      // A later page that repeats a loaded message was cut from a mailbox that changed after the
      // earlier pages were read (new mail moved every row down). The repeat is dropped as before,
      // and the list says that it is no longer the whole mailbox.
      const shifted = !!pageToken && result.messages.some(m => seen.has(m.id));
      // A message the provider lists twice, in one page or across pages, is shown once.
      const fresh = result.messages.filter(m => !seen.has(m.id) && !!seen.add(m.id));
      messages = pageToken ? [...messages, ...fresh] : fresh;
      if (!pageToken) seenCursors = new Set();
      // A provider cursor that repeats would page forever; treat it as the end of the results.
      const next = result.nextPageToken ?? null;
      nextPageToken = next && !seenCursors.has(next) ? next : null;
      if (nextPageToken) seenCursors.add(nextPageToken);
      loadedQuery = query; revision = result.syncedAt;
      recountUnread(result.nextPageToken!=null,!pageToken);
      if (!pageToken) body = null;
      providerDrafts = [];
      status = messages.length ? `${messages.length} messages loaded` : query === 'in:inbox' ? 'Your Inbox is empty' : query === 'in:sent' ? 'No sent messages' : query === 'in:archive' ? 'No archived messages' : query === 'in:trash' ? 'Trash is empty' : 'No messages match this search';
      newerMail = pageToken ? newerMail || shifted : false;
      if (shifted) api?.toast(MAILBOX_CHANGED);
      publish(pageToken ? {} : { open: null, nativeMailSelection: null });
    }, () => void load(), more, more ? ' The messages already shown were kept. Retry reloads the list from the start.' : '');
  }
  function setFolder(next: Folder) {
    if (folder === next && !api?.get('inbox')?.q && (messages.length || providerDrafts.length)) return;
    generation++; operation?.abort(); operation = null;
    folder = next; thread = null; messages = []; providerDrafts = []; body = null; loadedQuery = ''; nextPageToken = null; failure = null; phase = 'ready';
    publish({ q: null, open: null, nativeMailSelection: null });
    void load();
  }
  /** Marks a loaded message read or unread through the reviewed provider operation, once. */
  async function setRead(message: GmailMessage, historyId: string, unread: boolean, explicit: boolean) {
    const binding = connectionController.getCloudClient(), accountId = selected;
    if (!binding || !accountId || !provider.capabilities()?.readState) { if (explicit) api?.toast('This account cannot change read state here. Nothing was changed.'); return; }
    const current = () => accountId === selected && binding.sessionId === connectionController.getCloudClient()?.sessionId;
    const key = JSON.stringify([accountId, message.id]);
    if (readStateInFlight.has(key)) { if (explicit) api?.toast('A read-state change for this message is still in progress.'); return; }
    if (!explicit && readStateUnconfirmed.has(key)) return;
    readStateInFlight.add(key);
    try {
      const result = await setGmailReadState(binding.client, accountId, { messageId: message.id, expectedHistoryId: historyId, unread }, new AbortController().signal);
      if (!result) readStateUnconfirmed.add(key); else readStateUnconfirmed.delete(key);
      if (!current()) return;
      if (!result) { if (explicit) api?.toast('Read state was not confirmed. Refresh to check it before trying again.'); return; }
      const update = (m: GmailMessage) => m.id === message.id ? { ...m, unread } : m;
      if(inboxPreview?.sessionId===binding.sessionId&&inboxPreview.accountId===accountId)inboxPreview.messages=inboxPreview.messages.map(m=>m.id===message.id?{...m,unread}:m);
      messages = messages.map(update); recountUnread();
      if (thread) thread = { ...thread, messages: thread.messages.map(row => row.message.id === message.id ? { ...row, message: update(row.message), historyId: result.historyId ?? row.historyId } : row) };
      if (body?.message.id === message.id) body = { ...body, message: update(body.message), historyId: result.historyId ?? body.historyId };
      if (explicit) api?.toast(unread ? 'Marked unread in Gmail' : 'Marked read in Gmail');
      publish();
    } catch (error) {
      // Any failure may have reached Gmail; an automatic mark-read is not sent again for this message.
      readStateUnconfirmed.add(key);
      if (explicit && current()) api?.toast(classifyGmailFailure(error, 'operation').message);
    } finally { readStateInFlight.delete(key); }
  }
  /** Swipe left routes to the same reviewed archive flow as the message view. */
  async function swipeArchive(message: GmailMessage) {
    const caps = provider.capabilities();
    if (!caps?.mailboxMutations) { api?.toast('Authorize mailbox changes to archive. Nothing was changed.'); return; }
    if (!caps.threads) { api?.toast('Open the message to archive it. Nothing was changed.'); return; }
    const accountId = selected; let historyId: string | null = null;
    await work('Preparing archive review…', async ({ client }, signal, valid) => {
      const page = await client.gmailThread(accountId, message.threadId, signal);
      if (!valid() || accountId !== selected) return;
      historyId = page.messages.find(row => row.message.id === message.id)?.historyId ?? null;
      status = messages.length ? `${messages.length} messages loaded` : status;
    }, () => void swipeArchive(message), true);
    if (accountId !== selected) return;
    if (!historyId) { api?.toast('Open the message to archive it. Nothing was changed.'); return; }
    void provider.prepare({ kind: 'archive', messageId: message.id, expectedHistoryId: historyId });
  }
  async function open(message: GmailMessage) {
    if (api?.swallowed?.()) return; // the click that ends a row swipe
    const accountId = selected;
    thread=null; await work('Loading message…', async ({ client }, signal, valid) => {
      const result = await client.gmailRead(accountId, message.id, signal);
      if (!valid() || accountId !== selected) return;
      body = result;
      if(provider.capabilities()?.threads){const page=await client.gmailThread(accountId,message.threadId,signal);if(!valid()||accountId!==selected)return;thread={id:message.threadId,previousOffsets:[],...page};const exact=page.messages.find(row=>row.message.id===message.id);if(exact)body=exact;}
      publish({ open: message.id, openLocal: true,
        nativeMailSelection: { kind: 'email', id: message.id, accountId, revision } });
    }, () => void open(message), true);
    // Opening an unread message marks it read in Gmail when the account allows reviewed read-state changes.
    const opened = body as typeof body;
    if (opened && opened.message.id === message.id && message.unread && opened.historyId && provider.capabilities()?.readState) void setRead(opened.message, opened.historyId, false, false);
  }
  function mailContext():MailContextSource {if(!body||!selected||!body.historyId)throw new Error('Refresh this message before sharing');return {accountId:selected,messageId:body.message.id,revision:body.historyId,from:body.message.from,to:body.message.to,subject:body.message.subject,bodyText:body.bodyText};}
  async function askAgent(){try{const destination=connectionController.getSnapshot().session;if(!destination)throw new Error('Connect an agent first');const source=mailContext(),token=generation;const review=await reviewMailContext(source,destination);if(token!==generation||JSON.stringify(source)!==JSON.stringify(mailContext()))throw new Error('Message changed');contextReview=review;publish();}catch(error){api?.toast((error as Error).message);}}
  async function sendContext(){if(!contextReview||contextBusy)return;contextBusy=true;publish();try{const review=contextReview,destination=connectionController.getSnapshot().session;if(!destination)throw new Error('Agent disconnected');const text=await validateMailContext(review,mailContext(),destination);if(contextReview!==review)throw new Error('Review closed');contextReview=null;publish();if(!api)throw new Error("Inbox closed");await api.sendReviewedMail(text,destination);}catch(error){api?.toast((error as Error).message);}finally{contextBusy=false;publish();}}
  async function openAttachment(source:NonNullable<typeof body>,attachment:NonNullable<NonNullable<typeof body>['attachments']>[number]){
    if(!source.historyId){api?.toast('Refresh this message before opening its attachments.');return;}
    if(!attachment.supported){await saveOpaque(source,attachment);return;}const accountId=selected;
    await work('Loading selected attachment…',async({client},signal,valid)=>{const file=await client.gmailAttachment(accountId,source.message.id,attachment.partId,source.historyId!,signal);if(!valid()||accountId!==selected||body!==source)return;const reviewGeneration=generation;const review={name:file.name,text:file.text??`${file.mimeType} · ${file.size} bytes. Open a temporary read-only copy in an installed viewer. The viewer receives this file.`,hash:file.sha256,external:file.text===undefined,open:()=>{if(accountId!==selected||body!==source)return;void attachmentNative.openReviewed({...file,reviewed:true}).then(result=>api?.toast(result.message)).catch(error=>api?.toast(error.message));},saveDisabled:false,saveStatus:'',save:()=>{
      if(review.saveDisabled||attachmentView!==review||accountId!==selected||body!==source||generation!==reviewGeneration)return;
      review.saveDisabled=true;review.saveStatus='Saving reviewed attachment…';publish();
      void attachmentNative.saveReviewed({...file,reviewed:true}).then(result=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus=result.message;review.saveDisabled=result.status!=='cancelled';publish();}).catch(()=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus='Save not confirmed. Inspect Files before trying again.';publish();});
    }};attachmentView=review;publish();},()=>void openAttachment(source,attachment),true);
  }
  /** Unsupported types (for example .docx or .zip) can only be saved as an exact byte copy: no preview,
   * no viewer handoff and no agent access. Requires the server's opaque download. */
  async function saveOpaque(source:NonNullable<typeof body>,attachment:NonNullable<NonNullable<typeof body>['attachments']>[number]){
    if(!provider.capabilities()?.opaqueAttachments||attachment.size>5*1024*1024){api?.toast('This attachment type cannot be previewed here, and this account cannot save it to Files. Open it in Gmail.');return;}
    const accountId=selected;
    await work('Loading attachment bytes…',async({client},signal,valid)=>{const file=await client.gmailOpaqueAttachment(accountId,source.message.id,attachment.partId,source.historyId!,signal);const checked=await reviewOpaqueAttachment(file);if(checked.sha256!==file.sha256||checked.size!==file.size)throw new Error('Attachment changed');if(!valid()||accountId!==selected||body!==source)return;const reviewGeneration=generation;
      const review={name:file.name,text:`${file.mimeType} · ${file.size} bytes. This type is not previewed or opened by Alpha. Save to Files stores an exact copy of the bytes; nothing is shared with the agent.`,hash:file.sha256,external:false,open:()=>{},saveDisabled:false,saveStatus:'',save:()=>{
        if(review.saveDisabled||attachmentView!==review||accountId!==selected||body!==source||generation!==reviewGeneration)return;
        review.saveDisabled=true;review.saveStatus='Saving exact copy…';publish();
        void attachmentNative.saveReviewed({...file,reviewed:true,opaque:true}).then(result=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus=result.message;review.saveDisabled=result.status!=='cancelled';publish();}).catch(()=>{if(attachmentView!==review||generation!==reviewGeneration)return;review.saveStatus='Save not confirmed. Inspect Files before trying again.';publish();});
      }};attachmentView=review;publish();},()=>void saveOpaque(source,attachment),true);
  }
  async function nextThreadPage(previous=false){
    const prior=thread,accountId=selected;if(!prior||(!previous&&prior.nextOffset===null))return;
    await work('Loading next thread page…',async({client},signal,valid)=>{
      const page=await client.gmailThread(accountId,prior.id,signal,{offset:previous?(prior.previousOffsets.at(-1)??0):prior.nextOffset!,historyId:prior.historyId});
      if(!valid()||accountId!==selected||thread!==prior)return;
      thread={id:prior.id,previousOffsets:previous?prior.previousOffsets.slice(0,-1):[...prior.previousOffsets,prior.offset],...page};body=page.messages[0]||null;publish({open:body?.message.id||null,nativeMailSelection:null});
    },()=>void nextThreadPage(previous),true);
  }
  function changeQuery(query: string | null) {
    generation++; operation?.abort(); operation = null;
    thread=null; messages = []; body = null; loadedQuery = ''; nextPageToken = null; failure = null;
    phase = 'ready'; status = query === null ? (selected ? 'Loading Gmail…' : 'Connect Gmail to read your inbox') : 'Tap Search Gmail to load results';
    publish({ q: query, open: null, nativeMailSelection: null });
    if (query === null && selected) queueMicrotask(() => { if (api?.isActive() && api.get('inbox')?.q == null) void load(); });
  }
  const unsupported = () => api?.toast('Gmail is read-only here. No message has been changed or sent.');
  /** Links open only in Alpha's Browser, only for HTTPS, and only after the user reviews the destination. */
  function openLink(link: GmailLink) {
    let url: URL; try { url = new URL(link.href); } catch { api?.toast('This link is not valid. Nothing was opened.'); return; }
    if (url.protocol !== 'https:' || url.username || url.password) { api?.toast('Only HTTPS links open in Browser. Nothing was opened.'); return; }
    const warning = linkTextMismatch(link) ? `\n\nWarning: the email shows “${link.text}”, but the link goes to ${url.hostname}.` : '';
    if (!window.confirm(`Open this link in Browser?\n\nSite: ${url.hostname}\n${url.href}${warning}\n\nThe email's sender chose this link. Opening it loads that site.`)) return;
    const navigate = (shell as Bag | undefined)?.browserNavigateApproved;
    if (typeof navigate !== 'function') { api?.toast('Browser is unavailable. Nothing was opened.'); return; }
    void Promise.resolve(navigate.call(shell, url.href, new AbortController().signal)).catch(() => api?.toast('Browser could not open this link.'));
  }
  view.back = (st: Bag, current: Bag) => {
    if(contextReview){contextReview=null;publish();return true;}
    if(attachmentView){void attachmentNative.cancel().catch(()=>{});attachmentView=null;publish();return true;}
    if (provider.close()) return true;
    if (drafts.close()) return true;
    if (st.open != null) { body = null; current.set({ open: null, nativeMailSelection: null }); return true; }
    if (st.q != null) { changeQuery(null); return true; }
    return false;
  };
  view.badge = () => hasUnread;
  // Home uses only already-authorized cached metadata; opening Home never reads mail.
  const homeRender = p.renderVals;
  p.renderVals = function () {
    const out = homeRender.call(this), binding=connectionController.getCloudClient(),connected = readable().length > 0;
    const cached=inboxPreview?.sessionId===binding?.sessionId&&inboxPreview?.accountId===selected?inboxPreview:null;
    const unread=cached?.messages.filter(m=>m.unread)||[],pending=phase==='busy'||phase==='scheduled';
    const count=unread.length?`${unread.length}${cached?.more?'+':''} unread`:'';
    // Account and read time of the page the user loaded in Inbox; Home never reads mail to refresh it.
    const homeInboxStatus=presentHomeInboxStatus({failure:!!homeFailure,pending,cached:cached?{more:cached.more,label:accounts.find(a=>a.connectionId===selected)?.label||'',readAt:cached.readAt}:null,connected,unchecked:!!binding&&!accountsChecked,now:Date.now()});
    return {...out,homeAttentionLabel:count?`Open Inbox: ${count} email${unread.length===1?'':'s'}`:!binding||accountsChecked&&!connected?'Connect email':'Open Inbox',
      homeInboxCount:count,homeInboxRows:unread.slice(0,2).map(m=>({subject:m.subject||'(no subject)',from:m.from})),homeInboxHasRows:unread.length>0,
      homeInboxTitle:unread.length?'':homeFailure==='revoked'?'Reconnect email':homeFailure?'Email unavailable':pending?'Loading email…':cached&&!cached.more?'No unread email':!binding||accountsChecked&&!connected?'Connect email':'Inbox',
      homeInboxStatus,homeInboxDescription:homeInboxStatus};
  };
  // Mail content is never sent to the agent automatically, so chips ask only for help the agent can give.
  // Sharing one message goes through the explicit "Review email with agent" review.
  view.suggestions = (st: Bag) => drafts.render().composing ? ['Help me write this email'] : st.open != null ? ['Help me write a reply'] : ['Help me write an email'];
  const openReply = () => { const st = api?.get('inbox'), current = body; return current && st?.open != null && current.message.id === st.open ? current : undefined; };
  /** The exact destination a suggestion would use now: the selected account, and the open draft, the
   * open message (a reply) or a new email. The assistant review shows it and passes its token back. */
  view.emailTarget = (): EmailTarget => {
    const binding = connectionController.getCloudClient();
    if (!binding || !selected) return { ready: false, reason: 'Connect a Gmail account in Inbox first. Nothing was added.', token: '' };
    // A mail operation, attachment or sharing review already on screen is finished or closed first.
    if (contextReview || attachmentView || provider.render().providerReview) return { ready: false, reason: 'Finish or close the review that is open in Inbox first. Nothing was added.', token: '', accountId: selected, account: accountLabel() || undefined };
    const current = openReply(), target = drafts.suggestionTarget(current?.message);
    return { ...target, accountId: selected, account: accountLabel() || 'Selected Gmail account',
      token: JSON.stringify([binding.sessionId, selected, accountLabel(), target.token, current ? [current.message.id, current.historyId ?? null] : null]) };
  };
  /** "Use in email" for an agent reply while Inbox is open: a local draft bound to the selected account,
   * replying to the open message when there is one. It opens the normal composer; nothing is sent. */
  view.useInEmail = (text: string, expected?: { token: string; append?: boolean }): boolean => {
    if (!selected) { api?.toast('Connect a Gmail account first. Nothing was added.'); return false; }
    const reply = openReply()?.message;
    if (!expected) return drafts.useSuggestion(text, reply);
    // The reviewed destination must be unchanged: same Cloud session, account, draft content and message.
    const now = view.emailTarget() as EmailTarget;
    if (!now.ready || now.token !== expected.token) return false;
    return drafts.useSuggestion(text, reply, { token: drafts.suggestionTarget(reply).token, append: expected.append === true && now.append });
  };
  /** Files uses an account-bound destination without implicitly replying to a hidden message. */
  view.fileEmailTarget = (): EmailTarget => {
    const binding=connectionController.getCloudClient(),available=view.emailTarget() as EmailTarget;
    if(!binding||!available.ready)return available;
    const target=drafts.suggestionTarget();
    return {...target,accountId:selected,account:accountLabel()||'Selected Gmail account',token:JSON.stringify([binding.sessionId,selected,target.token])};
  };
  view.attachReviewedFile = (file: import('../runtime/inbox-attachment').MailAttachment,token:string):boolean => {
    const target=view.fileEmailTarget() as EmailTarget;
    if(!target.ready||target.token!==token)return false;
    return drafts.attachReviewed(file,drafts.suggestionTarget().token);
  };
  view.voicePhrase = 'Help me write an email';
  /** Content shared from Notes, Photos or Files becomes a new local draft for review; nothing is sent. */
  function shared(value: Bag): ComposePrefill {
    const list = (v: unknown) => Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : typeof v === 'string' ? [v] : [];
    const attached = Array.isArray(value.attach) && value.attach.length > 0;
    return { to: list(value.to), subject: typeof value.subject === 'string' ? value.subject : '', body: typeof value.body === 'string' ? value.body : '',
      status: attached ? 'Shared draft. The shared items are not attached automatically; use Attach to choose a file. Review before sending; nothing has been sent.' : 'Shared draft. Review before sending; nothing has been sent.' };
  }
  view.onLeave = () => {
    // Home retains only metadata already loaded by the user.
    if (attention.state === 'ready' || attention.state === 'loading') setAttention({ state: 'stale' });
    returnPending(); resumeDraftFor = ''; if (connectionController.getCloudClient()) { phase = 'idle'; loadedQuery = ''; nextPageToken = null; failure = null; } void attachmentNative.cancel().catch(()=>{}); contextReview=null;attachmentView=null;generation++; operation?.abort(); operation = null; drafts.close(); messages = []; body = null; publish({ open: null, nativeMailSelection: null }); };
  view.render = (st: Bag, current: Bag) => {
    api = current;
    const binding = connectionController.getCloudClient();
    if (phase === 'idle' && binding && current.isActive()) {
      phase = 'scheduled'; queueMicrotask(() => { if (api?.isActive()) void refreshAccounts(); });
    }
    const chip = (label: string, action: () => void, on = false) => ({ label, on,
      css: on ? 'background:var(--fg);color:var(--bg)' : 'background:var(--s2);color:var(--fg)', pick: action });
    if (st.compose && typeof st.compose === 'object' && st.compose !== lastCompose) {
      const incoming = lastCompose = st.compose;
      returnPending(); pendingCompose = shared(incoming);
      queueMicrotask(() => { if (api?.get('inbox')?.compose === incoming) publish({ compose: null }); });
    }
    if (pendingCompose && selected && drafts.ready && (!pendingCompose.account || pendingCompose.account === selected)) {
      const prefill = pendingCompose; pendingCompose = null;
      queueMicrotask(() => {
        if (drafts.begin(undefined, undefined, '', prefill) || !prefill.returnTo) return;
        // The other account already holds a draft or retained edits; the moved email goes back.
        const target = accounts.find(a => a.connectionId === prefill.account)?.label || 'The other account';
        prefill.restore?.();
        const back = accounts.find(a => a.connectionId === prefill.returnTo!.connectionId && gmailReadable(a));
        if (back) { resumeDraftFor = back.connectionId!; selectAccount(back, true); }
        api?.toast(`${target} already has a local draft, so this email stays with ${prefill.returnTo!.label}. Nothing has been sent.`);
      });
    }
    if (resumeDraftFor && resumeDraftFor === selected && drafts.ready) { resumeDraftFor = ''; queueMicrotask(() => { if (drafts.hasDraft) drafts.begin(); }); }
    const sentView = loadedQuery === 'in:sent';
    const chips: Bag[] = binding ? [
      ...(failure ? [chip('Retry', failure.retry)] : []),
      ...(failure?.kind === 'revoked' ? [chip('Reconnect Gmail', () => void connect())] : []),
      ...(selected && st.q == null ? [chip('Inbox', () => setFolder('inbox'), folder === 'inbox'), chip('Sent', () => setFolder('sent'), folder === 'sent'),
        ...(provider.capabilities()?.draftsList ? [chip('Drafts', () => setFolder('drafts'), folder === 'drafts')] : []),
        chip('Archive', () => setFolder('archive'), folder === 'archive'),
        ...(provider.capabilities()?.searchTrash ? [chip('Trash', () => setFolder('trash'), folder === 'trash')] : [])] : []),
      ...(selected ? [chip(st.q ? 'Search Gmail' : 'Refresh', () => void load())] : []),
      // Stays after the notice has passed, until the list is loaded again from its first page.
      ...(selected && newerMail && messages.length && loadedQuery === currentQuery() ? [chip('Load newer mail', () => void load())] : []),
      chip('Connect Gmail', () => void connect()),
      chip('Check connection', () => void refreshAccounts()),
      ...(selected&&!provider.capabilities()?.send?[chip('Authorize Gmail sending',()=>void connect('send'))]:[]),
      ...(selected&&!provider.capabilities()?.providerDrafts?[chip('Authorize Gmail drafts',()=>void connect('drafts'))]:[]),
      ...(selected&&!provider.capabilities()?.mailboxMutations?[chip('Authorize mailbox changes',()=>void connect('mailbox'))]:[]),
      ...accounts.filter(a => a.connectionId).map(a => chip(a.label, () => selectAccount(a), a.connectionId === selected)),
      ...(selected ? [chip('Disconnect Gmail', () => void disconnect())] : []),
    ] : [chip('Connect Eliza Cloud', () => connectionController.openCloudAccount())];
    chips.push(...drafts.chips(chip), ...provider.chips(chip));

    if (operation && !disconnecting) chips.push(chip('Cancel', cancelRead));
    // Today's mail shows its time; older mail its date.
    const date = (value: string | null) => { const d = new Date(value || ''); if (!value || Number.isNaN(d.valueOf())) return ''; const now = new Date();
      return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    const activeBody = st.open && body?.message.id === st.open ? body : null;
    const rows = messages.map(m => {
      // The shell's swipe recognizer keeps edge gestures for system navigation; a left swipe on a row
      // routes to the reviewed archive flow, any other swipe falls through to the shell.
      const swipe = current.sw?.((dx: number, dy: number) => { if (dx >= 0 || Math.abs(dx) < Math.abs(dy)) return false; void swipeArchive(m); return true; }) ?? { down: () => {}, up: () => {} };
      const name = sentView ? (m.to.length ? `To: ${m.to.join(', ')}` : 'To: (no recipients)') : m.from; return { name, ini: (sentView ? m.to[0] || '?' : m.from).slice(0, 1).toUpperCase(), subj: m.subject || '(no subject)',
      snip: m.snippet, time: date(m.receivedAt), nameW: m.unread ? '700' : '500', subjCss: 'color:var(--fg)',
      dot: m.unread ? 'var(--acct)' : 'transparent', clip: !!m.hasAttachments, tx: 0,
      down: swipe.down, up: swipe.up,
      label: `${m.unread ? 'Unread, ' : ''}${name}, ${m.subject}${m.hasAttachments ? ', has attachments' : ''}`, open: () => void open(m) }; });
    if (draftsView()) rows.splice(0, rows.length, ...providerDrafts.map(d => { const name = d.to.length ? `Draft to ${d.to.join(', ')}` : 'Draft (no recipients)';
      return { name, ini: 'D', subj: d.subject || '(no subject)', snip: d.snippet, time: date(d.updatedAt), nameW: '500', subjCss: 'color:var(--fg)', dot: 'transparent', clip: false, tx: 0,
        down: () => {}, up: () => {}, label: `Gmail draft, ${name}, ${d.subject || '(no subject)'}`, open: () => void openDraft(d) }; }));
    const linkRows = (source: NonNullable<typeof body>) => { const cached = linkRowCache.get(source); if (cached) return cached; const seen = new Set<string>(), list: GmailLink[] = [];
      for (const link of [...(source.links || []), ...linkifyMailText(source.bodyText)]) if (link.href.startsWith('https://') && !seen.has(link.href) && list.length < 50) { seen.add(link.href); list.push(link); }
      const rows = list.map(link => { const host = new URL(link.href).hostname; return { label: link.text === link.href ? host : `${link.text} (${host})`, href: link.href, host, mismatch: linkTextMismatch(link),
        open: () => openLink(link) }; });
      linkRowCache.set(source, rows); return rows; };
    const activeLinks = activeBody ? linkRows(activeBody) : [];
    return { contextReviewOpen:!!contextReview,contextReview:contextReview?{source:`From: ${contextReview.source.from}\nTo: ${contextReview.source.to.join(', ')}\nSubject: ${contextReview.source.subject}\n\n${contextReview.source.bodyText}`,destination:`${contextReview.destination.origin} · agent ${contextReview.destination.agentId} · owner ${contextReview.destination.ownerId}`,send:()=>void sendContext(),busy:contextBusy,close:()=>{contextReview=null;publish();}}:null,attachmentOpen:!!attachmentView,attachment:attachmentView?{...attachmentView,close:()=>{void attachmentNative.cancel().catch(()=>{});attachmentView=null;publish();}}:null,chips, rows, searching: st.q != null, notSearching: st.q == null, q: st.q || '', hasQ: false,
      openSearch: () => changeQuery(''), closeSearch: () => changeQuery(null), onQ: (e: Bag) => changeQuery(e.target.value),
      compose: () => drafts.begin(), empty: rows.length === 0, emptyIcon: 'M4 6h16v12H4zM4 6l8 6 8-6', emptyText: pendingCompose && !selected ? 'Shared content is ready for a new email. Connect Gmail to continue; nothing has been sent.' : status,
      hasMore: !!nextPageToken && rows.length > 0 && !operation, loadMore: () => void load(true),
      emptyAdd: false, addAcct: () => void connect(), detail: !!activeBody, ...drafts.render(), ...provider.render(),
      d: activeBody ? { hasThread:!!thread,threadRows:thread?thread.messages.map(row=>chip(`${row.message.from}: ${row.message.subject}`,()=>{body=row;publish({open:row.message.id,nativeMailSelection:null});})):[], hasPreviousThread:!!thread&&thread.previousOffsets.length>0,previousThread:()=>void nextThreadPage(true),hasNextThread:thread?.nextOffset!=null, nextThread:()=>void nextThreadPage(), threadStatus:thread?`${thread.total} messages in this thread`:'', subj: activeBody.message.subject || '(no subject)', name: activeBody.message.from,
        ini: activeBody.message.from.slice(0, 1).toUpperCase(), meta: `To ${activeBody.message.to.join(', ')} · ${date(activeBody.message.receivedAt)}`,
        body: activeBody.bodyText || '(Empty message)', noPerson: true, hasPerson: false, hasAtt:!!activeBody.attachments?.length,atts:(activeBody.attachments||[]).map(a=>({name:a.name,size:`${a.size} bytes · ${a.supported?'Review attachment':provider.capabilities()?.opaqueAttachments&&a.size<=5*1024*1024?'No preview · Save to Files':'Unsupported type or size'}`,open:()=>void openAttachment(activeBody,a)})),
        links:activeLinks,hasLinks:activeLinks.length>0,
        canArchive: !!provider.capabilities()?.mailboxMutations&&!!activeBody.historyId,
        canToggleRead: !!provider.capabilities()?.readState&&!!activeBody.historyId, readLabel: activeBody.message.unread ? 'Mark read' : 'Mark unread', toggleRead: () => { if (activeBody.historyId) void setRead(activeBody.message, activeBody.historyId, !activeBody.message.unread, true); }, canAsk:!!body?.historyId&&!!connectionController.getSnapshot().session,ask:()=>void askAgent(),reply: () => drafts.begin(activeBody.message),canReplyAll:true,replyAll:()=>drafts.begin(activeBody.message,'reply-all'), forward: ()=>drafts.begin(activeBody.message,'forward',activeBody.bodyText,undefined,{forward:activeBody.historyId&&activeBody.attachments?.length?{messageId:activeBody.message.id,historyId:activeBody.historyId,parts:activeBody.attachments.filter(a=>a.partId&&a.size<=5*1024*1024).map(a=>({partId:a.partId,name:a.name,mimeType:a.mimeType,size:a.size}))}:null}), del: ()=>{if(!activeBody.historyId){unsupported();return;}void provider.prepare({kind:'trash',messageId:activeBody.message.id,expectedHistoryId:activeBody.historyId});}, archive: ()=>{if(!activeBody.historyId){unsupported();return;}void provider.prepare({kind:'archive',messageId:activeBody.message.id,expectedHistoryId:activeBody.historyId});} } : null };
  };
  const mount = p.componentDidMount, unmount = p.componentWillUnmount;
  p.componentDidMount = function () {
    mount.call(this); shell = this; sessionId = connectionController.getCloudClient()?.sessionId;
    openInboxHandler = () => this.openView?.('inbox', { open: null, q: null });
    this.inboxConnectionUnsubscribe = connectionController.subscribe(() => {
      const next = connectionController.getCloudClient()?.sessionId;
      if (next !== sessionId) { sessionId = next; clear(); }
      const nextAgent = connectionController.getSnapshot().session?.sessionId;
      if (nextAgent !== agentSession) { contextReview=null;agentSession = nextAgent; publish({ nativeMailSelection: null }); }
    });
    this.inboxResume = DailyApps.addListener('appResumed', () => { if (api?.isActive()) { if (!operation) void refreshAccounts(true); } }).catch(() => null);
    // Settings can disconnect an account; re-check instead of showing a revoked mailbox.
    this.inboxAccountsChanged = (event: Event) => {
      if ((event as CustomEvent).detail?.source === 'inbox') return;
      if (api?.isActive() && !operation) { void refreshAccounts(); return; }
      // Drop provider content now; the next open re-checks accounts and rebinds drafts per account.
      generation++; operation?.abort(); operation = null; messages = []; providerDrafts = []; body = null; thread = null; nextPageToken = null; loadedQuery = ''; hasUnread = false; inboxPreview=null;homeFailure=null;accountsChecked=false;failure = null;
      setAttention({ state: 'stale', unread: 0, unreadMore: false, source: null, updatedAt: null });
      phase = 'idle'; status = 'Checking Gmail connection…'; publish({ open: null, nativeMailSelection: null });
    };
    window.addEventListener(GMAIL_ACCOUNTS_CHANGED, this.inboxAccountsChanged);
  };
  p.componentWillUnmount = function () {
    this.inboxConnectionUnsubscribe?.(); void this.inboxResume?.then((handle: Bag) => handle?.remove()); window.removeEventListener(GMAIL_ACCOUNTS_CHANGED, this.inboxAccountsChanged);
    shell = undefined; openInboxHandler = null; clear(); setAttention({ state: 'not-connected', unread: 0, unreadMore: false, source: null, updatedAt: null }); unmount?.call(this);
  };
}
