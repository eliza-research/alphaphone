// Core loops A–F and J01–J05 on the FLAG-OFF bundle (the bytes the distribution APKs package).
//
// The journey-*.spec.ts files run the development profile: development agent, development device
// actions, development mailbox, development vault and development scheduler. None of those exist
// in this build. These tests state what the shipped renderer does instead, per loop:
//  - on Android (the Capacitor bridge is replaced by an in-page stub, as the other
//    *.production.spec.ts files do) with a funded Eliza Cloud account and the resident agent, and
//  - in the web build, signed out.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The stub is not the
// native plugins, the resident runtime, Eliza Cloud, Android Clock, a WebView or a device. A pass
// says the shipped renderer takes the real path or shows an honest unavailable state; it never
// says the native side of that path works. See docs/core-loop-audit.md.
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const SELECTION = 'alpha.connection.selection.v1';
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** No mock, fixture or development surface, whatever the loop. */
async function expectNoDevelopmentSurface(page: Page) {
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  await expect(page.locator('.alpha-dev-tools')).toHaveCount(0);
  await expect(button(page, 'Device controls')).toHaveCount(0);
  await expect(page.getByText(/Development (connections|device actions|reply|provider)/)).toHaveCount(0);
}
/** Aborts and records every request that leaves the preview server (test-owned hosts excepted). */
async function fenceNetwork(page: Page, allowed: string[] = []) {
  const foreign: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol) || allowed.includes(url.hostname)) return route.fallback();
    foreign.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  return foreign;
}

/** Production Android as the renderer sees it: funded Cloud account, packaged resident agent that
 * keeps its conversations across a page reload, and an intercepted Clock handoff. */
