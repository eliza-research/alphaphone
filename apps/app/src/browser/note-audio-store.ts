/**
 * Alpha's browser voice-note recordings on the shared elizaOS Notes audio store.
 * Ownership, two-phase deletion receipts, purge and 30-day expiry are upstream;
 * Alpha keeps only its installed IndexedDB database name.
 */
import {createNotesAudioStore,notesAudioMetadata,type NotesAudioRow} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-audio-store.ts';
export type AudioRow=NotesAudioRow;
export const alphaAudioDatabase='alpha.browser.audio.v1';
const store=createNotesAudioStore({databaseName:alphaAudioDatabase});
export const audioMetadata=notesAudioMetadata;
export const {retainAudio,audioRecord,audioDeletionStatus,changeAudioDeleted,purgeAudio,migrateAudio}=store;
