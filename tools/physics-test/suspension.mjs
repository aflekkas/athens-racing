// Suspension, kerbs, handling balance and the capability API:
//   node --import ./tools/physics-test/register.mjs tools/physics-test/suspension.mjs [carId]
// Exit code 1 on any failure.
import { CARS, route, skidpad, fullLock } from './handling.mjs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');

const G = 9.81, D = 57.2958;
let fails = 0, passes = 0;
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  [' + info + ']' : ''}`); };
const f2 = (x) => x.toFixed(2);
const spd = (c) => Math.hypot(c.vLong, c.vLat);

/** straight run at kmh; the right-hand wheels meet a kerb of height h at s0 and come off it at s1. Returns the body's
 *  vertical acceleration history (heave + the hit corner's pitch/roll contribution), per frame */
function kerbRun(spec, kmh, h, fdt = 1 / 60, s0 = 30, s1 = 75) {
  const v = new Vehicle(spec, route); v.reset(0, 0, kmh / 3.6);
  for (let i = 0; i < 60; i++) { v.update(1 / 60, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = kmh / 3.6; }
  v.x = 0; v.z = 0; v.s = 0; v.u = 0;
  const bump = v.wheelBump = [0, 0, 0, 0], tr = [];
  let t = 0, zvPrev = v.sus.zv, finite = true;
  while (t < 4) {
    for (let i = 0; i < 4; i++) { const si = -v.z + v.cx[i]; bump[i] = v.cy[i] > 0 && si > s0 && si < s1 ? h : 0; }
    v.update(fdt, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = kmh / 3.6; v.vLat = 0; v.w = 0; v.yaw = 0; v.x = 0;
    t += fdt;
    // vertical acceleration at the driver's seat (front-left of centre): heave + pitch/roll lever arms
    const S = v.sus, zs = S.zv + 0.4 * S.thv - 0.35 * S.phv;
    tr.push({ t, s: -v.z, acc: (zs - zvPrev) / fdt, z: S.z, ph: S.ph, th: S.th, zv: S.zv, Fz: v.corners.map((c) => c.Fz) });
    zvPrev = zs;
    if (![S.z, S.th, S.ph, ...v.corners.map((c) => c.Fz)].every(Number.isFinite)) { finite = false; break; }
  }
  return { tr, finite, v };
}

const only = process.argv[2];
const list = CARS.filter((c) => !only || c.id === only);

// ------------------------------------------------------------------ 0. the ground under a wheel: plane + step (ground.js)
{
  const { wheelGround } = await import('../../src/wheel-ground.js');
  const kerbRoute = { edge: () => 3.5, surfaceY: () => 0, length: 1000, closed: false };
  const road = { gutter: 0.3, curbH: () => 0.16, sidewalk: () => 2 };
  const eA = 3.8, uo = eA + 0.18 + 2;
  // at(): road surface on the carriageway, the kerb's top on the pavement, a terrain 0.3 m up beyond it
  const at = (u) => ({ y: Math.abs(u) <= eA ? 0 : Math.abs(u) <= uo ? 0.16 : 0.3, hump: 0 });
  const g = (u) => wheelGround(kerbRoute, road, at(u), 100, u, {});
  const near = (x, y, e = 0.005) => Math.abs(x - y) < e;
  const cases = [
    ['flat carriageway, centre', 0, (r) => near(r.input, 0) && near(r.plane, 0)],
    ['flat carriageway, 2 m out', 2, (r) => near(r.input, 0) && near(r.plane, 0)],
    ['carriageway just short of the tyre band', eA - 0.2, (r) => near(r.input, 0) && near(r.plane, 0)],
    ['at the kerb edge: half the kerb, plane on the road', eA, (r) => near(r.input, 0.08) && near(r.plane, 0)],
    ['on the pavement: the full kerb, plane on the road', eA + 0.5, (r) => near(r.input, 0.16) && near(r.plane, 0)],
    ['off the pavement edge: the kerb fading into the terrain', uo + 0.5, (r) => near(r.input, 0.08) && near(r.plane, 0.22)],
    ['well off the edge: terrain only', uo + 2, (r) => near(r.input, 0) && near(r.plane, 0.3)],
    ['left side mirrors the right', -(eA + 0.5), (r) => near(r.input, 0.16) && near(r.plane, 0)],
  ];
  const bad = cases.filter(([, u, ok]) => !ok(g(u))).map(([n, u]) => `${n}: ${JSON.stringify(g(u))}`);
  check('wheel ground: kerb step 0 on the carriageway, the kerb on the pavement, blended at the edge, faded off it', bad.length === 0, bad.join(' | ') || `${cases.length} cases`);

  const island = { ...kerbRoute, medHalf: () => 1.3, div: () => 1, surfaceY: (s, u) => 2 + 0.03 * u };
  const gm = (u) => wheelGround(island, road, { y: island.surfaceY(100, u) + (Math.abs(u) < 1.3 ? 0.2 : 0) }, 100, u);
  const medianCases = [1.1, 1.245, 1.3, 1.355, 1.5];
  const expected = [0.2, 0.16875, 0.1, 0.03125, 0];
  check('median island: both tyre-width edges blend onto a banked road plane',
    medianCases.every((u, i) => [u, -u].every((x) => near(gm(x).input, expected[i]) && near(gm(x).plane, island.surfaceY(100, x)))),
    medianCases.map((u) => `${u}: ${gm(u).input.toFixed(3)} m`).join(', '));

  const circuit = { ...kerbRoute, closed: true, wrap: (s) => (s + 1000) % 1000, surfaceY: (s, u) => 0.02 * u };
  const gc = (u, surf, rise) => wheelGround(circuit, road, { y: circuit.surfaceY(0, u) + rise, surf }, -1, u);
  check('circuit: rounded kerbs use their sampled profile without adding an urban kerb or moving the plane',
    [3.6, 3.8, 4].every((u) => near(gc(u, 'pavement', 0.045).input, 0.045) && near(gc(u, 'pavement', 0.045).plane, 0.02 * u)) &&
    near(gc(5, 'gravel', 0.2).input, 0) && near(gc(5, 'gravel', 0.2).plane, 0.3) &&
    gc(7, 'asphalt', 0.5).paved && near(gc(7, 'asphalt', 0.5).plane, 0.64));

  // Exercise real Ground.at()/resolve(), stubbing only rendering imports. ROAD's production definition is
  // extracted unchanged so these checks follow actual gutter/kerb dimensions rather than another copy of them.
  const { readFileSync } = await import('node:fs');
  const { register } = await import('node:module');
  const roadSource = readFileSync(new URL('../../src/road.js', import.meta.url), 'utf8');
  const start = roadSource.indexOf('export const ROAD =');
  const roadURL = 'data:text/javascript,' + encodeURIComponent(
    `import { lerp, smoothstep } from ${JSON.stringify(new URL('../../src/util.js', import.meta.url).href)};\n` +
    roadSource.slice(start, roadSource.indexOf('\n};', start) + 3));
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/src/ground.js')) {
      if (spec === './road.js') return { url: ${JSON.stringify(roadURL)}, shortCircuit: true };
      if (spec === './tex.js') return { url: 'data:text/javascript,export const TX={};', shortCircuit: true };
    }
    return next(spec, ctx);
  }`), import.meta.url);
  const { Ground } = await import('../../src/ground.js');
  const { ROAD } = await import(roadURL);
  const r = { ...route, length: 1000, closed: false, edge: () => 3.5, medHalf: () => 1.3, div: () => 1,
    seaR: () => 1000, seaL: () => 1000, bank: () => 0 };
  const ground = Object.assign(Object.create(Ground.prototype), { route: r, out: {}, heightC: () => 0,
    terrain: { cls: () => 4 }, traps: [], hump: () => 0, walls: () => null,
    limits: (s, w, out) => Object.assign(out, { min: -100, max: 100 }) });
  const spec = CARS.find((c) => c.id === 'z4'), v = new Vehicle(spec, r);
  v.ground = ground; v.roadZ = () => 0;
  const place = (u) => { v.reset(100, u); ground.resolve(v, 1 / 60); for (let i = 0; i < 180; i++) v.update(1 / 60, { throttle: 0, brake: 0, steer: 0 }); };
  place(ROAD.gutter + r.edge(100) - v.track / 2 + 0.4);
  check('Ground: astride a kerb lifts only the hit wheels through suspension, without moving the body plane',
    near(v.y, 0) && v.wheelBump[0] === 0 && v.wheelBump[2] === 0 && v.corners[1].zu > 0.12 && v.corners[3].zu > 0.12 && !v.air);
  place(ROAD.gutter + r.edge(100) + v.track / 2 + 0.4);
  check('Ground: all four wheels on pavement count the kerb height once, with the body still on the base plane',
    near(v.y, 0) && near(v.sus.z, 0.17, 0.015) && v.corners.every((c) => c.zu > 0.14 && c.zu < 0.2) && !v.air,
    `plane ${f2(v.y)} m, body rise ${f2(v.sus.z)} m`);
  place(0);
  check('Ground: the median lifts all four wheels by its actual height without a second rigid body lift',
    near(v.y, 0) && near(v.sus.z, 0.2, 0.01) && v.corners.every((c) => near(c.zu, 0.2, 0.01)) && !v.air);
}

// ------------------------------------------------------------------ 1. at rest
for (const spec of list) {
  const v = new Vehicle(spec, route); v.reset(0, 0, 0);
  let drift = 0;
  for (let i = 0; i < 180; i++) { v.update(1 / 60, { throttle: 0, brake: 0, steer: 0 }); if (i > 60) drift = Math.max(drift, Math.abs(v.sus.zv), Math.abs(v.sus.thv), Math.abs(v.sus.phv)); }
  const sum = v.corners.reduce((a, c) => a + c.Fz, 0);
  check(`${spec.id}: at rest the tyre loads carry the car's weight and nothing moves`, Math.abs(sum / (v.m * G) - 1) < 0.02 && drift < 1e-3, `sum ${f2(sum / (v.m * G))} mg, body speed ${drift.toExponential(1)}`);
}

