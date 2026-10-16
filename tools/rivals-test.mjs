// Real Vehicle integration, real Riviera geometry, deterministic field/reference comparison.
// node --import ./tools/physics-test/register.mjs tools/rivals-test.mjs [--baseline] [--proof | --proof-only]
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
// The normal physics harness deliberately disables walls. Restore the production
// limits here so clean completion cannot accidentally pass through a barrier.
const limitsSource = `export const ROAD = { limits(route, s, out) {
  const outer = route.edge(s) + 0.55 + (route.urban(s) > 0.5 ? 0 : 1.1);
  out.max = outer; out.min = -outer;
  if (route.div(s) > 0.45) {
    // Production uses ground.resolve for either carriageway; mirror its median
    // barrier for reverse fixtures in Vehicle's simpler headless road resolver.
    if (route._testDirection < 0) out.max = -route.medHalf(s);
    else out.min = route.medHalf(s);
  }
  return out;
} };`;
const limitsURL = 'data:text/javascript,' + encodeURIComponent(limitsSource);
const hookSource = `const road = ${JSON.stringify(limitsURL)};
export async function resolve(spec, ctx, next) {
  if (spec === './road.js' && /physics[^/]*\\.js$/.test(ctx.parentURL || '')) return { url: road, shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hookSource), import.meta.url);
const physicsURL = new URL(process.env.PHYS || '../src/physics.js', import.meta.url);
const { Vehicle } = await import(physicsURL.href);
const { Route } = await import('../src/map.js');
const { RIVIERA_TUNNELS } = await import('../src/maps/riviera-tunnels.js');
const EV = await import('../src/events.js');
const { DRIVERS } = EV;
const { clamp, damp, smoothstep } = await import('../src/util.js');

const root = new URL('../', import.meta.url), artifacts = new URL('.scratch/rivals/', root);
mkdirSync(artifacts, { recursive: true });
const baseline = process.argv.includes('--baseline');
const proofOnly = process.argv.includes('--proof-only');
const proof = process.argv.includes('--proof') || proofOnly;
const allSprints = process.argv.includes('--all-sprints');
const prefix = process.env.RIVAL_PROOF_LABEL || (baseline ? 'before' : 'after');
if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid RIVAL_PROOF_LABEL');
const raceDrivers = baseline ? JSON.parse(readFileSync(new URL('baseline-drivers.json', artifacts))) : DRIVERS;
const physicsSource = readFileSync(physicsURL, 'utf8');
const physicsHash = createHash('sha256').update(physicsSource).digest('hex');
writeFileSync(new URL(`${prefix}-physics.js`, artifacts), physicsSource);
const data = JSON.parse(readFileSync(new URL('data/map.json', root)));
function makeRoute(map) {
  const r = new Route(map.route, { corridors: map.route.from === 'Vouliagmeni' ? RIVIERA_TUNNELS : [] });
  r.urban = (s) => {
    let urban = map.zones[0].urban;
    for (let i = 1; i < map.zones.length; i++) urban += (map.zones[i].urban - map.zones[i - 1].urban) * smoothstep(map.zones[i].s - 120, map.zones[i].s + 130, s);
    return urban;
  };
  return r;
}
let route = makeRoute(data);
const catalogueSource = readFileSync(new URL('src/cars.js', root), 'utf8');
const catalogue = Function('return ' + catalogueSource.slice(catalogueSource.indexOf('export const CARS = [') + 'export const CARS = '.length).split('\n];')[0] + '\n];')();
const carsHash = createHash('sha256').update(JSON.stringify(catalogue)).digest('hex');
writeFileSync(new URL(`${prefix}-cars.json`, artifacts), JSON.stringify(catalogue, null, 2) + '\n');
const defaultSpec = catalogue.find((c) => c.id === (process.env.RIVAL_CAR || 'z4'));
if (!defaultSpec) throw new Error('Unknown RIVAL_CAR');
let spec = defaultSpec;
const eventSpec = (carId) => process.env.RIVAL_CAR ? defaultSpec : catalogue.find((c) => c.id === carId) || defaultSpec;
const dt = 1 / 60;
let module;
if (!baseline) module = await import('../src/rival-ai.js');
const controllerSource = readFileSync(baseline ? new URL('baseline-ai.js', artifacts) : new URL('src/rival-ai.js', root), 'utf8');
const controllerHash = createHash('sha256').update(controllerSource).digest('hex');
writeFileSync(new URL(`${prefix}-controller.js`, artifacts), controllerSource);
const vehicles = [];
let legacy;
if (baseline) {
  const source = readFileSync(new URL('baseline-ai.js', artifacts), 'utf8');
  const laneInfoDir = (u, from, to, halfW, s, dir) => {
    let gap = 1e9, v = 0;
    for (const record of vehicles) {
      const ob = record.veh, distance = (ob.s - s) * dir - from;
      if (distance < -ob.halfL || distance > to - from || Math.abs(ob.u - u) > ob.halfW + halfW + 0.35) continue;
      if (distance - ob.halfL < gap) { gap = distance - ob.halfL; v = ob.vLong; }
    }
    return { gap, v };
  };
  const G = { state: 'race', autodrive: false };
  const legacyRoute = new Proxy({}, { get: (_, key) => typeof route[key] === 'function' ? route[key].bind(route) : route[key] });
  legacy = Function('route', 'clamp', 'damp', 'laneInfoDir', 'signals', 'G', 'player', 'placeVeh', 'decideRun', source + '\nreturn aiInput;')(
    legacyRoute, clamp, damp, laneInfoDir, null, G, {}, (veh, s, u, dir) => { veh.reset(s, u); if (dir < 0) veh.yaw += Math.PI; }, () => false);
}

function make(s, u, driver = DRIVERS[0], perfect = false, speed = 0, dir = 1, closedRoad = false) {
  const veh = new Vehicle({ ...spec }, route); veh.reset(s, u, speed);
  if (dir < 0) veh.yaw += Math.PI;
  veh.nitro = 0; // isolate driving skill; neither baseline nor reference gets a bottle advantage
  const reset = veh.reset.bind(veh);
  veh._testResets = 0;
  veh.reset = (...args) => { veh._testResets++; return reset(...args); };
  const record = { veh, drv: driver, ai: { lane: 0, cool: 0, u, nitroOk: false }, finish: null, dir, lapTimes: [], lastLapTime: 0 };
  if (!baseline) record.controller = new module.RivalAI(route, veh, { driver, perfect, dir, closedRoad });
  return record;
}

// Full oriented body overlap: route-space proximity alone is insufficient on bends.
function contact(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.hypot(dx, dz) > a.halfL + b.halfL + a.halfW + b.halfW) return false;
  const axes = (v) => [[-Math.sin(v.yaw), -Math.cos(v.yaw)], [Math.cos(v.yaw), -Math.sin(v.yaw)]];
  const A = axes(a), B = axes(b);
  for (const axis of [...A, ...B]) {
    const radius = (v, vs) => Math.abs(axis[0] * vs[0][0] + axis[1] * vs[0][1]) * v.halfL + Math.abs(axis[0] * vs[1][0] + axis[1] * vs[1][1]) * v.halfW;
    if (Math.abs(dx * axis[0] + dz * axis[1]) >= radius(a, A) + radius(b, B)) return false;
  }
  return true;
}

// Check the actual rotated body, projecting every corner onto the local road.
// Center u + halfW misses the nose/tail sweeping out of the asphalt on bends.
function offroadCorner(v) {
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  for (const longitudinal of [-v.halfL, v.halfL]) for (const lateral of [-v.halfW, v.halfW]) {
    const x = v.x + fx * longitudinal + rx * lateral;
    const z = v.z + fz * longitudinal + rz * lateral;
    const p = route.project(x, z, v.s, 6), edge = route.edge(p.s);
    if (Math.abs(p.u) > edge + 0.02) return { s: p.s, u: p.u, edge, longitudinal, lateral, excess: Math.abs(p.u) - edge };
  }
  return null;
}

function runRace(name, s0, finish, perfect = false, drivers = raceDrivers, referenceStartSlot = 0, closedRoad = false) {
  const dir = finish >= s0 ? 1 : -1;
  route._testDirection = dir;
  const cols = route.closed ? 2 : Math.min(2, route.lanes(s0));
  const gridU = (s, i) => route.closed ? (i % 2 ? 1 : -1) * Math.min(2.25, Math.max(0.5, route.edge(s) - 1.2)) : dir * route.laneU(s, Math.min(i % cols, route.lanes(s) - 1));
  const gridS = (i) => s0 - dir * (4 + Math.floor(i / cols) * 8);
  const racers = perfect ? [make(gridS(referenceStartSlot), gridU(gridS(referenceStartSlot), referenceStartSlot), drivers[referenceStartSlot], true, 0, dir, closedRoad)] : drivers.slice(0, 3).map((driver, i) => make(gridS(i), gridU(gridS(i), i), driver, false, 0, dir, closedRoad));
  const starts = racers.map((c) => ({ s: c.veh.s, u: c.veh.u }));
  let offroadFrames = 0, wallFrames = 0, pairContacts = 0, maxStall = 0;
  const anomalies = { offroad: [], wall: [], contact: [] };
  const anomaly = (kind, t, i, c, extra = {}) => {
    const arr = anomalies[kind], v = c.veh;
    if (arr.length < 10 && (!arr.length || Math.abs(v.s - arr.at(-1).s) > 15 || t - arr.at(-1).t > 1)) arr.push({ t: +t.toFixed(3), i, s: +v.s.toFixed(3), u: +v.u.toFixed(3), speed: +v.vLong.toFixed(3), yaw: v.yaw, steer: v.steer, vLat: v.vLat, beta: Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong))), w: v.w, ay: v.ay, driftLatch: v.driftLatch, rearSN: v.corners?.slice(2).map((c) => c.sN), input: c.lastInput, yawI: c.controller?.yawI ?? null, lineU: c.controller ? c.controller.line.sample(c.controller.line.u, v.s) : null, debug: c.controller?.debug ?? null, ...extra });
  };
  const stalls = racers.map(() => 0), maxUs = racers.map(() => 0), samples = [];
  const trace = perfect && process.argv.includes('--trace') ? [] : null;
  for (let step = 0; step < 60 * 900; step++) {
    const t = (step + 1) * dt;
    // Snapshot inputs before moving any member of the field, like one shared world timestep.
    const inputs = racers.map((c) => {
      if (c.finish !== null) return null;
      if (baseline) { vehicles.length = 0; return legacy(c, dt, c.drv.pace, racers.filter((r) => r !== c)); }
      return c.controller.update(dt, { racers: racers.filter((r) => r !== c && r.finish === null), traffic: [], pace: 1 });
    });
    for (let i = 0; i < racers.length; i++) {
      const c = racers[i], v = c.veh;
      if (!inputs[i]) continue;
      c.lastInput = inputs[i];
      v.wallHit = 0;
      v.update(dt, inputs[i]);
      if (![v.s, v.u, v.x, v.z, v.vLong, v.yaw].every(Number.isFinite)) throw new Error(`${name} nonfinite vehicle state`);
      const corner = offroadCorner(v);
      if (corner) { offroadFrames++; anomaly('offroad', t, i, c, { corner }); }
      if (v.wallHit > 0.01) { wallFrames++; anomaly('wall', t, i, c, { wallHit: v.wallHit }); }
      maxUs[i] = Math.max(maxUs[i], Math.abs(v.u));
      stalls[i] = t > 5 && v.vLong < 1 ? stalls[i] + dt : 0;
      maxStall = Math.max(maxStall, stalls[i]);
      if (route.closed) while (c.lapTimes.length < 3 && v.s >= s0 + (c.lapTimes.length + 1) * route.length) {
        c.lapTimes.push(t - c.lastLapTime); c.lastLapTime = t;
      }
      if ((v.s - finish) * dir >= 0) c.finish = t;
    }
    if (!perfect) for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) if (racers[i].finish === null && racers[j].finish === null && contact(racers[i].veh, racers[j].veh)) { pairContacts++; anomaly('contact', t, i, racers[i], { other: j, otherS: racers[j].veh.s, otherU: racers[j].veh.u }); }
    if (step % 60 === 0) samples.push({ t: +t.toFixed(3), cars: racers.map((c) => ({ s: +c.veh.s.toFixed(3), u: +c.veh.u.toFixed(3), v: +c.veh.vLong.toFixed(3) })) });
    if (trace && step % 2 === 0) {
      const c = racers[0], v = c.veh;
      trace.push({ t, s: v.s, u: v.u, vLong: v.vLong, vLat: v.vLat, yaw: v.yaw, w: v.w, steer: v.steer, beta: Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong))), ay: v.ay, driftLatch: v.driftLatch, corners: v.corners.map((c) => ({ sN: c.sN, sy: c.sy, sx: c.sx, Fz: c.Fz })), input: c.lastInput, debug: c.controller.debug });
    }
    if (racers.every((c) => c.finish !== null)) break;
  }
  const result = { name, dir, closedRoad, perfect, referenceStartSlot: perfect ? referenceStartSlot : undefined, starts, car: spec.id, carSpec: JSON.parse(JSON.stringify(spec)), drivers: racers.map((c) => c.drv.id), length: Math.abs(finish - s0), times: racers.map((c) => c.finish), lapTimes: route.closed ? racers.map((c) => c.lapTimes) : undefined, offroadFrames, wallFrames, pairContacts, teleports: racers.reduce((n, c) => n + c.veh._testResets, 0), maxStall: +maxStall.toFixed(3), finalS: racers.map((c) => +c.veh.s.toFixed(1)), maxUs, anomalies };
  writeFileSync(new URL(`${prefix}-${name}${perfect ? '-reference' + (referenceStartSlot ? `-slot-${referenceStartSlot}` : '') : ''}-trajectory.json`, artifacts), JSON.stringify(samples));
  if (trace) writeFileSync(new URL(`${name}-reference-trace.json`, artifacts), JSON.stringify(trace));
  console.log(JSON.stringify(result));
  return result;
}

const allSegments = allSprints ? [...EV.EVENTS.filter((e) => e.type === 'sprint'), EV.QUICK_RACE].map((def) => {
  const r = EV.resolve(def, { route, marks: data.marks });
  const drivers = EV.gridFor(def).map((d) => baseline ? raceDrivers.find((old) => old.id === d.id) || d : d);
  return [def.id, r.s0, r.s1, drivers, def.traffic === 0, def.car];
}) : [ ['riviera', route.start, route.finish, raceDrivers], ['astir-varkiza', data.marks.find((m) => m.id === 'astir').s, data.marks.find((m) => m.id === 'varkiza').s, raceDrivers] ];
if (process.env.RIVAL_SEGMENT && !['megara', 'penteli-race', 'psychiko-race'].includes(process.env.RIVAL_SEGMENT) && !allSegments.some(([name]) => name === process.env.RIVAL_SEGMENT)) throw new Error('Unknown RIVAL_SEGMENT');
const segments = proofOnly ? [] : allSegments.filter(([name]) => !process.env.RIVAL_SEGMENT || name === process.env.RIVAL_SEGMENT);
const results = [], failures = [];
for (const [name, s0, finish, drivers, closedRoad = false, carId] of segments) {
  spec = eventSpec(carId);
  const reference = baseline ? null : runRace(name, s0, finish, true, drivers, 0, closedRoad);
  const field = runRace(name, s0, finish, false, drivers, 0, closedRoad);
  const gridReferences = baseline ? [] : [reference, ...[1, 2].map((slot) => runRace(name, s0, finish, true, drivers, slot, closedRoad))];
  evaluate(name, reference, field, gridReferences);
}
spec = defaultSpec;
const megaraPath = new URL('data/maps/megara/map.json', root);
if (!baseline && !proofOnly && (!process.env.RIVAL_SEGMENT || process.env.RIVAL_SEGMENT === 'megara')) {
  if (!existsSync(megaraPath)) throw new Error('Megara map missing');
  const riviera = route;
  route = makeRoute(JSON.parse(readFileSync(megaraPath)));
  if (!route.closed) throw new Error('Megara must be a periodic route');
  const reference = runRace('megara', 0, route.length * 3, true, raceDrivers, 0, true);
  const field = runRace('megara', 0, route.length * 3, false, raceDrivers, 0, true);
  const gridReferences = [reference, ...[1, 2].map((slot) => runRace('megara', 0, route.length * 3, true, raceDrivers, slot, true))];
  evaluate('megara', reference, field, gridReferences);
  route = riviera;
}
if (allSprints && !proofOnly && (!process.env.RIVAL_SEGMENT || process.env.RIVAL_SEGMENT === 'penteli-race')) {
  const riviera = route, penteli = JSON.parse(readFileSync(new URL('data/maps/penteli/map.json', root)));
  route = makeRoute(penteli);
  for (const def of penteli.events.filter((e) => e.type === 'sprint')) {
    spec = eventSpec(def.car);
    const r = EV.resolve(def, { route, marks: penteli.marks });
    const drivers = EV.gridFor(def).map((d) => baseline ? raceDrivers.find((old) => old.id === d.id) || d : d);
    const reference = baseline ? null : runRace(def.id, r.s0, r.s1, true, drivers, 0, def.traffic === 0);
    const field = runRace(def.id, r.s0, r.s1, false, drivers, 0, def.traffic === 0);
    const gridReferences = baseline ? [] : [reference, ...[1, 2].map((slot) => runRace(def.id, r.s0, r.s1, true, drivers, slot, def.traffic === 0))];
    evaluate(def.id, reference, field, gridReferences);
  }
  route = riviera;
  spec = defaultSpec;
}
if (!baseline && !proofOnly && (!process.env.RIVAL_SEGMENT || process.env.RIVAL_SEGMENT === 'psychiko-race')) {
  const riviera = route, psychiko = JSON.parse(readFileSync(new URL('data/maps/psychiko/map.json', root)));
  route = makeRoute(psychiko);
  for (const def of psychiko.events.filter((e) => e.type === 'sprint')) {
    spec = eventSpec(def.car);
    const r = EV.resolve(def, { route, marks: psychiko.marks });
    const drivers = EV.gridFor(def).map((d) => baseline ? raceDrivers.find((old) => old.id === d.id) || d : d);
    const reference = baseline ? null : runRace(def.id, r.s0, r.s1, true, drivers, 0, def.traffic === 0);
    const field = runRace(def.id, r.s0, r.s1, false, drivers, 0, def.traffic === 0);
    const gridReferences = baseline ? [] : [reference, ...[1, 2].map((slot) => runRace(def.id, r.s0, r.s1, true, drivers, slot, def.traffic === 0))];
    evaluate(def.id, reference, field, gridReferences);
  }
  route = riviera;
  spec = defaultSpec;
}
function evaluate(name, reference, field, gridReferences = []) {
  const poleTotalRatios = reference ? field.times.map((t) => t === null ? null : t / reference.times[0] - 1) : null;
  const referenceTimes = reference ? field.times.map((_, i) => gridReferences[i]?.times[0] ?? reference.times[0]) : null;
  const ratios = reference ? field.times.map((t, i) => t === null ? null : t / referenceTimes[i] - 1) : null;
  const poleLapRatios = reference?.lapTimes ? field.lapTimes.map((laps) => laps.map((t, i) => t / reference.lapTimes[0][i] - 1)) : null;
  const lapRatios = reference?.lapTimes ? field.lapTimes.map((laps, car) => laps.map((t, i) => t / (i === 0 && gridReferences[car] ? gridReferences[car].lapTimes[0][i] : reference.lapTimes[0][i]) - 1)) : null;
  results.push({ ...field, reference: reference?.times[0] ?? null, referenceTimes, referenceLapTimes: reference?.lapTimes?.[0] ?? null, referenceGridLapTimes: gridReferences.map((r) => r.lapTimes?.[0] ?? null), referenceOffroadFrames: reference?.offroadFrames ?? null, referenceWallFrames: reference?.wallFrames ?? null, ratios, poleTotalRatios, lapRatios, poleLapRatios });
  if (!baseline) {
    if (reference.times[0] === null || reference.offroadFrames || reference.wallFrames || reference.teleports || reference.maxStall > 4) failures.push(`${name}: perfect reference failed clean completion`);
    if (field.times.some((t) => t === null)) failures.push(`${name}: field did not finish`);
    if (field.offroadFrames || field.wallFrames || field.pairContacts || field.teleports || field.maxStall > 4) failures.push(`${name}: unsafe field ${JSON.stringify(field)}`);
    // The field is not meant to match a perfect driver: src/rival-ai.js gives the locals a designed pace spread (a driver at
    // pace p needs 1/p - 1 longer than a perfect one), so the gate is 3% or the designed deficit of the slowest entrant + 1.5% for racing each other.
    const tolerance = Math.max(0.03, ...field.drivers.map((id) => 1 / module.driverPersonality(raceDrivers.find((d) => d.id === id)).pace - 1 + 0.015));
    if (ratios.some((ratio) => ratio === null || Math.abs(ratio) > tolerance)) failures.push(`${name}: field outside ${tolerance * 100}% perfect reference ${JSON.stringify(ratios)}`);
    if (lapRatios && (field.lapTimes.some((laps) => laps.length !== Math.round(field.length / route.length)) || lapRatios.some((laps) => laps.some((ratio, i) => !Number.isFinite(ratio) || Math.abs(ratio) > (i === 0 ? tolerance + 0.01 : tolerance))))) failures.push(`${name}: steady laps outside ${(tolerance * 100).toFixed(1)}% perfect reference (first lap ${(tolerance * 100 + 1).toFixed(1)}% for grid launch) ${JSON.stringify(lapRatios)}`);
    if (gridReferences.some((r) => r.offroadFrames || r.wallFrames || r.teleports || r.maxStall > 4 || r.times[0] === null)) failures.push(`${name}: matching-grid perfect reference failed clean completion`);
  }
}
if (!proofOnly) writeFileSync(new URL(`${prefix}-times.json`, artifacts), JSON.stringify({ scope: 'Same stock car per event, forced event car respected unless RIVAL_CAR overrides it; no traffic/signals/nitro/rubberband/scripted legacy mistakes. Real Vehicle physics at60Hz, real barriers mirrored for reverse carriageway. Perfect solo total references match each actual grid s/u; total gate 3% or the designed pace deficit of the slowest entrant + 1.5% (racing each other costs a little more) (src/rival-ai.js driverPersonality), raw poleTotalRatios retained. Circuit launch lap +1% vs matched grid, steady laps the same total gate; raw pole first-lap ratios retained.', physicsPath: physicsURL.pathname, physicsCapturedAt: new Date().toISOString(), physicsHash, controllerHash, carsHash, allSprints, baseline, routeValidation: { passed: baseline ? null : failures.length === 0, mode: baseline ? 'capture-only' : 'assertions', failures }, results }, null, 2) + '\n');
if (proof && !baseline) await createProof();
if (failures.length) { failures.forEach((f) => console.error('FAIL ' + f)); process.exitCode = 1; }
else console.log(proofOnly ? 'PASS: overtake, traffic avoidance, crash recovery scenarios' : `${baseline ? 'BASELINE' : 'PASS'}: ${results.length} routes${baseline ? '' : ', three rivals, clean completion and segment/lap times within the designed pace spread of the perfect reference'}`);

async function createProof() {
  const records = [];
  for (const kind of ['overtake', 'traffic-avoid', 'crash-recovery']) {
    const start = kind === 'traffic-avoid' ? 2320 : 5640;
    const u = route.laneU(start, 0);
    const bot = make(start, u, DRIVERS[0], false, kind === 'crash-recovery' ? 7 : 24);
    const leader = kind === 'overtake' ? make(start + 32, u, DRIVERS[1], true, 12) : null;
    const traffic = kind === 'traffic-avoid' ? [
      { active: true, s: start + 40, u, hs: 2.2, hu: 0.92, v: 11, dir: 1, vs: 11 },
      { active: true, s: start + 230, u: -route.laneU(start + 230, 0), hs: 2.2, hu: 0.92, v: 14, dir: -1, vs: -14 },
    ] : [];
    // Controlled impact fixture: car spun toward the outer barrier, travelling into it.
    // There is no reset, teleport, or other intervention after the controller takes over.
    if (kind === 'crash-recovery') {
      bot.veh.reset(start, route.edge(start) - bot.veh.halfW - 0.03, 7);
      bot.veh.yaw -= 1.8;
      for (let n = 0; n < 24; n++) bot.veh.update(dt, { throttle: 0, brake: 0, steer: 0 });
    }
    bot.veh._testResets = 0; // the impact fixture is setup, all later resets are forbidden
    bot.veh.nitro = 0;
    const state = [], body = bot.veh;
    let pairContacts = 0, offroadFrames = 0, wallFrames = 0, minReverse = 0, minimumClearance = Infinity;
    const initial = { s: body.s, u: body.u, yaw: body.yaw, wallHit: body.wallHit };
    const duration = kind === 'crash-recovery' ? 35 : 18;
    for (let step = 0; step < duration / dt; step++) {
      const t = step * dt;
      const input = bot.controller.update(dt, { racers: leader ? [leader] : [], traffic, pace: 1 });
      if (leader) {
        leader.veh.wallHit = 0;
        leader.veh.update(dt, leader.controller.update(dt, { racers: [], traffic: [], pace: 0.48 }));
        if (offroadCorner(leader.veh)) offroadFrames++;
        if (leader.veh.wallHit > 0.01) wallFrames++;
      }
      for (const c of traffic) c.s += c.vs * dt;
      body.wallHit = 0;
      body.update(dt, input);
      if (offroadCorner(body)) offroadFrames++;
      if (body.wallHit > 0.01) wallFrames++;
      minReverse = Math.min(minReverse, body.vLong);
      const obstacles = [ ...(leader ? [leader.veh] : []), ...traffic.map((c) => {
        const p = route.point(c.s, c.u), f = route.frame(c.s, {});
        return { ...p, s: c.s, u: c.u, halfL: c.hs, halfW: c.hu, yaw: Math.atan2(-f.tx, -f.tz) + (c.dir < 0 ? Math.PI : 0) };
      }) ];
      for (const c of obstacles) {
        if (contact(body, c)) pairContacts++;
        const ds = Math.abs(body.s - c.s) - body.halfL - c.halfL, du = Math.abs(body.u - c.u) - body.halfW - c.halfW;
        minimumClearance = Math.min(minimumClearance, Math.hypot(Math.max(0, ds), Math.max(0, du)));
      }
      if (step % 15 === 0) state.push({ t: +t.toFixed(3), bot: { s: body.s, u: body.u, yaw: body.yaw, v: body.vLong }, obstacles: obstacles.map((v) => ({ s: v.s, u: v.u, yaw: v.yaw, halfL: v.halfL, halfW: v.halfW })), input, debug: bot.controller.dbg ?? bot.controller.debug ?? null });
    }
    const roadYaw = Math.atan2(-route.lin(route.TX, body.s), -route.lin(route.TZ, body.s));
    const finalHeadingError = Math.atan2(Math.sin(body.yaw - roadYaw), Math.cos(body.yaw - roadYaw));
    const rejoined = !offroadCorner(body) && Math.abs(finalHeadingError) < 0.3;
    const result = { kind, initial, duration, pairContacts, offroadFrames, wallFrames, teleports: body._testResets + (leader?.veh._testResets ?? 0), minReverse, minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : null, progress: body.s - initial.s, rejoined, finalHeadingError, passed: leader ? body.s > leader.veh.s + body.halfL + leader.veh.halfL && leader.veh.vLong > 5 : traffic[0] ? body.s > traffic[0].s + body.halfL + traffic[0].hs : body.s > initial.s + 80 && body.vLong > 8 && rejoined };
    result.maneuverComplete = result.passed;
    result.passed = result.maneuverComplete && !pairContacts && !result.teleports && (kind === 'crash-recovery' ? initial.wallHit > 0 : !offroadFrames && !wallFrames);
    result.physicsPath = physicsURL.pathname; result.physicsHash = physicsHash; result.controllerHash = controllerHash; result.carsHash = carsHash; result.carSpec = JSON.parse(JSON.stringify(spec));
    writeFileSync(new URL(`${kind}-trajectory.json`, artifacts), JSON.stringify({ result, state }, null, 2) + '\n');
    writeFileSync(new URL(`${kind}-frames.svg`, artifacts), proofFrames(kind, state));
    records.push(result);
    console.log('PROOF ' + JSON.stringify(result));
    if (!result.passed || pairContacts || result.teleports || (kind !== 'crash-recovery' && (offroadFrames || wallFrames))) failures.push(`${kind}: scenario failed ${JSON.stringify(result)}`);
  }
  writeFileSync(new URL('proof-results.json', artifacts), JSON.stringify(records, null, 2) + '\n');
  const html = `<!doctype html><meta charset="utf-8"><meta name="rival-controller-hash" content="${controllerHash}"><meta name="rival-physics-hash" content="${physicsHash}"><style>body{margin:0;font:14px system-ui;color:var(--foreground,#e6edf4)}article{margin:0 0 24px}h2{font-size:18px}svg{display:block;width:100%}p{color:var(--muted-foreground,#a7b5c5)}</style><p>Actual 60 Hz Vehicle trajectories on Riviera. Green: rival. Orange: slower racer or civilian. Route-space view; lateral distances shown at 3× longitudinal scale.</p>` + records.map((r) => `<article><h2>${r.kind.replaceAll('-', ' ')}</h2><p>Actual Vehicle simulation · ${r.passed ? 'PASS' : 'FAIL'} · ${r.pairContacts} contacts · ${r.offroadFrames} offroad frames · ${r.wallFrames} wall frames · ${r.progress.toFixed(1)} m progress${r.kind === 'crash-recovery' ? ` · ${r.initial.wallHit.toFixed(2)} m/s initial impact · peak reverse ${r.minReverse.toFixed(2)} m/s · no reset after takeover` : ''}</p>${readFileSync(new URL(`${r.kind}-frames.svg`, artifacts), 'utf8')}</article>`).join('');
  writeFileSync(new URL('proof.html', artifacts), html);
}

function proofFrames(kind, states) {
  const crossing = states.find((s) => s.obstacles[0] && s.bot.s > s.obstacles[0].s)?.t ?? 5;
  const oncomingCrossing = states.find((s) => s.obstacles[1] && s.bot.s > s.obstacles[1].s)?.t ?? 7;
  const selected = (kind === 'crash-recovery' ? [0, 2, 5, 9, 16, 28] : kind === 'traffic-avoid' ? [0, Math.max(0, crossing - 2), Math.max(0, crossing - 0.5), crossing + 0.5, oncomingCrossing, 12] : [0, Math.max(0, crossing - 2), Math.max(0, crossing - 0.5), crossing + 0.5, crossing + 2, Math.min(states.at(-1).t, crossing + 6)]).map((t) => Math.min(t, states.at(-1).t)).sort((a, b) => a - b);
  const colors = { bot: '#4ad3ba', obstacle: '#f3ad56' };
  let content = '';
  for (let i = 0; i < selected.length; i++) {
    const state = states.reduce((a, b) => Math.abs(a.t - selected[i]) < Math.abs(b.t - selected[i]) ? a : b);
    const ox = (i % 3) * 320, oy = Math.floor(i / 3) * 330;
    const s0 = state.bot.s, scale = 3;
    const x = (u) => ox + 160 + u * 9, y = (s) => oy + 212 - (s - s0) * scale;
    const sampled = [];
    for (let ds = -28; ds <= 56; ds += 4) sampled.push(s0 + ds);
    const poly = (points) => points.map(([xx, yy]) => `${xx.toFixed(1)},${yy.toFixed(1)}`).join(' ');
    const edges = sampled.map((s) => [x(-route.edge(s)), y(s)]).concat([...sampled].reverse().map((s) => [x(route.edge(s)), y(s)]));
    const clip = `${kind}-panel-${i}`;
    content += `<g><defs><clipPath id="${clip}"><rect x="${ox + 4}" y="${oy + 42}" width="312" height="256"/></clipPath></defs><rect x="${ox + 4}" y="${oy + 4}" width="312" height="322" rx="8" fill="#18222d"/><g clip-path="url(#${clip})"><polygon points="${poly(edges)}" fill="#364250"/>`;
    for (const side of [-1, 1]) content += `<polyline points="${poly(sampled.map((s) => [x(side * route.edge(s)), y(s)]))}" stroke="#afbdc7" stroke-width="1.3" fill="none"/>`;
    if (route.div(s0) > 0.45) {
      const median = sampled.map((s) => [x(-route.medHalf(s)), y(s)]).concat([...sampled].reverse().map((s) => [x(route.medHalf(s)), y(s)]));
      content += `<polygon points="${poly(median)}" fill="#53644b"/>`;
    } else content += `<path d="M ${x(0)} ${oy + 42} V ${oy + 295}" stroke="#dad6a6" stroke-width="1" stroke-dasharray="8 7"/>`;
    const history = states.filter((r) => r.t <= state.t && r.t > state.t - 4);
    content += `<polyline points="${poly(history.map((r) => [x(r.bot.u), y(r.bot.s)]))}" stroke="${colors.bot}" stroke-width="2" fill="none" opacity=".45"/>`;
    for (const [v, color, halfL, halfW] of [ [state.bot, colors.bot, spec.length / 2, spec.width / 2], ...state.obstacles.map((v) => [v, colors.obstacle, v.halfL, v.halfW]) ]) {
      const px = x(v.u), py = y(v.s); if (py < oy + 42 || py > oy + 298) continue;
      const heading = Math.atan2(-route.lin(route.TX, v.s), -route.lin(route.TZ, v.s));
      const angle = (v.yaw - heading) * -180 / Math.PI;
      content += `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${angle.toFixed(1)})"><rect x="${-halfW * 9}" y="${-halfL * scale}" width="${halfW * 18}" height="${halfL * scale * 2}" rx="2" fill="${color}"/><path d="M -4 -2 L 0 -6 L 4 -2" stroke="#112231" fill="none" stroke-width="2"/></g>`;
    }
    content += `</g><text x="${ox + 18}" y="${oy + 28}" fill="#e5edf5" font-size="15">t=${state.t.toFixed(1)} s · ${(state.bot.v * 3.6).toFixed(0)} km/h</text><text x="${ox + 18}" y="${oy + 312}" fill="#b0bcc9" font-size="12">s=${state.bot.s.toFixed(1)} m · u=${state.bot.u.toFixed(2)} m</text></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 660" role="img" aria-label="${kind} actual trajectory frame sequence"><style>text{font-family:Arial,sans-serif}</style>${content}</svg>`;
}
