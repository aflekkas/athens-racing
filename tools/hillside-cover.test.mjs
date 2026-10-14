import test from 'node:test';
import assert from 'node:assert/strict';
import { hillsideCoverProfile, hillsideClusterSelected } from '../src/hillside-cover-policy.js';

test('quality mask preserves clusters, disables LOW, and reduces MEDIUM to roughly 35%', () => {
  let med=0,high=0;
  for(let x=-100;x<100;x++)for(let z=-100;z<100;z++){
    assert.equal(hillsideClusterSelected(x,z,hillsideCoverProfile('low').density),false);
    const m=hillsideClusterSelected(x,z,hillsideCoverProfile('med').density);
    const h=hillsideClusterSelected(x,z,hillsideCoverProfile('high').density);
    assert.ok(!m||h); med+=m;high+=h;
    assert.equal(m,hillsideClusterSelected(x,z,hillsideCoverProfile('medium').density));
  }
  assert.equal(high,40000);assert.ok(med/high>.34&&med/high<.36);
});
test('default draw settings keep cover within 350m and bounded spatial chunks', () => {
  for(const [quality,drawDistance] of [['med',1000],['high',2000]]){
    const p=hillsideCoverProfile(quality),distance=p.far*(drawDistance/2000)**.75;
    assert.ok(distance>=250&&distance<=350);assert.ok(p.cell<=400);
  }
  assert.equal(hillsideCoverProfile('ultra'),hillsideCoverProfile('high'));
  assert.equal(hillsideCoverProfile('unknown'),hillsideCoverProfile('med'));
});
