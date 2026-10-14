import { test, expect, type Page } from '@playwright/test';

// A Cloud sign-in kept on the phone, with the retired "local apps without AI" choice stored by an
// earlier build, after a restart. Every Alpha Phone now signs in and holds a plan (#410): the next
// launch replaces that choice with the sign-in and plan gate (no data is removed), checks the kept
// sign-in, starts the on-device agent only (never a remote or Cloud-hosted one) when the plan
// admits it, and says what failed otherwise.
//
// Flag-off production bundle with the Android bridge stubbed. The stub is not the native plugins,
// the keystore or Eliza Cloud; the Android run is test-native-restart.mjs inbox on an emulator.
type Mode = 'offline' | 'rejected' | 'funded';
type Call = { plugin: string; method: string; path?: string; url?: string };

async function boot(page: Page, mode: Mode) {
  await page.addInitScript(mode => {
    const w = window as any; w.androidBridge = {}; w.residentCalls = [];
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    // The state a restart leaves: the retired local-only choice, and a sign-in still in the keystore.
    if (!sessionStorage.getItem('saved-signin-fixture')) { sessionStorage.setItem('saved-signin-fixture', '1'); localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline', localApps: true })); }
    const values: Record<string, string> = { 'cloud:production': JSON.stringify({ token: 'synthetic-cloud-key', credentialId: id, expiresAt: Date.now() + 600000 }) };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = { PluginHeaders: [
      { name: 'DeviceApps', methods: methods(['buildInfo']) },
      { name: 'Agent', methods: methods(['getStatus', 'start', 'stop', 'configureCloudProvider', 'request']) },
      { name: 'AlphaConnection', methods: methods(['secureRead', 'secureWrite', 'secureRemove', 'secureCompareExchange', 'request', 'cancel', 'openExternal']) },
      { name: 'AlphaNotifications', methods: methods(['status', 'crossAppStatus', 'addListener', 'removeListener']) },
      { name: 'AlphaVoiceCloud', methods: methods(['checkPermissions']) },
    ], nativePromise: async (plugin: string, method: string, input: any) => {
      w.residentCalls.push({ plugin, method, path: input?.path, url: input?.url });
      if (plugin === 'DeviceApps') return { launcher: false, version: 'saved-signin-fixture' };
      if (plugin === 'AlphaNotifications') return { permissionGranted: true, appEnabled: true };
      if (plugin === 'AlphaVoiceCloud') return { microphone: 'granted' };
      if (plugin === 'Agent') {
        if (method === 'getStatus') return { packaged: true, state: 'stopped', serviceActive: false, socketListening: false };
        if (method === 'request') {
          const body = input.path === '/api/auth/me' ? { identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } }
            : input.path === '/api/agents' ? { agents: [{ id, name: 'Alpha', status: 'running' }] }
            : input.path === '/api/conversations' ? { conversations: [] } : {};
          return { status: 200, body: JSON.stringify(body) };
        }
        return {};
      }
      if (method === 'secureRead') return { value: values[input.slot] ?? null };
      if (method === 'secureWrite') { values[input.slot] = input.value; return {}; }
      if (method === 'secureRemove') { delete values[input.slot]; return {}; }
      if (method === 'request') {
        // No network: every Cloud request fails before an answer.
        if (mode === 'offline') throw Error('Connection request failed');
        const path = new URL(input.url).pathname;
        // Cloud no longer accepts the kept sign-in.
        if (mode === 'rejected') return { status: 401, data: { error: 'unauthorized' } };
        if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
        if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
        if (path === '/api/v1/billing/limits') return { status: 200, data: { success: true, data: { v2: { subscription: { status: 'available', value: { planKey: 'plus_monthly', state: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z' } } } } } };
        throw Error('Unexpected Cloud route: ' + path);
      }
      return {};
    } };
  }, mode);
  await page.goto('/');
}
const calls = (page: Page) => page.evaluate(() => (window as any).residentCalls as Call[]);
const cloudRequests = async (page: Page) => (await calls(page)).filter(call => call.plugin === 'AlphaConnection' && call.method === 'request').map(call => new URL(call.url!).pathname);
const agentCalls = async (page: Page) => (await calls(page)).filter(call => call.plugin === 'Agent').map(call => call.method);
const selection = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.selection.v1') || 'null'));

test('the retired local-only choice migrates to the gate: a kept sign-in with a plan starts the on-device agent only', async ({ page }) => {
  await boot(page, 'funded');
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Identity and plan were read. Once signed in, Inbox may read its Gmail accounts. No Cloud-hosted
  // agent is listed, provisioned or restored and no remote session is opened.
  const paths = await cloudRequests(page);
  expect(paths).toEqual(expect.arrayContaining(['/api/v1/user', '/api/v1/billing/limits']));
  expect(paths.filter(path => !['/api/v1/user', '/api/v1/subscription/entitlement', '/api/v1/billing/limits', '/api/v1/eliza/google/accounts'].includes(path))).toEqual([]);
  const native = await agentCalls(page);
  expect(native).toContain('configureCloudProvider');
  expect(native).toContain('start');
  expect(await selection(page)).toEqual({ kind: 'resident' });
});

test('a kept sign-in that cannot reach Cloud, with no recently verified plan, stays at the gate and offers the retry', async ({ page }) => {
  await boot(page, 'offline');
  const dialog = page.getByRole('dialog', { name: 'Reconnect Eliza Cloud' });
  await expect(dialog.getByRole('alert')).toContainText('Connection request failed');
  await expect(dialog.getByRole('button', { name: 'Retry saved connection', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Use local apps without AI', exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/Signed in|Your Cloud account|Connected/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await agentCalls(page)).not.toContain('start');
  expect(await agentCalls(page)).not.toContain('configureCloudProvider');
  expect(await selection(page)).toEqual({ kind: 'none' });
});

test('a kept sign-in Cloud rejects is reported as no longer valid and only a new sign-in is offered', async ({ page }) => {
  await boot(page, 'rejected');
  const dialog = page.getByRole('dialog', { name: 'Sign in to Eliza Cloud' });
  await expect(dialog.getByRole('alert')).toHaveText('Your saved Cloud sign-in is no longer valid.');
  await expect(dialog.getByRole('button', { name: 'Retry saved connection', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toBeEnabled();
  await expect(dialog.locator('.alpha-cloud-account-summary')).toHaveCount(0);
  expect(await agentCalls(page)).not.toContain('start');
  expect(await agentCalls(page)).not.toContain('configureCloudProvider');
});
