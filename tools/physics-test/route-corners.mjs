// Playtest #2: every <=90 m curvature peak on the shipped routes, actual
// keyboard chain and a perfect RivalAI lap. Dry continuation isolates handling;
// browser proof separately checks the production ground and collision resolver.
import './register.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CARS, routes, driveCorner } from './driver-feel.mjs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
import { RivalAI } from '../../src/rival-ai.js';
import { smoothstep } from '../../src/util.js';
const DT = 1 / 60, DEG = 180 / Math.PI;
const average = (a, key) => a.reduce((s, r) => s + r[key], 0) / a.length;
export function tightBends(route) {
  const bends = [];
  for (let s = route.start + 10; s < route.finish - 20; s += route.step) {
    const k = route.curv(s);
    if (Math.abs(k) < 1 / 90 || Math.abs(k) < Math.abs(route.curv(s - route.step)) || Math.abs(k) <= Math.abs(route.curv(s + route.step))) continue;
    const a = route.point(s - 4, 0), b = route.point(s, 0), c = route.point(s + 4, 0);
    const ax = b.x - a.x, az = b.z - a.z, bx = c.x - b.x, bz = c.z - b.z;
    const geometricK = 2 * (ax * bz - az * bx) / (Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(ax + bx, az + bz));
    bends.push({ s, k, radius: 1 / Math.abs(k), geometricRadius: 1 / Math.abs(geometricK), grade: route.lin(route.GR, s), bank: route.bank(s) });
  }
  return bends;
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
export function runRouteBench({ traces = false } = {}) {
  const maps = [];
  for (const { def, route } of routes.filter(r => ['riviera', 'penteli'].includes(r.def.id))) {
    const data = JSON.parse(readFileSync(new URL('../../' + def.dataUrl, import.meta.url)));
    route.urban = s => data.zones.reduce((urban, zone, i) => i ? urban + (zone.urban - data.zones[i - 1].urban) * smoothstep(zone.s - 120, zone.s + 130, s) : zone.urban, 0);
    const bends = tightBends(route), cars = [];
    for (const spec of CARS) {
      const v = new Vehicle(spec, route); v.manual = false;
      v.ground = { resolve(v) { const p = route.project(v.x, v.z, v.s, 6); v.s = p.s; v.u = p.u; v.y = route.surfaceY(p.s, p.u); v.offroad = 0; v.surfMu = 1; } };
      v.reset(route.start, route.laneU(route.start, 0), 0);
      const ai = new RivalAI(route, v, { perfect: true, closedRoad: true });
      const aiTrace = [];
      for (let i = 0; i < 900 / DT && v.s < route.finish; i++) {
        v.update(DT, ai.update(DT));
        aiTrace.push({ s: v.s, kmh: v.speed * 3.6, u: v.u, beta: Math.atan2(v.vLat, v.vLong) * DEG,
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
        return { ...bend, ai: { speed: minSpeed, maxBeta: near.length ? Math.max(...near.map(t => Math.abs(t.beta))) : null,
          bottomFrames: near.filter(t => t.bottom).length, maxTravel: near.length ? Math.max(...near.map(t => t.travel)) : null,
          minGravity: near.length ? Math.min(...near.map(t => t.gravity)) : null }, keyboard };
      });
      const referenceBend = bends.find(b => b.s > (def.id === 'penteli' ? 1050 : 1500));
      const power = [50, 60, 70].flatMap(kmh => [true, false].map(aids => {
        const r = driveCorner(spec, route, kmh, { bend: referenceBend, gear: 2, aids, throttle: 1, powerAt: 0.75, seconds: 4 });
        return { kmh, aids, corner: referenceBend, ...powerSummary(r), trace: r.trace };
      }));
      cars.push({ car: spec.id, drive: spec.drive, finished: v.s >= route.finish, corners, power });
      console.log(`${def.id} ${spec.id}: ${bends.length} bends; AI worst ${Math.min(...corners.map(c => c.ai.speed ?? Infinity)).toFixed(1)} km/h; 60 power on/off beta ${power.filter(p => p.kmh === 60).map(p => p.maxBetaDeg.toFixed(1)).join('/')}`);
    }
    maps.push({ map: def.id, bends, cars });
  }
  return maps;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runRouteBench({ traces: process.argv.includes('--traces') });
  const out = process.argv.find(s => s.startsWith('--out='))?.slice(6);
  if (out) writeFileSync(out, JSON.stringify({ method: 'all <=90m smoothed-curvature peaks; geometric circumradius over +/-4m; AI full route, keyboard 60/70kmh gear2 dry continuation; power on at0.75s, summary1.2-2s', results }, null, 2) + '\n');
}
