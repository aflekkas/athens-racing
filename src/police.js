// POLICE: the Hellenic Police (ΕΛ.ΑΣ.) on the coast road. Patrol cars and motorbike units drive in the traffic
// (src/traffic.js keeps a reserved pool of them); a patrol that SEES an offence (line of sight over the real terrain
// and buildings, within range) starts a pursuit. Offences build HEAT (0..5, shown as stars): speeding well over the
// posted limit, running reds (a red-light camera adds heat even unseen), hitting traffic, scaring pedestrians, hitting
// a police car; the event speed cameras add heat and dispatch a unit. More heat = more units, harder tactics:
//   1 star  one unit tails you          2 stars  PIT attempts on your rear quarter
//   3 stars boxing in + roadblocks at junctions ahead (cones and parked patrol cars, one gap left open)
//   4-5     ramming, reinforcements from ahead that U-turn onto you
// BUSTED: slow / stopped with a unit right on you for a few seconds (in a race or a pursuit event: a DNF).
// EVADED: out of every unit's sight long enough to finish the cooldown (longer the more stars).
// Wrecking a police car you hit is a TAKEDOWN (a call-out; it raises the heat). No points, no money: time only.
//
// Hook API (no DOM, no three.js: node can import this; tools/police-test.mjs tests the state machine):
//   import { pursuit } from './police.js'   live read-only status:
//     { enabled, state: 'off'|'idle'|'pursuit'|'cooldown', heat, level, bustMeter, evadeMeter, time (s in this pursuit), units }
//   events.emit('pursuit', { phase: 'start'|'heat'|'cooldown'|'resume'|'evaded'|'busted'|'takedown', heat, level, time })
// Police turn on at an event's 'start' when def.rules.police (rules.startHeat = initial stars), or with
// settings.police in Quick Race / free roam, or with ?police in the URL.
import { events } from './events.js';
import { settings } from './settings.js';

// ------------------------------------------------------------------ tuning
export const HEAT = {
  lostAfter: 2.5,      // s without any unit seeing you before the cooldown starts
  evadeBase: 6,        // cooldown length (s) at 1 star ...
  evadePerLevel: 2.5,  // ... plus this per star
  bustTime: 3,         // s slow with a unit on you = busted
  bustDecay: 1.5,      // s to drain a full bust meter once you get moving
  bustDist: 7.5,       // m centre to centre
  bustSpeed: 3.5,      // m/s (~13 km/h)
  escalate: 0.012,     // heat per second of active pursuit (a long chase climbs a star every ~80 s)
};
export const levelOf = (h) => (h <= 0.001 ? 0 : Math.min(5, Math.ceil(h - 1e-6))); // heat 2.0 = two stars

