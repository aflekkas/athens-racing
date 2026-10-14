// POLICE: sparse map-anchored patrols. Only a real unit within 75 m and clear
// line of sight can witness an offence. Minor offences first request a stop;
// sustained dangerous driving, refusal to stop, or a serious collision starts
// pursuit. Heat below 1 has no stars; further stars require further offences.
// Cameras only fine through enforcement.js. No camera dispatch or unseen heat.
// Hook API: pursuit live status; events.emit('pursuit', {phase,heat,level,time,kind}).
// Speeding: +30 km/h is tolerated; beyond it a unit warns after ~3 s and a star
// needs ~12 s of witnessed speeding (+50 km/h: ~5 s). A drive-past is a warning.
// Warning is lights/following with no wanted star. Stop nearby for 2 s to comply.
// Losing sight drains suspicion. Pursuit: 3 s unseen -> cooldown, then 8 s at
// one star (+2 s per extra star) unseen -> evaded. No time-based escalation.
// BUSTED needs a real pursuit (8 s in) and you held under ~9 km/h next to a unit
// for 4 s (2.5 s boxed in by two). After any stop/escape the police stay quiet
// for a while; reinforcements are capped at 3 and never appear in your view.
import { events } from './events.js';
import { settings } from './settings.js';
import { routeLimitAt } from './speed-limit.js';
import { patrolPlan } from './police-patrols.js';

// ------------------------------------------------------------------ tuning
export const HEAT = {
  lostAfter: 3,      // s without any unit seeing you before the cooldown starts
  evadeBase: 8,        // base cooldown length (s), plus per-star time below
  evadePerLevel: 2,  // ... plus this per star
  bustTime: 4,         // s slow with one unit on you = busted
  boxedBustTime: 2.5,  // ... with two or more units on you (boxed in)
  bustAfter: 8,        // s into a pursuit before the bust meter can fill at all
  bustDecay: 1,        // s to drain a full bust meter once you get moving
  bustDist: 7.5,       // m centre to centre
  bustSpeed: 2.5,      // m/s (~9 km/h)
  witnessRange: 75,    // m, for offences, including offences during a pursuit
  speedMargin: 30,     // km/h over the posted limit; exact +30 is tolerated
  speedHeat: 0.08,     // ~3 s to a warning, 12.5 sustained witnessed seconds to the first star
  seriousMargin: 50,   // km/h over: flagrant speeding
  seriousSpeedHeat: 0.2, // five sustained witnessed seconds to the first star
  sustainedAfter: 8, seriousSustainedAfter: 4, // s of consecutive witnessed speeding before a star is possible
  pursuitSpeedHeat: 0.05, // 20 further seconds of witnessed speeding per extra star
  warningHeat: 0.25, warningGrace: 3, complyTime: 2, fleeAfter: 10, fleeMargin: 20,
  quietAfter: 20,      // s after a bust / escape / release when minor offences are ignored and no patrol respawns
  maxChasers: 3, maxUnits: 4, // reinforcement caps (roadblock cars excluded from maxUnits)
  suspicionDecay: 0.2, // heat/s outside sight, or after lawful driving in a warning
  contactCooldown: 1, // one contact per vehicle per second, not every physics frame
};
export const levelOf = h => Math.max(0, Math.min(5, Math.floor(h + 1e-6)));

