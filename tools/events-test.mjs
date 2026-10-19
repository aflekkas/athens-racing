// Headless tests of the event framework (src/events.js): route resolution (segments, reverse), timing sectors and
// splits, medals (positions / times only: no points), saved records, pursuit, positions, wrong-way and the hook API.
//   node tools/events-test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as EV from '../src/events.js';
import * as RS from '../src/race-setup.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/map.json', import.meta.url)));
const route = { start: data.route.start, finish: data.route.finish, length: data.route.length, from: data.route.from, to: data.route.to, curv: () => 0 };
const ctx = { route, marks: data.marks };
const mem = () => ({ m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); } });

/** drive a run at constant speed v (m/s) from the start line; returns everything that happened */
function drive(def, v, st, opts = {}) {
  const run = new EV.EventRun(def, ctx, { car: 'mini', storage: st });
  run.start();
  const out = [], dt = 1 / 30;
  let t = 0, s = run.r.s0;
  for (let i = 0; i < 60 * 60 * 30 && !run.done; i++) {
    t += dt; s += run.r.dir * v * dt;
    for (const e of run.update(dt, { t, s, kmh: v * 3.6 })) {
      out.push(e);
      if (e.kind === 'finish') return { run, out, res: run.finish({ time: t, position: opts.position ?? 1, field: 4 }) };
      if (e.kind === 'timeup') return { run, out, res: run.finish({ time: null }) };
    }
  }
  return { run, out, res: null };
}

test('every event resolves inside the route with sane timing sectors', () => {
  for (const e of EV.EVENTS) {
    const r = EV.resolve(e, ctx);
    assert.ok(r.len > 1500, e.id + ' long enough');
    assert.ok(Math.min(r.s0, r.s1) >= 0 && Math.max(r.s0, r.s1) <= route.length, e.id + ' in bounds');
    assert.equal(r.sectors.at(-1).id, 'finish');
    assert.equal(r.sectors.at(-1).d, r.len);
    for (let i = 1; i < r.sectors.length; i++) assert.ok(r.sectors[i].d > r.sectors[i - 1].d, e.id + ' sectors ascend');
    assert.ok(EV.TYPES[e.type], e.id + ' type');
    if (!(e.type === 'pursuit' && e.rules?.goal === 'survive')) assert.ok(e.targets.gold && e.targets.silver && e.targets.bronze, e.id + ' targets');
    assert.ok(['sprint', 'timetrial', 'pursuit'].includes(e.type), e.id + ': no points modes');
    if (e.type === 'sprint') { const g = EV.gridFor(e); assert.equal(g.length, EV.SP_RIVALS, e.id + ' grid of 3'); assert.equal(new Set(g.map((d) => d.id)).size, g.length, 'no duplicate drivers'); }
  }
  assert.equal(new Set(EV.EVENTS.map((e) => e.id)).size, EV.EVENTS.length, 'unique ids');
  assert.deepEqual(Object.keys(EV.TYPES).sort(), ['free', 'getaway', 'pursuit', 'sprint', 'taxi', 'timetrial']);
  for (const id of ['score-beach', 'score-varkiza', 'cameras-coast', 'cameras-riviera']) assert.equal(EV.getEvent(id), null, id + ' removed');
  assert.ok(!('traps' in EV.resolve(EV.QUICK_RACE, ctx)), 'no speed cameras');
});

test('reverse and segment routes', () => {
  const rev = EV.resolve(EV.getEvent('return-leg'), ctx);
  assert.equal(rev.dir, -1); assert.equal(rev.s0, route.finish); assert.equal(rev.s1, route.start); assert.ok(rev.reverse);
  assert.deepEqual(rev.sectors.map((c) => c.id), ['coast', 'varkiza', 'limanakia', 'lake', 'astir', 'finish']);
  const seg = EV.resolve(EV.getEvent('astir-varkiza'), ctx);
  assert.equal(seg.dir, 1); assert.equal(seg.fromName, 'ASTIR'); assert.equal(seg.toName, 'VARKIZA');
  assert.equal(EV.locate(5000, ctx).name, 'VARKIZA');
});

