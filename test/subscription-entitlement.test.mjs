// Alpha client side of subscription entitlement (#410): signed short-lived entitlement
// verification, admission/outage/expiry behaviour, background refresh scheduling and Cloud
// limit retry copy. Plan names and allowance numbers here are synthetic test data, never
// product prices or quotas.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {
  FALLBACK_REFRESH_MS, ENTITLEMENT_AUDIENCE, ENTITLEMENT_TYPE, MAX_ENTITLEMENT_LIFETIME_MS, REFRESH_RETRY_MAX_MS, REFRESH_RETRY_MIN_MS,
  EntitlementError, EntitlementRefresher, allowanceText, checkEntitlement, clearEntitlementKeyCache, decodeEntitlement,
  describeSubscription, isEntitlementSignInFailure, nextRefreshDelay, readServiceLimit, serviceLimitMessage, subscriptionView, verifyEntitlement,
  fallbackPlanFromLimits, normalizeSubscriptionCode, planAdmission, redeemFailureMessage, redeemSuccessMessage, SubscriptionRedeemError,
} from '../apps/app/src/runtime/subscription-entitlement.ts';

const ISSUER = 'https://api.eliza.app';
const USER = '22222222-2222-4222-8222-222222222222';
const ORG = '44444444-4444-4444-8444-444444444444';
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const b64 = value => Buffer.from(typeof value === 'string' ? value : value).toString('base64url');
const json = value => b64(JSON.stringify(value));

async function keyPair(kid = 'k1') {
  const pair = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const jwk = {...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid};
  const sign = async (claims, header = {}) => {
    const input = `${json({alg: 'ES256', typ: ENTITLEMENT_TYPE, kid, ...header})}.${json(claims)}`;
    const signature = new Uint8Array(await webcrypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, pair.privateKey, Buffer.from(input)));
    return `${input}.${b64(signature)}`;
  };
  return {jwk, sign};
}
const claims = (overrides = {}) => ({
  iss: ISSUER, aud: ENTITLEMENT_AUDIENCE, sub: USER, org: ORG, jti: 'e-1',
  iat: NOW / 1000 - 60, exp: NOW / 1000 + 540,
  plan: {id: 'p-synthetic', name: 'Synthetic plan', status: 'active'},
  allowance: {unit: 'requests', period: 'month', limit: 40, used: 3, resetsAt: NOW / 1000 + 86400},
  services: ['inference', 'maps'], ...overrides,
});
const expected = {userId: USER, organizationId: ORG, issuer: ISSUER};
const rejects = async (promise, code) => assert.rejects(promise, error => error instanceof EntitlementError && error.code === code);

test('a Cloud-signed entitlement verifies and binds plan, allowance, services and refresh time', async () => {
  const {jwk, sign} = await keyPair();
  const entitlement = await verifyEntitlement(await sign(claims()), [jwk], expected, NOW);
  assert.equal(entitlement.plan.status, 'active');
  assert.equal(entitlement.plan.name, 'Synthetic plan');
  assert.deepEqual(entitlement.allowance, {unit: 'requests', period: 'month', limit: 40, used: 3, resetsAt: NOW + 86400000});
  assert.deepEqual(entitlement.services, ['inference', 'maps']);
  assert.equal(entitlement.expiresAt, NOW + 540000);
  // Default refresh at three quarters of the lifetime, before expiry.
  assert.equal(entitlement.refreshAt, NOW - 60000 + 450000);
  // Cloud may ask for an earlier refresh inside the lifetime.
  const early = await verifyEntitlement(await sign(claims({rfa: NOW / 1000 + 30})), [jwk], expected, NOW);
  assert.equal(early.refreshAt, NOW + 30000);
});

test('signature, key, algorithm and encoding failures are never trusted', async () => {
  const {jwk, sign} = await keyPair();
  const other = await keyPair();
  const token = await sign(claims());
  const [header, payload, signature] = token.split('.');
  await rejects(verifyEntitlement(`${header}.${json(claims({plan: {id: 'x', name: 'Upgraded', status: 'active'}}))}.${signature}`, [jwk], expected, NOW), 'signature');
  await rejects(verifyEntitlement(token, [other.jwk], expected, NOW), 'signature');
  await rejects(verifyEntitlement(token, [{...jwk, kid: 'k2'}], expected, NOW), 'unknown-key');
  await rejects(verifyEntitlement(token, [{...jwk, d: 'private'}], expected, NOW), 'signature');
  await rejects(verifyEntitlement(`${json({alg: 'none', typ: ENTITLEMENT_TYPE, kid: 'k1'})}.${payload}.${signature}`, [jwk], expected, NOW), 'unsupported');
  await rejects(verifyEntitlement(await sign(claims(), {alg: 'ES256', typ: 'JWT'}), [jwk], expected, NOW), 'unsupported');
  await rejects(verifyEntitlement(await sign(claims(), {crit: ['x']}), [jwk], expected, NOW), 'unsupported');
  for (const bad of ['', 'a.b', 'a.b.c.d', '!!.e30.e30', `${header}.${payload}.`]) assert.throws(() => decodeEntitlement(bad), EntitlementError);
});

