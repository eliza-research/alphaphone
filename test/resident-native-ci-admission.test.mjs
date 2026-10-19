import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('real CI source verifier binds the merged recovery pair and rejects forged receipts, source and generated hashes',()=>{
 const result=execFileSync('python3',['-c',String.raw`
import sys,copy,json,hashlib,subprocess
from pathlib import Path
sys.path.insert(0,'scripts/ci')
from resident_native_source import verify_generated_native
h=lambda value:hashlib.sha256(value).hexdigest()
lock=json.loads(Path('upstream.lock.json').read_text())
generated={'runtimeSource':{'commit':lock['commit']},'patches':[],'files':[]};frozen={}
for relative in ['scripts/upstream-native-source.mjs','scripts/stage-local-agent-sources.mjs']:
 frozen[relative]=h(Path(relative).read_bytes())
originals=['packages/app/platforms/android/app/src/main/java/ai/elizaos/app/'+name+'.java' for name in ['ElizaAgentService','IpcStartupRecovery','SecureStoreFrameInput']]
for index,origin in enumerate(originals):
 committed=subprocess.check_output(['git','-C','vendor/eliza','show',lock['commit']+':'+origin]);target='android/app/build/generated/local-agent/java/fixture'+str(index)+'.java';output=h(('synthetic identity-specific output '+str(index)).encode());frozen[target]=output
 generated['files'].append({'path':origin,'sourceSha256':h(committed),'sha256':h(committed),'generatedPath':target,'generatedSha256':output})
assert verify_generated_native(generated,frozen)=={}
mutations=[lambda g:g.update(patches=[{'unreviewed':True}]),lambda g:g.update(runtimeSource={'commit':'0'*40}),lambda g:g['files'][0].update(sourceSha256='0'*64),lambda g:g['files'][2].update(sha256='0'*64),lambda g:g['files'][0].update(generatedSha256='0'*64),lambda g:g['files'].pop(0)]
for mutate in mutations:
 changed=copy.deepcopy(generated);mutate(changed)
 try:verify_generated_native(changed,frozen)
 except AssertionError:pass
 else:raise AssertionError('Tampered native source was accepted')
changed=copy.deepcopy(frozen);changed['scripts/stage-local-agent-sources.mjs']='0'*64
try:verify_generated_native(generated,changed)
except AssertionError:pass
else:raise AssertionError('Changed source generator was accepted')
print('PASS: valid patchless source plus seven tamper cases; no device actions')
`],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
 assert.match(result,/PASS: valid patchless source plus seven tamper cases/);
});
