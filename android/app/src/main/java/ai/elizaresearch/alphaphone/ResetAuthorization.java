package ai.elizaresearch.alphaphone;

/** One activity-owned confirmation and fresh Android authentication, never a reusable unlock. */
final class ResetAuthorization {
 private long generation; private boolean active, confirmed;
 synchronized long begin(){if(active)throw new IllegalStateException("Reset review already open");active=true;confirmed=false;return ++generation;}
 synchronized boolean confirm(long token){if(!active||token!=generation)return false;confirmed=true;return true;}
 synchronized boolean authenticate(long token,boolean accepted){
  if(!active||token!=generation)return false;
  boolean authorized=confirmed&&accepted;active=false;confirmed=false;++generation;return authorized;
 }
 synchronized void retire(){active=false;confirmed=false;++generation;}
}
