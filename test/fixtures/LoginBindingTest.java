package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserAutofillEligibility;
import ai.eliza.plugins.passwords.PasswordFormPolicy;
import ai.eliza.plugins.passwords.PasswordFormPolicy.Node;
import java.util.Set;

/**
 * Plain-JVM check (issue #404) that the HTTP authentication prompt's origin rule and the
 * field shape Alpha reports (BrowserHttpAuthAutofill) are accepted by the pinned upstream
 * PasswordFormPolicy for exactly the verified origin, and refused for wrong origins, frames,
 * missing field origins and an untrusted host. The structures are hand-built mirrors of what
 * the Android views report; Android's own onProvideAutofillStructure, AssistStructure, a
 * provider, a vault and a device are not run here.
 */
public final class LoginBindingTest {
 static final String HOST = "ai.elizaresearch.alphaphone";
 static final int CLASS_TEXT = 1, TEXT_PASSWORD = 0x80, TEXT_VISIBLE_PASSWORD = 0x90, FLAG_NO_SUGGESTIONS = 0x80000;
 static int checks = 0;

 static void eq(Object expected, Object actual, String what) {
  if (expected == null ? actual != null : !expected.equals(actual)) throw new AssertionError(what + ": expected " + expected + " got " + actual);
  checks++;
 }

 /** Mirrors BrowserHttpAuthAutofill.field(...) plus OriginField.onProvideAutofillStructure. */
 static Node field(String origin, boolean password, int id, String value) {
  Node node = new Node();
  node.id = "f" + id; node.text = true; node.visible = true; node.focused = password;
  node.inputType = CLASS_TEXT | (password ? TEXT_PASSWORD : FLAG_NO_SUGGESTIONS);
  node.hints = java.util.List.of(password ? "password" : "username");
  if (origin != null) {
   // ViewStructure.setWebDomain(origin) stores scheme and host; the port travels in the extras.
   java.net.URI uri = java.net.URI.create(origin);
   node.webDomain = uri.getHost(); node.webScheme = uri.getScheme();
   node.topOrigin = origin; node.fieldOrigin = origin;
  }
  node.value = value;
  return node;
 }

 static Node prompt(String origin, String user, String pass) {
  Node root = new Node(); // the dialog window: title and message are not text fields
  Node title = new Node(); title.id = "title"; root.add(title);
  root.add(field(origin, false, 1, user)).add(field(origin, true, 2, pass));
  return root;
 }

 /** A request whose structure also holds an enabled tab WebView with its own web login form.
  * {@code withPassword=false} leaves only a username field on the page. */
 static Node withTab(String promptOrigin, String pageOrigin, boolean withPassword) {
  java.net.URI page = java.net.URI.create(pageOrigin);
  Node web = new Node(); web.id = "web"; web.webDomain = page.getHost(); web.webScheme = page.getScheme(); web.topOrigin = pageOrigin;
  Node u = new Node(); u.id = "wu"; u.text = true; u.htmlType = "text"; u.htmlAutocomplete = "username"; u.fieldOrigin = pageOrigin;
  web.add(u);
  if (withPassword) { Node p = new Node(); p.id = "wp"; p.text = true; p.htmlType = "password"; p.fieldOrigin = pageOrigin; web.add(p); }
  Node activity = new Node(); activity.add(web).add(prompt(promptOrigin, null, null));
  return activity;
 }

 static String rejected(Node root, String pkg, boolean hostIsBrowser, boolean forSave) {
  try { PasswordFormPolicy.evaluate(pkg, HOST, hostIsBrowser, root, p -> false, forSave); return null; }
  catch (PasswordFormPolicy.Rejected r) { return r.getMessage(); }
 }

