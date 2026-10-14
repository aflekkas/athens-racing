// Scripted headless sprint: the real RivalAI field plus a scripted "player" on
// Riviera (two-way road, light traffic) and Penteli (closed road). Real Vehicle
// physics at 60 Hz with production barriers; logs every position change, pass
// attempt, abort and racer contact so rival racecraft can be compared.
// node --import ./tools/physics-test/register.mjs tools/rival-race-sim.mjs [--map riviera|penteli] [--label before] [--player slow|matched|fast]
// AI=<path to rival-ai.js> compares another controller with the same harness.
import { register } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const { smoothstep } = await import('../src/util.js');
const { RivalAI } = await import(process.env.AI ? new URL(process.env.AI, 'file://' + process.cwd() + '/').href : '../src/rival-ai.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const mapId = arg('map', 'riviera'), label = arg('label', 'after'), playerMode = arg('player', 'slow');
const traceName = arg('trace', null), traceFrom = +arg('from', 0), traceTo = +arg('to', 1e9);
const rivalsN = +arg('rivals', 3), seconds = +arg('seconds', 900);
const root = new URL('../', import.meta.url), out = new URL('.scratch/rival-ai-v2/', root);
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
const traffic = [];
if (!closedRoad && !process.argv.includes('--notraffic')) {
  for (let d = 500; d < r.len; d += 650) traffic.push({ active: true, s: r.s0 + dir * d, u: dir * route.laneU(r.s0 + dir * d, 0), hs: 2.2, hu: 0.92, vs: dir * 13, v: 13, dir, len: 4.4, wid: 1.84 });
  for (let d = 900; d < r.len + 4000; d += 800) traffic.push({ active: true, s: r.s0 + dir * d, u: -dir * route.laneU(r.s0 + dir * d, 0), hs: 2.2, hu: 0.92, vs: -dir * 14, v: 14, dir: -dir, len: 4.4, wid: 1.84 });
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
for (let step = 0; step < seconds / dt; step++) {
  t = (step + 1) * dt;
  const inputs = all.map((c) => {
    // As main.js: a finished car cruises on at 30% pace, then stops 120 m on.
    if (c.finish !== null && prog(c.veh.s) > r.len + 120) return { throttle: 0, brake: c.veh.vLong > 1 ? 0.7 : 0, steer: 0, handbrake: c.veh.vLong <= 1 };
    const pace = c.finish !== null ? 0.3 : c.isPlayer ? playerPace(c.veh.s) : 1;
    const t0 = performance.now();
    const input = c.ai.update(dt, { racers: ghost ? [] : all, traffic, pace, signals: null, gapToPlayer: c.isPlayer ? null : (c.veh.s - player.veh.s) * dir });
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
  for (const c of traffic) { c.s += c.vs * dt; c.u = c.dir * route.laneU(c.s, 0); } // lane keeping
  // Racer contacts (onsets) and traffic contacts.
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j], key = i * 31 + j, hit = a.finish === null && b.finish === null && contact(a.veh, b.veh);
    if (hit && !touching.get(key)) { a.contacts++; b.contacts++; events.push({ t, kind: 'contact', a: a.name, b: b.name, s: prog(a.veh.s) }); say(`CONTACT ${a.name} / ${b.name} at ${prog(a.veh.s).toFixed(0)} m, ${corner(a.veh.s)}`); }
    touching.set(key, hit);
  }
  if (step % 6 === 0) for (const c of all) {
    if (c.finish !== null) continue;
    const near = traffic.filter((o) => Math.abs(o.s - c.veh.s) < 12);
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
summary.slowUpdates = slowCalls.length; say('SLOW ' + JSON.stringify(slowCalls.slice(0, 40)));
say('SUMMARY ' + JSON.stringify(summary));
const base = `${label}-${mapId}-${playerMode}${pole ? '-pole' : ''}${sameCar ? '-samecar' : ''}${ghost ? '-ghost' : ''}`;
writeFileSync(new URL(base + '.log', out), log.join('\n') + '\n');
writeFileSync(new URL(base + '.json', out), JSON.stringify({ summary, events, samples }) + '\n');
console.log(JSON.stringify(summary));
