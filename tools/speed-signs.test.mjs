import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLimit, defaultLimit, limitForWay, buildRouteSpeeds,
  parseSignTags, resolveSignDir, matchSigns, inferSigns, mergeSigns,
} from './speed-signs.mjs';
import { routeLimitAt, speedLimitAt } from '../src/speed-limit.js';

test('parseLimit reads plain km/h and rejects the rest', () => {
  assert.equal(parseLimit('50'), 50);
  assert.equal(parseLimit(' 70 '), 70);
  assert.equal(parseLimit('implicit'), null);
  assert.equal(parseLimit('none'), null);
  assert.equal(parseLimit('walk'), null);
  assert.equal(parseLimit(undefined), null);
  assert.equal(parseLimit('200'), null);
});

test('Greek defaults: 50 urban, 90 rural, 110 expressway', () => {
  assert.equal(defaultLimit({ urban: 1 }), 50);
  assert.equal(defaultLimit({ urban: 0 }), 90);
  assert.equal(defaultLimit({ urban: 1, highway: 'trunk' }), 110);
  assert.equal(defaultLimit({ urban: 0, highway: 'motorway' }), 110);
  assert.equal(defaultLimit({ urban: 0, highway: 'secondary' }), 90);
});

test('limitForWay prefers the tag and marks provenance', () => {
  assert.deepEqual(limitForWay({ maxspeed: '60', highway: 'primary' }, 1), { v: 60, src: 'osm' });
  assert.deepEqual(limitForWay({ highway: 'residential' }, 1), { v: 50, src: 'inferred' });
  assert.deepEqual(limitForWay({ highway: 'tertiary' }, 0), { v: 90, src: 'inferred' });
});

test('buildRouteSpeeds fills defaults and smooths junction flicker', () => {
  const stations = [];
  for (let s = 0; s <= 400; s += 10) {
    let tag = null;
    if (s >= 100 && s < 220) tag = '50'; // tagged stretch
    if (s >= 150 && s < 170) tag = '30'; // 20 m junction way: flicker
    stations.push({ s, tag, urban: 0, highway: 'secondary' });
  }
  const speeds = buildRouteSpeeds(stations);
  assert.deepEqual(speeds, [
    { s: 0, v: 90, src: 'inferred' },
    { s: 100, v: 50, src: 'osm' },
    { s: 220, v: 90, src: 'inferred' },
  ]);
});

test('parseSignTags decodes OSM sign variants', () => {
  assert.deepEqual(parseSignTags({ traffic_sign: 'maxspeed', maxspeed: '50' }), { v: 50, facing: null });
  assert.deepEqual(
    parseSignTags({ traffic_sign: 'maxspeed;GR:Ρ-40', maxspeed: '60', side: 'right', source: 'sign' }),
    { v: 60, facing: null });
  assert.deepEqual(
    parseSignTags({ traffic_sign: 'maxspeed', maxspeed: '50', 'traffic_sign:direction': 'backward' }),
    { v: 50, facing: 'backward' });
  assert.deepEqual(parseSignTags({ highway: 'speed_camera' }), { camera: true });
  assert.equal(parseSignTags({ traffic_sign: 'maxspeed', maxspeed: 'implicit' }), null);
  assert.equal(parseSignTags({ traffic_sign: 'GR:Κ-28α' }), null);
  assert.equal(parseSignTags({ traffic_sign: 'variable_message' }), null);
});

