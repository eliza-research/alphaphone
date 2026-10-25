import {recordingLevels} from '../browser/audio-levels';
import {browserDevProfile} from '../browser/dev-profile';
import {pendingAudioDeletions,withAudioDeletionLock,changeAudioDeletion,audioDeletionNoteState,type AudioDeletion} from '../runtime/note-audio-deletions';
import { installLocalSpeechPlayback, stopLocalSpeechPlayback } from './local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { createOnDeviceVoice } from '../runtime/local-voice';
import { createPairedVoice } from '../runtime/paired-voice';
import { createCloudVoice } from '../runtime/cloud-voice';
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
}>('AlphaNoteAudio');

/** Real voice state presented in the prototype Notes recording canvas. */
export function installPrototypeVoiceAdapter(Component: any, views: Record<string, Bag>) {
  installLocalSpeechPlayback(Component);
  const notes = views.notes, render = notes.render, back = notes.back, leave = notes.onLeave;
  const originalApi = Component.prototype.api;
  Component.prototype.api = function (key: string) {
    const value = originalApi.call(this, key);
    // The prototype setView callback discards vset's persistence receipt.
    if (key === 'notes') {
      value.voiceNoteActive=()=>this.live&&this.S().view==='notes';
      value.saveVoiceNote = async (patch: Bag) => await this.vset('notes', patch) === true;
      value.reviewAudioDeletion=async(note:Bag)=>{
        if(!this.live||this.notesStorageFailed||this.notesPending||!this.notesStore)throw Error('Notes needs recovery');
        const target=await this.notesStore.target(note.id);
        if(JSON.stringify(this.notesStore.list.find((n:Bag)=>n.id===note.id))!==JSON.stringify(note))throw Error('Note changed');
        return target;
      };
      value.commitAudioNoteDeletion=async(row:AudioDeletion,authorized:()=>void)=>{
        if(this.notesStorageFailed||this.notesPending)throw Error('Notes needs recovery');
        await this.notesStore.execute({type:'notes_delete',target:row.target},row.id,new AbortController().signal,authorized);
        window.dispatchEvent(new Event('alpha:notes-committed'));
      };
    }
    return value;
  };
  let deletionBusy=false,deletionRefresh=false;
  let api: Bag | undefined, stage = 'closed', generation = 0, busy = false;
  let clip: Clip | undefined, recordingId: string | undefined, started = 0;
  let error = '', draft = '', requestId: string | undefined, saveId = '';
  let savedPlaying: string | undefined, savedPosition = 0, savedEpoch = 0, savedTick: ReturnType<typeof setInterval> | undefined;
  const stopSaved = () => { const owned = savedPlaying !== undefined; ++savedEpoch; savedPlaying = undefined; savedPosition = 0; if (savedTick) clearInterval(savedTick); savedTick = undefined; if (owned) void noteAudio.stop().catch(() => {}); };
  async function playSaved(note: Bag) {
    if (savedPlaying === note.audio.audioId) { stopSaved(); refresh(); return; }
    stopSaved(); const epoch = savedEpoch; savedPlaying = note.audio.audioId; refresh();
    try {
      await noteAudio.play({ audioId: note.audio.audioId });
      if (epoch !== savedEpoch) return;
      savedTick = setInterval(() => { void noteAudio.state().then(value => { if (epoch !== savedEpoch) return; if (!value.playing || value.audioId !== savedPlaying) { stopSaved(); refresh(); return; } savedPosition = value.positionMs; refresh(); }).catch(() => { if (epoch === savedEpoch) { stopSaved(); refresh(); } }); }, 250);
    } catch { if (epoch === savedEpoch) { stopSaved(); api?.toast('This saved recording could not be played. The transcript is still available.'); refresh(); } }
  }
  type DictationTarget = { id: string; body: string; revision: string; start: number; end: number };
  let destination: DictationTarget | undefined;
  let listener: PluginListenerHandle | undefined, tick: ReturnType<typeof setInterval> | undefined;
  let stopping = Promise.resolve();
  type Driver = typeof voice | ReturnType<typeof createCloudVoice>;
  let driver: Driver = voice, cloudMode = false, deviceOnly = false;
  let pairedVoice: ReturnType<typeof createPairedVoice> = null, pairedReady = false, pairedAsrReady = false;
  let selectedRoute: 'device' | 'agent' | 'manual' = 'device', preparingPaired = false;
  let onDeviceVoice: ReturnType<typeof createOnDeviceVoice> = null, onDeviceReady = false, preparingLocal = false;
  let transcription: AbortController | undefined;
  let readiness: AbortController | undefined;
  let playback: AbortController | undefined, playing = false;
  let chatDestination: { shell: any; view: string | null } | undefined;
  const refresh = () => api?.setView('notes', { nativeVoiceRevision: Date.now() });
  const stopClock = () => { if (tick) clearInterval(tick); tick = undefined; };
  function cleanup(close = true) {
    ++generation; readiness?.abort(); readiness = undefined; transcription?.abort(); transcription = undefined; pairedVoice = null; onDeviceVoice = null; onDeviceReady = false; preparingLocal = false; preparingPaired = false; pairedReady = false; pairedAsrReady = false; busy = false; stopClock(); stopSaved();
    if (requestId) void driver.cancel({ requestId }).catch(() => {});
    playback?.abort(); playback = undefined; playing = false;
    requestId = undefined;
    if (listener) void listener.remove(); listener = undefined;
    const previous = driver;
    stopping = stopping.then(async () => { try { await previous.cancelRecording(); } catch {} });
    clip = undefined; recordingId = undefined;
    if (close) { stage = 'closed'; draft = ''; destination = undefined; chatDestination = undefined; }
    refresh();
  }
  function enter(target?: DictationTarget, preparedLocal?: ReturnType<typeof createOnDeviceVoice>, route: 'device' | 'agent' | 'manual' = 'device') {
    stopLocalSpeechPlayback(); cleanup(); destination = target; saveId = target?.id || crypto.randomUUID(); stage = 'ready'; error = ''; draft = ''; selectedRoute = route;
    cloudMode = !browserDevProfile && connectionController.getCloudEnvironment() !== null;
    deviceOnly = browserDevProfile || !cloudMode && (localStorage.getItem('alpha.connection.selection.v1') !== null || !Capacitor.isPluginAvailable('DevelopmentAgent'));
    driver = cloudMode ? createCloudVoice() : deviceOnly ? deviceVoice : voice;
    onDeviceVoice = route === 'device' || browserDevProfile && route === 'agent' ? preparedLocal || createOnDeviceVoice() : null;
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
  async function act(task: (token: number) => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; const token = generation; refresh();
    try { await task(token); }
    catch { if (token === generation) { error = onDeviceReady ? 'On-device speech unavailable. Keep recordings under 30 seconds and use English text under 500 characters for playback. Your recording is retained.' : pairedAsrReady ? 'Agent Whisper transcription unavailable. Your recording is retained; check the selected agent and retry explicitly.' : deviceOnly ? 'Recording unavailable. Check microphone access and available device storage, then retry.' : cloudMode ? 'Cloud voice unavailable. Check microphone access, your Cloud account and the connection, then retry.' : 'Voice unavailable. Check microphone access and the local development service, then retry.'; stage = stage === 'review' ? 'review' : clip ? 'recorded' : 'ready'; stopClock(); } }
    finally { if (token === generation) { busy = false; refresh(); } }
  }
  async function start(token: number) {
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
    const result = onDeviceReady ? await deviceVoice.startRecording({ maxDurationMs: 29000 }) : await driver.startRecording();
    if (token !== generation) return;
    recordingId = result.recordingId;
    if (stage === 'recorded') return; // Automatic-stop event can race promise delivery.
    started = Date.now(); stage = 'recording'; tick = setInterval(refresh, 250); refresh();
  }
  async function primary() {
    if (stage === 'transcribing') { cleanup(false); stage = 'ready'; error = 'Transcription cancelled. Record again to continue.'; refresh(); return; }
    if (stage === 'review') {
      if (!api || !draft.trim()) return;
      if (chatDestination) {
        const { shell, view } = chatDestination, text = draft;
        cleanup();
        if (view) shell.openView(view); else shell.goHome();
        shell.setState({ chat: 'sheet', draft: text, voice: 'off' });
        return;
      }
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
        const note = { ...(target || {}), id, kind: 'voice', title: target?.title || 'Voice note', body: text, audio, dur: audio.durationMs / 1000, summary: [], actions: [], lines: [{ s: 'me', at: 0, t: text }], pinned: target?.pinned || false, when: 'Now' };
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
        stage = 'transcribing'; requestId = crypto.randomUUID(); refresh();
        transcription = new AbortController();
        const result = onDeviceReady && onDeviceVoice ? await onDeviceVoice.transcribe(clip.recordingId, transcription.signal) : pairedAsrReady && pairedVoice ? await pairedVoice.transcribe(clip.recordingId, transcription.signal) : await driver.transcribeRecording({ recordingId: clip.recordingId, requestId });
        transcription = undefined;
        if (token !== generation) return;
        requestId = undefined;
        if (typeof result.text !== 'string' || !result.text.trim() || result.local !== !cloudMode) throw new Error('Invalid transcript');
        draft = result.text; stage = 'review';
      }
    });
  }
  async function listen() {
    if (playing) { playback?.abort(); return; }
    const speaker = onDeviceReady ? onDeviceVoice : cloudMode && 'speak' in driver ? driver : pairedReady ? pairedVoice : null;
    if (!speaker || !draft.trim()) return;
    const token = generation, controller = new AbortController();
    playback = controller; playing = true; error = ''; refresh();
    try { await speaker.speak(draft, controller.signal); }
    catch { if (token === generation && !controller.signal.aborted) error = 'Audio could not be played by the selected voice service. Your transcript is still available.'; }
    finally { if (token === generation) { playback = undefined; playing = false; refresh(); } }
  }
  const originalStartVoice = Component.prototype.startVoice;
  let composerProbe = 0;
  const composerBinding = () => JSON.stringify([
    connectionController.getSnapshot().session?.sessionId,
    connectionController.getCloudClient()?.sessionId,
    connectionController.getCloudClient()?.credentialId,
    connectionController.getCloudEnvironment(),
    document.documentElement.dataset.connectionMode,
  ]);
  // A navigation away and back still retires preparation for the original screen.
  for (const method of ['openView', 'goHome', 'back']) {
    const original = Component.prototype[method];
    if (typeof original === 'function') Component.prototype[method] = function (...args: any[]) {
      ++composerProbe; return original.apply(this, args);
    };
  }
  Component.prototype.startVoice = async function (...args: any[]) {
    const probe = ++composerProbe, view = this.S().view || null, selected = composerBinding();
    const current = () => probe === composerProbe && selected === composerBinding()
      && (this.S().view || null) === view && this.live !== false
      && !document.hidden && !connectionController.getSnapshot().open;
    if (!current()) return;
    const local = createOnDeviceVoice();
    if (local) {
      try {
        this.toast('Preparing on-device speech.');
        const ready = await local.ready(new AbortController().signal);
        if (!current()) return;
        if (ready) { this.openView('notes'); enter(undefined, local); onDeviceVoice = local; onDeviceReady = true; cloudMode = false; deviceOnly = true; driver = deviceVoice; chatDestination = { shell: this, view }; refresh(); return; }
      } catch { /* Only the still-owned request may offer its fallback. */ }
    }
    if (!current()) return;
    if (connectionController.getCloudEnvironment() === null) {
      const paired = createPairedVoice();
      if (paired) {
        try {
          const ready = await paired.transcriptionReady(new AbortController().signal);
          if (!current()) return;
          if (!ready) { this.toast('Standalone Whisper transcription is unavailable on this agent. Use the keyboard or record a note with a manual transcript.'); return; }
          this.openView('notes'); enter(); pairedAsrReady = true; chatDestination = { shell: this, view }; refresh(); return;
        } catch { if (current()) this.toast('Agent transcription is unavailable. Check this connection or use the keyboard.'); return; }
      }
      if (localStorage.getItem('alpha.connection.selection.v1') !== null) { this.toast('Sign in to Alpha Phone to use voice with this agent, or use the keyboard.'); return; }
      return originalStartVoice?.apply(this, args);
    }
    this.openView('notes'); enter(); chatDestination = { shell: this, view }; refresh();
  };
  async function deletionReceipt(row:AudioDeletion,status:'removed'|'restored'){
    const result=await noteAudio.deletionStatus({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
    if(result.audioId!==row.audioId||result.noteId!==row.note.id||result.operationId!==row.id||result.status!==status)throw Error('Audio operation unconfirmed');
  }
  async function restoreDeletion(row:AudioDeletion,current:Bag){
    if(deletionBusy)return;deletionBusy=true;
    try{await withAudioDeletionLock(async()=>{
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
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
        if(list.some((n:Bag)=>n.id===row.note.id)||await current.saveVoiceNote({list:[row.note,...list]})!==true)throw Error('Restore unconfirmed');
      }
      if((await pendingAudioDeletions())[row.id])await changeAudioDeletion(row,false);
      current.toast('Voice note restored.');
    });}catch{current.toast('Restore is unconfirmed. Reopen Notes and check deletion status. No newer note was replaced.');}
    finally{deletionBusy=false;void refreshDeletionStatus(current);}
  }
  async function refreshDeletionStatus(current:Bag){
    if(deletionRefresh)return;deletionRefresh=true;
    try{
      current.setView('notes',{audioDeletionPending:Object.values(await pendingAudioDeletions()),audioDeletionChecked:true});
      await withAudioDeletionLock(async()=>{const rows=Object.values(await pendingAudioDeletions());
      for(const row of rows){try{
        const metadata=await noteAudio.describe({audioId:row.audioId});
        if(metadata.audioId===row.audioId&&metadata.noteId===row.note.id&&metadata.deletedAt&&await audioDeletionNoteState(row)==='deleted'){await deletionReceipt(row,'removed');await changeAudioDeletion(row,false);}
      }catch{/* Readback only. Preserve unknown operations. */}}
      current.setView('notes',{audioDeletionPending:Object.values(await pendingAudioDeletions()),audioDeletionChecked:true});
    });}catch{current.setView('notes',{audioDeletionRecoveryFailed:true,audioDeletionChecked:true});}finally{deletionRefresh=false;}
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
      vo.playLabel = savedPlaying ? 'Stop recording playback' : 'Play recording';
      vo.playIcon = savedPlaying ? current.ic.stop : current.ic.play;
      vo.play = () => { void playSaved(selected); };
      vo.lines = [{ ini: 'You', who: 'You', t: selected.body || selected.audio.transcript, at: '0:00', chip: 'background:var(--acc);color:#fff', css: '', seek: () => { void playSaved(selected); } }];
      vo.bars = vo.bars.map((bar: Bag) => ({ ...bar, h: 4 })); // No invented amplitude analysis.
      vo.share = () => current.toast('Audio stays on this phone. Sharing recordings is not available yet.');
      const reviewed=structuredClone(selected);
      vo.del = () => { void (async () => {
        if(deletionBusy)return;deletionBusy=true;stopSaved();
        let row:AudioDeletion|undefined;
        const active=()=>current.voiceNoteActive()&&current.isActive()&&!document.hidden&&current.get('notes').open===reviewed.id;
        try {await withAudioDeletionLock(async()=>{
          if(!active())return;
          const prior=Object.values(await pendingAudioDeletions()).find(x=>x.note.id===reviewed.id);
          if(prior){current.toast('Deletion remains unconfirmed. Check deletion status; it will not be repeated.');return;}
          const target=await current.reviewAudioDeletion(reviewed);
          if(!active())return;
          const metadata=await noteAudio.describe({audioId:reviewed.audio.audioId});
          if(metadata.noteId!==reviewed.id||metadata.audioId!==reviewed.audio.audioId||metadata.deletedAt)throw Error('Recording association changed');
          if(!active())return;
          row={id:crypto.randomUUID(),target,note:reviewed,audioId:reviewed.audio.audioId};
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
          await changeAudioDeletion(row,false);
          if(active())current.set({open:null});
          current.toast('Voice note deleted', {undo:()=>void restoreDeletion(row!,current)});
        });} catch {current.toast('Deletion is unconfirmed. Check deletion status; no deletion will be repeated.');}
        finally{deletionBusy=false;void refreshDeletionStatus(current);}
      })(); };

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
    if (stage === 'closed') return result;
    const seconds = stage === 'recording' ? (Date.now() - started) / 1000 : (clip?.durationMs || 0) / 1000;
    const labels: Bag = { ready: 'Start recording', starting: 'Starting microphone', recording: 'Stop recording', recorded: onDeviceReady ? 'Transcribe on this phone' : pairedAsrReady ? 'Transcribe with agent Whisper' : deviceOnly ? 'Review recording' : cloudMode ? 'Transcribe with Eliza Cloud' : 'Transcribe locally', transcribing: 'Cancel transcription', review: chatDestination ? 'Use in conversation' : destination ? 'Apply transcript' : 'Save note' };
    const messages: Bag = { ready: deviceOnly ? 'Record up to 59 seconds on this phone. You can add a transcript manually and save without signing in. Nothing is uploaded.' : cloudMode ? 'Record up to 59 seconds. Audio stays on this phone until you choose Transcribe with Eliza Cloud.' : 'Development voice: record up to 59 seconds. Audio goes to this computer only after you choose Transcribe locally.', starting: 'Waiting for microphone access.', recording: 'Recording. Waveform levels are unavailable. Stop does not upload audio.', recorded: deviceOnly ? 'Microphone is off. Review the recording and enter a transcript manually. Cloud transcription is not connected; nothing is uploaded.' : cloudMode ? 'Microphone is off. Choose Transcribe with Eliza Cloud to upload this recording to your selected Cloud account.' : 'Microphone is off. Choose Transcribe locally to process this clip on the connected development computer.', transcribing: cloudMode ? 'Transcribing with Eliza Cloud. Nothing has been saved.' : 'Transcribing on the local computer. Nothing has been saved.', review: deviceOnly ? 'Enter a transcript manually, then save it with this recording on the phone. Nothing is uploaded or sent to an agent.' : chatDestination ? 'Review the transcript, then use it in the conversation. Press Send there to send it to your agent.' : 'Review and edit the transcript, then save the recording and transcript on this phone. Nothing is sent to the agent.' };
    if (pairedAsrReady) { messages.ready = 'Record up to 59 seconds. English transcription uses your selected agent. Audio stays on this phone until you choose Transcribe with agent Whisper.'; messages.recorded = 'Microphone is off. Transcribe with agent Whisper uploads this recording to your selected agent for English speech recognition.'; messages.transcribing = 'Transcribing with your selected agent. Nothing has been saved.'; messages.review = chatDestination ? 'Review the agent transcript, then use it in the conversation. Press Send there to send the message.' : 'Review and edit the agent transcript, then save it with the recording on this phone. Nothing is sent as a chat message.'; }
    if (onDeviceReady) {
      messages.ready = 'Record up to 29 seconds. English transcription runs on this phone. Nothing is uploaded.';
      messages.recorded = 'Microphone is off. Transcribe on this phone processes this recording without uploading audio.';
      messages.transcribing = 'Transcribing on this phone. Nothing has been saved or uploaded.';
      messages.review = chatDestination ? 'Review the transcript, then use it in the conversation. Press Send there to send it to your agent.' : 'Review and edit the transcript, then save it on this phone. Nothing is uploaded.';
      if (stage === 'review') messages.review += ' Listen also runs on this phone. Unfamiliar English names are spelled; numbers are read digit by digit. Unsupported symbols require editing.';
    }
    if (destination) messages.review = 'Review the transcript, then insert it at your saved selection. This keeps your text note; the recording is discarded after applying. ' + (onDeviceReady ? 'Nothing was uploaded.' : cloudMode ? 'Eliza Cloud processed the audio. No chat message was sent.' : pairedAsrReady ? 'Your selected agent processed the audio. No chat message was sent.' : 'No chat message was sent.');
    if (pairedReady && stage === 'review' && !destination) messages.review = playing ? 'Playing selected-agent audio. Tap Stop audio to stop. Your recording remains on this phone.' : 'Save keeps this recording and transcript on the phone. Listen to transcript sends only this text to your selected agent for audio playback.';
    if (cloudMode && stage === 'review') messages.review += playing ? ' Playing Cloud audio. Tap Stop audio to stop.' : ' Listen to transcript sends this text to Eliza Cloud for audio playback.';
    if (selectedRoute === 'device' && !onDeviceReady && !preparingLocal && stage === 'ready') labels.ready = 'On-device speech unavailable';
    if (preparingPaired && stage === 'ready') { labels.ready = 'Checking selected agent voice'; messages.ready = 'Checking transcription and playback on your selected agent. No audio is uploaded.'; }
    if (preparingLocal && stage === 'ready') { labels.ready = 'Preparing on-device speech'; messages.ready = 'Loading and checking speech models on this phone. Nothing is uploaded.'; }
    if(!Capacitor.isNativePlatform()) {
      labels.recorded='Review transcript';
      messages.recording='Recording. Stop to review the audio.';
      messages.ready='Record audio in this browser. You can add a transcript manually and save without signing in.';
      messages.recorded='Microphone is off. Enter the transcript to save with this recording.';
      messages.transcribing='Review the recording transcript.';
      messages.review='Edit the transcript, listen, or save the recording in this browser.';
    }
    if(browserDevProfile && selectedRoute==='agent'){messages.ready='Development voice uses browser recording, transcript review and playback.';messages.recorded='Review this recording in your browser.';messages.transcribing='Preparing browser transcript review.';labels.recorded='Review browser transcript';}
    if(onDeviceReady&&connectionController.getBrowserSpeechAgent()){
      labels.recorded='Transcribe on this computer';
      messages.ready='Record in this browser. English transcription runs on the local agent on this computer when you choose Transcribe.';
      messages.recorded='Microphone is off. Transcribe on this computer sends this recording to your local development agent.';
      messages.transcribing='Transcribing on this computer. Nothing has been saved.';
      messages.review='Review the transcript, listen using the local agent on this computer, or save it with the recording. No chat message has been sent.';
    }
    result.recording = true;
    result.rec = {
      manualChoice: stage === 'ready' && !busy && !preparingLocal && selectedRoute !== 'manual',
      recordOnly: () => { const target = destination, chat = chatDestination; enter(target, undefined, 'manual'); chatDestination = chat; refresh(); },
      routeChoice: stage === 'ready' && !busy && document.documentElement.dataset.connectionMode !== 'mock' && (!!connectionController.getPairedVoiceBinding() || connectionController.getCloudEnvironment() !== null),
      routeLabel: browserDevProfile ? (selectedRoute === 'device' ? 'Use development voice' : 'Use browser voice') : selectedRoute === 'device' ? (connectionController.getCloudEnvironment() !== null ? 'Use Eliza Cloud voice' : 'Use selected agent voice') : 'Use on-device voice',
      changeRoute: () => { if (stage !== 'ready' || busy) return; const target = destination, chat = chatDestination; enter(target, undefined, selectedRoute === 'device' ? 'agent' : 'device'); chatDestination = chat; refresh(); },
      clock: `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`, clockCss: '', live: stage === 'recording', paused: stage !== 'recording', dotCss: `background:${stage === 'recording' ? '#E53935' : 'var(--mut)'}`,
      levels: !Capacitor.isNativePlatform()&&stage==='recording'?recordingLevels(recordingId):Array.from({ length: 44 }, () => ({ h: 4 })),
      lines: [{ ini: error ? '!' : 'i', t: error || messages[stage], chip: 'background:var(--s2);color:var(--fg)', css: '' }],
      review: stage === 'review', transcript: draft, transcriptDisabled: busy, onTranscript: (e: Event) => { if (busy) return; draft = (e.target as HTMLTextAreaElement).value; refresh(); },
      primaryLabel: labels[stage], primaryIcon: stage === 'review' ? current.ic.check : stage === 'recording' || stage === 'transcribing' ? current.ic.stop : current.ic.mic,
      primaryDisabled: (selectedRoute === 'device' && !onDeviceReady) || preparingLocal || preparingPaired || stage === 'starting' || (busy && stage !== 'transcribing') || (stage === 'review' && !draft.trim()),
      pauseLabel: (onDeviceReady || cloudMode || pairedReady) && stage === 'review' ? playing ? 'Stop audio' : 'Listen to transcript' : ['recorded', 'review'].includes(stage) ? 'Record again' : 'Cancel recording', pauseIcon: (onDeviceReady || cloudMode || pairedReady) && stage === 'review' ? playing ? current.ic.stop : current.ic.play : ['recorded', 'review'].includes(stage) ? current.ic.mic : current.ic.x,
      stop: () => { void primary(); }, discard: () => cleanup(), toggle: () => { if ((onDeviceReady || cloudMode || pairedReady) && stage === 'review') { void listen(); } else if (['recorded', 'review'].includes(stage)) { const target = destination, chat = chatDestination; enter(target, undefined, selectedRoute); chatDestination = chat; } else cleanup(); },
    };
    return result;
  };
  const immersive = notes.immersive;
  notes.immersive = (state: Bag, current: Bag) => stage !== 'closed' ? { noPill: true } : immersive?.(state, current);
  notes.back = (state: Bag, current: Bag) => { if (stage !== 'closed') { cleanup(); return true; } return back?.(state, current); };
  notes.onLeave = (current: Bag) => { cleanup(); leave?.(current); };
  const visibility = () => {
    if (!document.hidden) return;
    ++composerProbe; stopSaved();
    if (playing) { playback?.abort(); playing = false; refresh(); }
    if (['recording', 'transcribing'].includes(stage)) { cleanup(false); stage = 'ready'; error = 'Voice stopped when the app left the foreground. Record again to continue.'; refresh(); }
  };
  const pagehide = () => { ++composerProbe; if (stage !== 'closed') cleanup(); };
  const binding = composerBinding;
  let account = binding();
  const unsubscribe = connectionController.subscribe(() => {
    const next = binding();
    if (connectionController.getSnapshot().open) { ++composerProbe; if (stage !== 'closed') cleanup(); }
    if (next !== account) { ++composerProbe; account = next; stopSaved(); if (stage !== 'closed') cleanup(); }
  });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  const unmount = Component.prototype.componentWillUnmount;
  Component.prototype.componentWillUnmount = function () { ++composerProbe; api = undefined; cleanup(); unsubscribe(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); unmount?.call(this); };
}
