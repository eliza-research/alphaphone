// Eliza Cloud operator values and the credential-free readiness probe (docs/human-actions.md H-11 to
// H-16). A stubbed fetch stands in for Cloud; nothing here contacts a network, signs in or sends a code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CALLBACK_PATH, STEWARD_APP_CLIENT, formatProbe, main, probe, productRegistration, registrationValues } from "../scripts/cloud-readiness.mjs";
import { fingerprint } from "../scripts/render-assetlinks.mjs";

const root = path.resolve(import.meta.dirname, "..");
const RELEASE = "c3".repeat(32);
const javaDir = path.join(root, "android/app/src/main/java/ai/elizaresearch/alphaphone");
const javaSource = fs.readdirSync(javaDir).filter(name => name.endsWith(".java")).map(name => fs.readFileSync(path.join(javaDir, name), "utf8")).join("\n");

test("registration values come from the committed product configuration and match the native sign-in registration", () => {
  const registration = productRegistration(root, "production");
  const identity = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8"));
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "config/cloud-deployment.json"), "utf8")).production;
  assert.equal(registration.clientId, identity.appId);
  assert.equal(registration.callback, `${deployment.web}${CALLBACK_PATH}`);
  assert.equal(registration.tenant, deployment.tenant);
  assert.equal(registration.entitlementAudience, deployment.entitlementAudience);
  // The native client and the App Link filter register exactly these values.
  assert.ok(javaSource.includes(`"${identity.appId}"`), "the App Auth client ID is the package");
  assert.ok(javaSource.includes(`"${CALLBACK_PATH}"`), "the callback path");
  assert.ok(javaSource.includes(`"${STEWARD_APP_CLIENT}"`), "the Steward app client for native Google");
  assert.match(fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8"), new RegExp(`android:path="${CALLBACK_PATH}"`));

  const values = registrationValues(registration);
  assert.deepEqual(values.map(row => row.step), ["H-11", "H-12", "H-12", "H-13", "H-13", "H-15"]);
  assert.deepEqual(values[0].value, { clientId: identity.appId, appId: "<UUID of Alpha's active, approved Cloud apps row>", redirectUri: "https://eliza.app/alphaphone/auth/callback", enabled: true });
  assert.deepEqual(values[1].value.body, { url: "https://eliza.app/alphaphone/auth/callback" });
  assert.equal(values[1].value.url, `https://api.eliza.app/steward/tenants/${deployment.tenant}/redirect-urls`);
  assert.deepEqual(Object.keys(values[2].value), [STEWARD_APP_CLIENT]);
  assert.deepEqual(values[4].value, { redirectUri: "https://eliza.app/alphaphone/auth/callback", androidPackage: identity.appId, appName: identity.appName });
  // Operator-only facts are named, never invented: no UUID or Google client ID appears.
  const text = JSON.stringify(values);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  assert.doesNotMatch(text, /[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/);
  const staging = productRegistration(root, "staging");
  assert.equal(staging.callback, "https://staging.eliza.app/alphaphone/auth/callback");
  assert.equal(staging.tenant, "elizacloud-staging");
});

/** A Cloud stand-in. `overrides` replaces the answer for a path; every request is recorded. */
function cloud({ registration, overrides = {} }) {
  const calls = [];
  const json = (status, body, headers = {}) => ({ status, headers: new Headers({ "content-type": "application/json", ...headers }), text: async () => JSON.stringify(body) });
  const statement = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: registration.packageName, sha256_cert_fingerprints: [fingerprint(RELEASE)] } }];
  const document = { title: "Terms", revision: "2026-10-01", sections: [{ title: "Use", paragraphs: ["Text."] }] };
  const answers = {
    "/api/v1/app-auth/mobile/config": () => json(200, { success: true, clientId: registration.clientId, environment: registration.environment, redirectUri: registration.callback, codeChallengeMethod: "S256" }),
    "/steward/auth/providers": () => json(200, { ok: true, email: true, sms: false, google: true, googleNative: true }),
    "/steward/auth/email/code/send": () => json(400, { ok: false, error: "email is required" }),
    "/steward/auth/oauth/google/authorize": () => ({ status: 302, headers: new Headers({ location: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }), text: async () => "" }),
    "/.well-known/assetlinks.json": () => json(200, statement),
    [CALLBACK_PATH]: () => ({ status: 200, headers: new Headers({ "content-type": "text/html" }), text: async () => "<!doctype html>" }),
    "/api/public/service": () => json(200, { success: true, version: 1, service: { name: "Eliza Cloud", terms: document, privacy: { ...document, title: "Privacy" } } }),
    "/api/v1/subscription/entitlement-keys": () => json(200, { keys: [{ kty: "EC", crv: "P-256", kid: "entitlement-production-2026-10", x: "x", y: "y", alg: "ES256" }] }),
    "/api/v1/maps/capabilities": () => json(401, { error: "authentication_required" }),
    ...overrides,
  };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, method: init.method ?? "GET", redirect: init.redirect, body: init.body });
    const answer = answers[parsed.pathname];
    if (!answer) throw new Error(`unexpected request ${url}`);
    return answer(parsed, init);
  };
  return { calls, fetchImpl };
}