test('time trial: splits, finish, medal, best splits compared next run', () => {
  const st = mem(), def = EV.getEvent('tt-coast'), r = EV.resolve(def, ctx);
  const splitsHeard = [];
  const off = EV.events.on('split', (e) => splitsHeard.push(e));
  const a = drive(def, (def.targets.silver + 2) / 3.6, st); // just inside silver
  assert.equal(a.res.medal, 'silver');
  assert.equal(a.res.splits.length, r.sectors.length);
  assert.ok(Math.abs(a.res.time - r.len / ((def.targets.silver + 2) / 3.6)) < 0.1);
  assert.ok(a.res.newBest);
  assert.equal(EV.loadRecord(def.id, st).medal, 'silver');
  const b = drive(def, (def.targets.gold + 5) / 3.6, st); // faster: deltas negative, gold
  const sp = b.out.filter((e) => e.kind === 'split');
  assert.ok(sp.every((e) => e.delta < 0), 'faster run is ahead at every split');
  assert.equal(b.res.medal, 'gold'); assert.equal(EV.loadRecord(def.id, st).medal, 'gold');
  const c = drive(def, (def.targets.bronze - 10) / 3.6, st); // slow: no medal, but the saved medal stays gold
  assert.equal(c.res.medal, null); assert.equal(EV.loadRecord(def.id, st).medal, 'gold'); assert.ok(!c.res.newBest);
  assert.equal(EV.loadRecord(def.id, st).runs, 3);
  off();
  assert.ok(splitsHeard.length >= 3 * r.sectors.length);
});

test('reverse run finishes at the start of the road', () => {
  const st = mem(), def = EV.getEvent('tt-reverse');
  const a = drive(def, 40, st);
  assert.ok(a.res && a.res.time > 0); assert.equal(a.res.reverse, true);
  assert.equal(a.res.routeKey, `${route.finish}>${data.marks.find((m) => m.id === 'limanakia').s}`);
});

test('sprint medals by position', () => {
  const st = mem(), def = EV.getEvent('astir-varkiza');
  assert.equal(drive(def, 40, st, { position: 1 }).res.medal, 'gold');
  assert.equal(drive(def, 40, st, { position: 2 }).res.medal, 'silver');
  assert.equal(drive(def, 40, st, { position: 3 }).res.medal, 'bronze');
  assert.equal(drive(def, 40, st, { position: 4 }).res.medal, null);
  assert.equal(EV.loadRecord(def.id, st).bestPos, 1);
  assert.equal(EV.gridFor(EV.QUICK_RACE).length, 2, 'two rivals by default'); assert.equal(EV.gridFor({ ...def, rivals: 7 }).length, EV.MAX_RIVALS, 'event counts are capped at MAX_RIVALS');
  assert.equal(EV.gridFor({ ...def, rivalCount: 11 }).length, EV.MAX_RIVALS, 'up to MAX_RIVALS on request'); assert.equal(EV.gridFor({ ...def, rivalCount: 40 }).length, EV.MAX_RIVALS, 'capped at the driver pool');
  assert.equal(EV.gridFor({ ...def, rivalCount: 0 }).length, 0, 'an empty grid is allowed');
  const r = drive(def, 40, st, { position: 2 }).res;
  assert.ok(!('score' in r) && !('breakdown' in r) && !('trapTotal' in r), 'no points in the result');
});

test('pursuit: busted is a DNF, escape is judged on time, survive is pass/fail', () => {
  const st = mem(), sv = EV.getEvent('pursuit-survive'), r = EV.resolve(sv, ctx);
  const run = new EV.EventRun(sv, ctx, { storage: st }); run.start();
  const res = run.finish({ time: null, busted: true });
  assert.equal(res.medal, null); assert.equal(res.valid, false);
  const run2 = new EV.EventRun(sv, ctx, { storage: st }); run2.start();
  assert.ok(!run2.update(1, { t: 50, s: r.s1 + 1, kmh: 200 }).some(e => e.kind === 'finish' || e.kind === 'timeup'), 'survival requires the full clock even after reaching the route end');
  assert.equal(EV.medalFor(sv, { time: 50 }, r), null, 'early survival completion earns no medal');
  assert.equal(run2.update(1, { t: r.timeLimit + 0.1, s: r.s0 + 100, kmh: 50 }).at(-1).kind, 'timeup');
  assert.equal(run2.finish({ time: r.timeLimit }).medal, 'gold');
  const es = EV.getEvent('pursuit-escape'), t = es.targets;
  const fin = (time, busted) => { const x = new EV.EventRun(es, ctx, { storage: st }); x.start(); return x.finish({ time, busted }); };
  assert.equal(fin(t.gold - 1).medal, 'gold'); assert.equal(fin(t.silver - 1).medal, 'silver');
  assert.equal(fin(t.bronze - 1).medal, 'bronze'); assert.equal(fin(t.bronze + 1).medal, null);
  assert.equal(fin(null, true).medal, null);
  assert.equal(EV.loadRecord(es.id, st).bestTime, t.gold - 1);
  assert.deepEqual(EV.targetLabels(es, null, (x) => x + 's').map((l) => l[1]), [`LOSE THEM IN ${t.gold}s`, `LOSE THEM IN ${t.silver}s`, `LOSE THEM IN ${t.bronze}s`]);
});

