import { resultContext, validResult, resultEntry, leaderboardVersion, boardKey, filterEntries, canonicalResult, canonicalEntries } from '../server/leaderboard-policy.mjs';
import { LEGACY_CAR_IDS } from '../src/car-ids.js';

export function createSqlLeaderboard(sql, maps, cars) {
  sql.exec(`CREATE TABLE IF NOT EXISTS times (
    key TEXT PRIMARY KEY, board TEXT NOT NULL, mapId TEXT NOT NULL, version TEXT NOT NULL,
    eventId TEXT NOT NULL, car TEXT NOT NULL, traffic INTEGER NOT NULL,
    time REAL NOT NULL, at INTEGER NOT NULL, entry TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS times_board ON times(board, time);
    CREATE INDEX IF NOT EXISTS times_lookup ON times(mapId, version, eventId, car, traffic, time, at);`);
  // Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): rows stored under a removed trim move to that model's top trim, lose their trim
  // fields, and a driver's duplicates on one board keep the fastest time. Runs once; later starts find nothing to change.
  const legacy = Object.keys(LEGACY_CAR_IDS).filter(id => !cars.has(id)), marks = legacy.map(() => '?').join(',');
  if ([...sql.exec(`SELECT 1 FROM times WHERE car IN (${marks}) OR entry LIKE '%"carTrim"%' OR entry LIKE '%"carGeneration"%' LIMIT 1`, ...legacy)].length) {
    const { entries, changed } = canonicalEntries([...sql.exec('SELECT entry FROM times')].map(row => JSON.parse(row.entry)), cars);
    if (changed) {
      sql.exec('DELETE FROM times');
      for (const e of entries) { const board = boardKey(e); sql.exec('INSERT OR REPLACE INTO times VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', JSON.stringify([board, e.driverId]), board, e.mapId || 'riviera', e.version, e.eventId, e.car, +e.traffic, e.time, e.at, JSON.stringify(e)); }
    }
  }
  const submit = async r => {
    r = canonicalResult(r, cars);
    const { event, version, mapId } = resultContext(r, null, null, maps);
    if (!validResult(r, event, cars)) throw Object.assign(new Error('Unknown event/car or implausible result time.'), { status: 400 });
    const entry = resultEntry(r, event, version, mapId);
    const board = boardKey(entry), key = JSON.stringify([board, r.driverId]);
    const old = [...sql.exec('SELECT time FROM times WHERE key = ?', key)][0];
    if (old && old.time <= entry.time) return { saved: false, best: old.time };
    const worst = [...sql.exec('SELECT time FROM times WHERE board = ? ORDER BY time LIMIT 1 OFFSET 199', board)][0];
    if (!old && worst && entry.time >= worst.time) return { saved: false, best: null, reason: 'This board retains its fastest 200 drivers.' };
    sql.exec('INSERT OR REPLACE INTO times VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', key, board, mapId, version, r.eventId, r.car, +entry.traffic, r.time, entry.at, JSON.stringify(entry));
    sql.exec('DELETE FROM times WHERE key IN (SELECT key FROM times WHERE board = ? ORDER BY time, at LIMIT -1 OFFSET 200)', board);
    return { saved: true, best: entry.time };
  };
  const list = (filters = {}) => {
    const mapId = filters.mapId || 'riviera';
    // Apply JSON setup filters before limiting; legacy rows have no setup and only match unfiltered views.
    const rows = [...sql.exec('SELECT entry FROM times WHERE mapId = ? AND version = ? ORDER BY time, at', mapId, leaderboardVersion(mapId, maps.get(mapId)?.track.version || ''))];
    return filterEntries(rows.map(row => JSON.parse(row.entry)), { ...filters, mapId });
  };
  return { submit, list };
}