async function android(page: Page, options: { clock?: 'opened' | 'unavailable' | 'unknown' } = {}) {
  await page.addInitScript(({ options }) => {
    const w = window as any; w.androidBridge = {};
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5', agentId = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';
    const kept = (key: string, initial: unknown) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? initial; } catch { return initial; } };
    // Keystore-backed slots and the resident agent's own store both survive a reload of the page.
    const slots: Record<string, string> = kept('core-loops-slots', { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id, expiresAt: Date.now() + 86_400_000 }) });
    const agent: { conversations: { id: string; title: string }[]; history: Record<string, any[]> } = kept('core-loops-agent', { conversations: [], history: {} });
    const persist = () => { sessionStorage.setItem('core-loops-slots', JSON.stringify(slots)); sessionStorage.setItem('core-loops-agent', JSON.stringify(agent)); };
    const f = w.coreLoops = { calls: [] as string[], posts: [] as string[], views: [] as string[], streams: 0, cancelled: 0, aborts: 0, clock: [] as unknown[], hold: false, release: null as null | (() => void), unexpected: [] as string[] };
    const listeners: Array<{ plugin: string; event: string; callback: (value: unknown) => void }> = [];
    const emit = (streamId: string, event: unknown) => listeners.filter(l => l.plugin === 'Agent' && l.event === 'alphaAgentStream').forEach(l => l.callback({ streamId, event }));
    const data = (streamId: string, value: unknown) => emit(streamId, { type: 'chunk', dataBase64: btoa('data: ' + JSON.stringify(value) + '\n\n') });
    const request = (method: string, path: string, body: any, headers: Record<string, string>): { status: number; data: unknown } => {
      const ok = (value: unknown) => ({ status: 200, data: value });
      if (path === '/api/auth/me') return ok({ identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Alpha', status: 'running' }] });
      if (path === '/api/client-devices/register') return ok({ installationId: headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
      if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
      if (path === '/api/workflow/status') return ok({ status: 'unavailable' });
      if (path === '/api/conversations' && method === 'POST') { const row = { id: 'resident-chat-' + (agent.conversations.length + 1), title: String(body.title || 'Alpha Phone') }; agent.conversations.push(row); agent.history[row.id] = []; persist(); return ok({ conversation: row }); }
      if (path === '/api/conversations') return ok({ conversations: agent.conversations });
      const history = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path.split('?')[0]);
      if (history && method === 'GET') return ok({ messages: (agent.history[history[1]] || []).slice(-200) });
      if (/^\/api\/turns\/[^/]+\/abort$/.test(path)) { f.aborts++; return { status: 404, data: {} }; }
      f.unexpected.push(method + ' ' + path); return { status: 404, data: {} };
    };
    const promise = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    const withListeners = (names: string[]) => [...promise(names), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }];
    w.Capacitor = {
      PluginHeaders: [
        { name: 'DeviceApps', methods: promise(['buildInfo']) },
        { name: 'DailyApps', methods: withListeners(['surfaceInfo', 'clockHandoff']) },
        { name: 'Agent', methods: withListeners(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request', 'providerStatus', 'requestStream', 'cancelStream']) },
        { name: 'AlphaConnection', methods: promise(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
        { name: 'AlphaActionJournal', methods: promise(['list', 'get']) },
        { name: 'AlphaNotifications', methods: promise(['status', 'crossAppStatus']) },
        { name: 'AlphaVoiceCloud', methods: promise(['checkPermissions']) },
      ],
      nativeCallback: (plugin: string, method: string, input: any, callback: (value: unknown) => void) => { if (method === 'addListener') listeners.push({ plugin, event: input?.eventName, callback }); return String(listeners.length); },
      nativePromise: async (plugin: string, method: string, input: any) => {
        f.calls.push(plugin + '.' + method);
        if (plugin === 'DeviceApps') return { launcher: true, version: 'core-loops' };
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaActionJournal') return method === 'list' ? { entries: [] } : { entry: null };
        if (plugin === 'DailyApps') {
          if (method === 'surfaceInfo') return { developmentBuild: false, assistant: false };
          f.clock.push(input);
          if (options.clock === 'unknown') return { action: input.action, status: 'unknown', message: 'Clock result is unknown. Check Clock before repeating the request.' };
          return options.clock === 'unavailable' ? { action: input.action, status: 'unavailable', message: 'No Clock app can handle this request.' }
            : { action: input.action, status: 'opened', message: 'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.' };
        }
        if (plugin === 'Agent') {
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          if (method === 'providerStatus') return { provider: 'elizacloud', configured: true, model: 'cerebras/qwen-3.8-27b' };
          if (method === 'request') { const result = request(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {}, input.headers || {}); return { status: result.status, body: JSON.stringify(result.data) }; }
          if (method === 'cancelStream') { f.cancelled++; return {}; }
          if (method === 'requestStream') {
            // The resident agent records the user turn, then streams its reply over native IPC.
            const conversation = /^\/api\/conversations\/([^/]+)\/messages\/stream$/.exec(input.path)![1], body = JSON.parse(input.body), streamId = input.streamId as string;
            f.streams++; f.posts.push(String(body.text).split('[USER MESSAGE]\n').pop()); f.views.push(/"view":"([a-z-]+)"/.exec(String(body.text))?.[1] ?? '');
            agent.history[conversation].push({ id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() }); persist();
            const reply = 'Resident reply ' + f.streams;
            const finish = () => {
              agent.history[conversation].push({ id: crypto.randomUUID(), role: 'assistant', text: reply, timestamp: Date.now() + 1 }); persist();
              data(streamId, { type: 'token', text: reply }); data(streamId, { type: 'done', fullText: reply, agentName: 'Alpha' }); emit(streamId, { type: 'complete' });
            };
            setTimeout(() => { emit(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } }); if (f.hold) f.release = finish; else finish(); }, 0);
            return { streamId };
          }
          return {};
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: slots[input.slot] ?? null };
          if (method === 'secureWrite') { slots[input.slot] = input.value; persist(); return {}; }
          if (method === 'secureRemove') { delete slots[input.slot]; persist(); return {}; }
          if (method === 'secureCompareExchange') { if ((slots[input.slot] ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) delete slots[input.slot]; else slots[input.slot] = input.value; persist(); return { status: 'saved' }; }
          if (method === 'request') {
            const url = new URL(input.url);
            if (url.origin !== 'https://api.eliza.app') throw Error('Connection request failed');
            if (url.pathname === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
            if (url.pathname === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
            if (url.pathname === '/api/v1/credits/balance') return { status: 200, data: { balance: 5 } };
            return { status: 404, data: {} };
          }
          return {};
        }
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation ' + plugin + '.' + method);
      },
    };
  }, { options });
}
const native = <T>(page: Page, read: (f: any) => T) => page.evaluate(`(${read.toString()})(window.coreLoops)`) as Promise<T>;
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
/** A funded resident account connects by itself; no Welcome dialog and no chooser remain. */
async function residentHome(page: Page) {
  await page.goto('/');
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await expect(button(page, 'Notes')).toBeVisible();
}

test('loop A on Android: the resident agent answers, the conversation follows across apps, Stop is honest and a restart restores it without any development control', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  // The signed-in account configures inference for the resident agent; Cloud is never the agent runtime.
  const startup = await native(page, f => f.calls.filter((call: string) => call.startsWith('Agent.')));
  expect(startup.indexOf('Agent.configureCloudProvider')).toBeGreaterThan(-1);
  expect(startup.indexOf('Agent.configureCloudProvider')).toBeLessThan(startup.indexOf('Agent.start'));
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SELECTION)).toEqual({ kind: 'resident' });
  await expectNoDevelopmentSurface(page);
  await expect(button(page, 'Talk')).toBeVisible();

  const ask = page.getByRole('textbox', { name: 'Ask Alpha', exact: true }), message = page.getByRole('textbox', { name: 'Message Alpha', exact: true });
  await ask.fill('Flag-off first request'); await ask.press('Enter');
  await expect(bubble(page, 'Flag-off first request')).toHaveCount(1);
  await expect(bubble(page, 'Resident reply 1')).toHaveCount(1);
  expect(await native(page, f => f.posts)).toEqual(['Flag-off first request']);

  // The same conversation is open from Notes and Calendar.
  for (const app of ['Notes', 'Calendar']) {
    await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    await button(page, app).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', app.toLowerCase());
    await button(page, 'Open conversation').click();
    await expect(bubble(page, 'Flag-off first request')).toHaveCount(1);
    await expect(bubble(page, 'Resident reply 1')).toHaveCount(1);
  }
  // Stop while the resident agent holds its reply: the stream is cancelled, the chat says the agent may
  // still finish, the text is not returned for a blind resend and nothing is posted again.
  await native(page, f => { f.hold = true; });
  await message.fill('Flag-off stopped request'); await message.press('Enter');
  await expect(bubble(page, 'Flag-off stopped request')).toHaveCount(1);
  const stop = button(page, 'Stop reply');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.locator('[data-alpha-layer="conversation"]').getByText('The agent may still finish this reply. Alpha Phone will check once and show it here if it does.', { exact: true })).toHaveCount(1);
  await expect(message).toHaveValue('');
  await expect.poll(() => native(page, f => f.cancelled)).toBeGreaterThan(0);
  expect(await native(page, f => f.posts)).toEqual(['Flag-off first request', 'Flag-off stopped request']);
  // The resident agent finishes anyway; the one automatic check shows its reply exactly once.
  await native(page, f => { f.hold = false; f.release(); });
  await expect(bubble(page, 'Resident reply 2')).toHaveCount(1, { timeout: 60_000 });
  await expect(bubble(page, 'Flag-off stopped request')).toHaveCount(1);
  expect(await native(page, f => f.streams)).toBe(2);
  // Each request carried the screen it was sent from as its current-turn context.
  expect(await native(page, f => f.views)).toEqual(['home', 'calendar']);

  // Restart: the saved conversation comes back by itself. There is no "Load conversations" step here.
  await page.reload();
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await button(page, 'Open conversation').click();
  for (const text of ['Flag-off first request', 'Resident reply 1', 'Flag-off stopped request', 'Resident reply 2']) await expect(bubble(page, text)).toHaveCount(1, { timeout: 30_000 });
  // Restoring reads history; it posts nothing.
  expect(await native(page, f => f.streams)).toBe(0);
  // The connection names the agent and where it runs, and no credential is rendered anywhere.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Settings').click();
  await expect(page.getByRole('button', { name: 'Agent connection', exact: true })).toContainText('Alpha');
  await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
  const account = page.getByRole('dialog', { name: 'Your Cloud account' });
  await expect(account).toContainText('Your agent runs on this phone and uses your Eliza Cloud plan for AI.');
  await expect(account.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('synthetic-cloud-key');
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

for (const outcome of ['opened', 'unavailable'] as const) {
  test(`loop C on Android: a reviewed alarm is one Clock handoff and never a saved alarm (${outcome})`, async ({ page }) => {
    test.setTimeout(120_000);
    await android(page, { clock: outcome });
    await residentHome(page);
    await button(page, 'Calendar').click();
    await button(page, 'Clock alarms').click();
    const clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
    await expect(clock).toContainText('Alarms are managed by your installed Clock app. Check the result there after every request.');
    // The browser build's own alarm list (Saved alarms, Save alarm, Ringing) does not exist on Android.
    await expect(clock.getByText('Saved alarms', { exact: true })).toHaveCount(0);
    await expect(clock.getByRole('button', { name: 'Save alarm', exact: true })).toHaveCount(0);
    await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
    await clock.getByRole('textbox', { name: 'Alarm label' }).fill('Flag-off alarm');
    await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
    await expect(clock).toContainText('Ask Clock to set an alarm at 07:15 named “Flag-off alarm”, using the phone’s local time. Review the alarm in Clock.');
    // Review alone sends nothing.
    expect(await native(page, f => f.clock)).toEqual([]);
    const confirm = clock.getByRole('button', { name: 'Confirm Clock request', exact: true });
    await expect(confirm).toHaveText('Continue to Clock');
    await confirm.click();
    await expect(clock).toContainText(outcome === 'opened' ? 'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.' : 'No Clock app can handle this request.');
    const sent = await native(page, f => f.clock) as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'set', hour: 7, minute: 15, label: 'Flag-off alarm', reviewed: true });
    await expect(clock).not.toContainText(/Alarm saved|will ring|Ringing/);
    await expectNoDevelopmentSurface(page);
  });
}

