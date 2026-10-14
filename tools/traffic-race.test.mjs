// node --import ./tools/physics-test/register.mjs --test tools/traffic-race.test.mjs
// A full Riviera race (the real src/traffic.js and signals, the real RivalAI field, real Vehicle physics at 60 Hz;
// tools/rival-race-sim.mjs --real-traffic) and what the civilians did in it. Playtesters met cars that stopped in a lane
// and stayed for 80 s or more, which froze the whole field behind them. Before the fix this harness measured, on the
// same two races, a civilian standing still for 76-887 s, a field-wide stall of 61 s (afternoon) and a field that never
// finished (rush hour). Each episode is a stretch of one civilian under 0.5 m/s, filed under the reason it spent most of
// it in (tools/rival-race-sim.mjs, cause()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTER = fileURLToPath(new URL('./physics-test/register.mjs', import.meta.url));
const SIM = fileURLToPath(new URL('./rival-race-sim.mjs', import.meta.url));
const SCENARIOS = [
  { label: 'afternoon, player at matched pace', player: 'matched', hour: 15 },
  { label: 'rush hour, slow player', player: 'slow', hour: 8.5 },
];

const dir = mkdtempSync(join(tmpdir(), 'traffic-race-'));
const run = ({ player, hour }, i) => new Promise((resolve, reject) => execFile(process.execPath,
  ['--import', REGISTER, SIM, '--map', 'riviera', '--player', player, '--hour', String(hour), '--real-traffic', '--label', 'race' + i, '--out', dir],
  { maxBuffer: 1 << 26 }, (err, _out, errOut) => err ? reject(new Error(errOut || err.message)) : resolve(JSON.parse(readFileSync(join(dir, `race${i}-riviera-${player}.json`), 'utf8')))));
const races = Promise.all(SCENARIOS.map(run));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// A civilian that is held for a reason of its own and not a lane it sits in: the red light (and its queue), a car left for
// good off the road, a bay or kerb stop it will leave on its own (parked, a taxi's fare, a bus at its stop, a pull-over).
const KERB = /^(parked$|task-(bus|fare|park|pull)-(wait|out))/;

SCENARIOS.forEach((scenario, i) => test(`Riviera, ${scenario.label}: civilians keep moving and the field never stalls`, async () => {
  const { summary, episodes } = (await races)[i];
  const inRace = episodes.filter((e) => e.s0 < summary.length);
  const worst = (list) => list.reduce((a, e) => (e.dur > (a?.dur ?? 0) ? e : a), null);

  // everybody finishes, and nobody (nor the whole field) stands still for long
  assert.ok(Object.values(summary.finish).every((t) => t !== null), 'every racer finishes ' + JSON.stringify(summary.finish));
  assert.ok(summary.civilians.maxFieldStallS < 8, `field-wide stall ${summary.civilians.maxFieldStallS} s`);
  for (const c of summary.cars) assert.ok(c.maxStopS < 16, `${c.name} stood still for ${c.maxStopS} s`);

  // in a through lane: nobody waits more than a few seconds for anything but a red light (design target 8 s; a queue behind a
  // parked car in rush hour needs a gap in the next lane)
  const inLane = inRace.filter((e) => !KERB.test(e.why) && !/^(red-light|parked-off-road|behind-red-light)/.test(e.why));
  const w = worst(inLane);
  assert.ok(!w || w.dur < 12, `civilian #${w?.id} (${w?.kind}) stood in a lane for ${w?.dur} s: ${JSON.stringify(w?.whys)}`);
  const redLight = worst(inRace.filter((e) => e.why === 'red-light'));
  assert.ok(!redLight || redLight.dur < 30, `a red light held #${redLight?.id} for ${redLight?.dur} s`);

  // at the kerb: parked and pulled-over cars drive off before long, and sooner when a racer is queued behind them
  const kerb = inRace.filter((e) => KERB.test(e.why));
  const k = worst(kerb);
  assert.ok(!k || k.dur < 45, `civilian #${k?.id} stayed at the kerb for ${k?.dur} s (${k?.why})`);
  const held = worst(inRace.filter((e) => e.why !== 'red-light' && e.why !== 'parked-off-road'));
  const queued = inRace.filter((e) => e.racerWait > 12 && e.why !== 'red-light' && e.why !== 'parked-off-road');
  assert.equal(queued.length, 0, `racers waited behind a standing civilian: ${JSON.stringify(queued.map((e) => [e.id, e.why, e.racerWait]))} (longest overall ${held?.dur} s)`);
}));
