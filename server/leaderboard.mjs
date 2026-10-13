import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resultContext, validResult, resultEntry } from './leaderboard-policy.mjs';

export async function createLeaderboard(file, definitions, cars, version, maps) {
  let entries;
  try { entries = JSON.parse(await readFile(file, 'utf8')).entries; if (!Array.isArray(entries)) throw new Error('Invalid leaderboard file'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; entries = []; }
  let pending = Promise.resolve();
  const validate = r => validResult(r, resultContext(r, definitions, version, maps).event, cars);
  const list = ({ eventId, car, traffic, mapId = 'riviera', limit = 50 } = {}) => entries.filter(e => (e.mapId || 'riviera') === mapId && e.version === (maps ? maps.get(mapId)?.track.version : version) && (!eventId || e.eventId === eventId) && (!car || e.car === car) && (traffic === undefined || e.traffic === traffic)).sort((a, b) => a.time - b.time || a.at - b.at).slice(0, Math.max(1, Math.min(100, Number(limit) || 50))).map(({ driverId, ...e }) => e);
  const submit = r => {
    if (!validate(r)) return Promise.reject(Object.assign(new Error('Unknown event/car or implausible result time.'), { status: 400 }));
    const run = pending.then(async () => {
      const { event, version: entryVersion, mapId } = resultContext(r, definitions, version, maps);
      const entry = resultEntry(r, event, entryVersion, mapId);
      const same = e => e.driverId === entry.driverId && e.eventId === entry.eventId && e.car === entry.car && e.traffic === entry.traffic && e.version === entry.version && (e.mapId || 'riviera') === entry.mapId;
      const old = entries.find(same);
      if (old && old.time <= entry.time) return { saved: false, best: old.time };
      let next = entries.filter(e => !same(e)); next.push(entry);
      // Bound each route/car/traffic board independently so short routes cannot crowd out long ones.
      const buckets = new Map();
      next = next.sort((a, b) => a.time - b.time).filter(e => {
        const key = [e.mapId || 'riviera', e.version, e.eventId, e.car, e.traffic].join('|');
        const count = (buckets.get(key) || 0) + 1; buckets.set(key, count); return count <= 200;
      });
      if (!next.includes(entry)) return { saved: false, best: old?.time ?? null, reason: 'This board retains its fastest 200 drivers.' };
      await mkdir(dirname(file), { recursive: true });
      const temp = file + '.' + randomUUID() + '.tmp';
      try { await writeFile(temp, JSON.stringify({ schema: 1, entries: next }) + '\n', { mode: 0o600 }); await rename(temp, file); }
      catch (e) { await unlink(temp).catch(() => {}); throw e; }
      entries = next;
      return { saved: true, best: entry.time };
    });
    pending = run.catch(() => {}); return run;
  };
  return { list, submit, validate, flush: () => pending };
}
