package ai.elizaresearch.alphaphone;

/** Exact owner stock plugin-notes transport surface; backend authorization remains authoritative. */
final class NotesRoutes {
 static boolean owns(String path){return "/api/notes/state".equals(path)||"/api/views/notes/interact".equals(path);}
 static boolean allowed(String path,String method){return ("GET".equals(method)&&"/api/notes/state".equals(path))||("POST".equals(method)&&"/api/views/notes/interact".equals(path));}
}
