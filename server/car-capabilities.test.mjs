import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCarCapabilities} from './car-capabilities.mjs';
import {CAR_MODELS} from '../src/car-catalog.js';
const source=readFileSync(new URL('../src/cars.js',import.meta.url),'utf8');
test('server accepts every garage trim, retaining legacy traffic/event IDs',()=>{
  const {cars,nitrousCars}=readCarCapabilities(source);
  assert.equal(cars.length,new Set(cars).size);
  for(const id of CAR_MODELS.flatMap(m=>m.trims))assert(cars.includes(id),id);
  for(const id of ['cle','gla','gla45','e36','mini','mini_jcw','police_octavia'])assert(cars.includes(id),id);
  assert(nitrousCars.every(id=>cars.includes(id)));
});
