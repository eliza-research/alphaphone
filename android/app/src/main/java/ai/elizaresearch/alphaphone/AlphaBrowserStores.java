package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserBookmarkStore;
import ai.eliza.plugins.browsersurface.BrowserSealedText;
import ai.eliza.plugins.browsersurface.BrowserSessionStore;
import ai.eliza.plugins.securestore.nativeonly.KeystoreTextFrame;
import android.content.Context;
import java.util.Set;

/**
 * Alpha's installed-data identifiers for the shared browser stores in
 * plugin-native-browser-surface: the preferences files and Android Keystore aliases that earlier
 * builds wrote, so saved bookmarks, tabs, history and site-permission decisions stay readable.
 * The stores, their formats and their rules are upstream; see docs/browser-storage.md.
 */
final class AlphaBrowserStores {
 /** Alpha's own URL scheme: an intent: link may never carry it as data. */
 static final Set<String> HOST_SCHEMES=Set.of("alphaphone");
 static final String BOOKMARK_PREFERENCES="alpha-browser-bookmarks",BOOKMARK_KEY_ALIAS="alpha-browser-bookmarks-v1";
 static final String SESSION_PREFERENCES="alpha-browser-session",SESSION_KEY_ALIAS="alpha-browser-session-v1";
 private AlphaBrowserStores(){}
 static BrowserBookmarkStore bookmarks(Context context){
  return new BrowserBookmarkStore(context.getSharedPreferences(BOOKMARK_PREFERENCES,Context.MODE_PRIVATE),sealer(BOOKMARK_KEY_ALIAS,800000));
 }
 static BrowserSessionStore session(Context context){
  return new BrowserSessionStore(context.getSharedPreferences(SESSION_PREFERENCES,Context.MODE_PRIVATE),sealer(SESSION_KEY_ALIAS,2000000));
 }
 private static BrowserSealedText sealer(String alias,int maxBytes){
  KeystoreTextFrame frame=new KeystoreTextFrame(alias,maxBytes);
  return new BrowserSealedText(){
   @Override public String seal(String plain)throws Exception{return frame.seal(plain);}
   @Override public String open(String sealed)throws Exception{return frame.open(sealed);}
  };
 }
}
