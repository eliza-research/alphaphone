// Host test of the result parser (class S); no device is involved.
//
// Two instrumented methods record which outcome they saw with an extra status line that carries
// no class or test name: BrowserFlow's search method (browserFlowSearch=results|provider-check)
// and BrowserReadingNavigation (browserReadingProvider=isolated-world|no-isolated-world). Such a
// line arrives between a method's start and end records and must change no count.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { instrumentationClassResults } from "../scripts/instrumentation-result.mjs";

const C = name => `ai.elizaresearch.alphaphone.${name}InstrumentedTest`;
const record = (cls, method, code, extra = []) => [`INSTRUMENTATION_STATUS: class=${cls}`, `INSTRUMENTATION_STATUS: test=${method}`, ...extra, `INSTRUMENTATION_STATUS_CODE: ${code}`];
const outcome = (key, value) => [`INSTRUMENTATION_STATUS: ${key}=${value}`, "INSTRUMENTATION_STATUS_CODE: 0"];

test("an outcome status line between a method's start and end changes no count", () => {
  const flow = C("BrowserFlow"), reading = C("BrowserReadingNavigation");
  const text = [
    ...record(flow, "submittedSearchUsesRealProviderAndRejectsExecutableAddress", 1),
    ...outcome("browserFlowSearch", "provider-check"),
    ...record(flow, "submittedSearchUsesRealProviderAndRejectsExecutableAddress", 0),
    // On a provider without isolated-world injection: one method runs, the other is skipped.
    ...record(reading, "delayedSameOriginAndReloadReadyCannotAdoptOldDocument", 1),
    ...outcome("browserReadingProvider", "no-isolated-world"),
    ...record(reading, "delayedSameOriginAndReloadReadyCannotAdoptOldDocument", -4, ["INSTRUMENTATION_STATUS: stack=org.junit.AssumptionViolatedException: no isolated-world injection"]),
    ...record(reading, "providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing", 1),
    ...outcome("browserReadingProvider", "no-isolated-world"),
    ...record(reading, "providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing", 0),
    "INSTRUMENTATION_CODE: -1", "",
  ].join("\n");
  const { results, runFailure } = instrumentationClassResults(text, [flow, reading]);
  assert.equal(runFailure, false);
  const byClass = Object.fromEntries(results.map(row => [row.class, row]));
  assert.deepEqual({ started: byClass[flow].started, passed: byClass[flow].passed, failed: byClass[flow].failed, ignored: byClass[flow].ignored, status: byClass[flow].status },
    { started: 1, passed: 1, failed: [], ignored: [], status: "passed" });
  // The skipped method is listed, never counted as a pass.
  assert.deepEqual({ started: byClass[reading].started, passed: byClass[reading].passed, failed: byClass[reading].failed, ignored: byClass[reading].ignored },
    { started: 2, passed: 1, failed: [], ignored: ["delayedSameOriginAndReloadReadyCannotAdoptOldDocument"] });
});

test("the two instrumented methods send those status lines without a class or test field", () => {
  const source = name => fs.readFileSync(`android/app/src/androidTest/java/ai/elizaresearch/alphaphone/${name}InstrumentedTest.java`, "utf8");
  assert.match(source("BrowserFlow"), /Bundle seen=new Bundle\(\);seen\.putString\("browserFlowSearch",outcome\);[\w.]*InstrumentationRegistry\.getInstrumentation\(\)\.sendStatus\(0,seen\);/);
  assert.match(source("BrowserReadingNavigation"), /seen\.putString\("browserReadingProvider",capable\?"isolated-world":"no-isolated-world"\);InstrumentationRegistry\.getInstrumentation\(\)\.sendStatus\(0,seen\);/);
});

test("the search method still fails on anything but the results page or the provider's check for that exact search", () => {
  const flow = fs.readFileSync("android/app/src/androidTest/java/ai/elizaresearch/alphaphone/BrowserFlowInstrumentedTest.java", "utf8");
  const method = flow.slice(flow.indexOf("@Test public void submittedSearchUsesRealProviderAndRejectsExecutableAddress()"));
  // The results condition is the one the method always had.
  assert.ok(method.includes(`String results="location.protocol==='https:' && location.hostname==='www.google.com' && location.pathname==='/search' && new URL(location.href).searchParams.get('q')==="+quoted+loaded;`));
  assert.ok(method.includes(`String loaded=" && document.readyState==='complete' && !!document.body && document.body.innerText.trim().length>20";`));
  // The check page counts only on Google's own hosts, over HTTPS, naming this exact search.
  assert.ok(method.includes(`here.protocol!=='https:'||!((here.hostname==='www.google.com'&&here.pathname.startsWith('/sorry/'))||here.hostname==='consent.google.com')`));
  assert.ok(method.includes(`next.protocol==='https:'&&next.hostname==='www.google.com'&&next.pathname==='/search'&&next.searchParams.get('q')==="+quoted`));
  assert.ok(method.includes(`if(outcome==null)fail(`));
  // Whatever answered, the product's own request is asserted exactly, and the bridge check stays.
  for (const kept of [`assertEquals("Search is requested over HTTPS","https",request.getScheme());`, `assertEquals("Search is requested from the search provider","www.google.com",request.getHost());`, `assertEquals("Search is requested at the provider's search path","/search",request.getPath());`, `assertEquals("The typed words are the query, unchanged",query,request.getQueryParameter("q"));`, `assertEquals("Search provider cannot access app bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));`, `assertEquals("Rejected address cannot create a page","null",child("true"));`])
    assert.ok(method.includes(kept), kept);
});

test("JUnit ignored tests without a start are reported as skipped, including mixed classes", () => {
  const cls = C("Shell");
  const ignored = record(cls, "ignored", -3);
  const finish = "INSTRUMENTATION_CODE: -1";
  const only = instrumentationClassResults([...ignored, finish].join("\n"), [cls]).results[0];
  assert.deepEqual({status: only.status, started: only.started, passed: only.passed, ignored: only.ignored},
    {status: "skipped", started: 0, passed: 0, ignored: ["ignored"]});
  const mixed = instrumentationClassResults([...ignored, ...record(cls, "executed", 1), ...record(cls, "executed", 0), finish].join("\n"), [cls]).results[0];
  assert.equal(mixed.status, "passed");
  assert.equal(mixed.passed, 1);
  assert.deepEqual(mixed.ignored, ["ignored"]);
});

test("duplicate, overlapping or unstarted method results cannot qualify a class", () => {
  const cls = C("Shell");
  const completed = [...record(cls, "a", 1), ...record(cls, "a", 0)];
  for (const malformed of [
    [...completed, ...completed],
    [...record(cls, "a", 1), ...record(cls, "b", 1), ...record(cls, "b", 0), ...record(cls, "a", 0)],
    [...record(cls, "a", -4)],
    [...record(cls, "a", -3), ...record(cls, "a", -3)],
  ]) {
    const parsed = instrumentationClassResults([...malformed, "INSTRUMENTATION_CODE: -1"].join("\n"), [cls]);
    assert.equal(parsed.results[0].status, "failed");
  }
});
