import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_DEFAULTS, externalEngineWeights } from '../src/audio.js';
import { DEFAULTS } from '../src/settings.js';

test('audio graph and stored preferences use the same comfortable defaults', () => {
  assert.equal(AUDIO_DEFAULTS.master, 0.6);
  assert.equal(AUDIO_DEFAULTS.tyres, 0.28);
  for (const [key, value] of Object.entries(AUDIO_DEFAULTS)) assert.equal(DEFAULTS[key], value);
});

test('six nearest external engines share one budget across pools, independent of input order', () => {
  const rivals = Array.from({ length: 8 }, (_, id) => ({ id, d: 5 + id * 10 }));
  const traffic = Array.from({ length: 8 }, (_, id) => ({ id, d: 10 + id * 10 }));
  const budget = externalEngineWeights([...rivals].reverse(), [...traffic].reverse());
  assert.equal([...budget.rivals.values(), ...budget.traffic.values()].filter(v => v === 1).length, 6);
  for (const kind of ['rivals', 'traffic']) {
    assert.equal(budget[kind].get(0), 1, 'nearest voices stay clear');
    assert.equal(budget[kind].get(7), 0.18, 'distant voices remain subordinate');
  }
  assert.deepEqual(rivals.map(r => r.d), [5, 15, 25, 35, 45, 55, 65, 75], 'telemetry is not reordered');
});

test('external budget handles absent lists, legacy distance and invalid telemetry', () => {
  const budget = externalEngineWeights([{ id: 'near', dist: 2 }, { id: 'far', d: 500 }, { id: 'invalid', d: NaN }]);
  assert.deepEqual([...budget.rivals], [['near', 1]]);
  assert.equal(budget.traffic.size, 0);
  assert.equal(externalEngineWeights().rivals.size, 0);
});

import { AudioCadence } from '../src/audio-cadence.js';
test('ambient scheduling is bounded at 30 Hz, preserves elapsed dt and reacts immediately to mute',()=>{
 const cadence=new AudioCadence();let updates=0,seconds=0;
 for(let i=0;i<121;i++)if(cadence.sample(i/120,1/120)){updates++;seconds+=cadence.dt;}
 assert.equal(updates,31);assert.ok(Math.abs(seconds-121/120)<1e-12);
 assert.equal(cadence.sample(1.001,.001,true),true);assert.equal(cadence.dt,.001);
 assert.equal(cadence.sample(0,.01),true,'audio context clock restart');
});