// ------------------------------------------------------------------ 1b. smooth road: no chatter
for (const spec of list) {
  for (const flat of [true, false]) {
  const out = [];
  for (const kmh of [50, 100, 150]) {
    // each tyre's load over time against its own mean (its static share differs: a 911 carries 61% on the rear)
    // (texture only: the road's expansion joints and manhole covers are real bumps, not chatter)
    // chatter is the high-frequency part: each tyre's load minus its own 0.25 s moving average (the body bobbing on
    // the road's long undulations at ~1-2 Hz is ride, not chatter), sampled at 240 Hz
    const v = new Vehicle(spec, route); v.reset(0, 0, kmh / 3.6); v.roadEvents = false; if (flat) v.roadZ = () => 0; const hist = [[], [], [], []];
    for (let i = 0; i < 960; i++) { v.update(1 / 240, { throttle: 0.3, brake: 0, steer: 0 }); v.vLong = kmh / 3.6; if (i > 240) v.corners.forEach((c, j) => hist[j].push(c.Fz)); }
    const sd = Math.max(...hist.map((h) => { let sq = 0, n = 0, mean = 0; for (let k = 30; k < h.length - 30; k++) { let ma = 0; for (let q = k - 30; q <= k + 30; q++) ma += h[q]; ma /= 61; sq += (h[k] - ma) ** 2; mean += h[k]; n++; } return Math.sqrt(sq / n) / (mean / n); }));
    out.push(`${kmh} km/h sd ${(sd * 100).toFixed(1)}%`);
  }
  const worst = Math.max(...out.map((o) => +o.match(/sd ([0-9.]+)/)[1]));
  // a flat road: the model itself must not chatter; the textured road: within a good road's dynamic load (~5-10%)
  if (flat) check(`${spec.id}: on a perfectly flat road the tyre loads are still (no numerical chatter)`, worst < 1, out.join(' | '));
  else check(`${spec.id}: on smooth asphalt the tyre load swing stays within a good road's (<10%)`, worst < 10, out.join(' | '));
  }
}