test('100 km/h impact: wrecked is a DNF with no medal, winning position or best update', () => {
  assert.equal(EV.isWrecked(90 / 3.6 - 0.0001), false);
  assert.equal(EV.isWrecked(90 / 3.6), true);
  assert.equal(EV.isWrecked(120 / 3.6), true);
  const st = mem(), def = EV.getEvent('astir-varkiza');
  const completed = new EV.EventRun(def, ctx, { storage: st }); completed.start();
  completed.finish({ time: 100, position: 2, field: 4 });
  const run = new EV.EventRun(def, ctx, { storage: st }); run.start();
  // Even a mistakenly supplied finish time/position cannot turn a wreck into a win.
  const res = run.finish({ wrecked: true, time: 90, position: 1, field: 4, valid: true });
  assert.equal(res.time, null); assert.equal(res.position, null); assert.equal(res.valid, false);
  assert.equal(res.won, false); assert.equal(res.medal, null); assert.equal(res.busted, false);
  assert.equal(res.newBest, false);
  assert.equal(EV.loadRecord(def.id, st).bestTime, 100);
  assert.equal(EV.loadRecord(def.id, st).bestPos, 2);
});

test('positions, wrong way, hooks', () => {
  const a = { prog: 500, finish: null }, b = { prog: 900, finish: null }, c = { prog: 100, finish: 61.2 }, d = { prog: 100, finish: 60.1 };
  assert.deepEqual(EV.rankRacers([a, b, c, d]), [d, c, b, a]);
  const retired = { prog: 2000, finish: null, dnf: true };
  assert.deepEqual(EV.rankRacers([retired, a, c]), [c, a, retired], 'retired cars trail finishers and cars still running');
  const w = {};
  assert.equal(EV.wrongWay(w, 0.05, 1, 0), false, 'a boolean from the first call (the HUD forces its class with it)');
  for (let i = 0; i < 28; i++) EV.wrongWay(w, 0.05, -1, 10);
  assert.equal(!!w.on, false, 'not before 1.5 s'); // 1.4 s
  for (let i = 0; i < 4; i++) EV.wrongWay(w, 0.05, -1, 10);
  assert.equal(w.on, true);
  for (let i = 0; i < 30; i++) EV.wrongWay(w, 0.05, 1, 10);
  assert.equal(w.on, false);
  for (let i = 0; i < 60; i++) EV.wrongWay(w, 0.05, -1, 4); // backwards but slow (turning round, reversing): no warning
  assert.equal(!!w.on, false);
  const seen = [];
  const offs = ['start', 'finish', 'abort'].map((n) => EV.events.on(n, (p) => seen.push(n + ':' + p.eventId)));
  const run = new EV.EventRun(EV.QUICK_RACE, ctx, { storage: mem() });
  run.start(); run.abort('quit');
  assert.deepEqual(seen, ['start:quick', 'abort:quick']);
  assert.equal(run.addScore, undefined, 'no scoring API');
  offs.forEach((o) => o());
  let threw = 0; const off = EV.events.on('start', () => { threw++; throw new Error('listener bug'); });
  const orig = console.error; console.error = () => {}; new EV.EventRun(EV.QUICK_RACE, ctx).start(); console.error = orig; off();
  assert.equal(threw, 1, 'a failing listener does not break the emitter');
});

test('closed circuit: three laps, no early finish, lap clocks and total-time ranking', () => {
  const loop = {route:{start:0,finish:2000,length:2000,closed:true,from:'START',to:'START'},marks:[]};
  const def={id:'test-circuit',mapId:'megara',type:'timetrial',from:'start',to:'finish',laps:3,rivals:0,targets:{gold:120,silver:100,bronze:80}};
  const run=new EV.EventRun(def,loop,{storage:mem()});run.start();
  assert.deepEqual(EV.resolve({...def,targetTimes:{gold:240,silver:270,bronze:315}},loop).targetTimes,{gold:240,silver:270,bronze:315},'explicit circuit medals use total elapsed seconds');
  assert.equal(run.r.len,6000);assert.equal(run.r.laps,3);assert.equal(run.r.sectors.length,12);
  let emitted=[];
  for(let s=0;s<=6000;s+=100){const out=run.update(1,{s,t:s/25,kmh:90});emitted.push(...out);if(s<6000)assert.ok(!out.some(e=>e.kind==='finish'));if(s===2100){assert.equal(run.lap,2);assert.equal(run.lapTime,4);}}
  assert.deepEqual(run.lapTimes,[80,80,80]);assert.equal(run.lap,3);
  assert.equal(emitted.filter(e=>e.kind==='lap').length,3);
  const res=run.finish({time:240});assert.equal(res.time,240);assert.equal(res.bestLap,80);assert.equal(res.mapId,'megara');assert.deepEqual(res.lapTimes,[80,80,80]);
  assert.deepEqual(EV.rankRacers([{id:'a',finish:243,prog:6000},{id:'b',finish:239,prog:6000}]).map(r=>r.id),['b','a']);
});
test('map event registration isolates maps without changing Riviera', () => {
  EV.registerMapEvents('test-map',[{id:'test-map-tt',type:'timetrial'}]);
  assert.equal(EV.getEvent('test-map-tt').mapId,'test-map');assert.equal(EV.getEvents('test-map').length,1);assert.equal(EV.getEvents('riviera'),EV.EVENTS);assert.equal(EV.getEvent('unknown-event'),null);
});