 public static void main(String[] args) throws Exception {
  // --- Origin rule for the challenge ---
  // forChallenge(reportedHost, pendingMain, documentUrl, committed, otherRequestOrigins)
  Set<String> none = Set.of();
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/login", "https://example.com/login", false, none), "first load, not committed");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com:8443/a", "https://example.com:8443/a", false, none), "port taken from the main-frame load, not the challenge");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com:443", "https://Example.com/a", "https://Example.com/a", false, none), "default port normalised");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com:8443", "https://example.com/a", "https://example.com/a", false, none), "reported port contradicts the load");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com:8443/b", "https://example.com/a", false, none), "redirect to another port before commit");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "http://example.com/a", "http://example.com/a", false, none), "cleartext load");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "http://example.com/b", "https://example.com/a", false, none), "redirect to cleartext");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/b", "https://other.example/a", true, none), "page-initiated load from another site");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://other.example/a", "https://other.example/a", true, none), "no pending load for this host");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://user:pw@example.com/a", "https://user:pw@example.com/a", false, none), "user info");
  eq(null, BrowserHttpAuthOrigin.forChallenge("", "https://example.com/", "https://example.com/", false, none), "missing host");
  eq(null, BrowserHttpAuthOrigin.forChallenge("accounts.example.com", "https://example.com/", "https://example.com/", false, none), "subdomain is a different binding");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/", "https://example.com/", false, null), "request record unavailable or overflowed");
  // Frames and resources: WebView reports no port and no frame for a challenge.
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/", "https://example.com/", true, Set.of("https://example.com:8443")),
     "committed page plus a same-host frame on another port: never bound to the page origin");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/", "https://example.com/", true, none),
     "committed page and no pending main-frame load: a resource or frame is asking, not filled");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/admin", "https://example.com/", true, Set.of("https://example.com:8443", "https://cdn.example")),
     "pending same-host load while a frame on another port is live");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/", "https://other.example/", true, Set.of("http://example.com")),
     "a cleartext request to the host is a different origin");
  eq(null, BrowserHttpAuthOrigin.forChallenge("example.com", "https://example.com/admin", "https://example.com/", true, Set.of("https://example.com", "https://cdn.example:8443")),
     "same-origin resources and other hosts do not block the pending main-frame load");
  eq("https://example.com:8443", BrowserHttpAuthOrigin.requestOrigin("https://EXAMPLE.com:8443/x?y"), "request origin keeps a non-default port");
  eq("http://example.com", BrowserHttpAuthOrigin.requestOrigin("http://example.com:80/"), "http default port omitted");
  eq(null, BrowserHttpAuthOrigin.requestOrigin("blob:https://example.com/1"), "non-network requests are not recorded");

  // --- No tab is fillable while a site prompt is open (canAutofill sets overlay) ---
  BrowserAutofillEligibility.TabState tab = new BrowserAutofillEligibility.TabState();
  tab.selected = true; tab.shown = true; tab.committed = true; tab.documentUrl = tab.engineUrl = "https://example.com/";
  eq(true, BrowserAutofillEligibility.eligible(tab), "committed selected tab without a prompt");
  tab.overlay = true;
  eq(false, BrowserAutofillEligibility.eligible(tab), "the same tab while the HTTP sign-in prompt is open");

  // --- Shared upstream policy with Alpha's field shape ---
  String origin = "https://example.com:8443";
  PasswordFormPolicy.Target fill = PasswordFormPolicy.evaluate(HOST, HOST, true, prompt(origin, null, null), p -> false, false);
  eq(origin, fill.webOrigin, "fill binds to the exact origin, port included");
  eq(null, fill.appPackage, "never bound to Alpha's app identity");
  eq("f1", fill.usernameId, "username field");
  eq("f2", fill.passwordId, "password field");
  PasswordFormPolicy.Target save = PasswordFormPolicy.evaluate(HOST, HOST, true, prompt(origin, "ada", "s3cret"), p -> false, true);
  eq(origin, save.webOrigin, "save binds to the same origin");

  eq("Host interface is never filled", rejected(prompt(null, null, null), HOST, true, false), "no origin: the prompt is Alpha UI and is refused");
  eq("Untrusted browser", rejected(prompt(origin, null, null), HOST, false, false), "a host that is not a browser");
  eq("Untrusted browser", rejected(prompt(origin, null, null), "com.example.other", true, false), "another package is not trusted");

  Node wrongField = prompt(origin, null, null); wrongField.children.get(2).fieldOrigin = "https://evil.example";
  eq("Cross-origin frame", rejected(wrongField, HOST, true, false), "wrong field origin");
  Node noField = prompt(origin, null, null); noField.children.get(2).fieldOrigin = null;
  eq("Field origin unavailable", rejected(noField, HOST, true, false), "missing field origin");
  Node frame = prompt(origin, null, null); frame.children.get(1).webDomain = "evil.example";
  eq("Cross-origin frame", rejected(frame, HOST, true, false), "a second domain");
  Node wrongTop = prompt(origin, null, null); for (Node n : wrongTop.children) if (n.topOrigin != null) n.topOrigin = "https://evil.example";
  eq("Cross-origin frame", rejected(wrongTop, HOST, true, false), "top-level origin of another host");
  Node cleartext = prompt(origin, null, null); for (Node n : cleartext.children) if (n.webScheme != null) n.webScheme = "http";
  eq("Insecure origin", rejected(cleartext, HOST, true, false), "cleartext scheme");

  // The previous username input type (VISIBLE_PASSWORD) would have made the form ambiguous.
  Node legacy = prompt(origin, null, null); legacy.children.get(1).inputType = CLASS_TEXT | TEXT_VISIBLE_PASSWORD;
  eq("Ambiguous password fields", rejected(legacy, HOST, true, false), "legacy username type");

  // --- The activity's whole structure: tab WebView window plus the prompt window ---
  // While the prompt is open the tab is ineligible, so CredentialWebView reports no children.
  Node activity = new Node(); Node tabWindow = new Node(); tabWindow.id = "tab"; activity.add(tabWindow).add(prompt(origin, null, null));
  eq(origin, PasswordFormPolicy.evaluate(HOST, HOST, true, activity, p -> false, false).webOrigin, "prompt with an excluded tab window");
  Node activitySave = new Node(); activitySave.add(new Node()).add(prompt(origin, "ada", "s3cret"));
  eq(origin, PasswordFormPolicy.evaluate(HOST, HOST, true, activitySave, p -> false, true).webOrigin, "save with an excluded tab window");
  // Why the overlay matters: a re-enabled tab adds its page's login fields to the same request.
  eq("Ambiguous password fields", rejected(withTab(origin, origin, true), HOST, true, false), "re-enabled tab, same origin");
  eq("Ambiguous password fields", rejected(withTab(origin, "https://other.example", true), HOST, true, false), "re-enabled tab, another origin");
  eq("Cross-origin frame", rejected(withTab(origin, "https://other.example", false), HOST, true, false), "re-enabled tab with only a username field");

  System.out.println("PASS login binding " + checks);
 }
}
