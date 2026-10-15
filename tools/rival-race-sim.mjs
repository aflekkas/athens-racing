// Scripted headless sprint: the real RivalAI field plus a scripted "player" on
// Riviera (two-way road, light traffic) and Penteli (closed road). Real Vehicle
// physics at 60 Hz with production barriers; logs every position change, pass
// attempt, abort and racer contact so rival racecraft can be compared.
// node --import ./tools/physics-test/register.mjs tools/rival-race-sim.mjs [--map riviera|penteli] [--label before] [--player slow|matched|fast]
// AI=<path to rival-ai.js> compares another controller with the same harness.
// --real-traffic runs the production src/traffic.js civilians (and signals) instead of the scripted lane-keepers and
// reports how long each civilian stood still in the road (tools/headless-traffic.mjs, tools/traffic-race.test.mjs).
// --hour <h> sets the time of day (traffic density), --out <dir> where the .log/.json go, --watch <civilian id> [--wfrom s --wto s] traces one civilian.
import { register } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const limitsSource = `export const ROAD = { limits(route, s, out) {
  const outer = route.edge(s) + 0.55 + (route.urban(s) > 0.5 ? 0 : 1.1);
  out.max = outer; out.min = -outer;
  if (route.div(s) > 0.45) { if (route._testDirection < 0) out.max = -route.medHalf(s); else out.min = route.medHalf(s); }
  return out;
} };`;
const hookSource = `const road = ${JSON.stringify('data:text/javascript,' + encodeURIComponent(limitsSource))};
export async function resolve(spec, ctx, next) {
  if (spec === './road.js' && /physics[^/]*\\.js$/.test(ctx.parentURL || '')) return { url: road, shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hookSource), import.meta.url);
const { Vehicle } = await import('../src/physics.js');
const { Route } = await import('../src/map.js');
const { RIVIERA_TUNNELS } = await import('../src/maps/riviera-tunnels.js');
const EV = await import('../src/events.js');
const { buildWorld } = await import('./headless-traffic.mjs');
const { smoothstep } = await import('../src/util.js');
const { RivalAI } = await import(process.env.AI ? new URL(process.env.AI, 'file://' + process.cwd() + '/').href : '../src/rival-ai.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const mapId = arg('map', 'riviera'), label = arg('label', 'after'), playerMode = arg('player', 'slow');
const traceName = arg('trace', null), traceFrom = +arg('from', 0), traceTo = +arg('to', 1e9);
const rivalsN = +arg('rivals', EV.SP_RIVALS), seconds = +arg('seconds', 900);
const root = new URL('../', import.meta.url), out = arg('out') ? pathToFileURL(resolvePath(arg('out')) + sep) : new URL('.scratch/rival-ai-v2/', root);
mkdirSync(out, { recursive: true });
const data = JSON.parse(readFileSync(new URL(mapId === 'penteli' ? 'data/maps/penteli/map.json' : 'data/map.json', root)));
const route = new Route(data.route, { corridors: mapId === 'riviera' ? RIVIERA_TUNNELS : [] });
route.urban = (s) => {
  let urban = data.zones[0].urban;
  for (let i = 1; i < data.zones.length; i++) urban += (data.zones[i].urban - data.zones[i - 1].urban) * smoothstep(data.zones[i].s - 120, data.zones[i].s + 130, s);
  return urban;
};
const src = readFileSync(new URL('src/cars.js', root), 'utf8');
const CARS = Function('return ' + src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length).split('\n];')[0] + '\n];')();
const def = mapId === 'penteli' ? data.events.find((e) => e.id === 'penteli-race') : EV.QUICK_RACE;
const r = EV.resolve({ ...def, rivals: rivalsN }, { route, marks: data.marks });
const dir = r.dir, closedRoad = def.traffic === 0; route._testDirection = dir;
const drivers = EV.gridFor({ ...def, rivals: rivalsN });
const playerSpec = CARS.find((c) => c.id === (arg('car', 'z4')));
const realTraffic = process.argv.includes('--real-traffic') && !closedRoad;
const dt = 1 / 60, prog = (s) => (s - r.s0) * dir;

// Grid exactly as main.js gridSlot: rivals in front, player in the last slot.
function slot(i) {
  const columns = route.lanes(r.s0) > 1 ? 2 : 1;
  const s = r.s0 - dir * (4 + Math.floor(i / columns) * 8), lane = Math.min(i % 2, route.lanes(s) - 1);
  return { s, u: dir * route.laneU(s, lane) };
}
function make(spec, driver, i, isPlayer) {
  const veh = new Vehicle({ ...spec }, route), g = slot(i);
  veh.reset(g.s, g.u, 0); if (dir < 0) veh.yaw += Math.PI; veh.nitro = spec.nitrous === true ? 0.4 : 0;
  const car = { name: isPlayer ? 'PLAYER' : driver.name, spec: spec.id, veh, isPlayer, finish: null, contacts: 0, wall: 0, offroad: 0, stuckT: 0, maxStuck: 0, attempts: 0, aborts: 0 };
  // The scripted player is a "human" model: a racing line driver whose pace
  // swings by section (good here, ragged there) and who never yields.
  car.ai = new RivalAI(route, veh, { dir, closedRoad, driver: isPlayer ? { id: 'player', racePace: 1, aggression: 0.5, mistakeRate: 0 } : driver });
  return car;
}
const ids = CARS.map((c) => c.id);
// --pole puts the player at the front of the grid (the field must come through).
const pole = process.argv.includes('--pole');
// --ghost: nobody sees anybody (each car's free pace, for reference).
const ghost = process.argv.includes('--ghost');
// --same-car gives every rival the player's car: racecraft without car differences.
const sameCar = process.argv.includes('--same-car');
const field = drivers.map((d, i) => make(sameCar ? playerSpec : CARS.find((c) => c.id === EV.driverCar(d, ids, playerSpec.id)) || CARS[1], d, pole ? i + 1 : i, false));
const player = make(playerSpec, null, pole ? 0 : field.length, true);
const all = [player, ...field];
const basePace = { slow: 0.9, matched: 0.95, fast: 1 }[playerMode] ?? +playerMode;
const playerPace = (s) => basePace * (1 + 0.045 * Math.sin(prog(s) / 520) * (playerMode === 'fast' ? 0 : 1));

// Light constant-speed traffic on two-way roads: same-direction and oncoming.
let traffic = [], world = null, actors = [];
if (realTraffic) {
  world = buildWorld(route, data, { hour: +arg('hour', 15) });
  world.traffic.dir = dir;
  // as main.js aiObstacles(): the civilians themselves plus the road works
  traffic = world.traffic.cars;
}
if (!closedRoad && !realTraffic && !process.argv.includes('--notraffic')) {
  for (let d = 500; d < r.len; d += 650) traffic.push({ active: true, s: r.s0 + dir * d, u: dir * route.laneU(r.s0 + dir * d, 0), hs: 2.2, hu: 0.92, vs: dir * 13, v: 13, dir, len: 4.4, wid: 1.84 });
  for (let d = 900; d < r.len + 4000; d += 800) traffic.push({ active: true, s: r.s0 + dir * d, u: -dir * route.laneU(r.s0 + dir * d, 0), hs: 2.2, hu: 0.92, vs: -dir * 14, v: 14, dir: -dir, len: 4.4, wid: 1.84 });
}

if (realTraffic) {
  actors = all.map((c) => ({ veh: c.veh, kind: c.isPlayer ? 'player' : 'rival' }));
  world.traffic.reset(player.veh.s);
  traffic = [...world.traffic.cars, ...world.traffic.sites.map((st) => ({ s: st.s, u: st.u, hs: st.len / 2, hu: st.wid / 2, vs: 0, v: 0, dir: 0, active: true }))];
}

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
const trafficBody = (c) => { const p = route.point(c.s, c.u), f = route.frame(c.s, {}); return { x: p.x, z: p.z, halfL: c.hs, halfW: c.hu, yaw: Math.atan2(-f.tx, -f.tz) + (c.dir < 0 ? Math.PI : 0) }; };

const log = [], events = [], samples = [], touching = new Map();
let aiMs = 0, aiCalls = 0, aiMax = 0; const slowCalls = [];
let order = all.map((c) => c), t = 0;
const say = (line) => { log.push(`${t.toFixed(1).padStart(6)}s  ${line}`); };
const corner = (s) => { const k = Math.abs(route.curv(s)); return k > 0.012 ? `bend R${Math.round(1 / k)}` : k > 0.004 ? `sweeper R${Math.round(1 / k)}` : 'straight'; };
say(`${mapId} ${def.id} ${r.len.toFixed(0)} m · player ${playerSpec.id} pace ${playerMode} · grid ${field.map((c) => `${c.name}(${c.spec})`).join(', ')} · traffic ${traffic.length}`);
const lastPass = new Map();
// ---- real-traffic bookkeeping: every stretch a civilian stood still (< 0.5 m/s) and why, and racers' stops
const civilianHits = [], episodes = [], open = new Map();
let fieldStall = 0, maxFieldStall = 0, fieldNoted = false;
function cause(c) {
  const T = world.traffic;
  if (c.mode === 'parked') return c.parkT > 1e8 ? 'parked-off-road' : 'parked';
  if (c.task) return 'task-' + c.task.kind + '-' + c.task.phase;
  const front = c.s + c.dir * c.len * 0.5, j = world.signals.next(front, c.dir), dj = j ? ((c.dir > 0 ? j.sF : j.sO) - front) * c.dir : 99;
  if (j && j.main !== 'G' && dj > -1 && dj < 25) return 'red-light';
  const L = T.lead(c, c.u, c.wid * 0.5, 40);
  if (!L.o) return 'nothing-ahead';
  const o = L.o, r = o.ref;
  return 'behind-' + (o.kind === 'car' ? (r.mode === 'parked' ? 'parked' : r.task ? 'task-' + r.task.kind + '-' + r.task.phase : r.v < 0.5 ? 'stopped-car' : 'moving-car') : o.kind) + (L.gap < 12 ? '' : '-far');
}
const watchId = arg('watch', null), watchFrom = +arg('wfrom', 0), watchTo = +arg('wto', 1e9);
const f = (x, n = 1) => (typeof x === 'number' ? x.toFixed(n) : '-');
/** the episode is filed under the reason it spent most of its frames in (a task that ends a moment before the car moves off is still that task) */
const close = (e) => { e.why = Object.entries(e.whys).sort((a, b) => b[1] - a[1])[0][0]; return e; };
function watchCivilians() {
  if (watchId !== null && Math.round(t * 60) % 60 === 0 && t >= watchFrom && t <= watchTo) {
    const c = world.traffic.cars[+watchId], T = world.traffic, L = T.lead(c, c.u, c.wid * 0.5, 60), k = c.task, X = c.cross;
    const j = world.signals.next(c.s + c.dir * c.len * 0.5, c.dir);
    say(`  <civ ${c.id} ${c.kind}> s=${f(prog(c.s))} u=${f(c.u, 2)} uT=${f(c.uT, 2)} v=${f(c.v, 2)} acc=${f(c.acc, 2)} mode=${c.mode} lane=${c.lane} dir=${c.dir} crash=${c.crash ? 'wreck' + c.crash.wreck + '/t' + f(c.crash.t, 0) : '-'} cross=${X ? X.mode + '/t' + f(X.t, 2) : '-'} task=${k ? k.kind + '/' + k.phase + '/t' + f(k.t, 0) : '-'} lcT=${f(c.lcT)} yield=${f(c.yieldT)} evade=${!!c.evade} stuckT=${f(c.stuckT)} v0=${f(c.v0)} next=${j ? j.main + '@' + f(((c.dir > 0 ? j.sF : j.sO) - c.s) * c.dir, 0) : '-'} held=${f(c.heldT)} lead=${L.o ? L.o.kind + (L.o.ref?.id ?? '') + ' gap' + f(L.gap) + ' lv' + f(L.lv) : '-'} racers=` + all.filter((r) => Math.abs(r.veh.s - c.s) < 40).map((r) => `${r.name}@${f(((r.veh.s - c.s) * c.dir), 0)}/${f(r.veh.u)}/v${f(r.veh.vLong, 0)}`).join(','));
  }
  for (const c of world.traffic.cars) {
    const e = open.get(c.id), still = c.active && !c.crash && !c.cross && c.v < 0.5 && c.mode !== 'cross' && !c.police;
    if (still && t > 3) {
      const why = cause(c);
      const waiting = all.some((r) => r.finish === null && Math.abs(r.veh.vLong) < 3 && (c.s - r.veh.s) * c.dir > 0 && (c.s - r.veh.s) * c.dir < 40 && Math.abs(r.veh.u - c.u) < 3.5);
      if (!e) open.set(c.id, { id: c.id, kind: c.kind, t0: t, t1: t, s0: prog(c.s), u: +c.u.toFixed(2), lane: c.lane, why, whys: { [why]: 1 }, racerWait: 0 });
      else { e.t1 = t; e.whys[why] = (e.whys[why] || 0) + 1; e.why = why; }
      if (waiting) open.get(c.id).racerWait += dt;
    } else if (e) { open.delete(c.id); if (e.t1 - e.t0 >= 1) episodes.push(close(e)); }
  }
  // a stall of the whole field: every racer under 1 m/s at once
  const racing = all.filter((c) => c.finish === null);
  if (t > 5 && racing.length && racing.every((c) => Math.abs(c.veh.vLong) < 1)) { fieldStall += dt; maxFieldStall = Math.max(maxFieldStall, fieldStall); } else fieldStall = 0;
  for (const c of racing) {
    c.stopT = Math.abs(c.veh.vLong) < 1 && t > 5 ? (c.stopT || 0) + dt : 0; c.maxStop = Math.max(c.maxStop || 0, c.stopT);
    if (c.stopT === 0) c.stopNoted = false;
    if (c.stopT > 10 && !c.stopNoted) {
      c.stopNoted = true;
      // what is in front of a racer that has been standing still for 10 s
      const v = c.veh, near = world.traffic.cars.filter((o) => o.active && Math.abs(o.s - v.s) < 30 && Math.abs(o.u - v.u) < 5).sort((a, b) => Math.abs(a.s - v.s) - Math.abs(b.s - v.s)).slice(0, 5);
      say(`STOPPED 10 s: ${c.name} at ${prog(v.s).toFixed(0)} m u=${v.u.toFixed(1)} yaw=${v.yaw.toFixed(2)}; near: ` + near.map((o) => `${o.kind}#${o.id} ${((o.s - v.s) * dir).toFixed(1)}m u=${o.u.toFixed(1)} v=${o.v.toFixed(1)} ${cause(o)} lane=${o.lane}`).join(' | ') + ` | lights ${world.signals.J.filter((j) => Math.abs(j.s - v.s) < 80).map((j) => j.main + '@' + (j.s - v.s).toFixed(0)).join(',')}`);
    }
  }
  if (fieldStall > 10 && !fieldNoted) { fieldNoted = true; say('FIELD STALL 10 s at ' + all.map((c) => `${c.name}:${prog(c.veh.s).toFixed(0)}`).join(' ')); }
  if (fieldStall === 0) fieldNoted = false;
}
for (let step = 0; step < seconds / dt; step++) {
  t = (step + 1) * dt;
  const inputs = all.map((c) => {
    // As main.js: a finished car cruises on at 30% pace, then stops 120 m on.
    if (c.finish !== null && prog(c.veh.s) > r.len + 120) return { throttle: 0, brake: c.veh.vLong > 1 ? 0.7 : 0, steer: 0, handbrake: c.veh.vLong <= 1 };
    const pace = c.finish !== null ? 0.3 : c.isPlayer ? playerPace(c.veh.s) : 1;
    const t0 = performance.now();
    const input = c.ai.update(dt, { racers: ghost ? [] : all, traffic, pace, signals: realTraffic ? world.signals : null, gapToPlayer: c.isPlayer ? null : (c.veh.s - player.veh.s) * dir });
    const took = performance.now() - t0; aiMs += took; aiCalls++; if (t > 2) aiMax = Math.max(aiMax, took); if (t > 2 && took > 5) slowCalls.push([+t.toFixed(2), c.name, +took.toFixed(1), c.ai.debug?.passState || '-']);
    const dbg = c.ai.debug || {};
    const state = dbg.passState || (dbg.passing ? 'oncoming' : null);
    if (state !== c.passState) {
      if (state && !c.passState) { c.attempts++; if (!c.isPlayer) say(`${c.name} starts pass (${state}) on ${all.find((o) => o.veh === dbg.passKey)?.name || 'traffic'} at ${prog(c.veh.s).toFixed(0)} m, ${corner(c.veh.s)}`); }
      if (!state && c.passState && !c.isPlayer) say(`${c.name} pass ends (${dbg.passEnd})`);
      c.passState = state;
    }
    if ((c.ai.abortedPasses ?? 0) > (c.lastAborts ?? 0)) { c.aborts++; if (!c.isPlayer) say(`${c.name} aborts a pass at ${prog(c.veh.s).toFixed(0)} m (${dbg.passReason})`); }
    if (traceName === c.name && step % 15 === 0 && t >= traceFrom && t <= traceTo) {
      const L = c.ai._find?.(dbg.passKey) || null;
      say(`  [${c.name}] d=${prog(c.veh.s).toFixed(1)} u=${c.veh.u.toFixed(2)} v=${(c.veh.vLong * 3.6).toFixed(0)} tgt=${(dbg.targetSpeed * 3.6).toFixed(0)} des=${dbg.desiredU?.toFixed(2)} held=${dbg.heldT?.toFixed(2)} gap=${dbg.gap?.toFixed(1)} pass=${dbg.passState}/${dbg.passSide} L.d=${L ? L.d.toFixed(1) : '-'} L.u=${L ? L.u.toFixed(2) : '-'} lead=${all.find((o) => o.veh === dbg.leaderKey)?.name || (dbg.leaderKey ? 'traffic' : '-')}@${dbg.leaderU?.toFixed(2)} room=${dbg.roomL?.toFixed(2)}/${dbg.roomR?.toFixed(2)} ph=${dbg.phase} thr=${input.throttle.toFixed(2)} br=${input.brake.toFixed(2)} wall=${c.veh.wallHit?.toFixed(1)}`);
    }
    c.lastAborts = c.ai.abortedPasses ?? 0;
    return input;
  });
  for (let i = 0; i < all.length; i++) {
    // Slipstream as main.js applies it: the same tow rule for every car.
    const c = all[i], v = c.veh; v.wallHit = 0; v.dragMul = 1 - 0.32 * (c.ai.draft || 0); v.update(dt, inputs[i]);
    if (v.wallHit > 0.5) c.wall++;
    if (c.finish === null && prog(v.s) >= r.len) { c.finish = t; say(`${c.name} FINISHES ${t.toFixed(2)} s`); }
  }
  if (realTraffic) {
    world.signals.update(dt, player.veh.s);
    world.traffic.update(dt, player.veh.s, actors);
    for (const a of actors) {
      const n0 = civilianHits.length; world.traffic.collide(a, civilianHits, t);
      for (let k = n0; k < civilianHits.length; k++) { const h = civilianHits[k]; if (h.car && h.kind !== 'near') say(`HIT ${h.kind} sev=${h.sev?.toFixed(1)} civ#${h.car.id} ${h.car.kind} at ${prog(h.car.s).toFixed(0)} m u=${h.car.u.toFixed(1)} by ${all[actors.indexOf(a)].name}`); }
    }
    watchCivilians();
  } else for (const c of traffic) { c.s += c.vs * dt; c.u = c.dir * route.laneU(c.s, 0); } // lane keeping
  // Racer contacts (onsets) and traffic contacts.
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j], key = i * 31 + j, hit = a.finish === null && b.finish === null && contact(a.veh, b.veh);
    if (hit && !touching.get(key)) { a.contacts++; b.contacts++; events.push({ t, kind: 'contact', a: a.name, b: b.name, s: prog(a.veh.s) }); say(`CONTACT ${a.name} / ${b.name} at ${prog(a.veh.s).toFixed(0)} m, ${corner(a.veh.s)}`); }
    touching.set(key, hit);
  }
  if (step % 6 === 0) for (const c of all) {
    if (c.finish !== null) continue;
    const near = traffic.filter((o) => o.active !== false && !o.crash && Math.abs(o.s - c.veh.s) < 12);
    const hit = near.some((o) => contact(c.veh, trafficBody(o)));
    if (hit && !c.trafficHit) { events.push({ t, kind: 'traffic', a: c.name, s: prog(c.veh.s) }); say(`TRAFFIC CONTACT ${c.name} at ${prog(c.veh.s).toFixed(0)} m`); }
    c.trafficHit = hit;
  }
  if (step % 15 === 0) {
    // Following time: within 1.2 s behind another racer in the same lane-ish.
    for (const c of all) {
      if (c.finish !== null) continue;
      const v = c.veh, ahead = all.find((o) => o !== c && o.finish === null && prog(o.veh.s) > prog(v.s) && prog(o.veh.s) - prog(v.s) < Math.max(10, v.vLong * 1.2) && Math.abs(o.veh.u - v.u) < 2.2);
      c.stuckT = ahead ? c.stuckT + 0.25 : 0; c.maxStuck = Math.max(c.maxStuck, c.stuckT);
      c.followT = (c.followT || 0) + (ahead ? 0.25 : 0);
    }
    const next = [...all].sort((a, b) => (a.finish ?? 1e9) - (b.finish ?? 1e9) || prog(b.veh.s) - prog(a.veh.s));
    for (let i = 0; i < next.length; i++) {
      const c = next[i], before = order.indexOf(c);
      if (before > i && c.finish === null) {
        // c gained places: name everyone it passed.
        for (const o of order.slice(i, before)) {
          if (next.indexOf(o) <= i || o.finish !== null) continue;
          const k = c.name + '>' + o.name;
          if (t - (lastPass.get(o.name + '>' + c.name) ?? -99) < 3) { events.push({ t, kind: 'swap-back', a: c.name, b: o.name }); }
          lastPass.set(k, t);
          events.push({ t, kind: 'pass', a: c.name, b: o.name, s: prog(c.veh.s), where: corner(c.veh.s), du: +(c.veh.u - o.veh.u).toFixed(2), kmh: Math.round(c.veh.vLong * 3.6) });
          say(`${c.name} passes ${o.name} at ${prog(c.veh.s).toFixed(0)} m (${corner(c.veh.s)}, ${Math.round(c.veh.vLong * 3.6)} km/h, Δu ${(c.veh.u - o.veh.u).toFixed(1)} m)`);
        }
      }
    }
    order = next;
  }
  if (step % 60 === 0) samples.push({ t: +t.toFixed(1), cars: all.map((c) => ({ n: c.name, d: +prog(c.veh.s).toFixed(1), u: +c.veh.u.toFixed(2), kmh: Math.round(c.veh.vLong * 3.6), ph: c.ai.debug?.passState || c.ai.debug?.phase })) });
  if (all.every((c) => c.finish !== null)) break;
}
const passes = events.filter((e) => e.kind === 'pass');
const summary = {
  map: mapId, label, playerMode, length: r.len,
  finish: Object.fromEntries(all.map((c) => [c.name, c.finish === null ? null : +c.finish.toFixed(2)])),
  classification: [...all].sort((a, b) => (a.finish ?? 1e9) - (b.finish ?? 1e9) || prog(b.veh.s) - prog(a.veh.s)).map((c) => c.name),
  passes: passes.length, rivalPassesOnPlayer: passes.filter((e) => e.b === 'PLAYER').length, playerPasses: passes.filter((e) => e.a === 'PLAYER').length,
  rivalOnRival: passes.filter((e) => e.a !== 'PLAYER' && e.b !== 'PLAYER').length,
  swapBacks: events.filter((e) => e.kind === 'swap-back').length,
  aiMicrosPerUpdate: +(aiMs * 1000 / Math.max(1, aiCalls)).toFixed(1), aiWorstUpdateMs: +aiMax.toFixed(2),
  racerContacts: events.filter((e) => e.kind === 'contact').length, trafficContacts: events.filter((e) => e.kind === 'traffic').length,
  cars: all.map((c) => ({ name: c.name, car: c.spec, finish: c.finish, attempts: c.attempts, aborts: c.aborts, overtakes: c.ai.overtakes, contacts: c.contacts, wallFrames: c.wall, followSeconds: c.followT || 0, maxStuckSeconds: c.maxStuck })),
};
if (realTraffic) {
  for (const e of open.values()) if (e.t1 - e.t0 >= 1) episodes.push(close(e));
  const dur = (e) => +(e.t1 - e.t0).toFixed(1);
  const longest = [...episodes].sort((a, b) => dur(b) - dur(a));
  // genuinely held: a red light, a bus/taxi in its bay, a car parked off the road (and a queue behind those)
  const held = (e) => /^(red-light|parked-off-road|task-(bus|fare|park|pull)-wait|behind-(red-light|parked-off-road))/.test(e.why);
  summary.civilians = {
    episodes: episodes.length, maxStillS: longest[0] ? dur(longest[0]) : 0,
    over8s: episodes.filter((e) => dur(e) > 8).length, over20s: episodes.filter((e) => dur(e) > 20).length,
    unheldOver8s: episodes.filter((e) => !held(e) && dur(e) > 8).length,
    longest: longest.slice(0, 12).map((e) => ({ id: e.id, racerWait: +e.racerWait.toFixed(1), kind: e.kind, s: +e.s0.toFixed(0), u: e.u, t0: +e.t0.toFixed(1), dur: dur(e), why: e.why, whys: Object.entries(e.whys).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => k + ':' + (n / 60).toFixed(1)) })),
    maxFieldStallS: +maxFieldStall.toFixed(1), civilianHits: civilianHits.length,
  };
  for (const c of all) summary.cars.find((x) => x.name === c.name).maxStopS = +(c.maxStop || 0).toFixed(1);
}
summary.slowUpdates = slowCalls.length; say('SLOW ' + JSON.stringify(slowCalls.slice(0, 40)));
say('SUMMARY ' + JSON.stringify(summary));
const base = `${label}-${mapId}-${playerMode}${pole ? '-pole' : ''}${sameCar ? '-samecar' : ''}${ghost ? '-ghost' : ''}`;
writeFileSync(new URL(base + '.log', out), log.join('\n') + '\n');
writeFileSync(new URL(base + '.json', out), JSON.stringify({ summary, events, samples, episodes: realTraffic ? episodes.map((e) => ({ ...e, dur: +(e.t1 - e.t0).toFixed(1), racerWait: +e.racerWait.toFixed(1) })) : undefined }) + '\n');
console.log(JSON.stringify(summary));
