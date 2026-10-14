// Playtest #2: every <=90 m curvature peak on the shipped routes, actual
// keyboard chain and a perfect RivalAI lap. Dry continuation isolates handling;
// browser proof separately checks the production ground and collision resolver.
import './register.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CARS, routes, driveCorner } from './driver-feel.mjs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const { RivalAI } = await import(process.env.AI || '../../src/rival-ai.js');
const { smoothstep } = await import('../../src/util.js');
const DT = 1 / 60, DEG = 180 / Math.PI;
const average = (a, key) => a.reduce((s, r) => s + r[key], 0) / a.length;
export function geometricBend(route, s) {
  const u = route.closed ? 0 : route.laneU(s, 0);
  const a = route.point(s - 4, u), b = route.point(s, u), c = route.point(s + 4, u);
  const ax = b.x - a.x, az = b.z - a.z, bx = c.x - b.x, bz = c.z - b.z;
  const k = 2 * (ax * bz - az * bx) / (Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(ax + bx, az + bz));
  return { s, k, radius: 1 / Math.abs(k), geometricRadius: 1 / Math.abs(k), smoothedRadius: 1 / Math.abs(route.curv(s)),
    grade: route.contactFrame(s, u, {}).grade, bank: route.contactFrame(s, u, {}).bank };
}
export function tightBends(route) {
  // Actual first-lane geometry, including separated mapped carriageways.
  // +/-4 m circumradius and +/-10 m peak suppression avoid sample jitter;
  // opposing successive bends remain separate. Smoothed K is diagnostic only.
  const samples = [];
  for (let s = route.start + 10; s < route.finish - 20; s += route.step) samples.push(geometricBend(route, s));
  return samples.filter((b, i) => {
    if (Math.abs(b.k) < 1 / 90) return false;
    const nearby = samples.slice(Math.max(0, i - 5), i + 6).filter(n => Math.sign(n.k) === Math.sign(b.k));
    return nearby.every(n => Math.abs(n.k) <= Math.abs(b.k)) && nearby.find(n => Math.abs(n.k) === Math.abs(b.k)) === b;
  });
}
export function powerSummary(result, start = 1.2, end = 2) {
  const window = result.trace.filter(r => r.t >= start && r.t <= end);
  const speed = average(window, 'kmh') / 3.6;
  return { yawDeg: average(window, 'yawRate') * DEG, betaDeg: average(window, 'betaDeg') * Math.sign(result.corner.k ?? 1),
    maxBetaDeg: Math.max(...result.trace.map(r => Math.abs(r.betaDeg))), pathRadius: speed / Math.max(0.001, average(window, 'pathYawRate')),
    speed: speed * 3.6, tc: average(window, 'tcCut'), esc: average(window, 'escCut'),
    rearSlip: average(window, 'rearSlip'), frontSlip: average(window, 'frontSlip'), rpm: average(window, 'rpm'),
    maxTravel: Math.max(...result.trace.flatMap(r => r.travel)), bottomFrames: result.trace.filter(r => r.travel.some(d => d > r.travelLimit)).length,
    minGravity: Math.min(...result.trace.map(r => r.effectiveGravity)), maxToe: Math.max(...result.trace.map(r => Math.abs(r.toePull))) };
}
export function runRouteBench({ traces = false, checkpoint } = {}) {
  const maps = [];
  for (const { def, route } of routes.filter(r => ['riviera', 'penteli'].includes(r.def.id))) {
    const data = JSON.parse(readFileSync(new URL('../../' + def.dataUrl, import.meta.url)));
    route.urban = s => data.zones.reduce((urban, zone, i) => i ? urban + (zone.urban - data.zones[i - 1].urban) * smoothstep(zone.s - 120, zone.s + 130, s) : zone.urban, 0);
    const bends = tightBends(route), cars = [];
    maps.push({ map: def.id, bends, cars });
    for (const spec of CARS) {
      const v = new Vehicle(spec, route); v.manual = false;
      v.ground = { resolve(v) { const p = route.project(v.x, v.z, v.s, 6); v.s = p.s; v.u = p.u; v.y = route.surfaceY(p.s, p.u); v.offroad = 0; v.surfMu = 1; } };
      v.reset(route.start, route.laneU(route.start, 0), 0);
      const ai = new RivalAI(route, v, { perfect: true, closedRoad: true });
      const aiTrace = [];
      let previousBeta = 0;
      for (let i = 0; i < 900 / DT && v.s < route.finish; i++) {
        v.update(DT, ai.update(DT));
        const beta = Math.atan2(v.vLat, v.vLong), pathYaw = v.w + Math.atan2(Math.sin(beta - previousBeta), Math.cos(beta - previousBeta)) / DT;
        previousBeta = beta;
        aiTrace.push({ pathYaw, s: v.s, kmh: v.speed * 3.6, u: v.u, beta: Math.atan2(v.vLat, v.vLong) * DEG,
          bottom: v.sus.d.some(d => d > v.travel), travel: Math.max(...v.sus.d), gravity: v.contactFrame.effectiveGravity, toe: v.toePull });
      }
      const corners = bends.map(bend => {
        const near = aiTrace.filter(t => Math.abs(t.s - bend.s) < 10);
        const keyboard = [60, 70].map(kmh => {
          const r = driveCorner(spec, route, kmh, { bend, gear: 2, throttle: 1, seconds: 2 });
          const summary = powerSummary(r, 0.75, 1.25);
          return { kmh, ...summary, ratio: summary.pathRadius / bend.geometricRadius, ...(traces ? { trace: r.trace } : {}) };
        });
        const minSpeed = near.length ? Math.min(...near.map(t => t.kmh)) : null;
        const aiRadius = near.length ? average(near, 'kmh') / 3.6 / Math.max(0.001, Math.abs(average(near, 'pathYaw'))) : null;
        return { ...bend, ai: { speed: minSpeed, pathRadius: aiRadius, radiusRatio: aiRadius / bend.geometricRadius, lineRadius: 1 / Math.max(1e-6, Math.abs(ai.line.sample(ai.line.k, bend.s))), maxBeta: near.length ? Math.max(...near.map(t => Math.abs(t.beta))) : null,
          bottomFrames: near.filter(t => t.bottom).length, maxTravel: near.length ? Math.max(...near.map(t => t.travel)) : null,
          minGravity: near.length ? Math.min(...near.map(t => t.gravity)) : null }, keyboard };
      });
      const referenceBend = geometricBend(route, def.id === 'penteli' ? 1106 : 1577);
      const power = [50, 60, 70].flatMap(kmh => [true, false].map(aids => {
        const r = driveCorner(spec, route, kmh, { bend: referenceBend, gear: 2, aids, throttle: 1, powerAt: 0.75, seconds: 4 });
        return { kmh, aids, corner: referenceBend, ...powerSummary(r), trace: r.trace };
      }));
      cars.push({ car: spec.id, drive: spec.drive, finished: v.s >= route.finish, corners, power });
      checkpoint?.(maps);
      console.log(`${def.id} ${spec.id}: ${bends.length} bends; AI worst ${Math.min(...corners.map(c => c.ai.speed ?? Infinity)).toFixed(1)} km/h; 60 power on/off beta ${power.filter(p => p.kmh === 60).map(p => p.maxBetaDeg.toFixed(1)).join('/')}`);
    }
  }
  return maps;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv.find(s => s.startsWith('--out='))?.slice(6);
  const save = results => out && writeFileSync(out, JSON.stringify({ method: 'all <=90m actual first-lane curvature peaks, +/-10m suppression; geometric circumradius +/-4m; AI full route, keyboard 60/70kmh gear2 dry continuation; power on at0.75s, summary1.2-2s', results }, null, 2) + '\n');
  runRouteBench({ traces: process.argv.includes('--traces'), checkpoint: save });
}
