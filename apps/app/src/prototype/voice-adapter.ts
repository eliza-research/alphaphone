import {developmentCartesiaConversation,developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-conversation';
import {BatchVoiceConversation,type BatchVoiceState} from '@elizaos/ui/voice/batch-conversation';
import {recordingRevision} from './summary-source';
import {noteOriginFor} from '../runtime/note-origin';
import {reviewContentQuestion} from '../browser/content-question';
import {recordingLevels} from '../browser/audio-levels';
import {browserDevProfile} from '../browser/dev-profile';
import {pendingAudioDeletions,withAudioDeletionLock,changeAudioDeletion,audioDeletionNoteState,type AudioDeletion} from '../runtime/note-audio-deletions';
import {addNotesTrashEntry,editNotesTrash,isNotesTrashFull,notesTrashExpired,readNotesTrash,removeNotesTrashEntries,savedNotes,type NotesTrashEntry} from '../runtime/notes-trash';
import type {NotesTarget} from '../runtime/notes-contract';
import {planInterruptedPermanentDeletion,type PermanentDeletionEvidence} from '../runtime/permanent-voice-deletion';
const audioOperation=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
import { installLocalSpeechPlayback, stopLocalSpeechPlayback, currentNoteReading, stopSpeaking, speakNote } from './local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { createOnDeviceVoice, type SpeechProgressEvent } from '../runtime/local-voice';
import { voiceFailure, transcriptProvenance, speechProgressMessage, deniedSettingsChoice, DENIED_SETTINGS_LABEL, type VoiceFailure, type TranscriptProvenance } from '../runtime/voice-states';
import { createPairedVoice } from '../runtime/paired-voice';
import { createCloudVoice, cloudVoiceFailure } from '../runtime/cloud-voice';
import { selectVoiceRoute } from '../runtime/voice-selection';
import { connectionController } from '../runtime/connection-ui';
type Bag = Record<string, any>;
type Clip = { recordingId: string; durationMs: number };
const voice = registerPlugin<{
  startRecording(input?: { maxDurationMs: 29000 | 59000 }): Promise<{ recordingId: string; maxDurationMs: number }>;
  stopRecording(): Promise<Clip>;
  transcribeRecording(options: { recordingId: string; requestId: string }): Promise<{ text: string; local: boolean }>;
  cancelRecording(): Promise<unknown>;
  cancel(options: { requestId: string }): Promise<unknown>;
  addListener(event: 'recordingStopped', callback: (clip: Clip) => void): Promise<PluginListenerHandle>;
}>('DevelopmentAgent');
const deviceVoice = registerPlugin<typeof voice>('AlphaVoiceCloud');
const appSettings = registerPlugin<{ openSettings(input: { page: 'privacy' }): Promise<unknown> }>('AlphaDevice');

type SavedAudio = { audioId: string; noteId: string; durationMs: number; transcript: string };
const cloudRecorder = registerPlugin<{ saveRecording(input: { recordingId: string; noteId: string; transcript: string }): Promise<SavedAudio> }>('AlphaVoiceCloud');
const localRecorder = registerPlugin<{ saveRecording(input: { recordingId: string; noteId: string; transcript: string }): Promise<SavedAudio> }>('DevelopmentAgent');
const noteAudio = registerPlugin<{
  play(input: { audioId: string }): Promise<void>; stop(): Promise<void>;
  state(): Promise<{ playing: boolean; audioId?: string; positionMs: number }>;
  describe(input:{audioId:string}):Promise<SavedAudio & {deletedAt?:number}>;
  remove(input: { audioId: string; noteId: string; operationId:string }): Promise<unknown>;
  deletionStatus(input:{audioId:string;noteId:string;operationId:string}):Promise<{audioId:string;noteId:string;operationId:string;status:string}>;
  restore(input: { audioId: string; noteId: string; operationId:string }): Promise<unknown>;
  purge(input: { audioId: string; noteId: string; operationId:string }): Promise<{audioId:string;noteId:string;operationId:string;status:string}>;
}>('AlphaNoteAudio');

/** The passage Read aloud speaks: title, then body or checklist items. */
function noteSpeechText(note: Bag | undefined): string {
  if (!note) return '';
  const body = note.kind === 'list' ? (note.items || []).map((item: Bag) => String(item?.t || '').trim()).filter(Boolean).join('. ') : String(note.body || '');
  return [String(note.title || '').trim(), body.trim()].filter(Boolean).join('. ').trim();
}
/** One owned recorder, shared by Notes dictation and the chat voice mode. */
export function installPrototypeVoiceAdapter(Component: any, views: Record<string, Bag>) {
  installLocalSpeechPlayback(Component);
  const notes = views.notes, render = notes.render, back = notes.back, leave = notes.onLeave;
  let closeTranscriptQuestion:(()=>void)|undefined;
  const originalApi = Component.prototype.api;
  Component.prototype.api = function (key: string) {
    const value = originalApi.call(this, key);
    // The prototype setView callback discards vset's persistence receipt.
    if (key === 'notes') {
      value.voiceNoteActive=()=>this.live&&this.S().view==='notes';
      value.saveVoiceNote = async (patch: Bag, options?: {exact?: boolean}) => await this.vset('notes', patch, options) === true;
      value.reviewAudioDeletion=async(note:Bag)=>{
        if(!this.live||this.notesStorageFailed||this.notesPending||!this.notesStore)throw Error('Notes needs recovery');
        const target=await this.notesStore.target(note.id);
        if(JSON.stringify(this.notesStore.list.find((n:Bag)=>n.id===note.id))!==JSON.stringify(note))throw Error('Note changed');
        return target;
      };
      // Notes Trash hooks. Voice notes share one Trash with text notes; the recording follows its note.
      value.restoreTrashedVoice=(entry:NotesTrashEntry)=>restoreDeletion(trashRow(entry),value,entry.index);
      value.purgeTrashedVoice=(entry:NotesTrashEntry)=>purgeTrashedRecording(entry);
      value.trashVoiceNoteWithRecording=<T,>(note:Bag,target:NotesTarget,operationId:string,index:number,commit:()=>Promise<T>)=>trashVoiceNoteWithRecording(note,target,operationId,index,commit);
      // Offered only after a full Trash refused this exact voice note, and confirmed separately.
      value.deleteVoiceNoteForever=(noteId:string)=>{const note=refusedVoice;if(note&&note.id===noteId)void deleteVoiceNote(value,note,true);};
      // Startup, resume and timer backstop (run by Trash maintenance): settles interrupted deletions without opening Notes.
      // Nothing pending: no lock, no repaint.
      value.recoverVoiceDeletions=async()=>{if(Object.keys(await pendingAudioDeletions()).length)await refreshDeletionStatus(value);};
      value.commitAudioNoteDeletion=async(row:AudioDeletion,authorized:()=>void)=>{
        if(this.notesStorageFailed||this.notesPending)throw Error('Notes needs recovery');
        await this.notesStore.execute({type:'notes_delete',target:row.target},row.id,new AbortController().signal,authorized);
        window.dispatchEvent(new Event('alpha:notes-committed'));
      };
    }
    return value;
  };
  let deletionBusy=false,noteHandoffBusy=false;
  let deletionRefresh:Promise<void>|null=null;
  /**
   * Permanent deletions this process started. An effect of theirs that failed here may still
   * land, so they keep the review path. Only rows an earlier process left are settled outright.
   */
  const sessionDeletions=new Set<string>();
  /** The reviewed voice note a full Trash refused. Memory only; a restart simply asks again. */
  let refusedVoice:Bag|null=null;
  let api: Bag | undefined, stage = 'closed', generation = 0, busy = false;
  let clip: Clip | undefined, recordingId: string | undefined, started = 0;
  let error = '', draft = '', requestId: string | undefined, saveId = '';
  // Distinct failure kinds keep their own guidance; progress belongs to the current transcription.
  let failure: VoiceFailure | '' = '', progress: SpeechProgressEvent | undefined;
  let recognized: { text: string; provenance: TranscriptProvenance } | undefined;
  let savedStarting:Promise<void>|undefined;
  let savedPlaying: string | undefined, savedPosition = 0, savedEpoch = 0, savedTick: ReturnType<typeof setInterval> | undefined;
  const stopSaved = () => { const owned = savedPlaying !== undefined; ++savedEpoch; savedPlaying = undefined; savedPosition = 0; if (savedTick) clearInterval(savedTick); savedTick = undefined; if (owned) {const pending=savedStarting;stopping=stopping.then(async()=>{try{await pending;}catch{}await noteAudio.stop();}).catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});} };
  async function playSaved(note: Bag) {
    if (savedPlaying === note.audio.audioId) { stopSaved(); refresh(); return; }
    stopSaved(); const epoch = savedEpoch; savedPlaying = note.audio.audioId; refresh();
    try {
      await stopping;if(epoch!==savedEpoch)return;const pending=savedStarting=noteAudio.play({ audioId: note.audio.audioId });try{await pending;}finally{if(savedStarting===pending)savedStarting=undefined;}
      if (epoch !== savedEpoch) return;
      savedTick = setInterval(() => { void noteAudio.state().then(value => { if (epoch !== savedEpoch) return; if (!value.playing || value.audioId !== savedPlaying) { stopSaved(); refresh(); return; } savedPosition = value.positionMs; refresh(); }).catch(() => { if (epoch === savedEpoch) { stopSaved(); refresh(); } }); }, 250);
    } catch { if (epoch === savedEpoch) { stopSaved(); api?.toast('This saved recording could not be played. The transcript is still available.'); refresh(); } }
  }
  type DictationTarget = { id: string; body: string; revision: string; start: number; end: number };
  let destination: DictationTarget | undefined;
  let listener: PluginListenerHandle | undefined, tick: ReturnType<typeof setInterval> | undefined;
  let stopping = Promise.resolve();
  type Driver = typeof voice | ReturnType<typeof createCloudVoice>;
  let startingCapture:ReturnType<Driver['startRecording']>|undefined;
  let driver: Driver = voice, cloudMode = false, cloudConnectRequired = false, deviceOnly = false;
  let pairedVoice: ReturnType<typeof createPairedVoice> = null, pairedReady = false, pairedAsrReady = false;
  let selectedRoute: 'device' | 'agent' | 'manual' = 'device', preparingPaired = false;
  let onDeviceVoice: ReturnType<typeof createOnDeviceVoice> = null, onDeviceReady = false, preparingLocal = false;
  let transcription: AbortController | undefined;
  let readiness: AbortController | undefined;
  let playback: AbortController | undefined, playing = false;
  type ChatDestination={shell:any;view:string|null;chat:string;draft:string;reply:unknown;edit:unknown;binding:string;opener?:HTMLElement};
  let chatDestination:ChatDestination|undefined;
  let ownedNavigation:{chat:ChatDestination;view:string;detent:string;applying:boolean;turnId:string;context?:import('../runtime/alpha-client').ContextEnvelope}|undefined;
  let conversationVoice:Pick<BatchVoiceConversation<Clip>,'start'|'stop'|'recheck'|'resume'>|Awaited<ReturnType<typeof developmentCartesiaConversation>>|undefined;
  let conversationState:BatchVoiceState={phase:'idle'};
  let conversationReviewRequired=false;
  let conversationSpeech:Promise<void>|undefined;
  let notesSpeech:Promise<void>|undefined;
  let conversationPrepared:{binding:import('../runtime/alpha-client').VoiceConversationBinding;context:import('../runtime/alpha-client').ContextEnvelope}|undefined;
  let conversationLevels:number[]=[];
  let conversationLastTranscript='',conversationLastReply='';
  let mediaUnconfirmed:unknown;
  let retirement:{shell:any;phase:'stopping'|'error';returnChat:string;view:string|null;binding:string;panelChat:string;promise:Promise<void>;approval?:AbortController;proposalId?:string}|undefined;
  const refresh = () => chatDestination ? chatDestination.shell.setState({}) : api?.setView('notes', { nativeVoiceRevision: Date.now() });
  const stopClock = () => { if (tick) clearInterval(tick); tick = undefined; };
  function cleanup(close = true,publish=true) {
    ownedNavigation=undefined;
    const hadCapture=!!recordingId||!!startingCapture||!!clip;
    const previousChat=chatDestination;const chatShell=previousChat?.shell,previousConversation=conversationVoice,previousSpeech=conversationSpeech,previousNotesSpeech=notesSpeech;conversationVoice=undefined;conversationPrepared=undefined;
    const conversationStopped=previousConversation?.stop();
    closeTranscriptQuestion?.();
    ++generation; readiness?.abort(); readiness = undefined; transcription?.abort(); transcription = undefined; pairedVoice = null; onDeviceVoice = null; onDeviceReady = false; preparingLocal = false; preparingPaired = false; pairedReady = false; pairedAsrReady = false; busy = false; stopClock(); stopSaved();
    if (requestId) void driver.cancel({ requestId }).catch(() => {});
    playback?.abort(); playback = undefined; playing = false;
    requestId = undefined;
    if (listener) void listener.remove(); listener = undefined;
    const previous = driver;
    const pendingStart=startingCapture;
    stopping = stopping.then(async () => { await conversationStopped;await previousSpeech?.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});await previousNotesSpeech?.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});if(pendingStart)try{await pendingStart;}catch{}try { await previous.cancelRecording(); } catch(error) {if(hadCapture||previousConversation)throw error;} });
    stopping=stopping.catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});
    if(chatShell&&(previousConversation||previousSpeech||hadCapture)){
      const held:NonNullable<typeof retirement>={shell:chatShell,phase:'stopping',returnChat:previousChat!.chat,view:previousChat!.view,binding:previousChat!.binding,panelChat:chatShell.S().chat,promise:stopping,approval:chatShell.pendingActionApproval,proposalId:chatShell.pendingActionApprovalProposalId};retirement=held;
      void stopping.then(()=>{if(retirement!==held)return;retirement=undefined;if(chatShell.live!==false)chatShell.setState((state:any)=>({...(composerBinding()===held.binding&&(state.view||null)===held.view&&state.chat===held.panelChat?{chat:held.returnChat}:{})}));},()=>{if(retirement!==held)return;held.phase='error';if(chatShell.live!==false)chatShell.setState({});});
    }
    clip = undefined; recordingId = undefined;
    progress = undefined;
    if (close) { stage = 'closed'; draft = ''; destination = undefined; chatDestination = undefined; failure = ''; recognized = undefined; }
    if(publish){if(chatShell)chatShell.setState({});else refresh();}
  }
  function enter(target?: DictationTarget, preparedLocal?: ReturnType<typeof createOnDeviceVoice>, preference: 'default' | 'device' | 'agent' | 'manual' = 'default', chat?:ChatDestination) {
    const selected = chat ? 'cloud' : selectVoiceRoute(preference), route = selected === 'cloud' ? 'agent' : selected;
    const previousChat=chatDestination;
    stopLocalSpeechPlayback(); cleanup(true,!chat); chatDestination=chat;reprepare = false; destination = target; saveId = target?.id || crypto.randomUUID(); stage = 'ready'; error = ''; failure = ''; recognized = undefined; draft = ''; selectedRoute = route;
    if(previousChat&&!chat)previousChat.shell.setState({chat:previousChat.chat});
    cloudMode = selected === 'cloud';
    cloudConnectRequired = cloudMode && !(chat&&developmentCartesiaVoiceEnabled) && (!connectionController.getCloudEnvironment() || !connectionController.getCloudClient()?.credentialId);
    deviceOnly = !cloudMode && (browserDevProfile || localStorage.getItem('alpha.connection.selection.v1') !== null || !Capacitor.isPluginAvailable('DevelopmentAgent'));
    driver = cloudMode && !cloudConnectRequired ? createCloudVoice() : deviceOnly ? deviceVoice : voice;
    if (cloudConnectRequired) error = 'Sign in to Eliza Cloud to use voice.';
    onDeviceVoice = !cloudMode && (route === 'device' || browserDevProfile && route === 'agent') ? preparedLocal || createOnDeviceVoice() : null;
    if (route === 'manual') { cloudMode = false; deviceOnly = true; driver = deviceVoice; }
    if (route === 'device') { cloudMode = false; deviceOnly = true; driver = deviceVoice; if (!onDeviceVoice) error = 'On-device speech is unavailable. Choose another voice service explicitly or use the keyboard.'; }
    if (preparedLocal) { onDeviceReady = true; cloudMode = false; deviceOnly = true; driver = deviceVoice; }
    else if (onDeviceVoice) {
      preparingLocal = true;
      const local = onDeviceVoice, token = generation, controller = new AbortController(); readiness = controller;
      void stopping.then(() => {
        if (token !== generation || controller.signal.aborted) return false;
        return local.ready(controller.signal);
      }).then(ready => {
        if (token !== generation || controller.signal.aborted) return;
        preparingLocal = false;
        if (!ready || stage !== 'ready') { if (!ready) error = 'On-device speech is unavailable. Choose another voice service explicitly or use the keyboard.'; refresh(); return; }
        onDeviceReady = true; cloudMode = false; deviceOnly = true; driver = deviceVoice;
        pairedReady = false; pairedAsrReady = false; refresh();
      }).catch(() => { if (token === generation) { preparingLocal = false; error = 'On-device speech is unavailable. Choose another voice service explicitly or use the keyboard.'; refresh(); } });
    }
    if (route === 'agent' && !browserDevProfile && !cloudMode && deviceOnly) {
      pairedVoice = createPairedVoice();
      if (pairedVoice) {
        preparingPaired = true;
        const token = generation, controller = new AbortController(); readiness = controller;
        const selected = pairedVoice;
        void (async () => {
          await stopping;
          if (token !== generation || controller.signal.aborted) return;
          try { const ready = await selected.ready(controller.signal); if (token === generation && !controller.signal.aborted) { pairedReady = ready; refresh(); } } catch { /* TTS and ASR are separate capabilities. */ }
          if (token !== generation || controller.signal.aborted) return;
          try { const ready = await selected.transcriptionReady(controller.signal); if (token === generation && !controller.signal.aborted) { pairedAsrReady = ready; refresh(); } } catch { /* Manual recording remains available. */ }
          if (token === generation && !controller.signal.aborted) { preparingPaired = false; refresh(); }
        })();
      }
    }
    refresh();
  }
  /** Retire the current attempt and prepare the same route again, keeping its destination. */
  let reprepare = false;
  function reopen(message: string) {
    const target = destination, chat = chatDestination, route = selectedRoute;
    enter(target, undefined, route,chat); error = message; refresh();
  }
  async function act(task: (token: number) => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; failure = ''; const token = generation; refresh();
    try { await task(token); }
    catch (reason) { if (token === generation) {
      progress = undefined;
      const kind = voiceFailure(reason, { transcribing: stage === 'transcribing', browser: !Capacitor.isNativePlatform() });
      if (kind) { failure = kind.kind; error = kind.message; stage = stage === 'review' ? 'review' : clip ? 'recorded' : 'ready'; stopClock(); return; }
      error = (cloudMode && cloudVoiceFailure(reason)) || (onDeviceReady ? 'On-device speech unavailable. Keep recordings under 30 seconds and use English text under 500 characters for playback. Your recording is retained.' : pairedAsrReady ? 'Agent Whisper transcription unavailable. Your recording is retained; check the selected agent and retry explicitly.' : deviceOnly ? 'Recording unavailable. Check microphone access and available device storage, then retry.' : cloudMode ? 'Cloud voice unavailable. Check microphone access, your Cloud account and the connection, then retry.' : 'Voice unavailable. Check microphone access and the local development service, then retry.'); stage = stage === 'review' ? 'review' : clip ? 'recorded' : 'ready'; stopClock(); } }
    finally { if (token === generation) { busy = false; refresh(); } }
  }
  async function start(token: number) {
    if (cloudConnectRequired) throw new Error('Sign in to Eliza Cloud to use voice.');
    if (selectedRoute === 'device' && !onDeviceReady) throw new Error('On-device speech is not ready');
    if (!Capacitor.isPluginAvailable(cloudMode || deviceOnly ? 'AlphaVoiceCloud' : 'DevelopmentAgent')) throw new Error('Voice unavailable');
    stage = 'starting'; refresh(); await stopping;
    if (token !== generation) return;
    if (listener) await listener.remove(); listener = undefined;
    const handle = await driver.addListener('recordingStopped', value => {
      if (token !== generation || (recordingId && value.recordingId !== recordingId)) return;
      stopClock();
      if (!value.recordingId || !Number.isFinite(value.durationMs)) { clip = undefined; stage = 'ready'; error = 'Recording ended without usable audio.'; }
      else { clip = value; stage = 'recorded'; }
      refresh();
    });
    if (token !== generation) { await handle.remove(); return; }
    listener = handle;
    const capture=onDeviceReady?deviceVoice.startRecording({maxDurationMs:29000}):driver.startRecording();
    startingCapture=capture;
    let result:Awaited<typeof capture>;
    try{result=await capture;}finally{if(startingCapture===capture)startingCapture=undefined;}
    if (token !== generation) return;
    recordingId = result.recordingId;
    if (stage === 'recorded') return; // Automatic-stop event can race promise delivery.
    started = Date.now(); stage = 'recording'; tick = setInterval(refresh, 250); refresh();
  }
  async function primary() {
    if(chatDestination&&!chatCurrent()){cleanup();return;}
    if (cloudConnectRequired) { cleanup(); connectionController.openCloudAccount(); return; }
    if (stage === 'transcribing') { reopen('Transcription cancelled. Record again to continue.'); return; }
    if (stage === 'review') {
      if (!draft.trim()) return;
      if (chatDestination) {
        if(!chatCurrent()){cleanup();return;}
        const { shell, chat, draft:previousDraft } = chatDestination;
        const text=previousDraft?[previousDraft,draft].join('\n'):draft;
        cleanup();
        shell.setState({chat:['input','sheet','full'].includes(chat)?chat:'input',draft:text,voice:'off'});
        return;
      }
      if(!api)return;
      if(api.storageReady?.()===false){error='Notes has a pending or unconfirmed save. Wait or reopen Notes to inspect before saving again.';refresh();return;}
      const current = api.get('notes').list || [];
      const target = destination && current.find((n: Bag) => n.id === destination!.id);
      if (destination && (!target || JSON.stringify(target) !== destination.revision)) { error = 'The original note changed. Cancel and reopen recording before applying this transcript.'; refresh(); return; }
      if (!clip || busy) return;
      if (destination && target) {
        const text = destination.body.slice(0, destination.start) + draft + destination.body.slice(destination.end);
        const id = target.id, caret = destination.start + draft.length;
        const next = current.map((n: Bag) => n.id === id ? { ...n, body: text, when: 'Now' } : n);
        const owner = api;
        await act(async token => {
          const saved = await owner.saveVoiceNote({ list: next, open: id });
          if (token !== generation) return;
          if (saved !== true) { error = 'The note save is unconfirmed. Your transcript is retained; inspect saved Notes before applying again.'; refresh(); return; }
          cleanup();
          const completed = generation;
          window.requestAnimationFrame?.(() => {
            if (completed !== generation || api?.get('notes').open !== id) return;
            const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]');
            if (editor?.value === text) { editor.focus(); editor.setSelectionRange(caret, caret); }
          });
        });
        return;
      }
      await act(async token => {
        const id = target?.id || saveId;
        const text = [target?.body, draft].filter(Boolean).join('\n');
        const recording = clip!;
        const audio = await (cloudMode || deviceOnly ? cloudRecorder : localRecorder).saveRecording({ recordingId: recording.recordingId, noteId: id, transcript: text });
        if (token !== generation) return;
        if (audio.noteId !== id || audio.audioId !== recording.recordingId || !Number.isFinite(audio.durationMs)) throw new Error('Invalid saved recording');
        // Provenance describes how this recording's transcript was produced; edits stay the user's.
        const transcription = recognized ? { ...recognized.provenance, edited: draft.trim() !== recognized.text.trim() } : { route: 'manual' };
        const note = { ...(target || {}), id, kind: 'voice', title: target?.title || 'Voice note', body: text, audio, transcription, dur: audio.durationMs / 1000, summary: [], actions: [], lines: [{ s: 'me', at: 0, t: text }], pinned: target?.pinned || false, when: 'Now' };
        // Native retention can outlive unrelated editor commits. Merge into the latest collection.
        if(api!.storageReady?.()===false)throw new Error('Notes has an unconfirmed save. Reopen before applying this recording.');
        const latest = api!.get('notes').list || [];
        const latestTarget = latest.find((n: Bag) => n.id === id);
        if(target ? JSON.stringify(latestTarget)!==JSON.stringify(target) : !!latestTarget)throw new Error('The note changed while saving audio. Recording retained; reopen before applying.');
        const next = target ? latest.map((n: Bag) => n.id === id ? note : n) : [note, ...latest];
        const saved = await api!.saveVoiceNote({ list: next, open: id });
        if (token !== generation) return;
        if (saved !== true) { error = 'The note save is unconfirmed. The recording and transcript are retained; inspect saved Notes before saving again.'; refresh(); return; }
        cleanup();
      });
      return;
    }
    await act(async token => {
      if (stage === 'ready') return start(token);
      if (stage === 'recording') {
        const value = await driver.stopRecording(); if (token !== generation) return;
        if (!value.recordingId || !Number.isFinite(value.durationMs)) throw new Error('Bad clip');
        clip = value; stage = 'recorded'; stopClock(); return;
      }
      if (stage === 'recorded' && clip) {
        if(deviceOnly && !pairedAsrReady && !onDeviceReady) {draft = ''; stage = 'review'; return;}
        stage = 'transcribing'; requestId = crypto.randomUUID(); progress = undefined; recognized = undefined; refresh();
        transcription = new AbortController();
        const onProgress = (value: SpeechProgressEvent) => { if (token === generation && stage === 'transcribing') { progress = value; refresh(); } };
        const result = onDeviceReady && onDeviceVoice ? await onDeviceVoice.transcribe(clip.recordingId, transcription.signal, onProgress) : pairedAsrReady && pairedVoice ? await pairedVoice.transcribe(clip.recordingId, transcription.signal) : await driver.transcribeRecording({ recordingId: clip.recordingId, requestId });
        transcription = undefined;
        if (token !== generation) return;
        requestId = undefined;
        if (typeof result.text !== 'string' || !result.text.trim() || result.local !== !cloudMode) throw new Error('Invalid transcript');
        draft = result.text; stage = 'review'; progress = undefined;
        recognized = { text: result.text, provenance: transcriptProvenance(result, { onDevice: onDeviceReady, native: Capacitor.isNativePlatform(), paired: pairedAsrReady, cloud: cloudMode }) };
      }
    });
  }
  async function listen() {
    if (playing) { playback?.abort(); return; }
    const speaker = onDeviceReady ? onDeviceVoice : cloudMode && 'speak' in driver ? driver : pairedReady ? pairedVoice : null;
    if (!speaker || !draft.trim()) return;
    const token = generation, controller = new AbortController();
    playback = controller; playing = true; error = ''; refresh();
    const pending=notesSpeech=speaker.speak(draft, controller.signal);
    try { await pending; }
    catch (failure) { if((failure as {code?:string})?.code==='speech-cleanup-unconfirmed'){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});}if (token === generation && !controller.signal.aborted) error = (cloudMode && cloudVoiceFailure(failure)) || 'Audio could not be played by the selected voice service. Your transcript is still available.'; }
    finally { if(notesSpeech===pending)notesSpeech=undefined;if (token === generation) { playback = undefined; playing = false; refresh(); } }
  }
  const composerBinding = () => JSON.stringify([
    connectionController.getSnapshot().session?.sessionId,
    connectionController.getCloudClient()?.sessionId,
    connectionController.getCloudClient()?.credentialId,
    connectionController.getCloudEnvironment(),
    document.documentElement.dataset.connectionMode,
  ]);
  function chatCurrent(){
    const chat=chatDestination;if(!chat)return false;const state=chat.shell.S(),view=state.view||'home',owned=ownedNavigation?.chat===chat?ownedNavigation:undefined;
    let contextCurrent=!conversationPrepared||chat.shell.voiceConversationCurrent(conversationPrepared);
    // Only the claimed destination may transition before its React callback pins the exact ACK context.
    if(!contextCurrent&&owned&&view===owned.view&&conversationPrepared){try{const actual=chat.shell.voiceConversationContext(conversationPrepared.binding);contextCurrent=actual.view===owned.view&&(owned.context?JSON.stringify(actual)===JSON.stringify(owned.context):owned.view!==(chat.view||'home'));}catch{contextCurrent=false;}}
    return chat.shell.live!==false&&!document.hidden&&!connectionController.getSnapshot().open
      &&['sheet','full'].includes(state.chat)&&((state.view||null)===chat.view||!!owned&&view===owned.view)&&String(state.draft||'')===chat.draft
      &&chat.shell.messageReplyTarget===chat.reply&&chat.shell.messageEditTarget===chat.edit&&composerBinding()===chat.binding&&contextCurrent;
  }
  function navigationContinuation(chat:ChatDestination,token:number,turnId:string):import('../runtime/alpha-client').VoiceNavigationContinuation{
    let held:typeof ownedNavigation,attempted=false;
    return {
      async apply(view,check,commit){
        attempted=true;check();if(chat.shell.voiceSendTurnId!==turnId||token!==generation||chatDestination!==chat||!chatCurrent()||ownedNavigation)throw Error('Voice navigation changed.');
        held={chat,view,detent:chat.shell.S().chat,applying:true,turnId};ownedNavigation=held;
        let pending:Promise<boolean>;try{pending=commit(held.detent,value=>{if(chat.shell.voiceSendTurnId!==turnId||ownedNavigation!==held||token!==generation||chatDestination!==chat)throw Error('Voice navigation changed.');const actual=chat.shell.voiceConversationContext(conversationPrepared!.binding);if(value.view!==held!.view||JSON.stringify(actual)!==JSON.stringify(value))throw Error('Voice navigation changed.');held!.context=value;});}finally{held.applying=false;}
        const switched=await pending;
        if(!switched||ownedNavigation!==held||token!==generation||chatDestination!==chat||!chatCurrent())return false;
        return !!held.context;
      },
      finish(delivered){
        if(!attempted)return;
        attempted=false;
        if(!held||chat.shell.voiceSendTurnId!==turnId||ownedNavigation!==held||token!==generation||chatDestination!==chat)return;
        if(!delivered||!held.context||!chatCurrent()||(chat.shell.S().view||'home')!==held.view){cleanup();return;}
        try{const next=chat.shell.voiceConversationContext(conversationPrepared!.binding);if(next.view!==held.view||JSON.stringify(next)!==JSON.stringify(held.context))throw Error('Voice navigation changed.');chat.view=held.view==='home'?null:held.view;conversationPrepared={...conversationPrepared!,context:next};ownedNavigation=undefined;return next;}catch{cleanup();return;}
      },
    };
  }
  function cancelChat(keyboard=false){
    const chat=chatDestination;if(!chat){if(retirement)retirement.returnChat=keyboard?'input':retirement.returnChat;return;}if(!keyboard){chat.shell.pendingActionApproval?.abort();chat.shell.cancelReadReplyCompletions?.();}cleanup();
    if(retirement&&retirement.shell===chat.shell){retirement.returnChat=keyboard?(chat.chat==='full'?'full':'input'):chat.chat;chat.shell.setState({chat:chat.shell.S().chat==='full'?'full':'sheet'});return;}
    chat.shell.setState({chat:keyboard?(chat.chat==='full'?'full':'input'):chat.chat},()=>{
      if(chat.shell.live===false||connectionController.getSnapshot().open||(chat.shell.S().view||null)!==chat.view)return;
      const opener=chat.opener?.isConnected?chat.opener:document.querySelector<HTMLElement>('[data-alpha-composer], [data-alpha-layer="pill"] button[aria-label="Talk"]');
      if(opener&&!opener.closest('[inert]'))opener.focus({preventScroll:true});
    });
  }
  // User navigation retires media; only the exact synchronous claimed projection retains it.
  for (const method of ['openView', 'goHome', 'back']) {
    const original = Component.prototype[method];
    if (typeof original === 'function') Component.prototype[method] = function (...args: any[]) {

      if(retirement?.shell===this&&method==='back'){this.toast('Voice media is still stopping.');return;}
      const owned=ownedNavigation;const ownEffect=owned?.applying&&owned.chat.shell===this&&(method==='goHome'?owned.view==='home':method==='openView'&&args[0]===owned.view);
      if(chatDestination?.shell===this&&!ownEffect){if(method==='back'){cancelChat();return;}cleanup();}
      return original.apply(this,args);
    };
  }
  async function captureConversationAudio(selected:ReturnType<typeof createCloudVoice>,current:()=>void,input:{signal:AbortSignal;onActivity:(value:{peak:number;rms?:number})=>void;onEnd:(error?:unknown)=>void}){
    let active=true,recording=false,id:string|undefined,ended:Clip|undefined,problem:unknown,endId:string|undefined,handle:PluginListenerHandle|undefined,poll:ReturnType<typeof setTimeout>|undefined,cancelling:Promise<void>|undefined;
    const check=()=>{input.signal.throwIfAborted();current();};
    const detach=async()=>{if(poll)clearTimeout(poll);poll=undefined;if(handle){const previous=handle;handle=undefined;await previous.remove();}};
    const cancel=()=>{if(cancelling)return cancelling;active=false;recording=false;input.signal.removeEventListener('abort',aborted);cancelling=(async()=>{try{await detach();}finally{try{await selected.cancelRecording();}catch(failure){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});throw failure;}}})();return cancelling;};
    const aborted=()=>{recording=false;if(poll)clearTimeout(poll);void selected.cancelRecording().catch(()=>{});};
    input.signal.addEventListener('abort',aborted,{once:true});if(input.signal.aborted)aborted();
    try{
      await stopping;check();
      handle=await selected.addListener('recordingStopped',value=>{
        if(!active||input.signal.aborted||id&&value.recordingId!==id)return;
        if(!value.recordingId)return;
        endId=value.recordingId;if(Number.isFinite(value.durationMs))ended=value;else problem=Error('Microphone capture was interrupted.');
        if(id){recording=false;if(poll)clearTimeout(poll);input.onEnd(problem);}
      });check();
      const pending=selected.startRecording();startingCapture=pending;
      let result:Awaited<typeof pending>;try{result=await pending;}finally{if(startingCapture===pending)startingCapture=undefined;}
      check();id=result.recordingId;recordingId=id;started=Date.now();recording=true;conversationLevels=[];
      if(endId&&endId!==id){ended=undefined;problem=undefined;}
      const sample=async()=>{
        if(!active||!recording||input.signal.aborted)return;
        try{check();const value=await selected.getRecordingMetrics(id!);check();if(!active||!recording)return;conversationLevels=[...conversationLevels.slice(-43),value.peak];input.onActivity(value);refresh();if(active&&recording&&!input.signal.aborted)poll=setTimeout(()=>{void sample();},50);}
        catch(error){if(!active||input.signal.aborted)return;recording=false;problem=error;input.onEnd(error);}
      };
      if(ended||problem){recording=false;input.onEnd(problem);}else void sample();
      return {
        stop:async()=>{check();recording=false;await detach();check();if(problem)throw problem;const value=ended??await selected.stopRecording();check();if(value.recordingId!==id||!Number.isFinite(value.durationMs))throw Error('Recording identity changed.');clip=value;return value;},
        cancel,
      };
    }catch(error){await cancel();throw error;}
  }
  async function beginConversation(){
    const chat=chatDestination;if(!chat||!chatCurrent())return;
    const token=generation;
    if(cloudConnectRequired&&!developmentCartesiaVoiceEnabled){conversationState={phase:'error'};error='Sign in to Eliza Cloud to use voice.';refresh();return;}
    const controller=new AbortController();readiness=controller;conversationReviewRequired=false;conversationState={phase:'starting'};error='';refresh();
    const current=()=>{controller.signal.throwIfAborted();if(token!==generation||chatDestination!==chat||!chatCurrent())throw new DOMException('Voice conversation changed','AbortError');};
    try{
      current();const prepared=await chat.shell.prepareVoiceConversation(controller.signal);current();conversationPrepared=prepared;current();
      const previous=conversationVoice;conversationVoice=undefined;await stopping;await previous?.stop();current();
      if(developmentCartesiaVoiceEnabled){
        const direct=await developmentCartesiaConversation({binding:prepared.binding,assertCurrent:current,onState:phase=>{if(token!==generation)return;conversationState={phase:phase==='connecting'?'starting':['listening','thinking','speaking'].includes(phase)?phase as 'listening'|'thinking'|'speaking':'idle'};refresh();},onPlaybackUnlockChange:()=>{if(token===generation)refresh();},onTranscript:text=>{if(token===generation){conversationLastTranscript=text;refresh();}},onError:failure=>{if(token===generation){error=failure.message;conversationState={phase:'error',error:failure};refresh();}}});
        current();conversationVoice=direct;await direct.start();current();return;
      }
      const selected=createCloudVoice();driver=selected;cloudMode=true;
      const conversation:BatchVoiceConversation<Clip>=new BatchVoiceConversation<Clip>({
        conversationId:prepared.binding.conversationId,assertCurrent:current,
        capture:input=>{current();conversationPrepared={...conversationPrepared!,context:chat.shell.voiceConversationContext(prepared.binding)};current();return captureConversationAudio(selected,current,input);},
        transcribe:async(value,signal)=>{
          signal.throwIfAborted();current();const request=crypto.randomUUID();requestId=request;
          let interrupt!:(error:unknown)=>void;const cancelled=new Promise<never>((_,reject)=>interrupt=reject);
          const abort=()=>{void selected.cancel({requestId:request}).catch(()=>{});interrupt(signal.reason??new DOMException('Transcription cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
          try{current();const result=await Promise.race([selected.transcribeRecording({recordingId:value.recordingId,requestId:request}),cancelled]);signal.throwIfAborted();current();conversationLastTranscript=result.text;return result.text;}
          finally{signal.removeEventListener('abort',abort);if(requestId===request)requestId=undefined;}
        },
        send:async input=>{input.signal.throwIfAborted();current();const turn={...conversationPrepared!};const result=await chat.shell.sendVoiceTurn({...input,...turn,assertCurrent:current,navigation:navigationContinuation(chat,token,input.turnId)});input.signal.throwIfAborted();current();conversationLastReply=result.text;conversationReviewRequired=result.reviewRequired===true&&!result.awaitingUserInput;return result;},
        speak:async input=>{input.signal.throwIfAborted();current();const pending=selected.speak(input.text,input.signal,()=>{current();input.onStarted();});conversationSpeech=pending;try{await pending;input.signal.throwIfAborted();current();}catch(failure){if((failure as {code?:string})?.code==='speech-cleanup-unconfirmed'){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});}throw failure;}finally{if(conversationSpeech===pending)conversationSpeech=undefined;}},
        onState:value=>{if(token!==generation||chatDestination!==chat||conversationVoice!==conversation)return;conversationState=value;if(value.phase==='error')error=cloudVoiceFailure(value.error)||'Voice stopped. Check your connection and conversation history before trying again.';if(value.phase==='listening'){stopClock();tick=setInterval(refresh,250);}else stopClock();refresh();},
      });
      conversationVoice=conversation;await conversation.start();current();
    }catch(failure){if(token!==generation||controller.signal.aborted)return;conversationState={phase:'error',error:failure};error=cloudVoiceFailure(failure)||(failure instanceof Error?failure.message:'Voice could not start.');refresh();}
  }
  Component.prototype.stopVoiceConversation = function(){if(chatDestination?.shell===this){cancelChat();return stopping;}if(retirement&&retirement.shell===this)return retirement.promise;if(mediaUnconfirmed)return stopping;};
  Component.prototype.resumeReadReplyVoice=function(hint:import('../runtime/alpha-client').NativeNotesReadReplyHint,reply:import('../runtime/alpha-client').NativeNotesReadReply){
    if(chatDestination?.shell!==this||!chatCurrent()||document.querySelector('dialog[open]')||conversationState.phase!=='awaiting-user-input'||!conversationState.awaitingUserInput)return false;
    const pause=conversationState.awaitingUserInput;
    if(hint.proposalId!==pause.proposalId||hint.digest!==pause.digest||hint.requestId!==pause.requestId||hint.conversationId!==pause.conversationId||hint.inReplyTo!==pause.userMessageId||reply.requestId!==pause.requestId||reply.conversationId!==pause.conversationId||reply.inReplyTo!==pause.userMessageId)return false;
    return conversationVoice?.resume({pause,reply:{requestId:reply.requestId,conversationId:reply.conversationId,userMessageId:reply.inReplyTo,assistantMessageId:reply.messageId,text:reply.text,complete:true}})??false;
  };
  Component.prototype.prepareDeviceReadReview=async function(proposalId:string,digest:string|undefined,signal:AbortSignal){
    signal.throwIfAborted();if(stage!=='closed'&&!chatDestination)throw Error('Finish or discard the Notes recording before reviewing this request.');
    const binding=composerBinding(),pause=conversationState.awaitingUserInput;
    if(chatDestination?.shell===this&&!(conversationState.phase==='awaiting-user-input'&&pause?.proposalId===proposalId&&pause.digest===digest&&chatCurrent()))cleanup();
    const reading=stopLocalSpeechPlayback();stopSaved();await Promise.all([stopping,Promise.resolve(reading)]);signal.throwIfAborted();
    if(this.live===false||document.hidden||connectionController.getSnapshot().open||composerBinding()!==binding)throw Error('The Notes review changed.');
  };
  Component.prototype.retireReadReplyVoice=function(proposalId:string){if(chatDestination?.shell===this&&conversationState.awaitingUserInput?.proposalId===proposalId)cleanup();};
  Component.prototype.startVoice = async function () {
    if(this.live===false||document.hidden||connectionController.getSnapshot().open||chatDestination?.shell===this)return;
    if(this.pendingActionApproval||document.querySelector('dialog[open]')){this.toast('Finish or cancel the current review before starting voice.');return;}
    if(retirement||mediaUnconfirmed){this.toast('Voice media has not finished stopping. Close the app if this continues.');return;}
    if(stage!=='closed'){this.toast('Finish or discard the Notes recording before starting a voice conversation.');return;}
    const state=this.S();
    const chat:ChatDestination={shell:this,view:state.view||null,chat:state.chat,draft:String(state.draft||''),reply:this.messageReplyTarget,edit:this.messageEditTarget,binding:composerBinding(),...(typeof HTMLElement!=='undefined'&&document.activeElement instanceof HTMLElement?{opener:document.activeElement}:{})};
    const readingStopped=stopLocalSpeechPlayback();
    enter(undefined,undefined,'default',chat);stopping=Promise.all([stopping,Promise.resolve(readingStopped)]).then(()=>{}).catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});conversationLastTranscript='';conversationLastReply='';const token=generation;
    await new Promise<void>(resolve=>this.setState({chat:state.chat==='full'?'full':'sheet',voice:'off'},()=>{document.querySelector<HTMLElement>('[data-alpha-chat-recorder] button')?.focus({preventScroll:true});if(chatDestination===chat&&generation===token)void beginConversation().finally(resolve);else resolve();}));
  };
  function conversationRecorderView(icons:Bag){
    const token=generation,chat=chatDestination,owned=()=>token===generation&&chatDestination===chat&&chatCurrent();
    const phase=conversationState.phase,live=phase==='listening',seconds=live?(Date.now()-started)/1000:(clip?.durationMs||0)/1000;
    const messages:Record<string,string>={idle:'Voice conversation stopped.',starting:'Starting voice conversation…',listening:developmentCartesiaVoiceEnabled?'Listening · Cartesia development. Replies use the local agent’s direct Cerebras provider.':'Listening. Pause when finished. Speech is transcribed with Eliza Cloud and sent to this conversation; matching replies play aloud.',transcribing:'Transcribing your speech with Eliza Cloud…',thinking:'Waiting for your agent’s reply…','awaiting-user-input':'Microphone off. Review the Notes request in this conversation. Only the note you explicitly share can be used for the answer.','preparing-speech':'Preparing the matching reply with Eliza Cloud…',speaking:'Alpha is speaking. The microphone is off.',error:error||'Voice stopped. Check history before starting again.'};
    const primary=()=>{if(!owned())return;if(mediaUnconfirmed){cancelChat();return;}if(cloudConnectRequired){cleanup();connectionController.openCloudAccount();}else if(!connectionController.getSnapshot().session){cleanup();connectionController.open();}else if(phase==='error'&&!conversationReviewRequired)void beginConversation();else cancelChat();};
    const awaiting=phase==='awaiting-user-input'||conversationReviewRequired;
    const direct=developmentCartesiaVoiceEnabled&&conversationVoice&&'setMicrophoneMuted' in conversationVoice?conversationVoice:undefined;
    const extra=direct?{canMute:true,muteLabel:direct.microphoneMuted?'Unmute microphone':'Mute microphone',toggleMute:()=>{if(owned()){direct.setMicrophoneMuted(!direct.microphoneMuted);refresh();}},needsPlaybackUnlock:direct.needsPlaybackUnlock,unlockPlayback:()=>{if(owned())void direct.unlockPlayback().then(refresh).catch(failure=>{error=failure instanceof Error?failure.message:'Playback could not unlock.';refresh();});}}:{};
    return {...extra,state:phase,flex:awaiting?'0 0 auto':'1',clockSize:awaiting?28:48,clock:awaiting?'Review':`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`,live,levels:conversationLevels.map(peak=>({h:4+Math.round(44*peak)})),lines:[{t:conversationReviewRequired?'Microphone off. Review the phone action in this conversation. Switch to keyboard to continue; voice cannot resume this older request.':error||messages[phase]}],review:false,typeChoice:false,lastTranscript:awaiting?'':conversationLastTranscript,lastReply:awaiting?'':conversationLastReply,primaryLabel:mediaUnconfirmed?'Stop voice conversation':cloudConnectRequired?'Connect Eliza Cloud':!connectionController.getSnapshot().session?'Connect agent':phase==='error'&&!conversationReviewRequired?'Start voice conversation':'Stop voice conversation',primaryIcon:cloudConnectRequired?icons.user:phase==='error'&&!conversationReviewRequired?icons.mic:icons.stop,primaryDisabled:false,stop:primary,discard:()=>{if(owned())cancelChat();},keyboard:()=>{if(owned())cancelChat(true);}};
  }
  async function deletionReceipt(row:AudioDeletion,status:'removed'|'restored'){
    const result=await noteAudio.deletionStatus({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
    if(result.audioId!==row.audioId||result.noteId!==row.note.id||result.operationId!==row.id||result.status!==status)throw Error('Audio operation unconfirmed');
  }
  const trashRow=(entry:NotesTrashEntry):AudioDeletion=>{
    if(!entry.audio||!entry.target)throw Error('This Trash entry has no recording');
    return {id:entry.id,target:entry.target,note:entry.note,audioId:entry.audio.audioId};
  };
  /** Caller holds the deletion-effects lock. Erases the recording only when its own operation trashed it. */
  async function purgeTrashedRecording(entry:NotesTrashEntry){
    if(!entry.audio)return true;
    // An unconfirmed deletion stays under review; it is never purged out from under its recovery row.
    if((await pendingAudioDeletions())[entry.id])return false;
    const row=trashRow(entry);
    // Never erase a recording that a saved note still references (live again, or re-associated).
    // A Notes reset replaces the collection identity, so the tombstone alone cannot be required.
    if((await savedNotes()).some(n=>n.id===row.note.id||n.audio?.audioId===row.audioId))return false;
    const result=await noteAudio.purge({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
    if(result.audioId!==row.audioId||result.noteId!==row.note.id||result.operationId!==row.id||result.status!=='purged')throw Error('Recording erase unconfirmed');
    return true;
  }
  /**
   * Approved agent deletion of a voice note. Caller holds the deletion-effects lock.
   * Same protocol as the editor delete: Trash row and recovery row before the tombstone
   * commit, then the recording moves to the audio trash under the same operation id, so
   * Trash restores or purges note and recording together. A failure after the commit
   * leaves the recovery row for review; it never repeats a possibly completed effect.
   */
  async function trashVoiceNoteWithRecording<T>(note:Bag,target:NotesTarget,operationId:string,index:number,commit:()=>Promise<T>):Promise<T>{
    const audioId=note.audio?.audioId;let row:AudioDeletion|undefined;
    if(typeof audioId==='string'&&audioId&&note.audio?.noteId===note.id&&audioOperation.test(operationId)){
      if(Object.values(await pendingAudioDeletions()).some(x=>x.note.id===note.id))throw Error('A deletion of this voice note needs review first');
      const metadata=await noteAudio.describe({audioId}).catch(()=>null);
      // A recording that is already gone or owned elsewhere is left alone; the note text still goes to Trash.
      if(metadata&&metadata.noteId===note.id&&metadata.audioId===audioId&&!metadata.deletedAt)row={id:operationId,target,note:note as AudioDeletion['note'],audioId};
    }
    await editNotesTrash(doc=>addNotesTrashEntry(doc,{id:operationId,note:note as NotesTrashEntry['note'],target,index,deletedAt:Date.now(),...(row?{audio:{audioId:row.audioId}}:{})}));
    if(!row)return commit();
    await changeAudioDeletion(row,true);
    let result:T;
    try{result=await commit();}catch(error){
      // Proven unchanged: retire the recovery row. Otherwise it stays for review.
      try{if(await audioDeletionNoteState(row)==='original')await changeAudioDeletion(row,false);}catch{/* Retained for review. */}
      throw error;
    }
    try{
      if(await audioDeletionNoteState(row)!=='deleted')throw Error('Saved note changed');
      const retained=await noteAudio.describe({audioId:row.audioId});
      if(retained.noteId!==row.note.id||retained.audioId!==row.audioId)throw Error('Recording association changed');
      const dispatched={...row,audioRequested:true as const};await changeAudioDeletion(row,false,dispatched);row=dispatched;
      if(!retained.deletedAt)try{await noteAudio.remove({audioId:row.audioId,noteId:row.note.id,operationId:row.id});}catch{/* Readback only. */}
      const removed=await noteAudio.describe({audioId:row.audioId});
      if(removed.noteId!==row.note.id||!removed.deletedAt)throw Error('Recording deletion unconfirmed');
      await deletionReceipt(row,'removed');
      await changeAudioDeletion(row,false);
    }catch{/* The committed note deletion stands; the recovery row keeps the recording under review. */}
    return result;
  }
  async function dropTrashEntry(id:string){
    if((await readNotesTrash()).entries.some(entry=>entry.id===id))await editNotesTrash(doc=>removeNotesTrashEntries(doc,[id]));
    window.dispatchEvent(new Event('alpha:notes-trash-changed'));
  }
  async function restoreDeletion(row:AudioDeletion,current:Bag,index=0):Promise<boolean>{
    if(deletionBusy)return false;deletionBusy=true;let done=false;
    try{await withAudioDeletionLock(async()=>{
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
      const trashEntry=(await readNotesTrash()).entries.find(entry=>entry.id===row.id);
      if(trashEntry&&notesTrashExpired(trashEntry,Date.now()))throw Error('Trash retention expired');
      const state=await audioDeletionNoteState(row);
      if(state==='changed')throw Error('A newer note must be preserved');
      if(current.storageReady?.()===false)throw Error('Reopen Notes first');
      if(!(await pendingAudioDeletions())[row.id])await changeAudioDeletion(row,true);
      const metadata=await noteAudio.describe({audioId:row.audioId});
      if(metadata.noteId!==row.note.id||metadata.audioId!==row.audioId)throw Error('Recording association changed');
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
      await noteAudio.restore({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
      await deletionReceipt(row,'restored');
      const restored=await noteAudio.describe({audioId:row.audioId});
      if(restored.deletedAt||restored.noteId!==row.note.id)throw Error('Restore unconfirmed');
      if(await audioDeletionNoteState(row)!==state)throw Error('Note changed while restoring');
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
      if(state==='deleted'){
        const list=current.get('notes').list;
        // Reinstate the exact reviewed record (same id and revision) near its old position.
        if(list.some((n:Bag)=>n.id===row.note.id))throw Error('Restore unconfirmed');
        const next=list.slice();next.splice(Math.min(Math.max(0,index),next.length),0,structuredClone(row.note));
        if(await current.saveVoiceNote({list:next},{exact:true})!==true)throw Error('Restore unconfirmed');
      }
      if((await pendingAudioDeletions())[row.id])await changeAudioDeletion(row,false);
      await dropTrashEntry(row.id);
      done=true;current.toast('Voice note restored.');
    });}catch{current.toast('Restore is unconfirmed. Reopen Notes and check deletion status. No newer note was replaced.');}
    finally{deletionBusy=false;void refreshDeletionStatus(current);}
    return done;
  }
  /**
   * Permanent erase for a deletion that skipped Trash. Caller holds the deletion-effects lock,
   * the tombstone is committed and this operation owns the audio trash. Idempotent: a recording
   * already erased by this operation is only confirmed. A recording that any saved note
   * references is never erased; the recovery row then stays for review.
   */
  async function eraseForever(row:AudioDeletion){
    const status=await noteAudio.deletionStatus({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
    if(status.audioId!==row.audioId||status.noteId!==row.note.id||status.operationId!==row.id)throw Error('Audio operation unconfirmed');
    if(status.status==='purged')return;
    if(status.status!=='removed')throw Error('Audio operation unconfirmed');
    if((await savedNotes()).some(n=>n.id===row.note.id||n.audio?.audioId===row.audioId))throw Error('A saved note references this recording');
    const result=await noteAudio.purge({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
    if(result.audioId!==row.audioId||result.noteId!==row.note.id||result.operationId!==row.id||result.status!=='purged')throw Error('Recording erase unconfirmed');
  }
  /**
   * Editor deletion of a voice note. Normally the note and recording move to Trash. With
   * `permanent` (a full Trash refused the restorable copy and the person confirmed separately)
   * no Trash row is written: the recovery row is the only copy until the tombstone commit and
   * the erase of this exact recording are both confirmed, so an interruption at any point
   * leaves the deletion under review instead of losing or repeating an effect.
   */
  async function deleteVoiceNote(current:Bag,reviewed:Bag,permanent:boolean){
        if(deletionBusy)return;deletionBusy=true;stopSaved();
        if(permanent)current.set({trashBusy:true});
        let row:AudioDeletion|undefined,refusedFull=false;
        const active=()=>current.voiceNoteActive()&&current.isActive()&&!document.hidden&&!connectionController.getSnapshot().open&&current.get('notes').open===reviewed.id;
        try {await withAudioDeletionLock(async()=>{
          if(!active())return;
          const prior=Object.values(await pendingAudioDeletions()).find(x=>x.note.id===reviewed.id);
          if(prior){current.toast('Deletion remains unconfirmed. Check deletion status; it will not be repeated.');return;}
          const target=await current.reviewAudioDeletion(reviewed);
          if(!active())return;
          const metadata=await noteAudio.describe({audioId:reviewed.audio.audioId});
          if(metadata.noteId!==reviewed.id||metadata.audioId!==reviewed.audio.audioId||metadata.deletedAt)throw Error('Recording association changed');
          if(!active())return;
          row={id:crypto.randomUUID(),target,note:reviewed as AudioDeletion['note'],audioId:reviewed.audio.audioId,...(permanent?{permanent:true as const}:{})};
          // Write-ahead Trash copy: the note text and its recording stay restorable for three days.
          // Maintenance drops it again if the deletion below never commits.
          const index=Math.max(0,(current.get('notes').list||[]).findIndex((n:Bag)=>n.id===reviewed.id));
          if(!permanent)try{await editNotesTrash(doc=>addNotesTrashEntry(doc,{id:row!.id,note:reviewed as NotesTrashEntry['note'],target,index,deletedAt:Date.now(),audio:{audioId:reviewed.audio.audioId}}));}
          catch(error){
            // Definite refusal before any effect: note and recording are untouched.
            if(!isNotesTrashFull(error))throw error;
            row=undefined;refusedFull=true;refusedVoice=reviewed;
            if(active())current.set({trashFull:{id:reviewed.id,title:reviewed.title||'Voice note',voice:true},trashConfirm:null});
            return;
          }
          if(permanent){
            // The reviewed record must be the one in authoritative storage, not only in this view's copy:
            // if another view changed it or moved it to Trash, that Trash row is the only restorable copy.
            const saved=(await savedNotes()).find(n=>n.id===reviewed.id);
            if(!saved||JSON.stringify(saved)!==JSON.stringify(reviewed)){row=undefined;current.toast('This note changed. Nothing was deleted.');return;}
            // The note is saved and its recording is live, so any Trash row for it is stale (maintenance
            // would drop it). Left in place it would offer the permanently deleted note for restore again.
            const stale=(await readNotesTrash()).entries.filter(entry=>entry.note.id===reviewed.id).map(entry=>entry.id);
            if(stale.length)await editNotesTrash(doc=>removeNotesTrashEntries(doc,stale));
          }
          sessionDeletions.add(row.id);
          await changeAudioDeletion(row,true);
          const authorized=()=>{if(!active())throw Error('Review changed');};
          try{await current.commitAudioNoteDeletion(row,authorized);}catch{
            current.toast('Deletion is unconfirmed. Check deletion status; it will not be repeated.');return;
          }
          if(await audioDeletionNoteState(row)!=='deleted')throw Error('Saved note changed');
          // The durable intent already exists before this second, separately observable effect.
          const retained=await noteAudio.describe({audioId:row.audioId});
          if(retained.noteId!==row.note.id||retained.audioId!==row.audioId)throw Error('Recording association changed');
          const dispatched={...row,audioRequested:true as const};await changeAudioDeletion(row,false,dispatched);row=dispatched;
          if(await audioDeletionNoteState(row)!=='deleted')throw Error('Saved note changed before audio dispatch');
          if(!current.voiceNoteActive()||document.hidden)throw Error('Notes is no longer active');
          if(!retained.deletedAt)try{await noteAudio.remove({audioId:row.audioId,noteId:row.note.id,operationId:row.id});}catch{/* Readback only; never repeat a possibly completed trash operation. */}
          const result=await noteAudio.describe({audioId:row.audioId});
          if(result.noteId!==row.note.id||!result.deletedAt||await audioDeletionNoteState(row)!=='deleted')throw Error('Deletion unconfirmed');
          await deletionReceipt(row,'removed');
          if(permanent)await eraseForever(row);
          await changeAudioDeletion(row,false);
          if(active())current.set({open:null});
          window.dispatchEvent(new Event('alpha:notes-trash-changed'));
          if(permanent)current.toast(`${reviewed.title||'Voice note'} and its recording deleted forever`);
          else current.toast('Voice note moved to Trash', {undo:()=>void restoreDeletion(row!,current,index)});
        });} catch {current.toast(refusedFull?'Could not show the Trash choices. Nothing was deleted.':'Deletion is unconfirmed. Check deletion status; no deletion will be repeated.');}
        finally{
          deletionBusy=false;
          if(permanent){refusedVoice=null;current.set({trashBusy:false,trashFull:null});}
          void refreshDeletionStatus(current);
        }
  }
  /**
   * Backstop for a permanent voice deletion that process death interrupted (the row was written by
   * an earlier process, so none of its effects is in flight). Caller holds the deletion-effects
   * lock. Every input is read back from authoritative storage; the plan either finishes the
   * confirmed deletion for exactly this note and recording or returns to the state before it.
   * Anything else, and any step that cannot be confirmed, leaves the row under review.
   */
  async function settleInterruptedPermanentDeletion(row:AudioDeletion,current:Bag){
    const note=await audioDeletionNoteState(row);
    let recording:PermanentDeletionEvidence['recording']=null,receipt:PermanentDeletionEvidence['receipt']=null;
    try{
      const metadata=await noteAudio.describe({audioId:row.audioId});
      recording={ownedByNote:metadata.audioId===row.audioId&&metadata.noteId===row.note.id,inAudioTrash:!!metadata.deletedAt};
      const status=await noteAudio.deletionStatus({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
      if(status.audioId===row.audioId&&status.noteId===row.note.id&&status.operationId===row.id&&['unknown','removed','restored','purged'].includes(status.status))receipt=status.status as PermanentDeletionEvidence['receipt'];
    }catch{/* Unreadable recording state: the plan keeps the row under review. */}
    const referencedElsewhere=(await savedNotes()).some(n=>n.id!==row.note.id&&n.audio?.audioId===row.audioId);
    const step=planInterruptedPermanentDeletion({note,recording,receipt,referencedElsewhere});
    if(step==='review')return;
    if(step==='erase')await eraseForever(row);
    else if(step==='trash-then-erase'){
      // Same order as the uninterrupted deletion: dispatch mark, audio trash under this operation, erase.
      if(!row.audioRequested){const dispatched={...row,audioRequested:true as const};await changeAudioDeletion(row,false,dispatched);row=dispatched;}
      await noteAudio.remove({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
      const removed=await noteAudio.describe({audioId:row.audioId});
      if(removed.noteId!==row.note.id||!removed.deletedAt||await audioDeletionNoteState(row)!=='deleted')throw Error('Deletion unconfirmed');
      // eraseForever requires this operation's own receipt: `removed` (it then erases) or `purged`. The
      // Android native pass shares no lock with this one and may have finished the same operation meanwhile.
      await eraseForever(row);
    }else if(step==='restore-recording'){
      await noteAudio.restore({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
      await deletionReceipt(row,'restored');
      const restored=await noteAudio.describe({audioId:row.audioId});
      if(restored.deletedAt||restored.noteId!==row.note.id||await audioDeletionNoteState(row)!=='original')throw Error('Rollback unconfirmed');
    }else if(step==='delete-note'){
      // The recording is already erased under this operation; the tombstone is for the exact reviewed revision only.
      await current.commitAudioNoteDeletion(row,()=>{});
      if(await audioDeletionNoteState(row)!=='deleted')throw Error('Deletion unconfirmed');
    }
    await changeAudioDeletion(row,false);
    window.dispatchEvent(new Event('alpha:notes-trash-changed'));
  }
  /**
   * One pass at a time; a caller that arrives during a pass waits for that pass. Every caller first
   * shows the rows as they are now, without the lock, so a pass queued behind another view's
   * deletion never hides the review rows from a view that opens meanwhile.
   */
  function refreshDeletionStatus(current:Bag):Promise<void>{
    const running=deletionRefresh;
    if(running){
      void pendingAudioDeletions().then(rows=>{current.setView('notes',{audioDeletionPending:Object.values(rows),audioDeletionChecked:true});}).catch(()=>{/* The running pass reports the failure. */});
      return running;
    }
    return deletionRefresh=(async()=>{
    try{
      current.setView('notes',{audioDeletionPending:Object.values(await pendingAudioDeletions()),audioDeletionChecked:true});
      await withAudioDeletionLock(async()=>{const rows=Object.values(await pendingAudioDeletions());
      for(const row of rows){try{
        if(row.permanent&&!sessionDeletions.has(row.id)){await settleInterruptedPermanentDeletion(row,current);continue;}
        const metadata=await noteAudio.describe({audioId:row.audioId});
        if(metadata.audioId===row.audioId&&metadata.noteId===row.note.id&&metadata.deletedAt&&await audioDeletionNoteState(row)==='deleted'){
          // A permanent deletion this process started finishes its erase here; a Trash deletion only confirms its receipt.
          if(row.permanent)await eraseForever(row);else await deletionReceipt(row,'removed');
          await changeAudioDeletion(row,false);
        }
      }catch{/* Readback only. Preserve unknown operations. */}}
      current.setView('notes',{audioDeletionPending:Object.values(await pendingAudioDeletions()),audioDeletionChecked:true});
    });}catch{current.setView('notes',{audioDeletionRecoveryFailed:true,audioDeletionChecked:true});}finally{deletionRefresh=null;}
    })();
  }
  notes.render = (state: Bag, current: Bag) => {
    api = current;
    if(!state.audioDeletionChecked)void refreshDeletionStatus(current);
    const selected = (current.get('notes').list || []).find((n: Bag) => n.id === state.open);
    if (savedPlaying && selected?.audio?.audioId !== savedPlaying) stopSaved();
    const result = render({ ...state, record: false, rec: null, ...(selected?.audio ? { playing: false, pos: savedPosition / 1000 } : {}) }, current);
    result.audioDeletionPending=(state.audioDeletionPending||[]).map((row:AudioDeletion)=>({title:row.note.title||'Voice note',restore:()=>void restoreDeletion(row,current)}));
    result.audioDeletionUnknown=!!state.audioDeletionRecoveryFailed||result.audioDeletionPending.length>0;
    result.checkAudioDeletion=()=>void refreshDeletionStatus(current);
    for (const card of [...(result.colL || []), ...(result.colR || [])]) if ((current.get('notes').list || []).some((n: Bag) => n.id === card.id && n.audio)) card.bars = card.bars.map(() => 4);
    if (selected?.audio && result.vo) {
      const vo = result.vo;
      // A retained recording is not automatically summarized or scheduled.
      vo.ready=Array.isArray(selected.summary)&&selected.summary.length>0;vo.noSummary=false;
      vo.canReviewTranscript=!!String(selected.body||selected.audio.transcript||'').trim();
      vo.reviewTranscript=()=>{
        closeTranscriptQuestion?.();stopSaved();
        const snapshot=JSON.stringify(selected),active=()=>current.voiceNoteActive()&&current.isActive()&&!document.hidden&&!connectionController.getSnapshot().open&&current.get('notes').open===selected.id&&JSON.stringify(current.get('notes').list.find((n:Bag)=>n.id===selected.id))===snapshot;
        if(!active())return;
        closeTranscriptQuestion=reviewContentQuestion({name:selected.title||'Recording transcript',text:String(selected.body||selected.audio.transcript||''),question:'Summarize this meeting and list its action items. Do not change or schedule anything. Return JSON with exactly two fields: summary (a string) and actions (an array of short strings). Include only actions supported by this excerpt.',sourceLabel:'Offer to save the reviewed answer to this recording',sourceDescription:'You can then edit the summary and action items before saving them to this recording.',current:active,source:async()=>({kind:'recording',version:1,name:String(selected.title||'Recording transcript').slice(0,120),noteId:selected.id,revision:await recordingRevision(selected)}),compose:(text,source)=>current.composeContentQuestion(text,source),closed:()=>{closeTranscriptQuestion=undefined;}});
      };
      // Both hand-offs open a Calendar draft only. Nothing is written until the user saves there.
      // The draft carries a back-reference to this exact note (id, recording and reviewed revision).
      const draftFromNote=async(kind:'reminder'|'event')=>{
        if(noteHandoffBusy)return;
        const reviewed=()=>{const note=current.get('notes').list.find((n:Bag)=>n.id===selected.id);return current.isActive()&&!document.hidden&&current.get('notes').open===selected.id&&JSON.stringify(note)===JSON.stringify(selected)?note:null;};
        const note=reviewed();if(!note)return;
        const actionText=(note.actions||[]).filter((a:Bag)=>!a.done).map((a:Bag)=>String(a.t||'')).join('\n');
        if(!actionText.trim()){current.toast('No open action items. Review the transcript with Alpha first.');return;}
        if(actionText.length>4000){current.toast(kind==='event'?'Shorten the action items before creating an event. Nothing was added to your calendar.':'Shorten the action items before creating a reminder. Nothing scheduled.');return;}
        noteHandoffBusy=true;
        try{
          const origin=noteOriginFor(note,await recordingRevision(note));
          if(!reviewed())return;
          const shared={id:null,title:'',off:1,t:9,d:1,where:'',video:false,who:[],repeat:'none',notes:actionText,...(origin?{origin}:{})};
          current.open('calendar',{form:kind==='event'?{...shared,creationId:crypto.randomUUID(),separateCreation:false,cal:'native:local',alert:null}:{...shared,cal:'alpha-reminders',alert:0},open:null,month:null,day:1},'hidden');
          current.toast(kind==='event'?'Choose one action and review its time, then Save. Nothing is on your calendar yet.':'Choose one action and review its time, then Save. Nothing scheduled yet.');
        }finally{noteHandoffBusy=false;}
      };
      vo.toCal=()=>void draftFromNote('reminder');
      vo.calLabel='Review reminder draft';vo.calText='Review reminder';vo.calIcon=current.ic.cal;
      vo.toEvent=()=>void draftFromNote('event');
      vo.eventLabel='Review calendar event draft';vo.eventText='Review event';

      // A saved recording's reviewed transcript is read by the same qualified local speech route as text notes.
      const voText = noteSpeechText(selected), voReading = currentNoteReading()?.noteId === selected.id;
      vo.stopReading = voReading ? () => stopSpeaking() : undefined;
      vo.readAloud = voText && !voReading ? () => {
        stopSaved();
        void speakNote(voText, { noteId: selected.id }).then(outcome => {
          if (outcome === 'unavailable') current.toast('On-device speech is unavailable. The note is unchanged.');
          else if (outcome === 'unsupported') current.toast('This note has text that on-device speech cannot read. Nothing was read.');
          else if (outcome === 'failed') current.toast('Reading stopped before the end. The note is unchanged.');
        });
      } : undefined;
      vo.playLabel = savedPlaying ? 'Stop recording playback' : 'Play recording';
      vo.playIcon = savedPlaying ? current.ic.stop : current.ic.play;
      vo.play = () => { if (currentNoteReading()?.noteId === selected.id) stopSpeaking(); void playSaved(selected); };
      vo.lines = [{ ini: 'You', who: 'You', t: selected.body || selected.audio.transcript, at: '0:00', chip: 'background:var(--acc);color:#fff', css: '', seek: () => { void playSaved(selected); } }];
      vo.bars = vo.bars.map((bar: Bag) => ({ ...bar, h: 4 })); // No invented amplitude analysis.
      vo.share = () => current.toast('Audio stays in this app. Sharing recordings is not available yet.');
      const reviewed=structuredClone(selected);
      vo.del = () => { void deleteVoiceNote(current,reviewed,false); };

    }
    result.record = () => enter();
    if (result.ed) result.ed.dictate = () => {
      const n = (current.get('notes').list || []).find((item: Bag) => item.id === state.open);
      if (n?.kind === 'list') { current.toast('Convert this checklist to text before dictating.'); return; }
      if (!n) return;
      const body = n.body || '', editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]');
      const start = editor && editor.value === body ? editor.selectionStart : body.length;
      const end = editor && editor.value === body ? editor.selectionEnd : body.length;
      enter({ id: n.id, body, revision: JSON.stringify(n), start, end });
    };
    // Read aloud uses only the qualified local speech route. Closing, leaving or editing the note stops it.
    const readNote = (current.get('notes').list || []).find((item: Bag) => item.id === state.open);
    const readText = noteSpeechText(readNote), activeReading = currentNoteReading();
    // The read note was closed or changed. Stop after this render: stopping updates the view state.
    if (activeReading?.noteId && (!readNote || activeReading.noteId !== readNote.id || activeReading.text !== readText)) {
      const stale = activeReading;
      void Promise.resolve().then(() => { const now = currentNoteReading(); if (now && now.noteId === stale.noteId && now.text === stale.text) stopSpeaking(); });
    }
    if (result.ed) {
      const note = readNote, text = readText, mine = !!note && currentNoteReading()?.noteId === note.id;
      const ed = result.ed, onBody = ed.onBody, onTitle = ed.onTitle;
      const editing = (handler: unknown) => typeof handler === 'function' ? (...args: unknown[]) => { if (currentNoteReading()?.noteId === note?.id) stopSpeaking(); return (handler as (...a: unknown[]) => unknown)(...args); } : handler;
      ed.onBody = editing(onBody); ed.onTitle = editing(onTitle);
      const live = mine && currentNoteReading()?.noteId === note.id;
      ed.reading = live; ed.readAvailable = !!note && !!text;
      ed.readLabel = live ? 'Stop reading' : 'Read aloud';
      ed.stopReading = () => stopSpeaking();
      ed.readAloud = () => {
        if (!note || !text) return;
        if (currentNoteReading()?.noteId === note.id) { stopSpeaking(); return; }
        void speakNote(text, { noteId: note.id }).then(outcome => {
          if (outcome === 'unavailable') current.toast('On-device speech is unavailable. The note is unchanged.');
          else if (outcome === 'unsupported') current.toast('This note has text that on-device speech cannot read. Nothing was read.');
          else if (outcome === 'failed') current.toast('Reading stopped before the end. The note is unchanged.');
        });
      };
    }
    if (stage === 'closed'||chatDestination) return result;
    result.recording=true;result.rec=recorderView(current.ic);return result;
  };
  function recorderView(icons:Bag){
    const token=generation,chat=chatDestination;
    const owned=()=>token===generation&&chatDestination===chat&&(!chat||chatCurrent());
    const seconds = stage === 'recording' ? (Date.now() - started) / 1000 : (clip?.durationMs || 0) / 1000;
    const labels: Bag = { ready: 'Start recording', starting: 'Starting microphone', recording: 'Stop recording', recorded: onDeviceReady ? 'Transcribe on this phone' : pairedAsrReady ? 'Transcribe with agent Whisper' : deviceOnly ? 'Review recording' : cloudMode ? 'Transcribe with Eliza Cloud' : 'Transcribe locally', transcribing: 'Cancel transcription', review: chatDestination ? 'Use in conversation' : destination ? 'Apply transcript' : 'Save note' };
    const messages: Bag = { ready: deviceOnly ? 'Record up to 59 seconds in this app. You can add a transcript manually and save without signing in. Nothing is uploaded.' : cloudMode ? 'Record up to 59 seconds. Audio stays in this app until you choose Transcribe with Eliza Cloud.' : 'Development voice: record up to 59 seconds. Audio goes to this computer only after you choose Transcribe locally.', starting: 'Waiting for microphone access.', recording: 'Recording. Waveform levels are unavailable. Stop does not upload audio.', recorded: deviceOnly ? 'Microphone is off. Review the recording and enter a transcript manually. Cloud transcription is not connected; nothing is uploaded.' : cloudMode ? 'Microphone is off. Choose Transcribe with Eliza Cloud to upload this recording to your selected Cloud account.' : 'Microphone is off. Choose Transcribe locally to process this clip on the connected development computer.', transcribing: cloudMode ? 'Transcribing with Eliza Cloud. Nothing has been saved.' : 'Transcribing on the local computer. Nothing has been saved.', review: deviceOnly ? 'Enter a transcript manually, then save it with this recording in this app. Nothing is uploaded or sent to an agent.' : chatDestination ? 'Review the transcript, then use it in the conversation. Press Send there to send it to your agent.' : 'Review and edit the transcript, then save the recording and transcript in this app. Nothing is sent to the agent.' };
    if (pairedAsrReady) { messages.ready = 'Record up to 59 seconds. English transcription uses your selected agent. Audio stays in this app until you choose Transcribe with agent Whisper.'; messages.recorded = 'Microphone is off. Transcribe with agent Whisper uploads this recording to your selected agent for English speech recognition.'; messages.transcribing = 'Transcribing with your selected agent. Nothing has been saved.'; messages.review = chatDestination ? 'Review the agent transcript, then use it in the conversation. Press Send there to send the message.' : 'Review and edit the agent transcript, then save it with the recording in this app. Nothing is sent as a chat message.'; }
    if (onDeviceReady) {
      messages.ready = 'Record up to 29 seconds. English transcription runs on this phone. Nothing is uploaded.';
      messages.recorded = 'Microphone is off. Transcribe on this phone processes this recording without uploading audio.';
      messages.transcribing = 'Transcribing on this phone. Nothing has been saved or uploaded.';
      messages.review = chatDestination ? 'Review the transcript, then use it in the conversation. Press Send there to send it to your agent.' : 'Review and edit the transcript, then save it in this app. Nothing is uploaded.';
      if (stage === 'review') messages.review += ' Listen also runs on this phone. Unfamiliar English names are spelled; numbers are read digit by digit. Unsupported symbols require editing.';
    }
    if (destination) messages.review = 'Review the transcript, then insert it at your saved selection. This keeps your text note; the recording is discarded after applying. ' + (onDeviceReady ? 'Nothing was uploaded.' : cloudMode ? 'Eliza Cloud processed the audio. No chat message was sent.' : pairedAsrReady ? 'Your selected agent processed the audio. No chat message was sent.' : 'No chat message was sent.');
    if (pairedReady && stage === 'review' && !destination) messages.review = playing ? 'Playing selected-agent audio. Tap Stop audio to stop. Your recording remains in this app.' : 'Save keeps this recording and transcript in this app. Listen to transcript sends only this text to your selected agent for audio playback.';
    if (cloudMode && stage === 'review') messages.review += playing ? ' Playing Cloud audio. Tap Stop audio to stop.' : ' Listen to transcript sends this text to Eliza Cloud for audio playback.';
    if (selectedRoute === 'device' && !onDeviceReady && !preparingLocal && stage === 'ready') labels.ready = 'On-device speech unavailable';
    if (preparingPaired && stage === 'ready') { labels.ready = 'Checking selected agent voice'; messages.ready = 'Checking transcription and playback on your selected agent. No audio is uploaded.'; }
    if (preparingLocal && stage === 'ready') { labels.ready = 'Preparing on-device speech'; messages.ready = 'Loading and checking speech models on this phone. Nothing is uploaded.'; }
    if(!Capacitor.isNativePlatform() && !cloudMode) {
      if (onDeviceReady) {
        // Whisper tiny.en runs in this browser; English only, matching the OCR language policy.
        labels.recorded='Transcribe on this device';
        messages.ready='Record up to 29 seconds. English-only speech recognition runs on this device; audio is not uploaded. The first transcription loads a speech model of about 56 MB from this app.';
        messages.recording='Recording. Stop does not transcribe or upload audio.';
        messages.recorded='Microphone is off. Transcribe on this device turns this recording into English text. Nothing is uploaded.';
        messages.transcribing=speechProgressMessage(progress);
        if(!destination)messages.review=chatDestination?'Review and edit the transcript, then use it in the conversation. Press Send there to send it to your agent.':'Review and edit the transcript, then save the recording and transcript in this app. Nothing is uploaded or sent to an agent.';
      } else {
        labels.recorded='Review transcript';
        messages.recording='Recording. Stop to review the audio.';
        messages.ready='Record audio in this app. You can add a transcript manually and save without signing in.';
        messages.recorded='Microphone is off. Enter the transcript to save with this recording.';
        messages.transcribing='Review the recording transcript.';
        if(!destination)messages.review='Edit the transcript, listen, or save the recording in this app.';
      }
    }
    if(browserDevProfile && selectedRoute==='agent' && !cloudMode){messages.ready='Preview voice records, transcribes English and plays audio on this device.';messages.recorded='Transcribe this recording on this device. Nothing is uploaded.';labels.recorded='Transcribe on this device';}
    if(onDeviceReady&&connectionController.getBrowserSpeechAgent()){
      labels.recorded='Transcribe on this computer';
      messages.ready='Record in this app. English transcription runs on the local agent on this computer when you choose Transcribe.';
      messages.recorded='Microphone is off. Transcribe on this computer sends this recording to your local development agent.';
      messages.transcribing='Transcribing on this computer. Nothing has been saved.';
      messages.review='Review the transcript, listen using the local agent on this computer, or save it with the recording. No chat message has been sent.';
    }
    const canType = stage === 'recorded' && !!clip && !busy && (failure === 'no-speech' || failure === 'model' || failure === 'recognition');
    // A refused microphone uses the route slot for its recovery: Android's app settings for Alpha.
    const settingsChoice = deniedSettingsChoice({ failure, stage, busy, native: Capacitor.isNativePlatform() });
    const openSettings = () => { void appSettings.openSettings({ page: 'privacy' }).catch(() => api?.toast('Android app settings are unavailable. Allow the microphone for Alpha in Settings, then try again.')); };
    return {
      state: failure || stage,
      typeChoice: canType,
      typeInstead: () => { if (!owned()||stage !== 'recorded' || !clip || busy) return; draft = ''; recognized = undefined; error = ''; failure = ''; stage = 'review'; refresh(); },
      manualChoice: !cloudMode && stage === 'ready' && !busy && !preparingLocal && selectedRoute !== 'manual',
      recordOnly: () => { if(!owned())return;const target = destination, chat = chatDestination; enter(target, undefined, 'manual',chat); refresh(); },
      routeChoice: settingsChoice || !cloudMode && stage === 'ready' && !busy && document.documentElement.dataset.connectionMode !== 'mock' && (!!connectionController.getPairedVoiceBinding() || connectionController.getCloudEnvironment() !== null),
      routeLabel: settingsChoice ? DENIED_SETTINGS_LABEL : browserDevProfile ? (selectedRoute === 'device' ? 'Use development voice' : 'Use browser voice') : selectedRoute === 'device' ? (connectionController.getCloudEnvironment() !== null ? 'Use Eliza Cloud voice' : 'Use selected agent voice') : 'Use on-device voice',
      changeRoute: () => { if (!owned()||stage !== 'ready' || busy) return; if (settingsChoice) { openSettings(); return; } const target = destination, chat = chatDestination; enter(target, undefined, selectedRoute === 'device' ? 'agent' : 'device',chat); refresh(); },
      clock: `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`, clockCss: '', live: stage === 'recording', paused: stage !== 'recording', dotCss: `background:${stage === 'recording' ? '#E53935' : 'var(--mut)'}`,
      levels: !Capacitor.isNativePlatform()&&stage==='recording'?recordingLevels(recordingId):Array.from({ length: 44 }, () => ({ h: 4 })),
      lines: [{ ini: '', statusIcon:icons.info, t: error || messages[stage], chip: 'background:var(--s2);color:var(--fg)', css: '' }],
      review: stage === 'review', transcript: draft, transcriptDisabled: busy, onTranscript: (e: Event) => { if (!owned()||busy) return; draft = (e.target as HTMLTextAreaElement).value; refresh(); },
      primaryLabel: cloudConnectRequired ? 'Connect Eliza Cloud' : labels[stage], primaryIcon: cloudConnectRequired ? icons.user : stage === 'review' ? icons.check : stage === 'recording' || stage === 'transcribing' ? icons.stop : icons.mic,
      primaryDisabled: (selectedRoute === 'device' && !onDeviceReady) || preparingLocal || preparingPaired || stage === 'starting' || (busy && stage !== 'transcribing') || (stage === 'review' && !draft.trim()),
      pauseLabel: (onDeviceReady || cloudMode || pairedReady) && stage === 'review' ? playing ? 'Stop audio' : 'Listen to transcript' : ['recorded', 'review'].includes(stage) ? 'Record again' : 'Cancel recording', pauseIcon: (onDeviceReady || cloudMode || pairedReady) && stage === 'review' ? playing ? icons.stop : icons.play : ['recorded', 'review'].includes(stage) ? icons.mic : icons.x,
      stop: () => { if(owned())void primary(); }, discard: () => {if(owned())chatDestination?cancelChat():cleanup();}, keyboard:()=>{if(owned())cancelChat(true);}, toggle: () => { if(!owned())return;if ((onDeviceReady || cloudMode || pairedReady) && stage === 'review') { void listen(); } else if (['recorded', 'review'].includes(stage)) { const target = destination, chat = chatDestination; enter(target, undefined, selectedRoute,chat); } else if(chatDestination)cancelChat();else cleanup(); },
    };
  }
  const originalVals=Component.prototype.renderVals;
  Component.prototype.renderVals=function(){
    const out=originalVals.call(this),retiring=retirement?.shell===this,active=retiring||chatDestination?.shell===this&&stage!=='closed'&&chatCurrent();
    const heldRetirement=retirement,hold=(cancelApproval=true)=>{if(!heldRetirement||retirement!==heldRetirement||heldRetirement.shell!==this)return;if(cancelApproval&&heldRetirement.approval&&this.pendingActionApproval===heldRetirement.approval){heldRetirement.approval.abort();if(heldRetirement.proposalId)this.cancelReadReplyCompletions?.(heldRetirement.proposalId);}this.toast('Voice media is still stopping. Close the app if it cannot finish.');};
    const awaiting=active&&!retiring&&(conversationState.phase==='awaiting-user-input'||conversationReviewRequired);
    out.chatRecorder=retiring?{state:retirement!.phase,flex:'1',clockSize:48,clock:'Voice',live:false,levels:[],lines:[{t:retirement!.phase==='error'?'Could not confirm voice media stopped. Close the app before starting voice again.':'Stopping the microphone and audio…'}],review:false,typeChoice:false,primaryLabel:'Stop voice conversation',primaryIcon:out.ic?.stop,primaryDisabled:false,stop:()=>hold(),discard:()=>hold(),keyboard:()=>{if(retirement&&retirement.shell===this){retirement.returnChat='input';hold(false);}}}:active?{...conversationRecorderView(out.ic||{}),awaiting}:null;out.showChatHistory=!active||awaiting;out.chatHistoryInert=active&&!awaiting;out.chatVoiceActive=active;out.chatHistoryStyle=active&&!awaiting?'display:none':'';
    if(retiring){out.conversationHidden=false;out.panelOp=1;out.panelPE='auto';if(!out.panelH)out.panelH=560;}
    if(active){
      out.panelComposer=false;out.showSugg=false;out.showComposer=false;out.showPill=false;out.canStopReply=false;
      out.closeChat=()=>retiring?hold():cancelChat();
    }
    return out;
  };
  const updated=Component.prototype.componentDidUpdate;
  Component.prototype.componentDidUpdate=function(...args:any[]){
    updated?.apply(this,args);
    if(chatDestination?.shell===this){if(!chatCurrent()||!['sheet','full'].includes(this.S().chat))cleanup();else conversationVoice?.recheck();}
  };
  const immersive = notes.immersive;
  notes.immersive = (state: Bag, current: Bag) => stage !== 'closed'&&!chatDestination ? { noPill: true } : immersive?.(state, current);
  notes.back = (state: Bag, current: Bag) => { if (stage !== 'closed'&&!chatDestination) { cleanup(); return true; } return back?.(state, current); };
  const noteReadingChanged=()=>{if(api)api.setView('notes',{noteReadingRevision:Date.now()});};
  window.addEventListener('alpha:note-reading',noteReadingChanged);
  notes.onLeave = (current: Bag) => { closeTranscriptQuestion?.();stopSpeaking();if(!ownedNavigation?.applying)cleanup(); leave?.(current); };
  const visibility = () => {
    // Speech preparation is foreground-only; returning prepares the same route again.
    if (!document.hidden) { if (reprepare && stage === 'ready' && !busy) { reprepare = false; reopen(error); } return; }
    stopSaved();
    if (playing) { playback?.abort(); playing = false; refresh(); }
    if(chatDestination){cleanup();return;}
    if (['recording', 'transcribing'].includes(stage)) { cleanup(false); stage = 'ready'; error = 'Voice stopped when the app left the foreground. Record again to continue.'; reprepare = true; refresh(); }
  };
  const pagehide = () => { if (stage !== 'closed') cleanup(); };
  const binding = composerBinding;
  let account = binding();
  const unsubscribe = connectionController.subscribe(() => {
    const next = binding();
    if (connectionController.getSnapshot().open) { closeTranscriptQuestion?.(); if (stage !== 'closed') cleanup(); }
    if (next !== account) { closeTranscriptQuestion?.(); account = next; stopSaved(); if (stage !== 'closed') cleanup(); }
  });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  const unmount = Component.prototype.componentWillUnmount;
  Component.prototype.componentWillUnmount = function () { window.removeEventListener('alpha:note-reading',noteReadingChanged);stopSpeaking();api = undefined; chatDestination=undefined;cleanup(); unsubscribe(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); unmount?.call(this); };
}
