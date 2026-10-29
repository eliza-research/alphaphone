package ai.elizaresearch.alphaphone;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.isRoot;
import static org.junit.Assert.*;

import android.graphics.Rect;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.espresso.accessibility.AccessibilityChecks;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Home, Settings and the composer at 200% system font scale, the page's own measure of that text
 * size, Home text overlap, and the ways into Android's own notification shade (#416, #417; Alpha
 * draws no shade, and launcher Home's Notifications button asks Android to open its shade):
 * Accessibility Test Framework checks on the native view hierarchy (Espresso) and a
 * UiAutomator check that every actionable node TalkBack reaches has a label, is not
 * clipped off-screen and appears in reading order. Emulator evidence only.
 *
 * The accessibility click on the launcher's Notifications button is performed with a stand-in screen reader bound
 * (ScreenReaderStandInService). Without one WebView is in its reduced accessibility mode, where it
 * accepts ACTION_CLICK and never delivers it to the page; the round 8 run failed on exactly that,
 * on an image with no TalkBack. Nothing else in this class runs with the stand-in bound.
 *
 * A flag-off build signed out of Eliza Cloud shows nothing but the required sign-in page (P-43),
 * which tests never get past (they never sign in). There the Home journey is skipped by its own
 * assumption and the sign-in page itself, the first screen of a production phone, is checked at
 * 200% instead; on the test-mocks pair (or a phone its owner signed in) it is the other way round.
 */
