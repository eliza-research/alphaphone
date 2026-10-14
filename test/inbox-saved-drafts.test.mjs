import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('saved Inbox drafts use the platform store and preserve account/conflict boundaries',()=>{
 execFileSync(process.execPath,['scripts/test-inbox-saved-drafts.mjs'],{stdio:'pipe',timeout:30000});
});
