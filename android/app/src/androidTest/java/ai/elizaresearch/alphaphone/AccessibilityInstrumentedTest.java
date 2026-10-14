package ai.elizaresearch.alphaphone;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.isRoot;
import static org.junit.Assert.*;

import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.espresso.accessibility.AccessibilityChecks;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
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
 * Traversal and the accessibility click on the launcher Notifications button use a stand-in screen reader bound
 * (ScreenReaderStandInService). Without one WebView is in its reduced accessibility mode, where it
 * can omit named groups and accept ACTION_CLICK without delivering it to the page.
 * Keep the stand-in bound through all tree and gesture checks, restoring prior settings afterward.
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
 /** The handle as accessibility services see it: found by its name, then the clickable node that carries it. */
 private static android.view.accessibility.AccessibilityNodeInfo handleNode(){
  android.view.accessibility.AccessibilityNodeInfo target=null;
  for(int i=0;i<50;i++){
   android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
   // Reopening follows a modal tree rebuild. DOM aria-hidden can settle before the AX tree;
   // refresh the cached nodes and wait for a current actionable handle without clicking it.
   if(root!=null&&root.refresh()){
    android.view.accessibility.AccessibilityNodeInfo node=named(root,"Open notifications",0);
    target=node;while(target!=null&&!target.isClickable())target=target.getParent();
    if(target!=null&&target.refresh()&&target.isClickable()&&target.isEnabled()&&target.isVisibleToUser())return target;
   }
   SystemClock.sleep(100);
  }
  fail("The handle is a current visible enabled clickable accessibility node (last: "+(target==null?"none":chain(target))+")");
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

 private static List<AccessibilityNodeInfo> children(AccessibilityNodeInfo node){
  List<AccessibilityNodeInfo> out=new ArrayList<>();
  for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)out.add(child);}
  return out;
 }
 private static Rect screenBounds(AccessibilityNodeInfo node){Rect r=new Rect();node.getBoundsInScreen(r);return r;}
 /** Chromium maps ARIA container names to Android containerTitle on newer providers.
  * Read the public native tree, retaining older text/content-description mappings. */
 private static boolean assistantName(AccessibilityNodeInfo node){
  return "Assistant controls".contentEquals(node.getText()==null?"":node.getText())
   ||"Assistant controls".contentEquals(node.getContentDescription()==null?"":node.getContentDescription())
   ||(android.os.Build.VERSION.SDK_INT>=34&&"Assistant controls".contentEquals(node.getContainerTitle()==null?"":node.getContainerTitle()));
 }
 /** Actionable or labelled leaf nodes in accessibility-tree (TalkBack linear) order. */
 private static void collect(AccessibilityNodeInfo node,List<AccessibilityNodeInfo> out){
  List<AccessibilityNodeInfo> children=children(node);
  boolean actionable=node.isClickable()||node.isCheckable()||node.isLongClickable();
  String label=(node.getText()==null?"":node.getText())+" "+(node.getContentDescription()==null?"":node.getContentDescription());
  if(actionable||(children.isEmpty()&&!label.trim().isEmpty()))out.add(node);
  for(AccessibilityNodeInfo child:children)collect(child,out);
 }
 /** Failure evidence uses raw AX rectangles as well as UiAutomator's visible bounds. The
  * pinned UiAutomator helper retains the original rectangle when intersection is empty. */
 private static android.view.accessibility.AccessibilityNodeInfo geometryNode(android.view.accessibility.AccessibilityNodeInfo node,String label,int depth){
  if(node==null||depth>60)return null;
  if(label.contentEquals(node.getText()==null?"":node.getText())||label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription()))return node;
  for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=geometryNode(node.getChild(i),label,depth+1);if(found!=null)return found;}
  return null;
 }
 /** Structural diagnostics for the exact failing node; label lookup is ambiguous for empty names. */
 private static String exactNodeGeometry(AccessibilityNodeInfo node){
  StringBuilder out=new StringBuilder();
  for(int depth=0;node!=null&&depth<16;depth++,node=node.getParent()){
   Rect r=screenBounds(node);
   out.append(depth==0?"":" < ").append(node.getClassName()).append(" bounds=").append(r.toShortString())
    .append(" resource=").append(node.getViewIdResourceName()).append(" children=").append(node.getChildCount())
    .append(" clickable=").append(node.isClickable()).append(" focusable=").append(node.isFocusable())
    .append(" screenReaderFocusable=").append(node.isScreenReaderFocusable())
    .append(" important=").append(node.isImportantForAccessibility()).append(" visible=").append(node.isVisibleToUser());
  }
  return out.toString();
 }
 private static String accessibilityGeometry(String label){
  android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
  android.view.accessibility.AccessibilityNodeInfo node=geometryNode(root,label,0);
  StringBuilder out=new StringBuilder(label);
  for(int depth=0;node!=null&&depth<16;depth++,node=node.getParent()){
   Rect raw=new Rect();node.getBoundsInScreen(raw);
   out.append(" < ").append(node.getClassName()).append(" raw=").append(raw.toShortString())
    .append(" assistantContainerTitle=").append(android.os.Build.VERSION.SDK_INT>=34&&"Assistant controls".contentEquals(node.getContainerTitle()==null?"":node.getContainerTitle()))
    .append(" scrollable=").append(node.isScrollable()).append(" visible=").append(node.isVisibleToUser());
  }
  return out.toString();
 }
 /** UiAutomator 2.3.0 keeps a nonempty rectangle when intersection with a scrollable
  * ancestor fails. Intersect explicitly so fully clipped descendants do not masquerade as
  * visible controls; partially visible nodes keep only their painted area. */
 private static Rect visibleBounds(AccessibilityNodeInfo node,UiDevice device){
  Rect bounds=screenBounds(node);if(!node.isVisibleToUser())return new Rect();List<int[]> frames=new ArrayList<>();
  frames.add(new int[]{0,0,device.getDisplayWidth(),device.getDisplayHeight()});
  for(AccessibilityNodeInfo parent=node.getParent();parent!=null;parent=parent.getParent())if(parent.isScrollable()){
   Rect frame=screenBounds(parent);frames.add(new int[]{frame.left,frame.top,frame.right,frame.bottom});
  }
  int[] clipped=AccessibilityBounds.clip(new int[]{bounds.left,bounds.top,bounds.right,bounds.bottom},frames);
  return new Rect(clipped[0],clipped[1],clipped[2],clipped[3]);
 }
 /** A named semantic group, not a geometry/class exception for arbitrary controls. */
 private static boolean assistantGroup(AccessibilityNodeInfo node){
  for(AccessibilityNodeInfo current=node;current!=null;current=current.getParent())
   if(assistantName(current))return true;
  return false;
 }
 private static int assistantGroups(AccessibilityNodeInfo node){
  int count=assistantName(node)?1:0;
  for(AccessibilityNodeInfo child:children(node))count+=assistantGroups(child);
  return count;
 }
 private static void talkBackOrder(UiDevice device,String surface)throws Exception{
  device.waitForIdle(2000);
  // The WebView publishes a layer's accessibility nodes shortly after the layer appears; read the
  // tree again until it holds a clickable control (five seconds at most). The checks below are unchanged.
  AccessibilityNodeInfo root=null;List<AccessibilityNodeInfo> nodes=new ArrayList<>();
  for(int attempt=0;attempt<25;attempt++){
   root=automation().getRootInActiveWindow();
   if(root!=null&&!BuildConfig.APPLICATION_ID.contentEquals(root.getPackageName()==null?"":root.getPackageName()))root=null;nodes=new ArrayList<>();
   if(root!=null){try{if(root.refresh())collect(root,nodes);}catch(IllegalStateException changing){nodes.clear();}}
   boolean clickable=false;try{for(AccessibilityNodeInfo node:nodes)if(node.isClickable()&&!visibleBounds(node,device).isEmpty())clickable=true;}catch(IllegalStateException changing){clickable=false;}
   if(clickable&&("Notification shade".equals(surface)||assistantGroups(root)==1))break;
   SystemClock.sleep(200);
  }
  assertNotNull(surface+": app window has an accessibility tree",root);
  int width=device.getDisplayWidth();
  List<String> problems=new ArrayList<>();
  AccessibilityNodeInfo previous=null;Rect previousBounds=null;
  int actionable=0;boolean seenAssistant=false,previousAssistant=false;
  assertTrue(surface+": at most one assistant control group",assistantGroups(root)<=1);
  for(AccessibilityNodeInfo node:nodes){
   Rect r=visibleBounds(node,device);
   if(r.isEmpty())continue;
   String label=((node.getText()==null?"":node.getText())+" "+(node.getContentDescription()==null?"":node.getContentDescription())).trim();
   // An empty text field has no text; Android carries its accessible name (aria-label/placeholder) as the hint, which TalkBack reads.
   if(label.isEmpty()&&"android.widget.EditText".equals(node.getClassName())&&node.getHintText()!=null)label=node.getHintText().toString().trim();
   if(node.isClickable()){actionable++;if(label.isEmpty()&&children(node).stream().noneMatch(c->c.getText()!=null&&!c.getText().toString().trim().isEmpty())){problems.add("unlabelled control at "+r.toShortString());System.out.println("ALPHA_ACCESSIBILITY_UNLABELLED_NODE "+exactNodeGeometry(node));}}
   if(r.left<0||r.right>width)problems.add("clipped '"+label+"' at "+r.toShortString());
   boolean assistant=assistantGroup(node);
   if(seenAssistant&&!assistant)problems.add("App content follows the assistant control group");
   seenAssistant|=assistant;
   // Main app content is read before the persistent assistant group. That group
   // floats above the bottom edge, so this semantic transition may move upward.
   // Check every node and retain geometric order checks within each region.
   if(previous!=null&&assistant==previousAssistant){
    Rect p=previousBounds;
    // The next node may start a new column to the right, otherwise it must not read upward.
    if(r.top<p.top-Math.max(p.height(),r.height())/2&&r.left<p.right){
     problems.add("reading order goes up from '"+previous.getText()+"' to '"+label+"'");
     System.out.println("ALPHA_ACCESSIBILITY_ORDER_BOUNDS previous="+p.toShortString()+" next="+r.toShortString());
     System.out.println("ALPHA_ACCESSIBILITY_PREVIOUS "+exactNodeGeometry(previous));
     System.out.println("ALPHA_ACCESSIBILITY_NEXT "+exactNodeGeometry(node));
    }
   }
   previous=node;previousBounds=r;previousAssistant=assistant;
  }
  if(!problems.isEmpty())System.out.println("ALPHA_ACCESSIBILITY_HOME_GEOMETRY "+js("(()=>{const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,overflowX:s.overflowX,overflowY:s.overflowY,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight};};const q=s=>document.querySelector(s),css=getComputedStyle(document.documentElement);return JSON.stringify({viewport:{width:innerWidth,height:innerHeight},textScale:css.getPropertyValue('--alpha-text-scale'),dockClearance:css.getPropertyValue('--alpha-dock-clearance'),dockRest:css.getPropertyValue('--alpha-dock-rest'),phoneScale:css.getPropertyValue('--phone-scale'),home:rect(q('[data-alpha-layer=home]')),allApps:rect(q('[data-alpha-home-apps] button[aria-label=\"All apps\"]')),composer:rect(q('[data-alpha-layer=composer]')),pill:rect(q('[data-alpha-layer=pill]')),inputBar:rect(q('[data-alpha-input-bar]'))});})()"));
  if(!problems.isEmpty()){
   System.out.println("ALPHA_ACCESSIBILITY_SETTINGS_GEOMETRY "+js("(()=>{const rect=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,classes:e.className,x:r.x,y:r.y,width:r.width,height:r.height,overflowX:s.overflowX,overflowY:s.overflowY,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,position:s.position};};const nodes=[...document.querySelectorAll('button,[role=button]')].filter(e=>!e.classList.contains('alpha-shade-handle')&&(e.getAttribute('aria-label')==='Notifications'||e.textContent.trim()==='Notifications')).slice(0,2);return JSON.stringify({activeView:document.documentElement.dataset.activeView,notifications:nodes.map(e=>{const ancestors=[];for(let p=e.parentElement;p&&ancestors.length<12;p=p.parentElement)ancestors.push(rect(p));return {control:rect(e),ancestors};})});})()"));
   // This owned-emulator diagnostic survives app uninstall so the host can pull and
   // remove its unique file. It does not change the collected assertion or UI state.
   String screenshot="/sdcard/Download/alpha-accessibility-fixture-"+java.util.UUID.randomUUID()+".png";
   try(InputStream capture=new ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand("screencap -p "+screenshot))){
    capture.readAllBytes();System.out.println("ALPHA_ACCESSIBILITY_SCREENSHOT "+surface+" "+screenshot);
   }catch(Exception error){System.out.println("ALPHA_ACCESSIBILITY_SCREENSHOT_ERROR "+error.getClass().getName());}
  }
  if(!"Notification shade".equals(surface)&&(!seenAssistant||assistantGroups(root)!=1)){
   // Only structural metadata from the owned fixture: no text fields, account or message data.
   System.out.println("ALPHA_ACCESSIBILITY_ASSISTANT_GROUPS surface="+surface+" count="+assistantGroups(root)+" seen="+seenAssistant);
   System.out.println("ALPHA_ACCESSIBILITY_ASSISTANT_DOM "+js("(()=>{const rows=[...document.querySelectorAll('[aria-label=\"Assistant controls\"]')];return JSON.stringify(rows.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {layer:e.dataset.alphaLayer,role:e.getAttribute('role'),hidden:e.getAttribute('aria-hidden'),inert:e.inert,ancestorHidden:!!e.parentElement?.closest('[inert],[aria-hidden=\"true\"]'),display:s.display,visibility:s.visibility,opacity:s.opacity,bounds:{x:r.x,y:r.y,width:r.width,height:r.height},buttons:[...e.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),disabled:b.disabled,visible:!!b.getClientRects().length}))};}));})()"));
   for(AccessibilityNodeInfo node:nodes)if(assistantGroup(node)||"Type".equals(node.getContentDescription())||"Talk".equals(node.getContentDescription())||"Open conversation".equals(node.getContentDescription()))System.out.println("ALPHA_ACCESSIBILITY_ASSISTANT_NODE "+accessibilityGeometry(String.valueOf(node.getContentDescription())));
  }
  if(!"Notification shade".equals(surface))assertTrue(surface+": assistant controls form one final accessible group",seenAssistant&&assistantGroups(root)==1);
  assertTrue(surface+": TalkBack reaches actionable controls",actionable>0);
  assertTrue(surface+" at 200% font: "+problems,problems.isEmpty());
 }

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

 @Test public void homeShadeSettingsAndComposerAtDoubleFontScale()throws Exception{
  androidx.test.uiautomator.Configurator configurator=androidx.test.uiautomator.Configurator.getInstance();
  int previousFlags=configurator.getUiAutomationFlags();
  configurator.setUiAutomationFlags(AUTOMATION_FLAGS);
  String previous=shell("settings get system font_scale");
  String previousServices=secure("get","enabled_accessibility_services",null),previousEnabled=secure("get","accessibility_enabled",null);
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try{
   secure("put","enabled_accessibility_services",(previousServices.isEmpty()||"null".equals(previousServices)?"":previousServices+":")+standInComponent());
   secure("put","accessibility_enabled","1");
   boolean bound=false;for(int i=0;i<150&&!bound;i++){bound=standInRunning();if(!bound)SystemClock.sleep(100);}
   assertTrue("The stand-in screen reader is bound and listed to the app (running: "+runningServices()+")",bound);
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
     handleNode();
     // The click itself is performed as those services perform it: with a screen reader bound, so
     // that WebView delivers default actions to the page (see ScreenReaderStandInService).
      // WebView notices the new service on its own timer (it polls with a back-off of up to five
      // seconds) and then rebuilds its tree. Until it has, it still accepts the click and drops
      // it, so the click is repeated once a second while that switch is under way, and only then.
      int attempts=0;boolean opened=false;android.view.accessibility.AccessibilityNodeInfo target=null;
      for(long deadline=SystemClock.uptimeMillis()+20000;!opened&&SystemClock.uptimeMillis()<deadline;){
       target=handleNode();attempts++;
       assertTrue("The accessibility click action is accepted",target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));
       opened=AndroidShade.waitOpen(1000);
      }
      assertTrue("The accessibility click action opens Android's shade (attempts: "+attempts+"; running services: "+runningServices()+"; node: "+(target==null?"none":chain(target))+")",opened);
      AndroidShade.collapse();
      // With WebView in that mode one click is enough, every time: no second attempt here.
      target=handleNode();
      assertTrue("The accessibility click action is accepted again (node: "+target+"; ancestry: "+chain(target)+")",target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));
      assertTrue("A single accessibility click opens Android's shade once WebView serves a screen reader (node: "+chain(target)+")",AndroidShade.waitOpen(5000));
      AndroidShade.collapse();
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
   try{
    restoreSecure("enabled_accessibility_services",previousServices);restoreSecure("accessibility_enabled",previousEnabled);
   }finally{
    try{shell("settings put system font_scale "+(previous.isEmpty()||"null".equals(previous)?"1.0":previous));}
    finally{configurator.setUiAutomationFlags(previousFlags);}
   }
  }
 }
}
