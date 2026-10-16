// Evidence for the handling/braking root-cause fix (.scratch/handling-opus). PHYS / CATALOG select a baseline.
//   node --import ./tools/physics-test/register.mjs tools/physics-test/handling-opus-evidence.mjs laps out.json
// Megara: a perfect RivalAI line and pedals, steering through the real keyboard Input chain (binary keys) or a
// continuous gamepad stick with light assist. Dry continuation (actual geometry, grade and bank; no walls).
import './register.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { routes } from './driver-feel.mjs';
import { tightBends } from './route-corners.mjs';
import { RivalAI } from '../../src/rival-ai.js';
import { Input } from '../../src/input.js';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const src = readFileSync(process.env.CATALOG || new URL('../../src/cars.js', import.meta.url), 'utf8');
const CARS = Function('return ' + src.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const dt = 1 / 60, { route } = routes.find((r) => r.def.id === 'megara'), bends = tightBends(route);
export function lap(spec, device) {
  const v = new Vehicle(spec, route); v.steerAssist = device === 'keyboard' ? 1 : 0.35; v.reset(route.start, 0, 0);
  const ai = new RivalAI(route, v, { perfect: true, closedRoad: true });
  const controls = new Input({ target: null, navigator: null, document: null, storage: null });
  v.ground = { resolve(v) { const p = route.project(v.x, v.z, v.s, 6); v.s = p.s; v.u = p.u; v.y = route.surfaceY(p.s, p.u); v.offroad = Math.abs(p.u) > route.edge(p.s) - v.halfW ? 1 : 0; v.surfMu = 1; } };
  let progress = 0, prev = v.s, offroad = 0, maxBeta = 0, latched = 0; const trace = [];
  for (let i = 0; i < 300 / dt; i++) {
    const inp = ai.update(dt);
    if (device === 'keyboard') {
      const error = inp.steer - controls.state.steer;
      controls.keys.delete('KeyA'); controls.keys.delete('KeyD');
      if (Math.abs(error) > 0.075) controls.keys.add(error > 0 ? 'KeyD' : 'KeyA');
      controls.update(dt, { speed: v.speed }); inp.steer = controls.state.steer;
    }
    v.update(dt, inp); let d = v.s - prev; if (d < -route.length / 2) d += route.length; if (d > route.length / 2) d -= route.length; progress += d; prev = v.s;
    offroad += v.offroad; maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong))))); latched += v.driftLatch > 0 ? 1 : 0;
    trace.push({ t: (i + 1) * dt, s: v.s, kmh: v.kmh });
    if (progress >= route.length) break;
  }
  controls.destroy();
  return { device, finished: progress >= route.length, time: +(trace.length * dt).toFixed(3), offroadFrames: offroad, latchedFrames: latched, maxBetaDeg: +(maxBeta * 57.3).toFixed(1),
    minCornerKmh: bends.map((b) => ({ s: +b.s.toFixed(1), radius: +b.radius.toFixed(1), kmh: +Math.min(...trace.filter((r) => Math.abs(r.s - b.s) < 10).map((r) => r.kmh)).toFixed(1) })) };
}
if (process.argv[2] === 'laps') {
  const ids = (process.env.IDS || 'huracan,aventador_svj,z4,carrera,e36_m3').split(','), out = [];
  for (const id of ids) for (const device of ['keyboard', 'gamepad']) { const r = lap(CARS.find((c) => c.id === id), device); out.push({ id, ...r }); console.log(id, device, r.time, r.finished, r.offroadFrames, r.maxBetaDeg, Math.min(...r.minCornerKmh.map((c) => c.kmh))); }
  writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
}