// ------------------------------------------------------------------ 1c. reset / respawn onto raised or uneven ground: no jolt
for (const spec of list.slice(0, 2)) {
  for (const [name, bump] of [['a 16 cm median island', [0.16, 0.16, 0.16, 0.16]], ['astride a kerb', [0, 0.16, 0, 0.16]]]) {
    const v = new Vehicle(spec, route); v.reset(0, 0, 0); v.wheelBump = bump.slice();
    let worst = 0, sp = 0;
    for (let i = 0; i < 30; i++) { v.update(1 / 60, { throttle: 0, brake: 0, steer: 0 }); v.corners.forEach((c, j) => { worst = Math.max(worst, Math.abs(c.Fz / v.Ft0[j] - 1)); }); sp = Math.max(sp, Math.abs(v.sus.zv), Math.abs(v.sus.phv)); }
    check(`${spec.id}: reset onto ${name} settles the car there, no jolt`, worst < 0.2 && sp < 0.05, `worst tyre load ${(worst * 100).toFixed(0)}% off static, body rate ${sp.toFixed(3)}`);
  }
}

// ------------------------------------------------------------------ 2. kerb strike: a thump, then settled
for (const spec of list) {
  const { tr, finite, v } = kerbRun(spec, 50, 0.12);
  // the kerb's own effect: subtract the same run without it (the road's long undulations move the body too)
  const base = kerbRun(spec, 50, 0).tr;
  tr.forEach((p, i) => { const b = base[i] || base[base.length - 1]; p.z -= b.z; p.ph -= b.ph; p.th -= b.th; });
  const on = tr.find((p) => p.s > 30 - v.a)?.t ?? 0;           // front wheel hits the kerb (wheel at s + a)
  const peak = Math.max(...tr.filter((p) => p.t > on - 0.05 && p.t < on + 0.4).map((p) => Math.abs(p.acc)));
  // half a second after the rear wheel has climbed on (steady on the kerb): the body has settled (no ringing)
  const rearOn = tr.find((p) => p.s > 30 + v.b)?.t ?? on;      // rear wheel climbs (wheel at s - b)
  const after = tr.filter((p) => p.t > rearOn + 0.5 && p.t < rearOn + 1.2), last = after[after.length - 1];
  // settled: the body sits within 3 mm / 0.2 deg of where it ends up on the kerb (no ringing)
  const resid = Math.max(...after.map((p) => Math.abs(p.z - last.z)));
  const travel = Math.max(...tr.map((p) => Math.abs(p.z)));
  const residRoll = Math.max(...after.map((p) => Math.abs(p.ph - last.ph))) * D;
  // the kerb side's tyres never go fully light (no hop) and the body rolls away from the kerb
  // a wheel may skip for a moment off a 12 cm kerb at 50 km/h (a real one does), but not chatter: total time any tyre
  // is unloaded stays short
  const light = tr.filter((p) => p.t > on && p.t < rearOn + 1 && Math.min(...p.Fz) < 50).length * (tr[1].t - tr[0].t);
  const roll = tr[tr.findIndex((p) => p.t > rearOn + 0.5)].ph;
  check(`${spec.id}: kerb strike 12 cm @ 50 km/h: one thump, bounded, settled in 0.5 s, no hop`,
    finite && peak < 2.2 * G && peak > 0.2 * G && resid < 0.07 * travel && residRoll < 0.2 && light < 0.15 && roll > 0.005,
    `peak ${f2(peak / G)} g, after 0.5 s: heave within ${(resid * 1000).toFixed(1)} mm of ${(travel * 1000).toFixed(0)} mm roll within ${residRoll.toFixed(2)} deg, tyres unloaded ${(light * 1000).toFixed(0)} ms, roll on kerb ${(roll * D).toFixed(1)} deg`);
}

