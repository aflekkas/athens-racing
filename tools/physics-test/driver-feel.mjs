// Player-chain bench: node tools/physics-test/driver-feel.mjs --out=.scratch/handling-feel/after.json
// Full W+steer: add --power (four seconds, actual keyboard pedal ramp).
// PHYS / INPUT can select saved modules for an identical before/after replay.
import './register.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const { Input } = await import(process.env.INPUT || '../../src/input.js');
const { Route } = await import('../../src/map.js');
const catalogURL = new URL(process.env.CATALOG || '../../src/cars.js', import.meta.url);
const catalogueSource = readFileSync(catalogURL, 'utf8');
const allCars = Function('return ' + catalogueSource.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
export const CARS = allCars.filter(c => ['mini', 'z4', 'taxi', 'carrera', 'gr_yaris', 'gtv'].includes(c.id));
const { MAPS } = await import('../../src/map-catalog.js');
const DT = 1 / 60, G = 9.81, DEG = 180 / Math.PI;
const mean = (a, key) => a.reduce((s, r) => s + r[key], 0) / a.length;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export const routes = MAPS.map(def => {
  const data = JSON.parse(readFileSync(new URL('../../' + def.dataUrl, import.meta.url)));
  const route = new Route(data.route);
  route.urban = () => 1;
  return { def, route };
});

// Choose an actual sustained bend near the road-tyre limit for this entry speed.
// Radius is from the shipped route, never an invented constant-radius map.
export function cornerAt(route, kmh, targetG = 0.85) {
  const targetK = targetG * G / (kmh / 3.6) ** 2;
  let best;
  for (let s = 80; s < route.length - 100; s += route.step) {
    const ks = [0, 10, 20, 30].map(d => route.curv(s + d));
    if (Math.abs(ks[0]) < 0.003 || ks.some(k => Math.sign(k) !== Math.sign(ks[0]))) continue;
    const k = ks.reduce((a, b) => a + b) / ks.length;
    const spread = Math.max(...ks) - Math.min(...ks);
    const score = Math.abs(Math.log(Math.abs(k) / targetK)) + Math.abs(spread / k) * 0.4 + Math.abs(route.lin(route.GR, s)) * 2;
    if (!best || score < best.score) best = { s, k, radius: 1 / Math.abs(k), score };
  }
  if (!best) throw new Error('No sustained map corner');
  return best;
}

export function driveCorner(spec, route, kmh, { device = 'keyboard', instant = false, assist, throttle, seconds = 2, cornerG = 0.85, powerAt = 0, initialBeta = 0, inputScale = 1 } = {}) {
  const bend = cornerAt(route, kmh, cornerG), side = Math.sign(bend.k);
  const vehicle = new Vehicle(spec, route);
  const pad = { id: 'driver-feel', index: 0, connected: true, axes: [side * (0.15 + 0.85 * inputScale), 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0 })) };
  const controls = new Input({ target: null, navigator: { getGamepads: () => device === 'gamepad' ? [pad] : [] }, document: null, storage: null });
  vehicle.steerAssist = assist ?? (device === 'gamepad' ? 0.35 : 1);
  // Diagnostic dry-tarmac continuation: preserve real route projection, grade,
  // banking and suspension; omit walls/verges so a missed bend cannot hide the
  // handling failure behind a collision or an unrelated loose-surface penalty.
  vehicle.ground = { resolve(v) {
    const p = route.project(v.x, v.z, v.s, 6);
    v.s = p.s; v.u = p.u; v.y = route.surfaceY(v.s, v.u);
    v.offroad = 0; v.surfMu = 1;
  } };
  vehicle.reset(bend.s, route.closed ? 0 : route.laneU(bend.s, 0), kmh / 3.6);
  // Settle the rolling driveline before the keydown, rather than starting in
  // first gear at 120 km/h. Only this preparation holds longitudinal speed.
  for (let i = 0; i < 90; i++) {
    vehicle.update(DT, { throttle: 0.2, brake: 0, steer: 0 });
    vehicle.vLong = kmh / 3.6;
  }
  vehicle.resetSuspension();
  const p = route.point(bend.s, route.closed ? 0 : route.laneU(bend.s, 0));
  vehicle.x = p.x; vehicle.z = p.z; vehicle.s = bend.s; vehicle.u = route.closed ? 0 : route.laneU(bend.s, 0);
  const f = route.frame(bend.s, {});
  vehicle.yaw = Math.atan2(-f.tx, -f.tz);
  vehicle.vLat = Math.tan(initialBeta) * vehicle.vLong;
  vehicle.w = vehicle.steer = 0;
  for (const c of vehicle.corners) c.aDyn = 0;
  let integral = 0.2, prevBeta = 0;
  if (device === 'keyboard') controls.keyDown({ code: side > 0 ? 'KeyD' : 'KeyA' });
  const trace = [];
  for (let i = 0; i < seconds / DT; i++) {
    if (throttle === 1 && device === 'keyboard' && i * DT >= powerAt && !controls.keys.has('KeyW')) controls.keyDown({ code: 'KeyW' });
    controls.update(DT, { speed: Math.abs(vehicle.vLong) });
    const steer = instant ? side : controls.state.steer;
    const error = kmh / 3.6 - vehicle.speed;
    integral = clamp(integral + error * DT * 0.6, 0, 0.5);
    const pedal = throttle != null && i * DT >= powerAt ? (throttle === 1 && device === 'keyboard' ? controls.state.throttle : throttle) : clamp(integral + error * 0.5, 0, 0.5);
    vehicle.update(DT, { throttle: pedal, brake: 0, steer, handbrake: false });
    const beta = Math.atan2(vehicle.vLat, vehicle.vLong);
    const pathW = vehicle.w + wrap(beta - prevBeta) / DT;
    prevBeta = beta;
    trace.push({ t: (i + 1) * DT, steerInput: steer, rackDeg: vehicle.steer * DEG,
      effectiveRackDeg: Math.atan2(vehicle._S[0].s, vehicle._S[0].c) * DEG,
      frontTravelDeg: Math.atan2(vehicle.vLat + vehicle.a * vehicle.w, Math.max(2, Math.abs(vehicle.vLong))) * DEG,
      peakSlipDeg: vehicle.aPk * DEG, mechanicalLockDeg: vehicle.rackLock(vehicle.speed) * DEG,
      kmh: vehicle.speed * 3.6, yawRate: vehicle.w * side, pathYawRate: pathW * side,
      lateralG: Math.abs(vehicle.ayRaw) / G, pathG: Math.abs(pathW) * vehicle.speed / G,
      frontDeg: Math.abs(vehicle.wheel[0].aDyn) * DEG, rearDeg: Math.abs(vehicle.wheel[1].aDyn) * DEG,
      frontSlip: vehicle.wheel[0].sN, rearSlip: vehicle.wheel[1].sN,
      frontWheels: vehicle.corners.slice(0, 2).map(c => ({ sx: c.sx, sy: c.sy, Fz: c.Fz, Fx: c.Fx, Fy: c.Fy, edl: c.edl })),
      drivenCombined: Math.max(...vehicle.corners.map((c, j) => (j < 2 ? 1 - vehicle.shareR : vehicle.shareR) > 0 ? c.sN : 0)),
      drivenSy: Math.max(...vehicle.corners.map((c, j) => (j < 2 ? 1 - vehicle.shareR : vehicle.shareR) > 0 ? Math.abs(c.sy) : 0)),
      wheelspin: vehicle.wheelspin, rearWheels: vehicle.corners.slice(2).map(c => ({ sx: c.sx, sy: c.sy })),
      betaDeg: beta * DEG, tcCut: vehicle.tcCut, escCut: vehicle.escCut,
      driftLatch: vehicle.driftLatch, x: vehicle.x, z: vehicle.z, s: vehicle.s, u: vehicle.u });
  }
  controls.destroy();
  const settled = trace.filter(r => r.t >= 1 && r.t <= 1.5);
  const yaw = mean(settled, 'yawRate'), speed = mean(settled, 'kmh') / 3.6;
  const reach = trace.find(r => r.yawRate >= yaw * 0.9);
  const steer90 = trace.find(r => Math.abs(r.steerInput) >= 0.9);
  const peakG = Math.max(...trace.slice(14).map((_, j) => mean(trace.slice(j, j + 15), 'lateralG')));
  return { car: spec.id, kmh, corner: { s: bend.s, radius: bend.radius, requiredG: (kmh / 3.6) ** 2 / (bend.radius * G) },
    device, instant, assist: vehicle.steerAssist, yaw90: reach?.t ?? null, input90: steer90?.t ?? null,
    yawGain: yaw / (speed * Math.tan(Math.abs(mean(settled, 'rackDeg')) / DEG) / vehicle.wb),
    achievedG: mean(settled, 'lateralG'), maxG: peakG,
    pathRadius: speed / Math.max(0.001, mean(settled, 'pathYawRate')),
    radiusRatio: speed / Math.max(0.001, mean(settled, 'pathYawRate')) / bend.radius,
    frontDeg: mean(settled, 'frontDeg'), rearDeg: mean(settled, 'rearDeg'),
    tcCut: Math.max(...trace.map(r => r.tcCut)), escCut: Math.max(...trace.map(r => r.escCut)), trace };
}

