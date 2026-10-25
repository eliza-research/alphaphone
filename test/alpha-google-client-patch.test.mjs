import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('Alpha Google client patch composes with error returns and isolates consent credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alpha-google-client-'));
  const routeDir = 'packages/auth/src/server/api/src/routes';
  try {
    mkdirSync(join(dir, routeDir), { recursive: true });
    writeFileSync(join(dir, routeDir, 'auth.ts'), readFileSync('vendor/eliza/' + routeDir + '/auth.ts'));
    for (const patch of ['alpha-auth-error-return.patch', 'alpha-google-client.patch', 'alpha-auth-readiness.patch']) {
      execFileSync('git', ['apply', '--unsafe-paths', '-'], { cwd: dir, input: readFileSync('patches/eliza/' + patch) });
    }
    const { getAppOAuthProviderConfig: select } = await import(pathToFileURL(join(dir, routeDir, 'oauth-app-provider.ts')).href);
    const production = 'https://alphacompute.ai/alphaphone/auth/callback';
    const staging = 'https://alphacompute.ai/alphaphone/auth/staging/callback';
    const env = { STEWARD_ALPHA_GOOGLE_REDIRECTS: production, STEWARD_ALPHA_GOOGLE_CLIENT_ID: 'synthetic-alpha-id', STEWARD_ALPHA_GOOGLE_CLIENT_SECRET: 'synthetic-alpha-secret' };
    const sharedCalls = [];
    const shared = provider => { sharedCalls.push(provider); return { clientId: 'synthetic-shared' }; };
    const selected = select('google', production, shared, env);
    assert.equal(selected.clientId, env.STEWARD_ALPHA_GOOGLE_CLIENT_ID);
    assert.equal(selected.clientSecret, env.STEWARD_ALPHA_GOOGLE_CLIENT_SECRET);
    assert.equal(selected.authorizationUrl, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(selected.tokenUrl, 'https://oauth2.googleapis.com/token');
    assert.deepEqual(selected.scopes, ['openid', 'email', 'profile']);
    assert.deepEqual(sharedCalls, []);
    for (const config of [{}, { ...env, STEWARD_ALPHA_GOOGLE_REDIRECTS: staging }, { ...env, STEWARD_ALPHA_GOOGLE_CLIENT_ID: '' }, { ...env, STEWARD_ALPHA_GOOGLE_CLIENT_SECRET: ' ' }]) {
      assert.throws(() => select('google', production, shared, config), /Alpha Phone Google sign-in is not configured/);
    }
    assert.deepEqual(sharedCalls, [], 'unconfigured Alpha must never fall back to shared credentials');
    assert.throws(() => select('google', staging, shared, env), /not configured/);
    assert.equal(select('google', staging, shared, { ...env, STEWARD_ALPHA_GOOGLE_REDIRECTS: staging }).clientId, selected.clientId);
    for (const target of ['https://eliza.app/callback', production + '/extra', production + '?state=x', production + '#x', 'https://alphacompute.ai.evil.example/alphaphone/auth/callback', 'https://user@alphacompute.ai/alphaphone/auth/callback', undefined]) {
      assert.equal(select('google', target, shared, env).clientId, 'synthetic-shared');
    }
    assert.equal(select('github', production, shared, env).clientId, 'synthetic-shared');
    assert.equal(sharedCalls.at(-1), 'github');
    // Execute both patched constructor expressions: authorization uses the requested
    // registered redirect; callback uses its validated server-state URL. No query override.
    const route = readFileSync(join(dir, routeDir, 'auth.ts'), 'utf8');
    const expressions = [...route.matchAll(/oauthClient = new OAuthClient\((getAppOAuthProviderConfig\([^;]+)\);/g)].map(match => match[1]);
    assert.equal(expressions.length, 2);
    for (const expression of expressions) {
      const create = new Function('getAppOAuthProviderConfig', 'providerName', 'redirectUri', 'redirectUrl', 'getProviderConfig', 'process', 'return ' + expression);
      assert.equal(create(select, 'google', production, new URL(production), shared, { env }).clientId, selected.clientId);
    }
    const { buildOAuthAppErrorReturn } = await import(pathToFileURL(join(dir, routeDir, 'oauth-app-error-return.ts')).href);
    let handler;
    let allowedPolicy = true, registered = true, rateAllowed = true;
    const readinessEnv = { ...env, STEWARD_OAUTH_APP_ERROR_REDIRECTS: production };
    const source = route.slice(route.indexOf('auth.get("/oauth/google/alpha-readiness"'), route.indexOf('auth.get("/oauth/:provider/authorize"'));
    new Function('auth','checkAuthRateLimit','requireTenantLoginMethodAllowed','assertAllowedOAuthRedirectUri','getAppOAuthProviderConfig','getProviderConfig','process','buildOAuthAppErrorReturn', source)(
      {get: (_path, callback) => {handler = callback}},
      async () => ({allowed:rateAllowed}),
      async () => allowedPolicy ? null : {},
      async () => {if (!registered) throw Error('not registered')},
      select, shared, {env:readinessEnv}, buildOAuthAppErrorReturn,
    );
    const check = async (tenantId='elizacloud',redirectUri=production) => {
      const headers = {};
      const result = await handler({req:{query:key=>({tenant_id:tenantId,redirect_uri:redirectUri})[key]},header:(key,value)=>{headers[key]=value},json:(data,status=200)=>({data,status})});
      assert.equal(headers['Cache-Control'],'no-store');
      assert.ok(!JSON.stringify(result).includes('synthetic-alpha-secret'));
      return result;
    };
    assert.deepEqual(await check(),{status:200,data:{ok:true,alphaAuth:1,tenantId:'elizacloud',redirectUri:production}});
    assert.equal((await check('elizacloud',staging)).status,400);
    assert.equal((await check('unknown')).status,400);
    allowedPolicy=false;assert.equal((await check()).status,403);allowedPolicy=true;
    registered=false;assert.equal((await check()).status,503);registered=true;
    rateAllowed=false;assert.equal((await check()).status,429);rateAllowed=true;
    delete readinessEnv.STEWARD_OAUTH_APP_ERROR_REDIRECTS;
    assert.equal((await check()).status,503);
    readinessEnv.STEWARD_OAUTH_APP_ERROR_REDIRECTS=production;
    delete readinessEnv.STEWARD_ALPHA_GOOGLE_CLIENT_SECRET;
    assert.equal((await check()).status,503);
    assert.match(route, /provisionOAuthUser\(\{\s*c,\s*providerName,/);
    assert.equal((route.match(/new OAuthClient\(getProviderConfig\(providerName\)\)/g) || []).length, 1, 'legacy unbound exchange unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