@RunWith(AndroidJUnit4.class)
public final class AccessibilityInstrumentedTest {
 /**
  * One connection for the whole test. A UiAutomation connected without this flag suspends every
  * other accessibility service for as long as it is connected, which would unbind the stand-in
  * screen reader; asking for a connection with different flags drops and reconnects it. UiDevice
  * is given the same flags through Configurator.
  */
 private static final int AUTOMATION_FLAGS=android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES;
 private static android.app.UiAutomation automation(){return InstrumentationRegistry.getInstrumentation().getUiAutomation(AUTOMATION_FLAGS);}
 private static String shell(String command)throws Exception{
  try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand(command))){return new String(in.readAllBytes(),StandardCharsets.UTF_8).trim();}
 }
 /** Settings are per user; the instrumentation may run as a secondary one. */
 private static String secure(String action,String key,String value)throws Exception{return shell("settings "+action+" --user "+(android.os.Process.myUid()/100000)+" secure "+key+(value==null?"":" "+value));}
 private static void restoreSecure(String key,String previous)throws Exception{if(previous.isEmpty()||"null".equals(previous))secure("delete",key,null);else secure("put",key,previous);}
 private static String standInComponent(){return InstrumentationRegistry.getInstrumentation().getContext().getPackageName()+"/"+ScreenReaderStandInService.class.getName();}
 /** The service list WebView itself reads to choose its accessibility mode, from the app's own AccessibilityManager. */
 private static List<String> runningServices(){
  List<String> names=new ArrayList<>();
  android.view.accessibility.AccessibilityManager manager=(android.view.accessibility.AccessibilityManager)InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(android.content.Context.ACCESSIBILITY_SERVICE);
  for(android.accessibilityservice.AccessibilityServiceInfo info:manager.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK))if(info.getResolveInfo()!=null&&info.getResolveInfo().serviceInfo!=null)names.add(info.getResolveInfo().serviceInfo.name);
  return names;
 }
 private static boolean standInRunning(){return runningServices().contains(ScreenReaderStandInService.class.getName());}
 /**
  * The handle as accessibility services see it: the native button node that carries the name,
  * whose bounds hold the button's centre on screen (x, y). A clickable ancestor (the WebView, or
  * Home with its pointer handlers) is never taken in its place: ACTION_CLICK on such a node would
  * not be a click on the button. The name may sit on the button or on its label child.
  */
 private static android.view.accessibility.AccessibilityNodeInfo handleNode(int x,int y){
  android.view.accessibility.AccessibilityNodeInfo target=null;
  for(int i=0;i<50;i++){
   android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
   // Reopening follows a modal tree rebuild. DOM aria-hidden can settle before the AX tree;
   // refresh the cached nodes and wait for a current actionable handle without clicking it.
   if(root!=null&&root.refresh()){
    target=named(root,"Open notifications",0);
    if(target!=null&&!target.isClickable()){android.view.accessibility.AccessibilityNodeInfo parent=target.getParent();if(parent!=null&&"android.widget.Button".contentEquals(parent.getClassName()==null?"":parent.getClassName()))target=parent;}
    Rect bounds=new Rect();if(target!=null)target.getBoundsInScreen(bounds);
    if(target!=null&&target.refresh()&&"android.widget.Button".contentEquals(target.getClassName()==null?"":target.getClassName())&&target.isClickable()&&target.isEnabled()&&target.isVisibleToUser()&&bounds.contains(x,y))return target;
   }
   SystemClock.sleep(100);
  }
  Rect bounds=new Rect();if(target!=null)target.getBoundsInScreen(bounds);
  fail("The handle is a current visible enabled clickable button node at ("+x+","+y+") (last: "+(target==null?"none":chain(target)+" "+bounds.toShortString())+")");
  return null;
 }
 /** For a failure message: the node and its ancestors, with whether each is enabled (WebView drops a click on a disabled node or under one). */
 private static String chain(android.view.accessibility.AccessibilityNodeInfo node){
  StringBuilder out=new StringBuilder();
  for(int depth=0;node!=null&&depth<40;depth++,node=node.getParent())out.append(depth==0?"":" < ").append(node.getClassName()).append(node.isEnabled()?"":"(disabled)").append(node.isClickable()?"(clickable)":"");
  return out.toString();
 }
 private static String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private static void until(String code)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail("Accessibility flow condition: "+code);}
 private static void open(String view)throws Exception{js(AppNavigation.request(view));until(AppNavigation.selected(view));}

 /** TalkBack linear order of the app window at 200% font, read with this test's UiAutomation flags (TalkBackOrder). */
 private static void talkBackOrder(UiDevice device,String surface)throws Exception{TalkBackOrder.check(device,surface,TalkBackOrder.Assistant.REQUIRED_LAST);}

 /** The first node visible to the user whose text or content description is exactly the name. */
 private static android.view.accessibility.AccessibilityNodeInfo named(android.view.accessibility.AccessibilityNodeInfo node,String name,int depth){
  if(node==null||depth>60)return null;
  if(node.isVisibleToUser()&&(name.contentEquals(node.getText()==null?"":node.getText())||name.contentEquals(node.getContentDescription()==null?"":node.getContentDescription())))return node;
  for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=named(node.getChild(i),name,depth+1);if(found!=null)return found;}
  return null;
 }

 /** evaluateJavascript returns a JSON value; this unwraps a JSON string result. */
 private static String unquote(String json)throws Exception{return (String)new org.json.JSONTokener(json).nextValue();}
 /**
  * Pairs of Home text runs whose painted boxes overlap, as a JSON array (empty when none). Each
  * line box is cut by its clipping ancestors and reduced to its middle 70% in height, because line
  * boxes of adjacent lines overlap by design where the line height is below the font's content area.
  */
 private static final String HOME_TEXT_OVERLAP="(()=>{const root=document.querySelector('[data-alpha-layer=\"home\"]'),runs=[];"
  +"const clip=(b,el)=>{const r={l:b.left,r:b.right,t:b.top,b:b.bottom};for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;const f=n.getBoundingClientRect();if(s.overflowX!=='visible'){r.l=Math.max(r.l,f.left);r.r=Math.min(r.r,f.right);}if(s.overflowY!=='visible'){r.t=Math.max(r.t,f.top);r.b=Math.min(r.b,f.bottom);}}return r.r-r.l>1&&r.b-r.t>1?r:null;};"
  +"const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const el=n.parentElement,text=(n.nodeValue||'').trim();if(!text||!el.getClientRects().length||getComputedStyle(el).visibility!=='visible'||el.closest('[aria-hidden=\"true\"]'))continue;"
  +"const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects()){if(b.width<=1||b.height<=1)continue;const trim=b.height*.15,box=clip({left:b.left,right:b.right,top:b.top+trim,bottom:b.bottom-trim},el);if(box)runs.push({el,text:text.slice(0,24),box});}}"
  +"const bad=[];for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){const a=runs[i],b=runs[j];if(a.el===b.el)continue;if(Math.min(a.box.r,b.box.r)-Math.max(a.box.l,b.box.l)>2&&Math.min(a.box.b,b.box.b)-Math.max(a.box.t,b.box.t)>2)bad.push(a.text+' / '+b.text);}"
  +"return JSON.stringify([...new Set(bad)]);})()";
 /** One-word Home app labels drawn on more than one line, as a JSON array (empty when none). */
 private static final String HOME_LABELS_SPLIT="(()=>{const bad=[];for(const button of document.querySelectorAll('[data-alpha-home-apps] > button')){const label=button.lastElementChild,text=(label.textContent||'').trim();if(!text||/\\s/.test(text))continue;"
  +"const range=document.createRange();range.selectNodeContents(label);const tops=new Set([...range.getClientRects()].filter(b=>b.width>1).map(b=>Math.round(b.top)));if(tops.size>1)bad.push(text);}return JSON.stringify(bad);})()";

 /** A flag-off build without a stored Cloud credential: P-43's required sign-in page covers every view. */
 private static boolean requiredSignIn()throws Exception{
  if(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)return false;
  return new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext()).readCredentialSlot("cloud:production")==null;
 }
 /**
  * Controls of the required sign-in page that cannot be brought wholly on screen by scrolling, or
  * that something else is painted over once they are, as a JSON array (empty when none).
  */
 private static final String SIGN_IN_UNREACHABLE="(()=>{const page=document.querySelector('.alpha-auth-page');if(!page)return JSON.stringify(['no sign-in page']);const bad=[];"
  +"for(const el of page.querySelectorAll('button,input:not([type=hidden]),a[href],textarea,select')){if(el.disabled||!el.getClientRects().length||el.closest('[hidden],[inert],[aria-hidden=\"true\"]'))continue;"
  +"el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect(),name=el.getAttribute('aria-label')||el.textContent.trim().slice(0,40)||el.getAttribute('placeholder')||el.tagName;"
  +"if(r.left<-1||r.top<-1||r.right>innerWidth+1||r.bottom>innerHeight+1){bad.push(name+' off screen');continue;}"
  +"const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!(hit===el||el.contains(hit)||hit.closest('label')?.contains(el)))bad.push(name+' covered');}"
  +"document.getElementById('cloud-sign-in-title')?.scrollIntoView({block:'start',behavior:'instant'});return JSON.stringify(bad);})()";

 /**
  * The first screen of a production phone that is signed out, at 200% font: Accessibility Test
  * Framework checks, the measured text scale, TalkBack order with nothing of the phone behind the
  * page exposed (no assistant controls), and every control reachable by scrolling and uncovered.
  * Never enters an address or a code: nothing is sent to Eliza Cloud.
  */
 @Test public void requiredCloudSignInAtDoubleFontScale()throws Exception{
  org.junit.Assume.assumeTrue("Only a flag-off build signed out of Eliza Cloud opens the required sign-in page (P-43)",requiredSignIn());
  androidx.test.uiautomator.Configurator configurator=androidx.test.uiautomator.Configurator.getInstance();
  int previousFlags=configurator.getUiAutomationFlags();
  configurator.setUiAutomationFlags(AUTOMATION_FLAGS);
  String previous=shell("settings get system font_scale");
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try{
   shell("settings put system font_scale 2.0");
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();
    AccessibilityChecks.enable().setRunChecksFromRootView(true);
    until("document.querySelector('.alpha-auth-page #cloud-sign-in-title')?.textContent==='Welcome to Alpha.'");
    onView(isRoot()).check(AccessibilityChecks.accessibilityAssertion());
    until("Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))>0");
    double measured=Double.parseDouble(js("Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))"));
    assertTrue("The sign-in page measures the 200% text it is drawn at (measured "+measured+")",Math.abs(measured-2.0)<0.2);
    TalkBackOrder.check(device,"Required Cloud sign-in",TalkBackOrder.Assistant.ABSENT);
    assertEquals("Sign-in controls out of reach at 200% font","[]",unquote(js(SIGN_IN_UNREACHABLE)));
   }
  }finally{
   shell("settings put system font_scale "+(previous.isEmpty()||"null".equals(previous)?"1.0":previous));
   configurator.setUiAutomationFlags(previousFlags);
  }
 }

 @Test public void homeShadeSettingsAndComposerAtDoubleFontScale()throws Exception{
  // P-43: a flag-off build signed out of Eliza Cloud shows only the sign-in page, which
  // requiredCloudSignInAtDoubleFontScale checks; the views need the test-mocks pair or a signed-in phone.
  AppNavigation.assumeNoRequiredSignIn("The accessibility journey through Home, Settings and the composer");
  androidx.test.uiautomator.Configurator configurator=androidx.test.uiautomator.Configurator.getInstance();
  int previousFlags=configurator.getUiAutomationFlags();
  configurator.setUiAutomationFlags(AUTOMATION_FLAGS);
  // AndroidShade shares the same connection: with its default flags each shade check reconnected
  // UiAutomation with accessibility services suppressed, which unbound the stand-in screen reader in
  // the middle of the click loop (emulator campaign of 2026-10-14: "running services: []" after 19 attempts).
  AndroidShade.useAutomationFlags(AUTOMATION_FLAGS);
  String previous=shell("settings get system font_scale");
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try{
   shell("settings put system font_scale 2.0");
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();
    // Throws on any ATF error-level result for the native hierarchy (WebView host, system bars).
    AccessibilityChecks.enable().setRunChecksFromRootView(true);
    open("Home");AppNavigation.declineStartupAccess();onView(isRoot()).check(AccessibilityChecks.accessibilityAssertion());talkBackOrder(device,"Home");
    // Large text reaches the page as WebView text zoom. The page measures it (runtime/text-scale.ts)
    // and its layout rules read the result; a value near 1 here would mean those rules never engage.
    until("Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))>0");
    double measured=Double.parseDouble(js("Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))"));
    assertTrue("The page measures the 200% text it is drawn at (measured "+measured+")",Math.abs(measured-2.0)<0.2);
    // Round 7 saw the Home card title printed over the lines around it and app labels split
    // mid-word at this size. Measured from the painted line boxes inside the WebView.
    assertEquals("Home text printed over other text at 200% font","[]",unquote(js(HOME_TEXT_OVERLAP)));
    assertEquals("Home app labels split mid-word at 200% font","[]",unquote(js(HOME_LABELS_SPLIT)));

    // Gesture zones and Android's shade (#416, #417; docs/gesture-zones.md). Android's shade is the
    // one notification surface: Alpha draws none, in either flavor.
    until(AndroidShade.ALPHA_SHADE_ABSENT);
    Rect web=device.findObject(By.clazz("android.webkit.WebView")).getVisibleBounds();
    float css=web.width()/Float.parseFloat(js("window.innerWidth"));
    // 1. A swipe from the very top edge belongs to Android in both flavors and opens Android's shade.
    device.swipe(web.centerX(),2,web.centerX(),web.top+web.height()/2,20);
    assertTrue("A top-edge swipe opens Android's own shade",AndroidShade.waitOpen(5000));
    assertEquals("No Alpha panel opens behind Android's shade","true",js(AndroidShade.ALPHA_SHADE_ABSENT));
    AndroidShade.collapse();
    assertTrue("Alpha is in front again after Android's shade closes",device.wait(androidx.test.uiautomator.Until.hasObject(By.pkg(BuildConfig.APPLICATION_ID).depth(0)),5000));
    SystemClock.sleep(500);
    if(!BuildConfig.IS_LAUNCHER){
     // The standalone app is an ordinary app: no Notifications button on Home.
     assertEquals("The standalone app offers no Notifications button","0",js("document.querySelectorAll('[data-alpha-shade-handle]').length"));
    }else{
     org.json.JSONObject handle=new org.json.JSONObject(unquote(js("(()=>{const b=document.querySelector('[data-alpha-shade-handle]').getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2,top:b.top,left:b.left,width:b.width,height:b.height})})()")));
     assertTrue("The button is a 44 by 44 CSS pixel target at least: "+handle,handle.getDouble("height")>=44&&handle.getDouble("width")>=44);
     int handleX=web.left+Math.round((float)handle.getDouble("x")*css),handleY=web.top+Math.round((float)handle.getDouble("y")*css);
     // 2. TalkBack and Switch Access activate the button with the click action, with no touch.
     // The button is exposed by name as a clickable node whatever service is asking.
     handleNode(handleX,handleY);
     // The click itself is performed as those services perform it: with a screen reader bound, so
     // that WebView delivers default actions to the page (see ScreenReaderStandInService).
     String previousServices=secure("get","enabled_accessibility_services",null),previousEnabled=secure("get","accessibility_enabled",null);
     try{
      secure("put","enabled_accessibility_services",(previousServices.isEmpty()||"null".equals(previousServices)?"":previousServices+":")+standInComponent());
      secure("put","accessibility_enabled","1");
      boolean bound=false;for(int i=0;i<150&&!bound;i++){bound=standInRunning();if(!bound)SystemClock.sleep(100);}
      assertTrue("The stand-in screen reader is bound and listed to the app (running: "+runningServices()+")",bound);
      // WebView notices the new service on its own timer (it polls with a back-off of up to five
      // seconds) and then rebuilds its tree. Until it has, it still accepts the click and drops
      // it, so the click is repeated once a second while that switch is under way, and only then.
      int attempts=0;boolean opened=false;android.view.accessibility.AccessibilityNodeInfo target=null;
      for(long deadline=SystemClock.uptimeMillis()+20000;!opened&&SystemClock.uptimeMillis()<deadline;){
       target=handleNode(handleX,handleY);attempts++;
       assertTrue("The accessibility click action is accepted",target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));
       opened=AndroidShade.waitOpen(1000);
      }
      assertTrue("The accessibility click action opens Android's shade (attempts: "+attempts+"; running services: "+runningServices()+"; node: "+(target==null?"none":chain(target))+")",opened);
      AndroidShade.collapse();
      // With WebView in that mode one click is enough, every time: no second attempt here.
      target=handleNode(handleX,handleY);
      assertTrue("The accessibility click action is accepted again (node: "+target+"; ancestry: "+chain(target)+")",target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));
      assertTrue("A single accessibility click opens Android's shade once WebView serves a screen reader (node: "+chain(target)+")",AndroidShade.waitOpen(5000));
      AndroidShade.collapse();
     }finally{
      if(AndroidShade.isOpen())AndroidShade.collapse();
      restoreSecure("enabled_accessibility_services",previousServices);restoreSecure("accessibility_enabled",previousEnabled);
      for(int i=0;i<100&&standInRunning();i++)SystemClock.sleep(100);
     }
     // 3. A pull down that starts on the button asks for the same shade. It sits below the status
     // bar inset Android reports, outside the system's top-edge zone.
     device.swipe(handleX,handleY,handleX,handleY+web.height()/3,20);
     assertTrue("A pull from the button opens Android's shade",AndroidShade.waitOpen(5000));
     assertEquals("true",js(AndroidShade.ALPHA_SHADE_ABSENT));
     AndroidShade.collapse();
    }
    open("Settings");onView(isRoot()).check(AccessibilityChecks.accessibilityAssertion());talkBackOrder(device,"Settings");
    open("Home");js(AppNavigation.type());until(AppNavigation.composer());talkBackOrder(device,"Composer");
   }
  }finally{
   shell("settings put system font_scale "+(previous.isEmpty()||"null".equals(previous)?"1.0":previous));
   configurator.setUiAutomationFlags(previousFlags);
   AndroidShade.useAutomationFlags(0);
  }
 }
}
