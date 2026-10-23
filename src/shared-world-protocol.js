import {validRouteIdentity,sameRouteIdentity} from './route-network.js';
// Quantized road-space world snapshots. No rendering dependencies: the arena validates
// and relays these without running the traffic simulation. All packets fit its 4 KiB cap.
export const WORLD_HZ = 5;
export const WORLD_MAX_PARTS=24;
export const WORLD_MAX_PACKETS_PER_SECOND=30;
export const WORLD_CAR=Object.freeze({X:32,Y:33,Z:34,LAYER:35,VX:36,VZ:37,CONTACT:38,RESERVED:39});
export const WORLD_CONE=Object.freeze({X:10,Y:11,Z:12,LAYER:13,VX:14,VZ:15,CONTACT:16,RESERVED:17});
export const worldFrameIntervalMs=parts=>Math.max(1000/WORLD_HZ,1000*parts/WORLD_MAX_PACKETS_PER_SECOND);
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
// Rider coordinates use centimetres: allow 100 km of road and elevations up to
// 2 km in either direction; yaw permits repeated turns but rejects corrupt seeds.
function validLegacyCarRow(row) {
  return Array.isArray(row) && (row.length === 24 || row.length === 32) && (row.length === 24 || Math.abs(row[24]) <= 10000000 && Math.abs(row[25]) <= 100000 && Math.abs(row[26]) <= 200000 && Math.abs(row[27]) <= 100000 && row[28] >= -20000 && row[28] <= 20000 && Math.abs(row[29]) <= 20000 && row[30] >= 0 && row[30] <= 2000 && row[31] >= 0 && row[31] <= 360000) && integers(row) && row[0] >= 0 && row[0] < WORLD_IDS && Math.abs(row[2]) <= 100000 && Math.abs(row[3]) <= 20000 && Math.abs(row[4]) <= 20000 && Math.abs(row[6]) <= 50000 && Math.abs(row[7]) <= 10000 && Math.abs(row[8]) <= 20000 && Math.abs(row[12]) === 1 && row[13] >= 0 && row[13] <= 2047 && (row[0] >= WORLD_CARS || row[13] <= 31) && row.slice(16, 20).every(n => n >= 0 && n <= 1000) && row[20] >= 0 && row[20] <= 7;
}
function validLegacyConeRow(row) { return Array.isArray(row) && row.length === 10 && integers(row) && row[0] >= 0 && row[0] < WORLD_CONES && Math.abs(row[2]) <= 100000 && row.slice(4, 7).every(n => Math.abs(n) <= 20000); }
export function validWorldCarRow(row){
 if(!Array.isArray(row)||row.length!==40||!integers(row)||!validLegacyCarRow(row.slice(0,24))||Math.abs(row[32])>1e7||Math.abs(row[33])>1e6||Math.abs(row[34])>1e7||Math.abs(row[35])>16||Math.abs(row[36])>20000||Math.abs(row[37])>20000||row[38]<0||row[38]>3||row[39]!==0)return false;
 if(!(row[38]&2))return row.slice(24,32).every(n=>n===0);
 return Math.abs(row[24])<=1e7&&Math.abs(row[25])<=1e7&&Math.abs(row[26])<=1e6&&Math.abs(row[27])<=100000&&Math.abs(row[28])<=20000&&Math.abs(row[29])<=20000&&Math.abs(row[30])<=20000&&row[31]>=0&&row[31]<=360000;
}
export const validCarRow=row=>validLegacyCarRow(row)||validWorldCarRow(row);
export function validWorldConeRow(row){return Array.isArray(row)&&row.length===18&&integers(row)&&validLegacyConeRow(row.slice(0,10))&&Math.abs(row[10])<=1e7&&Math.abs(row[11])<=1e6&&Math.abs(row[12])<=1e7&&Math.abs(row[13])<=16&&Math.abs(row[14])<=20000&&Math.abs(row[15])<=20000&&row[16]>=0&&row[16]<=1&&row[17]===0;}
export const validConeRow=row=>validLegacyConeRow(row)||validWorldConeRow(row);
export function packWorldCar(traffic,c){
 const row=packCar(traffic.pool||traffic,c).slice(0,24),v=c.vehicle||c.veh||c,point=c.point||v;row[5]=quantize(v.yaw,1000);
 if(c.rider)row.push(...['x','z','y','yaw','vx','vz','vy','age'].map(k=>quantize(c.rider[k])));else row.push(...Array(8).fill(0));
 row.push(quantize(v.x),quantize(v.y),quantize(v.z),point.layer??v.layer??0,quantize(-Math.sin(v.yaw)*v.vLong+Math.cos(v.yaw)*(v.vLat||0)),quantize(-Math.cos(v.yaw)*v.vLong-Math.sin(v.yaw)*(v.vLat||0)),(v.air?0:1)|(c.rider?2:0),0);return row;
}
export function packWorldCone(k,id){return [...packCone(k,id),quantize(k.x),quantize(k.y),quantize(k.z),k.layer??0,quantize(k.vx),quantize(k.vz),k.air?0:1,0];}
const hasRouteBinding=m=>m.mapId!==undefined||m.routeIdentity!==undefined;
const validBinding=m=>!hasRouteBinding(m)||validRouteIdentity(m.routeIdentity)&&m.mapId===m.routeIdentity.routeId;
export function worldPackets(base, rows, cones) {
  const { raceId, generation, owner, seq, at, now, mapId, routeIdentity } = base, header = { raceId, generation, owner, seq, at, ...(hasRouteBinding(base)?{mapId,routeIdentity}:{}), ...(Number.isFinite(now) ? { now } : {}) };
  if(!validBinding(base))throw Error('Shared world route identity unavailable');
  const maxParts=hasRouteBinding(base)?WORLD_MAX_PARTS:8;
  const overhead = JSON.stringify({ ...header, type: 'world-frame', part: maxParts-1, total: maxParts, rows: [], cones: [] }).length;
  const groups = [{ rows: [], cones: [] }];
  let size = overhead;
  for (const [key, list] of [['rows', rows], ['cones', cones]]) for (const row of list) {
    let group = groups.at(-1); const bytes = JSON.stringify(row).length + 1;
    if (size + bytes > 3700) { group = { rows: [], cones: [] }; groups.push(group); size = overhead; }
    group[key].push(row); size += bytes;
  }
  if (groups.length > maxParts) throw new Error('Shared world exceeds packet budget');
  return groups.map((group, part) => ({ ...header, type: 'world-frame', part, total: groups.length, ...group }));
}
export function validWorldPart(m) {
  return m?.type === 'world-frame' && validBinding(m) && Number.isSafeInteger(m.seq) && m.seq >= 0 && Number.isFinite(m.at) && Number.isSafeInteger(m.total) && m.total >= 1 && m.total <= (hasRouteBinding(m)?WORLD_MAX_PARTS:8) && Number.isSafeInteger(m.part) && m.part >= 0 && m.part < m.total && Array.isArray(m.rows) && m.rows.length <= WORLD_IDS && m.rows.every(hasRouteBinding(m)?validWorldCarRow:validLegacyCarRow) && Array.isArray(m.cones) && m.cones.length <= WORLD_CONES && m.cones.every(hasRouteBinding(m)?validWorldConeRow:validLegacyConeRow);
}
export class WorldAssembler {
  constructor() { this.clear(); }
  clear() { this.pending = null; this.last = null; }
  accept(m) {
    if (!validWorldPart(m)) return null;
    const key = JSON.stringify([m.raceId,m.generation,m.owner,m.mapId||null,m.routeIdentity||null]);
    if (this.last?.key === key && m.seq <= this.last.seq) return null;
    if (!this.pending || this.pending.key !== key || this.pending.seq < m.seq) this.pending = { key, seq: m.seq, total: m.total, at: m.at, routeIdentity:m.routeIdentity,mapId:m.mapId,parts: new Map() };
    const p = this.pending;
    if (p.seq !== m.seq || p.total !== m.total || p.at !== m.at || p.mapId!==m.mapId || hasRouteBinding(m)&&!sameRouteIdentity(p.routeIdentity,m.routeIdentity)) return null;
    p.parts.set(m.part, m);
    if (p.parts.size !== p.total) return null;
    const parts = [...p.parts.values()].sort((a, b) => a.part - b.part), rows = parts.flatMap(x => x.rows), cones = parts.flatMap(x => x.cones);
    if (rows.length > WORLD_IDS || cones.length > WORLD_CONES || new Set(rows.map(r => r[0])).size !== rows.length || new Set(cones.map(r => r[0])).size !== cones.length) return null;
    this.last = { key, seq: m.seq };
    return { ...m, rows, cones, parts };
  }
}
