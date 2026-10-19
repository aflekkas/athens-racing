// Player-to-player contacts. Every driver owns their own car, so each client resolves ITS half of a collision: it applies
// the impulse to its own car, with both masses, and tells the other driver. Remote cars are kinematic proxies whose
// authoritative state is never modified here.
//
// Why contacts are symmetric (they used to depend on who was lagging):
//   1. Both sides test against the other car's best-guess PRESENT pose (RemoteTimeline.predict), not the drawn pose, which
//      trails by the jitter buffer plus latency. The drawn pose put a rammer into a car that was already metres ahead and a
//      victim out of reach of a car that was still metres behind, so only one side felt the hit.
//   2. A side that detects a contact also sends it (relayed and checked by the arena). The other side applies the matching
//      impulse to its own car if it has not already detected the same contact, so a missed detection never means a free pass.
//   3. A pair is applied once per contact episode: after a local hit, or after an applied report, further reports and local
//      detections for that pair are ignored for CONTACT_DEDUPE_MS, so a hit is never applied twice.
// Stale streams and recovery ghosts are ignored.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const velocity = v => ({ x: -Math.sin(v.yaw) * v.vLong + Math.cos(v.yaw) * v.vLat, z: -Math.cos(v.yaw) * v.vLong - Math.sin(v.yaw) * v.vLat });
const axes = v => [{ x: Math.cos(v.yaw), z: -Math.sin(v.yaw) }, { x: -Math.sin(v.yaw), z: -Math.cos(v.yaw) }];
const extent = (v, n) => { const [r, f] = axes(v); return Math.abs(r.x*n.x+r.z*n.z)*(v.halfW || 1) + Math.abs(f.x*n.x+f.z*n.z)*(v.halfL || 2.2); };
const massOf = v => v.m || v.spec?.mass || 1500;
export const CONTACT_DEDUPE_MS = 450;      // minimum; see contactWindow()
export const CONTACT_MIN_CLOSING = 1;       // m/s: gentler touches are resolved locally and never reported
export const CONTACT_MAX_AGE_MS = 700;      // a report older than this describes a collision that is over
export const MAX_VELOCITY_DISAGREEMENT = 25; // m/s between a report and the reporter's last known velocity
export const CONTACT_MAX_IMPULSE = 45;      // m/s of velocity change, the same cap as a local hit
// How long a pair stays settled after an exchange: until the other car's post-impact motion can have come back to us, i.e. a
// round trip for the report plus a round trip for their reaction, with a sample interval and a frame of slack.
// Both drivers only react on their own frames, so slow frames stretch it (6 frames of this machine's, standing in for theirs too).
export const contactWindow = (rttMs = 0, frameMs = 0) => clamp(2 * (Number.isFinite(rttMs) ? rttMs : 0) + 250 + 6 * (Number.isFinite(frameMs) ? frameMs : 0), CONTACT_DEDUPE_MS, 2500);

// One car's half of a collision against `remote`, whose velocity at the contact is `remoteVelocity` (default: its own).
// `normal` points from the other car to this one. Returns the hit record, with this car's pre-impulse state for reporting.
function exchange(local, remote, normal, depth, dt, now, contacts, id, remoteVelocity) {
  const a = velocity(local), b = remoteVelocity || velocity(remote);
  const before = { x: local.x, z: local.z, vx: a.x, vz: a.z, m: massOf(local) };
  const closing = Math.max(0, -((a.x-b.x)*normal.x + (a.z-b.z)*normal.z));
  const share = massOf(remote) / (massOf(local) + massOf(remote));
  const impulse = Math.min(CONTACT_MAX_IMPULSE, closing * share);
  a.x += normal.x*impulse; a.z += normal.z*impulse;
  local.vLong = -a.x*Math.sin(local.yaw) - a.z*Math.cos(local.yaw);
  local.vLat = a.x*Math.cos(local.yaw) - a.z*Math.sin(local.yaw);
  const push = Math.min(.35, depth*.5, Math.max(0, dt)*5);
  local.x += normal.x*push; local.z += normal.z*push;
  const projected = local.route?.project(local.x, local.z, local.s, 6);
  if (projected) { local.s = projected.s; local.u = projected.u; }

  const r = axes(local)[0], f = axes(local)[1];
  const side = normal.x*r.x + normal.z*r.z, front = normal.x*f.x + normal.z*f.z;
  local.impactDynamics?.({dv: impulse, nx: normal.x, nz: normal.z,
    forward: clamp((remote.x-local.x)*f.x+(remote.z-local.z)*f.z,-local.halfL,local.halfL),
    right: clamp((remote.x-local.x)*r.x+(remote.z-local.z)*r.z,-local.halfW,local.halfW),
    height: Math.max(.3, Math.min(local.hcg || .5, remote.hcg || .5)), kind: 'car'});
  const zone = Math.abs(front) > Math.abs(side) ? front < 0 ? 'front' : 'rear' : side < 0 ? 'right' : 'left';
  if (closing > 2 && now - (contacts.get(id) ?? -Infinity) > 600) {
    local.addDamage?.(zone, impulse, { kind: 'player', sev: Math.min(closing, 16), car: { mass: massOf(remote) } });
    contacts.set(id, now);
  }
  return { id, zone, closing, impulse, depth, nx: normal.x, nz: normal.z, self: before };
}

