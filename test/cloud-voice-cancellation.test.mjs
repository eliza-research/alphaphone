import test from 'node:test';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');

test('Cloud playback actual renderer cancels despite stalled native cleanup and rejects stale completions',()=>{
  execFileSync(process.execPath,['--experimental-transform-types','scripts/test-cloud-voice-cancellation-flow.mjs'],{cwd:root,timeout:15000,stdio:'pipe'});
});
