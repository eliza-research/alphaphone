// Test APK only: qualify Camera/Photos through the production account UI without
// real Cloud traffic or a resident service. Media and other native plugins stay real.
(() => {
  if (window.__alphaVideoAccount) throw Error('Video account fixture already installed');
  const native = Capacitor.nativePromise;
  const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
  const session = '12345678-1234-4234-8234-123456789def';
  let credential = null, binding = null, running = false;
  const calls = [];
  window.__alphaVideoAccount = { calls };
  Capacitor.nativePromise = async function(plugin, method, input = {}) {
    if (plugin === 'AlphaConnection') {
      if (input.slot === 'cloud:production') {
        if (method === 'secureRead') return { value: credential };
        if (method === 'secureWrite') { credential = input.value; return {}; }
        if (method === 'secureRemove') { credential = null; return {}; }
      }
      if (method === 'openExternal') {
        if (input.url !== `https://eliza.app/auth/cli-login?session=${session}`) throw Error('Unexpected account browser route');
        calls.push('browser-return'); return {};
      }
      if (method === 'request') {
        const url = new URL(input.url);
        if (url.origin !== 'https://api.eliza.app' || url.search || url.hash) throw Error('Unexpected account authority');
        const path = url.pathname;
        calls.push(path);
        if (path === '/api/auth/cli-session' && input.method === 'POST') return { status: 200, data: { sessionId: session, expiresAt: new Date(Date.now() + 60000).toISOString() } };
        if (path === `/api/auth/cli-session/${session}` && input.method === 'GET') return { status: 200, data: { status: 'authenticated', token: 'synthetic-video-account-only' } };
        const saved = credential && JSON.parse(credential);
        if (!saved || input.headers?.Authorization !== `Bearer ${saved.token}` || input.method !== 'GET') throw Error('Unbound account request');
        if (path === '/api/v1/user') return { status: 200, data: { success: true, data: { id } } };
        if (path === '/api/v1/subscription/entitlement') return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
        if (path === '/api/v1/credits/balance') return { status: 200, data: { balance: 5 } };
        throw Error('Unexpected account request');
      }
    }
    if (plugin === 'Agent') {
      calls.push(method);
      if (method === 'getStatus') return { packaged: true, state: running ? 'running' : 'stopped', serviceActive: running, socketListening: running };
      if (method === 'stop') { running = false; return {}; }
      if (method === 'configureCloudProvider') {
        const saved = credential && JSON.parse(credential);
        if (!saved || input.credentialId !== saved.credentialId || input.model !== 'cerebras/qwen-3.8-27b') throw Error('Unbound resident account');
        binding = input.credentialId; return { configured: true };
      }
      if (method === 'start') {
        if (!binding || binding !== JSON.parse(credential).credentialId) throw Error('Unbound resident startup');
        running = true; return {};
      }
      if (method === 'cancelStart') { running = false; return {}; }
      if (method === 'request' && running) {
        let body;
        if (input.path === '/api/auth/me' && input.method === 'GET') body = { identity: { id, kind: 'owner' }, access: { role: 'OWNER', mode: 'local' } };
        else if (input.path === '/api/agents' && input.method === 'GET') body = { agents: [{ id, name: 'Synthetic video admission', status: 'running' }] };
        else if (input.path === '/api/client-devices/register' && input.method === 'POST') body = { installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'video-fixture-enrollment', capabilities: [] };
        else if (input.path === '/api/conversations' && input.method === 'GET') body = { conversations: [] };
        else if (input.path === '/api/workflow/status' && input.method === 'GET') body = {};
        else throw Error('Unexpected resident request');
        return { status: 200, body: JSON.stringify(body) };
      }
      throw Error('Unexpected resident operation');
    }
    return native.apply(this, arguments);
  };
})();