/** the heat / pursuit state machine: pure logic */
export class HeatMachine {
  constructor(opts = {}) { this.cfg = { ...HEAT, ...opts }; this.reset(); }
  reset() {
    this.state = 'idle'; this.heat = 0;
    this.bust = 0; this.evade = 0; this.time = 0; this.lostT = 0; this.out = [];
  }
  get level() { return levelOf(this.heat); }
  get active() { return this.state === 'pursuit' || this.state === 'cooldown'; }
  push(phase, extra = {}) { this.out.push({ phase, heat: this.heat, level: this.level, time: this.time, ...extra }); }
  /** an offence worth `amt` heat; witnessed by a unit (starts / resumes a pursuit) or only by a camera */
  offence(kind, amt, witnessed) {
    const l0 = this.level;
    this.heat = Math.min(5, this.heat + amt);
    if (witnessed && this.state === 'idle') { this.state = 'pursuit'; this.time = 0; this.lostT = 0; this.evade = 0; this.bust = 0; this.push('start', { kind }); }
    else if (witnessed && this.state === 'cooldown') { this.state = 'pursuit'; this.lostT = 0; this.evade *= 0.5; this.push('resume', { kind }); }
    if (this.level > l0) this.push('heat', { kind });
  }
  /** start straight into a pursuit at a given heat (pursuit events) */
  begin(heat) { this.reset(); this.heat = Math.min(5, heat); this.state = 'pursuit'; this.push('start', { kind: 'event' }); }
  takedown() {
    this.heat = Math.min(5, this.heat + 0.6); // they don't take it well
    this.push('takedown');
  }
  /** s: { seen (any unit sees you), copNear (a chasing unit within bustDist), slow (you are below bustSpeed) } */
  update(dt, s) {
    const C = this.cfg;
    if (this.state === 'pursuit') {
      this.time += dt;
      this.heat = Math.min(5, this.heat + dt * C.escalate);
      this.evade = Math.max(0, this.evade - dt * 0.5);
      if (s.seen) this.lostT = 0;
      else if ((this.lostT += dt) > C.lostAfter) { this.state = 'cooldown'; this.push('cooldown'); }
    } else if (this.state === 'cooldown') {
      this.time += dt;
      if (s.seen) { this.state = 'pursuit'; this.lostT = 0; this.evade *= 0.5; this.push('resume'); }
      else {
        this.evade += dt / (C.evadeBase + C.evadePerLevel * this.level);
        if (this.evade >= 1) {
          this.evade = 1;
          this.push('evaded');
          this.state = 'idle'; this.heat = 0; this.evade = 0; this.bust = 0; this.lostT = 0;
          return this.drain();
        }
      }
    }
    if (this.active) {
      if (s.copNear && s.slow) this.bust += dt / C.bustTime;
      else this.bust = Math.max(0, this.bust - dt / C.bustDecay);
      if (this.bust >= 1) {
        this.bust = 1;
        this.push('busted');
        this.state = 'idle'; this.heat = 0; this.bust = 0; this.evade = 0; this.lostT = 0;
      }
    } else this.bust = 0;
    return this.drain();
  }
  drain() { const o = this.out; this.out = []; return o; }
}

