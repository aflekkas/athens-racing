import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, sampleGhost, encodeGhost, decodeGhost, GhostStore, GHOST_STRIDE, slerp, ghostOpacity } from '../src/ghost-lap.js';
const meta = { eventId: 'tt-test', car: 'z4', time: 2, splits: [1, 2], routeKey: '0>10000', trackVersion: 'test' };
test('ghost fades smoothly through proximity, hides at overlap and stays translucent at distance', () => {
  assert.equal(ghostOpacity(0), 0); assert.equal(ghostOpacity(2), 0);
  assert.equal(ghostOpacity(10), .28); assert.equal(ghostOpacity(100), .28);
  let previous = 0;
  for (let distance = 2; distance <= 10; distance += .1) {
    const opacity = ghostOpacity(distance);
    assert.ok(opacity >= previous && opacity < 1); previous = opacity;
  }
  assert.ok(ghostOpacity(4) < .05); assert.ok(ghostOpacity(8) > .2);
});
const state = t => ({ position: [t * 27.317 + .0049, Math.sin(t) * .02 + 2, 10000 - t * 31.751], quaternion: [0, Math.sin(t * .3 / 2), 0, Math.cos(t * .3 / 2)],
  speed: 41.003, steer: .12934, spin: -t * 330.17, s: t * 42.153, brake: t > 1, pitch: .01345, roll: -.05432, heave: -.12345, damage: { front: .413, rear: 0, left: .6, right: 1 } });
function record(seconds = 2, dt = 1 / 60, n = 1) {
  const r = new Recorder(Array.from({ length: n }, (_, i) => ({ car: 'z4', name: `CAR ${i}` })), meta);
  r.tick(0, Array.from({ length: n }, () => state(0)));
  for (let k = 1; k <= Math.round(seconds / dt); k++) r.tick(dt, Array.from({ length: n }, () => state(k * dt)));
  return r.finish({ time: seconds, splits: [seconds] });
}
test('quantisation and interpolated playback stay under 5 cm / 0.5 degrees on a 10 km coordinate span', () => {
  const lap = record(10);
  let maxPosition = 0, maxHeading = 0;
  for (let k = 0; k <= 2000; k++) {
    const t = k / 200, actual = sampleGhost(lap, t), expected = state(t);
    maxPosition = Math.max(maxPosition, Math.hypot(...actual.position.map((v, i) => v - expected.position[i])));
    const dot = Math.abs(actual.quaternion.reduce((v, x, i) => v + x * expected.quaternion[i], 0));
    maxHeading = Math.max(maxHeading, 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI);
    assert.ok(Math.abs(actual.spin - expected.spin) < .002, 'unwrapped wheel spin cannot alias at 330 rad/s');
    assert.ok(Math.abs(actual.damage.front - expected.damage.front) < 1 / 255);
    assert.ok(Math.abs(actual.speed - expected.speed) < .006);
  }
  assert.ok(maxPosition < .05, `${maxPosition} m`); assert.ok(maxHeading < .5, `${maxHeading} degrees`);
});
test('fixed sample grid is independent of bounded step subdivision and clamps scrubbing', () => {
  const a = record(2, 1 / 60), b = record(2, 1 / 120);
  assert.deepEqual(a.data, record(2, 1 / 60).data, 'identical fixed-step input is byte deterministic');
  assert.equal(a.frames, 41); assert.equal(b.frames, 41);
  for (let i = 0; i < a.frames; i++) {
    const x = sampleGhost(a, i / 20), y = sampleGhost(b, i / 20);
    assert.deepEqual(x.position, y.position); assert.deepEqual(x.quaternion, y.quaternion); assert.ok(Math.abs(x.spin - y.spin) < .0011);
  }
  assert.deepEqual(sampleGhost(a, -20), sampleGhost(a, 0)); assert.deepEqual(sampleGhost(a, 500), sampleGhost(a, 2));
  assert.equal(sampleGhost(a, 0, 4), null);
});
test('quaternion interpolation follows the short arc including sign flips and wraparound', () => {
  const angle = d => [0, Math.sin(d * Math.PI / 360), 0, Math.cos(d * Math.PI / 360)];
  const midpoint = slerp(angle(179), angle(-179), .5);
  assert.ok(Math.abs(midpoint[1]) > .99999); assert.ok(Math.abs(midpoint[3]) < .00001);
  assert.deepEqual(slerp([0, 0, 0, 1], [0, 0, 0, -1], .5), [0, 0, 0, 1]);
});
test('six-minute 10 km run with nine grid cars remains below 3 MB binary / 4 MB interchange', () => {
  const r = record(360, .05, 9);
  assert.equal(r.frames, 7201); assert.equal(r.data.byteLength, 7201 * 9 * GHOST_STRIDE);
  assert.ok(r.data.byteLength < 3 * 1024 * 1024); assert.ok(encodeGhost(r).length < 4 * 1024 * 1024);
  assert.deepEqual(decodeGhost(encodeGhost(r)).data, r.data);
});
test('recorder stops at its bound and marks truncation', () => {
  const r = new Recorder([{ car: 'z4' }], meta, { maxSeconds: 1 }); r.tick(0, [state(0)]); r.tick(2, [state(2)]);
  assert.equal(r.finish().frames, 21); assert.equal(r.finish().truncated, true);
});
const memoryStorage = () => {
  const data = new Map(); return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};