export function runBench(options = {}) {
  return routes.flatMap(({ def, route }) => CARS.flatMap(spec => [60, 90, 120].map(kmh => ({ map: def.id, ...driveCorner(spec, route, kmh, options) }))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const power = process.argv.includes('--power');
  const results = runBench(power ? { throttle: 1, seconds: 4 } : {});
  const out = process.argv.find(s => s.startsWith('--out='))?.slice(6);
  const hash = url => createHash('sha256').update(readFileSync(url)).digest('hex');
  if (out) writeFileSync(out, JSON.stringify({ method: '60 Hz real Input keydown -> default assist -> Vehicle; actual shipped corners, dry-tarmac continuation, natural speed after rolling preparation; steady window 1.0–1.5 s; max g is 250 ms average', power,
    hashes: { physics: hash(new URL(process.env.PHYS || '../../src/physics.js', import.meta.url)), input: hash(new URL(process.env.INPUT || '../../src/input.js', import.meta.url)), cars: hash(catalogURL) }, results }, null, 2) + '\n');
  for (const r of results.filter(r => r.map === 'riviera')) console.log(`${r.car.padEnd(9)} ${r.kmh} km/h: yaw90 ${r.yaw90?.toFixed(3)} s, ${r.achievedG.toFixed(2)} g (max ${r.maxG.toFixed(2)}), R ${r.pathRadius.toFixed(1)} / corner ${r.corner.radius.toFixed(1)} m, F/R ${r.frontDeg.toFixed(1)}/${r.rearDeg.toFixed(1)}°, yaw gain ${r.yawGain.toFixed(2)}, TC/ESC ${r.tcCut.toFixed(2)}/${r.escCut.toFixed(2)}`);
}