// Journey hardening (docs/core-loop-audit.md, work order 14): snooze and dismiss on the Android path.
test('loop C on Android: snooze and dismiss are reviewed Clock requests, one handoff each, and neither claims an alarm changed', async ({ page }) => {
  test.setTimeout(120_000);
  await android(page, { clock: 'opened' });
  await residentHome(page);
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  const clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
  const confirm = clock.getByRole('button', { name: 'Confirm Clock request', exact: true });

  await clock.getByRole('button', { name: 'Snooze', exact: true }).click();
  // The alarm time and label belong to Set; a snooze request carries only the minutes asked for.
  await expect(clock.getByLabel('Alarm time', { exact: true })).toHaveCount(0);
  await clock.getByLabel('Snooze minutes', { exact: true }).fill('7');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Ask Clock to snooze ringing alarms, requesting 7 minutes. Clock may use its default duration and snooze all ringing alarms. If nothing is ringing, Clock may do nothing.');
  expect(await native(page, f => f.clock)).toEqual([]);
  await confirm.dblclick();
  await expect(clock).toContainText('Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.');
  expect(await native(page, f => f.clock)).toEqual([{ action: 'snooze', snoozeMinutes: 7, reviewed: true }]);

  await clock.getByRole('button', { name: 'Dismiss', exact: true }).click();
  // Choosing another action withdraws the earlier review; nothing is sent by choosing.
  await expect(confirm).toHaveCount(0);
  await expect(clock.getByLabel('Snooze minutes', { exact: true })).toHaveCount(0);
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Ask Clock to dismiss the active alarm. If there is more than one, Clock may ask you to choose. A one-time alarm is disabled; a repeated alarm skips its upcoming occurrence.');
  expect(await native(page, f => f.clock.length)).toBe(1);
  await confirm.click();
  await expect.poll(() => native(page, f => f.clock.length)).toBe(2);
  expect(await native(page, f => f.clock)).toEqual([{ action: 'snooze', snoozeMinutes: 7, reviewed: true }, { action: 'dismiss', reviewed: true }]);
  await expect(clock).toContainText('Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.');
  await expect(clock).not.toContainText(/Alarm saved|snoozed for|was dismissed|Ringing/i);
  await expectNoDevelopmentSurface(page);
});

