import test from 'node:test';
import assert from 'node:assert/strict';
import {runJvm,nativeSource,fixture} from './fixtures/jvm-tools.mjs';
test('native SMS adapter retains tenant binding and refuses malformed input or required captcha',()=>{
 assert.match(runJvm(['CloudDeployment.java','CloudSignInFlow.java','CloudSmsCode.java','ConnectionRoutes.java'].map(nativeSource).concat(fixture('CloudSmsCodeTest.java')),'ai.elizaresearch.alphaphone.CloudSmsCodeTest',{json:true}),/PASS SMS adapter/);
});
