import {reviewSummaryNote} from './summary-note-review';
import {summarySourceOf as sourceOf,recordingSourceOf,recordingRevision,type SummarySource as Source} from './summary-source';
import {reviewAgentClock} from '../runtime/clock-agent-review';
import {isReminderCreate,validateReminderCreateResult} from '../runtime/reminder-create-contract';
import {publishWorkflowNotice} from '../browser/workflow-notices';
import {speakLocalText} from '../local-speech-playback';
import {browserDevProfile} from '../browser/dev-profile';
import {stampNoteChanges} from '../runtime/note-dates';
import {isClockOperation,assertClockTimeZone,currentClockTimeZone,validateClockResult} from '../runtime/clock-contract';
import { Capacitor } from '@capacitor/core';
import { isMapsOperation } from '../runtime/maps-contract';
import { readMapsSelection } from '../maps/agent-context';
import {isReminderOperation,validateReminderResult} from '../runtime/reminder-contract';
import { SecureNotesStore, readLegacyDailyNotes } from '../runtime/notes-secure-store';
import { secureConnectionStore } from '../runtime/native-connection';
import {NotesCommitUncertain} from '../runtime/notes-store';
import {openBrowserNotes,browserNotesDocument} from '../browser/notes-document';
import {openDomainRecovery} from '../browser/domain-recovery';
import {audioDeletionDocument,withAudioDeletionLock} from '../runtime/note-audio-deletions';
import {isNotesOperation} from '../runtime/notes-contract';
import {isCalendarOperation,validateCalendarResult} from '../runtime/calendar-contract';
import { isMvpView } from "./mvp-features";
import { workflowSha, validateWorkflowResult } from '../runtime/workflow-device-contract';
import { getMapsSelectedObject, clearMapsSelection } from '../maps/agent-context';
import { alphaClient, type AlphaView } from '../runtime/alpha-client';
import { createDevelopmentTransport } from '../runtime/development-transport';
import { DailyApps } from '../daily';
import { isAndroid } from '../native';
import { registerPlugin } from '../platform-plugins';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { connectionController } from '../runtime/connection-ui';