// ------------------------------------------------------------------ live status for the HUD / events
export const pursuit = { enabled: false, state: 'off', heat: 0, level: 0, bustMeter: 0, evadeMeter: 0, time: 0, units: 0 };

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export class Police {
  constructor(traffic, route) {
    this.traffic = traffic; this.route = route; traffic.police = this;
    this.hm = new HeatMachine();
    this.enabled = false; this.blocks = []; this.t = 0; this.P = null; this.D = 1;
    this.rng = { next: Math.random, range: (a, b) => a + Math.random() * (b - a), chance: (p) => Math.random() < p, int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) };
    this.lastReds = 0; this.kmh = 0; this.eventId = null; this.pending = [];
    this.speeds = route.speeds && route.speeds.length ? route.speeds : [{ s: 0, v: 50 }];
    this.offs = [
      events.on('start', (p) => {
        const r = p.def?.rules || {};
        this.eventId = p.eventId;
        // An explicit saved setup overrides the legacy preference and dev URL.
        const on = p.def?.type === 'pursuit' || (typeof r.police === 'boolean' ? r.police : QS.has('police') || (!!settings.police && (p.def?.quick || p.type === 'free' || p.def?.free)));
        this.traffic.allowClosedPolice = on && r.police === true; // explicit setup On permits track-map patrols
        this.reset(on);
        if (on && r.startHeat) this.hm.begin(r.startHeat); // 'start' comes out of the next update (engage() needs the player)
      }),
      events.on('abort', () => this.reset(false)),
      events.on('trap', (e) => { // an event speed camera: heat if you were well over the limit, and a unit dispatched
        if (!this.enabled || !this.P) return;
        const lim = this.limitAt(this.P.s);
        if (e.kmh > lim + 20) { this.hm.offence('camera', 0.35 + Math.min(0.5, (e.kmh - lim) / 200), false); this.dispatch(); }
      }),
    ];
  }
  /** posted limit (km/h) at route s */
  limitAt(s) { let v = this.speeds[0].v; for (const q of this.speeds) { if (q.s <= s) v = q.v; else break; } return v || 50; }
  get cops() { return this.traffic.cars.filter((c) => c.active && c.cop); }

  reset(enabled = this.enabled) {
    this.enabled = enabled && (this.traffic.allowClosedRoam || this.traffic.allowClosedPolice || !this.route.closed && !this.traffic.route?.closed); // free roam opts into patrols on every map
    if (!this.enabled) this.traffic.allowClosedPolice = false;
    this.hm.reset(); this.t = 0;
    for (const c of this.traffic.cars) if (c.police) { c.active = false; c.m.root.visible = false; c.cop = null; c.crash = null; c.m.setStrobe?.(false, 0); }
    for (const b of this.blocks.slice()) this.clearBlock(b);
    this.patrolS = null; this.reinT = 2; this.blockT = 10; this.dispatchN = 0;
    this.lastReds = null;
    this.publish();
  }

  // ---------------------------------------------------------------- per frame
  /** ctx: { events (traffic.collide events this frame), reds (G.reds), racing, dir (event direction), eventId } */
  update(dt, ctx = {}) {
    const out = [];
    this.t += dt;
    if (!this.enabled || !ctx.racing) { this.publish(); return out; }
    const tr = this.traffic, route = this.route, rng = this.rng;
    const P = this.P = tr.racers.find((r) => r.kind === 'player'); if (!P) return out;
    const D = this.D = Math.abs(P.vs) > 3 ? Math.sign(P.vs) : ctx.dir || 1;
    const kmh = this.kmh = Math.hypot(P.vs, P.vu) * 3.6;
    if (ctx.eventId) this.eventId = ctx.eventId;
    const hm = this.hm;
    // ---- who can see the player
    let seen = false, near = false, nearest = 1e9;
    const lvl = hm.level, range = hm.active ? 190 + 35 * lvl : 140;
    for (const c of this.cops) {
      const k = c.cop;
      if (c.crash) { k.sees = false; if (c.crash.wreck && !k.down) { k.down = true; k.chase = false; k.siren = false; k.keep = false; /* a wreck: traffic culls it once you're past */ if ((hm.active || k.wasChasing) && this.t - (k.hitT ?? -99) < 4) out.push(...this.takedown(c)); } continue; }
      k.losT = (k.losT || 0) - dt;
      const d = Math.hypot(c.s - P.s, c.u - P.u);
      if (k.losT <= 0) { k.losT = 0.2 + rng.range(0, 0.1); k.sees = d < range && (d < 25 || this.los(c, P)); }
      if (k.sees) seen = true;
      if (k.chase && d < HEAT.bustDist) near = true;
      if (k.chase) nearest = Math.min(nearest, d);
    }
    // ---- offences
    const lim = this.limitAt(P.s);
    if (kmh > lim * 1.25 + 8) {
      const witness = this.cops.some((c) => c.cop.sees && !c.crash);
      if (witness) hm.offence('speeding', dt * (hm.active ? 0.05 : 0.6) * Math.min(3, (kmh / lim - 1) * 1.5), true);
    }
    if (ctx.reds != null) {
      if (this.lastReds != null && ctx.reds > this.lastReds) {
        if (seen) hm.offence('red', 0.7, true); else { hm.offence('red', 0.3, false); if (rng.chance(0.5)) this.dispatch(); }
      }
      this.lastReds = ctx.reds;
    }
    for (const e of ctx.events || []) {
      if (e.who === 'player' && e.car && e.car.cop) e.car.cop.hitT = this.t; // a takedown needs you to have been in on it
      if (e.who !== 'player' || !e.car || (e.kind !== 'crash' && e.kind !== 'bump')) continue;
      if (e.car.cop) {
        // their ramming / PIT is not your offence; you hitting them is
        const t = e.car.cop.tactic;
        if (!(e.car.cop.chase && (t === 'pit' || t === 'ram' || t === 'box'))) hm.offence('hitcop', e.kind === 'crash' ? 1.2 : 0.6, true);
      } else hm.offence(e.kind === 'crash' ? 'crash' : 'bump', (e.kind === 'crash' ? 0.6 : 0.25) * (seen ? 1 : 0.5), seen);
    }
    for (const p of this.pending) hm.offence(p.kind, p.amt * (seen ? 1 : 0.4), seen); // nobody saw it: a complaint, not a chase
    this.pending.length = 0;
    // ---- the state machine
    const tr0 = hm.update(dt, { seen, copNear: near, slow: Math.hypot(P.vs, P.vu) < HEAT.bustSpeed });
    for (const e of tr0) {
      out.push(e);
      if (e.phase === 'start' || e.phase === 'resume') this.engage(e.kind === 'event');
      if (e.phase === 'evaded' || e.phase === 'busted') this.standDown();
    }
    // ---- units: patrols, reinforcements, tactics, roadblocks
    this.manage(dt);
    for (const e of out) this.announce(e);
    this.publish(nearest);
    return out;
  }
  /** people events (before main.js clears them): pedestrians diving out of your way */
  pedEvents(list) {
    if (!this.enabled) return;
    for (const e of list) {
      if (e.who !== 'player' || (e.kind !== 'dive' && e.kind !== 'startle')) continue;
      if (this.t - (this.pedT ?? -9) < 1.5) continue; // a whole crowd scattering is one offence
      this.pedT = this.t; this.pending.push({ kind: 'pedestrian', amt: e.kind === 'dive' ? 0.6 : 0.15 });
    }
  }
  takedown(c) {
    const before = this.hm.out.length;
    this.hm.takedown();
    const ev = this.hm.out.splice(before);
    void c;
    return ev;
  }
  announce(e) {
    events.emit('pursuit', { phase: e.phase, heat: e.heat, level: e.level, time: e.time, kind: e.kind });
  }
  publish(nearest = 1e9) {
    const hm = this.hm;
    Object.assign(pursuit, {
      enabled: this.enabled, state: this.enabled ? hm.state : 'off', heat: hm.heat, level: hm.level, bustMeter: hm.bust, evadeMeter: hm.evade, time: hm.time, units: this.traffic.cars.filter((c) => c.active && c.cop && c.cop.chase && !c.crash).length, nearest,
    });
  }

  /** line of sight from a unit to the player over the real ground (hills, cliff faces) and buildings */
  los(c, P) {
    const route = this.route, g = this.traffic.ground;
    const a = route.point(c.s, c.u), b = route.point(P.s, P.u);
    if (!g) return Math.abs(c.s - P.s) < 120;
    const ya = a.y + 1.3, yb = b.y + 1.2, q = this._q || (this._q = {}), w = this._w || (this._w = {});
    const n = Math.max(3, Math.min(10, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 20)));
    let hint = c.s;
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = ya + (yb - ya) * t;
      const pr = route.project(x, z, hint, 60); hint = pr.s;
      if (Math.abs(pr.u) > route.edge(pr.s) + 3) {
        if (g.at(x, z, pr.s, pr.u, q).y > y + 0.3) return false;
        if (g.walls(x, z, 0.4, w)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- units
  spawnCop(s, dir, opts = {}) {
    const tr = this.traffic, route = this.route;
    const loop = route.closed && (tr.allowClosedRoam || tr.allowClosedPolice);
    if (!loop && (route.closed || s < 30 || s > route.length - 30)) return null;
    let c = tr.cars.find((q) => q.police && !q.active && (opts.moto ? q.type.scooter : !q.type.scooter)) || tr.cars.find((q) => q.police && !q.active);
    // pool empty: recycle the furthest wreck / idle unit you can't see any more
    if (!c && this.P) {
      let far = 150;
      for (const q of tr.cars) if (q.police && q.active && q.cop && !q.cop.chase && !q.cop.block) { const d = Math.abs(q.s - this.P.s); if (d > far) { far = d; c = q; } }
      if (c) { c.active = false; c.m.root.visible = false; c.cop = null; }
    }
    if (!c) return null;
    const n = tr.laneCount(s);
    c.dir = dir; c.lane = opts.lane ?? (dir === this.D ? Math.min(n - 1, 0) : this.rng.chance(0.5) ? 0 : n - 1);
    c.s = s; c.len = c.type.len; c.wid = c.type.wid; c.u = tr.laneUOf(c, s);
    for (const q of tr.cars) if (q.active && q !== c && Math.abs(q.s - s) < 9 && Math.abs(q.u - c.u) < 2.2) { c.u += -dir * 3.5; break; }
    tr.personality(c); c.drv.arch = 'cautious'; c.drv.vf = 0.97; c.drv.indicate = 1; c.drv.freeze = 0;
    c.active = true; c.crash = null; c.cross = null; tr.repair(c);
    tr.initDrive(c);
    c.v0 = tr.roadSpeed(s) * c.drv.vf; c.v = opts.v ?? c.v0 * 0.9;
    c.cop = { chase: false, keep: false, siren: false, mode: opts.mode || 'patrol', tactic: 'tail', tacT: 0, side: 0, losT: 0, sees: false, down: false, wasChasing: false };
    c.m.root.visible = true;
    return c;
  }
  /** a unit joins the chase */
  enlist(c) { const k = c.cop; k.chase = true; k.keep = true; k.siren = true; k.wasChasing = true; c.mode = 'drive'; c.task = null; c.evade = null; c.ovt = null; c.hazard = false; c.blinkSide = 0; }
  engage(fromEvent) {
    const P = this.P, D = this.D;
    for (const c of this.cops) if (!c.crash && !c.cop.block && (c.cop.sees || Math.abs(c.s - P.s) < 320)) this.enlist(c);
    if (fromEvent) for (let i = 0; i < 2; i++) { const c = this.spawnCop(P.s - D * (150 + i * 60), D, { v: Math.max(10, P.vs * D) }); if (c) this.enlist(c); }
    if (!this.cops.some((c) => c.cop.chase)) { const c = this.spawnCop(P.s - D * 160, D, { v: Math.max(10, P.vs * D + 5) }); if (c) this.enlist(c); }
  }
  /** after busted / evaded: everybody back to normal duties */
  standDown() {
    const tr = this.traffic;
    for (const c of this.cops) {
      const k = c.cop;
      if (k.block) continue;
      k.chase = false; k.siren = false; k.keep = false; k.tactic = 'tail';
      if (!c.crash) { tr.initDrive(c); c.v0 = tr.roadSpeed(c.s) * c.drv.vf; }
    }
    for (const b of this.blocks) b.done = true;
  }
  /** an unseen offence (camera): a unit is sent towards you from ahead */
  dispatch() {
    if (this.dispatchN > 3 || !this.P) return;
    this.dispatchN++;
    const c = this.spawnCop(this.P.s + this.D * this.rng.range(450, 700), -this.D, { mode: 'dispatch' });
    if (c) { c.cop.siren = true; c.cop.keep = true; }
  }

  manage(dt) {
    const tr = this.traffic, hm = this.hm, P = this.P, D = this.D, rng = this.rng;
    const cops = this.cops, chasing = cops.filter((c) => c.cop.chase && !c.crash);
    // ---- patrols while nobody is after you: one every ~1.2-2 km, some parked at the roadside with a radar gun
    if (!hm.active) {
      if (this.patrolS == null) this.patrolS = P.s + D * rng.range(250, 700);
      if ((this.patrolS - P.s) * D < 950 && !cops.some((c) => !c.cop.block && Math.abs(c.s - P.s) < 1100 && (c.s - P.s) * D > 0)) {
        const s = this.patrolS;
        if (rng.chance(0.3) && tr.route.urban(s) < 0.9) {
          const c = this.spawnCop(s, D, { mode: 'radar' });
          if (c) { c.mode = 'parked'; c.parkT = 1e9; c.v = 0; c.u = tr.kerbU(c, s, tr.route.urban(s) > 0.5 ? 1.0 : -0.6); c.cop.keep = true; }
        } else this.spawnCop(s, rng.chance(0.5) ? D : -D, { moto: rng.chance(0.25) });
        this.patrolS = s + D * rng.range(1200, 2000);
      }
      // a dispatched unit that never found you, or a parked radar unit left far behind
      for (const c of cops) if (!c.cop.chase && !c.cop.block && (c.s - P.s) * D < -300) { c.cop.keep = false; }
      for (const c of cops) if (c.cop.mode === 'radar' && c.mode === 'parked' && (c.s - P.s) * D < -300) { c.active = false; c.m.root.visible = false; c.cop = null; }
    } else {
      // ---- reinforcements: up to 1 + stars units, from behind, and from 2 stars also from ahead (they U-turn)
      const want = Math.min(5, 1 + hm.level);
      this.reinT -= dt;
      if (chasing.length < want && this.reinT <= 0) {
        this.reinT = rng.range(4, 8) / (0.6 + 0.25 * hm.level);
        const ahead = hm.level >= 2 && rng.chance(0.4);
        const c = ahead ? this.spawnCop(P.s + D * rng.range(320, 480), -D, { moto: rng.chance(0.2) }) : this.spawnCop(P.s - D * rng.range(170, 240), D, { v: Math.max(12, P.vs * D * 0.9 + 6), moto: rng.chance(0.25) });
        if (c) this.enlist(c);
      }
      // ---- roadblocks from 3 stars
      this.blockT -= dt;
      if (hm.level >= 3 && hm.state === 'pursuit' && this.blockT <= 0 && !this.blocks.some((b) => !b.done)) { this.blockT = rng.range(30, 45); this.roadblock(); }
      // ---- units fallen far behind or gone far ahead go back to other duties
      for (const c of chasing) { const g = (P.s - c.s) * D; if (g > 520 || g < -900) { c.active = false; c.m.root.visible = false; c.cop = null; } }
      // ---- tactics: rank the units by distance; the nearest does the PIT / ram, the next tries to box you in
      chasing.sort((a, b) => Math.abs(a.s - P.s) - Math.abs(b.s - P.s));
      chasing.forEach((c, i) => {
        const k = c.cop; k.tacT -= dt;
        if (k.tacT > 0) return;
        k.tacT = 1.2 + rng.range(0, 0.8);
        const gap = (P.s - c.s) * D;
        k.tactic = hm.state === 'cooldown' ? 'search' : c.dir !== D ? 'uturn' : gap > 35 ? 'catch'
          : hm.level >= 4 && i === 0 ? 'ram' : hm.level >= 3 && i === 1 ? 'box' : hm.level >= 2 && i === 0 && !c.type.scooter ? 'pit' : 'tail';
        if (k.tactic !== 'pit' && k.tactic !== 'box') k.side = 0;
      });
    }
    // ---- roadblocks: clear once passed / the chase is over and they're out of the way
    for (const b of this.blocks.slice()) { const g = (b.s - P.s) * D; if (g < -120 || (b.done && Math.abs(g) > 400)) this.clearBlock(b); }
  }

  /** park two units across your side of the road at the next junction ahead (else a straight), cones between them,
   *  one lane (or the shoulder / the oncoming lane on a narrow road) left open */
  roadblock() {
    const tr = this.traffic, route = this.route, P = this.P, D = this.D, rng = this.rng;
    const J = tr.signals ? tr.signals.J : [];
    let s = null;
    for (const j of J) { const d = (j.s - P.s) * D; if (d > 380 && d < 850) { s = j.s - D * 25; break; } }
    if (s == null) { s = P.s + D * rng.range(480, 650); if (Math.abs(route.curv(s)) > 1 / 120) return; }
    const n = tr.laneCount(s), open = n === 1 ? -1 : rng.int(0, n - 1); // -1: the oncoming lane / shoulder is the gap
    const b = { s, done: false, cars: [], cones: [], sites: [] };
    const lanes = []; for (let l = 0; l < n; l++) if (l !== open) lanes.push(l);
    lanes.slice(0, 2).forEach((l, i) => {
      const c = this.spawnCop(s + D * i * 1.2, D, { lane: l, mode: 'block' });
      if (!c) return;
      c.mode = 'parked'; c.parkT = 1e9; c.v = 0; c.yawLC = (i % 2 ? -1 : 1) * 1.15; c.cop.keep = true; c.cop.block = b; c.cop.siren = true;
      c.hs = c.len * 0.5 * Math.abs(Math.cos(c.yawLC)) + c.wid * 0.5 * Math.abs(Math.sin(c.yawLC)); c.hu = c.len * 0.5 * Math.abs(Math.sin(c.yawLC)) + c.wid * 0.5 * Math.abs(Math.cos(c.yawLC));
      b.cars.push(c);
    });
    // cones across the closed lanes, a few metres before the cars
    for (const l of lanes) {
      const uc = D * route.laneU(s, l);
      for (let k = -1; k <= 1; k++) {
        const cs = s - D * (7 + Math.abs(k) * 0.6), cu = uc + k * 1.15;
        const cone = { s: cs, u: cu, s0: cs, u0: cu, y: 0, vs: 0, vu: 0, vy: 0, rx: 0, rz: 0, w: 0, hit: false, police: true };
        if (tr.cones.length < tr.coneBase + 60) { tr.cones.push(cone); b.cones.push(cone); }
      }
      const site = { s, u: uc, len: 6, wid: 3.2, lane: -1, police: true };
      tr.sites.push(site); b.sites.push(site);
    }
    tr.coneMesh.count = tr.cones.length;
    this.blocks.push(b);
    this.blockAt = s;
  }
  clearBlock(b) {
    const tr = this.traffic;
    for (const c of b.cars) if (c.cop && c.cop.block === b) { c.active = false; c.m.root.visible = false; c.cop = null; }
    for (const cone of b.cones) { const i = tr.cones.indexOf(cone); if (i >= 0) tr.cones.splice(i, 1); }
    for (const st of b.sites) { const i = tr.sites.indexOf(st); if (i >= 0) tr.sites.splice(i, 1); }
    tr.coneMesh.count = tr.cones.length;
    this.blocks.splice(this.blocks.indexOf(b), 1);
  }

  // ---------------------------------------------------------------- a chasing unit's driving (kinematic, like all traffic)
  driveCop(c, dt) {
    const tr = this.traffic, route = this.route, P = this.P, D = this.D, k = c.cop, hw = c.wid * 0.5;
    if (!P) return;
    const moto = c.type.scooter, vmax = moto ? 64 : 61, aMax = moto ? 7.5 : 6.2;
    // ---- facing the wrong way: brake, swing round (a quick three-point / handbrake turn), go
    if (c.dir !== D && !k.turnT) {
      c.v = Math.max(0, c.v - 9 * dt); c.acc = -9;
      if (c.v < 3) { c.dir = D; k.turnT = 1.3; c.v = 2; c.uv = 0; }
      c.s += c.dir * c.v * dt; c.yawLC = 0; c.wheel += c.v * dt; c.braking = true;
      return;
    }
    const gap = (P.s - c.s) * D - (P.hs + c.len * 0.5); // bumper to bumper, + = the player is ahead
    const vP = P.vs * D, t = k.tactic;
    let want = 6, uT = P.u;
    if (t === 'pit') {
      if (!k.side) { const room = (s) => (route.edge(c.s) - Math.abs(P.u + s * (P.hu + hw + 0.4))); k.side = room(1) > room(-1) ? 1 : -1; }
      want = -(c.len * 0.5 + P.hs * 0.15);
      const along = Math.abs(gap - want) < 1.6;
      uT = P.u + k.side * (P.hu + hw + (along ? -0.9 : 0.35)); // alongside your rear quarter, then steer into it
    } else if (t === 'ram') { want = -0.6; uT = P.u; }
    else if (t === 'box') {
      // get past on whichever side has room, then cut in ahead and slow you down
      want = -(P.hs * 2 + c.len + 7);
      if (!k.side) { const room = (sd) => route.edge(c.s) - Math.abs(P.u + sd * (P.hu + hw + 1.2)); k.side = room(1) > room(-1) ? 1 : -1; }
      uT = gap > -(P.hs * 2 + c.len * 0.5 + 2) ? P.u + k.side * (P.hu + hw + 1.2) : P.u;
    }
    else if (t === 'search') { want = 0; uT = tr.laneUOf(c, c.s); }
    let vT;
    if (t === 'catch' || t === 'uturn') vT = Math.min(vmax, vP + Math.max(4, Math.min(30, gap * 0.25)));
    else if (t === 'search') vT = 30;
    else if (t === 'box' && gap < want + 3) vT = vP - 4; // ahead of you: ease off and slow you down
    else vT = vP + Math.max(-10, Math.min(10, (gap - want) * 0.9));
    if (t !== 'box' || gap > 0) vT = Math.min(vT, vP + Math.sqrt(2 * 5 * Math.max(0, gap - want)) + (t === 'ram' ? 2.5 : 0.8)); // closing no faster than they can stop
    // corners: what the tyres can hold (~0.95 g)
    let kc = 0; for (let d = 0; d <= 60; d += 15) kc = Math.max(kc, Math.abs(route.curv(c.s + c.dir * d)));
    vT = Math.min(vT, Math.sqrt(9.3 / Math.max(1e-4, kc)), vmax);
    // ---- traffic in the way: pick the clearest line (both sides of the road: lights and siren on)
    const L = tr.lead(c, c.u, hw, 90, 0.15);
    if (L.o && L.o.kind !== 'player' && L.o.ref !== P.a && L.gap < 50) {
      const n = tr.laneCount(c.s), cand = [uT];
      for (let l = 0; l < n; l++) { cand.push(c.dir * route.laneU(c.s, l)); if (route.div(c.s) < 0.45) cand.push(-c.dir * route.laneU(c.s, l)); }
      let best = uT, bs = -1e9;
      for (const u of cand) {
        const A = tr.lead(c, u, hw, 90, 0.15), closing = A.o ? Math.max(0, c.v - A.lv) : 0;
        const sc = (A.o && A.o.kind !== 'player' ? A.gap - closing * 1.2 : 120) - Math.abs(u - c.u) * 0.8;
        if (sc > bs) { bs = sc; best = u; }
      }
      uT = best;
      const A = tr.lead(c, best, hw, 90, 0.15);
      if (A.o && A.o.kind !== 'player') vT = Math.min(vT, Math.max(0, A.lv) + Math.max(0, A.gap - 3) * 0.7);
    }
    // stay on the road (and on our side of a divided avenue)
    const lim = route.edge(c.s) - hw * 0.7;
    uT = Math.max(-lim, Math.min(lim, uT));
    if (route.div(c.s) > 0.45) { const mh = route.medHalf(c.s) + hw + 0.2; if (uT * c.dir < mh) uT = c.dir * mh; }
    // ---- motion
    const a = vT > c.v ? Math.min(aMax * (1 - 0.6 * c.v / vmax), (vT - c.v) * 2.5) : Math.max(-9.5, (vT - c.v) * 3);
    c.acc = a; c.v = Math.max(0, c.v + a * dt);
    const latMax = Math.min(6, 0.2 + c.v * 0.3), wantU = Math.max(-latMax, Math.min(latMax, (uT - c.u) * 3));
    c.uv += Math.max(-9 * dt, Math.min(9 * dt, wantU - c.uv));
    c.u += c.uv * dt; c.s += c.dir * c.v * dt;
    if (k.turnT > 0) { k.turnT = Math.max(0, k.turnT - dt); c.yawLC = Math.PI * (k.turnT / 1.3) * (k.turnT > 0 ? 1 : 0); }
    else c.yawLC = Math.atan2(c.uv, Math.max(2, c.v)) * c.dir;
    c.wheel += c.v * dt; c.braking = a < -1;
    c.indL.emissiveIntensity = 0; c.indR.emissiveIntensity = 0; c.v0 = vT;
  }

  /** visuals: strobes */
  sync(t) {
    for (const c of this.traffic.cars) {
      if (!c.police) continue;
      const on = c.active && !!(c.cop && (c.cop.siren || c.cop.block) && !(c.crash && c.crash.wreck && c.crash.t > 20));
      if (on || c.strobeOn) c.m.setStrobe?.(on, t); // pooled / despawned / stood down: switched off once
      c.strobeOn = on;
    }
  }
}
