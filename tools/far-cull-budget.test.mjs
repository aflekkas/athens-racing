// Potato draw-call budget on Riviera (owner 2026-10-19: under 200 calls per frame once the far world is not drawn). The numbers are a capture of the real
// game (tools/far-cull-capture.mjs: headless Chrome, Riviera, Potato class, fixed poses on the longest straight and in the sharpest corner, driver's view
// and chase camera, no rivals / traffic / police, every frame of two turns of the mirror pass), committed next to the screenshots. Like the detail budgets
// this guards the capture: if the culling code changes, repeat it:
//   for cam in cockpit chase; do ROOT=$PWD OUT=.scratch/potato-far-cull-2026-10-19 TAG=after CAM=$cam tools/browser-slot.sh node tools/far-cull-capture.mjs; done
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PERFORMANCE } from '../src/graphics.js';

const root = resolve(import.meta.dirname, '..'), dir = '.scratch/potato-far-cull-2026-10-19', read = path => readFileSync(resolve(root, path));
const report = (tag, cam) => JSON.parse(read(`${dir}/${tag}-${cam}.json`));
const BUDGET = 200;

for (const cam of ['cockpit', 'chase']) test(`Riviera on Potato, ${cam} camera: every frame of the fixed poses draws under ${BUDGET} calls, down from the before capture`, () => {
  const after = report('after', cam), before = report('before', cam);
  assert.equal(after.class, 'potato'); assert.equal(before.class, 'potato');
  assert.deepEqual(after.errors, []); assert.ok(!after.failed);
  assert.equal(after.farCull, PERFORMANCE.potato.farCull, 'the capture was taken at the current far-cull distance: repeat it');
  for (const [path, sha] of Object.entries(after.sourceHashes)) assert.equal(createHash('sha256').update(read(path)).digest('hex'), sha, `${path} changed: repeat the fixed-pose capture (see the header)`);
  assert.deepEqual(Object.keys(after.poses).sort(), ['corner', 'straight']);
  for (const name of ['straight', 'corner']) {
    const a = after.poses[name], b = before.poses[name];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 3, `${name}: the same place before and after (the cars differ by a metre of autodrive)`);
    assert.ok(a.calls.length >= 6, 'two turns of the mirror pass');
    assert.ok(Math.max(...a.calls) < BUDGET, `${cam} ${name}: ${Math.max(...a.calls)} calls in the heaviest frame`);
    const ratio = name === 'straight' ? 0.65 : 0.9; // the long straight shows the most far road; the corner is mostly hillside already
    assert.ok(Math.max(...a.calls) < Math.max(...b.calls) * ratio, `${cam} ${name}: ${Math.max(...a.calls)} calls after vs ${Math.max(...b.calls)} before`);
    if (name === 'straight') assert.ok(a.triangles < b.triangles * 0.6, 'the straight draws far fewer triangles (the last frame of the capture may be a mirror frame, so only the long view is compared)');
  }
});