test('account binding, issuer, audience and short lifetime are enforced', async () => {
  const {jwk, sign} = await keyPair();
  await rejects(verifyEntitlement(await sign(claims({sub: '33333333-3333-4333-8333-333333333333'})), [jwk], expected, NOW), 'account-mismatch');
  // UUID letter case alone is the same account, on either side.
  assert.equal((await verifyEntitlement(await sign(claims({sub: USER.toUpperCase(), org: ORG.toUpperCase()})), [jwk], expected, NOW)).plan.status, 'active');
  assert.equal((await verifyEntitlement(await sign(claims()), [jwk], {...expected, userId: USER.toUpperCase()}, NOW)).plan.status, 'active');
  await rejects(verifyEntitlement(await sign(claims({org: undefined})), [jwk], expected, NOW), 'account-mismatch');
  await rejects(verifyEntitlement(await sign(claims()), [jwk], {...expected, organizationId: null}, NOW), 'account-mismatch');
  await rejects(verifyEntitlement(await sign(claims({iss: 'https://api-staging.eliza.app'})), [jwk], expected, NOW), 'audience');
  await rejects(verifyEntitlement(await sign(claims({aud: 'another-client'})), [jwk], expected, NOW), 'audience');
  await rejects(verifyEntitlement(await sign(claims({exp: NOW / 1000 - 1, iat: NOW / 1000 - 120})), [jwk], expected, NOW), 'expired');
  await rejects(verifyEntitlement(await sign(claims({exp: NOW / 1000 - 60 + MAX_ENTITLEMENT_LIFETIME_MS / 1000 + 1})), [jwk], expected, NOW), 'lifetime');
  await rejects(verifyEntitlement(await sign(claims({nbf: NOW / 1000 + 300})), [jwk], expected, NOW), 'not-yet-valid');
  await rejects(verifyEntitlement(await sign(claims({plan: {id: 'p', name: 'P', status: 'unlimited'}})), [jwk], expected, NOW), 'malformed');
  await rejects(verifyEntitlement(await sign(claims({allowance: {unit: 'credits', period: 'month'}})), [jwk], expected, NOW), 'malformed');
  await rejects(verifyEntitlement(await sign(claims({plan: {id: 'p', name: 'Bad\u0007name', status: 'active'}})), [jwk], expected, NOW), 'malformed');
});

test('presentation uses only Cloud numbers and never mentions credits or top-ups', async () => {
  assert.equal(allowanceText(null), 'Plan allowance details are in Eliza Cloud.');
  assert.match(allowanceText({unit: 'requests', period: 'month', limit: 40, used: 3, resetsAt: null}), /^3 of 40 requests used this month\.$/);
  assert.match(allowanceText({unit: 'tokens', period: 'day', limit: null, used: null, resetsAt: null}), /^Plan allowance details are in Eliza Cloud\.$/);
  assert.doesNotMatch(allowanceText({unit: 'tokens', period: 'day', limit: null, used: 7, resetsAt: null}), /of/);
  const views = [
    {kind: 'checking'},
    {kind: 'active', planName: 'Synthetic plan', status: 'active', allowance: null, expiresAt: NOW, refreshFailed: false},
    {kind: 'active', planName: 'Synthetic plan', status: 'past_due', allowance: null, expiresAt: NOW, refreshFailed: true},
    {kind: 'inactive', planName: null, status: 'none', source: 'billing-limits'},
    {kind: 'inactive', planName: 'Synthetic plan', status: 'canceled', source: 'entitlement'},
    {kind: 'unavailable', reason: 'outage'}, {kind: 'unavailable', reason: 'not-published'}, {kind: 'unavailable', reason: 'invalid'},
    {kind: 'expired', planName: 'Synthetic plan'},
  ];
  for (const view of views) {
    const text = JSON.stringify(describeSubscription(view));
    assert.doesNotMatch(text, /credit|top.?up|\$|price|upgrade now/i, view.kind);
  }
  assert.equal(describeSubscription(views[3]).manage, true);
  assert.equal(describeSubscription(views[3]).headline, 'No active plan');
  assert.equal(describeSubscription(views[3]).manageLabel, 'Choose a plan');
  assert.match(describeSubscription(views[3]).detail, /Redeem a subscription code or choose a plan/);
  assert.equal(describeSubscription(views[4]).manageLabel, 'Choose a plan');
  assert.equal(describeSubscription(views[4]).headline, 'Synthetic plan has ended');
  assert.equal(describeSubscription(views[2]).manage, true);
  assert.match(describeSubscription(views[5]).detail, /Local apps and on-device speech keep working/);
  // Only an explicit no-plan answer stops Cloud-backed AI from starting.
});

