// Synthetic HTTP lifecycle exercise. No request leaves loopback; this is not
// evidence of live Cloud login, provider consent, native storage, or deployment.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
if (!process.execArgv.includes('--experimental-transform-types')) {
  const child = spawnSync(process.execPath, ['--experimental-transform-types', process.argv[1]], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
const { CloudProtocol } = await import('../apps/app/src/runtime/cloud-protocol.ts');
const id = '72475cd0-e135-4c42-a9e2-fb5fe0820ada';
const sessionId = 'd32f7f34-962b-47b7-8f0d-f2fe7f12610a';
const token = 'synthetic-cloud-session';
let mode = 'ok', agentReads = 0, polls = 0, saved = null;
const runtimeTargets = [];
const mail = { externalId: 'mail/id', threadId: 'thread', subject: 'Synthetic subject', from: 'Fixture sender', fromEmail: 'sender@example.invalid', to: ['owner@example.invalid'], snippet: 'Synthetic preview', receivedAt: '2026-09-29T12:00:00Z', isUnread: true };
const grant = 'grant/one';
const conversationId = 'ed694c7a-d9a7-4a8c-a547-533040bc1c79';
let pendingObserved;
const agent = () => ({ id, agentName: 'Synthetic agent', status: 'running', executionTier: mode === 'shared' ? 'shared' : 'dedicated-lazy',
  webUiUrl: mode === 'shared' ? null : mode === 'foreign-runtime' ? 'https://attacker.invalid/' : `https://${id}.cloud.eliza.app` });
const server = http.createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    let status = 200, data;
    if (req.url === '/api/auth/cli-session') {
      assert.equal(req.method, 'POST'); assert.deepEqual(body, {});
      data = { sessionId, status: 'pending', expiresAt: new Date(Date.now() + (mode === 'expiry' ? 80 : 60000)).toISOString() };
    } else if (req.url === `/api/auth/cli-session/${sessionId}`) {
      polls++;
      if (mode === 'pending' || mode === 'expiry') { data = { status: 'pending' }; pendingObserved?.(); }
      else if (mode === 'consumed') data = { status: 'authenticated', message: 'API key already retrieved' };
      else data = { status: 'authenticated', token, apiKey: 'synthetic-legacy-key', expiresAt: new Date(Date.now() + 60000).toISOString() };
    } else {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      if (req.url === '/api/v1/eliza/agents') agentReads++;
      if (mode === 'outage') { status = 503; data = {}; }
      else if (req.url === '/api/v1/user') data = { success: true, data: { id, organization_id: sessionId } };
      else if (req.url.endsWith('/api/conversations') && req.method === 'POST') data = { conversation: { id: conversationId, title: body.title } };
      else if (req.url.endsWith('/api/conversations')) data = { conversations: [{ id: conversationId, title: 'Fixture' }] };
      else if (req.url.endsWith(`/api/conversations/${conversationId}/messages`) && req.method === 'GET') data = { messages: [{ id: 'history-user', role: 'user', text: 'Earlier question', timestamp: 1 }, { id: 'history-agent', role: 'assistant', text: 'Earlier answer', timestamp: 2 }] };
      else if (req.url.endsWith(`/api/conversations/${conversationId}/messages`)) {
        assert.equal(body.text, 'Hello'); assert.equal(body.channelType, 'DM');
        assert.equal(body.clientMessageId, 'synthetic-message');
        data = { text: 'Synthetic response', agentName: 'Fixture' };
      }
      else if (req.url === '/api/v1/eliza/agents') { assert.equal(req.method, 'GET'); data = { success: true, data: [agent()] }; }
      else if (req.url === `/api/v1/eliza/agents/${id}`) { assert.equal(req.method, 'GET'); data = { success: true, data: agent() }; }
      else if (req.url === '/api/v1/eliza/google/connect/initiate') {
        assert.deepEqual(body, { side: 'owner', capabilities: mode === 'gmail-modify'
          ? ['google.basic_identity', 'google.gmail.triage', 'google.gmail.send', 'google.gmail.drafts', 'google.gmail.mailbox']
          : ['google.basic_identity', 'google.gmail.triage'] });
        data = { authUrl: mode === 'foreign-oauth' ? 'https://attacker.invalid/' : 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' };
      } else if (req.url === '/api/v1/eliza/google/accounts?side=owner') data = [{ configured: true, connected: true, reason: 'connected', connectionId: grant, grantedCapabilities: ['google.gmail.triage'], identity: { email: 'owner@example.invalid' } }];
      else if (req.url.startsWith('/api/v1/eliza/google/gmail/')) {
        const url = new URL(req.url, 'http://localhost'); assert.equal(url.searchParams.get('grantId'), grant); assert.equal(req.method, 'GET');
        if (url.pathname.endsWith('/search')) {
          assert.ok(['in:inbox', 'in:sent'].includes(url.searchParams.get('query'))); assert.ok(['25', '50'].includes(url.searchParams.get('maxResults')));
          const pageToken = url.searchParams.get('pageToken');
          data = { messages: [mail], syncedAt: '2026-09-29T12:00:00Z', ...(mode === 'paged' ? { nextPageToken: pageToken ? null : 'opaque+/token=' } : mode === 'repeat-token' ? { nextPageToken: pageToken } : {}) };
        }
        else if (url.pathname.endsWith('/inbox-v1/capabilities')) data = { version: 1, from: 'owner@example.invalid', threads: true, send: false, providerDrafts: false, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false, ...(mode === 'read-state' ? { readState: true } : mode === 'bad-read-state' ? { readState: 'yes' } : {}) };
        else { assert.equal(url.searchParams.get('messageId'), mail.externalId); data = { message: mail, bodyText: '<script>plain untrusted email text</script>' }; }
      }
      else if (req.url === '/api/v1/eliza/google/disconnect') { assert.equal(req.method, 'POST'); assert.deepEqual(body, { side: 'owner', connectionId: grant }); data = mode === 'bad-disconnect' ? {} : { ok: true }; }
      else if (req.url === '/api/v1/eliza/google/status?side=owner') data = { configured: true, connected: false, reason: 'disconnected', connectionId: null, grantedCapabilities: [] };
      else throw new Error('Unexpected synthetic route');
    }
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ fixtureError: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const loopback = `http://127.0.0.1:${server.address().port}`;
const request = async ({ url, method, headers, body, signal, redirect }) => {
  const target = new URL(url);
  assert.ok(['https://api.eliza.app', 'https://api-staging.eliza.app', `https://${id}.cloud.eliza.app`].includes(target.origin));
  if (target.pathname.includes('/api/conversations')) runtimeTargets.push(target.origin + target.pathname);
  assert.equal(redirect, 'error');
  const response = await fetch(loopback + target.pathname + target.search, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect });
  return { status: response.status, data: await response.json() };
};
const store = {
  async read() { return saved; },
  async write(_environment, value, signal) { signal.throwIfAborted(); saved = structuredClone(value); },
  async clear() { saved = null; },
};
const opened = [];
const make = (environment = 'production') => new CloudProtocol(environment, request, store, async (url, signal) => { signal.throwIfAborted(); opened.push(url); });
const signal = () => new AbortController().signal;
try {
  const client = make();
  await client.login(signal());
  assert.equal(saved.token, token, 'session token preferred over legacy API key');
  assert.equal(opened.at(-1), `https://eliza.app/auth/cli-login?session=${sessionId}`);
  assert.equal((await client.identity(signal())).userId, id);
  assert.equal((await client.listAgents(signal()))[0].id, id);
  assert.equal((await client.listConversations(id, signal()))[0].id, conversationId);
  assert.equal((await client.createConversation(id, 'Fixture', signal())).id, conversationId);
  assert.equal((await client.send(id, conversationId, 'Hello', { clientMessageId: 'synthetic-message', signal: signal() })).text, 'Synthetic response');
  assert.ok(runtimeTargets.every(target => target.startsWith(`https://${id}.cloud.eliza.app/`)));
  assert.equal((await client.messages(id, conversationId, signal())).messages[1].text, 'Earlier answer');
  mode = 'shared';
  assert.equal((await client.messages(id, conversationId, signal())).messages[0].role, 'user');
  await client.send(id, conversationId, 'Hello', { clientMessageId: 'synthetic-message', signal: signal() });
  assert.equal(runtimeTargets.at(-1), `https://api.eliza.app/api/v1/eliza/agents/${id}/api/conversations/${conversationId}/messages`);
  mode = 'ok';
  assert.equal((await make().agentDetail(id, signal())).id, id, 'new client restores injected credentials');
  assert.match(await client.initiateGmail(signal()), /^https:\/\/accounts.google.com\//);
  // Incremental grant (P-37): the modify step is one consent that keeps read and adds every change capability.
  mode = 'gmail-modify'; assert.match(await client.initiateGmail(signal(), 'modify'), /^https:\/\/accounts.google.com\//); mode = 'ok';
  assert.equal((await client.gmailStatus(signal())).connected, false);
  assert.equal((await client.gmailAccounts(signal()))[0].connectionId, grant);
  assert.equal((await client.gmailSearch(grant, 'in:inbox', signal())).messages[0].id, mail.externalId);
  assert.equal((await client.gmailSearch(grant, 'in:inbox', signal(), 50)).messages[0].id, mail.externalId);
  assert.equal((await client.gmailRead(grant, mail.externalId, signal())).bodyText, '<script>plain untrusted email text</script>');
  assert.equal((await client.gmailSearch(grant, 'in:inbox', signal())).nextPageToken, null, 'absent cursor means last page');
  mode = 'paged';
  const first = await client.gmailSearch(grant, 'in:inbox', signal());
  assert.equal(first.nextPageToken, 'opaque+/token=');
  assert.equal((await client.gmailSearch(grant, 'in:sent', signal(), 25, first.nextPageToken)).nextPageToken, null, 'opaque cursor is sent back exactly');
  mode = 'repeat-token'; await assert.rejects(client.gmailSearch(grant, 'in:inbox', signal(), 25, 'same'), error => error.code === 'invalid-response', 'a repeated cursor cannot loop');
  await assert.rejects(client.gmailSearch(grant, 'in:inbox', signal(), 25, ''), TypeError);
  mode = 'ok'; assert.equal((await client.gmailInboxCapabilities(grant, signal())).readState, false, 'older servers do not advertise read state');
  mode = 'read-state'; assert.equal((await client.gmailInboxCapabilities(grant, signal())).readState, true);
  mode = 'bad-read-state'; await assert.rejects(client.gmailInboxCapabilities(grant, signal()), error => error.code === 'invalid-response');
  mode = 'ok'; await client.disconnectGmail(grant, signal());
  mode = 'bad-disconnect'; await assert.rejects(client.disconnectGmail(grant, signal()), error => error.code === 'invalid-response');
  mode = 'ok';
  mode = 'foreign-runtime'; await assert.rejects(client.listAgents(signal()), error => error.code === 'invalid-response');
  mode = 'foreign-oauth'; await assert.rejects(client.initiateGmail(signal()), error => error.code === 'invalid-response');
  const readsBeforeOutage = agentReads;
  mode = 'outage'; await assert.rejects(client.listAgents(signal()), error => error.status === 503);
  assert.equal(agentReads, readsBeforeOutage + 1); assert.ok(saved);
  await client.disconnect(); assert.equal(saved, null);
  await assert.rejects(client.listAgents(signal()), error => error.code === 'credentials-missing');
  mode = 'consumed'; await assert.rejects(client.login(signal()), error => error.code === 'credential-consumed');
  assert.equal(saved, null);
  mode = 'expiry'; await assert.rejects(client.login(signal()), error => error.code === 'expired');
  assert.equal(saved, null);
  mode = 'pending';
  const seen = new Promise(resolve => { pendingObserved = resolve; });
  const cancel = new AbortController();
  const login = client.login(cancel.signal);
  const rejection = assert.rejects(login, error => error.name === 'AbortError');
  await seen;
  await assert.rejects(client.login(signal()), error => error.code === 'login-active');
  cancel.abort(); await rejection; assert.equal(saved, null);
  const pollsAtCancel = polls; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(polls, pollsAtCancel);
  mode = 'ok'; await make('staging').login(signal());
  assert.equal(opened.at(-1), `https://staging.eliza.app/auth/cli-login?session=${sessionId}`);
  await client.disconnect();
  process.stdout.write('PASS: synthetic HTTP Cloud login, credential preference/storage, restart, agent list/detail, dedicated/shared conversation routing and send, Gmail scopes/status/account/search/read, search paging, read-state capability, disconnect, URL rejection, outage without retry, consumed claim, expiry, cancellation and staging routing. No live account acceptance.\n');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
