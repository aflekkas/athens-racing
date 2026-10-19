// Fastest clean (braked turn-in) line against fastest handbrake-flick line through the same 90-degree corner, same car, same
// steering mapping (owner playtest 2026-10-18: "it makes more sense to pull the handbrake once in the corner than to just drive
// into it"). Road: a 60 m straight, a quarter circle of centre-line radius R, a straight out. A run is valid if the car stays
// within `dev` metres of the centre line to 35 m past the exit. Both drivers steer by pure pursuit of the centre line (analogue,
// or through the real keyboard Input ramp), so the only difference is how the car is turned in: brakes and throttle, or the lever.
//   node --import ./tools/physics-test/register.mjs tools/physics-test/corner-bench.mjs [R] [assist] [carIds]   (full grid)
import { Vehicle } from '../../src/physics.js';
import { Input } from '../../src/input.js';
import { catalogue } from './powertrain.mjs';

const route = { frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); }, point(s, u) { return { x: u, z: -s, y: 0 }; }, y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project(x, z) { return { s: -z, u: x }; } };
const dt = 1 / 60, LEAD = 60;
const pathFor = (R) => {
  const path = []; for (let z = LEAD; z > 0; z -= 0.5) path.push([0, z]);
  for (let a = 0; a <= 90; a += 0.5) { const t = a / 57.29578; path.push([R - R * Math.cos(t), -R * Math.sin(t)]); }
  for (let x = R; x <= R + 80; x += 0.5) path.push([x, -R]);
  const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return { path, cum };
};
const nearest = (path, x, z, from) => { let best = from, bd = 1e9; for (let i = Math.max(0, from - 4); i < Math.min(path.length, from + 40); i++) { const d = (path[i][0] - x) ** 2 + (path[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } } return [best, Math.sqrt(bd)]; };
export const cars = () => catalogue();
/** one run: p = { kind: 'clean', v0, brakeAt, level, vCorner, tthr, thr } | { kind: 'flick', v0, flickAt, pulse, thr } (km/h, m before the turn-in) */
export function driveCorner(spec, p, { R = 25, dev = 6, assist = 1, keys = false } = {}) {
  const { path, cum } = pathFor(R);
  const v = new Vehicle(spec, route); v.steerAssist = assist; v.setManual(false);
  v.reset(0, 0, p.v0 / 3.6); v.x = 0; v.z = LEAD; // (the stub route measures s as -z)
  const ctl = keys ? new Input({ target: null, navigator: null, document: null, storage: null }) : null;
  let idx = 0, t = 0, ok = true, maxDev = 0, handbrakeUntil = -1;
  for (; t < 14; t += dt) {
    const [n, d] = nearest(path, v.x, v.z, idx); idx = n; maxDev = Math.max(maxDev, d); if (d > dev) { ok = false; break; }
    const look = Math.max(7, v.speed * 0.45); let j = idx; while (j < path.length - 1 && cum[j] - cum[idx] < look) j++;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), tx = path[j][0] - v.x, tz = path[j][1] - v.z;
    let steer = Math.max(-1, Math.min(1, -Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz) * -1 * 1.6));
    const dist = v.z, head = Math.abs((v.yaw + Math.PI * 4) % (Math.PI * 2)), h = Math.min(head, Math.PI * 2 - head);
    const inp = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    if (p.kind === 'clean') {
      inp.brake = dist < p.brakeAt && v.speed * 3.6 > p.vCorner ? p.level : 0;
      inp.throttle = inp.brake === 0 && (h > p.tthr / 57.3 || dist > p.brakeAt) ? p.thr : 0;
    } else {
      if (dist < p.flickAt && handbrakeUntil < 0) handbrakeUntil = t + p.pulse;
      inp.handbrake = handbrakeUntil > 0 && t < handbrakeUntil;
      inp.throttle = dist > p.flickAt ? p.thr : (t > handbrakeUntil ? p.thr : 0.15);
      if (inp.handbrake) steer = Math.max(steer, 0.9);
    }
    if (ctl) {
      ctl.keys.delete('KeyA'); ctl.keys.delete('KeyD'); if (steer > 0.12) ctl.keys.add('KeyD'); else if (steer < -0.12) ctl.keys.add('KeyA');
      ctl.update(dt, { speed: v.speed }); steer = ctl.state.steer;
    }
    inp.steer = steer; v.update(dt, inp);
    if (idx > path.length - 6 || v.x > R + 40) break;
  }
  ctl?.destroy();
  return { ok: ok && v.x > R + 35, t, vOut: v.speed * 3.6, dev: maxDev };
}
export const GRID = {
  full: () => {
    const clean = [], flick = [];
    for (const v0 of [60, 75, 90, 105]) {
      for (const brakeAt of [14, 22, 32, 45, 60]) for (const level of [0.3, 0.6, 1]) for (const vCorner of [35, 45, 55, 65, 75]) if (vCorner < v0) for (const tthr of [30, 60]) clean.push({ kind: 'clean', v0, brakeAt, level, vCorner, tthr, thr: 0.9 });
      for (const flickAt of [6, 12, 20, 30]) for (const pulse of [0.3, 0.5, 0.8]) flick.push({ kind: 'flick', v0, flickAt, pulse, thr: 0.9 });
    }
    return { clean, flick };
  },
  quick: () => {
    const clean = [], flick = [];
    for (const v0 of [90, 105]) for (const brakeAt of [32, 45]) for (const level of [0.6, 1]) for (const vCorner of [55, 65]) clean.push({ kind: 'clean', v0, brakeAt, level, vCorner, tthr: 30, thr: 0.9 });
    for (const v0 of [75, 90, 105]) for (const flickAt of [12, 20, 30]) for (const pulse of [0.5, 0.8]) flick.push({ kind: 'flick', v0, flickAt, pulse, thr: 0.9 });
    return { clean, flick };
  },
};
/** the fastest valid run of each kind: { clean, flick } each { t, vOut, p } or undefined */
export function bestLines(spec, opts, grid = GRID.full()) {
  const best = {};
  for (const kind of ['clean', 'flick']) for (const p of grid[kind]) { const r = driveCorner(spec, p, opts); if (r.ok && (!best[kind] || r.t < best[kind].t)) best[kind] = { ...r, p }; }
  return best;
}
if (process.argv[1]?.endsWith('corner-bench.mjs')) {
  const R = +(process.argv[2] || 25), assist = +(process.argv[3] ?? 1), ids = (process.argv[4] || 'mini,e36_m3,z4,huracan').split(',');
  console.log(`R=${R} m assist=${assist}   fastest valid time (s): clean braked turn-in | handbrake flick   (entry km/h, exit km/h)`);
  for (const id of ids) {
    const best = bestLines(cars().find(c => c.id === id), { R, assist, dev: +(process.env.DEV || 6), keys: !!process.env.KEYS });
    const f = k => best[k] ? `${best[k].t.toFixed(2)} (${best[k].p.v0}→${best[k].vOut.toFixed(0)})` : 'none valid';
    console.log(id.padEnd(10), 'clean', f('clean').padEnd(16), '| flick', f('flick').padEnd(16), best.clean && best.flick ? (best.clean.t <= best.flick.t ? 'CLEAN FASTER by ' : 'FLICK FASTER by ') + Math.abs(best.clean.t - best.flick.t).toFixed(2) + ' s' : '');
  }
}