function source({token = null, keys = [], fallback, fail, keyCalls = {n: 0}} = {}) {
  return {issuer: ISSUER,
    entitlement: async () => { if (fail) throw fail; return token; },
    entitlementKeys: async () => { keyCalls.n++; return keys; },
    ...(fallback === undefined ? {} : {fallbackPlan: async () => { if (fallback instanceof Error) throw fallback; return fallback; }})};
}
const signal = () => new AbortController().signal;
const exp = {userId: USER, organizationId: ORG};

test('admission check: outage, unpublished route, billing snapshot fallback, invalid token and account change', async () => {
  clearEntitlementKeyCache();
  const {jwk, sign} = await keyPair();
  const now = () => NOW;
  assert.deepEqual((await checkEntitlement(source({fail: Object.assign(Error('offline'))}), exp, signal(), now)).view, {kind: 'unavailable', reason: 'outage'});
  assert.deepEqual((await checkEntitlement(source({fail: {code: 'http', status: 503}}), exp, signal(), now)).view, {kind: 'unavailable', reason: 'outage'});
  assert.deepEqual((await checkEntitlement(source(), exp, signal(), now)).view, {kind: 'unavailable', reason: 'not-published'});
  // Entitlement route absent (404/405/501): the billing snapshot's subscription section, else unknown.
  assert.deepEqual((await checkEntitlement(source({fallback: {status: 'none', planName: null, periodEnd: null}}), exp, signal(), now)).view, {kind: 'inactive', planName: null, status: 'none', source: 'billing-limits'});
  assert.deepEqual((await checkEntitlement(source({fallback: {status: 'canceled', planName: 'Plus', periodEnd: NOW}}), exp, signal(), now)).view, {kind: 'inactive', planName: 'Plus', status: 'canceled', source: 'billing-limits'});
  assert.deepEqual((await checkEntitlement(source({fallback: {status: 'active', planName: 'Plus', periodEnd: NOW + 1000}}), exp, signal(), now)).view, {kind: 'active', planName: 'Plus', status: 'active', allowance: null, expiresAt: NOW + 1000, refreshFailed: false, source: 'billing-limits'});
  assert.deepEqual((await checkEntitlement(source({fallback: null}), exp, signal(), now)).view, {kind: 'unavailable', reason: 'not-published'});
  assert.deepEqual((await checkEntitlement(source({fallback: Object.assign(Error('503'), {status: 503})}), exp, signal(), now)).view, {kind: 'unavailable', reason: 'outage'});
  await assert.rejects(checkEntitlement(source({fail: Object.assign(Error('401'), {status: 401})}), exp, signal(), now));
  await assert.rejects(checkEntitlement(source({fallback: Object.assign(Error('changed'), {code: 'account-changed'})}), exp, signal(), now));
  await assert.rejects(checkEntitlement(source({token: await sign(claims({sub: '33333333-3333-4333-8333-333333333333'})), keys: [jwk]}), exp, signal(), now), error => error.code === 'account-mismatch');
  const other = await keyPair();
  clearEntitlementKeyCache();
  assert.deepEqual((await checkEntitlement(source({token: await sign(claims()), keys: [other.jwk]}), exp, signal(), now)).view, {kind: 'unavailable', reason: 'invalid'});
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(checkEntitlement(source({fail: Error('x')}), exp, aborted.signal, now));
});

test('signing keys are cached by issuer and refetched only for an unknown key id', async () => {
  clearEntitlementKeyCache();
  const {jwk, sign} = await keyPair();
  const keyCalls = {n: 0};
  const token = await sign(claims());
  for (let i = 0; i < 3; i++) assert.equal((await checkEntitlement(source({token, keys: [jwk], keyCalls}), exp, signal(), () => NOW)).view.kind, 'active');
  assert.equal(keyCalls.n, 1);
  const rotated = await keyPair('k2');
  await checkEntitlement(source({token: await rotated.sign(claims()), keys: [jwk, rotated.jwk], keyCalls}), exp, signal(), () => NOW);
  assert.equal(keyCalls.n, 2);
});

