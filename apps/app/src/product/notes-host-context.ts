import {createContext, type ReactNode} from 'react';

/**
 * The Notes surface the prototype shell hosts, read by the lazily loaded Notes view
 * (product/notes-view.tsx) for its active state. It is its own module so the view's chunk
 * imports nothing from the renderer: a lazy chunk that imported the renderer split the shared
 * modules into chunks that kept development-only connection code in product bundles.
 */
export const NotesHostContext = createContext<((active: boolean) => ReactNode) | null>(null);
