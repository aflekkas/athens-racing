// Mixed-surface recovery through real per-wheel tyre forces. Run: node tools/physics-test/dirt.mjs
import './register.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const source = readFileSync(new URL(process.env.GROUND || '../../src/ground.js', import.meta.url), 'utf8');
const SURF = Function('return ' + source.split('export const SURF = ')[1].split('\n};')[0] + '\n};')();
const catalogue = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const CARS = Function('return ' + catalogue.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const route = { GR: null, frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); }, point(s, u) { return { x: u, z: -s, y: 0 }; }, y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0 };
const baseline = process.argv.includes('--baseline'), rows = [];
SURF.grass ||= SURF.scrub;
for (const spec of CARS) for (const kmh of [80, 100]) for (const surface of ['verge', 'dirt', 'gravel', 'scrub', 'grass']) for (const side of [-1, 1]) for (const excursion of ['two', 'all']) {
  if (!SURF[surface]) continue;
  const v = new Vehicle(spec, route), edge = 4;
  let offFrames = 0, maxBeta = 0, maxYaw = 0, cut = 0;
  v.ground = { resolve(v) {
    v.s = -v.z; v.u = v.x; v.y = v.grade = v.gradeG = v.bank = 0;
    v.wheelSurf = v.cy.map((cy, i) => side * (v.x - Math.sin(v.yaw) * v.cx[i] + Math.cos(v.yaw) * cy) > edge ? surface : 'asphalt');
    const profiles = v.wheelSurf.map(s => SURF[s]);
    v.offroad = side * v.x > edge ? 1 : 0; v.surf = v.offroad ? surface : 'asphalt';
    for (const [name, key] of [['surfMu','mu'], ['surfDrag','drag'], ['surfRes','res'], ['surfSoft','soft']]) v[name] = profiles.reduce((a, s) => a + (s[key] || 0), 0) / 4;
    if (!baseline) { v.wheelMu = profiles.map(s => s.mu * (s.traction ?? 1)); v.wheelPeak = profiles.map(s => s.peak ?? 1); v.wheelSlide = profiles.map(s => s.slide ?? null); v.wheelSlideV = profiles.map(s => s.slideV ?? null); }
    v.wheelBump = [0, 0, 0, 0];
  } };
  v.reset(100, side * (edge + (excursion === 'all' ? 2 : 0.15)), kmh / 3.6); v.roadEvents = false; v.ground.resolve(v);
  // Prepare the rolling gearbox before dropping two wheels onto the shoulder.
  for (let i = 0; i < 90; i++) { v.update(1/60, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = kmh/3.6; }
  v.reset(100, side * (edge + (excursion === 'all' ? 2 : 0.15)), kmh/3.6); v.gear = 3; v.syncWheels(); v.ground.resolve(v);
  for (let i = 0; i < 300; i++) {
    const t = i/60;
    const muBefore = v.wheelMu?.slice();
    // A normal small correction, then unwind. No handbrake, drift or state clamps.
    v.update(1/60, { throttle: 0.65, brake: 0, steer: side * (t < 0.45 ? 0 : t < 1.25 ? -0.5 : t < 1.8 ? 0.12 : 0) });
    if (!baseline && i === 0) for (let wheel = 0; wheel < 4; wheel++) {
      const fz = v.corners[wheel].Fz, load = Math.max(0.4, 1 - (spec.loadSens ?? 0.15) * (fz / (v.m * 9.81 * 0.25) - 1));
      assert.ok(Math.abs(v._cap[wheel] / (spec.grip * (wheel < 2 ? 1 : v.gripR) * fz * load) - muBefore[wheel]) < 1e-8, 'each tyre must use its own surface, without another offroad penalty');
    }
    if (v.wheelSurf.some(s => s !== 'asphalt')) offFrames++;
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong)))) * 180/Math.PI);
    maxYaw = Math.max(maxYaw, Math.abs(v.w)); cut = Math.max(cut, v.tcCut);
    assert.ok(Number.isFinite(v.x + v.z + v.rpm));
  }
  const row = { car: spec.id, kmh, surface, side, excursion, maxBeta, maxYaw, cut, finalBeta: Math.abs(Math.atan2(v.vLat, v.vLong))*180/Math.PI, recovered: v.wheelSurf.every(s => s === 'asphalt'), offFrames, exitKmh: v.kmh };
  rows.push(row);
  if (!baseline) { assert.ok(offFrames >= 20, 'must actually spend time two wheels off'); assert.ok(maxBeta < (excursion === 'all' ? 25 : 15), JSON.stringify(row)); assert.ok(row.finalBeta < 3 && row.recovered, JSON.stringify(row)); assert.equal(v.driftLatch, 0); }
}
const summary = { cases: rows.length, worstBeta: Math.max(...rows.map(r => r.maxBeta)), worstFinalBeta: Math.max(...rows.map(r => r.finalBeta)), recovered: rows.filter(r => r.recovered).length, rows };
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6); if (out) writeFileSync(out, JSON.stringify(summary, null, 2)+'\n');
console.log(JSON.stringify({ ...summary, rows: undefined }));
