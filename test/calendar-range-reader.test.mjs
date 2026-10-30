import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
// A candidate may point this test at an explicit upstream checkout before pin admission.
// Production always uses the reviewed submodule; this variable affects tests only.
const shared=process.env.ELIZA_CALENDAR_TEST_PLUGIN||join(root,'vendor/eliza/plugins/plugin-native-calendar');
test('Android Calendar uses the same bounded shared reader and keeps incomplete results visible',()=>{
 const runner=join(shared,'test/native-host/read-window.test.mjs');
 assert.ok(existsSync(runner),'The admitted upstream Calendar bridge must provide the range contract');
 const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
 const result=execFileSync(process.execPath,['--test',runner],{env:environment,encoding:'utf8',stdio:'pipe',timeout:60000});
 assert.match(result,/(?:pass 1|# pass 1)/,'The shared contract actually ran');
 const plugin=readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCalendarPlugin.java'),'utf8');
 assert.match(plugin,/"Alpha Phone","alpha-phone-local","On this phone","alpha-calendar-creations-v1","alphaphone:\/\/calendar-creation\/",0xff0000ff,2000/);
 for(const method of ['list','saveOptions','readOptions','pendingCreations','acknowledgeCreation','insertHandoff'])assert.doesNotMatch(plugin,new RegExp(`public (?:synchronized )?void ${method}\\(`),`${method} belongs to the shared bridge`);
 assert.equal(existsSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CalendarRangeReader.java')),false,'No second provider reader');
 assert.match(plugin,/protected boolean deferReviewedDeletion\(\)\{return true;\}/);
 assert.match(plugin,/DeletionDispatchClaim\.check/);
 assert.match(plugin,/CalendarSyncFreshness\.requireLocal/);
 assert.match(plugin,/LateLaunch\.ask\(call,\(\)->super\.requestAccess\(call\)\)/);
 const adapter=readFileSync(join(root,'apps/app/src/prototype/calendar-adapter.ts'),'utf8');
 assert.match(adapter,/truncated=!!result\.truncated/);
 assert.match(adapter,/rangeReady&&truncated\?'Calendar results incomplete\. Some events may be missing\.'/);
});
