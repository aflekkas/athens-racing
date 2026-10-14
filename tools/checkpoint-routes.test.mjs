// Full production geometry, including twin bores. Only THREE rendering is
// stubbed by the existing physics-test register; Route is the real client class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Route } from '../src/map.js';
import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { buildCourse, observeCourse } from '../src/checkpoints.js';
for (const id of ['riviera', 'penteli', 'megara']) {
  const dataUrl = id === 'riviera' ? '../data/map.json' : `../data/maps/${id}/map.json`;
  const raw = JSON.parse(await readFile(new URL(dataUrl, import.meta.url), 'utf8')).route;
  const corridors = id === 'riviera' ? RIVIERA_TUNNELS : [];
  const route = new Route(raw, { corridors });
  for (const dir of [1, -1]) for (const source of ['server', 'solo']) {
    test(`${id} ${dir > 0 ? 'forward' : 'reverse'} ${source}: legal lane crosses every gate`, () => {
      const s0 = raw.closed ? raw.start : dir === 1 ? raw.start : raw.finish;
      const s1 = raw.closed ? s0 + dir * raw.length * 2 : dir === 1 ? raw.finish : raw.start;
      const course = buildCourse({ s0, s1, dir }, source === 'server' ? { ...raw, corridors } : route);
      let now = 0;
      for (let s = s0 - dir * 5; dir * (s - s1) < 20; s += dir * 2) {
        now += .1;
        const u = dir * route.laneU(s, 0), point = route.point(s, u);
        const status = observeCourse(course, { s, u, x: point.x, y: point.y, z: point.z }, now);
        assert.equal(status.missed, false, `legal station ${s}, next gate ${status.next?.s}`);
      }
      assert.equal(course.passed, course.gates.length);
    });
  }
  if (id === 'riviera') test('land between the twin tunnel bores cannot count as tarmac', () => {
    const gateS = 9460, course = buildCourse({ s0: gateS - 80, s1: gateS + 80, dir: 1 }, { ...raw, corridors });
    const gate = course.gates[0];
    assert.equal(gate.lanes.length, 2);
    const [a, b] = gate.lanes, x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    course.previous = { s: gateS - 10, x: x - gate.tx * 10, z: z - gate.tz * 10, y: gate.y };
    const status = observeCourse(course, { s: gateS + 10, x: x + gate.tx * 10, z: z + gate.tz * 10, y: gate.y }, 2);
    assert.equal(status.missed, true); assert.equal(status.passed, 0);
  });
}