// ------------------------------------------------------------------ 3. kerb strike is frame-rate independent
{
  const spec = list[0], peaks = [];
  for (const fdt of [1 / 30, 1 / 60, 1 / 144]) { const { tr } = kerbRun(spec, 50, 0.12, fdt); peaks.push(Math.max(...tr.map((p) => Math.abs(p.z)))); }
  const spread = (Math.max(...peaks) - Math.min(...peaks)) / Math.max(...peaks);
  check(`${spec.id}: kerb strike body travel agrees at 30 / 60 / 144 Hz frames`, spread < 0.1, peaks.map((p) => (p * 1000).toFixed(1) + ' mm').join(' / '));
}

// ------------------------------------------------------------------ 4. roll gradient in a steady corner
for (const spec of list) {
  const v = new Vehicle(spec, route); v.reset(0, 0, 60 / 3.6); v.steerAssist = 0;
  for (let i = 0; i < 240; i++) { v.update(1 / 60, { throttle: 0.3, brake: 0, steer: 0.12 }); }
  const ayg = Math.abs(v.ay) / G, rollPerG = Math.abs(v.sus.ph) * D / Math.max(0.05, ayg);
  check(`${spec.id}: roll gradient in a steady corner matches the set-up`, Math.abs(rollPerG / v.rollGradEff - 1) < 0.2, `${f2(rollPerG)} deg/g at ${f2(ayg)} g (set ${f2(v.rollGradEff)})`);
}

