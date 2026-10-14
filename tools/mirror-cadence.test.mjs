import test from 'node:test';
import assert from 'node:assert/strict';
import { MirrorCadence } from '../src/mirror-cadence.js';

test('mirrors advance when displayed physics steps remain odd, even, or paused', () => {
  for (const frames of [[1,3,5,7,9,11], [2,4,6,8,10,12], [7,7,7,7,7,7]]) {
    const clock=new MirrorCadence(), updates=[];
    frames.forEach((frame,i)=>{const now=i*33;if(clock.due(now)){clock.rendered(now);updates.push(frame);}});
    assert.equal(updates.length,3);
  }
});
test('tab restore, pause and clock reset refresh at the first opportunity', () => {
  for(const now of [100,5000,-1]) { const c=new MirrorCadence();c.rendered(0);assert.equal(c.due(now),true); }
});
test('quality disable or camera exit resets cadence; new cars have independent clocks', () => {
  const c=new MirrorCadence();c.rendered(0);assert.equal(c.due(16),false);
  c.reset();assert.equal(c.due(17),true);c.rendered(17);
  assert.equal(new MirrorCadence().due(18),true);
});
test('failed reflection remains due until successfully rendered', () => {
  const c=new MirrorCadence();assert.equal(c.due(0),true);assert.equal(c.due(1),true);
  c.rendered(1);assert.equal(c.due(17),false);assert.equal(c.due(33),true);
  assert.equal(c.due(34),true);
});