test('localStorage fallback survives a fresh store, keeps the fastest event/car and lists saved ghosts', async () => {
  const storage = memoryStorage(), r = record(), store = new GhostStore({ indexedDB: null, storage });
  assert.deepEqual((await store.saveBest(r)).persistent, true);
  const fresh = new GhostStore({ indexedDB: null, storage }), loaded = await fresh.load(meta.eventId, meta.car);
  assert.deepEqual(loaded.data, r.data); assert.deepEqual(sampleGhost(loaded, .777), sampleGhost(r, .777));
  assert.equal((await fresh.saveBest({ ...r, time: 3 })).saved, false);
  assert.equal((await fresh.saveBest({ ...r, time: 1 })).saved, true);
  assert.equal((await new GhostStore({ indexedDB: null, storage }).all())[0].time, 1);
  assert.equal(await fresh.load(meta.eventId, 'mini'), null);
});
test('fallback refuses oversize payloads and quota failures while retaining an exportable in-memory ghost', async () => {
  const r = record(), small = new GhostStore({ indexedDB: null, storage: memoryStorage(), fallbackLimit: 10 });
  const result = await small.saveBest(r); assert.equal(result.persistent, false); assert.equal(await small.load(meta.eventId, meta.car), r);
  const quota = new GhostStore({ indexedDB: null, storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
  assert.equal((await quota.saveBest(r)).persistent, false);
});
test('interchange rejects bad version, impossible counts, malformed time/bytes and strips untrusted metadata', () => {
  const valid = JSON.parse(encodeGhost(record()));
  for (const patch of [{ version: 2 }, { frames: 1e9 }, { frames: 0 }, { hz: 30 }, { data: '!!!' }, { data: 'AAAA' }, { time: -1 }, { splits: [null] }, { duration: 4 }, { tracks: [] }]) {
    assert.throws(() => decodeGhost(JSON.stringify({ ...valid, ...patch })));
  }
  assert.equal(decodeGhost(JSON.stringify({ ...valid, valid: true, html: '<script>' })).html, undefined);
});

test('promoted fleet cars retain their ids through ghost lap recording', () => {
  for (const car of ['golf', 'corolla', 'superb', 'police_octavia']) {
    const recorder = new Recorder([{ car }], { ...meta, car });
    recorder.tick(0, [state(0)]); recorder.tick(.1, [state(.1)]);
    const lap = decodeGhost(encodeGhost(recorder.finish({ time: .1 })));
    assert.equal(lap.car, car);
    assert.ok(sampleGhost(lap, .05));
  }
});
