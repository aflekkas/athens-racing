import {test} from 'node:test';
import assert from 'node:assert/strict';
import {infillStreetIndex} from '../src/infill-streets.js';
const road = (h, p = [0, 0, 200, 0], w = 6) => ({h, p, w});
const index = roads => infillStreetIndex({roadNetwork:{roads}});
test('paths, tracks and untyped legacy roads exclude footprints but do not grant house access', () => {
  for (const h of ['footway', 'path', 'track', 'cycleway', 'steps', 'pedestrian', undefined]) {
    const nearest = index([road(h)]);
    assert.equal(nearest(80, 20, 45, true), null);
    assert.ok(nearest(80, 1, 3), h);
  }
});
test('houses require a mapped drivable street within 45 metres of its centreline', () => {
  for (const h of ['residential', 'service', 'unclassified', 'living_street', 'tertiary', 'secondary', 'primary']) {
    const nearest = index([road(h)]);
    assert.equal(nearest(80, 44.9, 45, true).d, 44.9);
    assert.equal(nearest(80, 45.1, 45, true), null);
  }
});
test('orientation comes from the closest drivable street, even when a path is closer', () => {
  const nearest = index([road('path', [0, 0, 200, 0]), road('residential', [100, -100, 100, 100])]);
  const hit = nearest(75, 1, 45, true);
  assert.equal(hit.d, 25);
  assert.deepEqual(hit.sg.slice(0,4), [100,-100,100,100]);
});
test('street access lookup crosses hash cells and includes the last segment endpoint', () => {
  const nearest = index([road('service', [79, 79, 79, 98])]);
  assert.equal(nearest(121, 98, 45, true).d, 42);
  assert.equal(nearest(125, 98, 45, true), null);
});
