// Full production geometry, including twin bores. Only THREE rendering is
// stubbed by the existing physics-test register; Route is the real client class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Route } from '../src/map.js';
import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { buildCourse, observeCourse, courseComplete, courseFrame } from '../src/course.js';
import { resolveMap } from '../server/map-definitions.mjs';
import { effectiveEvent } from '../server/mp-lifecycle.mjs';
for (const id of ['riviera', 'penteli', 'psychiko', 'megara']) {
  const dataUrl = id === 'riviera' ? '../data/map.json' : `../data/maps/${id}/map.json`;
  const raw = JSON.parse(await readFile(new URL(dataUrl, import.meta.url), 'utf8')).route;
  const corridors = id === 'riviera' ? RIVIERA_TUNNELS : [];
  const route = new Route(raw, { corridors });
  for (const dir of [1, -1]) for (const source of ['server', 'solo']) {
    test(`${id} ${dir > 0 ? 'forward' : 'reverse'} ${source}: legal lane is tracked to the finish`, () => {
      const s0 = raw.closed ? raw.start : dir === 1 ? raw.start : raw.finish;
      const s1 = raw.closed ? s0 + dir * raw.length * 2 : dir === 1 ? raw.finish : raw.start;
      const course = buildCourse({ s0, s1, dir }, source === 'server' ? { ...raw, corridors } : route);
      let now = 0;
      for (let s = s0 - dir * 5; dir * (s - s1) < 20; s += dir * 2) {
        now += .1;
        const u = dir * route.laneU(s, 0), point = route.point(s, u);
        observeCourse(course, { s, u, x: point.x, y: point.y, z: point.z }, now);
        assert.equal(course.onRoute, true, `legal station ${s} dropped off the tracked route`);
      }
      assert.equal(courseComplete(course), true);
    });
  }
  if (id === 'riviera') test('land between the twin tunnel bores cannot count as tarmac', () => {
    const at = 9460, course = buildCourse({ s0: at - 80, s1: at + 80, dir: 1 }, { ...raw, corridors });
    const frame = courseFrame({ ...raw, corridors }, at, 1);
    assert.equal(frame.lanes.length, 2);
    const [a, b] = frame.lanes, x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    course.previous = { s: at - 10, x: x - frame.tx * 10, z: z - frame.tz * 10, y: frame.y };
    observeCourse(course, { s: at + 10, x: x + frame.tx * 10, z: z + frame.tz * 10, y: frame.y }, 2);
    assert.equal(course.onRoute, false); assert.equal(course.reached, 0);
  });
}

