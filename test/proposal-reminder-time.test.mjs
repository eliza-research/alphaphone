import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalActions, turns } from '../backend/proposal-action.ts';
test('ambiguous reminder action requests clarification without creating a proposal',async()=>{
 const proposals=[];const action=proposalActions.find(action=>action.name==='CREATE_REMINDER');
 const result=await turns.run({revision:1,proposals,signal:new AbortController().signal},()=>action.handler(null,null,null,{parameters:{title:'Check timing',body:'Test',localDateTime:'2026-11-01T01:30',timeZone:'America/New_York'}}));
 assert.equal(result.success,false);assert.match(result.text,/ambiguous/);assert.deepEqual(proposals,[]);
});

test('unambiguous future reminder prepares an exact proposal without scheduling',async()=>{
 const proposals=[];const action=proposalActions.find(action=>action.name==='CREATE_REMINDER');
 const result=await turns.run({revision:7,proposals,signal:new AbortController().signal},()=>action.handler(null,null,null,{parameters:{title:'Future reminder',body:'Exact body',localDateTime:'2080-10-20T09:00',timeZone:'Asia/Kolkata'}}));
 assert.equal(result.success,true);assert.equal(proposals.length,1);assert.equal(proposals[0].contextRevision,7);assert.deepEqual(proposals[0].operation,{type:'create_reminder',title:'Future reminder',body:'Exact body',at:Date.parse('2080-10-20T03:30:00Z')});
});
