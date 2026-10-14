import test from 'node:test';import assert from 'node:assert/strict';
import { GameplayToast } from '../src/gameplay-toast.js';
test('notice queued during menus retains a full race-HUD lifetime',()=>{
 const q=new GameplayToast();q.enqueue('MANUAL ONLY');assert.equal(q.sample(false,0),null);assert.equal(q.sample(false,10000),null);assert.equal(q.sample(true,10001).message,'MANUAL ONLY');assert.ok(q.sample(true,12800));assert.equal(q.sample(true,12801),null);
});
test('opening a menu pauses an already visible notice until driving resumes',()=>{
 const q=new GameplayToast();q.enqueue('MODE LOCKED');q.sample(true,0);assert.equal(q.sample(false,1000),null);q.sample(false,20000);assert.equal(q.sample(true,20001).ms,1800);assert.equal(q.sample(true,21801),null);
});
test('a newer car notice replaces stale queued car policy',()=>{
 const q=new GameplayToast();q.enqueue('MANUAL ONLY');q.sample(false,0);q.enqueue('AUTO ONLY',{ms:3500,tone:'bad',icon:'warning'});assert.deepEqual(q.sample(true,100),{message:'AUTO ONLY',ms:3500,tone:'bad',icon:'warning'});
});
