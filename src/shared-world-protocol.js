// Quantized road-space world snapshots. No rendering dependencies: the arena validates
// and relays these without running the traffic simulation. All packets fit its 4 KiB cap.
export const WORLD_HZ = 5;
export const WORLD_CARS = 66;
export const WORLD_POLICE = 8; // the police pool follows the traffic pool: ids WORLD_CARS .. WORLD_IDS - 1
export const WORLD_IDS = WORLD_CARS + WORLD_POLICE;
// FLAGS: 1 crashed, 2 wreck, 4 parked, 8 crossing, 16 braking; police: 32 lights, 64 chasing, bits 7-10 = target grid slot + 1
export const copFlags = cop => cop ? (cop.siren || cop.block ? 32 : 0) | (cop.chase ? 64 : 0) | ((Number.isSafeInteger(cop.target) && cop.target >= 0 && cop.target < 15 ? cop.target + 1 : 0) << 7) : 0;
export const WORLD_CONES = 256;
export const CAR = Object.freeze({ ID: 0, S: 1, U: 2, VS: 3, VU: 4, YAW: 5, W: 6, Y: 7, VY: 8, ROLL: 9, PITCH: 10, GY: 11, DIR: 12, FLAGS: 13, WHEEL: 14, STEER: 15, FRONT: 16, REAR: 17, LEFT: 18, RIGHT: 19, BLINK: 20, ROLLV: 21, PITCHV: 22, DAMAGE: 23 });
export const ZONES = ['front', 'rear', 'left', 'right'];
export const nearestWorldS = (s, focus, period) => period > 0 ? s + Math.round((focus - s) / period) * period : s;
export const worldOwner = lobby => {
  const eligible = p => p.loaded === true && p.connected !== false && !p.dnf;
  const players = Array.isArray(lobby?.players) ? lobby.players : [...(lobby?.players?.values() || [])];
  return (players.find(p => p.id === lobby.host && eligible(p)) || players.find(eligible))?.id || null;
};
const quantize = (n, scale = 100) => Math.round((Number.isFinite(n) ? n : 0) * scale);
export function packCar(traffic, c) {
  const b = traffic.carBody(c, {}), k = c.crash;
  const row = [c.id, quantize(c.s), quantize(c.u), quantize(b.vs), quantize(b.vu), quantize(b.phi, 1000), quantize(b.w, 1000), quantize(k?.y), quantize(k?.vy), quantize(k?.roll, 1000), quantize(k?.pitch, 1000), quantize(k?.gy), c.dir < 0 ? -1 : 1,
    (k ? 1 : 0) | (k?.wreck ? 2 : 0) | (c.mode === 'parked' ? 4 : 0) | (c.cross ? 8 : 0) | (c.braking ? 16 : 0) | (c.police ? copFlags(c.cop) : 0), quantize(c.wheel), quantize(c.steerA, 1000), ...ZONES.map(z => quantize(c.dz?.[z], 1000)), (c.indL?.emissiveIntensity > 1 ? 1 : 0) | (c.indR?.emissiveIntensity > 1 ? 2 : 0) | (c.flash?.emissiveIntensity > 1 ? 4 : 0), quantize(k?.rollV, 1000), quantize(k?.pitchV, 1000), quantize(c.dmg)];
  if (c.rider) row.push(...['s','u','y','yaw','vs','vu','vy','age'].map(k => quantize(c.rider[k])));
  return row;
}
export function packCone(k, id) { return [id, ...['s', 'u', 'y', 'vs', 'vu', 'vy'].map(key => quantize(k[key])), ...['rx', 'rz', 'w'].map(key => quantize(k[key], 1000))]; }
const integers = row => row.every(n => Number.isSafeInteger(n) && Math.abs(n) <= 2e9);
export function validCarRow(row) {
  return Array.isArray(row) && (row.length === 24 || row.length === 32) && (row.length === 24 || Math.abs(row[25]) <= 100000 && row[28] >= -20000 && row[28] <= 20000 && Math.abs(row[29]) <= 20000 && row[30] >= 0 && row[30] <= 2000 && row[31] >= 0 && row[31] <= 360000) && integers(row) && row[0] >= 0 && row[0] < WORLD_IDS && Math.abs(row[2]) <= 100000 && Math.abs(row[3]) <= 20000 && Math.abs(row[4]) <= 20000 && Math.abs(row[6]) <= 50000 && Math.abs(row[7]) <= 10000 && Math.abs(row[8]) <= 20000 && Math.abs(row[12]) === 1 && row[13] >= 0 && row[13] <= 2047 && (row[0] >= WORLD_CARS || row[13] <= 31) && row.slice(16, 20).every(n => n >= 0 && n <= 1000) && row[20] >= 0 && row[20] <= 7;
}
export function validConeRow(row) { return Array.isArray(row) && row.length === 10 && integers(row) && row[0] >= 0 && row[0] < WORLD_CONES && Math.abs(row[2]) <= 100000 && row.slice(4, 7).every(n => Math.abs(n) <= 20000); }
export function worldPackets(base, rows, cones) {
  const { raceId, generation, owner, seq, at, now } = base, header = { raceId, generation, owner, seq, at, ...(Number.isFinite(now) ? { now } : {}) };
  const overhead = JSON.stringify({ ...header, type: 'world-frame', part: 7, total: 8, rows: [], cones: [] }).length;
  const groups = [{ rows: [], cones: [] }];
  let size = overhead;
  for (const [key, list] of [['rows', rows], ['cones', cones]]) for (const row of list) {
    let group = groups.at(-1); const bytes = JSON.stringify(row).length + 1;
    if (size + bytes > 3700) { group = { rows: [], cones: [] }; groups.push(group); size = overhead; }
    group[key].push(row); size += bytes;
  }
  if (groups.length > 8) throw new Error('Shared world exceeds packet budget');
  return groups.map((group, part) => ({ ...header, type: 'world-frame', part, total: groups.length, ...group }));
}
export function validWorldPart(m) {
  return m?.type === 'world-frame' && Number.isSafeInteger(m.seq) && m.seq >= 0 && Number.isFinite(m.at) && Number.isSafeInteger(m.total) && m.total >= 1 && m.total <= 8 && Number.isSafeInteger(m.part) && m.part >= 0 && m.part < m.total && Array.isArray(m.rows) && m.rows.length <= WORLD_IDS && m.rows.every(validCarRow) && Array.isArray(m.cones) && m.cones.length <= WORLD_CONES && m.cones.every(validConeRow);
}
export class WorldAssembler {
  constructor() { this.clear(); }
  clear() { this.pending = null; this.last = null; }
  accept(m) {
    if (!validWorldPart(m)) return null;
    const key = `${m.raceId}:${m.generation}:${m.owner}`;
    if (this.last?.key === key && m.seq <= this.last.seq) return null;
    if (!this.pending || this.pending.key !== key || this.pending.seq < m.seq) this.pending = { key, seq: m.seq, total: m.total, at: m.at, parts: new Map() };
    const p = this.pending;
    if (p.seq !== m.seq || p.total !== m.total || p.at !== m.at) return null;
    p.parts.set(m.part, m);
    if (p.parts.size !== p.total) return null;
    const parts = [...p.parts.values()].sort((a, b) => a.part - b.part), rows = parts.flatMap(x => x.rows), cones = parts.flatMap(x => x.cones);
    if (rows.length > WORLD_IDS || cones.length > WORLD_CONES || new Set(rows.map(r => r[0])).size !== rows.length || new Set(cones.map(r => r[0])).size !== cones.length) return null;
    this.last = { key, seq: m.seq };
    return { ...m, rows, cones, parts };
  }
}
