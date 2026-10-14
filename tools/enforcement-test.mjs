// Tests for POLICE & LAWS enforcement (src/enforcement.js,
// src/enforcement-data.js, server/enforcement.mjs): directional camera
// triggers, speed threshold, cooldown, red-phase stop line, single fine per
// pass, off-toggle silence, no enforcement when absent, server claim
// validation (no faked/double penalties), mode reset.
//   node --test tools/enforcement-test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENF, cameraFires, CameraWatch, redViolation, FineLedger,
  resolveCapture, limitFor, modeEnforcement,
} from '../src/enforcement.js';
import { collectCameras, collectRedLightSites, VERIFIED_CAMERAS } from '../src/enforcement-data.js';
import { validateViolation, penaltyFor } from '../server/enforcement.mjs';

const cam = (over = {}) => ({ s: 1000, u: 0, dir: 1, limitKmh: 50, ...over });

// ---- camera trigger: direction + threshold --------------------------------

test('camera fires only in its enforced direction', () => {
  assert.equal(cameraFires(cam(), 1000, 1, 80), true);
  assert.equal(cameraFires(cam(), 1000, -1, 80), false);
  assert.equal(cameraFires(cam({ dir: 0 }), 1000, -1, 80), true);
  assert.equal(cameraFires(cam({ dir: undefined }), 1000, -1, 80), true);
});

test('camera threshold: limit + margin is silent, above fires', () => {
  assert.equal(cameraFires(cam(), 1000, 1, 50 + ENF.cameraMarginKmh), false);
  assert.equal(cameraFires(cam(), 1000, 1, 50 + ENF.cameraMarginKmh + 1), true);
  assert.equal(cameraFires(cam(), 1000, 1, 30), false);
});

// ---- single fine per pass + cooldown ---------------------------------------

test('one pass = one fine: held inside the window, no repeat across frames', () => {
  const w = new CameraWatch();
  const st = (s, now) => ({ s, dir: 1, kmh: 90, now });
  assert.equal(w.step(0, cam(), st(1000, 0)), 'fire');
  for (let f = 0; f < 30; f++) assert.equal(w.step(0, cam(), st(1000 + f * 0.3, 0.5)), 'held');
});

test('leaving and returning inside the cooldown stays silent; after it, fires again', () => {
  const w = new CameraWatch();
  const st = (s, now) => ({ s, dir: 1, kmh: 90, now });
  assert.equal(w.step(0, cam(), st(1000, 0)), 'fire');
  assert.equal(w.step(0, cam(), st(2000, 10)), 'absent'); // drove away
  assert.equal(w.step(0, cam(), st(1000, 30)), 'cooldown'); // back too soon
  assert.equal(w.step(0, cam(), st(2000, 40)), 'absent');
  assert.equal(w.step(0, cam(), st(1000, ENF.cameraCooldownSec + 41)), 'fire');
});

test('under the limit inside the window never fires', () => {
  const w = new CameraWatch();
  assert.equal(w.step(0, cam(), { s: 1000, dir: 1, kmh: 55, now: 0 }), 'under');
});

// ---- red lights: only when enforcement exists -------------------------------

const redJ = (over = {}) => ({ main: 'R', redT: 2, toGreen: 5, ...over });

test('red crossing counts with a camera or a witness, never without', () => {
  assert.equal(redViolation(redJ(), { camera: true, witnessed: false }), true);
  assert.equal(redViolation(redJ(), { camera: false, witnessed: true }), true);
  assert.equal(redViolation(redJ(), { camera: false, witnessed: false }), false);
  assert.equal(redViolation(redJ(), null), false);
  assert.equal(redViolation(redJ(), undefined), false);
});

test('amber/green and red grace periods are not violations', () => {
  assert.equal(redViolation({ main: 'G' }, { camera: true }), false);
  assert.equal(redViolation({ main: 'A' }, { camera: true }), false);
  assert.equal(redViolation(redJ({ redT: 0.1 }), { camera: true }), false);
  assert.equal(redViolation(redJ({ toGreen: 0.1 }), { camera: true }), false);
  assert.equal(redViolation(null, { camera: true }), false);
});

// ---- fines: game seconds, deduped, reset ------------------------------------

test('ledger dedupes multi-frame reports and resets per mode', () => {
  const L = new FineLedger();
  const a = L.add('camera', 'Poseidonos 50', 3, 'cam0', 10);
  const b = L.add('camera', 'Poseidonos 50', 3, 'cam0', 10.5);
  assert.equal(a, b);
  assert.equal(L.count, 1); assert.equal(L.totalSec, 3);
  L.add('red', 'Junction 12', 2, 'j12', 20);
  assert.equal(L.count, 2); assert.equal(L.totalSec, 5);
  L.reset();
  assert.equal(L.count, 0); assert.equal(L.totalSec, 0);
  assert.deepEqual(L.fines, []);
});

test('capture: time penalty + hold in races, DNF only in pursuit events', () => {
  assert.deepEqual(resolveCapture('sprint'), { dnf: false, penaltySec: ENF.capturePenaltySec, holdSec: ENF.captureHoldSec });
  assert.deepEqual(resolveCapture('timetrial'), { dnf: false, penaltySec: ENF.capturePenaltySec, holdSec: ENF.captureHoldSec });
  assert.deepEqual(resolveCapture(undefined), { dnf: false, penaltySec: ENF.capturePenaltySec, holdSec: ENF.captureHoldSec });
  const p = resolveCapture('pursuit');
  assert.equal(p.dnf, true);
});

// ---- modes interface (taxi/getaway agreement) --------------------------------

