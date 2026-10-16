import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftGateOffset, cockpitShiftHardware, selectShiftKind, shiftAnimDuration, shiftEnvelope, smootherstep } from '../src/cockpit-controls.js';

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