/** the heat / pursuit state machine: pure logic */
export class HeatMachine {
  constructor(opts = {}) { this.cfg = { ...HEAT, ...opts }; this.reset(); }
  reset() {
    this.state = 'idle'; this.heat = 0;
    this.bust = 0; this.evade = 0; this.time = 0; this.lostT = 0; this.warningT = 0; this.fleeT = 0; this.complyT = 0; this.out = []; this.quiet = 0;
  }
  /** an encounter is over: minor offences are ignored for quietAfter seconds */
  settle() { this.state = 'idle'; this.heat = 0; this.bust = 0; this.evade = 0; this.lostT = 0; this.quiet = this.cfg.quietAfter; }
  get level() { return levelOf(this.heat); }
  get active() { return this.state === 'pursuit' || this.state === 'cooldown'; }
  push(phase, extra = {}) { this.out.push({ phase, heat: this.heat, level: this.level, time: this.time, ...extra }); }
  /** Only unit-witnessed offences count. Continuous offences warn at .25 heat. */
  offence(kind, amt, witnessed, { continuous = false, serious = false, sustained = true } = {}) {
    if (!witnessed || !(amt > 0)) return;
    if (this.quiet > 0 && !serious && this.state === 'idle') return;
    const l0 = this.level;
    // A single minor offence cannot skip the warning, even a cluster of bumps.
    const cap = this.active || serious || continuous && sustained ? 5 : continuous ? 0.999 : 0.95;
    this.heat = Math.min(Math.max(this.heat, cap), this.heat + amt);
    if ((this.state === 'idle' || this.state === 'warning') && this.level >= 1) {
      this.state = 'pursuit'; this.time = 0; this.lostT = 0; this.evade = 0; this.bust = 0; this.push('start', { kind });
    } else if (this.state === 'idle' && (!continuous || this.heat >= this.cfg.warningHeat - 1e-6)) {
      this.state = 'warning'; this.warningT = 0; this.fleeT = 0; this.complyT = 0; this.push('warning', { kind });
    } else if (this.state === 'cooldown') {
      this.state = 'pursuit'; this.lostT = 0; this.evade *= 0.5; this.push('resume', { kind });
    }
    if (this.level > l0) this.push('heat', { kind });
  }
  /** Scripted pursuit/getaway events explicitly start at their authored stars. */
  begin(heat) { this.reset(); this.heat = Math.max(1, Math.min(5, heat)); this.state = 'pursuit'; this.push('start', { kind: 'event' }); }
  takedown() {
    this.heat = Math.min(5, this.heat + 0.6); // they don't take it well
    this.push('takedown');
  }
  /** s: { seen (any unit sees you), copNear (a chasing unit within bustDist), slow (you are below bustSpeed) } */
  update(dt, s) {
    const C = this.cfg;
    this.quiet = Math.max(0, this.quiet - dt);
    if (this.state === 'idle' || this.state === 'warning') {
      if (this.state === 'warning') {
        this.warningT += dt;
        this.complyT = s.copNear && s.slow ? this.complyT + dt : 0;
        this.fleeT = s.seen && s.fleeing ? this.fleeT + dt : 0;
        if (this.fleeT >= C.fleeAfter - 1e-6) this.offence('fleeing', Math.max(0.01, 1 - this.heat), true, { serious: true });
        else if (this.complyT >= C.complyTime - 1e-6) {
          const out = this.drain(); this.reset(); this.quiet = C.quietAfter * 0.5; out.push({ phase: 'released', heat: 0, level: 0, time: 0 }); return out;
        }
      }
      if (!this.active && (!s.seen || !s.offending && !s.fleeing && (this.state === 'idle' || this.warningT > C.warningGrace))) {
        this.heat = Math.max(0, this.heat - dt * C.suspicionDecay);
        if (this.state === 'warning' && this.heat <= 1e-6) {
          this.push('released'); this.state = 'idle'; this.heat = 0; this.quiet = C.quietAfter * 0.5;
        }
      }
    }
    if (this.state === 'pursuit') {
      this.time += dt;
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
          this.settle();
          return this.drain();
        }
      }
    }
    // Only an established pursuit can end in a bust; a unit that just caught up, or one
    // searching for you in the cooldown, cannot. Two units on you (boxed in) is quicker.
    if (this.state === 'pursuit' && this.time >= C.bustAfter - 1e-6) {
      const near = s.copsNear ?? (s.copNear ? 1 : 0);
      if (near > 0 && s.slow) this.bust += dt / (near >= 2 ? C.boxedBustTime : C.bustTime);
      else this.bust = Math.max(0, this.bust - dt / C.bustDecay);
      if (this.bust >= 1) {
        this.bust = 1;
        this.push('busted');
        this.settle();
      }
    } else if (this.state === 'cooldown') this.bust = Math.max(0, this.bust - dt / C.bustDecay);
    else this.bust = 0;
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
    this.kmh = 0; this.eventId = null; this.pending = [];
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
    ];
  }
  /** posted limit (km/h) at route s */
  limitAt(s) { return routeLimitAt(this.speeds, this.route.closed ? this.route.wrap?.(s) ?? s : s)?.v || 50; }
  get cops() { return this.traffic.cars.filter((c) => c.active && c.cop); }

  reset(enabled = this.enabled) {
    this.enabled = enabled && (this.traffic.allowClosedRoam || this.traffic.allowClosedPolice || !this.route.closed && !this.traffic.route?.closed); // free roam opts into patrols on every map
    if (!this.enabled) this.traffic.allowClosedPolice = false;
    this.hm.reset(); this.t = 0; this.P = null; this.pending.length = 0; this.contacts = new Map(); this.contactWitness = null; this.speedT = 0; this.flagrantT = 0; this.pedT = -Infinity;
    for (const c of this.traffic.cars) if (c.police) { c.active = false; c.m.root.visible = false; c.cop = null; c.crash = null; c.m.setStrobe?.(false, 0); }
    for (const b of this.blocks.slice()) this.clearBlock(b);
    this.patrols = patrolPlan(this.route, this.traffic.data, this.traffic.signals?.J); this.reinT = 10; this.blockT = 30;
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
    let seen = false, near = 0, nearest = 1e9;
    const lvl = hm.level, range = hm.active ? 150 + 20 * lvl : HEAT.witnessRange;
    for (const c of this.cops) {
      const k = c.cop;
      if (c.crash) { k.sees = false; if (c.crash.wreck && !k.down) { k.down = true; k.chase = false; k.siren = false; k.keep = false; /* a wreck: traffic culls it once you're past */ if ((hm.active || k.wasChasing) && this.t - (k.hitT ?? -99) < 4) out.push(...this.takedown(c)); } continue; }
      k.losT = (k.losT || 0) - dt;
      const d = this.distance(c, P);
      if (k.losT <= 0 || d > range) { k.losT = 0.2 + rng.range(0, 0.1); k.sees = d <= range && this.los(c, P); }
      if (k.sees) seen = true;
      if (k.chase && d < HEAT.bustDist) near++;
      if (k.chase) nearest = Math.min(nearest, d);
    }
    // Fresh, short-range LOS for offences: pursuit tracking is not evidence.
    const witness = this.witnesses(P);
    const lim = this.limitAt(P.s), speeding = witness && kmh > lim + HEAT.speedMargin, flagrant = speeding && kmh > lim + HEAT.seriousMargin;
    const wrongSide = witness && kmh > 30 && P.u * D < -1.5;
    this.speedT = speeding ? this.speedT + dt : 0;
    this.flagrantT = flagrant ? (this.flagrantT || 0) + dt : 0;
    if (speeding) hm.offence('speeding', dt * (hm.active ? HEAT.pursuitSpeedHeat : flagrant ? HEAT.seriousSpeedHeat : HEAT.speedHeat), true,
      { continuous: true, sustained: this.speedT >= HEAT.sustainedAfter - 1e-6 || this.flagrantT >= HEAT.seriousSustainedAfter - 1e-6 });
    if (wrongSide) hm.offence('wrongside', dt * (hm.active ? 0.03 : 0.06), true, { continuous: true });
    // G.reds includes camera/history counts. Only the stop-line's actual
    // witness callback may add red-light heat; never infer it from a counter.
    for (const e of ctx.events || []) {
      if (e.who !== 'player' || !e.car || (e.kind !== 'crash' && e.kind !== 'bump')) continue;
      const k = e.car.cop;
      if (k?.chase && ['pit', 'ram', 'box'].includes(k.tactic)) continue;
      if (!k && !witness) continue;
      if (this.t - (this.contacts.get(e.car) ?? -Infinity) < HEAT.contactCooldown) continue;
      this.contacts.set(e.car, this.t);
      if (k) { this.contactWitness = e.car; k.hitT = this.t; hm.offence('hitcop', e.kind === 'crash' ? 1 : 0.4, true, { serious: e.kind === 'crash' }); }
      else {
        const serious = e.kind === 'crash' && e.dv >= 8;
        hm.offence(e.kind, serious ? 1 : e.kind === 'crash' ? 0.4 : 0.15, true, { serious });
      }
    }
    for (const [car, time] of this.contacts) if (this.t - time > 5) this.contacts.delete(car);
    for (const p of this.pending) hm.offence(p.kind, p.amt, p.witnessed ?? witness);
    this.pending.length = 0;
    // ---- the state machine
    const tr0 = hm.update(dt, { seen, offending: speeding || wrongSide, fleeing: kmh > lim + HEAT.fleeMargin, copNear: near > 0, copsNear: near, slow: Math.hypot(P.vs, P.vu) < HEAT.bustSpeed });
    for (const e of tr0) {
      out.push(e);
      if (e.phase === 'warning') this.warn();
      if (e.phase === 'start' || e.phase === 'resume') this.engage(e.kind === 'event');
      if (e.phase === 'evaded' || e.phase === 'busted' || e.phase === 'released') this.standDown();
    }
    this.contactWitness = null;
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
      this.pedT = this.t; this.pending.push({ kind: 'pedestrian', amt: e.kind === 'dive' ? 0.3 : 0.15 });
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

  /** Authoritative solo stop-line witness; online clients never call this. */
  witnessedRed(P) {
    if (this.witnesses(P)) this.pending.push({ kind: 'red', amt: 0.3, witnessed: true });
  }
  witnesses(P = this.P) {
    return !!(this.enabled && P && this.cops.some(c => !c.crash && this.distance(c, P) <= HEAT.witnessRange && this.los(c, P)));
  }
  distance(c, P) {
    const a = this.route.point(c.s, c.u), b = this.route.point(P.s, P.u);
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
  warn() {
    const c = this.cops.filter(c => !c.crash && this.distance(c, this.P) <= HEAT.witnessRange && this.los(c, this.P))
      .sort((a, b) => this.distance(a, this.P) - this.distance(b, this.P))[0] || this.contactWitness;
    this.contactWitness = null;
    if (c && c.active && !c.crash) { this.enlist(c); c.cop.tactic = 'tail'; }
  }

  /** line of sight from a unit to the player over the real ground (hills, cliff faces) and buildings */
  los(c, P) {
    const route = this.route, g = this.traffic.ground;
    const a = route.point(c.s, c.u), b = route.point(P.s, P.u);
    if (!g) return true; // headless straight-road fixtures have no occluders
    const ya = a.y + 1.3, yb = b.y + 1.2, q = this._q || (this._q = {}), w = this._w || (this._w = {});
    const n = Math.max(3, Math.min(80, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3)));
    let hint = c.s;
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = ya + (yb - ya) * t;
      const pr = route.project(x, z, hint, 60); hint = pr.s;
      // Hills and building walls can block even a close unit/on-road sample.
      if (g.at(x, z, pr.s, pr.u, q).y > y + 0.3) return false;
      if (g.walls(x, z, 0.4, w)) return false;
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
    // Units that can see you, or are close, join; at most the chase cap of them.
    const free = this.cops.filter(c => !c.crash && !c.cop.block && (c.cop.sees || c.cop.chase || Math.abs(c.s - P.s) < 200)).sort((a, b) => Math.abs(a.s - P.s) - Math.abs(b.s - P.s));
    for (const c of free.slice(0, HEAT.maxChasers)) this.enlist(c);
    if (fromEvent) for (let i = 0; i < 2; i++) { const c = this.spawnBehind(P, D, 200 + i * 60, Math.max(10, P.vs * D)); if (c) this.enlist(c); }
    if (!this.cops.some((c) => c.cop.chase)) { const c = this.spawnBehind(P, D, 220, Math.max(10, P.vs * D + 5)); if (c) this.enlist(c); }
  }
  /** a unit can only appear where the player cannot see it pop in */
  hidden(s, P = this.P) { return !P || !this.los({ s, u: 0 }, P); }
  spawnBehind(P, D, gap, v, opts = {}) { return this.spawnCop(P.s - D * gap, D, { v, ...opts }); }
  /** after busted / evaded: everybody back to normal duties */
  standDown() {
    const tr = this.traffic;
    for (const c of this.cops) {
      const k = c.cop;
      if (k.block) continue;
      k.chase = false; k.siren = false; k.keep = !!k.station; k.tactic = 'tail';
      if (!c.crash) { tr.initDrive(c); c.v0 = tr.roadSpeed(c.s) * c.drv.vf; }
    }
    for (const b of this.blocks) b.done = true;
  }
  manage(dt) {
    const tr = this.traffic, hm = this.hm, P = this.P, D = this.D, rng = this.rng;
    const cops = this.cops, chasing = cops.filter((c) => c.cop.chase && !c.crash);
    // Fixed sites stream at their map coordinates, never in front of a racer.
    if (!hm.active && hm.state !== 'warning') {
      // Back to normal duties: no patrol pops in while you are close by, and none at all in the quiet spell.
      const settling = this.t > 0.5;
      for (const site of this.patrols) {
        if (site.car && (!site.car.active || site.car.cop?.station !== site.id)) site.car = null;
        if (site.fixed && site.car && Math.abs(site.car.s - P.s) > 1100) {
          site.car.active = false; site.car.m.root.visible = false; site.car.cop = null; site.car = null;
        }
        const gap = Math.abs(site.s - P.s);
        if (!site.car && (site.fixed ? gap < 900 : !site.started) && (!settling || hm.quiet <= 0 && (gap > 350 || this.hidden(site.s, P)))) {
          const c = this.spawnCop(site.s, site.dir, { mode: site.fixed ? 'radar' : 'patrol', moto: site.moto });
          if (!c) continue;
          site.car = c; site.started = true; c.cop.station = site.id; c.cop.keep = true;
          if (site.fixed) { c.mode = 'parked'; c.parkT = 1e9; c.v = 0; c.u = tr.kerbU(c, site.s, -0.6); }
        }
        if (!site.fixed && site.car && (site.car.s < 60 || site.car.s > this.route.length - 60)) site.car.dir = site.car.s < 60 ? 1 : -1;
      }
    } else if (hm.state === 'warning') {
      // One following officer with lights. No reinforcements, PIT or roadblocks.
      for (const c of chasing) c.cop.tactic = 'tail';
    } else {
      // ---- reinforcements: 1 unit at one star, 2 at two-three, 3 from four; slowly, from behind (out of
      // the chase camera) and from 3 stars sometimes from far ahead, only where you can't see them appear
      const want = Math.min(HEAT.maxChasers, [0, 1, 2, 2, 3, 3][hm.level]);
      const units = cops.filter(c => !c.cop.block && !c.crash).length;
      this.reinT -= dt;
      if (hm.state === 'pursuit' && chasing.length < want && units < HEAT.maxUnits && this.reinT <= 0) {
        this.reinT = rng.range(10, 16) / (0.7 + 0.15 * hm.level);
        const sAhead = P.s + D * rng.range(450, 600);
        const ahead = hm.level >= 3 && rng.chance(0.4) && this.hidden(sAhead, P);
        const c = ahead ? this.spawnCop(sAhead, -D, { moto: rng.chance(0.2) }) : this.spawnBehind(P, D, rng.range(220, 300), Math.max(12, P.vs * D * 0.9 + 6), { moto: rng.chance(0.25) });
        if (c) this.enlist(c);
      }
      // ---- roadblocks from 4 stars, rarely
      this.blockT -= dt;
      if (hm.level >= 4 && hm.state === 'pursuit' && this.blockT <= 0 && !this.blocks.some((b) => !b.done)) { this.blockT = rng.range(60, 90); this.roadblock(); }
      // ---- units fallen far behind or gone far ahead go back to other duties
      for (const c of chasing) { const g = (P.s - c.s) * D; if (g > 520 || g < -900) { c.active = false; c.m.root.visible = false; c.cop = null; } }
      // ---- tactics: rank the units by distance; the nearest does the PIT / ram, the next tries to box you in
      const live = chasing.filter(c => c.active && c.cop);
      live.sort((a, b) => Math.abs(a.s - P.s) - Math.abs(b.s - P.s));
      live.forEach((c, i) => {
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