test("a fully configured deployment passes every gate with one request each and no credential", async () => {
  const registration = { ...productRegistration(root, "production"), signerSha256: RELEASE };
  const { calls, fetchImpl } = cloud({ registration });
  const gates = await probe(registration, { fetchImpl });
  assert.deepEqual(gates.map(row => [row.gate, row.step, row.passed]), [
    ["registration", "H-11", true], ["email sign-in", "H-12", true], ["native Google", "H-12", true], ["browser return", "H-12", true],
    ["App Links", "H-13", true], ["callback page", "H-13", true], ["service documents", "H-14", true], ["entitlement keys", "H-15", true], ["Maps route", "H-16", true],
  ]);
  assert.equal(calls.length, 9);
  assert.ok(calls.every(call => call.redirect === "manual"), "no redirect is followed");
  for (const call of calls) {
    assert.equal(call.url.protocol, "https:");
    assert.doesNotMatch(call.url.href, /token|apiKey|api_key|password/i, "no credential in any request");
  }
  const email = calls.find(call => call.url.pathname === "/steward/auth/email/code/send");
  assert.equal(email.method, "POST");
  assert.equal(email.body, "{}", "the email route probe names no address, so no email can be sent");
  const authorize = calls.find(call => call.url.pathname === "/steward/auth/oauth/google/authorize").url.searchParams;
  assert.equal(authorize.get("redirect_uri"), registration.callback);
  assert.equal(authorize.get("tenant_id"), registration.tenant);
  assert.equal(authorize.get("code_challenge_method"), "S256");
  assert.match(authorize.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorize.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(formatProbe(registration, gates), /Every gate passes\. This is deployment configuration evidence only/);
});

test("each observed deployment gap fails its own gate and names its step", async () => {
  const registration = { ...productRegistration(root, "production"), signerSha256: "unset" };
  const json = (status, body) => ({ status, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) });
  const { fetchImpl } = cloud({ registration, overrides: {
    // The October 24 observations: an inactive registration, a tenant allowlist refusal and a development-only association.
    "/api/v1/app-auth/mobile/config": () => json(503, { success: false, error: "Configured mobile App Auth app is not active and approved" }),
    "/steward/auth/providers": () => json(200, { ok: true, email: true, google: true, googleNative: false, captcha: { enabled: true, requiredFor: ["email_otp"] } }),
    "/steward/auth/oauth/google/authorize": () => json(400, { error: "redirect_uri is not allowed for this tenant" }),
    "/api/public/service": () => json(503, { error: "not configured" }),
    "/api/v1/subscription/entitlement-keys": () => json(503, { error: "not configured" }),
    "/api/v1/maps/capabilities": () => json(404, {}),
  } });
  const gates = await probe(registration, { fetchImpl });
  const byGate = Object.fromEntries(gates.map(row => [row.gate, row]));
  assert.ok(gates.every(row => !row.passed || row.gate === "callback page"));
  assert.match(byGate.registration.detail, /HTTP 503: Configured mobile App Auth app is not active and approved/);
  assert.match(byGate["email sign-in"].detail, /not offered \(or behind a captcha\)/);
  assert.match(byGate["native Google"].detail, /STEWARD_GOOGLE_NATIVE_CLIENT_IDS/);
  assert.match(byGate["browser return"].detail, /redirect_uri is not allowed for this tenant/);
  assert.match(byGate["App Links"].detail, /H-09/);
  assert.match(byGate["service documents"].detail, /CLOUD_PUBLIC_SERVICE_JSON/);
  assert.match(byGate["entitlement keys"].detail, /ELIZA_ENTITLEMENT_/);
  assert.match(byGate["Maps route"].detail, /HTTP 404/);
  // Malformed documents and keys never count as published.
  const malformed = cloud({ registration: { ...registration, signerSha256: RELEASE }, overrides: {
    "/api/public/service": () => json(200, { success: true, version: 1, service: { name: "Eliza Cloud", terms: "<p>html</p>", privacy: {} } }),
    "/api/v1/subscription/entitlement-keys": () => json(200, { keys: [{ kty: "RSA", kid: "k" }, { kty: "EC", crv: "P-256", kid: "private", d: "secret" }] }),
  } });
  const second = Object.fromEntries((await probe({ ...registration, signerSha256: RELEASE }, { fetchImpl: malformed.fetchImpl })).map(row => [row.gate, row]));
  assert.equal(second["service documents"].passed, false);
  assert.equal(second["entitlement keys"].passed, false);
  // An unreachable Cloud fails closed.
  const down = await probe(registration, { fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  assert.ok(down.every(row => !row.passed));
  assert.match(down[0].detail, /unreachable \(getaddrinfo ENOTFOUND\)/);
});

test("staging, which serves only debug-signed test-mocks builds, needs some grant unless a build's certificate is named", async () => {
  const registration = { ...productRegistration(root, "staging"), signerSha256: "unset" };
  const DEBUG = "d4".repeat(32);
  const json = body => ({ status: 200, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify(body) });
  const grant = value => [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: registration.packageName, sha256_cert_fingerprints: [fingerprint(value)] } }];
  const links = async (document, options = {}) => (await probe(registration, { ...options, fetchImpl: cloud({ registration, overrides: { "/.well-known/assetlinks.json": () => json(document) } }).fetchImpl })).find(row => row.gate === "App Links");
  const any = await links(grant(DEBUG));
  assert.equal(any.passed, true);
  assert.match(any.detail, /debug-signed test-mocks builds/);
  assert.equal((await links([])).passed, false);
  assert.equal((await links(grant(DEBUG), { signer: DEBUG })).passed, true);
  assert.equal((await links(grant(DEBUG), { signer: RELEASE })).passed, false);
  // Production never accepts "any grant": the recorded release signer decides.
  const production = { ...productRegistration(root, "production"), signerSha256: RELEASE };
  const gates = await probe(production, { fetchImpl: cloud({ registration: production, overrides: { "/.well-known/assetlinks.json": () => json(grant(DEBUG)) } }).fetchImpl });
  assert.equal(gates.find(row => row.gate === "App Links").passed, false);
});

