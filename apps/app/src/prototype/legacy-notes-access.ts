/** Installed namespaces stay in Alpha; the shared store owns existing-only access. */
import {
 ExistingNotesReviewRequired,
 openExistingDocumentNotes,
 openExistingSecureNotes,
} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-existing-store.ts';
import {capacityAwareNotesVault,type NotesVault} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-secure-store.ts';
import {notesSecureConfig} from '../runtime/notes-secure-store';
export {ExistingNotesReviewRequired as LegacyNotesReviewRequired};
export const openExistingBrowserNotes = openExistingDocumentNotes;
export function openExistingDeviceNotes(vault:NotesVault,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,signal:AbortSignal,current:()=>boolean){
 return openExistingSecureNotes(notesSecureConfig,capacityAwareNotesVault(vault),storage,signal,current);
}
