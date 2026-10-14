import { test, expect, type Page } from '@playwright/test';

// A Cloud sign-in kept on the phone, with "local apps without AI" chosen, after a restart.
// Round 7 found that Settings › Agent connection offered it as "Retry saved connection" while the
// panel Inbox opens ("Connect Eliza Cloud") offered only a new sign-in. Both panels now offer the
// same retry under the same rules: nothing is restored or contacted until the owner asks, the
// retry starts the on-device agent only (never a remote or Cloud-hosted one), nothing says the
// phone is signed in or connected until Cloud has answered, and a failed retry says what failed.
//
// Flag-off production bundle with the Android bridge stubbed. The stub is not the native plugins,
// the keystore or Eliza Cloud; the Android run is test-native-restart.mjs inbox on an emulator.
type Mode = 'offline' | 'rejected' | 'funded';
type Call = { plugin: string; method: string; path?: string; url?: string };

async function boot(page: Page, mode: Mode) {
  await page.addInitScript(mode => {
    const w = window as any; w.androidBridge = {}; w.residentCalls = [];
    const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
    // The state a restart leaves: local apps chosen, and a sign-in still in the keystore.
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
        if (path === '/api/v1/credits/balance') return { status: 200, data: { balance: 5 } };
        throw Error('Unexpected Cloud route: ' + path);
      }
      return {};
    } };
  }, mode);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  // Local apps were chosen: no panel opens by itself and nothing was asked of Cloud or the agent.
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const calls = (page: Page) => page.evaluate(() => (window as any).residentCalls as Call[]);
const cloudRequests = async (page: Page) => (await calls(page)).filter(call => call.plugin === 'AlphaConnection' && call.method === 'request').map(call => new URL(call.url!).pathname);
const agentCalls = async (page: Page) => (await calls(page)).filter(call => call.plugin === 'Agent').map(call => call.method);
const selection = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.selection.v1') || 'null'));

const PANELS = {
  Inbox: {
    heading: 'Eliza Cloud',
    open: async (page: Page) => {
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-active-view', 'inbox');
      await expect(page.getByText('Connect Eliza Cloud to use Gmail')).toBeVisible();
      await page.getByRole('button', { name: 'Connect Eliza Cloud', exact: true }).click();
    },
  },
  Settings: {
    heading: 'Reconnect Eliza Cloud',
    open: async (page: Page) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: /Agent connection/ }).click();
    },
  },
} as const;

for (const [name, panel] of Object.entries(PANELS)) {
  test.describe(`${name} panel`, () => {
    test('offers the saved sign-in as a retry without contacting Cloud, starting an agent or claiming a connection', async ({ page }) => {
      await boot(page, 'funded');
      await panel.open(page);
      const dialog = page.getByRole('dialog', { name: panel.heading });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Retry saved connection', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toBeVisible();
      await expect(dialog).toContainText(/Retry your saved connection or sign in again/);
      // Nothing claims an account or a connection: no account summary, no "Signed in", no "Connected".
      await expect(dialog.locator('.alpha-cloud-account-summary')).toHaveCount(0);
      await expect(dialog.getByText(/Signed in|Your Cloud account|Credits available/)).toHaveCount(0);
      await expect(dialog.getByRole('status')).toHaveCount(0);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      // Offering the retry was a local read only.
      expect(await cloudRequests(page)).toEqual([]);
      expect(await agentCalls(page)).not.toContain('start');
      expect(await agentCalls(page)).not.toContain('configureCloudProvider');
      expect(await selection(page)).toEqual({ kind: 'offline', localApps: true });
    });

    test('a retry that cannot reach Cloud says so and leaves local apps as they were', async ({ page }) => {
      await boot(page, 'offline');
      await panel.open(page);
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true }) });
      await dialog.getByRole('button', { name: 'Retry saved connection', exact: true }).click();
      const alert = dialog.getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('Connection request failed');
      // Still not signed in, still not connected, and the retry is offered again.
      await expect(dialog.locator('.alpha-cloud-account-summary')).toHaveCount(0);
      await expect(dialog.getByText(/Signed in|Your Cloud account|Credits available|Connected/)).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Retry saved connection', exact: true })).toBeEnabled();
      expect(await cloudRequests(page)).not.toEqual([]);
      expect(await agentCalls(page)).not.toContain('start');
      expect(await agentCalls(page)).not.toContain('configureCloudProvider');
      expect(await selection(page)).toEqual({ kind: 'offline', localApps: true });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // Inbox is exactly as unconnected as before.
      await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      await expect(page.getByText('Connect Eliza Cloud to use Gmail')).toBeVisible();
    });

    test('a saved sign-in Cloud rejects is reported as no longer valid and is not offered again', async ({ page }) => {
      await boot(page, 'rejected');
      await panel.open(page);
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true }) });
      await dialog.getByRole('button', { name: 'Retry saved connection', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText('Your saved Cloud sign-in is no longer valid.');
      await expect(dialog.getByRole('button', { name: 'Retry saved connection', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toBeEnabled();
      await expect(dialog.locator('.alpha-cloud-account-summary')).toHaveCount(0);
      expect(await agentCalls(page)).not.toContain('start');
      expect(await agentCalls(page)).not.toContain('configureCloudProvider');
    });

    test('a retry Cloud accepts starts the on-device agent only', async ({ page }) => {
      await boot(page, 'funded');
      await panel.open(page);
      const dialog = page.getByRole('dialog', { name: panel.heading });
      await dialog.getByRole('button', { name: 'Retry saved connection', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // Identity and credits were read. Once signed in, Inbox may read its Gmail accounts. No
      // Cloud-hosted agent is listed, provisioned or restored and no remote session is opened.
      const paths = await cloudRequests(page);
      expect(paths).toEqual(expect.arrayContaining(['/api/v1/user', '/api/v1/credits/balance']));
      expect(paths.filter(path => !['/api/v1/user', '/api/v1/subscription/entitlement', '/api/v1/credits/balance', '/api/v1/eliza/google/accounts'].includes(path))).toEqual([]);
      const native = await agentCalls(page);
      expect(native).toContain('configureCloudProvider');
      expect(native).toContain('start');
      expect((await selection(page))?.kind).not.toMatch(/^(cloud|remote)$/);
    });
  });
}