test('race setup: defaults stay official, choices make a separate custom variant', () => {
  const st = mem(), sprint = EV.getEvent('riviera-sprint');
  assert.equal(RS.isCustom(sprint, {}), false);
  const same = RS.applySetup(sprint, RS.loadSetup(sprint.id, st));
  assert.equal(same.id, sprint.id); assert.ok(!same.custom); assert.equal(EV.gridFor(same).length, 2, 'default single player = 2 rivals');
  RS.saveSetup(sprint.id, { rivals: 8, traffic: 2, time: 'night', weather: 'rain' }, st);
  const run = RS.applySetup(sprint, RS.loadSetup(sprint.id, st));
  assert.equal(EV.gridFor(run).length, EV.MAX_RIVALS); assert.equal(run.traffic, 2); assert.deepEqual(run.conditions, { time: 'night', weather: 'rain' });
  assert.equal(run.id, 'riviera-sprint~t2', 'a rivals request above the cap clamps to the default and drops out of the id'); assert.ok(run.custom); assert.equal(run.baseId, sprint.id);
  const night = RS.applySetup(sprint, { time: 'night' });
  assert.equal(night.id, sprint.id, 'time of day and weather keep the official event');
  const rev = RS.applySetup(sprint, { reverse: true });
  assert.equal(rev.from, 'finish'); assert.equal(rev.to, 'start'); assert.ok(EV.resolve(rev, ctx).reverse);
  const cup = EV.getEvent('classic-cup'), more = RS.applySetup(cup, { rivals: 5 });
  assert.deepEqual(EV.gridFor(more).map((d) => d.id), ['giorgos', 'yiannis'], 'named rivals stay on the grid');
  assert.equal(EV.gridFor(more).length, EV.MAX_RIVALS);
  const circuit = { id: 'c', type: 'timetrial', from: 'start', to: 'finish', laps: 3, rivals: 0, traffic: 0, targetTimes: { gold: 240, silver: 270, bronze: 315 } };
  const five = RS.applySetup(circuit, { laps: 5, reverse: true }, { closed: true });
  assert.equal(five.laps, 5); assert.equal(five.reverse, true); assert.equal(five.targetTimes.gold, 400); assert.equal(five.id, 'c~l5~rev');
  assert.ok(!RS.setupFields(circuit, { closed: true }).some((f) => f.key === 'traffic'), 'circuits have no traffic option');
  const r = new EV.EventRun(run, ctx, { storage: st }); r.start(); assert.equal(r.finish({ time: 300 }).valid, false, 'custom runs stay off the leaderboard');
  RS.saveSetup(sprint.id, {}, st); assert.deepEqual(RS.loadSetup(sprint.id, st), {});
  assert.deepEqual(RS.trafficLevels(0.8).map((l) => l[1]), [0, 0.5, 0.8, 1.5, 2], 'the event density is one of the choices');
});

test('Psychiko Faros Circuit v3 keeps earlier loop times stored but never ranks against them', () => {
  const oldKeys = ['paraliaki.events.psychiko-race.garden-v2','paraliaki.events.psychiko-race', 'paraliaki.events.psychiko-race.reverse-default-v1', 'paraliaki.events.psychiko-race~rev'];
  const saved = new Map(oldKeys.map((key, i) => [key, JSON.stringify({ bestTime: 100 + i })]));
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  assert.deepEqual(EV.loadRecord('psychiko-race', storage), {});
  assert.deepEqual(EV.loadRecord('psychiko-race~rev', storage), {});
  EV.saveRecord('psychiko-race', { bestTime: 150 }, storage);
  assert.equal(EV.loadRecord('psychiko-race', storage).bestTime, 150);
  assert.ok(saved.has('paraliaki.events.psychiko-race.faros-v3'));
  oldKeys.forEach((key, i) => assert.equal(JSON.parse(saved.get(key)).bestTime, 100 + i, 'earlier records are left untouched'));
});