export function resolvePlayerContacts(local, proxies, dt, now, contacts = new Map()) {
  const hits = [];
  for (const { id, vehicle: remote, age = 0, ghost = false } of proxies) {
    if (ghost || age > 350 || Math.abs(local.y - remote.y) > 1.5) continue;
    const dx = local.x - remote.x, dz = local.z - remote.z;
    if (Math.hypot(dx, dz) > (local.halfL || 2.2) + (remote.halfL || 2.2) + 1) continue;
    // Separating-axis test. Among the axes the cars are actually closing along, take the shallowest: a predicted pose can arrive
    // already more than a car-width deep, where the shallowest axis overall is the sideways one and the hit would read as zero.
    const a = velocity(local), b = velocity(remote);
    let depth = Infinity, normal, approachDepth = Infinity, approach, hit = true;
    for (const axis of [...axes(local), ...axes(remote)]) {
      const dot = dx*axis.x + dz*axis.z;
      const overlap = extent(local, axis) + extent(remote, axis) - Math.abs(dot);
      if (overlap <= 0) { hit = false; break; }
      const sign = dot >= 0 ? 1 : -1, n = { x: axis.x*sign, z: axis.z*sign };
      if (overlap < depth) { depth = overlap; normal = n; }
      if (overlap < approachDepth && -((a.x-b.x)*n.x + (a.z-b.z)*n.z) > .05) { approachDepth = overlap; approach = n; }
    }
    if (!hit) continue;
    if (approach) { normal = approach; depth = approachDepth; }
    hits.push(exchange(local, remote, normal, depth, dt, now, contacts, id));
  }
  return hits;
}

