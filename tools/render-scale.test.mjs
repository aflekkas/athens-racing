// Adaptive render scale (src/render-scale.js): drops resolution only when that makes frames faster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderScale } from '../src/render-scale.js';

function run(scale, seconds, frameMs) {
  const changes = []; let t = 0;
  while (t < seconds * 1000) { const ms = frameMs(scale.ratio); t += ms; const r = scale.sample(ms); if (r) changes.push(r); }
  return changes;
}
test('a GPU-bound 30 fps laptop settles near the 50 fps budget and stays there', () => {
  const s = new RenderScale({ max: 1.5 });
  const changes = run(s, 60, r => Math.max(1000 / 60, 33 * (r / 1.5) ** 2));
  assert.ok(s.ratio < 1.3 && s.ratio >= s.min, `ratio ${s.ratio}`);
  assert.ok(changes.length <= 4, `settles: ${changes}`);
});
test('a CPU-bound frame keeps its resolution after one failed trial', () => {
  const s = new RenderScale({ max: 1.25 });
  run(s, 60, () => 33);
  assert.equal(s.ratio, 1.25);
});
test('a 60 fps machine never drops, and a recovered one climbs back', () => {
  const s = new RenderScale({ max: 1.5 });
  assert.deepEqual(run(s, 20, () => 1000 / 60), []);
  const slow = new RenderScale({ max: 1.5 });
  run(slow, 20, r => 30 * (r / 1.5) ** 2);
  const low = slow.ratio; assert.ok(low < 1.5);
  run(slow, 90, () => 1000 / 60); // the heavy scene is gone
  assert.equal(slow.ratio, 1.5, `from ${low}`);
});
test('hitches and hidden-tab gaps are not samples', () => {
  const s = new RenderScale({ max: 1.5 });
  for (let i = 0; i < 500; i++) assert.equal(s.sample(i % 2 ? 900 : 1000 / 60), null);
  assert.equal(s.ratio, 1.5);
});

test('fractional device ratios and every preset ceiling remain bounded through overload and recovery',()=>{
 for(const max of [.375,.6,.8,1.1,1.5,2]){
  const min=Math.min(max,Math.max(.5,max*.55)),s=new RenderScale({max,min});
  const changes=[...run(s,30,r=>Math.max(1000/60,40*(r/max)**2)),...run(s,90,()=>1000/60)];
  assert.ok(changes.every(r=>r>=min&&r<=max),`${max}: ${changes}`);
  assert.equal(s.ratio,max);
 }
});