test("the CLI prints registration values offline, probes through an injected fetch and refuses unknown options", async () => {
  const out = [], err = [];
  const io = { root, log: line => out.push(line), error: line => err.push(line) };
  assert.equal(await main(["registration", "--json"], { ...io, fetchImpl: async () => { throw new Error("registration must not fetch"); } }), 0);
  const printed = JSON.parse(out.pop());
  assert.equal(printed.registration.environment, "production");
  assert.equal(printed.values.length, 6);
  assert.equal(await main(["registration", "--environment", "staging"], io), 0);
  assert.match(out.pop(), /elizacloud-staging/);
  const registration = productRegistration(root, "production");
  const { fetchImpl } = cloud({ registration: { ...registration, signerSha256: registration.signerSha256 } });
  const code = await main(["probe", "--json"], { ...io, fetchImpl });
  // The committed release signer decides the App Links gate: it stays open until H-09 records it.
  assert.equal(code, registration.signerSha256 === "unset" ? 1 : 0);
  assert.equal(JSON.parse(out.pop()).gates.length, 9);
  for (const argv of [[], ["probe", "--environment", "dev"], ["registration", "--json", "--extra"], ["status"], ["registration", "--signer", RELEASE], ["probe", "--signer", "abc"]]) assert.equal(await main(argv, io), 2);
});