test('resolveSignDir: facing angle beats side, sides serve their direction', () => {
  // route heading east: tangent (1, 0). Sign facing west (270°): serves +s traffic.
  assert.deepEqual(resolveSignDir({ tags: { direction: '270' }, u: 5, tx: 1, tz: 0 }), [1]);
  // facing east (90°): serves -s traffic even though it stands on the +u side.
  assert.deepEqual(resolveSignDir({ tags: { direction: '90' }, u: 5, tx: 1, tz: 0 }), [-1]);
  // no facing info: right-hand traffic, right side serves +s.
  assert.deepEqual(resolveSignDir({ tags: {}, u: 6, tx: 1, tz: 0 }), [1]);
  assert.deepEqual(resolveSignDir({ tags: {}, u: -6, tx: 1, tz: 0 }), [-1]);
  // way-relative tags map through the parent way direction.
  assert.deepEqual(resolveSignDir({ tags: { 'traffic_sign:direction': 'forward' }, u: 0, tx: 1, tz: 0, wayDir: -1 }), [-1]);
  assert.deepEqual(resolveSignDir({ tags: { 'traffic_sign:direction': 'both' }, u: 0, tx: 1, tz: 0 }), [1, -1]);
});

test('matchSigns keeps corridor nodes and drops the rest', () => {
  const nodes = [
    { id: 1, x: 100, z: 6, tags: { traffic_sign: 'maxspeed', maxspeed: '50' } },
    { id: 2, x: 5000, z: 6, tags: { traffic_sign: 'maxspeed', maxspeed: '50' } },
    { id: 3, x: 200, z: -40, tags: { highway: 'speed_camera' } },
  ];
  const project = (x, z) => (Math.abs(x - 100) < 500 && Math.abs(z) < 50 ? { s: x, u: z, d: 5 } : null);
  const { signs, cameras } = matchSigns(nodes, {
    project, tangentAt: () => ({ tx: 1, tz: 0 }), wayDirAt: () => 0, maxS: 1000,
  });
  assert.equal(signs.length, 1);
  assert.deepEqual(signs[0], { s: 100, u: 6, v: 50, dir: 1, src: 'osm' });
  assert.equal(cameras.length, 1);
});

test('inferSigns places both directions roadside; merge prefers mapped nodes', () => {
  const speeds = [{ s: 0, v: 90, src: 'inferred' }, { s: 200, v: 90, src: 'osm' }, { s: 500, v: 50, src: 'osm' }];
  const inferred = inferSigns(speeds, { edgeAt: () => 7 });
  assert.deepEqual(inferred, [
    { s: 500, u: 9.2, v: 50, dir: 1, src: 'inferred' },
    { s: 500, u: -9.2, v: 50, dir: -1, src: 'inferred' },
  ]);
  assert.deepEqual(inferSigns(speeds, { edgeAt: () => 7, closed: true }), []);
  const merged = mergeSigns([{ s: 520, u: 8, v: 50, dir: 1, src: 'osm' }], inferred);
  assert.deepEqual(merged.map((s) => s.src + s.dir), ['inferred-1', 'osm1']);
});

test('routeLimitAt follows the stepwise table', () => {
  const speeds = [{ s: 0, v: 50, src: 'inferred' }, { s: 500, v: 30, src: 'osm' }];
  assert.deepEqual(routeLimitAt(speeds, 0), { v: 50, src: 'inferred' });
  assert.deepEqual(routeLimitAt(speeds, 700), { v: 30, src: 'osm' });
  assert.equal(routeLimitAt([], 10), null);
});

test('speedLimitAt prefers the route, then the side-road network', () => {
  const route = {
    closed: false, length: 1000,
    project: (x, z) => ({ s: x, u: z }),
    edge: () => 7, wrap: (s) => s,
  };
  const data = {
    route: { speeds: [{ s: 0, v: 50, src: 'osm' }] },
    roadNetwork: { roads: [{ id: 9, h: 'residential', w: 6, p: [500, 200, 600, 200], v: 30, vs: 'osm' }] },
  };
  const map = { data, route };
  assert.deepEqual(speedLimitAt(map, 100, 2, 100), { v: 50, src: 'osm' });
  assert.deepEqual(speedLimitAt(map, 550, 200, 100), { v: 30, src: 'osm' });
  assert.equal(speedLimitAt(map, 5000, 5000, 100), null);
  assert.equal(speedLimitAt(null, 0, 0), null);
});
