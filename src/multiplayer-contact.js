// Kinematic remote proxies: bounded horizontal impulses, no vertical/angular
// launch and no modification of remote authoritative state. Both owners resolve
// their own half of the contact. Stale streams and recovery ghosts are ignored.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const velocity = v => ({ x: -Math.sin(v.yaw) * v.vLong + Math.cos(v.yaw) * v.vLat, z: -Math.cos(v.yaw) * v.vLong - Math.sin(v.yaw) * v.vLat });
const axes = v => [{ x: Math.cos(v.yaw), z: -Math.sin(v.yaw) }, { x: -Math.sin(v.yaw), z: -Math.cos(v.yaw) }];
const extent = (v, n) => { const [r, f] = axes(v); return Math.abs(r.x*n.x+r.z*n.z)*(v.halfW || 1) + Math.abs(f.x*n.x+f.z*n.z)*(v.halfL || 2.2); };
export function resolvePlayerContacts(local, proxies, dt, now, contacts = new Map()) {
  const hits = [];
  for (const { id, vehicle: remote, age = 0, ghost = false } of proxies) {
    if (ghost || age > 350 || Math.abs(local.y - remote.y) > 1.5) continue;
    const dx = local.x - remote.x, dz = local.z - remote.z;
    if (Math.hypot(dx, dz) > (local.halfL || 2.2) + (remote.halfL || 2.2) + 1) continue;
    let depth = Infinity, normal;
    for (const axis of [...axes(local), ...axes(remote)]) {
      const dot = dx*axis.x + dz*axis.z;
      const overlap = extent(local, axis) + extent(remote, axis) - Math.abs(dot);
      if (overlap <= 0) { normal = null; break; }
      if (overlap < depth) { depth = overlap; const sign = dot >= 0 ? 1 : -1; normal = { x: axis.x*sign, z: axis.z*sign }; }
    }
    if (!normal) continue;
    const a = velocity(local), b = velocity(remote);
    const closing = Math.max(0, -((a.x-b.x)*normal.x + (a.z-b.z)*normal.z));
    const share = (remote.m || remote.spec?.mass || 1500) / ((local.m || 1500) + (remote.m || remote.spec?.mass || 1500));
    const impulse = Math.min(8, closing * share);
    a.x += normal.x*impulse; a.z += normal.z*impulse;
    local.vLong = -a.x*Math.sin(local.yaw) - a.z*Math.cos(local.yaw);
    local.vLat = a.x*Math.cos(local.yaw) - a.z*Math.sin(local.yaw);
    const push = Math.min(.35, depth*.5, Math.max(0, dt)*5);
    local.x += normal.x*push; local.z += normal.z*push;
    const projected = local.route?.project(local.x, local.z, local.s, 6);
    if (projected) { local.s = projected.s; local.u = projected.u; }
    local.w = clamp(local.w || 0, -1.5, 1.5);
    const r = axes(local)[0], f = axes(local)[1];
    const side = normal.x*r.x + normal.z*r.z, front = normal.x*f.x + normal.z*f.z;
    const zone = Math.abs(front) > Math.abs(side) ? front < 0 ? 'front' : 'rear' : side < 0 ? 'right' : 'left';
    if (closing > 2 && now - (contacts.get(id) ?? -Infinity) > 600) {
      local.addDamage?.(zone, impulse, { kind: 'player', sev: Math.min(closing, 16), car: { mass: remote.m || remote.spec?.mass || 1500 } });
      contacts.set(id, now);
    }
    hits.push({ id, zone, closing, impulse, depth });
  }
  return hits;
}

export function containOnlineVehicle(vehicle, route) {
  if (!route || route.closed) return;
  const s = clamp(vehicle.s, 3, route.length - 3), edge = Math.max(4, route.edge(s) + 8), u = clamp(vehicle.u, -edge, edge);
  if (s === vehicle.s && u === vehicle.u) return;
  const point = route.point(s, u);
  Object.assign(vehicle, point, { s, u, vLong: 0, vLat: 0, w: 0 });
  vehicle.syncWheels?.();
}
