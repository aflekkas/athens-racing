import {migrateRouteRecords,routeHistory,routeEdition} from '../src/route-migrations.js';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resultContext, validResult, resultEntry, leaderboardVersion, boardKey, filterEntries, canonicalResult, canonicalEntries } from './leaderboard-policy.mjs';

export async function createLeaderboard(file, definitions, cars, version, maps) {
  const routeMode=!!maps?.routes?.size,storageFile=routeMode?file+'.routes-v2.json':file;let history=[];
  let entries;
  try { let data;try{data=JSON.parse(await readFile(storageFile,'utf8'));}catch(e){if(!routeMode||e.code!=='ENOENT')throw e;data=JSON.parse(await readFile(file,'utf8'));}entries=data.entries;history=data.history||[]; if (!Array.isArray(entries)) throw new Error('Invalid leaderboard file'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; entries = []; }
  let pending = Promise.resolve();
  const write = async next => {
    await mkdir(dirname(file), { recursive: true });
    const temp = storageFile + '.' + randomUUID() + '.tmp';
    try { await writeFile(temp, JSON.stringify({ schema: routeMode?2:1, entries: next,...(routeMode?{history}:{} ) }) + '\n', { mode: 0o600 }); await rename(temp, storageFile); }
    catch (e) { await unlink(temp).catch(() => {}); throw e; }
  };
  if(routeMode){history=[...new Map(migrateRouteRecords([...history,...entries],{source:'server-json'}).filter(e=>e.identity?.compatibility==='historical').map(e=>[e.migration.id,e])).values()];await write(entries);}
  // Owner decision 2026-10-20: entries stored under a removed trim move to that model's top trim (docs/OWNER-DECISIONS.md).
  const migrated = canonicalEntries(entries, cars);
  if (migrated.changed) { entries = migrated.entries; await write(entries); }
  const validate = r => validResult(canonicalResult(r, cars), resultContext(r, definitions, version, maps).event, cars);
  const list = (filters = {}) => {
    if(filters.routeId){if(String(filters.history)==='true')return filterEntries(routeHistory(history,filters.routeId,{edition:filters.edition}),{...filters,mapId:undefined,edition:undefined});const c=maps?.routes?.get(filters.routeId);return c?filterEntries(entries.filter(e=>e.routeId===c.id&&e.edition===routeEdition(c)),filters):[];}
    const mapId = filters.mapId || 'riviera';
    return filterEntries(entries.filter(e => (e.mapId || 'riviera') === mapId && e.version === leaderboardVersion(mapId, maps ? maps.get(mapId)?.track.version : version)), { ...filters, mapId });
  };
  const submit = r => {
    r = canonicalResult(r, cars);
    if (!validate(r)) return Promise.reject(Object.assign(new Error('Unknown event/car or implausible result time.'), { status: 400 }));
    const run = pending.then(async () => {
      const { event, version: entryVersion, mapId } = resultContext(r, definitions, version, maps);
      const entry = resultEntry(r, event, entryVersion, mapId);
      const same = e => e.driverId === entry.driverId && boardKey(e) === boardKey(entry);
      const old = entries.find(same);
      if (old && old.time <= entry.time) return { saved: false, best: old.time };
      let next = entries.filter(e => !same(e)); next.push(entry);
      // Bound each route/car/traffic board independently so short routes cannot crowd out long ones.
      const buckets = new Map();
      next = next.sort((a, b) => a.time - b.time).filter(e => {
        const key = boardKey(e);
        const count = (buckets.get(key) || 0) + 1; buckets.set(key, count); return count <= 200;
      });
      if (!next.includes(entry)) return { saved: false, best: old?.time ?? null, reason: 'This board retains its fastest 200 drivers.' };
      const previousHistory=history;if(routeMode){const record=migrateRouteRecords([entry],{source:'server-json'})[0];if(record.identity?.compatibility==='historical')history=[...new Map([...history,record].map(e=>[e.migration.id,e])).values()];}
      try{await write(next);}catch(error){history=previousHistory;throw error;}
      entries = next;
      return { saved: true, best: entry.time };
    });
    pending = run.catch(() => {}); return run;
  };
  return { list, submit, validate, flush: () => pending };
}
