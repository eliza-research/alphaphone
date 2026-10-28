package ai.elizaresearch.alphaphone;

/**
 * The listener owner (AlphaLocalAgentPlugin.invocationOwner) held in memory, so the shared
 * SenseInvocation owner callback stays cheap under its lock. Every provider or Cloud credential
 * commit calls invalidate() before and after it writes, so a value read before or during a write is
 * never returned once that write has finished. A failed read is returned but never cached.
 */
final class InvocationOwnerCache {
 interface Reader {String read()throws Exception;}
 private final Object lock=new Object();
 private long version;private boolean cached;private String owner;
 String get(Reader reader){
  final long seen;
  synchronized(lock){if(cached)return owner;seen=version;}
  final String read;
  try{read=reader.read();}catch(Exception unavailable){return null;}
  synchronized(lock){if(version==seen){owner=read;cached=true;}}
  return read;
 }
 void invalidate(){synchronized(lock){version++;cached=false;owner=null;}}
}
