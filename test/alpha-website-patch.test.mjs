import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

test('website patch preserves canonical marketing URLs but serves Alpha returns at the registered host', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alpha-website-'));
  try {
    writeFileSync(join(dir, 'next.config.ts'), readFileSync('test/fixtures/alpha-website/next.config.ts'));
    execFileSync('git', ['apply', '--unsafe-paths', '-'], { cwd: dir, input: readFileSync('deployment/alpha-auth/website-next-config.patch') });
    const source = readFileSync(join(dir, 'next.config.ts'), 'utf8');
    const code = stripTypeScriptTypes(source.replace('import { withPayload } from "@payloadcms/next/withPayload";', ''), { mode: 'strip' }).replace('export default withPayload(nextConfig);', 'return nextConfig;');
    const load = env => new Function('process', code)({ env });
    const config = load({ APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://www.alphacompute.ai' });
    const redirects = await config.redirects();
    const canonical = redirects.find(rule => rule.has?.some(match => match.type === 'host' && match.value === 'alphacompute.ai'));
    assert.equal(canonical.destination, 'https://www.alphacompute.ai/:path*');
    // Exercise the route's custom regex; a real Next build remains a deployment gate.
    const regex = new RegExp('^/' + canonical.source.slice(7, -1) + '$');
    const callbacks = ['/alphaphone/auth/callback','/alphaphone/auth/staging/callback','/alphaphone/gmail/callback','/alphaphone/gmail/staging/callback'];
    for (const path of [...callbacks, '/alphaphone/auth/callback.js','/alphaphone/auth/callback.css','/.well-known/assetlinks.json']) assert.equal(regex.test(path), false, path);
    for (const path of ['/','/compute','/newsroom','/alphaphone-more','/.well-known/security.txt','/.well-known/assetlinks.json-other']) assert.equal(regex.test(path), true, path);
    const routes = await config.rewrites();
    for (const path of callbacks) assert.equal(routes.beforeFiles.find(rule => rule.source === path)?.destination, '/alphaphone/auth/callback.html');
    assert.ok(routes.beforeFiles.some(rule => rule.source === '/robots.txt'));
    const headers = await config.headers();
    const verification = headers.find(rule => rule.source === '/alphaphone/verify/:path*').headers;
    assert.equal(verification.find(header => header.key === 'Content-Security-Policy').value,readFileSync('deployment/alpha-auth/verification/csp.txt','utf8').trim());
    const auth = headers.find(rule => rule.source === '/alphaphone/:path*').headers;
    assert.ok(headers.findIndex(rule => rule.source === '/alphaphone/:path*') > headers.findIndex(rule => rule.source === '/:path*'));
    assert.equal(auth.find(header => header.key === 'Referrer-Policy').value,'no-referrer');
    assert.equal(auth.find(header => header.key === 'Cache-Control').value,'no-store, no-transform');
    assert.match(auth.find(header => header.key === 'Content-Security-Policy').value,/frame-ancestors 'none'/);
    assert.equal(headers.find(rule => rule.source === '/.well-known/assetlinks.json').headers[0].value,'application/json');
    const staging = load({ APP_ENV:'staging', NEXT_PUBLIC_SITE_URL:'https://staging.example' });
    assert.equal((await staging.redirects()).some(rule => rule.has),false);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
