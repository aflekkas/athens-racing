import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Driver, shiftGateOffset, cockpitShiftHardware, selectShiftKind, shiftAnimDuration, shiftEnvelope, smootherstep } from '../src/driver.js';

test('H-pattern gates: lateral pairs with forward odd gears and a far-right reverse', () => {
  const g6 = (gear) => shiftGateOffset(gear, 6);
  assert.deepEqual(g6(1), { x: -0.022, z: -0.026 });
  assert.deepEqual(g6(2), { x: -0.022, z: 0.026 });
  assert.deepEqual(g6(3), { x: 0, z: -0.026 });
  assert.deepEqual(g6(4), { x: 0, z: 0.026 });
  assert.deepEqual(g6(5), { x: 0.022, z: -0.026 });
  assert.deepEqual(g6(6), { x: 0.022, z: 0.026 });
  assert.deepEqual(g6('R'), { x: 0.034, z: 0.026 });
  // E36 five-speed: fifth sits in the right gate, reverse beside it.
  assert.deepEqual(shiftGateOffset(5, 5), { x: 0.022, z: -0.026 });
  assert.deepEqual(shiftGateOffset('R', 5), { x: 0.022, z: 0.026 });
  // 911 seven-speed: seventh reaches the far-right gate.
  assert.deepEqual(shiftGateOffset(7, 7), { x: 0.034, z: -0.026 });
  assert.deepEqual(shiftGateOffset('R', 7), { x: 0.034, z: 0.026 });
  // Out-of-range gears clamp instead of throwing.
  assert.deepEqual(shiftGateOffset(99, 6), { x: 0.022, z: 0.026 });
  const out = {};
  assert.equal(shiftGateOffset(3, 6, out), out);
});

test('cockpit hardware: E36 stick, CLE paddles, 911 both, explicit gearbox fields win', () => {
  assert.deepEqual(cockpitShiftHardware({ id: 'e36' }), { stick: true, paddles: false });
  assert.deepEqual(cockpitShiftHardware({ id: 'gtv' }), { stick: true, paddles: false });
  assert.deepEqual(cockpitShiftHardware({ id: 'cle' }), { stick: false, paddles: true });
  assert.deepEqual(cockpitShiftHardware({ id: 'carrera' }), { stick: true, paddles: true });
  assert.deepEqual(cockpitShiftHardware({ id: 'cle', transmission: 'manual' }), { stick: true, paddles: false });
  assert.deepEqual(cockpitShiftHardware({ id: 'e36', gearboxType: 'DCT' }), { stick: false, paddles: true });
  assert.deepEqual(cockpitShiftHardware({}), { stick: false, paddles: true });
});

test('shift kind: lever for sticks, paddle flicks for DCT, silence in D', () => {
  assert.equal(selectShiftKind({ manual: true, stick: true, paddles: false, direction: 1 }), 'lever');
  assert.equal(selectShiftKind({ manual: true, stick: false, paddles: true, direction: -1 }), 'paddle');
  assert.equal(selectShiftKind({ manual: true, stick: true, paddles: true, direction: 1 }), 'lever');
  assert.equal(selectShiftKind({ manual: false, stick: true, paddles: false, direction: 1 }), 'none');
  assert.equal(selectShiftKind({ manual: false, stick: false, paddles: true, direction: 1 }), 'none');
  assert.equal(selectShiftKind({ manual: false, stick: false, paddles: true, autoOverride: 3, direction: 1 }), 'paddle');
  assert.equal(selectShiftKind({ manual: false, stick: true, paddles: false, autoOverride: 3, direction: 1 }), 'none');
  assert.equal(selectShiftKind({ manual: true, stick: true, paddles: false, direction: 0 }), 'none');
  assert.equal(selectShiftKind({ manual: false, stick: true, paddles: true, shiftType: 'manual', direction: 1 }), 'lever');
  assert.equal(selectShiftKind({ manual: true, stick: false, paddles: true, shiftType: 'dct', direction: -1 }), 'paddle');
});