function fakeTimers(start = NOW) {
  let current = start;
  const t = {queue: [],
    now: () => current,
    setTimeout(handler, ms) { const item = {at: current + ms, handler}; t.queue.push(item); return item; },
    clearTimeout(item) { t.queue = t.queue.filter(other => other !== item); },
    async advance(ms) {
      const until = current + ms;
      for (;;) {
        t.queue.sort((a, b) => a.at - b.at);
        const next = t.queue[0];
        if (!next || next.at > until) break;
        t.queue.shift(); current = next.at; next.handler();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      current = until;
    }};
  return t;
}
const entitlementAt = (iat, exp, status = 'active') => ({id: 'e', keyId: 'k1', issuer: ISSUER, userId: USER, organizationId: ORG,
  plan: {id: 'p', name: 'Synthetic plan', status}, allowance: null, services: [], issuedAt: iat, expiresAt: exp, refreshAt: iat + Math.floor((exp - iat) * 0.75)});

test('refresh is scheduled from the entitlement, backs off on outage and reports expiry honestly', async () => {
  assert.equal(nextRefreshDelay(null, NOW, 0), null);
  assert.equal(nextRefreshDelay(entitlementAt(NOW, NOW + 400000), NOW, 0), 300000);
  assert.equal(nextRefreshDelay(null, NOW, 1), REFRESH_RETRY_MIN_MS);
  assert.equal(nextRefreshDelay(null, NOW, 2), REFRESH_RETRY_MIN_MS * 2);
  assert.equal(nextRefreshDelay(null, NOW, 50), REFRESH_RETRY_MAX_MS);

  const timers = fakeTimers();
  const views = [];
  let checks = 0, outcome = 'outage';
  const first = entitlementAt(NOW, NOW + 400000);
  const refresher = new EntitlementRefresher({timers, entitlement: first, onView: view => views.push(view),
    check: async () => { checks++; return outcome === 'ok' ? {view: subscriptionView(entitlementAt(timers.now(), timers.now() + 400000)), entitlement: entitlementAt(timers.now(), timers.now() + 400000)} : {view: {kind: 'unavailable', reason: 'outage'}, entitlement: null}; }});
  await timers.advance(299999);
  assert.equal(checks, 0, 'no refresh before refreshAt');
  await timers.advance(1);
  assert.equal(checks, 1);
  // Still valid: the plan stays shown, marked as not refreshed.
  assert.equal(views.at(-1).kind, 'active');
  assert.equal(views.at(-1).refreshFailed, true);
  await timers.advance(REFRESH_RETRY_MIN_MS);
  assert.equal(checks, 2);
  // Failures continue until the entitlement lapses; then the owner sees "expired", not a stale plan.
  await timers.advance(400000);
  assert.ok(views.some(view => view.kind === 'expired'));
  // Further failed refreshes keep reporting the lapsed plan as out of date, not as a plain outage.
  const failedBefore = checks;
  await timers.advance(REFRESH_RETRY_MAX_MS * 3);
  assert.ok(checks > failedBefore);
  assert.deepEqual(views.at(-1), {kind: 'expired', planName: 'Synthetic plan'});
  assert.equal(views.slice(views.findIndex(view => view.kind === 'expired')).every(view => view.kind === 'expired'), true);
  const afterExpiry = checks;
  outcome = 'ok';
  await timers.advance(REFRESH_RETRY_MAX_MS);
  assert.ok(checks > afterExpiry);
  assert.equal(views.at(-1).kind, 'active');
  assert.equal(views.at(-1).refreshFailed, false);
  refresher.stop();
  const stoppedAt = checks;
  await timers.advance(3600000);
  assert.equal(checks, stoppedAt);
  assert.equal(timers.queue.length, 0);
});

test('revocation to no plan stops refreshing, and a rejected sign-in stops the refresher', async () => {
  const timers = fakeTimers();
  const views = [];
  let checks = 0;
  new EntitlementRefresher({timers, entitlement: entitlementAt(NOW, NOW + 400000), onView: view => views.push(view),
    check: async () => { checks++; const entitlement = entitlementAt(NOW, NOW + 400000, 'canceled'); return {view: subscriptionView(entitlement), entitlement}; }});
  await timers.advance(3600000);
  assert.equal(checks, 1);
  assert.equal(views.at(-1).kind, 'inactive');

  const authTimers = fakeTimers();
  let auth = 0;
  new EntitlementRefresher({timers: authTimers, retry: true, onView: () => {}, onAuthFailure: () => auth++,
    check: async () => { throw Object.assign(Error('401'), {status: 401}); }});
  await authTimers.advance(3600000);
  assert.equal(auth, 1);
  assert.equal(authTimers.queue.length, 0);

  // An entitlement for another account during refresh is a sign-in failure, never an outage view.
  const mismatchTimers = fakeTimers();
  const refused = [];
  const mismatchViews = [];
  new EntitlementRefresher({timers: mismatchTimers, entitlement: entitlementAt(NOW, NOW + 400000), onView: view => mismatchViews.push(view), onAuthFailure: error => refused.push(error),
    check: async () => { throw new EntitlementError('account-mismatch'); }});
  await mismatchTimers.advance(3600000);
  assert.equal(refused.length, 1);
  assert.ok(isEntitlementSignInFailure(refused[0]));
  assert.deepEqual(mismatchViews, []);
  assert.equal(mismatchTimers.queue.length, 0);
  assert.ok(isEntitlementSignInFailure({status: 401}));
  assert.ok(isEntitlementSignInFailure({code: 'credentials-missing'}));
  assert.equal(isEntitlementSignInFailure(new EntitlementError('signature')), false);
  assert.equal(isEntitlementSignInFailure({status: 503}), false);

  // A Cloud without the route is not polled.
  const legacyTimers = fakeTimers();
  let legacyChecks = 0;
  new EntitlementRefresher({timers: legacyTimers, retry: true, onView: () => {}, check: async () => { legacyChecks++; return {view: {kind: 'unavailable', reason: 'not-published'}, entitlement: null}; }});
  await legacyTimers.advance(3600000);
  assert.equal(legacyChecks, 1);
});

test('Cloud limit refusals carry retry information and never imply a purchase or an automatic retry', () => {
  const rate = readServiceLimit({code: 'http', status: 429, data: {error: 'rate_limited', retryAfterSeconds: 42}}, NOW);
  assert.deepEqual(rate, {kind: 'rate-limited', retryAfterMs: 42000, resetsAt: null});
  assert.equal(serviceLimitMessage(rate, NOW), "The AI request rate limit was reached. Try again in about 42 seconds. Alpha Phone did not retry your message.");
  assert.equal(serviceLimitMessage(readServiceLimit({status: 429}, NOW), NOW), "The AI request rate limit was reached. Wait a moment before sending again. Alpha Phone did not retry your message.");
  assert.equal(serviceLimitMessage(null, NOW), "The AI request rate limit was reached. Wait a moment before sending again. Alpha Phone did not retry your message.");
  const terminal = readServiceLimit({failureKind: 'rate_limited', terminalFailure: {kind: 'rate_limited', retryAfterMs: 180000}}, NOW);
  assert.deepEqual(terminal, {kind: 'rate-limited', retryAfterMs: 180000, resetsAt: null});
  assert.match(serviceLimitMessage(terminal, NOW), /about 3 minutes/);
  const retryAt = readServiceLimit({failureKind: 'rate_limited', retryAt: new Date(NOW + 5000).toISOString()}, NOW);
  assert.equal(retryAt.retryAfterMs, 5000);
  const allowance = readServiceLimit({status: 429, data: {error: {code: 'allowance_exhausted', resetsAt: new Date(NOW + 86400000).toISOString()}}}, NOW);
  assert.equal(allowance.kind, 'allowance-exhausted');
  assert.equal(allowance.resetsAt, NOW + 86400000);
  assert.match(serviceLimitMessage(allowance, NOW), /allowance for this period is used up\. It resets .+\. Nothing is purchased automatically\. Local apps and on-device speech keep working\.$/);
  const subscription = readServiceLimit({status: 402, data: {error: 'subscription_required'}}, NOW);
  assert.equal(subscription.kind, 'subscription-required');
  assert.match(serviceLimitMessage(subscription, NOW), /active Eliza Cloud plan.*Nothing is purchased automatically/);
  // A bare 402 does not say whether a plan is missing or usage is spent: neutral billing copy.
  const bare = readServiceLimit({status: 402, data: {}}, NOW);
  assert.equal(bare.kind, 'billing-refused');
  assert.doesNotMatch(serviceLimitMessage(bare, NOW), /plan/i);
  // The pinned upstream reply shape (contracts chat.ts ChatTerminalFailure; chat-routes
  // terminalFailureContentValue keeps only kind, message, transient and code).
  const upstreamCredits = readServiceLimit({failureKind: 'insufficient_credits', terminalFailure: {kind: 'insufficient_credits', message: 'Synthetic upstream message', transient: false}}, NOW);
  assert.deepEqual(upstreamCredits, {kind: 'billing-refused', retryAfterMs: null, resetsAt: null});
  assert.match(serviceLimitMessage(upstreamCredits, NOW), /^Eliza Cloud declined this AI request for your account's billing\. .*did not retry your message, and nothing is purchased automatically\./);
  const upstreamRate = readServiceLimit({failureKind: 'rate_limited', terminalFailure: {kind: 'rate_limited', message: 'Synthetic', transient: true}}, NOW);
  assert.deepEqual(upstreamRate, {kind: 'rate-limited', retryAfterMs: null, resetsAt: null});
  assert.match(serviceLimitMessage(upstreamRate, NOW), /Wait a moment before sending again/);
  // A specific Cloud code carried in terminalFailure.code is preferred over the generic kind.
  assert.equal(readServiceLimit({failureKind: 'insufficient_credits', terminalFailure: {kind: 'insufficient_credits', message: 'm', transient: false, code: 'allowance_exhausted'}}, NOW).kind, 'allowance-exhausted');
  assert.equal(readServiceLimit({failureKind: 'insufficient_credits', terminalFailure: {kind: 'insufficient_credits', message: 'm', transient: false, code: 'subscription_required'}}, NOW).kind, 'subscription-required');
  assert.equal(readServiceLimit({failureKind: 'provider_error'}, NOW), null);
  assert.equal(readServiceLimit({status: 500, data: {}}, NOW), null);
  assert.equal(readServiceLimit('rate_limited', NOW), null);
  // A retry hint beyond a day is not shown as a countdown.
  assert.equal(readServiceLimit({status: 429, data: {retryAfterSeconds: 999999}}, NOW).retryAfterMs, null);
  for (const limit of [rate, allowance, subscription, bare, upstreamCredits]) assert.doesNotMatch(serviceLimitMessage(limit, NOW), /credit|top.?up|upgrade|buy/i);
});

test('only admission and its background refresher read the entitlement; turns and local speech never do', () => {
  const ui = fs.readFileSync('apps/app/src/runtime/connection-ui.tsx', 'utf8');
  const admission = ui.slice(ui.indexOf('async function admitCloudResident'), ui.indexOf('async function connectResident'));
  assert.ok(admission.includes('checkEntitlement('));
  assert.equal(ui.split('checkEntitlement(').length, admission.split('checkEntitlement(').length, 'checkEntitlement is called only during admission/refresh');
  // Every Cloud detach stops background refresh; the send path never reads billing.
  const detach = ui.slice(ui.indexOf('function detachService()'), ui.indexOf('async function verifyService'));
  assert.match(detach, /^function detachService\(\) \{ stopEntitlementRefresh\(\);/);
  assert.match(ui.slice(ui.indexOf('function stopEntitlementRefresh'), ui.indexOf('function detachService()')), /entitlementRefresher\?\.stop\(\);entitlementRefresher=null;/);
  const send = ui.slice(ui.indexOf('  async send('), ui.indexOf('export function ConnectionChooser'));
  assert.ok(send.length > 1000, 'send path located');
  assert.doesNotMatch(send, /creditBalance|legacyAccountUsable|billingFallbackPlan|redeemSubscriptionCode|entitlementSource|subscriptionEntitlement|ENTITLEMENT_PATH|credits\/balance|subscription\/entitlement/);
  const importers = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) walk(path); else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && /subscription-entitlement/.test(fs.readFileSync(path, 'utf8'))) importers.push(path); } };
  walk('apps/app/src');
  assert.deepEqual(importers.sort(), ['apps/app/src/runtime/cloud-protocol.ts', 'apps/app/src/runtime/connection-ui.tsx', 'apps/app/src/runtime/subscription-entitlement.ts']);
  // The production account panel no longer offers a credit balance or top-up.
  for (const file of ['apps/app/src/runtime/connection-ui.tsx', 'apps/app/src/prototype/settings-adapter.ts', 'apps/app/src/runtime/cloud-voice.ts', 'apps/app/src/runtime/voice-selection.ts']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /Add credits|Credits available|Check credits|residentTopUp|openTopUp|uses credits|uses its credits|needs credits/, file);
  }
});

