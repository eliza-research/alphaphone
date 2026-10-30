import {useContext} from 'react';
import type {MobileViewProps} from '@elizaos/ui/mobile-shell/core';
import {NotesHostContext} from './notes-host-context';

/**
 * Notes as a view of the shared shell (MobileViewHost, registered in product/alpha-product.ts).
 * The upstream NotesWorkspace owns the UI and drafts; the host binding (connection, ports, Back)
 * comes from the shell through NotesHostContext. The view stays mounted while Notes is behind
 * Home or another view (`active` false), so its drafts and selection survive.
 */
export default function CanonicalNotesView({active}: MobileViewProps) {
 const render = useContext(NotesHostContext);
 return render ? render(active !== false) : null;
}
