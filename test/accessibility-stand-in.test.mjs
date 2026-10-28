// AccessibilityInstrumentedTest performs its accessibility click with a stand-in screen reader
// bound, because WebView drops default actions in the reduced accessibility mode it serves when
// no screen reader is running (ScreenReaderStandInService). These are source checks only: that
// the stand-in exists in the instrumentation APK and nowhere else, declares what makes WebView
// treat it as a screen reader, and that the test restores every setting it changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const SERVICE = 'ai.elizaresearch.alphaphone.ScreenReaderStandInService';

test('the stand-in screen reader is declared in the instrumentation APK only', () => {
  const manifest = read('android/app/src/androidTest/AndroidManifest.xml');
  const declaration = manifest.match(new RegExp(`<service android:name="${SERVICE.replaceAll('.', '\\.')}"[\\s\\S]*?</service>`))?.[0];
  assert.ok(declaration, 'the androidTest manifest declares the service');
  assert.match(declaration, /android:permission="android\.permission\.BIND_ACCESSIBILITY_SERVICE"/);
  assert.match(declaration, /<action android:name="android\.accessibilityservice\.AccessibilityService" \/>/);
  assert.match(declaration, /android:resource="@xml\/screen_reader_stand_in"/);
  for (const file of ['android/app/src/main/AndroidManifest.xml', 'android/app/src/launcher/AndroidManifest.xml', 'android/app/src/testMocks/AndroidManifest.xml'])
    assert.ok(!read(file).includes('ScreenReaderStandIn'), `${file} must not declare the stand-in`);
  assert.ok(!fs.existsSync(path.join(root, 'android/app/src/main/java/ai/elizaresearch/alphaphone/ScreenReaderStandInService.java')));
});

test('it declares what WebView reads to choose its accessibility mode, and asks for nothing that changes input', () => {
  const config = read('android/app/src/androidTest/res/xml/screen_reader_stand_in.xml');
  // Chromium treats a running service as a screen reader by its event types (view selected,
  // view scrolled, announcement); typeAllMask includes them.
  assert.match(config, /android:accessibilityEventTypes="typeAllMask"/);
  assert.match(config, /android:accessibilityFeedbackType="feedbackSpoken"/);
  assert.match(config, /android:canRetrieveWindowContent="true"/);
  assert.doesNotMatch(config, /flagRequestTouchExplorationMode|canRequestTouchExplorationMode|canPerformGestures|flagRequestFilterKeyEvents/);
});

test('the test binds it for the click only, does not suspend it, and restores what it changed', () => {
  const source = read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/AccessibilityInstrumentedTest.java');
  assert.match(source, /FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES/);
  assert.match(source, /setUiAutomationFlags\(AUTOMATION_FLAGS\)/);
  assert.match(source, /configurator\.setUiAutomationFlags\(previousFlags\)/);
  // No connection without the flag: it would suspend the stand-in for as long as it lasted.
  assert.doesNotMatch(source, /getUiAutomation\(\)/);
  // The shared TalkBack-order reader connects with the flags the test configured, never its own.
  const order = read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/TalkBackOrder.java');
  assert.doesNotMatch(order, /getUiAutomation\(\)/);
  assert.match(order, /getUiAutomation\(Configurator\.getInstance\(\)\.getUiAutomationFlags\(\)\)/);
  const step = source.slice(source.indexOf('String previousServices='), source.indexOf('// 3. A pull down'));
  assert.match(step, /secure\("put","enabled_accessibility_services"/);
  assert.match(step, /assertTrue\("The stand-in screen reader is bound/);
  assert.match(step, /finally\{\s*if\(AndroidShade\.isOpen\(\)\)AndroidShade\.collapse\(\);\s*restoreSecure\("enabled_accessibility_services",previousServices\);restoreSecure\("accessibility_enabled",previousEnabled\);/);
  // The click on launcher Home's Notifications button is still required to open Android's shade (#416, #417), and once more with a single attempt.
  assert.match(step, /assertTrue\("The accessibility click action opens Android's shade/);
  assert.match(step, /assertTrue\("A single accessibility click opens Android's shade/);
  assert.equal(step.match(/performAction\(android\.view\.accessibility\.AccessibilityNodeInfo\.ACTION_CLICK\)/g).length, 2);
});