test('expired signed entitlement is unavailable billing, never expired sign-in', async () => {
  clearEntitlementKeyCache();
  assert.equal(isEntitlementSignInFailure(new EntitlementError('expired')), false);
  assert.equal(isEntitlementSignInFailure({code: 'expired'}), true);
  const {jwk, sign} = await keyPair();
  const token = await sign(claims({iat: NOW / 1000 - 600, exp: NOW / 1000 - 1}));
  const result = await checkEntitlement(source({token, keys: [jwk]}), exp, signal(), () => NOW);
  assert.deepEqual(result.view, {kind: 'unavailable', reason: 'invalid'});
});

test('cached tokens past their refresh hint cannot cause a zero-delay refresh loop', async () => {
  const timers = fakeTimers();
  const entitlement = entitlementAt(NOW - 300000, NOW + 100000);
  let checks = 0;
  const refresher = new EntitlementRefresher({timers, entitlement, onView: () => {}, check: async () => {checks++; return {view: subscriptionView(entitlement), entitlement};}});
  await timers.advance(90000);
  assert.equal(checks, 3);
  refresher.stop();
  for (const status of ['none', 'canceled']) assert.equal(nextRefreshDelay(entitlementAt(NOW, NOW + 100000, status), NOW, 0), null);
});

test('plan gate decisions: active/trialing admit, past_due admits with a warning, canceled/none and unknown need a plan', () => {
  const active = status => ({kind: 'active', planName: 'Synthetic plan', status, allowance: null, expiresAt: NOW, refreshFailed: false});
  assert.equal(planAdmission(active('active')), 'admit');
  assert.equal(planAdmission(active('trialing')), 'admit');
  assert.equal(planAdmission(active('past_due')), 'admit-with-warning');
  assert.match(describeSubscription(active('past_due')).detail, /Payment is past due/);
  assert.equal(describeSubscription(active('past_due')).manage, true);
  for (const status of ['canceled', 'none']) assert.equal(planAdmission({kind: 'inactive', planName: null, status, source: 'entitlement'}), 'needs-plan');
  for (const reason of ['outage', 'not-published', 'invalid']) assert.equal(planAdmission({kind: 'unavailable', reason}), 'unknown');
  assert.equal(planAdmission(null), 'unknown');
  assert.equal(planAdmission({kind: 'checking'}), 'unknown');
  assert.equal(planAdmission({kind: 'expired', planName: 'x'}), 'unknown');
});