// ------------------------------------------------------------------ 5. handling balance per car
for (const spec of list) {
  const sk = skidpad(spec), v = new Vehicle(spec, route);
  const front = spec.frontW ?? 0.55;
  check(`${spec.id}: understeer gradient is a road car's (0.2-5 deg/g, more for a nose-heavy car)`, sk.K > 0.2 && sk.K < 5 && (front < 0.45 || sk.K > 0.7), `${f2(sk.K)} deg/g, frontW ${front}`);
  // keyboard full lock on part throttle: the fronts at (not past) their peak, no plough, no spin
  const fl = [60, 100].map((k) => fullLock(spec, k));
  check(`${spec.id}: full keyboard lock uses the front tyres' peak (no plough) and stays on its line`, fl.every((r) => r.f > 0.85 && r.f < 1.15 && r.r < 1.0 && r.ay > 0.85 * sk.maxG), fl.map((r) => `${r.kmh.toFixed(0)} km/h ${f2(r.ay)} g front ${f2(r.f)} rear ${f2(r.r)}`).join(' | '));
  // capability API vs what the sim achieves
  // what the sim sustains: the better of the slow skidpad ramp and full lock at 60 km/h (the assist holds the fronts at
  // their peak there; a low-powered car can't always keep the skidpad ramp's speed up)
  const simG = Math.max(sk.maxG, fl[0].ay), lat = v.maxLatAccel(Math.sqrt(simG * G * 40)) / G;
  check(`${spec.id}: maxLatAccel() matches what the sim sustains within 5%`, Math.abs(lat / simG - 1) < 0.05, `api ${f2(lat)} g, sim ${f2(simG)} g (skidpad ${f2(sk.maxG)}, full lock ${f2(fl[0].ay)})`);
  const b = new Vehicle(spec, route); b.reset(0, 0, 100 / 3.6); const z0 = b.z;
  for (let i = 0; i < 900 && b.kmh > 0.3; i++) b.update(1 / 60, { throttle: 0, brake: 1, steer: 0 });
  const dist = Math.abs(b.z - z0), simDec = (100 / 3.6) ** 2 / (2 * dist);
  const apiDec = [5, 10, 15, 20, 25].reduce((a, s) => a + v.maxBrakeDecel(s), 0) / 5;
  check(`${spec.id}: maxBrakeDecel() matches a straight-line stop within 5%`, Math.abs(apiDec / simDec - 1) < 0.05, `api ${f2(apiDec / G)} g, sim ${f2(simDec / G)} g (100-0 in ${dist.toFixed(1)} m)`);
}

// ------------------------------------------------------------------ 5b. steerInputFor(): the AI's inverse mapping holds a circle
for (const spec of list) {
  const v = new Vehicle(spec, route); v.reset(0, 0, 50 / 3.6); let I = 0.3;
  for (let i = 0; i < 360; i++) { const ev = 50 / 3.6 - spd(v); I = Math.max(0, Math.min(0.8, I + ev * 0.01)); v.update(1 / 60, { throttle: Math.max(0, Math.min(1, I + ev * 0.5)), brake: 0, steer: v.steerInputFor(1 / 60) }); }
  const R = spd(v) / Math.max(1e-3, Math.abs(v.w));
  check(`${spec.id}: steerInputFor(1/60 m) holds a 60 m circle open-loop within 15%`, Math.abs(R / 60 - 1) < 0.15, `R ${R.toFixed(1)} m at ${(spd(v) * 3.6).toFixed(0)} km/h, ${f2(Math.abs(v.ay) / G)} g`);
}