test('loop C on Android: a cancelled review sends nothing, and an unknown result is remembered across a restart before any repeat', async ({ page }) => {
  test.setTimeout(120_000);
  await android(page, { clock: 'unknown' });
  await residentHome(page);
  const openClock = async () => { await button(page, 'Calendar').click(); await button(page, 'Clock alarms').click(); return page.getByRole('dialog', { name: 'Clock alarms', exact: true }); };
  let clock = await openClock();
  await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await clock.getByRole('button', { name: 'Cancel Clock review', exact: true }).click();
  await expect(clock.getByRole('button', { name: 'Confirm Clock request', exact: true })).toHaveCount(0);
  expect(await native(page, f => f.clock)).toEqual([]);
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await clock.getByRole('button', { name: 'Confirm Clock request', exact: true }).click();
  await expect(clock).toContainText('Clock result is unknown. Check Clock before repeating the request.');
  expect(await native(page, f => f.clock.length)).toBe(1);
  // Restart: the unknown outcome is still stated before another request can be reviewed, and nothing is replayed.
  await page.reload();
  await expect.poll(() => native(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  clock = await openClock();
  await expect(clock).toContainText('Previous Clock result is unknown. Check Clock before repeating a request.');
  expect(await native(page, f => f.clock)).toEqual([]);
});

test('loop C on Android: a phone time zone that changes after review retires the request before anything is sent', async ({ page, context }) => {
  test.setTimeout(120_000);
  await android(page);
  await residentHome(page);
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  const clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
  await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  const confirm = clock.getByRole('button', { name: 'Confirm Clock request', exact: true });
  await expect(confirm).toBeVisible();
  // The phone moves to another zone between review and confirmation (browser time zone override).
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await (await context.newCDPSession(page)).send('Emulation.setTimezoneOverride', { timezoneId: before === 'Asia/Tokyo' ? 'Europe/Paris' : 'Asia/Tokyo' });
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).not.toBe(before);
  await confirm.click();
  await expect(clock).toContainText('Phone time zone changed. Review the Clock request again.');
  await expect(confirm).toHaveCount(0);
  expect(await native(page, f => f.clock)).toEqual([]);
});

test('loops B, C and J04 in the web build: local calendar and alarm records are real, and Maps says a provider is missing instead of routing', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Calendar').click();
  await button(page, 'New event').click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Flag-off meeting');
  await page.getByRole('textbox', { name: 'Location', exact: true }).fill('12 Market Street, Test Town');
  await button(page, 'Save event').click();
  await expect(page.getByRole('heading', { name: 'Flag-off meeting', level: 1 })).toBeVisible();
  // J04: the location is handed to Maps once; with no provider there are no places, routes or times.
  await button(page, '12 Market Street, Test Town').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
  await expect(page.getByRole('textbox', { name: 'Search places', exact: true })).toHaveValue('12 Market Street, Test Town');
  await expect(page.getByText('Connect a Maps provider to search places and plan routes.', { exact: true })).toBeVisible();
  await expect(button(page, 'Directions')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Maps' })).not.toContainText(/\d+ min|\d km/);
  // C: the web build keeps its own alarm list (it is not a development surface) and it survives a reload.
  await page.goto('/');
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  let clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
  await clock.getByRole('textbox', { name: 'Alarm label' }).fill('Flag-off web alarm');
  await clock.getByLabel('Alarm time', { exact: true }).fill('07:15');
  await clock.getByRole('button', { name: 'Save alarm', exact: true }).click();
  await expect(clock.getByText('Flag-off web alarm', { exact: true })).toHaveCount(1);
  await page.reload();
  await button(page, 'Calendar').click();
  // B (direct UI): the saved event is still there after the reload, exactly once, and can be deleted.
  await expect(page.getByRole('button', { name: /^Flag-off meeting,/ })).toHaveCount(1);
  await button(page, 'Clock alarms').click();
  clock = page.getByRole('dialog', { name: 'Clock alarms', exact: true });
  await expect(clock.getByText('Flag-off web alarm', { exact: true })).toHaveCount(1);
  await clock.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /^Flag-off meeting,/ }).click();
  await button(page, 'Delete event').click();
  await expect(page.getByRole('button', { name: /^Flag-off meeting,/ })).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loops D and F in the web build: digests and mail name the missing account instead of offering development schedules or a local mailbox', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Settings').click();
  await button(page, 'Scheduled digests').click();
  const digests = page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
  await expect(digests).toContainText('Choose where your agent runs to set up scheduled digests.');
  await expect(digests).toContainText('Connect an agent with verified scheduled digest support.');
  // None of the development scheduler exists: no snapshot, no schedule review, no "runs while open".
  await expect(digests.getByText('Share a snapshot', { exact: true })).toHaveCount(0);
  await expect(digests.getByRole('button', { name: /^Review (morning|evening) schedule$/ })).toHaveCount(0);
  await expect(digests.getByText(/Schedules run while this app is open/)).toHaveCount(0);
  await expect(digests.getByRole('article')).toHaveCount(0);
  await button(page, 'Close scheduled digests').click();
  await page.goto('/');
  await button(page, 'Inbox').click();
  await expect(page.locator('[data-screen]')).toContainText('Connect Eliza Cloud to use Gmail');
  // No development mailbox: no fixture message, and Compose does not open a local "Sent locally" path.
  await expect(page.getByText('Dinner Friday?', { exact: true })).toHaveCount(0);
  await button(page, 'Compose').click();
  await expect(page.getByText('Connect a Gmail account first.', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('To', { exact: true })).toHaveCount(0);
  await expect(button(page, 'Send email')).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loops E and J05 in the web build: browsing and page review work, an unconnected question is not sent, and no development vault is offered', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page, ['public-fixture.test']);
  const url = 'https://public-fixture.test/harbour';
  await page.route('https://public-fixture.test/**', route => route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<article><h1>Harbour report</h1><p>The ferry leaves at nine from pier four.</p></article>' }));
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Browser').click();
  await page.getByRole('button', { name: 'Search or type address' }).first().click();
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(url);
  await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter');
  await expect(page.locator('iframe[title="Website"]:visible').contentFrame().getByRole('heading', { name: 'Harbour report', exact: true })).toBeVisible();
  // The web build cannot verify TLS for the framed page and does not claim it.
  await expect(page.getByRole('img', { name: 'Secure connection', exact: true })).toHaveCount(0);
  await button(page, 'Menu').click();
  await button(page, 'Ask about page').click();
  const review = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(review.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue(/The ferry leaves at nine from pier four\./);
  await review.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await button(page, 'Send').click();
  // No local Android agent is available: preserve the reviewed draft and explain the local-only policy.
  await expect(page.getByRole('status', { name: 'Assistant draft status' })).toHaveText('Not sent. Your message is back in the composer.');
  await expect(page.locator('.alpha-connection').getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review summary note/ })).toHaveCount(0);
  await page.locator('.alpha-connection').getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await page.goto('/');
  await button(page, 'Settings').click();
  await button(page, 'Password manager').click();
  const settings = page.locator('[data-settings-page]:not([inert])').last();
  await expect(settings).toContainText(/Saved passwords\s*Available in the Android app/);
  await expect(settings).toContainText('Native provider status is unavailable here');
  for (const name of ['Add development provider', 'Open development vault', 'Unlock passwords', 'Choose password provider']) await expect(button(page, name)).toHaveCount(0);
  await expect(page.getByText(/demo-only-password|Example sign-in/)).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loop J01 in the web build: a scanned poster becomes exactly one reviewed calendar event with no development profile', async ({ page }) => {
  test.setTimeout(300_000);
  const poster = 'Open studio\nOctober 10, 2026\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall';
  await page.clock.setFixedTime(new Date('2026-10-09T15:00:00Z'));
  await page.addInitScript(offline);
  await page.addInitScript(() => {
    // Synthetic camera: a canvas stream drawing the poster. Capture, local OCR and review are the shipped code.
    const mediaDevices = navigator.mediaDevices; Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    mediaDevices.getUserMedia = async () => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700; const c = canvas.getContext('2d')!; const draw = () => { c.fillStyle = 'white'; c.fillRect(0, 0, 1000, 700); c.fillStyle = 'black'; c.font = '58px Arial'; c.fillText('Open studio', 60, 140); c.fillText('October 10, 2026', 60, 260); c.fillText('Time: 6:30 PM - 8:00 PM', 60, 380); c.fillText('Venue: Main hall', 60, 500); }; draw(); const stream = canvas.captureStream(10); const timer = setInterval(draw, 100); stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream; };
  });
  await page.goto('/');
  await button(page, 'Camera').click();
  const video = page.locator('[aria-label^="Viewfinder."] video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await button(page, 'Scan mode').click();
  await button(page, 'Scan text').click();
  const dialog = page.getByRole('dialog', { name: 'Review scanned text' }), text = dialog.getByRole('textbox', { name: 'Scanned text' });
  await expect(text).toBeEnabled({ timeout: 120_000 });
  await expect(text).toHaveValue(/October 10, 2026/);
  await text.fill(poster);
  await dialog.locator('summary').filter({ hasText: 'Create event draft' }).click();
  await expect(dialog.getByLabel('Event title', { exact: true })).toHaveValue('Open studio');
  await expect(dialog.getByLabel('Event date', { exact: true })).toHaveValue('2026-10-10');
  await expect(dialog.getByLabel('Event start time', { exact: true })).toHaveValue('18:30');
  await dialog.getByLabel('Event title', { exact: true }).fill('Reviewed studio visit');
  await dialog.getByRole('button', { name: 'Review in Calendar', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Reviewed studio visit');
  await button(page, 'Save event').click();
  await expect(page.getByRole('heading', { name: 'Reviewed studio visit', level: 1 })).toBeVisible();
  await page.reload();
  await expect(button(page, 'Settings')).toBeVisible();
  await button(page, 'Calendar').click();
  await button(page, 'Day 10').click();
  await expect(page.getByRole('button', { name: /^Reviewed studio visit,/ })).toHaveCount(1);
  await expectNoDevelopmentSurface(page);
});

test('loop J03 in the web build: a chosen document can be reviewed for a question, and with no agent nothing is sent or saved', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await page.addInitScript(offline);
  await page.goto('/');
  await button(page, 'Files').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Documents').click();
  await (await chooser).setFiles({ name: 'garden-report.txt', mimeType: 'text/plain', buffer: Buffer.from('Public fact: twelve raised beds.') });
  await button(page, 'Ask Alpha').click();
  const question = page.getByRole('dialog', { name: 'Ask about selected content' });
  await expect(question.getByRole('textbox', { name: 'Content excerpt' })).toHaveValue('Public fact: twelve raised beds.');
  await question.getByRole('button', { name: 'Use in conversation', exact: true }).click();
  await button(page, 'Send').click();
  await expect(page.getByRole('status', { name: 'Assistant draft status' })).toHaveText('Not sent. Your message is back in the composer.');
  await expect(page.locator('.alpha-connection').getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByText('Review summary note', { exact: true })).toHaveCount(0);
  await page.locator('.alpha-connection').getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await page.goto('/');
  await button(page, 'Notes').click();
  await expect(page.locator('[data-screen]')).toContainText('No notes yet');
  // The development Inbox simulator that feeds journey J03 does not exist here.
  await expect(button(page, 'Incoming email')).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(foreign).toEqual([]);
});