test('laws off: nothing enforces, nothing arms; laws defaults true with police', () => {
  assert.deepEqual(modeEnforcement({ mode: 'getaway', laws: false, police: true, pickup: true }), { enforce: false, wantedArmed: false });
  assert.deepEqual(modeEnforcement({ mode: 'sprint', laws: false, police: false }), { enforce: false, wantedArmed: false });
  assert.deepEqual(modeEnforcement({ mode: 'getaway', police: true, pickup: true }), { enforce: true, wantedArmed: true });
  assert.deepEqual(modeEnforcement({ mode: 'sprint', police: false }), { enforce: false, wantedArmed: false });
});

test('taxi never auto-wanted; getaway arms only after pickup with laws+police', () => {
  assert.deepEqual(modeEnforcement({ mode: 'taxi', laws: true, police: true, pickup: true }), { enforce: true, wantedArmed: false });
  assert.deepEqual(modeEnforcement({ mode: 'getaway', laws: true, police: true, pickup: false }), { enforce: true, wantedArmed: false });
  assert.deepEqual(modeEnforcement({ mode: 'getaway', laws: true, police: true, pickup: true }), { enforce: true, wantedArmed: true });
  assert.deepEqual(modeEnforcement({ mode: 'getaway', laws: true, police: false, pickup: true }), { enforce: false, wantedArmed: false });
});

// ---- data: honest empty catalogue --------------------------------------------

test('no verified cameras without evidence; empty map data enforces nothing', () => {
  assert.deepEqual(VERIFIED_CAMERAS, []);
  assert.deepEqual(collectCameras({ data: { speedCameras: [] } }), []);
  assert.deepEqual(collectCameras(null), []);
  assert.deepEqual(collectRedLightSites(null), []);
});

test('map-data cameras attach posted limits from the speed table with provenance', () => {
  const speeds = [{ s: 0, v: 50 }, { s: 900, v: 90 }];
  assert.equal(limitFor(speeds, 950), 90);
  const out = collectCameras({ data: { speedCameras: [{ s: 950, u: 1, dir: 1 }], route: { speeds } } }, { trustMapData: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].limitKmh, 90);
  assert.equal(out[0].source, 'map-data speedCameras');
});

test('watch reset clears cooldowns (mode reset)', () => {
  const w = new CameraWatch();
  w.step(0, cam(), { s: 1000, dir: 1, kmh: 90, now: 0 });
  w.reset();
  assert.equal(w.step(0, cam(), { s: 2000, dir: 1, kmh: 90, now: 1 }), 'absent');
  assert.equal(w.step(0, cam(), { s: 1000, dir: 1, kmh: 90, now: 2 }), 'fire');
});

// ---- server: no faked penalties, no double-apply ------------------------------

const srvCams = [{ s: 1000, dir: 1, limitKmh: 50 }];

test('server accepts a valid camera claim once; duplicates rejected', () => {
  const ctx = { cameras: srvCams, redSites: [], now: 60000 };
  const claim = { id: 'c1', kind: 'camera', s: 1005, kmh: 80, dir: 1, at: 59000 };
  assert.deepEqual(validateViolation(claim, ctx), { accept: true });
  assert.deepEqual(validateViolation(claim, ctx), { accept: false, reason: 'duplicate' });
});

test('server rejects claims with no camera, low speed, or stale age', () => {
  const ctx = { cameras: srvCams, redSites: [], now: 60000 };
  assert.deepEqual(validateViolation({ id: 'a', kind: 'camera', s: 5000, kmh: 120, dir: 1 }, ctx).accept, false);
  assert.deepEqual(validateViolation({ id: 'b', kind: 'camera', s: 1002, kmh: 55, dir: 1 }, ctx), { accept: false, reason: 'speed' });
  assert.deepEqual(validateViolation({ id: 'c', kind: 'camera', s: 1002, kmh: 90, dir: -1 }, ctx), { accept: false, reason: 'no-camera' });
  assert.deepEqual(validateViolation({ id: 'd', kind: 'camera', s: 1002, kmh: 90, dir: 1, at: 1 }, ctx), { accept: false, reason: 'stale' });
  assert.deepEqual(validateViolation({ id: 'e', kind: 'ufo', s: 1002 }, ctx), { accept: false, reason: 'kind' });
  assert.deepEqual(validateViolation({ kind: 'camera', s: 1002, kmh: 90 }, ctx), { accept: false, reason: 'id' });
});

test('server claim carries no victim: separate players need separate claims', () => {
  // Two connections, same claim id: each validates against its OWN seen set,
  // and the hook contract applies the penalty to the sender only — there is
  // no victim field to fake. A guest replaying another driver's id still only
  // penalises itself, once.
  const a = { cameras: srvCams, redSites: [], now: 60000 };
  const b = { cameras: srvCams, redSites: [], now: 60000 };
  const claim = { id: 'shared', kind: 'camera', s: 1001, kmh: 90, dir: 1 };
  assert.equal(validateViolation(claim, a).accept, true);
  assert.equal(validateViolation(claim, b).accept, true);
  assert.equal(validateViolation(claim, a).accept, false);
  assert.ok(!('victim' in claim) && !('playerId' in claim));
});

test('server red claims need an enforced site; penalties follow event rules', () => {
  const ctx = { cameras: [], redSites: [{ s: 2000 }], now: 60000 };
  assert.deepEqual(validateViolation({ id: 'r1', kind: 'red', s: 2010 }, ctx), { accept: true });
  assert.deepEqual(validateViolation({ id: 'r2', kind: 'red', s: 8000 }, ctx), { accept: false, reason: 'no-site' });
  assert.equal(penaltyFor('red', {}), 2);
  assert.equal(penaltyFor('red', { penalty: 5 }), 5);
  assert.equal(penaltyFor('camera', {}), 3);
  assert.equal(penaltyFor('camera', { cameraPenalty: 4 }), 4);
});