test('shift timing follows the gearbox inside a readable window', () => {
  assert.ok(shiftAnimDuration('lever', 0.35) >= 0.30 && shiftAnimDuration('lever', 0.35) <= 0.45);
  assert.ok(shiftAnimDuration('lever', 0.10) >= 0.30 && shiftAnimDuration('lever', 2) <= 0.45);
  assert.ok(shiftAnimDuration('paddle', 0.16) >= 0.12 && shiftAnimDuration('paddle', 0.16) <= 0.25);
  assert.equal(shiftAnimDuration('none', 0.3), 0);
  assert.equal(shiftEnvelope(0), 0);
  assert.equal(shiftEnvelope(1), 0);
  assert.equal(shiftEnvelope(0.5), 1);
  assert.ok(shiftEnvelope(0.1) < shiftEnvelope(0.2) && shiftEnvelope(0.2) < shiftEnvelope(0.3));
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
});

function fakeWheel(controls) {
  return { pos: new THREE.Vector3(0, -0.135, -0.53), angle: 0, euler: new THREE.Euler(-0.36, 0, 0), r: 0.18, controls };
}
function baseControls(over = {}) {
  return { manual: true, gear: 1, held: false, shifter: new THREE.Vector3(-0.04, 0.9, -0.2), handbrake: new THREE.Vector3(0.09, 0.8, 0.1), ...over };
}
const step = (driver, wheel, n) => { for (let i = 0; i < n; i++) driver.update(1 / 60, i / 60, 0, { x: 0, y: 0, z: 0 }, wheel, 0, 0); };

test('legacy wheels keep the short manual reach without the serialised channels', () => {
  const driver = new Driver();
  try {
    const controls = baseControls();
    const wheel = fakeWheel(controls);
    step(driver, wheel, 10);
    assert.equal(driver.shiftSmooth, 0);
    controls.gear = 2;
    step(driver, wheel, 15);
    assert.ok(driver.shiftSmooth > 0.2, `reach rises, got ${driver.shiftSmooth}`);
    step(driver, wheel, 90);
    assert.ok(driver.shiftSmooth < 0.05, `reach settles, got ${driver.shiftSmooth}`);
  } finally { driver.dispose(); }
});

test('authored envelope walks the hand to the lever and back', () => {
  const driver = new Driver();
  try {
    const shifter = new THREE.Vector3(-0.04, 0.75, -0.35);
    const controls = baseControls({ shiftSerial: 7, shiftBlend: 0, paddleL: 0, paddleR: 0, paddleLT: new THREE.Vector3(), paddleRT: new THREE.Vector3(), shifter });
    const wheel = fakeWheel(controls);
    step(driver, wheel, 30);
    const rest = driver.arms[1].hand.position.clone();
    controls.shiftBlend = 1;
    step(driver, wheel, 40);
    assert.ok(driver.shiftSmooth > 0.9, `hand commits, got ${driver.shiftSmooth}`);
    const atLever = driver.arms[1].hand.position.clone();
    assert.ok(atLever.distanceTo(rest) > 0.05, 'hand leaves the wheel');
    assert.ok(atLever.distanceTo(shifter) < 0.02, 'hand meets the lever');
    controls.shiftBlend = 0;
    step(driver, wheel, 90);
    assert.ok(driver.arms[1].hand.position.distanceTo(rest) < 0.02, 'hand returns to the wheel');
  } finally { driver.dispose(); }
});

test('paddle flicks tug the shifting-side hand only', () => {
  const driver = new Driver();
  try {
    const controls = baseControls({ shiftSerial: 9, shiftBlend: 0, paddleL: 0, paddleR: 1, paddleLT: new THREE.Vector3(-0.2, -0.1, -0.5), paddleRT: new THREE.Vector3(0.2, -0.1, -0.5) });
    const wheel = fakeWheel(controls);
    const left0 = driver.arms[0].hand.position.clone(), right0 = driver.arms[1].hand.position.clone();
    step(driver, wheel, 30);
    assert.ok(driver.paddleSmoothR > 0.5 && driver.paddleSmoothL < 0.05);
    assert.ok(driver.arms[1].hand.position.distanceTo(right0) > 0.005, 'right hand answers the upshift paddle');
    assert.ok(driver.arms[0].hand.position.distanceTo(left0) < 0.005, 'left hand stays put');
  } finally { driver.dispose(); }
});
