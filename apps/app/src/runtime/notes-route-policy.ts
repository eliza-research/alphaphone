/** Exact owner stock plugin-notes routes only, mirroring NotesRoutes.java; the server retains authorization. */
export function notesRouteAllowed(path: unknown, method: unknown): boolean {
  return (method === 'GET' && path === '/api/notes/state') || (method === 'POST' && path === '/api/views/notes/interact');
}
export function isNotesPath(path: unknown): boolean {
  return path === '/api/notes/state' || path === '/api/views/notes/interact';
}
