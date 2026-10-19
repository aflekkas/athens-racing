import { CAR, ZONES, WORLD_HZ, worldOwner, worldPackets, WorldAssembler, packCar, packCone } from './shared-world-protocol.js';
import { RNG } from './util.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
/** The traffic seed of a race: the same `raceId:generation` text gives every client the same sequence. */
export const trafficSeed = text => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const seed = trafficSeed;
export function applySharedCar(traffic, row, age = 0, promote = false) {
  const c = traffic.cars[row[0]]; if (!c) return;
  const fresh = !c.active, flags = row[CAR.FLAGS], k = !!(flags & 1), dir = row[CAR.DIR];
  if (c.police) { // a shared unit: its lights, whether it is chasing and whom (grid slot)
    const cop = c.cop || (c.cop = { mode: 'patrol', tactic: 'tail', tacT: 0, side: 0, losT: 0, sees: false, down: false, wasChasing: false });
    cop.siren = !!(flags & 32); cop.chase = !!(flags & 64); cop.target = (flags >> 7 & 15) - 1; if (cop.target < 0) cop.target = null; cop.keep = true;
    if (cop.chase) cop.wasChasing = true;
  }
  if (fresh || promote) { traffic.initDrive(c, false); c.lane = Math.max(0, Math.round((Math.abs(row[CAR.U] / 100) - 1.5) / 3.3)); }
  c._world=null;c._roundabout=null;c._sharedPosition=true;
  c.active = true; c.dir = dir; c.s = row[CAR.S] / 100 + row[CAR.VS] / 100 * age; c.u = row[CAR.U] / 100 + row[CAR.VU] / 100 * age;
  c.v = Math.hypot(row[CAR.VS], row[CAR.VU]) / 100; c.uv = row[CAR.VU] / 100; c.v0 = traffic.roadSpeed(c.s) * (c.drv?.vf || 1);
  c.mode = flags & 4 ? 'parked' : 'drive'; c.parkT = 1e9; c.braking = !!(flags & 16); c.acc = 0;
  c.yawLC = row[CAR.YAW] / 1000 - (dir < 0 ? Math.PI : 0); c.cross = !promote && flags & 8 ? { online: true } : null;
  c.xyaw = c.yawLC; c.xvs = row[CAR.VS] / 100; c.xvu = row[CAR.VU] / 100;
  c.wheel = row[CAR.WHEEL] / 100 + c.v * age; c.steerA = row[CAR.STEER] / 1000; c.dmg = row[CAR.DAMAGE] / 100;
  c.indL.emissiveIntensity = row[CAR.BLINK] & 1 ? 3.5 : 0; c.indR.emissiveIntensity = row[CAR.BLINK] & 2 ? 3.5 : 0;
  c.flash.emissiveIntensity = row[CAR.BLINK] & 4 ? 5 : 0;
  c.crash = k ? { t: 1, brake: 1, rec: 0, vs: row[CAR.VS] / 100, vu: row[CAR.VU] / 100, w: row[CAR.W] / 1000, yaw: c.yawLC + row[CAR.W] / 1000 * age, y: Math.max(0, row[CAR.Y] / 100 + row[CAR.VY] / 100 * age), vy: row[CAR.VY] / 100, roll: row[CAR.ROLL] / 1000, pitch: row[CAR.PITCH] / 1000, gy: row[CAR.GY] / 100, rollV: row[CAR.ROLLV] / 1000, pitchV: row[CAR.PITCHV] / 1000, wreck: !!(flags & 2), onSide: Math.abs(row[CAR.ROLL]) > 1100 } : null;
  if (row.length === 32) {
    const r = c.rider;
    if (!r || r.s !== row[24]/100 || r.u !== row[25]/100 || r.y !== row[26]/100 || r.yaw !== row[27]/100 || r.vs !== row[28]/100 || r.vu !== row[29]/100 || r.vy !== row[30]/100) {
      c.rider = Object.fromEntries(['s','u','y','yaw','vs','vu','vy','age'].map((k,i) => [k,row[24+i]/100]));
    }
    c.rider.age = row[31]/100 + age;
  } else { c.rider = null; }
  c.dz = Object.fromEntries(ZONES.map((z, i) => [z, row[CAR.FRONT + i] / 1000]));
  c.m.setDamageSnapshot?.(c.dz);
  return c;
}
export function applySharedCone(k, row, age = 0) {
  if (!k) return;
  const keys = ['s', 'u', 'y', 'vs', 'vu', 'vy', 'rx', 'rz', 'w'];
  keys.forEach((key, i) => { k[key] = row[i + 1] / (i < 6 ? 100 : 1000); });
  k.hit = true; k.s += k.vs * age; k.u += k.vu * age; k.y = Math.max(0, k.y + k.vy * age - 4.905 * age * age); k.rx += k.w * age; k.rz += k.w * .6 * age;
}

