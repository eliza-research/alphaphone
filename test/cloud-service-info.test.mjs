import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCloudServiceInfo} from '../apps/app/src/runtime/cloud-service-info.ts';
const doc={title:'Terms',revision:'revision-1',sections:[{title:'Scope',paragraphs:['  Exact text.\nSecond line.  ','<script>not markup</script>']}]};
const response={success:true,version:1,service:{name:'Example service',terms:doc,privacy:doc}};
test('public service documents retain text and reject incomplete, foreign-version and credential-bearing responses',()=>{
 assert.deepEqual(parseCloudServiceInfo(response),response.service);
 for(const invalid of [null,{}, {...response,version:2},{...response,token:'unexpected'}, {...response,service:{...response.service,terms:{...doc,sections:[]}}},{...response,service:{...response.service,privacy:{...doc,sections:[{title:'Empty',paragraphs:[' ']}]}}}])assert.throws(()=>parseCloudServiceInfo(invalid),/unavailable/);
});
