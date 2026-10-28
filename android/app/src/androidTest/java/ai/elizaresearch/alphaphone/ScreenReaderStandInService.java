package ai.elizaresearch.alphaphone;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

/**
 * An accessibility service that does nothing, declared in the instrumentation APK only.
 *
 * WebView builds a reduced accessibility tree unless a screen reader is running. It decides from
 * AccessibilityManager.getEnabledAccessibilityServiceList, which does not list UiAutomation, so an
 * instrumented test on an image without TalkBack gets the reduced mode. In that mode a page
 * control carries no default action, and WebView accepts ACTION_CLICK (performAction returns
 * true) and then drops it before it reaches the page (Chromium 133:
 * BrowserAccessibilityManager::DoDefaultAction returns when the node has no default action verb,
 * and Blink serializes that verb only in screen reader mode). ACTION_FOCUS is not gated that way,
 * which is why the round 8 run saw focus move and no click arrive.
 *
 * Binding this service puts WebView in the mode TalkBack and Switch Access get, so the click the
 * test performs is the click those services perform. See AccessibilityInstrumentedTest.
 *
 * Checked against Chromium 133.0.6943.137, the WebView of the API 36 image that failed: the mode
 * is chosen in WebContentsAccessibilityImpl.refreshNativeState, which passes
 * AccessibilityState.isScreenReaderEnabled() to setBrowserAXMode; AccessibilityState
 * (ui/accessibility/android) sets that flag when the running services' event types include
 * TYPE_VIEW_SELECTED, TYPE_VIEW_SCROLLED or TYPE_ANNOUNCEMENT (SCREEN_READER_EVENT_TYPE_MASK).
 * res/xml/screen_reader_stand_in.xml declares typeAllMask, which includes all three. A source
 * reading, not a run: the emulator run of the stand-in on that WebView is still open.
 */
public final class ScreenReaderStandInService extends AccessibilityService {
 @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
 @Override public void onInterrupt() {}
}