test('loops D and F on Android: schedules are stated as phone-bound, and mail without a Gmail grant asks for one instead of showing a mailbox', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await android(page);
  await residentHome(page);
  await button(page, 'Settings').click();
  await button(page, 'Scheduled digests').click();
  const digests = page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
  // The resident agent schedules on the phone and the panel says what that cannot do (decision A-09 is open).
  await expect(digests).toContainText('Your agent runs schedules on this phone. It cannot run while the phone is off.');
  await expect(digests).toContainText('one is recorded below as missed and none is run later');
  await expect(digests.getByText(/Schedules run while this app is open/)).toHaveCount(0);
  // This stub has no result store: the panel reports that instead of showing results.
  await expect(digests).toContainText('Result storage could not be connected. Reconnect the agent to try again.');
  await expect(digests.getByRole('article')).toHaveCount(0);
  await button(page, 'Close scheduled digests').click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Inbox').click();
  // Signed in to Cloud but with no Gmail grant (the account list is refused): no messages, an explicit connect.
  await expect(page.locator('[data-screen]')).toContainText('Gmail access was revoked or needs authorization again. Reconnect Gmail, then retry.');
  await expect(button(page, 'Connect Gmail')).toBeVisible();
  await expect(page.getByText('Dinner Friday?', { exact: true })).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(await native(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