// The reference renderer is a JavaScript state machine. Its presentation API is
// intentionally kept intact; authenticated effects are installed at this seam.
type Shell = any;
export function installAgentAdapter(Component: Shell, views: Shell) {
  const p = Component.prototype;
  const originalMount = p.componentDidMount;
  const originalUpdate = p.componentDidUpdate;
  const originalUnmount = p.componentWillUnmount;
  const originalSet = p.vset;
  const originalApi = p.api;
  const originalVals = p.renderVals;
  const notesRender = views.notes.render;
  // Navigation resets transient view state, but must retain the actual storage receipt.
  views.notes.persist = [...new Set([...(views.notes.persist || []), 'storageStatus'])];

  function context(shell: Shell) {
    const s = shell.S();
    const view = s.view || 'home';
    document.documentElement.dataset.activeView = view;
    const notes = view === 'notes' ? shell.vget('notes') : null;
    const selected = notes?.list?.find((note: Shell) => note.id === notes.open)?.id;
    const selectedRecord=notes?.list?.find((note:Shell)=>note.id===selected);
    const selectedKey=selectedRecord?JSON.stringify(selectedRecord):null;
    if(shell.notesSelectionKey!==selectedKey||(selected&&!shell.notesSelection&&!shell.notesPending&&!shell.notesStorageFailed)){
      shell.notesSelectionKey=selectedKey;shell.notesSelection=null;
      if(selected&&shell.notesStore&&!shell.notesStorageFailed&&!shell.notesPending)void shell.notesStore.target(String(selected)).then((target:Shell)=>{
        if(shell.live&&!shell.notesPending&&!shell.notesStorageFailed&&shell.notesSelectionKey===selectedKey){shell.notesSelection={kind:'note',id:target.noteId,revision:target.revision,accountId:target.sourceId,sourceRevision:target.sourceRevision};context(shell);}
      }).catch(()=>{});
    }

    let providerSelection = view === 'browser' ? shell.browserSelection?.() : undefined;
    if (view === 'workflows') providerSelection = shell.workflowSelection?.();
    if (view === 'maps') providerSelection = getMapsSelectedObject();
    if (view === 'photos') {
      const state = shell.vget('photos');
      if (state.open === state.nativePhotoSelection?.id) providerSelection = state.nativePhotoSelection;
    }
    if (view === 'inbox') {
      const state = shell.vget('inbox');
      if (state.open === state.nativeMailSelection?.id) providerSelection = state.nativeMailSelection;
    }
    if(view==='calendar')providerSelection=shell.calendarSelection?.();
    if (view === 'contacts' || view==='calendar'&&!providerSelection) {
      const state = shell.vget(view);
      const record = (view === 'calendar' ? state.events : state.list)?.find((row: Shell) => row.id === state.open);
      // Only native-backed rows have authority; fixture records never become
      // agent targets. Content stays local; only identity/revision is sent.
      if (record && (view === 'contacts' || record.alphaReminderId)) {
        const id = String(record.alphaCalendarId || record.alphaReminderId || record.id), key = `${view}:${id}`;
        shell.entityRevisions ||= new Map();
        const signature = JSON.stringify(record), previous = shell.entityRevisions.get(key);
        const revision = previous?.signature === signature ? previous.revision : (previous?.revision || 0) + 1;
        shell.entityRevisions.set(key, { signature, revision });
        providerSelection = { kind: view === 'contacts' ? 'contact' : record.alphaCalendarId ? 'calendar-event' : 'reminder', id, revision: String(revision) };
        if(record.alphaReminderId){const target=shell.reminderTargets?.get(id);providerSelection=target?{kind:'reminder',id:target.reminderId,revision:target.revision,accountId:target.sourceId,sourceRevision:target.sourceRevision,occurrenceId:target.occurrenceId,...(target.timingVersion===2?{timingVersion:2}: {})}:undefined;}
      }
    }
    if(view==='calendar'&&shell.clockSelection?.())providerSelection=shell.clockSelection();
    alphaClient.setViewContext({
      timeZone:currentClockTimeZone(),
      view: (view === 'wallet' ? 'passwords' : view) as AlphaView,
      // Suspension invalidates this turn and approvals, but retains the account
      // and conversation. Visibility is not a claim about Android lock state.
      sensitive: view === 'wallet' || s.secure === true || s.screen === 'lock' || s.screen === 'off' || document.hidden || shell.pageSuspended === true || connectionController.getSnapshot().open,
      ...(selected && shell.notesSelection ? { selectedObject: shell.notesSelection } : providerSelection ? { selectedObject: providerSelection } : ['files','photos'].includes(view) && shell.vget(view).open === '__native_selected_document' && shell.selectedContext ? { selectedObject: shell.selectedContext } : {}),
    });
    document.documentElement.dataset.alphaCanGoBack = String(connectionController.getSnapshot().open || !!s.view || s.shade || s.chat === 'sheet' || s.chat === 'full' || s.voice !== 'off');
  }
  p.componentDidMount = function () {
    originalMount.call(this);
    this.live = true;
    this.connectionSession = connectionController.getSnapshot().session?.sessionId;
    this.connectionUnsubscribe = connectionController.subscribe(() => {
      const session = connectionController.getSnapshot().session?.sessionId;
      if (session !== this.connectionSession) {
        this.closeSummaryReview?.();this.reviewedSourceDraft=null;
        clearMapsSelection();
        this.connectionSession = session;
        alphaClient.disconnect();
        if (this.live) this.setState({ msgs: [], draft: '', typing: false });
      }
      const history = connectionController.getSnapshot().history;
      if (history && history.sessionId === session && this.restoredHistory !== history) {
        this.restoredHistory = history;
        alphaClient.disconnect();
        if (this.live) this.setState({ msgs: history.messages.map(message => ({ ...message, card: null })), draft: '', typing: false, chat: 'full' });
      }
      if (this.live) context(this);
    });
    this.notesStorageFailed = true;
    this.notesPending = 0;
    originalSet.call(this,'notes',{list:[],storageStatus:'Opening saved notes…'});
    document.documentElement.dataset.notesStorageState='opening';
    document.documentElement.dataset.notesRecoveryCategory='none';
    document.documentElement.dataset.notesOpenStage='starting';
    this.notesReady = (async()=>{
      const initial=()=>{document.documentElement.dataset.notesOpenStage='legacy-daily-read';return readLegacyDailyNotes(localStorage);};
      this.notesStore=isAndroid?await SecureNotesStore.open(secureConnectionStore,localStorage,initial,stage=>{document.documentElement.dataset.notesOpenStage=stage;}):await openBrowserNotes();
      if(!this.live)return;
      document.documentElement.dataset.notesStorageState='ready';
      this.notesStorageFailed=false;this.notesRaw=this.notesStore.raw;
      originalSet.call(this,'notes',{list:this.notesStore.list,storageStatus:isAndroid?'Note text encrypted on this device':''});context(this);
    })().catch((error)=>{if(this.live){
      // Fixed diagnostic categories only: never expose parser/native error text or saved content.
      const categories:Record<string,string>={
        'Invalid legacy daily Notes':'legacy-daily-schema','Invalid legacy daily Note':'legacy-daily-note-schema',
        'Invalid saved Notes':'notes-list-schema','Invalid saved Note':'note-record-schema','Invalid Notes envelope':'notes-envelope-schema',
        'Invalid encrypted Notes collection. No data changed.':'encrypted-schema',
        'Invalid legacy Notes archive':'legacy-daily-archive-schema',
        'Plaintext Notes changed during migration. Both copies retained for recovery.':'legacy-notes-conflict',
        'Legacy Notes changed during migration. Both copies retained for recovery.':'legacy-daily-conflict',
        'Plaintext Notes cleanup did not complete. Reopen to retry cleanup.':'cleanup-incomplete',
        'Notes migration changed in another view. Reopen Notes.':'migration-conflict',
        'Secure storage read failed':'native-read-failed'
      };
      document.documentElement.dataset.notesStorageState='recovery';
      document.documentElement.dataset.notesRecoveryCategory=error instanceof SyntaxError?'invalid-json':error instanceof NotesCommitUncertain?'migration-unconfirmed':(error instanceof Error&&Object.hasOwn(categories,error.message)?categories[error.message]:'unclassified');
      originalSet.call(this,'notes',{list:[],storageStatus:'Saved notes need recovery. Original data retained.'});this.toast('Saved notes could not be opened. No new edits are allowed.');}});
    this.notesCommittedHandler=()=>{if(this.live&&this.notesStore&&!this.notesStorageFailed&&!this.notesPending){this.notesRaw=this.notesStore.raw;originalSet.call(this,'notes',{list:this.notesStore.list,storageStatus:isAndroid?'Note text encrypted on this device':''});context(this);}};
    window.addEventListener('alpha:notes-committed',this.notesCommittedHandler);
    this.visibilityHandler = () => { if (this.live) context(this); };
    this.pageHideHandler = () => { this.pageSuspended = true; if (this.live) context(this); };
    this.pageShowHandler = () => { this.pageSuspended = false; if (this.live) context(this); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('pagehide', this.pageHideHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
    this.backHandler = (event: Event) => {
      // A modal owns Back while the underlying phone is inert. Window-targeted
      // native events must not navigate the shell before its dialog closes.
      const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1);
      if (dialog) { event.preventDefault(); event.stopImmediatePropagation(); if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close(); return; }
      if (document.querySelector<HTMLElement>('.os')?.inert) return;
      alphaClient.cancel(); this.back();
    };
    window.addEventListener('alpha-back', this.backHandler);
    this.homeHandler = () => { alphaClient.cancel(); this.goHome(); };
    window.addEventListener('launcher-home', this.homeHandler);
    this.selectionHandler = (event: CustomEvent) => { this.selectedContext = event.detail; context(this); };
    window.addEventListener('alpha-selected-context', this.selectionHandler);
    this.assistListener = DailyApps.addListener('assistantInvoked', () => this.setState({ chat: 'full' })).catch(() => null);
    void DailyApps.surfaceInfo().then(r => {
      if (!this.live) return;
      if (Number.isFinite(r.bottomInset)) document.documentElement.style.setProperty('--native-bottom-inset', `${r.bottomInset}px`);
      if (r.assistant) this.setState({ chat: 'full' });
    }).catch(() => {});
    this.connectAgent = async () => {
      if (alphaClient.getState().connection === 'ready') return;
      const connection = connectionController.getSnapshot();
      if (connection.session) {
        alphaClient.attachVerifiedTransport({
          session: connection.session,
          send: ({ text, context, requestId, signal, onText }) => connectionController.send(text, context, requestId, signal, onText),
          // Remote text is not authority to execute device actions. This path
          // accepts chat only until the server supports verified proposals.
          execute: ({ proposal, context, signal }) => connectionController.execute(proposal, context, signal),
        }, connection.kind === 'local' ? { developmentOrigin: connection.session.origin } : {});
        return;
      }
      // An explicit offline choice never falls through to an old development
      // credential that may still be installed on a test device.
      const preference = localStorage.getItem('alpha.connection.selection.v1');
      if (preference) {
        connectionController.open();
        throw new Error('Choose an agent connection to send a message.');
      }
      const transport = await createDevelopmentTransport(async operation => {
        if (operation.type === 'open_view') {
        if (!['home','reminders','notifications'].includes(operation.view) && !isMvpView(operation.view)) return {status:'failed',summary:'This app is deferred from the MVP'};
          const target = operation.view;
          if (target === 'home') this.goHome();
          else if (target === 'notifications') this.setState({ shade: true });
          else if (views[target]) this.openView(target);
          else return { status: 'failed', summary: 'That screen is not available.' };
          return { status: 'succeeded', summary: `Opened ${target}.` };
        }
      if (operation.type === 'create_reminder') {
          if (!this.live || !Number.isSafeInteger(operation.at) || operation.at <= Date.now())
            return { status: 'failed', summary: 'The reminder time has passed or this view closed. Request a new proposal.' };
          const id = crypto.randomUUID();
          try {
            const result = await DailyApps.scheduleReminder({ id, title: operation.title, body: operation.body, at: operation.at });
            if (result.status !== 'scheduled' || result.id !== id) {
              const summary = result.status === 'permission-denied' ? 'Reminder was not scheduled: allow Alpha Phone notifications and its Local reminders channel.'
                : result.status === 'past' ? 'Reminder was not scheduled: the selected time has passed.'
                : 'Reminder scheduling was not confirmed. Check Calendar before trying again.';
              return { status: 'failed', summary };
            }
            // Scheduling success is not notification-delivery evidence. Refresh
            // the real native list only after a confirmed scheduling receipt.
            if (this.live) await this.refreshReminders?.();
            return { status: 'succeeded', summary: `Scheduled one reminder: ${operation.title} at ${new Date(operation.at).toLocaleString()}. Android may delay delivery.` };
          } catch {
            return { status: 'failed', summary: 'Reminder scheduling could not be confirmed. Check Calendar before requesting another; this action was not retried.' };
          }
        }
        if (this.notesStorageFailed) return { status: 'failed', summary: 'Resolve the notes storage error before saving.' };
        const note = { id: crypto.randomUUID(), kind: 'text', title: operation.title, body: operation.body, pinned: false, when: 'Now', createdAt:Date.now(), modifiedAt:Date.now() };
        const current = this.vget('notes').list;
        const list = [note, ...current];
        if (!await this.vset('notes', { list })) return { status: 'failed', summary: 'The note save is unconfirmed. Reopen Notes to inspect before requesting another save.' };
        return { status: 'succeeded', summary: `Saved note: ${note.title}` };
      });
      if (this.live) { alphaClient.attachVerifiedTransport(transport); this.toast('Connected to the development agent'); }
      else transport.close?.();
    };
    connectionController.setDeviceRecovery(async(operation,operationId,bindingHash,signal)=>{
      signal.throwIfAborted();if(!isReminderOperation(operation)&&!isReminderCreate(operation))return {status:'unknown'};
      const result=await DailyApps.reminderOperationReceipt({operation,operationId,bindingHash});signal.throwIfAborted();
      return result.status==='succeeded'?{status:'succeeded',reminderResult:isReminderCreate(operation)?validateReminderCreateResult(operation,result.result,operationId):validateReminderResult(operation,result.result)}:{status:'unknown'};
    });
    connectionController.setDeviceExecutor(async (operation, operationId, expectedContext, signal, bindingHash, workflowRoute, journalIdentity) => {
      signal.throwIfAborted(); context(this);
      if (!this.live || JSON.stringify(alphaClient.getState().context) !== JSON.stringify(expectedContext)) throw new Error('Phone context changed');
      if(isClockOperation(operation)){
        if(Capacitor.getPlatform()!=='android'&&!browserDevProfile)return {status:'failed',summary:'Native Clock handoff is unavailable in browser development. No alarm request was sent.'};
        assertClockTimeZone(operation,expectedContext.timeZone);signal.throwIfAborted();
        if(expectedContext.sensitive||document.hidden)throw Error('Return to Alpha Phone and review again');
        const clockSession=connectionController.getSnapshot().session;const clockEnrollment=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        const {type,...request}=operation;
        const result=browserDevProfile?await DailyApps.clockHandoff({...request,reviewed:true}):null;
        if(!browserDevProfile&&!journalIdentity)throw Error('Exact approved Clock journal unavailable');
        const clockResult=validateClockResult(operation,result?{kind:'clock-handoff',action:result.action,status:result.status}:await reviewAgentClock(operation,operationId,journalIdentity!,signal,()=>{signal.throwIfAborted();context(this);if(!clockSession||connectionController.getSnapshot().session!==clockSession||JSON.stringify(connectionController.getWorkflowDeviceTarget())!==clockEnrollment||!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Clock review context changed');}));
        const status=clockResult.status==='opened'?'succeeded':clockResult.status==='unknown'?'unknown':'failed';
        return {status,clockResult,summary:browserDevProfile&&clockResult.status==='opened'?result!.message:clockResult.status==='opened'?(operation.action==='dismiss'||operation.action==='snooze'?'Clock opened for manual completion. Choose the intended alarm in Clock; no snooze or dismissal was performed by Alpha.':'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.'):clockResult.status==='unknown'?'Clock result is unknown. Check Clock before another request.':clockResult.status==='unavailable'?'No installed Clock app handles this request.':clockResult.status==='denied'?'Android did not allow this Clock request.':'Clock request was not sent. Review its time and the current phone state.'};
      }
      if(isMapsOperation(operation)){
        const mapsResult=readMapsSelection(operation);signal.throwIfAborted();context(this);
        if(JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Maps context changed');
        return {status:'succeeded',summary:'Shared the exact selected Maps snapshot with approval. Navigation was not started.',mapsResult};
      }
      if(isCalendarOperation(operation)){
        const calendar=registerPlugin<{executeAgent(input:{operation:unknown;operationId:string}):Promise<{status:string;result?:unknown}>;cancelAgent(input:{operationId:string}):Promise<unknown>}>('AlphaCalendar');
        const cancel=()=>{void calendar.cancelAgent({operationId}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
        let result:{status:string;result?:unknown};try{signal.throwIfAborted();result=await calendar.executeAgent({operation,operationId});}finally{signal.removeEventListener('abort',cancel);}
        if(result.status==='applied'){
          const calendarResult=validateCalendarResult(operation,result.result);
          // Return the receipt immediately; DeviceActions must journal it before
          // any optional UI/provider refresh. Normal view resume refreshes rows.
          return {status:'succeeded',summary:operation.type==='calendar_read_selected'?'Read the exact selected calendar event with approval.':'Calendar operation applied and read back from the provider.',calendarResult};
        }
        return {status:result.status==='unknown'?'unknown':'failed',summary:result.status==='unknown'?'Calendar outcome is unconfirmed. Inspect action history before another action.':result.status==='cancelled'?'Calendar review cancelled. Nothing was changed.':'Calendar target changed, access was denied, or the operation is unsupported. Nothing was changed.'};
      }
      if(isNotesOperation(operation)){
        try{
          if(this.notesStorageFailed||!this.notesStore)throw Error('Notes storage is unavailable');
          const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='notes')throw Error('Selected Notes context changed');};
          const notesResult=await this.notesStore.execute(operation,operationId,signal,current);
          return {status:'succeeded',summary:operation.type==='notes_read_selected'?'Read the exact selected note with approval.':'Selected Notes change committed.',notesResult};
        }catch(error){
          const uncertain=error instanceof NotesCommitUncertain;
          // Cancellation or stale approval before mutation is not a storage failure.
          if(uncertain||this.notesStore?.needsRecovery){
            this.notesStorageFailed=true;this.notesCommitUncertain=this.notesCommitUncertain||uncertain;
            this.notesSelectionKey=null;this.notesSelection=null;
            if(this.live){originalSet.call(this,'notes',{storageStatus:this.notesCommitUncertain?'Save outcome unknown. Reopen the app to inspect saved notes; do not repeat.':'Notes storage needs recovery. Reopen the app to inspect saved notes before editing.'});context(this);}
          }
          return {status:uncertain?'unknown':'failed',summary:uncertain?'Notes outcome is uncertain. Review history; do not repeat automatically.':(error as Error).message};
        }
      }
      if(operation.type==='read_selected_notes'||operation.type==='read_calendar_range'){
        const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='workflows'||expectedContext.selectedObject?.kind!=='workflow-run')throw new Error('Workflow read context changed');};current();
        if(operation.type==='read_selected_notes'){
          await this.notesStore?.assertCurrent();const raw=this.notesStore?.raw;if(this.notesStorageFailed||this.notesPending||raw!==this.notesRaw)return {status:'failed',summary:'Notes changed or storage is unavailable. Review the selected notes again.'};
          const source=this.vget('notes').list;const snapshot=operation.notes.map(selected=>{const matches=source.filter((n:Shell)=>n.id===selected.id);if(matches.length!==1||typeof matches[0].title!=='string'||typeof matches[0].body!=='string')throw new Error('A selected note is missing');return {id:selected.id,revision:selected.revision,title:matches[0].title,text:matches[0].body};});
          const result=await validateWorkflowResult(operation,{kind:'notes',notes:snapshot});current();await this.notesStore.assertCurrent();current();if(this.notesStore.raw!==raw)throw new Error('Notes changed while preparing the approved read');
          return {status:'succeeded',summary:`Read ${snapshot.length} selected notes. The exact result is retained for this workflow receipt.`,readResult:result};
        }
        const calendar=registerPlugin<{readWorkflowRange(input:{calendarIds:string[];start:string;end:string;maximumEvents:number}):Promise<{status:string;events:Array<{id:string;calendarId:string;title:string;start:string;end:string;allDay:boolean}>}>}>('AlphaCalendar');
        const result=await calendar.readWorkflowRange({calendarIds:operation.calendarIds,start:operation.start,end:operation.end,maximumEvents:operation.maximumEvents});current();
        if(result.status!=='ready')return {status:'failed',summary:'Calendar read permission is unavailable. No calendar content was uploaded.'};
        const events=await Promise.all(result.events.map(async event=>({...event,revision:await workflowSha([event.id,event.calendarId,event.title,event.start,event.end,event.allDay])})));
        const readResult=await validateWorkflowResult(operation,{kind:'calendar',events});current();return {status:'succeeded',summary:`Read ${events.length} events within the selected calendar range.`,readResult};
      }
      if(operation.type==='post_notification'||operation.type==='speak_text'){
        if(connectionController.getWorkflowPresentationProtocol()!==2)return {status:'failed',summary:'This device has not negotiated workflow presentation support.'};
        signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='workflows')throw Error('Workflow review context changed');
        if(operation.type==='post_notification'&&Capacitor.isNativePlatform()){
          const notices=registerPlugin<{postWorkflow(input:{operationId:string;bindingHash:string;title:string;body:string;route:NonNullable<typeof workflowRoute>}):Promise<{status:unknown}>}>('AlphaNotifications');
          if(!bindingHash||!workflowRoute)throw Error('Workflow notification binding is missing');
          const result=await notices.postWorkflow({operationId,bindingHash,title:operation.title,body:operation.body,route:workflowRoute});
          signal.throwIfAborted();
          const status=result.status==='succeeded'?'succeeded':result.status==='failed'?'failed':'unknown';
          return {status,summary:status==='succeeded'?'Posted the reviewed notification on this device.':status==='failed'?'Notification delivery is unavailable on this device.':'Notification outcome is unconfirmed. It will not be repeated automatically.'};
        }
        if(operation.type==='post_notification'){await publishWorkflowNotice(operationId,operation.body,signal,operation.title,bindingHash);return {status:'succeeded',summary:'Posted the reviewed notification in the browser Inbox.'};}
        const speechAbort=new AbortController(),stop=()=>speechAbort.abort();signal.addEventListener('abort',stop,{once:true});window.addEventListener('alpha:stop-workflow-speech',stop);
        try{signal.throwIfAborted();await speakLocalText(operation.text,speechAbort.signal,undefined,true);return {status:'succeeded',summary:'Finished reading the reviewed text aloud.'};}finally{signal.removeEventListener('abort',stop);window.removeEventListener('alpha:stop-workflow-speech',stop);}
      }
      if (operation.type === 'create_note') {
        if (this.notesStorageFailed) return { status: 'failed', summary: 'Notes storage is unavailable. Nothing saved.' };
        const existing = this.vget('notes').list.find((note: Shell) => note.id === operationId);
        if (existing) return { status: 'unknown', summary: 'A note already has this action identifier; review it before resolving.' };
        const note = { id: operationId, kind: 'text', title: operation.title, body: operation.body, pinned: false, when: 'Now', createdAt:Date.now(), modifiedAt:Date.now() };
        const saved = await this.vset('notes', { list: [note, ...this.vget('notes').list] });
        return { status: saved ? 'succeeded' : this.notesCommitUncertain?'unknown':'failed', summary: saved ? `Saved note: ${operation.title}` : 'The note save is unconfirmed. Inspect saved notes before repeating.' };
      }
      if(isReminderCreate(operation)){
        const support=await DailyApps.surfaceInfo();signal.throwIfAborted();
        context(this);if(!this.live||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Phone context changed');
        if(support.reminderCreationVersion!==1)return {status:'failed',summary:'This phone does not support reviewed reminder creation. Nothing was created.'};
        const result=await DailyApps.operateReminder({operationId,bindingHash,operation});
        if(result.status!=='succeeded')return {status:'unknown',summary:'Reminder creation outcome is unknown. Check action history; it will not be repeated.'};
        const reminderResult=validateReminderCreateResult(operation,result.result,operationId);
        return {status:'succeeded',reminderResult,summary:reminderResult.status==='pending'?'Reminder saved with no alert.':reminderResult.status==='scheduled'?'Reminder saved with approximate notification delivery.':reminderResult.status==='permission-denied'?'Reminder saved; notifications are disabled.':'Reminder saved; notification scheduling failed.'};
      }
      if(isReminderOperation(operation)){
        signal.throwIfAborted();context(this);if(JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||document.hidden)throw Error('Reminder context changed');
        const target=await DailyApps.selectedReminder({id:operation.target.reminderId});signal.throwIfAborted();
        if(JSON.stringify(target)!==JSON.stringify(operation.target)) { // property order is normalized below
          for(const key of ['sourceId','sourceRevision','reminderId','occurrenceId','revision','timingVersion'] as const)if(target[key]!==operation.target[key])return {status:'failed',summary:'This reminder changed. Review it again before applying the action.'};
        }
        context(this);if(JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Reminder context changed');
        signal.throwIfAborted();
        const result=await DailyApps.operateReminder({operationId,bindingHash,operation});
        // Publish the new revision only after the receipt attempt; refreshing here
        // cancels this context-bound action before it can acknowledge the server.
        if(result.status!=='succeeded')return {status:'unknown',summary:'Reminder outcome requires review. It was not repeated.'};
        const reminderResult=validateReminderResult(operation,result.result);
        return {status:'succeeded',summary:reminderResult.status==='pending'?'Reminder saved with no alert.':`Reminder ${reminderResult.status}.${Capacitor.isNativePlatform()?' Android delivery is approximate.':''}`,reminderResult};
      }
      if (operation.type === 'create_reminder') {
        const at = Date.parse(operation.dueAt);
        if (!Number.isSafeInteger(at) || at <= Date.now()) return { status: 'failed', summary: 'Reminder time has passed. Nothing scheduled.' };
        const result = await DailyApps.scheduleReminder({ id: operationId, title: operation.title, body: '', at });
        if (result.status !== 'scheduled' || result.id !== operationId) return { status: 'failed', summary: 'Scheduling was not confirmed. Check notification settings and the reminder time.' };
        // Publish the new revision only after the receipt attempt; refreshing here
        // cancels this context-bound action before it can acknowledge the server.
        return { status: 'succeeded', summary: `Scheduled reminder: ${operation.title}.${Capacitor.isNativePlatform()?' Android may delay delivery.':''}` };
      }
      if (operation.type === 'open_view') {
        if (!['home','reminders','notifications'].includes(operation.view) && !isMvpView(operation.view)) return {status:'failed',summary:'This app is deferred from the MVP'};
        // Navigation changes the view epoch; journal completion still runs after
        // this synchronous effect even if the conversation cancels its wait.
        const view = operation.view === 'reminders' ? 'calendar' : operation.view;
        if (view !== 'home' && !views[view]) return { status: 'failed', summary: 'This view is unavailable.' };
        if (view === 'home') this.goHome(); else this.openView(view);
        return { status: 'succeeded', summary: `Opened ${operation.view} on this phone.` };
      }
      if (!this.browserNavigateApproved) return { status: 'failed', summary: 'Approved browser navigation is unavailable. No page opened.' };
      await this.browserNavigateApproved(operation.url, signal);
      return { status: 'succeeded', summary: `Opened an approved HTTPS destination in a new browser tab. Page loading is not verified.` };
    });
    context(this);
  };
  p.componentDidUpdate = function (prev: Shell) { originalUpdate.call(this, prev); context(this); };
  p.componentWillUnmount = function () {
    this.closeSummaryReview?.();
    this.connectionUnsubscribe?.();
    window.removeEventListener('alpha:notes-committed',this.notesCommittedHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('pagehide', this.pageHideHandler);
    window.removeEventListener('pageshow', this.pageShowHandler);
    this.live = false; alphaClient.disconnect(); window.removeEventListener('alpha-back', this.backHandler); window.removeEventListener('launcher-home', this.homeHandler); window.removeEventListener('alpha-selected-context', this.selectionHandler);
    void this.assistListener?.then((l: Shell) => l?.remove()); originalUnmount.call(this);
  };
  p.vset = function (key: string, patch: Shell) {
    if (key !== 'notes' || !patch.list) { originalSet.call(this,key,patch);return true; }
    if (this.notesStorageFailed||!this.notesStore) {this.toast('Notes storage needs recovery before editing.');return false;}
    try {
      if(!isAndroid)patch={...patch,list:stampNoteChanges(this.notesStore.list,patch.list)};
      const pending=this.notesStore.replace(patch.list);
      this.notesPending++;
      this.notesSelectionKey=null;this.notesSelection=null;
      // Text remains visible while the native commit is pending; this is not a saved receipt.
      originalSet.call(this,key,{...patch,storageStatus:'Saving on this device…'});
      context(this);
      return Promise.resolve(pending).then(()=>{
        this.notesPending--;this.notesRaw=this.notesStore.raw;
        if(this.live&&!this.notesPending&&!this.notesStorageFailed){originalSet.call(this,'notes',{storageStatus:isAndroid?'Note text encrypted on this device':''});context(this);}
        return true;
      }).catch((error)=>{
        this.notesPending--;this.notesStorageFailed=true;this.notesCommitUncertain=error instanceof NotesCommitUncertain;
        if(this.live){originalSet.call(this,'notes',{storageStatus:'Save unconfirmed. Keep this screen open to preserve unsaved text.'});this.toast(error instanceof NotesCommitUncertain?'Save outcome unknown. Reopen to inspect saved notes; do not repeat the action.':'Notes could not be saved. Unsaved text remains on this screen.');context(this);}
        return false;
      });
    } catch (error) {
      // Browser storage and revision checks can fail synchronously, before the
      // optimistic state above is installed. Preserve the attempted draft just
      // as we do for a rejected native commit, without retrying the write.
      this.notesStorageFailed=true;
      this.notesCommitUncertain=error instanceof NotesCommitUncertain;
      this.notesSelectionKey=null;this.notesSelection=null;
      originalSet.call(this,key,{...patch,storageStatus:'Save unconfirmed. Keep this screen open to preserve unsaved text.'});
      this.toast(this.notesCommitUncertain?'Save outcome unknown. Unsaved text remains on this screen; do not repeat the action.':'Notes changed or storage is unavailable. Unsaved text remains on this screen.');
      context(this);
      return false;
    }
  };
  p.api = function (key: string) {
    const api = originalApi.call(this, key);
    if(key==='notes'&&!isAndroid){
      api.recoverNotes=()=>{
        if(this.notesPending){this.toast('Wait for the current Notes save before opening recovery.');return;}
        alphaClient.cancel();
        openDomainRecovery({capture:signal=>browserNotesDocument.capture(signal),reset:(expected,signal)=>withAudioDeletionLock(()=>browserNotesDocument.reset(expected,signal))},'notes','Notes recovery','Download saved notes before resetting. Copy or export unsaved text first. Reset clears browser notes after confirmation; recordings and pending audio deletions are retained. Close older Alpha tabs before continuing.');
      };
      api.recoverNoteAudio=()=>openDomainRecovery({capture:signal=>audioDeletionDocument.capture(signal),reset:(expected,signal)=>withAudioDeletionLock(()=>audioDeletionDocument.reset(expected,signal))},'audio deletion records','Audio deletion recovery','Download deletion records before resetting. Reset discards pending deletion tracking; it does not delete or restore any note or recording. Close older Alpha tabs before continuing.');
    }

    if(key==='workflows'&&!isAndroid){
      api.localWorkflowReady=()=>{context(this);return this.live&&!alphaClient.getState().pending&&!alphaClient.getState().context.sensitive&&(alphaClient.getState().connection==='ready'||!!connectionController.getSnapshot().session);};
      api.localWorkflowBusy=()=>alphaClient.getState().pending;
      api.localWorkflowIdle=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
        signal.throwIfAborted();let unsubscribe=()=>{};
        const finish=(error?:Error)=>{unsubscribe();signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
        const cancel=()=>finish(new DOMException('Workflow cancelled','AbortError'));
        const check=()=>{const state=alphaClient.getState();if(state.context.sensitive)finish(Error('Return to the device before generating a workflow result.'));else if(!state.pending)finish();};
        unsubscribe=alphaClient.subscribe(check);signal.addEventListener('abort',cancel,{once:true});check();
      });
      api.localWorkflowText=async(instruction:string,input:string,signal:AbortSignal,automatic=false)=>{
        signal.throwIfAborted();
        if(alphaClient.getState().connection!=='ready'&&!connectionController.getSnapshot().session)return undefined;
        context(this);
        if(!this.live||!automatic&&this.S().view!=='workflows'||alphaClient.getState().context.sensitive)throw Error('Open the workflow to generate its result.');
        const expectedSession=alphaClient.getState().session||connectionController.getSnapshot().session,expectedRevision=alphaClient.getState().context.revision;
        await this.connectAgent();signal.throwIfAborted();context(this);
        if(!this.live||alphaClient.getState().context.sensitive||!automatic&&(this.S().view!=='workflows'||alphaClient.getState().context.revision!==expectedRevision)||JSON.stringify(alphaClient.getState().session)!==JSON.stringify(expectedSession))throw Error('The workflow or agent connection changed. Run the step again.');
        return alphaClient.generateWorkflowText(instruction,input,signal,automatic);
      };

      api.localWorkflowNotes=async(input:{operationId?:string;text?:string},signal:AbortSignal)=>{
        signal.throwIfAborted();
        if(this.notesStorageFailed||this.notesPending||!this.notesStore)throw Error('Reopen Notes before running this step.');
        await this.notesStore.assertCurrent();signal.throwIfAborted();
        if(this.notesPending||this.notesRaw!==this.notesStore.raw)throw Error('Notes changed during this step.');
        const list=this.notesStore.list;
        if(!input.operationId)return list;
        const text=input.text||'';
        if(!text.trim()||text.length>32000)throw Error('Choose note content between 1 and 32000 characters.');
        const existing=list.find((note:Shell)=>note.id===input.operationId);
        if(existing){if(existing.body!==text||existing.workflowStep!==input.operationId)throw Error('Saved note receipt does not match this step.');return existing;}
        const note={id:input.operationId,kind:'text',title:'Workflow note',body:text,pinned:false,when:'Today',createdAt:Date.now(),workflowStep:input.operationId};
        signal.throwIfAborted();
        if(await this.vset('notes',{list:[note,...list]})!==true)throw Error('Note save is unconfirmed. Reopen Notes to inspect it before retrying.');
        return note;
      };
    }
    if(key==='notes'){api.set=(patch:Shell)=>this.vset('notes',patch);api.storageReady=()=>!this.notesStorageFailed&&!this.notesPending; }
    api.say = () => this.toast('Connect the underlying account or select real content before requesting this action.');
    // Open the real conversation without sending a prompt or uploading content.
    // Keep the current view/selection so a subsequent user message is scoped.
    api.sendReviewedMail = async (text:string, expected:{sessionId:string;agentId:string;ownerId:string;origin:string}) => {
      const current=connectionController.getSnapshot().session;
      if(!current||JSON.stringify(current)!==JSON.stringify(expected)||document.hidden||connectionController.getSnapshot().open||document.documentElement.dataset.connectionMode==='mock')throw new Error('Agent changed. Review this message again.');
      if(this.S().typing)throw new Error('Wait for the current agent reply before sharing this email.');
      context(this);await this.send(text,expected);
    };
    api.openReviewedWebSource=(url:string,signal:AbortSignal)=>this.browserNavigateApproved(url,signal);
    api.composeContentQuestion=(draft:string,source?:Source)=>{
      this.reviewedSourceDraft={draft,source:sourceOf(source)};
      context(this);this.setState({chat:'sheet',shade:false,draft});
    };
    api.assist = (notice: string) => {
      context(this);
      this.setState({ chat: 'sheet', shade: false });
      this.agentSay(notice);
    };
    return api;
  };
  p.renderVals = function () {
    const out = originalVals.call(this);
    out.canStopReply=!!this.S().typing&&alphaClient.getState().pending;
    out.stopReply=()=>alphaClient.cancel();
    if (isAndroid) {
      out.showStatus = false; out.showIndicator = false;
      const style = out.sbColor === '#ffffff' || out.sbColor === '#FFFFFF' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
      if (this.barStyle !== style) { this.barStyle = style; void SystemBars.setStyle({ style }).catch(() => {}); }
    }
    out.shadeN = (out.shadeN || []).filter((n: Shell) => n.id !== 'n4');
    out.headsOk = () => this.toast('Connect Messages before replying. Nothing has been sent.');
    out.tiles = (out.tiles || []).map((tile: Shell) => ({ ...tile, toggle: () => void DailyApps.perform({ action: 'settings' }).catch(() => this.toast('Android settings is unavailable.')) }));
    out.onBright = () => void DailyApps.perform({ action: 'settings' }).catch(() => this.toast('Android settings is unavailable.'));
    return out;
  };
  p.send = async function (argument?: string, expectedSession?: {sessionId:string;agentId:string;ownerId:string;origin:string}) {
    const s = this.S(); const text = String(argument ?? s.draft).trim();
    if (!text || s.typing) return;
    const sourceDraft=this.reviewedSourceDraft?.draft.trim()===text?sourceOf(this.reviewedSourceDraft.source):undefined;this.reviewedSourceDraft=null;
    context(this);
    const revision = alphaClient.getState().context.revision;
    const streamedId=crypto.randomUUID();let streamed=false;
    const replaceStream=(value:string,streaming=true)=>this.setState((previous:Shell)=>({msgs:previous.msgs.map((message:Shell)=>message.id===streamedId?{...message,text:value,streaming}:message)}));
    this.setState({ msgs: [...s.msgs, { id: crypto.randomUUID(), from: 'user', text }], draft: '', typing: true, chat: s.chat === 'full' ? 'full' : 'sheet', shade: false });
    try {
      await this.connectAgent(); context(this);
      if (alphaClient.getState().context.revision !== revision) throw new Error('The active screen changed. Please send your request again.');
      if(expectedSession&&(JSON.stringify(connectionController.getSnapshot().session)!==JSON.stringify(expectedSession)||document.hidden))throw new Error('Agent changed. Review this message again.');
      const sourceSession=connectionController.getSnapshot().session;
      const reply = await alphaClient.send(text,value=>{
        if(!this.live)return;
        if(streamed)replaceStream(value);
        else{streamed=true;this.setState((previous:Shell)=>({msgs:[...previous.msgs,{id:streamedId,from:'agent',text:value,card:null,streaming:true}]}));}
      });
      if (!this.live) return;
      if(streamed)replaceStream(reply.text,false);else this.agentSay(reply.text);
      if(sourceDraft&&sourceSession&&JSON.stringify(sourceSession)===JSON.stringify(connectionController.getSnapshot().session))this.agentSay('Review this answer before saving it with its source.',{type:'generic',icon:'note',title:'Review summary note',sub:sourceDraft.name,sourceSummary:{source:sourceDraft,text:reply.text,session:sourceSession}});
      for (const proposal of reply.proposals || []) this.agentSay(proposal.description, { type: 'generic', icon: 'check', title: 'Approve: ' + proposal.title, sub: 'Tap to approve this exact action', proposalId: proposal.id });
    } catch (e) { if (this.live) {const message=e instanceof Error?e.message:'The agent could not complete this request.';if(streamed)this.setState((previous:Shell)=>({msgs:previous.msgs.map((item:Shell)=>item.id===streamedId?{...item,streaming:false,interrupted:true,text:`${item.text}\n\nResponse interrupted. ${message}`} :item)}));else this.agentSay(message);} }
    finally { if (this.live) this.setState({ typing: false }); }
  };
  p.agentSay = function (text: string, card?: Shell) {
    this.setState((previous: Shell) => ({ chat: previous.chat === 'full' ? 'full' : 'sheet', msgs: [...(previous.msgs || []), { id: crypto.randomUUID(), from: 'agent', text, card: card || null }] }));
  };
  p.reply = function () { return { text: 'Connect an agent to continue.' }; };
  p.cardAct = async function (message: Shell) {
    const card = message.card || {};
    if(card.sourceSummary&&!card.done){
      const review=card.sourceSummary,recording=recordingSourceOf(review.source);
      const recordingNote=recording&&this.vget('notes').list.find((n:Shell)=>n.id===recording.noteId);
      const expectedRecording=recordingNote&&JSON.stringify(recordingNote);
      const current=()=>this.live&&!document.hidden&&!connectionController.getSnapshot().open&&JSON.stringify(connectionController.getSnapshot().session)===JSON.stringify(review.session)&&this.S().msgs.some((m:Shell)=>m.id===message.id&&!m.card?.done)&&(!recording||JSON.stringify(this.vget('notes').list.find((n:Shell)=>n.id===recording.noteId))===expectedRecording);
      if(!current()){this.toast('Agent or conversation changed. Ask about the source again.');return;}
      if(recording&&(!recordingNote?.audio||await recordingRevision(recordingNote)!==recording.revision||!current())){this.toast('Recording changed or is unavailable. Ask about its current transcript again.');return;}
      this.closeSummaryReview?.();
      this.closeSummaryReview=reviewSummaryNote({text:review.text,source:review.source,current,save:async(fields)=>{
        if(!current()||this.notesStorageFailed||this.notesPending)return false;
        const update=(title:string,sub:string)=>{if(this.live)this.setState({msgs:this.S().msgs.map((m:Shell)=>m.id===message.id?{...m,card:{...m.card,done:true,title,sub}}:m)});};
        update('Saving summary note','Inspect Notes before retrying if this is interrupted.');
        try{
          const existing=this.vget('notes').list;
          const list=recording?existing.map((n:Shell)=>n.id===recording.noteId?{...n,summary:[fields.body],actions:fields.actions||[],onCal:false,when:'Now',modifiedAt:Date.now()}:n):[{id:crypto.randomUUID(),kind:'text',...fields,pinned:false,when:'Now',createdAt:Date.now(),modifiedAt:Date.now()},...existing];
          const saved=await this.vset('notes',{list})===true;update(saved?(recording?'Recording summary saved':'Summary note saved'):'Check Notes before retrying',saved?(recording?.name||fields.documentSource?.name||fields.webSource?.name||'Source'):'Save is unconfirmed.');return saved;
        }
        catch{update('Check Notes before retrying','Save is unconfirmed.');return false;}
      },complete:()=>{if(this.live)this.toast(recording?'Recording summary saved. No reminders scheduled.':'Summary note saved with its source.');}});
      return;
    }
    if (card.proposalId && !card.done) {
      try {
        const sessionId = connectionController.getSnapshot().session?.sessionId;
        const beforeView = this.S().view;
        let receipt;
        try { receipt = await alphaClient.approve(card.proposalId); }
        catch (error) {
          // Navigation may cancel the context-bound chat wait after the effect.
          // Await only that already-started journaled action; never execute again.
          receipt = await connectionController.actionReceipt(card.proposalId, sessionId);
          if (!receipt) throw error;
        }
        if (!this.live || connectionController.getSnapshot().session?.sessionId !== sessionId) return;
        this.setState({ msgs: this.S().msgs.map((m: Shell) => m.id === message.id ? { ...m, card: { ...m.card, done: true, sub: receipt.summary, title: receipt.status === 'succeeded' ? 'Completed' : 'Not completed' } } : m) });
        if (this.S().view !== beforeView) this.toast(receipt.summary);
        else this.agentSay(receipt.summary);
      } catch (e) { this.agentSay(e instanceof Error ? e.message : 'Action could not complete.'); }
    } else if (card.go) this.openView(card.go.view, card.go.patch);
  };
  p.startVoice = async function () {
    try {
      const result = await DailyApps.perform({ action: 'voice' });
      if (result.status === 'selected' && result.transcript) this.setState({ chat: 'sheet', draft: result.transcript });
      else this.toast(result.message || 'Speech recognition is unavailable on this device.');
    } catch { this.toast('Speech recognition is unavailable on this device.'); }
  };
  p.stopVoice = function () { alphaClient.cancel(); this.setState({ voice: 'off', typing: false }); };
  views.notes.render = function (state: Shell, api: Shell) {
    const out = notesRender({ ...state, record: false }, api);
    out.storageStatus=state.storageStatus;
    out.browserRecovery=!isAndroid;out.recoverNotes=api.recoverNotes;out.recoverNoteAudio=api.recoverNoteAudio;
    const dictate = async () => {
      try {
        const r = await DailyApps.perform({ action: 'voice' });
        if (r.transcript) {
          const latest = api.get('notes');
          if (latest.open !== state.open) return;
          api.set({ list: latest.list.map((n: Shell) => n.id === state.open ? { ...n, body: [n.body, r.transcript].filter(Boolean).join('\n') } : n) });
        } else api.toast(r.message || 'Speech recognition is unavailable.');
      } catch { api.toast('Speech recognition is unavailable.'); }
    };
    out.record = () => window.dispatchEvent(new CustomEvent('alpha-record-note'));
    if (out.ed) out.ed.dictate = dictate;
    if (out.vo) { out.vo.play = () => api.toast('No audio is available for this note.'); out.vo.toCal = () => void DailyApps.perform({ action: 'calendar-create', title: out.vo.title }).catch(() => api.toast('Calendar is unavailable.')); }
    return out;
  };
}
