// Production Android as the FLAG-OFF renderer sees it, for the *.production.spec.ts files that
// need mail, an agent conversation, scheduled-digest results or device calendars together.
//
// Everything synthetic lives at the test boundary: the Capacitor bridge (window.Capacitor and
// window.androidBridge) is replaced before the bundle loads. Nothing here is compiled into the
// product, and the bundle under test is the one `vite build` produces with
// ELIZA_DEV_ALLOW_TEST_MOCKS unset. The shipped renderer, CloudProtocol validation, the hosted
// digest protocol and the Keystore-slot journals (over the stubbed secure store) all run.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The stub is not the
// native plugins, the resident runtime, Eliza Cloud, Google, Android CalendarProvider, a WebView
// or a device. No account, grant, mail, calendar or digest here is real.
import { expect, type Page } from '@playwright/test';

export interface FlagOffMessage { externalId: string; threadId: string; subject: string; from: string; fromEmail: string; to: string[]; snippet: string; bodyText: string; historyId: string }
export interface FlagOffAccount { connectionId: string; email: string; connected: boolean; messages: FlagOffMessage[] }
export interface FlagOffCalendar { id: string; name?: string; account: string }
export interface FlagOffEvent { id: string; calendarId: string; title: string; begin: number; end: number }
export interface FlagOffOptions {
  /** Managed Gmail accounts behind the synthetic Eliza Cloud. Omitted: the account list is refused. */
  accounts?: FlagOffAccount[];
  /** Scheduled digests: `native` = the Android result inbox delivers results (the phone's normal
   * route); `renderer` = background delivery could not be configured, so the renderer reads the
   * agent's result page itself. Omitted: the agent advertises no digest support. */
  digests?: 'native' | 'renderer';
  /** Device calendar permission and provider rows. Omitted: the calendar read is not granted. */
  calendar?: { access: 'granted' | 'not-granted'; request?: 'granted' | 'denied'; calendars: FlagOffCalendar[]; events: FlagOffEvent[] };
}
export const AGENT_NAME = 'Alpha';

