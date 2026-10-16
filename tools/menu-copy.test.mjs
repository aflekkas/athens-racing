import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTagline } from '../src/menu-copy.js';
import { MAPS } from '../src/map-catalog.js';

test('title names all enabled catalogue tracks, including the playable circuit', () => {
  assert.equal(mapTagline(MAPS), 'Drive Attica: Athens Riviera, Megara Circuit, Penteli Hill Climb, and Psychiko Garden Circuit.');
});
test('title follows catalogue names and order while excluding unavailable tracks', () => {
  assert.equal(mapTagline([{ id: 'penteli', name: 'NEW HILL' }, { id: 'unavailable', name: 'SECRET TRACK' }, { id: 'megara', name: 'NEW CIRCUIT' }]), 'Drive Attica: New Hill and New Circuit.');
  assert.equal(mapTagline([{ id: 'riviera', name: 'ATHENS RIVIERA' }]), 'Drive Attica: Athens Riviera.');
  assert.equal(mapTagline([]), 'Drive Attica.');
});
