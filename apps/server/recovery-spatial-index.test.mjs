import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldTileRoads } from '../../src/world-tile-roads.js';
import { accelerateRecoveryWorld } from './recovery-spatial-index.mjs';

function world() {
  const tiles = new Map();
  for (const [key, origin] of [['left', [-512, 0, 0]], ['right', [0, 0, 0]]]) {
    const buildings = [], buildingCorners = [], buildingHeights = [];
    for (let row = 0; row < 9; row++) for (let column = 0; column < 9; column++) {
      const x = column * 48 + 12, z = row * 48 + 12, start = buildingCorners.length / 2;
      buildingCorners.push(x, z, x + 14, z, x + 14, z + 18, x, z + 18);
      buildings.push(0, start, 4, 0); buildingHeights.push((row % 3) * 2, 10);
    }
    tiles.set(key, { state: 'active', packet: { metadata: { origin }, tables: { buildings: new Uint32Array(buildings), buildingCorners: new Float32Array(buildingCorners), buildingHeights: new Float32Array(buildingHeights) } } });
  }
  const stream = { tiles, contact(x, z) { assert.equal(this.tiles.size, 2, 'contact queries retain the complete world'); return Math.abs(z - 200) < 1 ? null : { y: 0, layer: 0, surfaceId: 'road' }; } };
  const roads = new WorldTileRoads(stream);
  roads.graph.edges.set('edge', { value: { id: 'edge', from: 'a', to: 'b', surface: 'road', layer: 0, flags: 1, points: [[0, 0, 0], [0, 0, 500]] } });
  roads.graph.edges.set('joined', { value: { id: 'joined', from: 'b', to: 'c', surface: 'joined-road', layer: 0, flags: 1, points: [[0, 0, 500], [0, 0, 600]] } });
  return { roads, stream };
}

test('conservative building broad phase matches the original predicate across 2400 poses/profiles', () => {
  const original = world(), accelerated = world(); accelerateRecoveryWorld(accelerated);
  const profiles = [{}, { halfWidth: .5, halfLength: 1.2, clearance: 0 }, { halfWidth: 1.3, halfLength: 6, connected: true }, { halfWidth: 2, halfLength: 8, clearance: .4, connected: true }];
  let seed = 93821;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 600; i++) {
    const point = { edge: 'edge', x: -512 + random() * 960, y: [0, 3, 15][i % 3], z: random() * 450, yaw: random() * Math.PI * 2, surfaceId: 'road' };
    for (const options of profiles) assert.equal(accelerated.roads.safe(point, options), original.roads.safe(point, options), JSON.stringify({ point, options }));
  }
});

test('clearance, bin boundaries and negative coordinates preserve original outcomes', () => {
  const original = world(), accelerated = world(); accelerateRecoveryWorld(accelerated);
  for (const x of [-512 - .15, -500 - 1.15, -500, -486, -486 + 1.15, -32, -.15, 0, 32, 12 - 1.15]) for (const yaw of [0, Math.PI / 2, Math.PI / 4]) {
    const point = { edge: 'edge', x, z: 20, y: 0, yaw, surfaceId: 'road' };
    assert.equal(accelerated.roads.safe(point, { halfWidth: 1, halfLength: 2.5 }), original.roads.safe(point, { halfWidth: 1, halfLength: 2.5 }));
  }
});

test('connected memo returns independent maps and invalidates on graph revisions', () => {
  const value = world(); let calls = 0;
  const connected = value.roads.connected;
  value.roads.connected = function (...args) { calls++; return connected.apply(this, args); };
  accelerateRecoveryWorld(value);
  const edge = value.roads.graph.edges.get('edge').value;
  const a = value.roads.connected(edge); a.set('injected', 99);
  assert.equal(value.roads.connected(edge).has('injected'), false); assert.equal(calls, 1);
  value.roads.graph.revision++;
  value.roads.connected(edge); assert.equal(calls, 2);
});

test('accelerator is idempotent and falls back for unbounded query options', () => {
  const original = world(), accelerated = world(); accelerateRecoveryWorld(accelerated);
  const first = accelerated.roads.safe; assert.equal(accelerateRecoveryWorld(accelerated), accelerated); assert.equal(first, accelerated.roads.safe);
  const point = { edge: 'edge', x: 40, z: 40, y: 0, yaw: 0 };
  assert.equal(accelerated.roads.safe(point, { halfWidth: 10000, halfLength: 10000 }), original.roads.safe(point, { halfWidth: 10000, halfLength: 10000 }));
});
