import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('HTML email rendering isolates untrusted content and remote images',()=>{
 execFileSync(process.execPath,['scripts/test-mail-html.mjs'],{stdio:'pipe',timeout:30000});
});
