import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionQuality, metres } from '../src/ui/live-board.js';
test('connection dot only shows milliseconds above 300',()=>{
  assert.deepEqual(connectionQuality(60),{band:'good',label:''});
  assert.deepEqual(connectionQuality(300),{band:'fair',label:''});
  assert.deepEqual(connectionQuality(6912),{band:'poor',label:'6912 ms'});
});
test('running gaps are finite distances and unknown gaps stay unknown',()=>{
  assert.equal(metres(-8.2),'8 m');assert.equal(metres(null),'—');assert.equal(metres(NaN),'—');
});