test('billing snapshot fallback reads only known subscription states', () => {
  const limits = subscription => ({success: true, data: {v2: {subscription}}});
  const value = (state, extra = {}) => limits({status: 'available', value: {planKey: 'plus_monthly', state, currentPeriodEnd: '2026-11-12T00:00:00.000Z', ...extra}});
  assert.deepEqual(fallbackPlanFromLimits(value('active')), {status: 'active', planName: 'Plus', periodEnd: Date.parse('2026-11-12T00:00:00.000Z')});
  assert.equal(fallbackPlanFromLimits(value('trialing')).status, 'trialing');
  for (const state of ['past_due', 'grace', 'unpaid']) assert.equal(fallbackPlanFromLimits(value(state)).status, 'past_due', state);
  for (const state of ['canceled', 'incomplete_expired']) assert.equal(fallbackPlanFromLimits(value(state)).status, 'canceled', state);
  for (const state of ['pending', 'incomplete', 'paused', 'unknown', 7]) assert.equal(fallbackPlanFromLimits(value(state)), null, String(state));
  assert.deepEqual(fallbackPlanFromLimits(limits({status: 'not_applicable', reason: 'no_organization_subscription'})), {status: 'none', planName: null, periodEnd: null});
  assert.equal(fallbackPlanFromLimits(limits({status: 'unavailable', error: {code: 'x'}})), null);
  assert.equal(fallbackPlanFromLimits({success: true, data: {}}), null);
  assert.equal(fallbackPlanFromLimits(null), null);
  assert.equal(fallbackPlanFromLimits(value('active', {planKey: 'unlisted_plan', currentPeriodEnd: 'not a date'})).planName, null);
});

