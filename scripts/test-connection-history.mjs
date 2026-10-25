// Controller + real Cloud protocol over synthetic loopback HTTP. No live account.
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
if (!process.execArgv.includes('--experimental-transform-types')) {
  process.exit(spawnSync(process.execPath, ['--experimental-transform-types', process.argv[1]], { stdio: 'inherit' }).status ?? 1);
}
const { AlphaAuthError, validPending } = await import('../apps/app/src/runtime/alpha-auth.ts');
const { CloudProtocol, CloudProvisionAcceptedError } = await import('../apps/app/src/runtime/cloud-protocol.ts');
const { phoneContextMessage } = await import('../apps/app/src/runtime/phone-context.ts');
const user = '11111111-1111-4111-8111-111111111111', agent = '22222222-2222-4222-8222-222222222222';
const conversation = '33333333-3333-4333-8333-333333333333';
let credential = { token: 'synthetic-token', credentialId: 'synthetic-generation' }, historyReads = 0, sends = 0;
const observed = phoneContextMessage('Earlier user text', { view: 'inbox', revision: 2, sensitive: false }).text;
const server = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer synthetic-token');
  let data, status = 200;
  if (req.url === '/api/v1/user') data = { success: true, data: { id: user } };
  else if (req.url === '/api/v1/eliza/agents') data = { success: true, data: [{ id: agent, agentName: 'Fixture', status: 'running', executionTier: 'shared' }] };
  else if (req.url === `/api/v1/eliza/agents/${agent}`) data = { success: true, data: { id: agent, agentName: 'Fixture', status: 'running', executionTier: 'shared' } };
  else if (req.url.endsWith('/api/conversations')) data = { conversations: [{ id: conversation, title: 'Saved conversation' }] };
  else if (req.url.endsWith(`/api/conversations/${conversation}/messages`)) {
    if (req.method === 'GET') { historyReads++; data = { messages: [{ id: 'u1', role: 'user', text: observed }, { id: 'a1', role: 'assistant', text: 'Earlier answer', actions: [{ type: 'unsafe' }] }] }; }
    else { sends++; data = { text: 'New answer', agentName: 'Fixture' }; }
  } else { status = 404; data = {}; }
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const memory = new Map();
const nativeCloudRequest = async input => {
  const url = new URL(input.url);
  assert.equal(url.origin, 'https://api.eliza.app');
  const response = await fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`, { method: input.method, headers: input.headers, signal: input.signal, body: input.body ? JSON.stringify(input.body) : undefined });
  return { status: response.status, data: await response.json() };
};
let clockRetirements=0,heldClockRetirement=null,clockRetirementStarted=null;
const retireClockReviews=async()=>{clockRetirements++;clockRetirementStarted?.();if(heldClockRetirement)await heldClockRetirement;};
const sandbox = { AlphaAuthError, validPending, nativeAlphaAuthenticate:async()=>{throw Error("Unexpected sign-in");}, retireClockReviews, workflowPresentationProtocol:async()=>2, browserDevProfile:false, secureConnectionStore:{read:async()=>null,write:async()=>{},remove:async()=>{}}, pauseHostedBackground:async()=>{}, configureHostedBackground:async()=>{}, registerPlugin: () => ({}), CloudProtocol, CloudProvisionAcceptedError, phoneContextMessage, nativeCloudRequest,
  cloudCredentialStore: { read: async () => credential, write: async (_environment, value) => { credential = value; }, clear: async () => { credential = null; } },
  openConnectionBrowser: async () => { throw new Error('Unexpected browser effect'); },
  isAndroid: false, localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) },
  URL, URLSearchParams, AbortController, DOMException, crypto: globalThis.crypto, console,
};
let source = (await readFile(new URL('../apps/app/src/runtime/connection-ui.tsx', import.meta.url), 'utf8')).split('export function ConnectionChooser()')[0];
source = source.replace(/^import .*;\n/gm, '').replace(/export /g, '');
source += '\nglobalThis.controller = connectionController;';
vm.runInNewContext(stripTypeScriptTypes(source, { mode: 'transform' }), sandbox);
const controller = sandbox.controller;
try {
  await controller.cloudList('production');
  assert.ok(controller.getSnapshot().cloudAccount);
  await controller.cloudChoose(agent);
  assert.equal(controller.getSnapshot().error,'','Cloud activation must succeed before history assertions');
  assert.ok(controller.getSnapshot().session,'Cloud agent session is active');
  await controller.listHistory();
  assert.equal(controller.getSnapshot().conversations[0].id, conversation);
  await controller.restoreHistory('not-authorized');
  assert.equal(historyReads, 0, 'membership check blocks unlisted history requests');
  assert.equal(controller.getSnapshot().history, null);
  await controller.restoreHistory(conversation);
  const restored = controller.getSnapshot().history;
  assert.equal(restored.messages[0].text, 'Earlier user text');
  assert.equal(restored.messages[1].text, 'Earlier answer');
  assert.deepEqual(Object.keys(restored.messages[1]).sort(), ['from', 'id', 'text']);
  assert.equal(sends, 0, 'restoring history never sends or executes actions');
  await controller.send('New question', { view: 'home', revision: 1, sensitive: false }, 'synthetic-id', new AbortController().signal);
  assert.equal(sends, 1, 'next send uses the explicitly restored conversation');
  const beforeRetirements=clockRetirements;
  let releaseClockRetirement;heldClockRetirement=new Promise(resolve=>{releaseClockRetirement=resolve;});
  const retirementStarted=new Promise(resolve=>{clockRetirementStarted=resolve;});
  let disconnected=false;const disconnect=controller.disconnect().then(()=>{disconnected=true;});
  await retirementStarted;
  assert.equal(clockRetirements,beforeRetirements+1,'disconnect retires the native Clock owner once');
  assert.equal(disconnected,false,'connection retirement must await the native Clock acknowledgement');
  releaseClockRetirement();await disconnect;heldClockRetirement=null;

  assert.equal(controller.getSnapshot().session, null);
  assert.ok(controller.getCloudClient(), 'agent disconnect retains Cloud services');
  const bound = controller.getCloudClient();
  assert.equal(controller.rejectCloudSession('stale-session', { status: 401 }), false);
  assert.equal(controller.rejectCloudSession(bound.sessionId, { status: 401 }), true);
  assert.equal(controller.getCloudClient(), null);
  console.log('PASS: real Cloud protocol/controller HTTP history membership, context stripping, action exclusion, next-send binding, separate service disconnect and scoped rejection. Synthetic only.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