export class ContactCoordinator {
  // send(event) puts a report on the wire; serverNow() is the arena clock used to age incoming reports.
  constructor({ send = () => {}, serverNow = () => Date.now() } = {}) { this.send = send; this.serverNow = serverNow; this.reset(null); }
  reset(raceId) { this.raceId = raceId; this.frameMs = 16; this.lastStepAt = null; this.pairs = new Map(); this.damage = new Map(); this.nonce = 0; this.stats = { local: 0, sent: 0, received: 0, applied: 0, duplicate: 0, stale: 0, rejected: 0 }; }
  pair(id) { let p = this.pairs.get(id); if (!p) this.pairs.set(id, p = { handledAt: -Infinity, nonceIn: -1, sentAt: -Infinity }); return p; }
  // Detect this car's contacts against the other cars' present poses and apply this car's half; report each new contact.
  step(local, proxies, dt, now, { rtt = 0 } = {}) {
    // Slices of one frame share a `now`; the gap between distinct values is this machine's frame time.
    if (this.lastStepAt !== null && now - this.lastStepAt > 1) this.frameMs += (Math.min(500, now - this.lastStepAt) - this.frameMs) * .1;
    this.lastStepAt = now;
    const window = contactWindow(rtt, this.frameMs);
    // A pair that has just exchanged momentum (here or by a report) is not tested again for CONTACT_DEDUPE_MS: the other car's
    // predicted velocity is still the pre-impact one for a few hundred ms and would be hit again every frame.
    const open = proxies.map(p => ({ ...p, ghost: p.ghost || p.vehicle.stale === true || now - this.pair(p.id).handledAt < window }));
    const hits = resolvePlayerContacts(local, open, dt, now, this.damage);
    for (const hit of hits) {
      const pair = this.pair(hit.id);
      this.stats.local++;
      if (hit.closing < CONTACT_MIN_CLOSING) continue;
      pair.handledAt = now;
      if (now - pair.sentAt < window) continue;
      pair.sentAt = now; this.stats.sent++;
      this.send({ to: hit.id, nonce: this.nonce++, x: hit.self.x, z: hit.self.z, vx: hit.self.vx, vz: hit.self.vz, m: hit.self.m, nx: hit.nx, nz: hit.nz, closing: hit.closing });
    }
    return hits;
  }
  // A report from the other driver, relayed by the arena: `event` = { from, nonce, at, x, z, vx, vz, m, nx, nz }. Applies this
  // car's matching impulse unless this contact was already handled here. Returns the hit, or null when it was not applied.
  receive(event, local, now, { ghost = false, rtt = 0, knownVelocity = null } = {}) {
    this.stats.received++;
    const pair = this.pair(event.from);
    if (!(event.nonce > pair.nonceIn)) { this.stats.duplicate++; return null; }
    pair.nonceIn = event.nonce;
    // `at` is when the arena got the report: add the reporter's leg to it (assumed like this driver's own half round trip).
    const age = this.serverNow() - event.at + (Number.isFinite(rtt) ? clamp(rtt, 0, 1000) / 2 : 0);
    if (ghost || !(age <= CONTACT_MAX_AGE_MS)) { this.stats.stale++; return null; }
    if (now - pair.handledAt < contactWindow(rtt, this.frameMs)) { this.stats.duplicate++; return null; } // already resolved locally (or already applied)
    const finite = [event.x, event.z, event.vx, event.vz, event.m, event.nx, event.nz].every(Number.isFinite);
    if (!finite || event.m < 100 || event.m > 100000) { this.stats.rejected++; this.stats.malformed = (this.stats.malformed || 0) + 1; return null; }
    // The reporter was touching this car when it sent the report. By now it has moved on at its reported velocity, so test against
    // where it would be, and allow for what both cars have done since.
    const seconds = Math.max(0, age) / 1000, ex = event.x + event.vx * seconds, ez = event.z + event.vz * seconds;
    const dx = local.x - ex, dz = local.z - ez, relative = Math.hypot(velocity(local).x - event.vx, velocity(local).z - event.vz);
    // Generous on purpose: the report's age is an estimate (a stalled link makes it low) and cars move tens of metres a second.
    // The arena has already checked both drivers were within 30 m; what matters here is that it is not a shove from nowhere.
    const reach = (local.halfL || 2.2) * 2 + 11 + relative * (seconds + .3);
    const distance = Math.hypot(dx, dz);
    if (distance > reach || distance < 1e-3) { this.stats.rejected++; this.stats.far = (this.stats.far || 0) + 1; return null; }
    // Normal from the reporter to this car (the report's normal runs the other way); fall back to the line between them.
    let normal = { x: -event.nx, z: -event.nz };
    const length = Math.hypot(normal.x, normal.z);
    if (length < .5 || normal.x * dx + normal.z * dz <= 0) normal = { x: dx / distance, z: dz / distance }; else { normal.x /= length; normal.z /= length; }
    // The reported velocity must be what the other car was doing, as far as this side knows: a cheater cannot buy a bigger shove.
    if (knownVelocity && Math.hypot(knownVelocity.x - event.vx, knownVelocity.z - event.vz) > MAX_VELOCITY_DISAGREEMENT) { this.stats.rejected++; this.stats.implausible = (this.stats.implausible || 0) + 1; return null; }
    const remote = { x: ex, y: local.y, z: ez, yaw: local.yaw, m: event.m, halfL: 2.2, halfW: 1 };
    const hit = exchange(local, remote, normal, .3, .016, now, this.damage, event.from, { x: event.vx, z: event.vz });
    pair.handledAt = now; this.stats.applied++;
    return hit;
  }
}

export function containOnlineVehicle(vehicle, route) {
  if (!route || route.closed || vehicle.bodyDynamic) return;
  const s = clamp(vehicle.s, 3, route.length - 3), edge = Math.max(4, route.edge(s) + 8), u = clamp(vehicle.u, -edge, edge);
  if (s === vehicle.s && u === vehicle.u) return;
  const point = route.point(s, u);
  Object.assign(vehicle, point, { s, u, vLong: 0, vLat: 0, w: 0 });
  vehicle.syncWheels?.();
}