test('subscription codes normalize like Cloud and failures share generic copy that never echoes the code', () => {
  assert.equal(normalizeSubscriptionCode('  abcd-efgh-jkmn-pqrs '), 'ABCDEFGHJKMNPQRS');
  assert.equal(normalizeSubscriptionCode('ABCD EFGH JKMN PQRS'), 'ABCDEFGHJKMNPQRS');
  // Crockford read aliases: O is 0, I and L are 1.
  assert.equal(normalizeSubscriptionCode('oooo-iiii-llll-0000'), '0000111111110000');
  for (const bad of ['', 'short', 'ABCD-EFGH-JKMN-PQR', 'ABCD_EFGH_JKMN_PQRS', 'ABCD-EFGH-JKMN-PQRS!', 'x'.repeat(129), null]) assert.equal(normalizeSubscriptionCode(bad), null, String(bad));
  const secret = 'ABCD-EFGH-JKMN-PQRS';
  for (const error of [new SubscriptionRedeemError('invalid'), new SubscriptionRedeemError('already-redeemed'), new SubscriptionRedeemError('rate-limited', 90_000), new SubscriptionRedeemError('unavailable'), new SubscriptionRedeemError('account'), new Error(secret)]) {
    const text = redeemFailureMessage(error);
    assert.doesNotMatch(text, /ABCD|EFGH/);
    assert.doesNotMatch(`${error instanceof SubscriptionRedeemError ? error.message : ''}`, /ABCD/);
  }
  assert.equal(redeemFailureMessage(new SubscriptionRedeemError('invalid')), 'This code could not be redeemed. Check the code and try again.');
  assert.match(redeemFailureMessage(new SubscriptionRedeemError('rate-limited', 90_000)), /^Too many attempts\. Try again in about 2 minutes\.$/);
  assert.match(redeemFailureMessage(new SubscriptionRedeemError('rate-limited', null)), /Try again in about 60 seconds/);
  assert.match(redeemSuccessMessage({replayed: false, grantEndsAt: Date.UTC(2027, 3, 14), paidPlanTakesPrecedence: false, planName: 'Plus'}), /^Code redeemed for Plus\. It runs until /);
  assert.match(redeemSuccessMessage({replayed: true, grantEndsAt: null, paidPlanTakesPrecedence: true, planName: null}), /current paid plan stays in effect/);
});