export async function flagOffAndroid(page: Page, options: FlagOffOptions = {}) {
  await page.addInitScript(({ options, agentName }) => {
    const w = window as any; w.androidBridge = {};
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5', agentId = '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11';
    const kept = (key: string, initial: unknown) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? initial; } catch { return initial; } };
    // Keystore-backed slots and the resident agent's own store survive a reload of the page.
    const slots: Record<string, string> = kept('flag-off-slots', { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id, expiresAt: Date.now() + 86_400_000 }) });
    const agent: { conversations: { id: string; title: string }[]; history: Record<string, any[]> } = kept('flag-off-agent', { conversations: [], history: {} });
    // So do the results the agent produced and what the Android result inbox committed.
    const produced: { results: any[]; acked: number; acks: number[]; inbox: any[] } = kept('flag-off-digests', { results: [], acked: 0, acks: [], inbox: [] });
    const persist = () => { sessionStorage.setItem('flag-off-slots', JSON.stringify(slots)); sessionStorage.setItem('flag-off-agent', JSON.stringify(agent)); sessionStorage.setItem('flag-off-digests', JSON.stringify({ results: f.digests.results, acked: f.digests.acked, acks: f.digests.acks, inbox: f.digests.inbox })); };
    const f = w.flagOff = {
      calls: [] as string[], unexpected: [] as string[], posts: [] as string[], replies: [] as string[], streams: 0,
      mail: { accounts: structuredClone(options.accounts ?? null) as any[] | null, accountReads: 0, searches: 0, reads: [] as string[], prepares: [] as any[], dispatches: [] as any[], operations: {} as Record<string, any>, sent: [] as string[] },
      // Results the resident agent has produced, in cursor order. `acked` is the agent's cursor for
      // the renderer route; `inbox` is what the Android result inbox has committed for the native one.
      digests: { ...produced, pages: 0, syncs: 0, histories: 0, configured: [] as any[], runs: 0, refused: [] as string[] },
      calendar: { ...structuredClone(options.calendar ?? { access: 'not-granted', calendars: [], events: [] }), lists: 0, requests: 0 } as any,
      emit: (plugin: string, event: string, value: unknown = {}) => { listeners.filter(l => l.plugin === plugin && l.event === event).forEach(l => l.callback(value)); },
      slots, persist: () => persist(),
    };
    const listeners: Array<{ plugin: string; event: string; callback: (value: unknown) => void }> = [];
    const emitStream = (streamId: string, event: unknown) => f.emit('Agent', 'alphaAgentStream', { streamId, event });
    const data = (streamId: string, value: unknown) => emitStream(streamId, { type: 'chunk', dataBase64: btoa('data: ' + JSON.stringify(value) + '\n\n') });
    const ok = (value: unknown) => ({ status: 200, data: value });
    const request = (method: string, path: string, body: any, headers: Record<string, string>): { status: number; data: unknown } => {
      if (path === '/api/auth/me') return ok({ identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } });
      if (path === '/api/agents') return ok({ agents: [{ id: agentId, name: agentName, status: 'running' }] });
      if (path === '/api/client-devices/register') return ok({ installationId: headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: [] });
      if (path === '/api/client-devices/proposals') return ok({ proposals: [] });
      // The agent advertises scheduled digests only; the workflow engine itself is not offered here.
      if (path === '/api/workflow/status') return ok(options.digests ? { status: 'unavailable', hostedDigestProtocol: 1 } : { status: 'unavailable' });
      if (options.digests) {
        if (path === '/api/workflow/hosted/sources') return ok({ sources: [] });
        if (path === '/api/workflow/hosted/loops') return ok({ loops: [] });
        if (path.startsWith('/api/workflow/hosted/results?clientId=') && method === 'GET') { f.digests.pages++; return ok({ entries: f.digests.results.filter(row => row.cursor > f.digests.acked).slice(0, 50) }); }
        if (path === '/api/workflow/hosted/results/ack' && method === 'POST') { f.digests.acks.push(body.cursor); f.digests.acked = Math.max(f.digests.acked, body.cursor); persist(); return ok({}); }
        // The digests list asks which Google access revocations are still pending. It is a read sent
        // as a POST (the agent's cloud-delegation route); this agent has none.
        if (path === '/api/workflow/hosted/cloud-delegation/revocations' && method === 'POST') return ok({ grants: [] });
        // Every other POST would start, restart or change a schedule, a source or a delegation: it is
        // counted, its path is recorded and it is refused.
        if (path.startsWith('/api/workflow/hosted/') && method === 'POST') { f.digests.runs++; f.digests.refused.push(path); return { status: 409, data: {} }; }
      }
      if (path === '/api/conversations' && method === 'POST') { const row = { id: 'resident-chat-' + (agent.conversations.length + 1), title: String(body.title || 'Alpha Phone') }; agent.conversations.push(row); agent.history[row.id] = []; persist(); return ok({ conversation: row }); }
      if (path === '/api/conversations') return ok({ conversations: agent.conversations });
      const history = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path.split('?')[0]);
      if (history && method === 'GET') return ok({ messages: (agent.history[history[1]] || []).slice(-200) });
      f.unexpected.push(method + ' ' + path); return { status: 404, data: {} };
    };
    // Synthetic managed Gmail behind Eliza Cloud, in the server's own response shapes. The product's
    // CloudProtocol validates every one of these replies.
    const google = '/api/v1/eliza/google';
    const wire = (m: any) => ({ externalId: m.externalId, threadId: m.threadId, subject: m.subject, from: m.from, fromEmail: m.fromEmail, to: m.to, cc: [], snippet: m.snippet, receivedAt: '2026-10-06T12:00:00Z', isUnread: false });
    const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
    const cloud = async (input: any): Promise<{ status: number; data: unknown }> => {
      const url = new URL(input.url), path = url.pathname, m = f.mail, body = input.body ? JSON.parse(input.body) : null;
      if (url.origin !== 'https://api.eliza.app') throw Error('Connection request failed');
      if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
      if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
      if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } }; // Synthetic active plan from the billing snapshot.
      if (!m.accounts) return { status: 404, data: {} };
      const grant = () => m.accounts!.find(a => a.connectionId === (url.searchParams.get('grantId') ?? body?.grantId) && a.connected);
      if (path === google + '/accounts') { m.accountReads++; return { status: 200, data: m.accounts.map(a => ({ configured: true, connected: a.connected, reason: a.connected ? 'connected' : 'needs_reauth', connectionId: a.connectionId, grantedCapabilities: a.connected ? ['google.gmail.triage'] : [], identity: { email: a.email } })) }; }
      if (!grant()) return { status: 403, data: { error: 'Grant is not connected' } };
      const account = grant()!;
      if (path === google + '/gmail/inbox-v1/capabilities') return { status: 200, data: { version: 1, from: account.email, threads: true, send: true, providerDrafts: false, mailboxMutations: false, attachments: false, providerExactlyOnce: false, atomicDraftReplacement: false } };
      if (path === google + '/gmail/search') { m.searches++; return { status: 200, data: { messages: account.messages.map(wire), syncedAt: new Date().toISOString(), nextPageToken: null } }; }
      if (path === google + '/gmail/read') { const found = account.messages.find((row: any) => row.externalId === url.searchParams.get('messageId')); m.reads.push(String(url.searchParams.get('messageId'))); return found ? { status: 200, data: { message: wire(found), bodyText: found.bodyText, links: [] } } : { status: 404, data: {} }; }
      if (path === google + '/gmail/inbox-v1/thread') {
        const rows = account.messages.filter((row: any) => row.threadId === url.searchParams.get('threadId'));
        return rows.length ? { status: 200, data: { version: 1, threadId: rows[0].threadId, messages: rows.map((row: any) => ({ message: wire(row), bodyText: row.bodyText, links: [], historyId: row.historyId, attachments: [] })), total: rows.length, offset: 0, nextOffset: null, historyId: rows[rows.length - 1].historyId } } : { status: 404, data: {} };
      }
      const reply = (receipt: unknown, extra: Record<string, unknown> = {}) => ({ status: 200, data: { version: 1, providerExactlyOnce: false, receipt, ...extra } });
      if (path === google + '/gmail/inbox-v1/operations' && input.method === 'POST') {
        // The server's review echoes the proposal (including the message a reply answers) and names the From account.
        const p = body.proposal, review = { ...p, from: account.email, attachments: [] };
        const receipt = { requestId: body.requestId, kind: p.kind, state: 'prepared', reviewDigest: await sha(JSON.stringify(review)), providerResult: null, rejectionCode: null };
        m.prepares.push({ requestId: body.requestId, grantId: body.grantId, digest: receipt.reviewDigest, bodyText: p.bodyText }); m.operations[body.requestId] = receipt;
        return reply(receipt, { review });
      }
      const operation = /^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/([^/]+)(\/dispatch)?$/.exec(path);
      if (operation && operation[2] && input.method === 'POST') {
        const request = decodeURIComponent(operation[1]);
        m.dispatches.push({ requestId: request, grantId: body.grantId, digest: body.reviewDigest, bodyText: body.proposal.bodyText });
        if (m.operations[request]?.reviewDigest !== body.reviewDigest) return { status: 409, data: { error: 'Review digest changed' } };
        if (m.operations[request].state !== 'succeeded') { m.sent.push(body.proposal.subject + ' | ' + body.proposal.bodyText); m.operations[request] = { ...m.operations[request], state: 'succeeded', providerResult: { messageId: 'sent-' + m.sent.length, threadId: 'thread-sent' } }; }
        return reply(m.operations[request]);
      }
      if (operation && !operation[2]) return m.operations[decodeURIComponent(operation[1])] ? reply(m.operations[decodeURIComponent(operation[1])]) : { status: 404, data: {} };
      f.unexpected.push('cloud ' + input.method + ' ' + path); return { status: 404, data: {} };
    };
    const promise = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    const withListeners = (names: string[]) => [...promise(names), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }];
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaDeletions', methods: promise(['pending']) },
        { name: 'DeviceApps', methods: promise(['buildInfo']) },
        { name: 'DailyApps', methods: withListeners(['surfaceInfo', 'listReminders', 'pendingReminderTap']) },
        { name: 'Agent', methods: withListeners(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request', 'providerStatus', 'requestStream', 'cancelStream']) },
        { name: 'AlphaConnection', methods: promise(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
        { name: 'AlphaActionJournal', methods: promise(['list', 'get']) },
        { name: 'AlphaNotifications', methods: promise(['status', 'crossAppStatus']) },
        { name: 'AlphaVoiceCloud', methods: promise(['checkPermissions']) },
        ...(options.digests ? [{ name: 'AlphaHostedResults', methods: withListeners(['beginBackground', 'cancelBackground', 'configureBackground', 'disableBackground', 'syncInbox', 'inboxHistory', 'status', 'pendingResult', 'consumeResult', 'pendingSourceRenewal']) }] : []),
        ...(options.calendar ? [{ name: 'AlphaCalendar', methods: withListeners(['list', 'requestAccess', 'pendingCreations', 'listAlerts']) }] : []),
      ],
      nativeCallback: (plugin: string, method: string, input: any, callback: (value: unknown) => void) => { if (method === 'addListener') listeners.push({ plugin, event: input?.eventName, callback }); return String(listeners.length); },
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'AlphaDeletions' && method === 'pending') return { deletions: [] };
        f.calls.push(plugin + '.' + method);
        if (plugin === 'DeviceApps') return { launcher: true, version: 'flag-off-harness' };
        if (plugin === 'DailyApps' && method === 'surfaceInfo') return { developmentBuild: false, assistant: false };
        // No reminders are saved on this phone.
        if (plugin === 'DailyApps' && method === 'listReminders') return { reminders: [] };
        if (plugin === 'DailyApps' && method === 'pendingReminderTap') return {};
        if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
        if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
        if (plugin === 'AlphaActionJournal') return method === 'list' ? { entries: [] } : { entry: null };
        if (plugin === 'AlphaCalendar') {
          const c = f.calendar;
          if (method === 'requestAccess') { c.requests++; if (c.request === 'granted') c.access = 'granted'; return { status: c.access === 'granted' ? 'granted' : 'denied' }; }
          if (method === 'list') {
            c.lists++;
            if (c.access !== 'granted') return { status: 'permission-required' };
            // CalendarReadAccess shapes: ids are decimal strings, and a calendar with no display name has no `name`.
            return { status: 'ready', calendars: c.calendars.map((row: any) => ({ id: row.id, ...(row.name === undefined ? {} : { name: row.name }), writable: true, account: row.account, local: false })),
              events: c.events.filter((row: any) => row.end > input.begin && row.begin < input.end).map((row: any) => ({ id: row.id, calendarId: row.calendarId, title: row.title, body: '', location: '', begin: row.begin, end: row.end, allDay: false, recurring: false })), truncated: false };
          }
          if (method === 'pendingCreations') return { status: 'ready', creations: [] };
          if (method === 'listAlerts') return { items: [] };
        }
        if (plugin === 'AlphaHostedResults') {
          const d = f.digests;
          if (method === 'beginBackground' || method === 'cancelBackground' || method === 'disableBackground') return {};
          if (method === 'configureBackground') { if (options.digests !== 'native') throw Error('Background delivery is not available'); d.configured.push({ mode: input.mode, agentId: input.agentId }); return { generation: '1', scope: 'fixture-scope' }; }
          // The Android inbox commits what the agent has produced, then returns its retained history.
          if (method === 'syncInbox') { d.syncs++; for (const row of d.results) if (!d.inbox.some(saved => saved.runId === row.runId)) d.inbox.push(structuredClone(row)); persist(); return { entries: structuredClone(d.inbox) }; }
          if (method === 'inboxHistory') { d.histories++; return { entries: structuredClone(d.inbox) }; }
          if (method === 'status') return { enabled: false, backgroundEnabled: false };
          if (method === 'pendingResult' || method === 'pendingSourceRenewal') return {};
        }
        if (plugin === 'Agent') {
          if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
          if (method === 'providerStatus') return { provider: 'elizacloud', configured: true, model: 'cerebras/qwen-3.8-27b' };
          if (method === 'request') { const result = request(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : {}, input.headers || {}); return { status: result.status, body: JSON.stringify(result.data) }; }
          if (method === 'requestStream') {
            // The resident agent records the user turn, then streams its reply over native IPC.
            const conversation = /^\/api\/conversations\/([^/]+)\/messages\/stream$/.exec(input.path)![1], body = JSON.parse(input.body), streamId = input.streamId as string;
            f.streams++; f.posts.push(String(body.text));
            agent.history[conversation].push({ id: crypto.randomUUID(), role: 'user', text: body.text, timestamp: Date.now() }); persist();
            const reply = f.replies.shift() ?? 'Resident reply ' + f.streams;
            setTimeout(() => {
              emitStream(streamId, { type: 'response', status: 200, headers: { 'content-type': 'text/event-stream' } });
              agent.history[conversation].push({ id: crypto.randomUUID(), role: 'assistant', text: reply, timestamp: Date.now() + 1 }); persist();
              data(streamId, { type: 'token', text: reply }); data(streamId, { type: 'done', fullText: reply, agentName }); emitStream(streamId, { type: 'complete' });
            }, 0);
            return { streamId };
          }
          return {};
        }
        if (plugin === 'AlphaConnection') {
          if (method === 'secureRead') return { value: slots[input.slot] ?? null };
          if (method === 'secureWrite') { slots[input.slot] = input.value; persist(); return {}; }
          if (method === 'secureRemove') { delete slots[input.slot]; persist(); return {}; }
          if (method === 'secureCompareExchange') { if ((slots[input.slot] ?? null) !== input.expectedValue) return { status: 'conflict' }; if (input.value === null) delete slots[input.slot]; else slots[input.slot] = input.value; persist(); return { status: 'saved' }; }
          if (method === 'request') return cloud(input);
          return {};
        }
        f.unexpected.push(plugin + '.' + method); throw Error('Unexpected native operation ' + plugin + '.' + method);
      },
    };
  }, { options, agentName: AGENT_NAME });
}

/** Reads (or changes) the harness state from the test. */
export const harness = <T>(page: Page, read: (f: any) => T) => page.evaluate(`(${read.toString()})(window.flagOff)`) as Promise<T>;
export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Aborts and records every request that leaves the preview server. */
export async function fenceNetwork(page: Page) {
  const foreign: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol)) return route.fallback();
    foreign.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  return foreign;
}
/** No mock, fixture or development surface is present in the build under test. */
export async function expectNoDevelopmentSurface(page: Page) {
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  await expect(page.locator('.alpha-dev-tools')).toHaveCount(0);
  await expect(button(page, 'Device controls')).toHaveCount(0);
  await expect(page.getByText(/Development (connections|device actions|reply|provider|inbox)/)).toHaveCount(0);
}
/** A funded resident account connects by itself; no Welcome dialog and no chooser remain. */
export async function residentHome(page: Page) {
  await page.goto('/');
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await expect(button(page, 'Notes')).toBeVisible();
}
