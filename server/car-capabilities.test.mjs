import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCarCapabilities} from './car-capabilities.mjs';
import {CAR_MODELS} from '../src/car-catalog.js';
import {LEGACY_CAR_IDS} from '../src/car-ids.js';
const source=readFileSync(new URL('../src/cars.js',import.meta.url),'utf8');
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): one car per model, its top trim. The server serves those cars and no others.
test('server accepts exactly the kept car of every model and none of the removed trims',()=>{
  const {cars,nitrousCars,specs}=readCarCapabilities(source);
  assert.equal(cars.length,new Set(cars).size);
  assert.deepEqual([...cars].sort(),CAR_MODELS.map(m=>m.car).sort());
  for(const id of Object.keys(LEGACY_CAR_IDS))assert(!cars.includes(id),id+' is a removed trim');
  assert.deepEqual(nitrousCars,['ibiza_cupra'],'the SEAT nitrous bottle rides in the kept Ibiza');
  for(const id of cars)assert(specs[id].power>0&&specs[id].mass>0,id);
});