/** Only this module owns online traffic. A guest never runs private NPC AI. */
export class SharedWorld {
  constructor(mp, runtime) { this.mp = mp; this.runtime = runtime; this.assembler = new WorldAssembler(); this.predictions = new Map(); this.cooldowns = new Map(); this.seq = 0; this.nonce = 0; this.stats = { sent: 0, bytes: 0, contactsSent: 0, contactsReceived: 0, received: 0 }; }
  configure() {
    const r = this.runtime(), l = this.mp.lobby, key = l?.raceId ? `${l.raceId}:${l.generation}` : null;
    if (key && r.G) r.G.trafficMul = l.config?.traffic || 0;
    if (this.traffic !== r.traffic || this.key !== key) {
      if (this.traffic) { this.traffic.online = null; this.traffic.onlineFoci = null; this.traffic.onlineBudget = null; }
      this.traffic = r.traffic; this.key = key; this.authority = false; this.frame = null; this.seq = 0; this.lastSent = -Infinity; this.assembler.clear(); this.predictions.clear(); this.cooldowns.clear();
      if (key) {
        this.traffic.online = this; this.traffic.rng = new RNG(seed(key));
        this.traffic.allowClosedRoam = (l.config?.traffic || 0) > 0; this.traffic.disabled = true; this.traffic.reset(r.player.veh.s);
      }
    }
    if (!key) return r;
    const authority = worldOwner(l) === this.mp.id;
    if (authority && !this.authority) {
      if (this.frame) this.apply(this.frame, true);
      else { this.traffic.disabled = !(l.config?.traffic > 0); this.traffic.onlineBudget = Math.min(66, 18 + 12 * l.players.length); this.traffic.reset(r.player.veh.s); }
      this.lastSent = -Infinity;
    }
    this.authority = authority; this.traffic.disabled = !(l.config?.traffic > 0) || !authority;
    return r;
  }
  update(dt) {
    const r = this.configure(), l = this.mp.lobby; if (!this.key || !['countdown', 'race'].includes(l.status)) return;
    const tr = this.traffic;
    if (this.authority) {
      const racing = r.remotes.filter(x => x.member?.loaded && x.member.connected !== false && !x.member.dnf);
      const actors = [{ veh: r.player.veh, kind: 'player', slot: this.mp.me?.gridSlot ?? 0 }, ...racing.map(x => ({ veh: x.car.veh, kind: 'remote', slot: x.member.gridSlot }))];
      const foci = []; for (const a of actors) if (!foci.some(s => Math.abs(s - a.veh.s) < 250)) foci.push(a.veh.s);
      tr.onlineFoci = foci; tr.onlineBudget = Math.min(66, 18 + 12 * actors.length);
      const focus = foci[(this.focus = ((this.focus || 0) + 1) % Math.max(1, foci.length))] ?? r.player.veh.s;
      tr.update(dt, focus, actors);
      // Shared police: this client runs every driver's units from the pursuit each driver's own client judged.
      if (tr.police?.enabled && tr.police.online) tr.police.dispatch(dt, [{ slot: actors[0].slot, code: tr.police.pursuitCode() },
        ...racing.map(x => ({ slot: x.member.gridSlot, code: this.mp.peers.get(x.id)?.state?.pursuit ?? 0 }))]);
      // Quantize the authority's damage too, so a threshold means the same thing on every screen.
      for (const c of tr.cars) if (c.active) c.m.setDamageSnapshot?.(Object.fromEntries(ZONES.map(z => [z, Math.round((c.dz?.[z] || 0) * 1000) / 1000])));
      if (this.mp.connected && this.mp.now() - this.lastSent >= 1000 / WORLD_HZ) this.publish();
    } else if (this.frame) this.apply(this.frame);
    else { for (const c of tr.cars) { c.active = false; c.m.root.visible = false; } }
  }
  publish() {
    const l = this.mp.lobby, at = this.mp.now(); this.lastSent = at;
    const rows = this.traffic.cars.filter(c => c.active && (!c.police || c.cop)).map(c => packCar(this.traffic, c)), cones = this.traffic.cones.flatMap((k, id) => k.hit ? [packCone(k, id)] : []);
    const packets = worldPackets({ raceId: l.raceId, generation: l.generation || 0, seq: this.seq++, at }, rows, cones);
    for (const p of packets) { this.stats.sent++; this.stats.bytes += JSON.stringify(p).length; this.mp.send(p); }
    this.lastPublished = { rows, cones, at };
  }
  receive(m) {
    this.configure();
    if (m.type === 'world-contact') { if (this.authority) this.acceptContact(m); return; }
    if (m.owner !== worldOwner(this.mp.lobby)) return;
    const full = this.assembler.accept(m); if (!full) return;
    this.frame = full; this.stats.received++;
    if (!this.authority) this.apply(full);
  }
  apply(frame, promote = false) {
    const now = this.mp.now(), age = promote ? 0 : clamp((now - frame.at) / 1000, 0, .35), active = new Set(frame.rows.map(row => row[0]));
    this.lastPoseAge = age; this.lastPoseAt = now;
    for (const c of this.traffic.cars) if (!active.has(c.id)) { c.active = false; c.m.root.visible = false; }
    for (const row of frame.rows) {
      const p = this.predictions.get('car:' + row[0]);
      if (!promote && p && now < p.until && frame.at < p.at + 100) applySharedCar(this.traffic, p.row, clamp((now - p.at) / 1000, 0, .35));
      else { this.predictions.delete('car:' + row[0]); applySharedCar(this.traffic, row, age, promote); }
    }
    const moved = new Set(frame.cones.map(row => row[0]));
    for (let id = 0; id < this.traffic.cones.length; id++) {
      const k = this.traffic.cones[id], p = this.predictions.get('cone:' + id);
      if (!promote && p && now < p.until && frame.at < p.at + 100) { applySharedCone(k, p.row, clamp((now - p.at) / 1000, 0, .35)); continue; }
      this.predictions.delete('cone:' + id);
      if (!moved.has(id) && k.hit) Object.assign(k, { s: k.s0, u: k.u0, y: 0, vs: 0, vu: 0, vy: 0, rx: 0, rz: 0, w: 0, hit: false });
    }
    for (const row of frame.cones) {
      if (!this.predictions.has('cone:' + row[0])) applySharedCone(this.traffic.cones[row[0]], row, age);
    }
    this.traffic.updateCones(0); this.traffic.dtLast = 1 / 60;
  }
  contactCar(c, before, after, dv, zone, impact) {
    if (this.authority) return;
    const body = [c.id, Math.round(clamp(c.s - before.s, -3, 3) * 100), Math.round(clamp(c.u - before.u, -3, 3) * 100), Math.round(clamp(after.vs - before.vs, -60, 60) * 100), Math.round(clamp(after.vu - before.vu, -60, 60) * 100), Math.round(clamp(after.w - before.w, -10, 10) * 1000), Math.round(clamp(dv, 0, 60) * 100), ZONES.indexOf(zone), Math.round(clamp(impact.ebs || dv, 0, 100) * 100)];
    this.contact('car', body, packCar(this.traffic, c));
  }
  contactCone(k, id) { if (!this.authority) this.contact('cone', packCone(k, id), packCone(k, id)); }
  contact(kind, body, row) {
    const now = this.mp.now(), key = `${kind}:${body[0]}`;
    if (now - (this.cooldowns.get(key) || 0) < 250 || !this.mp.connected) return;
    this.cooldowns.set(key, now); this.predictions.set(key, { row, at: now, until: now + 700 }); this.stats.contactsSent++;
    this.mp.send({ type: 'world-contact', raceId: this.mp.lobby.raceId, generation: this.mp.lobby.generation || 0, kind, body, nonce: this.nonce++, at: now });
  }
  acceptContact(m) {
    const b = m.body;
    if (m.kind === 'cone') applySharedCone(this.traffic.cones[b[0]], b);
    else {
      const c = this.traffic.cars[b[0]]; if (!c?.active) return;
      const body = this.traffic.carBody(c, {}); c.s += b[1] / 100; c.u += b[2] / 100; body.vs += b[3] / 100; body.vu += b[4] / 100; body.w += b[5] / 1000;
      this.traffic.hitCar(c, body, b[6] / 100, ZONES[b[7]], this.traffic.t, { ebs: b[8] / 100, cheap: true });
    }
    this.stats.contactsReceived++;
  }
}