// Event boundaries move the tracked stations, so full-map tests alone miss failures
// such as the tt-coast tunnel mouth at 9502. Sweep actual event and mission itineraries.
for (const id of ['riviera', 'penteli', 'psychiko']) {
  const dataUrl = id === 'riviera' ? '../data/map.json' : `../data/maps/${id}/map.json`;
  const data = JSON.parse(await readFile(new URL(dataUrl, import.meta.url), 'utf8'));
  const map = resolveMap({ id }, data), route = new Route(data.route, { corridors: map.geometry.corridors });
  // Objective modes do not track a course; their deterministic itineraries
  // still provide additional real start/finish stations for this geometry sweep.
  const itineraries = Object.entries(map.trips).flatMap(([mode, trips]) => (trips || []).map(trip => ({
    id: `${mode}/${trip.id}`, s0: trip.pickup.s, s1: trip.dropoff.s,
    dir: Math.sign(trip.dropoff.s - trip.pickup.s), sectors: [],
  })));
  const definitions = [...map.definitions.values(), ...itineraries];
  const profiles = ['inner-edge', 'outer-edge', ...Array.from({ length: Math.max(...data.route.lanes) }, (_, i) => `lane-${i}`)];
  const modes = [{ step: 2, speed: 20 }, { step: 6, speed: 120, batched: true }, { step: 12, speed: 120, batched: true }];
  const lateral = (s, profile, side) => side * (profile === 'inner-edge' ? route.medHalf(s) + .1
    : profile === 'outer-edge' ? route.edge(s) - .1
    : Math.min(route.laneU(s, Number(profile.slice(5))), route.edge(s) - 1.65));
  for (const definition of definitions) for (const reverse of [false, true]) {
    const event = effectiveEvent(definition, { reverse });
    test(`${id}/${definition.id} ${reverse ? 'reversed' : 'default'}: every lane stays tracked on server and solo`, () => {
      for (const side of [1, -1]) for (const profile of profiles) for (const mode of modes) {
        const courses = [['server', buildCourse(event, map.geometry)], ['solo', buildCourse(event, route)]];
        const length = Math.abs(event.s1 - event.s0);
        let sample = 0, d = 0;
        for (;;) {
          const s = event.s0 + event.dir * d, u = lateral(s, profile, side), p = route.point(s, u);
          assert.ok(sample < 50000, `path stalled: ${side}/${profile}, step=${mode.step}, s=${s}`);
          const now = (mode.batched ? Math.floor(sample / 2) * 2 + 2 : sample + 1) * mode.step / mode.speed;
          for (const [source, course] of courses) {
            observeCourse(course, { s, u, x: p.x, y: p.y, z: p.z }, now);
            assert.equal(course.onRoute, true, `${source} ${side}/${profile}, step=${mode.step}, s=${s} left the tracked route`);
          }
          sample++;
          if (d === length + 12) break;
          // A station metre need not equal a world metre on an outer bend or
          // mapped bore. Subdivide so packets stay within the speed budget and
          // their chords follow tarmac around hairpins (25 cm arc error),
          // including the zero receipt-time gap within a two-sample batch.
          let next = Math.min(d + mode.step, length + 12);
          for (;;) {
            const station = event.s0 + event.dir * next;
            const point = route.point(station, lateral(station, profile, side));
            const dx = point.x - p.x, dz = point.z - p.z, squared = dx * dx + dz * dz;
            const onTarmac = [.25, .5, .75].every(t => {
              const station = event.s0 + event.dir * (d + (next - d) * t);
              const arc = route.point(station, lateral(station, profile, side));
              const fraction = Math.max(0, Math.min(1, ((arc.x - p.x) * dx + (arc.z - p.z) * dz) / (squared || 1)));
              return Math.hypot(arc.x - p.x - dx * fraction, arc.z - p.z - dz * fraction) <= .25;
            });
            if (Math.sqrt(squared) <= mode.step + .0001 && onTarmac) break;
            next = (d + next) / 2;
            assert.ok(next - d > .00001, 'legal road geometry must be continuous');
          }
          d = next;
        }
        for (const [source, course] of courses) assert.equal(courseComplete(course), true,
          `${source} ${side}/${profile}, step=${mode.step}: the whole route must count`);
      }
    });
  }
}

test('tt-coast solo run drives through the tunnel mouth and finishes without any route warning', async () => {
  const { EventRun, getEvent } = await import('../src/events.js');
  const data = JSON.parse(await readFile(new URL('../data/map.json', import.meta.url), 'utf8'));
  const route = new Route(data.route, { corridors: RIVIERA_TUNNELS });
  const run = new EventRun(getEvent('tt-coast'), { route, marks: data.marks }, { storage: { getItem() { return null; } } });
  run.start();
  let time = 0, finished = false;
  for (let s = run.r.s0; s <= run.r.s1 + 2; s += 6) {
    time += .1;
    const u = route.localLayout.centreU(s, 1), p = route.point(s, u);
    const emitted = run.update(.1, { s, u, x: p.x, y: p.y, z: p.z, t: time });
    assert.equal(emitted.some(e => e.kind === 'checkpoint'), false, 'the run never reports checkpoints');
    if (s === 9500) assert.equal(run.course.onRoute, true);
    finished ||= emitted.some(e => e.kind === 'finish');
  }
  assert.equal(finished, true);
});
