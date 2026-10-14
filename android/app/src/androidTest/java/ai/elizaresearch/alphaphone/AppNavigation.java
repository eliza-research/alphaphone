package ai.elizaresearch.alphaphone;
import org.json.JSONObject;

/** Uses the real Back handler and the prototype's actual home icon buttons. */
final class AppNavigation {
 private AppNavigation() {}
 static String offlineLabel() { return BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS ? "Continue offline" : "Use local apps without AI"; }
 static void liveMode() throws Exception {
  try(StartupDocumentProbe startup=new StartupDocumentProbe()) {
   // Builds without ELIZA_DEV_ALLOW_TEST_MOCKS have no mock mode: require live directly.
   if("mock".equals(startup.awaitReady(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))) {
    // One real click only. Never retry effects if their callback is lost.
    startup.expectNavigation();
    WebViewTestDriver.withActivity(MainActivity.class,a->a.getBridge().getWebView().evaluateJavascript("document.querySelector('.mock-mode-banner button')?.click()",null));
    startup.awaitReady(true);
   }
  }
 }
 static String request(String view) {
  // A caller may observe the target render before this helper's next timer runs.
  // Retire that timer before another request can navigate back through Home.
  return "(()=>{const label="+JSONObject.quote(view)+",target=label.toLowerCase();const previous=window.__alphaTestNavigation;if(previous?.timer)clearTimeout(previous.timer);const nav={target,tries:0,status:'running',timer:null,lastView:null};window.__alphaTestNavigation=nav;const again=()=>{nav.timer=setTimeout(step,100);};const step=()=>{"
   + "if(window.__alphaTestNavigation!==nav)return;nav.lastView=document.documentElement.dataset.activeView||null;if(++nav.tries>200){nav.status='failed';nav.reason='Navigation did not become ready';return;}const dialog=document.querySelector('.alpha-connection-scrim');if(dialog){const offline=[...dialog.querySelectorAll('button')].find(e=>e.textContent.trim()==="+JSONObject.quote(offlineLabel())+");if(offline&&!offline.disabled)offline.click();again();return;}"
   + "if(document.querySelector('.os')?.inert){again();return;}if(nav.lastView===target){nav.status='complete';nav.timer=null;return;}"
   + "if(nav.lastView==='home'){const b=[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')===label&&e.getClientRects().length);if(b&&!b.disabled)b.click();again();return;}"
   + "window.dispatchEvent(new Event('alpha-back'));again();};step();})()";
 }
 /**
  * A fresh install without notification and microphone access opens the modal "Set up Alpha
  * access" panel, which takes every real touch and swipe. Tests that drive real gestures first
  * choose its own "Not now" (nothing is granted); JavaScript-driven tests are unaffected by it.
  * On the emulator the panel took touches only after the sign-in panel was answered, so call this once the
  * requested view is selected (AppNavigation.request answers the sign-in panel).
  */
 static void declineStartupAccess() throws Exception {
  // The panel opens only once both permission reads return, which took more than three seconds
  // on a loaded emulator; a build that already has both grants waits this out once.
  for(int i=0;i<150;i++){
   // Already answered in this app data (the product remembers "Not now"): the panel will not open again.
   if("true".equals(WebViewTestDriver.evaluate("(()=>{try{return JSON.parse(localStorage.getItem('alpha.startup-permissions.v1')||'null')?.dismissed===true}catch{return false}})()")))return;
   if("true".equals(WebViewTestDriver.evaluate("(()=>{const b=[...document.querySelectorAll('dialog.alpha-startup-permissions[open] button')].find(b=>b.textContent.trim()==='Not now');if(!b)return false;b.click();return true})()")))return;
   android.os.SystemClock.sleep(100);
  }
 }
 static String selected(String view) { return "document.documentElement.dataset.activeView==="+JSONObject.quote(view.toLowerCase()); }
 static String composer() { return "[...document.querySelectorAll('textarea[data-alpha-composer]')].find(e=>!e.disabled&&e.getClientRects().length&&!e.closest('[inert], [aria-hidden=\"true\"]'))"; }
 static String type() { return "document.querySelector('button[aria-label=\"Type\"]')?.click()"; }
 /**
  * Clicks launcher Home's "Notifications" button, which asks Android to open its own shade (#416,
  * #417; docs/gesture-zones.md). Alpha draws no shade: observe the result with AndroidShade.
  * Evaluates to true once the button was clicked; false while Home is not the view in front, and
  * always false on the standalone app, which has no button.
  */
 static String openNotifications() { return "(()=>{const handle=document.querySelector('[data-screen] button[data-alpha-shade-handle]');if(!handle||!handle.getClientRects().length||handle.disabled||handle.closest('[inert]'))return false;handle.click();return true;})()"; }
}
