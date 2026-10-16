// Only numerical simulation state crosses the worker boundary; rigs and vehicle references stay local.
const arrays = ['p', 'prev', 'rest', 'radius', 'floor'];
const scalars = ['active', 'age', 'acc', 'quiet', 'sleeping', 'groundS', 'kind', 'seed', 'maxRise'];
export function snapshotBody(b, result = false) {
  const s = { ...(result ? {} : { links: b.links }), car: snapshotCar(b.car) };
  for (const key of arrays) if (!result || key === 'p' || key === 'prev' || key === 'floor') s[key] = b[key].slice();
  for (const key of scalars) s[key] = b[key];
  return s;
}
export function snapshotCar(c) {
  if (!c) return null;
  const v = c.veh;
  return { x: v ? v.x : c.x, y: v ? v.y || 0 : c.y, z: v ? v.z : c.z, yaw: v ? v.yaw : c.yaw,
    vx: v ? -Math.sin(v.yaw)*v.vLong+Math.cos(v.yaw)*(v.vLat||0) : c.vx,
    vz: v ? -Math.cos(v.yaw)*v.vLong-Math.sin(v.yaw)*(v.vLat||0) : c.vz,
    halfL: c.halfL, halfW: c.halfW, height: c.height };
}
export function restoreBody(b, s, localCar = false) {
  for (const key of arrays) if (s[key]) b[key].set(s[key]);
  for (const key of scalars) b[key] = s[key];
  if (s.links) b.links = s.links;
  if (!localCar || !s.car) b.car = s.car;
}
export const bodyTransfers = s => arrays.filter(key => s[key]).map(key => s[key].buffer);
// A single transferable per crowd phase avoids detaching one buffer per joint array/body.
export function packRagdolls(messages) {
  const fields = [];
  for (const m of messages) {
    const s = m.state || m;
    for (const key of arrays) if (s[key] instanceof Float64Array) fields.push([s, key, s[key]]);
  }
  const data = new Float64Array(fields.reduce((n,f)=>n+f[2].length,0));
  let offset = 0;
  for (const [s,key,value] of fields) { data.set(value,offset); s[key] = { offset, length: value.length }; offset += value.length; }
  return { messages, data };
}
export function unpackRagdolls({ messages, data }) {
  for (const m of messages) {
    const s = m.state || m;
    for (const key of arrays) if (s[key] && Number.isInteger(s[key].offset)) s[key] = data.subarray(s[key].offset,s[key].offset+s[key].length);
  }
  return messages;
}
