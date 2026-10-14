// Deterministic straight-road police fixture shared by tuning measurements and regressions.
import { Police } from '../src/police.js';
export function world(PoliceClass = Police) {
  const route = { length: 20000, speeds: [{ s: 0, v: 50 }, { s: 5000, v: 70 }], start: 0, finish: 20000,
    point: (s, u) => ({ x: u, y: 0, z: -s }), edge: () => 7.1, curv: () => 0, div: () => 0, medHalf: () => 0.12, laneU: (s, l) => 0.12 + (l + 0.5) * 3.5, urban: () => 0.3,
    project: (x, z) => ({ s: -z, u: x }) };
  const mk = (i, moto) => ({ id: 100 + i, police: true, type: { id: moto ? 'police_moto' : 'police', len: moto ? 2.2 : 4.7, wid: moto ? 0.9 : 1.8, scooter: moto }, active: false, cop: null, crash: null,
    m: { root: { visible: false }, setStrobe() {} }, indL: {}, indR: {}, len: 4.7, wid: 1.8 });
  const traffic = {
    route, cars: [0, 1, 2, 3, 4, 5].map((i) => mk(i, i === 5)), racers: [], signals: null, ground: null, sites: [], cones: [], coneBase: 0, coneMesh: { count: 0 },
    laneCount: () => 2, laneUOf: (c, s, l = c.lane) => c.dir * (0.12 + (l + 0.5) * 3.5), kerbU: (c, s, i) => c.dir * (7.1 - i), roadSpeed: () => 20,
    personality(c) { c.drv = { vf: 1 }; }, initDrive(c) { c.mode = 'drive'; }, repair() {}, lead: () => ({ gap: 1e9, lv: 0, o: null }),
  };
  const police = new PoliceClass(traffic, route);
  police.rng = { next: () => 0.99, range: (a, b) => (a + b) / 2, chance: () => false, int: (a) => a };
  const player = (s, u, vs) => { traffic.racers = [{ kind: 'player', a: {}, s, u, vs, vu: 0, hs: 2.2, hu: 0.9 }]; };
  return { route, traffic, police, player };
}
export const step = (W, secs, ctx = {}, dt = 1 / 30, move) => { const out = []; for (let t = 0; t < secs; t += dt) { move?.(dt); out.push(...W.police.update(dt, { racing: true, dir: 1, reds: 0, ...ctx })); } return out; };
