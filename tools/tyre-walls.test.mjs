import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TyreDynamics, MAX_LOOSE_TYRES } from '../src/tyre-dynamics.js';
import { createTyreWalls } from '../src/tyre-walls.js';

test('loose tyres fly, bounce, settle displaced, stay bounded and reset', () => {
  const sim = new TyreDynamics(() => 0), stacks = Array.from({length: 20}, (_, id) => ({id, x: id * 2, y: 0, z: 0, yaw: 0}));
  assert.equal(sim.release(stacks[0], 20, 0, 20).length, 0, 'disabled online by default');
  sim.enabled = true;
  const first = sim.release(stacks[0], 20, 0, 20)[0];
  assert.equal(sim.release(stacks[0], 20, 0, 20).length, 0, 'one release per stack');
  let highest = first.y, bounced = false, wasFalling = false;
  for (let i = 0; i < 60 * 30; i++) {
    wasFalling ||= first.vy < -1; sim.update(1 / 60); highest = Math.max(highest, first.y);
    bounced ||= wasFalling && first.vy > .1;
  }
  assert.ok(highest > 1.5); assert.ok(bounced); assert.ok(first.sleep); assert.ok(first.x > 2);
  const pose = [first.x, first.y, first.z]; sim.update(.1); assert.deepEqual([first.x, first.y, first.z], pose);
  for (const stack of stacks) sim.release(stack, 40, 0, 40);
  assert.ok(sim.bodies.length <= MAX_LOOSE_TYRES);
  sim.reset(); assert.equal(sim.bodies.length, 0); assert.equal(stacks[0].released, false);
});

test('instanced four-high 3D tyre walls stay static when struck, solo and online', () => {
  const group = new THREE.Group(), obstacles = [];
  const route = { project: () => ({s: 0, u: 50}), edge: () => 5, kerbs: [] };
  const walls = createTyreWalls(group, {route}, () => 0, obstacles);
  walls.path([[0,0],[3,0]]); const placements = walls.finish();
  assert.ok(placements.length); assert.equal(placements[0].slots.length, 4);
  assert.equal(placements[0].slots[0].mesh.geometry.type, 'TorusGeometry');
  walls.update(0, true); obstacles[0].onImpact({vx: 20, vz: 0, speed: 20}); assert.equal(walls.dynamics.bodies.length, 0);
  walls.update(0, false); obstacles[0].onImpact({vx: 20, vz: 0, speed: 20}); walls.update(1 / 60, false);
  assert.equal(walls.dynamics.bodies.length, 0, 'tyres stay in their stacks in solo too');
  const matrix = new THREE.Matrix4(), slot = placements[0].slots[3]; slot.mesh.getMatrixAt(slot.index, matrix);
  assert.ok(matrix.elements[0] !== 0, 'struck stack keeps every tyre');
  assert.equal(group.getObjectByName('loose-circuit-tyres').count, 0);
});
