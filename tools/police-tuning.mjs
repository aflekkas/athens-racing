// Reproducible 60 Hz trigger measurements (seconds from scenario start).
// node tools/police-tuning.mjs -- fixture units stay in range so observation is controlled.
import { world } from './police-fixture.mjs';
import { events } from '../src/events.js';
import { pathToFileURL } from 'node:url';
export const scenarios = [
  { trigger: '120 km/h; no cops', kmh: 120 },
  { trigger: '+40 km/h; cop 60 m', kmh: 90, cop: 60, star: 4 },
  { trigger: '+21 km/h; cop 60 m', kmh: 71, cop: 60 },
  { trigger: '+30 km/h; cop 60 m', kmh: 80, cop: 60 },
  { trigger: '+40 km/h; cop 130 m', kmh: 90, cop: 130 },
  { trigger: '+40 km/h; blocked LOS at 20 m', kmh: 90, cop: 20, blocked: true },
  { trigger: 'red; no cop', red: true },
  { trigger: 'red; cop 60 m', red: true, cop: 60 },
  { trigger: 'near miss; cop 60 m', kind: 'near', cop: 60 },
  { trigger: 'traffic bump; no cop', kind: 'bump' },
  { trigger: 'traffic bump; cop 60 m', kind: 'bump', cop: 60 },
  { trigger: 'traffic crash; no cop', kind: 'crash' },
  { trigger: 'traffic crash; cop 60 m', kind: 'crash', cop: 60 },
  { trigger: 'police bump', kind: 'bump', hitcop: true },
  { trigger: 'police crash', kind: 'crash', hitcop: true, star: 2 / 60 },
  { trigger: 'wrong side; cop 60 m', wrong: true, cop: 60, star: 10 },
  { trigger: 'wrong side; no cop', wrong: true },
  { trigger: 'event speed camera; no cop', camera: true },
];
export function measure(opts, { duration = 60, dt = 1 / 60 } = {}) {
  const w = world(); w.police.reset(true); w.player(1000, opts.wrong ? -2 : 2, (opts.kmh || 45) / 3.6);
  if (opts.blocked) w.police.los = () => false;
  const cop = opts.cop || opts.hitcop ? w.police.spawnCop(1000 + (opts.cop || 3), 1) : null;
  const result = { trigger: opts.trigger, timeToWarning: null, timeToStar: null, timeToPursuit: null };
  try {
    for (let i = 0; i < Math.round(duration / dt); i++) {
      if (i === 1 && opts.red) w.police.witnessedRed(w.traffic.racers[0]);
      if (i === 1 && opts.camera) events.emit('trap', { kmh: 120 });
      const ev = i === 1 && opts.kind ? [{ who: 'player', kind: opts.kind, car: opts.hitcop ? cop : {} }] : [];
      w.police.update(dt, { racing: true, dir: 1, reds: opts.red && i >= 1 ? 1 : 0, events: ev });
      const time = (i + 1) * dt;
      if (result.timeToWarning === null && w.police.hm.state === 'warning') result.timeToWarning = time;
      if (result.timeToStar === null && w.police.hm.level > 0) result.timeToStar = time;
      if (result.timeToPursuit === null && w.police.hm.active) result.timeToPursuit = time;
    }
    return { ...result, heatAt60s: w.police.hm.heat };
  } finally { w.police.reset(false); w.police.offs.forEach(off => off()); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(scenarios.map(s => measure(s)), null, 2));
