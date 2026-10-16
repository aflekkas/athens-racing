import test from 'node:test';
import assert from 'node:assert/strict';
import {hillsideCoverProfile,hillsideClusterSelected} from '../src/hillside-cover-policy.js';
import {buildHillsideCover} from '../src/hillside-cover.js';
test('owner lock disables hillside vegetation for every legacy quality value',()=>{
 const message='Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
 for(const quality of ['low','med','medium','high','ultra','unknown']){
  assert.equal(hillsideCoverProfile(quality).density,0,message);
  assert.equal(hillsideClusterSelected(10,20,1),false,message);
  assert.equal(buildHillsideCover(),null,message);
 }
});