test('an outage retry answered by the billing snapshot switches to periodic checks', async () => {
  const timers = fakeTimers();
  const views = [];let checks = 0;
  const refresher = new EntitlementRefresher({timers, retry: true, onView: view => views.push(view), check: async () => {checks++; return {view: {kind: 'active', planName: 'Plus', status: 'active', allowance: null, expiresAt: 0, refreshFailed: false, source: 'billing-limits'}, entitlement: null};}});
  await timers.advance(REFRESH_RETRY_MAX_MS * 4);
  assert.equal(checks, 4);
  assert.equal(views.at(-1).source, 'billing-limits');
  refresher.refreshNow();await timers.advance(0);
  assert.equal(checks, 5, 'refreshNow checks again on return');
  refresher.stop();refresher.refreshNow();
  assert.equal(checks, 5, 'a stopped refresher never checks');
});


test('active billing snapshots refresh without foreground events, recover outages, and observe cancellation', async () => {
  const timers = fakeTimers(), views = [];
  let checks = 0;
  let result = {view: {kind: 'active', source: 'billing-limits', planName: 'Plus', status: 'active', allowance: null, expiresAt: NOW + 86400000, refreshFailed: false}, entitlement: null};
  const refresher = new EntitlementRefresher({timers, fallbackActive: true, onView: view => views.push(view), check: async () => { checks++; return result; }});
  await timers.advance(FALLBACK_REFRESH_MS - 1);
  assert.equal(checks, 0);
  await timers.advance(1);
  assert.equal(checks, 1);
  assert.equal(views.at(-1).kind, 'active');
  result = {view: {kind: 'unavailable', reason: 'outage'}, entitlement: null};
  await timers.advance(FALLBACK_REFRESH_MS);
  assert.equal(checks, 2);
  assert.equal(views.at(-1).kind, 'unavailable');
  result = {view: {kind: 'inactive', source: 'billing-limits', status: 'canceled', planName: 'Plus'}, entitlement: null};
  await timers.advance(REFRESH_RETRY_MIN_MS);
  assert.equal(checks, 3);
  assert.equal(views.at(-1).kind, 'inactive');
  await timers.advance(FALLBACK_REFRESH_MS * 3);
  assert.equal(checks, 3);
  assert.equal(timers.queue.length, 0);
  refresher.stop();
});

test('billing snapshot refresh adopts signed scheduling and discards a late result after detach', async () => {
  const timers = fakeTimers(), views = [];
  let checks = 0, release;
  const signed = entitlementAt(NOW + FALLBACK_REFRESH_MS, NOW + FALLBACK_REFRESH_MS + 400000);
  const refresher = new EntitlementRefresher({timers, fallbackActive: true, onView: view => views.push(view), check: async () => {
    checks++;
    if (checks === 1) return {view: subscriptionView(signed), entitlement: signed};
    return new Promise(resolve => { release = resolve; });
  }});
  await timers.advance(FALLBACK_REFRESH_MS);
  assert.equal(refresher.current, signed);
  assert.equal(timers.queue[0].at, signed.refreshAt);
  await timers.advance(signed.refreshAt - timers.now());
  assert.equal(checks, 2);
  refresher.stop();
  release({view: {kind: 'inactive', status: 'canceled', source: 'billing-limits', planName: 'Plus'}, entitlement: null});
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(views.length, 1);
  assert.equal(timers.queue.length, 0);
});
