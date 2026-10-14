// Assert the planner's nodes/curvature against the actual driveable carriageway.
import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { Route } = await import('../../src/map.js');
const { RacingLine } = await import('../../src/rival-ai.js');
const { RIVIERA_TUNNELS } = await import('../../src/maps/riviera-tunnels.js');
for (const dir of [1, -1]) for (const closedRoad of [false, true]) test(`mapped Loumbarda ${dir}, closed road ${closedRoad}: plan the carriageway followed by steering targets`, () => {
  const route = new Route(JSON.parse(readFileSync(new URL('../../data/map.json', import.meta.url))).route, { corridors: RIVIERA_TUNNELS });
  const line = new RacingLine(route, { dir, halfWidth: 0.932, closedRoad });
  let checked = 0;
  for (let i = 2; i < line.n - 2; i++) {
    const s = i * line.step;
    if (!route.localLayout.contains(s)) continue;
    const p = line.point(s), l = line.point((i - 2) * line.step), r = line.point((i + 2) * line.step);
    assert.ok(Math.hypot(line.x[i] - p.x, line.z[i] - p.z) < 1e-6, 'planner node differs from driveable line');
    const ax = p.x - l.x, az = p.z - l.z, bx = r.x - p.x, bz = r.z - p.z;
    const k = 2 * (ax * bz - az * bx) / (Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(ax + bx, az + bz));
    assert.ok(Math.abs(k - line.k[i]) < 1e-6, 'speed plan uses a different curvature from steering');
    checked++;
  }
  assert.ok(checked > 180);
});