// ------------------------------------------------------------------ 5c. grade follows the heading (driving the route backwards)
{
  const spec = list[0], hill = { ...route, GR: null, lin: () => 0.1 };      // the route climbs 10% in its direction
  const run = (back) => { const v = new Vehicle(spec, hill); v.reset(100, 0, 15); if (back) { v.yaw += Math.PI; v.syncWheels(); } const v0 = v.vLong; for (let i = 0; i < 30; i++) v.update(1 / 60, { throttle: 0, brake: 0, steer: 0 }); return v.vLong - v0; };
  const up = run(false), down = run(true);
  // (gravity's share: 2 g grade t = 0.98 m/s between the two, whatever the car's own losses)
  check('grade follows the heading: coasting along a climbing route slows, the other way speeds up by 2 g grade t more', up < -0.3 && Math.abs(down - up - 2 * G * 0.1 * 0.5) < 0.15, `dv along ${f2(up)} m/s, against ${f2(down)} m/s over 0.5 s`);
}

// ------------------------------------------------------------------ 6. Z4: playful but catchable
if (!only || only === 'z4') {
  const spec = CARS.find((c) => c.id === 'z4');
  if (spec) {
    // corner exit: steady at ~0.7 g on a 50 m radius, then floor it holding the same input: the tail moves, the aids
    // (and the steering assist) keep it a slide you can drive, not a spin
    const v = new Vehicle(spec, route); v.reset(0, 0, 60 / 3.6); let s = 0.3, I = 0.3;
    for (let i = 0; i < 300; i++) { const e = 1 / 50 - v.w / Math.max(1, spd(v)); s = Math.max(-1, Math.min(1, s + e * 0.2)); const ev = 60 / 3.6 - spd(v); I = Math.max(0, Math.min(0.8, I + ev * 0.01)); v.update(1 / 60, { throttle: Math.max(0, Math.min(1, I + ev * 0.5)), brake: 0, steer: s }); }
    let bMax = 0; for (let i = 0; i < 150; i++) { v.update(1 / 60, { throttle: 1, brake: 0, steer: s }); bMax = Math.max(bMax, Math.abs(Math.atan2(v.vLat, Math.abs(v.vLong))) * D); }
    check('z4: floored corner exit rotates the tail a little, and it stays a catchable slide (1-20 deg)', bMax > 1 && bMax < 20, `peak sideslip ${f2(bMax)} deg`);
    // deliberate power-over with intent (held full lock + full throttle) still becomes a drift
    const p = new Vehicle(spec, route); p.reset(0, 0, 45 / 3.6);
    for (let i = 0; i < 60; i++) p.update(1 / 60, { throttle: 0.3, brake: 0, steer: 0.55 });
    let pb = 0; for (let i = 0; i < 90; i++) { p.update(1 / 60, { throttle: 1, brake: 0, steer: 1 }); pb = Math.max(pb, Math.abs(Math.atan2(p.vLat, Math.abs(p.vLong))) * D); }
    check('z4: deliberate power-over (full lock + full throttle, held) breaks the rear into a slide', pb > 12, `peak sideslip ${f2(pb)} deg, latch ${f2(p.driftLatch)}`);
  }
}

// ------------------------------------------------------------------ 7. steering assist settings
{
  const spec = list[0];
  const run = (A) => { const v = new Vehicle(spec, route); v.reset(0, 0, 100 / 3.6); v.steerAssist = A; let I = 0.3, f = 0, n = 0; for (let i = 0; i < 240; i++) { const ev = 100 / 3.6 - spd(v); I = Math.max(0, Math.min(0.5, I + ev * 0.01)); v.update(1 / 60, { throttle: Math.min(0.5, Math.max(0, I + ev * 0.5)), brake: 0, steer: 1 }); if (i > 150) { f += Math.abs(v.wheel[0].sy); n++; } } return f / n; };
  const full = run(1), light = run(0.35), off = run(0);
  check(`${spec.id}: steering assist full / light / off: full caps the fronts at peak, off lets you over-drive them`, full < 1.1 && off > full + 0.3 && light > full && light < off, `front slip full ${f2(full)} light ${f2(light)} off ${f2(off)}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
