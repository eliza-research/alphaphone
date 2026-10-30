import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sourceDirectory, verifySource} from '../../scripts/local-agent-source.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let prepared;

/** Real installed SDK code, authenticated against this consumer's pin. */
export function preparedSdkForTests() {
  if (prepared) return prepared;
  const source = process.env.ALPHA_CLOUD_COLLECTOR_SOURCE
    ? path.resolve(process.env.ALPHA_CLOUD_COLLECTOR_SOURCE)
    : sourceDirectory(root);
  const {commit} = JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8'));
  try { verifySource(source, commit); }
  catch (error) { throw new Error('Prepare the pinned SDK with npm run agent:prepare before npm run verify.', {cause: error}); }
  const {packageManager} = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const expected = /^bun@(.+)$/.exec(packageManager)?.[1];
  const bun = process.env.ALPHA_BUN || process.env.BUN || 'bun';
  const version = spawnSync(bun, ['--version'], {encoding: 'utf8', timeout: 10000});
  if (!expected || version.status !== 0 || version.stdout.trim() !== expected)
    throw new Error(`The pinned SDK tests require Bun ${expected || '(declared by the SDK)'}. Select it on PATH or with ALPHA_BUN.`);
  prepared = {source, bun};
  return prepared;
}
