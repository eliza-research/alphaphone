import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('Gmail read-ahead obeys account, request and lifetime boundaries',()=>{
 execFileSync(process.execPath,['--import=tsx','scripts/test-gmail-read-ahead.ts'],{stdio:'pipe',timeout:30000});
});
