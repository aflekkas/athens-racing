import {validateRivalPlan,unpackRivalArray,rivalLineKey} from './rival-plan.js';
import {entryYieldDistance} from './roundabouts.js';
// Race driving uses only ordinary Vehicle inputs. Geometry stays in route metres;
// closed routes repeat their line/profile, while vehicle.s stays unwrapped across laps.
const G = 9.81;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const wrap = (s, length) => ((s % length) + length) % length;
const pointOut = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Side-by-side passes may use the asphalt down to this body clearance.
const PASS_MARGIN = 0.3;
// Asphalt kept outside the body when racing: 0.15 m more than before, because a rival now reaches its entry line with up to ~0.3 m of overshoot.
const RACE_MARGIN = 1.1;
const scratchBounds = {};

/** Stable flat-road capability adapter. New handling implementations own these
 * methods; the fallback derives the same tyre/engine limits as the old physics. */
export function vehicleCapabilities(veh) {
  const sp = veh.spec, mass = veh.m || sp.mass;
  const drag = (v) => 0.6 * sp.cdA * v * v / mass + 0.012 * G;
  const lat = (v) => {
    if (veh.maxLatAccel) return veh.maxLatAccel(v);
    const load = G + 0.6 * (sp.clA || 0) * v * v / mass;
    return 0.88 * sp.grip * load * (1 - (sp.loadSens ?? 0.15) * Math.max(0, load / G - 1));
  };
  return {
    lat,
    brake: (v) => veh.maxBrakeDecel ? veh.maxBrakeDecel(v) : Math.min(sp.grip * G * (veh.muX ?? 1.1) * 0.97, sp.brake * sp.grip * G * 1.15) + drag(v),
    drive: (v, gear) => {
      if (veh.maxDriveAccel) return veh.maxDriveAccel(v, gear);
      let force = 0;
      for (let g = 1; g <= sp.gears.length; g++) {
        if (gear && g !== gear) continue;
        const ratio = sp.gears[g - 1] * sp.final, rpm = Math.max(sp.idle, v / sp.wheelR * ratio * 30 / Math.PI);
        if (rpm > sp.redline) continue;
        const tq = veh.torqueMax ? veh.torqueMax(rpm) : Math.min(sp.torque, sp.power * 1000 / (rpm * Math.PI / 30));
        force = Math.max(force, tq * ratio * 0.92 / sp.wheelR / mass);
      }
      const driven = sp.drive === 'awd' ? 1 : sp.drive === 'fwd' ? (sp.frontW ?? 0.55) : 1 - (sp.frontW ?? 0.55);
      return Math.max(0, Math.min(force, lat(v) * (veh.muX ?? 1.1) * driven) - drag(v));
    },
    lock: (v) => veh.steerLockAt ? veh.steerLockAt(v) : veh.lockAt(v),
    steer: (k, v) => {
      if (veh.steerInputFor) return veh.steerInputFor(k, v);
      // Invert the legacy rack/counter-steer helper without changing any aid.
      // A small input otherwise gets cancelled by its automatic slide catch.
      const angle = Math.atan(veh.wb * k), lock = veh.lockAt(v);
      const beta = Math.atan2(veh.vLat, Math.max(2, Math.abs(veh.vLong)));
      const t = clamp((v - 5) / 9, 0, 1), fade = t * t * (3 - 2 * t);
      let input = angle / lock;
      for (let i = 0; i < 4; i++) {
        const counter = Math.sign(input) === Math.sign(beta) ? Math.min(0.5, Math.abs(beta)) : 0;
        const helper = clamp(beta * 0.55, -0.22, 0.22) * fade * (Math.abs(input) < 0.1 ? 1 : 0.35) * (1 - 0.6 * (veh.driftLatch || 0));
        input = (angle - helper) / (lock + counter);
      }
      return clamp(input, -1, 1);
    },
    rearSlip: () => {
      const c = veh.corners; if (!c) return 0;
      let m = 0; for (let i = 2; i < c.length; i++) m = Math.max(m, c[i].sN || 0);
      return m;
    },
    vmax: sp.vmax / 3.6,
  };
}

// Entries may override these fields explicitly. Existing DRIVERS risk/mistakes
// remain useful for personality, but never increase grip or power.
export function driverPersonality(driver = {}) {
  const risk = clamp(driver.risk ?? 1, 0, 2);
  const aggression = driver.aggression ?? clamp(0.4 + risk * 0.25, 0, 1);
  return {
    // A 4% spread between the slowest and fastest locals: some are quicker
    // than others, so the field does not settle into one nose-to-tail train.
    pace: driver.racePace ?? mix(0.955, 0.995, clamp((driver.pace ?? 0.9) - 0.86, 0, 0.07) / 0.07),
    aggression,
    smooth: driver.smooth ?? clamp(1 - (driver.mistakes ?? 1) * 0.22, 0.4, 1),
    risk,
    mistakeRate: driver.mistakeRate ?? (driver.mistakes ?? 1) / 360,
    // Seconds of being held up before committing to a move; gap kept to a
    // passed car's flank; how late they brake (share of the brake budget).
    patience: driver.patience ?? mix(2.4, 0.6, aggression),
    passGap: mix(0.8, 0.45, aggression),
    brakeBudget: mix(0.64, 0.76, aggression),
  };
}

/** Bounds are asphalt edges, not wall positions. Custom roadEdges(s,dir)
 * supplies {min,max} in signed route u, before body/safety clearance. */
export function racingBounds(route, s, dir = 1, halfWidth = 0.95, roadEdges, oncoming = false, margin = 0.95, out = {}) {
  let lo, hi;
  if (roadEdges) { const b = roadEdges(s, dir); lo = b.min; hi = b.max; }
  else if(route.isWorldRoute){const f=route.frame(s);lo=-f.leftM;hi=f.rightM;}
  else if (route.closed) { hi = route.edge(s); lo = -hi; }
  else {
    const median = route.medHalf?.(s) ?? 0;
    const edge = route.edge(s);
    if (oncoming && (route.div?.(s) ?? 0) < 0.3) { lo = -edge; hi = edge; }
    else if (dir > 0) { lo = median; hi = edge; } else { lo = -edge; hi = -median; }
  }
  // margin: asphalt kept outside the body. Racing uses 0.95 m; a side-by-side
  // pass may use the road down to its painted edge (walls sit further out).
  const clearance = halfWidth + margin;
  const min = lo + clearance, max = hi - clearance;
  if (min <= max) { out.min = min; out.max = max; } else out.min = out.max = (lo + hi) / 2;
  return out;
}

const lineCache = new WeakMap();
export class RacingLine {
  constructor(route, { dir = 1, halfWidth = 0.95, roadEdges, spacing = 2, closedRoad = false } = {}) {
    this.route = route; this.dir = dir; this.halfWidth = halfWidth; this.roadEdges = roadEdges;
    this.closed = !!route.closed; this.length = route.length;
    this.closedRoad = closedRoad;
    this.n = Math.ceil(route.length / spacing) + (this.closed ? 0 : 1);
    this.step = route.length / (this.closed ? this.n : this.n - 1);
    this.u = new Float64Array(this.n); this.x = new Float64Array(this.n); this.z = new Float64Array(this.n);
    const lo = new Float64Array(this.n), hi = new Float64Array(this.n), frames = [], merged = [];
    const setPoint = (i, u) => {
      if (merged[i]) {
        const p = route.point(i * this.step, u, pointOut());
        this.x[i] = p.x; this.z[i] = p.z;
      } else {
        const f = frames[i]; this.x[i] = f.x + f.rx * u; this.z[i] = f.z + f.rz * u;
      }
    };
    for (let i = 0; i < this.n; i++) {
      const s = i * this.step, b = this.bounds(s), f = route.frame(s, {});
      // A mapped carriageway can curve away from the race centre road.
      // Construct its local affine u->world frame before measuring the line;
      // route.point() and our steering targets already follow this carriageway.
      if (route.localLayout?.contains(s)) {
        const u = (b.min + b.max) / 2, p = route.point(s, u, pointOut());
        const l = route.point(s, u - 0.25, pointOut()), r = route.point(s, u + 0.25, pointOut());
        f.rx = (r.x - l.x) * 2; f.rz = (r.z - l.z) * 2;
        f.x = p.x - f.rx * u; f.z = p.z - f.rz * u;
        f.grade = route.contactFrame(s, u, {}).grade;
        f.uScale2 = f.rx * f.rx + f.rz * f.rz;
      }
      lo[i] = b.min; hi[i] = b.max; frames.push(f);
      // Across a merging median the two mapped carriageways and their connector
      // are piecewise affine. Evaluate actual points and refresh the tangent
      // when relaxation crosses branches instead of extrapolating the median.
      merged[i] = !!route.localLayout?.contains(s) && b.min < 0 && b.max > 0;
      this.u[i] = clamp(route.closed ? route.racingU?.(s) ?? 0 : (b.min + b.max) / 2, b.min, b.max);
      setPoint(i, this.u[i]);
    }
    // Projected multiscale relaxation minimises the squared second derivative
    // of the world path. Larger stencils establish turn-in/apex/exit; smaller
    // ones remove local kinks. All iterations retain asphalt/body clearance.
    for (const stride of [12, 6, 3, 1]) for (let pass = 0; pass < 120; pass++) {
      for (let i = 0; i < this.n; i++) {
        if (!this.closed && (i < stride * 2 || i >= this.n - stride * 2)) continue;
        const a = this.index(i - stride), b = this.index(i + stride), c = this.index(i - 2 * stride), d = this.index(i + 2 * stride), f = frames[i];
        if (merged[i]) {
          const s = i * this.step, u = this.u[i], p = route.point(s, u, pointOut());
          const l = route.point(s, u - 0.001, pointOut()), r = route.point(s, u + 0.001, pointOut());
          f.rx = (r.x - l.x) / 0.002; f.rz = (r.z - l.z) / 0.002;
          f.x = p.x - f.rx * u; f.z = p.z - f.rz * u;
          f.uScale2 = f.rx * f.rx + f.rz * f.rz;
        }
        const target = ((4 * (this.x[a] + this.x[b]) - this.x[c] - this.x[d]) / 6 - f.x) * f.rx +
          ((4 * (this.z[a] + this.z[b]) - this.z[c] - this.z[d]) / 6 - f.z) * f.rz;
        const projected = target / (f.uScale2 || 1);
        this.u[i] = clamp(mix(this.u[i], projected, 0.28), lo[i], hi[i]);
        setPoint(i, this.u[i]);
      }
    }
    // Refine with actual geometric curvature, weighted by path length. Route s
    // and line arc length differ at an apex; normalising here prevents the
    // smoother from favouring an impossibly tight shortcut through a hairpin.
    const curvatureCost = (i) => {
      const a = this.index(i - 1), b = this.index(i), c = this.index(i + 1);
      const ax = this.x[b] - this.x[a], az = this.z[b] - this.z[a], bx = this.x[c] - this.x[b], bz = this.z[c] - this.z[b];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), chord = Math.hypot(ax + bx, az + bz);
      if (Math.min(la, lb, chord) < 0.1) return 1000;
      const k = 2 * (ax * bz - az * bx) / (la * lb * chord);
      return k * k * (la + lb) / 2;
    };
    for (const delta of [0.6, 0.25, 0.08]) for (let pass = 0; pass < 24; pass++) {
      for (let i = this.closed ? 0 : 2; i < this.n - (this.closed ? 0 : 2); i++) {
        const original = this.u[i];
        const score = () => curvatureCost(i - 1) + curvatureCost(i) + curvatureCost(i + 1);
        let bestU = original, bestScore = score();
        for (const u of [clamp(original - delta, lo[i], hi[i]), clamp(original + delta, lo[i], hi[i])]) {
          setPoint(i, u);
          const cost = score();
          if (cost < bestScore) { bestScore = cost; bestU = u; }
        }
        this.u[i] = bestU; setPoint(i, bestU);
      }
    }
    this.k = new Float64Array(this.n); this.grade = new Float64Array(this.n); this.vertical = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      // A broad geometric stencil avoids aliasing at sampled route vertices.
      const a = this.index(i - 2), b = this.index(i + 2);
      const ax = this.x[i] - this.x[a], az = this.z[i] - this.z[a], bx = this.x[b] - this.x[i], bz = this.z[b] - this.z[i];
      const denom = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(ax + bx, az + bz);
      this.k[i] = denom > 0.01 ? 2 * (ax * bz - az * bx) / denom : route.curv?.(i * this.step) || 0;
      this.grade[i] = (merged[i] ? route.contactFrame(i * this.step, this.u[i], {}).grade : frames[i].grade) || 0;
      const s = i * this.step;
      this.vertical[i] = route.y ? (route.y(s - 3) - 2 * route.y(s) + route.y(s + 3)) / 9 : 0;
    }
  }
  index(i) { return this.closed ? (i % this.n + this.n) % this.n : clamp(i, 0, this.n - 1); }
  bounds(s, oncoming = false, wide = false, out = {}) { return racingBounds(this.route, s, this.dir, this.halfWidth, this.roadEdges, oncoming || this.closedRoad, wide && !this.closed ? PASS_MARGIN : RACE_MARGIN, out); }
  sample(A, s) {
    const t = (this.closed ? wrap(s, this.length) : clamp(s, 0, this.length)) / this.step, i = Math.floor(t);
    return mix(A[this.index(i)], A[this.index(i + 1)], t - i);
  }
  point(s, offset = 0, oncoming = false, wide = false, out = pointOut()) {
    const b = this.bounds(s, oncoming, wide, scratchBounds), u = clamp(this.sample(this.u, s) + offset, b.min, b.max);
    return this.route.point(s, u, out);
  }
  /** Curvature of the path held `offset` metres beside the line at s. A
   * parallel curve has k/(1-k*offset); where the offset is clipped by the
   * asphalt the car follows the road edge instead. No allocation. */
  offsetCurvature(s, offset, oncoming = false, wide = false) {
    const base = this.sample(this.u, s), b = this.bounds(s, oncoming, wide, scratchBounds), u = base + offset;
    if (u < b.min || u > b.max) {
      const k = this.route.curv?.(s) || 0, edge = u < b.min ? b.min : b.max;
      return k / Math.max(0.2, 1 - k * edge);
    }
    const k = this.sample(this.k, s);
    return k / Math.max(0.2, 1 - k * offset);
  }
  speedProfile(veh) {
    const caps = vehicleCapabilities(veh), v = new Float64Array(this.n);
    // These steady-state solves repeat at exactly the same speeds across
    // stations and forward/backward passes. Reuse exact values for this build
    // only; a later weather/damage refresh always gets fresh capabilities.
    if (veh.planningStateKey?.()!=null) for (const name of ['lat','brake','drive','lock']) {
      const solve=caps[name],values=new Map();
      caps[name]=speed=>{if(!values.has(speed))values.set(speed,solve(speed));return values.get(speed);};
    }
    const load = (i, speed) => clamp(1 + speed * speed * this.vertical[i] / G, 0.15, 2.2);
    for (let i = 0; i < this.n; i++) {
      let limit = caps.vmax;
      if (this.vertical[i] < -1e-5) limit = Math.min(limit, Math.sqrt(0.7 * G / -this.vertical[i]));
      for (let pass = 0; pass < 5; pass++) limit = Math.min(limit, Math.sqrt(caps.lat(limit) * load(i, limit) * 0.97 / Math.max(1e-6, Math.abs(this.k[i]))));
      // Parking-radius hairpins also have a rack limit. Slowing into the
      // kinematic regime lets the normal physics make a tight three-point-free
      // turn rather than demanding an impossible tyre angle at racing speed.
      if (Math.abs(this.k[i]) > 0.12) {
        const angle = Math.atan(veh.wb * Math.abs(this.k[i]));
        while (limit > 1.4 && angle > caps.lock(limit) * 0.94) limit = Math.max(1.4, limit - 0.5);
      }
      // Narrow street junctions need room for the full body to turn.
      v[i] = this.route.streetCircuit ? Math.max(1.4, limit * .55) : limit;
    }
    // Cyclic passes converge even when the limiting bend spans the lap seam.
    for (let pass = 0; pass < (this.closed ? 8 : 3); pass++) {
      for (let q = 0; q < this.n; q++) {
        const i = this.dir > 0 ? q : this.n - 1 - q, j = this.index(i + this.dir);
        if (!this.closed && (i + this.dir < 0 || i + this.dir >= this.n)) continue;
        const normal = load(i, v[i]);
        const lateral = clamp(v[i] * v[i] * Math.abs(this.k[i]) / Math.max(1, caps.lat(v[i]) * normal), 0, 0.99);
        const traction = Math.sqrt(1 - lateral * lateral);
        const accel = Math.max(0, caps.drive(v[i]) * traction * Math.min(1, normal) - this.grade[i] * this.dir * G);
        v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * accel * this.step));
      }
      for (let q = this.n - 1; q >= 0; q--) {
        const i = this.dir > 0 ? q : this.n - 1 - q, j = this.index(i + this.dir);
        if (!this.closed && (i + this.dir < 0 || i + this.dir >= this.n)) continue;
        const normal = Math.min(load(i, v[i]), load(j, v[j]));
        const lateral = clamp(Math.max(v[j] * v[j] * Math.abs(this.k[j]) / Math.max(1, caps.lat(v[j]) * normal),
          v[i] * v[i] * Math.abs(this.k[i]) / Math.max(1, caps.lat(v[i]) * normal)), 0, 0.99);
        const decel = Math.max(1, caps.brake(v[j]) * normal * Math.sqrt(1 - lateral * lateral) * 0.94 + this.grade[i] * this.dir * G);
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * decel * this.step));
      }
    }
    return v;
  }
  offsetProfile(veh, offset, oncoming = false) {
    const variant = Object.create(this), x = new Float64Array(this.n), z = new Float64Array(this.n);
    variant.k = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const p = this.point(i * this.step, offset, oncoming); x[i] = p.x; z[i] = p.z;
    }
    for (let i = 0; i < this.n; i++) {
      const a = this.index(i - 2), b = this.index(i + 2);
      const ax = x[i] - x[a], az = z[i] - z[a], bx = x[b] - x[i], bz = z[b] - z[i];
      const denom = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(ax + bx, az + bz);
      variant.k[i] = denom > 0.01 ? 2 * (ax * bz - az * bx) / denom : this.k[i];
    }
    return variant.speedProfile(veh);
  }
}


function getLine(route, veh, options) {
  if (options.roadEdges) return new RacingLine(route, { ...options, halfWidth: veh.halfW });
  let cache = lineCache.get(route); if (!cache) lineCache.set(route, cache = new Map());
  const key = `${options.dir || 1}:${veh.halfW}:${!!options.closedRoad}`;
  if (!cache.has(key)) {
    const plan=route.compiled&&validateRivalPlan(route.compiled,{required:!!route.requireRivalPlan}),data=plan?.lines[rivalLineKey(options.dir||1,veh.halfW)];
    if(data){const line=Object.create(RacingLine.prototype);Object.assign(line,{route,dir:options.dir||1,halfWidth:veh.halfW,closedRoad:!!options.closedRoad,closed:!!route.closed,length:route.length,n:plan.n,step:plan.step});for(const name of ['u','k','grade','vertical'])line[name]=unpackRivalArray(data[name]||plan[name],plan.n);cache.set(key,line);}
    else {if(route.requireRivalPlan)throw Error('Missing shipped rival line');cache.set(key,new RacingLine(route,{...options,halfWidth:veh.halfW}));}
  }
  return cache.get(key);
}

/** Geometry only: prepare the same cached line while contact cells download. */
export function prepareRacingLine(route,halfWidth,options={}) {
  return getLine(route,{halfW:halfWidth},options);
}

// A restart restores the same capability state. Keep one bounded profile per
// vehicle/line; weather, damage, mass, engine and spec changes invalidate it.
// Vehicles without an exact state contract continue to calculate every time.
const profileCache = new WeakMap();
function preparedProfile(line, veh) {
  const key = veh.planningStateKey?.();
  if (key == null) return line.speedProfile(veh);
  let cache = profileCache.get(line); if (!cache) profileCache.set(line, cache = new WeakMap());
  const methods = [veh.maxLatAccel,veh.maxBrakeDecel,veh.maxDriveAccel,veh.steerLockAt],old = cache.get(veh);
  if (old?.key === key && methods.every((method,i)=>method===old.methods[i])) return old.profile.slice();
  const plan=line.route.compiled?.rivalPlan,shipped=plan?.profiles[veh.spec.id];
  let profile;
  if(shipped?.stateKey===key&&shipped.lineKey===rivalLineKey(line.dir,line.halfWidth))profile=unpackRivalArray(shipped.v,line.n);
  else {
    if(line.route.requireRivalPlan&&!shipped)throw Error('Missing shipped rival speed profile');
    // Weather and damage change live capabilities after entry. This remains
    // the existing adaptive solve, never a substitute for a missing artifact.
    profile=line.speedProfile(veh);
  }
  cache.set(veh, { key, methods, profile: profile.slice() });
  return profile;
}

const obstacleKey = (record) => record.veh || record.a?.veh || record.a || record;
// Route-space snapshot of a racer or civilian, written into a pooled record.
function fillObstacle(o, route, record, dir, frame) {
  o.ref = record; o.key = obstacleKey(record);
  if (record.veh) {
    const v = record.veh, f = route.frame(v.s, frame), yaw = Math.atan2(-f.tx, -f.tz), angle = wrapPi(v.yaw - yaw);
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    o.racer = true; o.s = v.s; o.u = v.u; o.hs = c * v.halfL + s * v.halfW; o.hu = c * v.halfW + s * v.halfL;
    o.vs = (v.vLong * Math.cos(angle) + v.vLat * Math.sin(angle)) * dir; o.vu = -v.vLong * Math.sin(angle) + v.vLat * Math.cos(angle);
    return o;
  }
  o.racer = false; o.s = record.s; o.u = record.u;
  o.hs = record.hs ?? (record.len ? record.len / 2 : 2.2); o.hu = record.hu ?? (record.wid ? record.wid / 2 : 1);
  o.vs = (record.vs ?? (record.crash ? record.crash.vs : record.cross ? record.xvs : (record.dir || 1) * (record.v || 0))) * dir;
  o.vu = record.vu ?? (record.crash ? record.crash.vu : record.cross ? record.xvu : record.uv) ?? 0;
  return o;
}

/** Highest speed a path of curvature k holds with lateral grip lat (m/s^2). */
export function cornerSpeed(k, lat, vmax = Infinity) { return Math.min(vmax, Math.sqrt(lat / Math.max(1e-6, Math.abs(k)))); }

/** Braking zone planner. sampler.limit(d) is the speed allowed d metres ahead
 * (from the curvature-derived speed profile). Starts braking only once the
 * deceleration needed to make the slowest point ahead exceeds `budget` of the
 * car's brake capability; `reaction` seconds of travel are not brake distance.
 * Writes { target, brake } into out: the speed to aim for now, and the brake
 * share the most demanding point ahead already calls for. */
export function planBraking(v, decel, budget, reaction, sampler, horizon, step = 4, out = {}) {
  out.target = Infinity; out.brake = 0;
  const cap = Math.max(1, decel);
  for (let d = step; d < horizon; d += step) {
    const future = sampler.limit(d);
    const need = (v * v - future * future) / (2 * Math.max(1, d - v * reaction));
    if (need > cap * budget && future < out.target) out.target = future;
    if (need > 0 && need / cap > out.brake) out.brake = need / cap;
  }
  return out;
}

/** Commit to an overtake once held up longer than the driver's patience,
 * close enough to make the move, and not still shaken from contact. */
export function shouldCommit(heldT, patience, gap, v, cooldown = 0, composure = 0, closing = 0) {
  // On the bumper (about half a second back), or arriving with real closing speed.
  const close = gap < Math.max(8, v * 0.45) || closing > 2 && gap < Math.max(12, v * 0.9);
  return heldT >= patience && cooldown <= 0 && composure <= 0 && close;
}

/** A street racer goes round a slower civilian at once: pull out while still
 * a few car lengths back and arrive in the other lane, instead of queueing on
 * its bumper first (from there a slow car cannot swing out). */
export function civilianPass(racer, freeSpeed, leaderSpeed, gap, v, cooldown = 0, composure = 0) {
  return !racer && cooldown <= 0 && composure <= 0 && freeSpeed - leaderSpeed > 2.5 && gap > 1.5 && gap < Math.max(14, v * 2.2);
}

/** Side for a pass: -1 / +1 in route u, or 0 to stay behind. roomLeft/Right
 * are the spare metres beside the car ahead along the passing stretch
 * (negative: no room). Prefers the inside of the next bend (the late-braking
 * move), then whichever side we already lean toward. */
export function choosePassSide(roomLeft, roomRight, inside = 0, bias = 0, aggression = 0.5, minRoom = 0) {
  const score = (room, side) => room < minRoom ? -Infinity : Math.min(room, 1) + (side === inside ? 0.4 + 0.8 * aggression : 0) + (Math.sign(bias) === side ? 0.5 : 0);
  const l = score(roomLeft, -1), r = score(roomRight, 1);
  if (l === -Infinity && r === -Infinity) return 0;
  return r >= l ? 1 : -1;
}

/** Progress of a committed pass. leaderD: centre gap to the car being passed
 * (positive while it is still ahead); room: spare lateral metres on our side.
 * 'cleared' once its nose is clearGap behind our tail; 'abort' if the door
 * closes before we are alongside, we are being squeezed, or we stop gaining. */
export function passVerdict(leaderD, halfL, leaderHs, room, stall, stallLimit, elapsed, clearGap = 3) {
  if (leaderD < -(halfL + leaderHs + clearGap)) return 'cleared';
  const alongside = leaderD < halfL + leaderHs - 1;
  if (room < 0 && !alongside) return 'abort';
  if (room < -0.35) return 'abort';
  if (stall > stallLimit || elapsed > 14) return 'abort';
  return 'continue';
}

/** Never steer into a car alongside. Caps a lateral target so it stops
 * `gap` metres short of the other body; if we are already inside that line,
 * we may hold or move away, never closer. */
export function alongsideLimit(desiredU, ownU, ownHalfW, otherU, otherHu, gap = 0.5) {
  const side = Math.sign(otherU - ownU) || 1, line = otherU - side * (ownHalfW + otherHu + gap);
  return side > 0 ? Math.min(desiredU, Math.max(line, ownU)) : Math.max(desiredU, Math.min(line, ownU));
}

const EMPTY = [], NO_OPTIONS = {};
// A racer that has pulled out beside or just behind us is owed racing room.
const roomFor = (o, veh) => o.racer && o.d < 0 && o.d > -(veh.halfL + o.hs + 8) && Math.abs(o.u - veh.u) > veh.halfW + o.hu - 0.4;
export class RivalAI {
  constructor(route, veh, options = {}) {
    this.route = route; this.veh = veh; this.spec = veh.spec; this.dir = options.dir || 1;
    this.perfect = !!options.perfect; this.personality = driverPersonality(options.driver);
    this.line = getLine(route, veh, options); this.profile = preparedProfile(this.line, veh);
    this.caps = vehicleCapabilities(veh);
    this.offset = veh.u - this.line.sample(this.line.u, veh.s);
    this.elapsed = 0; this.slow = 0; this.recovery = 'drive';
    this.pass = null; this.evade = null; this.defend = null; this.unbox = null; this.overtakes = 0; this.abortedPasses = 0; this.passAttempts = 0;
    this.recoveryT = 0; this.integral = 0; this.yawI = 0; this.mistake = 0;
    this.heldT = 0; this.heldKey = null; this.cooldown = 0; this.composure = 0; this.upsets = 0; this.defendCooldown = 0; this.sideT = 0;
    this.draft = 0; this.band = 0; this.lastV = Math.hypot(veh.vLong, veh.vLat);
    this.alternateProfiles = new Map(); // retained for callers that clear it on grip changes
    let hash = 2166136261; for (const c of options.driver?.id || 'reference') hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    this.seed = hash >>> 0; this.nextMistake = 80 + this.random() * 200;
    this.launchS = veh.s; this.launchU = veh.u;
    this.launchHoldDistance = Math.hypot(veh.vLong, veh.vLat) < 1 ? 150 : 0;
    this.reaction = this.perfect ? 0 : 0.04 + (1 - this.personality.aggression) * 0.12 + this.random() * 0.08;
    // Per-rival strength of the gap-to-player pace band, so it never reads as one rule.
    this.bandScale = 0.7 + this.random() * 0.6;
    // Reused scratch: update() allocates nothing per frame.
    this._frame = {}; this._oframe = {}; this._b = {}; this._b2 = {}; this._b3 = {}; this._b4 = {}; this._mb = {};
    this._obs = []; this._pool = []; this._plan = {}; this._plan2 = {}; this._pt = pointOut();
    this._c = [0, 1, 2, 3, 4].map(() => ({ speed: 0, gap: 0, leader: null, safe: true }));
    this._passObj = { key: null, side: 0, oncoming: false, phase: 'pull', t: 0, stall: 0, abortT: 0, mergeT: 0 };
    this._defObj = { key: null, u: 0, t: 0 };
    this._input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.debug = {};
    this._s = veh.s; this._pace = 1; this._off = 0; this._offCross = false; this._offWide = false; this._lat = 9;
    const ai = this;
    this._baseSampler = { limit: (d) => ai.line.sample(ai.profile, ai._s + ai.dir * d) * ai._pace };
    this._offSampler = { limit: (d) => {
      const s = ai._s + ai.dir * d;
      if (ai._circuitProfile) return Math.min(ai.line.sample(ai.profile, s), ai.line.sample(ai._circuitProfile, s)) * ai._pace;
      const k = ai.line.offsetCurvature(s, ai._off, ai._offCross, ai._offWide);
      return Math.min(ai.line.sample(ai.profile, s), cornerSpeed(k, ai._lat * 0.97)) * ai._pace;
    } };
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  _collect(racers, traffic) {
    const obs = this._obs, veh = this.veh, route = this.route, dir = this.dir;
    obs.length = 0;
    for (let i = 0; i < racers.length; i++) { const c = racers[i]; if (c && c.veh && c.veh !== veh) this._add(c); }
    for (let i = 0; i < traffic.length; i++) {
      const c = traffic[i]; if (!c || c.active === false) continue;
      let d = ((c.veh ? c.veh.s : c.s) - veh.s) * dir; if (route.closed) d = wrap(d + route.length / 2, route.length) - route.length / 2;
      if (d < -150 || d > 540) continue;
      this._add(c);
    }
    return obs;
  }
  _add(record) {
    const obs = this._obs, pool = this._pool, route = this.route, n = obs.length;
    const o = fillObstacle(pool[n] || (pool[n] = {}), route, record, this.dir, this._oframe);
    o.d = (o.s - this.veh.s) * this.dir; if (route.closed) o.d = wrap(o.d + route.length / 2, route.length) - route.length / 2;
    // Another rival committed to passing us: which side it is coming by on.
    const ctl = record.ai?.controller || record.ai, P = ctl?.pass;
    o.attack = P && P.key === this.veh && P.phase !== 'abort' && P.phase !== 'merge' ? P.side : 0;
    // Oncoming cars matter further out (two-way pass clearance).
    if (o.d < -140 || o.d > (o.vs < -1 ? 520 : 300)) return;
    obs.push(o);
  }
  /** Slowest line speed in the next `reach` metres (hairpins are no place to pass). */
  _slowAhead(reach) {
    let m = Infinity;
    for (let d = 0; d <= reach; d += 10) m = Math.min(m, this.line.sample(this.profile, this.veh.s + this.dir * d));
    return m;
  }
  _find(key) { const obs = this._obs; for (let i = 0; i < obs.length; i++) if (obs[i].key === key) return obs[i]; return null; }
  /** The speed this lane allows given everything in it, plus the nearest car in it. */
  _corridor(u, changing, out) {
    const obs = this._obs, veh = this.veh, v = this._v, horizon = this._horizon, buffer = this._buffer, p = this.personality, brake = this._brakeV;
    const passKey = this.pass && this.pass.phase !== 'abort' ? this.pass.key : null;
    let speed = this.caps.vmax, gap = Infinity, leader = null, safe = true;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.d < -horizon || o.d > horizon + Math.max(0, -o.vs) * 5) continue;
      // The car we are passing is beside us by choice: only real overlap counts.
      // A stationary car keeps still: a crawl may pass it at 0.15 m, more room at speed.
      const target = o.key === passKey, lateral = veh.halfW + o.hu + (target ? 0.1 : o.vs < 0.5 && Math.abs(o.vu) < 0.3 ? Math.min(buffer, 0.15 + v * 0.02) : buffer);
      const time = clamp(o.d / Math.max(1, v - o.vs), 0, 3);
      const ou = o.u + clamp(o.vu * time, target ? -0.4 : -1.5, target ? 0.4 : 1.5);
      if (Math.abs(ou - u) > lateral) continue;
      const g = o.d - veh.halfL - o.hs;
      // Never move across an alongside car or cut off a fast follower.
      // Alongside (or just ahead) always blocks; a car behind only if it is
      // closing on us. A car already directly behind in our own lane is not
      // cut off by a sideways step, and a stopped one never is.
      if (changing && o.d < veh.halfL + o.hs + 5 && !(o.d < -veh.halfL && Math.abs(o.u - veh.u) < veh.halfW + o.hu - 0.2) &&
        (o.d > -veh.halfL - o.hs - 1 || o.vs > v + 0.5 && o.d > -veh.halfL - o.hs - Math.max(5, (o.vs - v) * 1.5))) safe = false;
      if (g >= -veh.halfL * 2 && g < gap) { gap = g; leader = o; }
      if (this.elapsed < 2.5 && v < 6 && o.racer && o.vs > 0.2 && g > 2.5) continue;
      if (g > -veh.halfL * 2) {
        // Racers share the braking profile and can follow at a shorter
        // headway; civilians retain the larger stopping-space allowance.
        // Behind a slow civilian keep a car length of pull-out room: from 3 m back
        // a car at walking pace cannot swing out past it.
        const lv = Math.max(0, o.vs), standstill = o.racer ? 2.6 : lv < 10 ? 5 : 3;
        const headway = o.racer ? 0.25 + (1 - p.aggression) * 0.1 : 0.35;
        const space = Math.max(0, g - standstill - lv * headway);
        speed = Math.min(speed, Math.sqrt(lv * lv + 2 * brake * 0.75 * space));
        if (g < standstill + 2 + v * headway) speed = Math.min(speed, Math.max(0, lv + (g - standstill) * 0.65));
      }
    }
    out.speed = speed; out.gap = gap; out.leader = leader; out.safe = safe;
    return out;
  }
  // Two-way roads: time to pull out, gain the car length and return.
  _passSpeed(leader, targetSpeed, v) { return Math.min(targetSpeed, Math.max(v, leader.vs + 8 + this.personality.aggression * 6)); }
  _passSeconds(leader, u, speed, baseU) {
    const p = this.personality, veh = this.veh, remaining = Math.max(0, leader.d + veh.halfL + leader.hs + 8);
    return remaining / Math.max(3, speed - leader.vs) + (Math.abs(u - veh.u) + Math.abs(u - baseU)) / 2.1 + 1.5 + (1 - p.aggression) * 1.5;
  }
  _twoWayClear(leader, u, targetSpeed, baseU, v) {
    const route = this.route, dir = this.dir, veh = this.veh, obs = this._obs;
    if (route.closed || this.line.roadEdges) return false;
    const speed = this._passSpeed(leader, targetSpeed, v), seconds = this._passSeconds(leader, u, speed, baseU), distance = speed * seconds + 25;
    for (let d = 0; d <= distance + 20; d += 20) {
      const s = veh.s + dir * d;
      if ((route.div?.(s) ?? 0) >= 0.3 || (route.medHalf?.(s) ?? 0) > 0.15 || Math.abs(route.curv?.(s) || 0) >= 0.006) return false;
    }
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.vs < -1 && o.d > -veh.halfL - o.hs && o.d - veh.halfL - o.hs < (speed - o.vs) * seconds + 25) return false;
    }
    return true;
  }
  /** Lateral position beside `leader` on `side`, tracking its line ahead. */
  _passLane(leader, side, need, b, oncoming) {
    let u = leader.u + side * need;
    // A two-way pass runs in the opposing lane, not on the white line.
    if (oncoming && !this.line.closedRoad) {
      const lane = -this.dir * (this.route.laneU ? this.route.laneU(this.veh.s, 0) : 2) * 0.6;
      u = side < 0 ? Math.min(u, lane) : Math.max(u, lane);
    }
    return clamp(u, b.min, b.max);
  }
  /** Scan the passing stretch for room either side of the car ahead. */
  _chooseSide(leader, baseU, v, freeSpeed, currentSpeed) {
    const dir = this.dir, line = this.line, veh = this.veh, p = this.personality, route = this.route;
    let inside = 0, kmax = 0;
    for (let d = 10; d <= 120; d += 10) { const k = line.sample(line.k, veh.s + dir * d); if (Math.abs(k) > kmax) { kmax = Math.abs(k); inside = Math.sign(k); } }
    if (kmax < 0.004) inside = 0;
    const need = leader.hu + veh.halfW + p.passGap + (leader.racer ? 0 : 0.15);
    const closing = Math.max(1.5, freeSpeed - leader.vs);
    const reach = clamp(v * (Math.max(0, leader.d) + 2 * veh.halfL + 2 * leader.hs + 6) / closing, 40, 220);
    const twoWay = !route.closed && !line.roadEdges && !line.closedRoad, oncSide = -dir;
    let roomL = Infinity, roomR = Infinity, roomOnc = Infinity;
    // A civilian holds its lane: check the gap beside it all along the stretch.
    // A racer follows its line but leaves racing room to a car that has pulled
    // out alongside, so what matters is room now and a road wide enough for two.
    for (let d = Math.max(-5, leader.d - 5); d <= leader.d + reach; d += 12) {
      const s = veh.s + dir * d, b = line.bounds(s, false, true, this._b3);
      if (leader.racer) {
        const fit = b.max - b.min - need;
        roomR = Math.min(roomR, fit); roomL = Math.min(roomL, fit);
        if (twoWay) { const bo = line.bounds(s, true, true, this._b4); roomOnc = Math.min(roomOnc, bo.max - bo.min - need); }
        continue;
      }
      roomR = Math.min(roomR, b.max - (leader.u + need)); roomL = Math.min(roomL, (leader.u - need) - b.min);
      if (twoWay) { const bo = line.bounds(s, true, true, this._b4); roomOnc = Math.min(roomOnc, oncSide < 0 ? (leader.u - need) - bo.min : bo.max - (leader.u + need)); }
    }
    if (leader.racer) {
      // Room now, and where its line will have taken it by the time we are
      // alongside: do not dive for a gap its line is about to close.
      const T = clamp((leader.d - veh.halfL - leader.hs) / closing, 0.5, 2.5);
      for (let k = 0; k < 2; k++) {
        const s = k ? leader.s + dir * Math.max(0, leader.vs) * T : leader.s;
        const lu = k ? leader.u + line.sample(line.u, s) - line.sample(line.u, leader.s) : leader.u;
        const b = line.bounds(s, false, true, this._b3);
        roomR = Math.min(roomR, b.max - (lu + need)); roomL = Math.min(roomL, (lu - need) - b.min);
        if (twoWay) { const bo = line.bounds(s, true, true, this._b4); roomOnc = Math.min(roomOnc, oncSide < 0 ? (lu - need) - bo.min : bo.max - (lu + need)); }
      }
    }
    let oncoming = false;
    if (twoWay) {
      const own = oncSide < 0 ? roomL : roomR;
      if (own < 0 && roomOnc >= 0) {
        const bo = line.bounds(veh.s, true, true, this._b4), u = this._passLane(leader, oncSide, need, bo, true);
        if (this._twoWayClear(leader, u, freeSpeed, baseU, v)) { oncoming = true; if (oncSide < 0) roomL = roomOnc; else roomR = roomOnc; }
      }
    }
    // Another car in the passing lane, or one beside us we would cross.
    for (const side of SIDES) {
      if ((side < 0 ? roomL : roomR) < 0) continue;
      const wideOnc = oncoming && side === oncSide;
      const b = line.bounds(veh.s, wideOnc, true, this._b4), u = this._passLane(leader, side, need, b, wideOnc);
      const r = this._corridor(u, true, this._c[4]);
      let blocked = !r.safe || r.speed < currentSpeed + 0.5;
      const obs = this._obs;
      for (let i = 0; !blocked && i < obs.length; i++) {
        const o = obs[i];
        // Pulling out from behind the car ahead is not crossing it.
        if (o === leader && o.d - veh.halfL - o.hs > 0.8) continue;
        // Anything about as slow as the car we are passing, standing in the passing
        // lane anywhere along the move (a parked car at the kerb, a queue): not that side.
        if (o !== leader && o.d > 0 && o.d < leader.d + reach + 10 && o.vs < leader.vs + 3 && Math.abs(o.u - u) < veh.halfW + o.hu + this._buffer) blocked = true;
        if (Math.abs(o.d) < veh.halfL + o.hs + 3 && o.u > Math.min(veh.u, u) - o.hu - veh.halfW && o.u < Math.max(veh.u, u) + o.hu + veh.halfW) blocked = true;
      }
      if (blocked) { if (side < 0) roomL = -1 - (r.safe ? 0 : 1); else roomR = -1 - (r.safe ? 0 : 1); }
    }
    const side = choosePassSide(roomL, roomR, inside, veh.u - leader.u, p.aggression);
    this.debug.roomL = roomL; this.debug.roomR = roomR;
    const choice = this._choice || (this._choice = { side: 0, oncoming: false });
    choice.side = side; choice.oncoming = oncoming && side === oncSide;
    return choice;
  }
  update(dt, options = NO_OPTIONS) {
    const { racers = EMPTY, traffic = EMPTY, signals, pace = 1, closeRacing = false, gapToPlayer = null } = options;
    const veh = this.veh, route = this.route, dir = this.dir, line = this.line, p = this.personality, caps = this.caps;
    const v = Math.hypot(veh.vLong, veh.vLat), frame = route.frame(veh.s, this._frame);
    const heading = Math.atan2(-frame.tx * dir, -frame.tz * dir), headingError = wrapPi(heading - veh.yaw);
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt); this.defendCooldown = Math.max(0, this.defendCooldown - dt); this.sideT = Math.max(0, this.sideT - dt);
    const brakeV = this._brakeV = caps.brake(v), latV = this._latV = caps.lat(v);
    const beta = Math.atan2(veh.vLat, Math.max(2, Math.abs(veh.vLong)));
    // Contact, a wall or a big slide: a moment to gather it up before racing again.
    const jolt = (this.lastV - v) / Math.max(1e-3, dt); this.lastV = v;
    if (!this.perfect && this.elapsed > 1 && (v > 6 && Math.abs(beta) > 0.3 || veh.wallHit > 2 || jolt > brakeV * 1.6 + 4)) {
      if (this.composure <= 0) this.upsets++;
      this.composure = 1.4 + (1 - p.smooth) * 1.2;
    } else this.composure = Math.max(0, this.composure - dt);
    if (this.elapsed < this.reaction && v < 0.5) return this.result(0, 0.4, 0, false, false, 'launch', 0, veh.u);
    const obs = this._collect(racers, traffic);
    let racePace = this.perfect ? 1 : p.pace;
    // Mild, slow pace band against the player's gap: a few percent off when
    // well clear ahead, back toward the limit (never past it) when behind.
    // Within ~1.5 s of the player there is no band: that racing is honest.
    if (!this.perfect && gapToPlayer !== null && Number.isFinite(gapToPlayer)) {
      const gapT = gapToPlayer / Math.max(12, v);
      const want = gapT > 0 ? -0.055 * this.bandScale * smooth01(1.5, 9, gapT) : 0.035 * this.bandScale * smooth01(1.5, 9, -gapT);
      this.band += (want - this.band) * Math.min(1, dt * 0.25);
      racePace = Math.min(racePace * (1 + this.band), Math.max(p.pace, 1));
    }
    // Optional close racing changes the driver's target by at most one percent.
    if (closeRacing) racePace *= 1 + clamp(-(gapToPlayer || 0) / 1000, -0.01, 0.01);
    if (this.composure > 0) racePace *= 0.95;
    this._pace = racePace * pace; this._s = veh.s;
    const budget = this.perfect ? 0.7 : p.brakeBudget;
    let targetSpeed = line.sample(this.profile, veh.s + dir * Math.max(3, v * 0.18)) * this._pace;
    const plan = planBraking(v, brakeV, budget, 0.25, this._baseSampler, v * v / (2 * Math.max(1, brakeV * budget)) + 70, 4, this._plan);
    targetSpeed = Math.min(targetSpeed, plan.target);
    const yieldDistance=route.roundabouts?.length?entryYieldDistance(route,{s:veh.s,dir,len:veh.spec?.length||4.5},[...(racers||[]).map(r=>r.veh||r),...(Array.isArray(traffic)?traffic:traffic?.cars||[])]):null;
    if(yieldDistance!==null)targetSpeed=Math.min(targetSpeed,Math.sqrt(2*brakeV*.7*Math.max(0,yieldDistance)));
    let plannedBrake = plan.brake;
    const freeSpeed = targetSpeed;
    const baseU = line.sample(line.u, veh.s), bounds = line.bounds(veh.s, false, false, this._b);
    this._v = v; this._horizon = Math.max(35, v * 4); this._buffer = 0.35 + (1 - p.aggression) * 0.25;
    const current = this._corridor(veh.u, false, this._c[0]);
    let desiredU = baseU, oncoming = false;
    const launchHold = this.launchHoldDistance > 0 && (veh.s - this.launchS) * dir < this.launchHoldDistance && this.elapsed < 20;

    // Held up: the car ahead is what sets our speed, not the road.
    const leader = current.leader;
    // A racer only holds us up if it is slower where it is than we would be there.
    const leaderExpected = leader ? line.sample(this.profile, leader.s + dir * Math.max(3, leader.vs * 0.18)) * this._pace : 0;
    if (leader && current.gap < Math.max(25, v * 1.6) && (!leader.racer ? leader.vs < freeSpeed - 1 : leader.vs < leaderExpected - Math.max(0.5, leaderExpected * 0.02))) {
      if (this.heldKey !== leader.key) { this.heldKey = leader.key; this.heldT = Math.min(this.heldT, p.patience * 0.5); }
      this.heldT += dt * (leader.racer ? 1 : 1.6);
    } else this.heldT = Math.max(0, this.heldT - dt);
    // Slipstream: a tow off any car directly ahead (the same rule as the player's).
    let draft = 0;
    if (v > 20) for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.d > 4 && o.d < 32 && o.hs > 1.5 && o.vs > 10 && Math.abs(o.u - veh.u) < 1.6) draft = Math.max(draft, 1 - o.d / 40);
    }
    this.draft += (draft - this.draft) * Math.min(1, dt * 3);

    // ---- a committed pass: pull out, get alongside, clear, merge (or abort)
    let passing = false, wide = false;
    if (this.pass) {
      const P = this.pass, L = this._find(P.key);
      P.t += dt;
      if (!L) { this.pass = null; this._passObj.end = 'lost'; }
      else {
        wide = true; oncoming = P.oncoming;
        const b = line.bounds(veh.s, P.oncoming, true, this._b2);
        const need = L.hu + veh.halfW + p.passGap + (L.racer ? 0 : 0.15);
        const u = this._passLane(L, P.side, need, b, P.oncoming);
        const minNeed = L.hu + veh.halfW + 0.2;
        const room = P.side > 0 ? b.max - (L.u + minNeed) : (L.u - minNeed) - b.min;
        // Side by side through a bend is racing; only a pass that stops gaining stalls.
        const level = L.d < veh.halfL + L.hs - 1;
        P.stall = v - L.vs < 0.4 && L.d > -veh.halfL && (P.phase === 'along' || P.t > 1.5) ? P.stall + dt * (level ? 0.5 : 1) : Math.max(0, P.stall - dt * 0.5);
        if (P.phase === 'abort') {
          // Lift and tuck back in behind; never lean on the other car.
          if (P.t - P.abortT > 8) { this.pass = null; P.end = 'aborted'; }
          else if (L.d > 0 && L.d < veh.halfL + L.hs + 2) {
            desiredU = u;
            targetSpeed = Math.min(targetSpeed, Math.max(0, L.vs - (P.oncoming ? 7 : 2)));
            plannedBrake = Math.max(plannedBrake, P.oncoming ? 0.85 : 0.35);
          } else if (this._corridor(baseU, true, this._c[1]).safe || P.t - P.abortT > 5) {
            desiredU = baseU;
            if (Math.abs(veh.u - baseU) < 0.8 || P.t - P.abortT > 6) { this.pass = null; P.end = 'aborted'; }
          } else desiredU = u;
        } else {
          // A momentary squeeze as their line swings is not yet a closed door.
          P.squeeze = room < 0 ? P.squeeze + dt : 0;
          const verdict = P.phase === 'merge' ? 'cleared' : passVerdict(L.d, veh.halfL, L.hs, P.squeeze > 0.4 ? room : Math.max(0, room), P.stall, mix(1.6, 3.5, p.aggression), P.t, 3);
          // Never try to go side by side into a hairpin taken at walking pace.
          let abort = verdict === 'abort' || (this.composure > 0 && P.phase === 'pull') || verdict !== 'cleared' && this._slowAhead(35) < 9;
          if (abort && verdict !== 'abort' && this.composure <= 0) P.reason = 'hairpin';
          if (!abort && P.oncoming && verdict !== 'cleared' && !this._twoWayClear(L, u, targetSpeed, baseU, v)) abort = true;
          if (abort) {
            P.reason = verdict === 'abort' ? (room < 0 ? 'room' : P.stall > 1 ? 'stall' : 'time') : P.reason === 'hairpin' ? 'hairpin' : P.oncoming ? 'oncoming' : 'composure';
            P.phase = 'abort'; P.abortT = P.t; this.abortedPasses++; this.heldT = 0;
            this.cooldown = mix(4, 1.5, p.aggression);
            desiredU = u;
            targetSpeed = Math.min(targetSpeed, Math.max(0, L.vs - (P.oncoming ? 7 : 2)));
            plannedBrake = Math.max(plannedBrake, P.oncoming ? 0.85 : 0.35);
          } else if (verdict === 'cleared') {
            if (P.phase !== 'merge') { P.phase = 'merge'; P.mergeT = P.t; this.overtakes++; }
            // Merging back toward another, slower civilian: that is a new pass to decide, not a lane to brake in.
            if (leader && leader.key !== P.key && !leader.racer && leader.vs < v - 3) { this.pass = null; P.end = 'done'; this.cooldown = 0; }
            // Back onto the line only with a clear car length to the one we passed.
            desiredU = this._corridor(baseU, true, this._c[1]).safe ? baseU : clamp(veh.u, b.min, b.max);
            if (Math.abs(veh.u - baseU) < 0.6 || P.t - P.mergeT > 6) { this.pass = null; P.end = 'done'; this.cooldown = 0.8; this.heldT = 0; }
          } else {
            if (P.phase === 'pull' && Math.abs(veh.u - u) < 0.45) P.phase = 'along';
            desiredU = u; passing = true;
            if (P.oncoming) targetSpeed = Math.min(targetSpeed, this._passSpeed(L, targetSpeed, v));
          }
        }
      }
    }
    // A circuit pass needs a straight long enough to pull out and return.
    // A fixed side target across consecutive hairpins is not a racing line.
    let circuitPassRoom = true;
    if (route.closed) for (let d = 0; d <= 160; d += 10) {
      if (Math.abs(route.curv(veh.s + dir * d)) >= 0.006) { circuitPassRoom = false; break; }
    }
    // ---- the decision to go for it
    if (circuitPassRoom && !this.pass && !launchHold && !this.evade && leader && leader.vs >= 0 && this.sideT <= 0 && freeSpeed > 12 && this._slowAhead(80) > 12 &&
      (civilianPass(leader.racer, freeSpeed, leader.vs, current.gap, v, this.cooldown, this.composure) || shouldCommit(this.heldT, p.patience, current.gap, v, this.cooldown, this.composure, v - leader.vs))) {
      this.sideT = 0.2; // re-scan for room five times a second, not every frame
      const choice = this._chooseSide(leader, baseU, v, freeSpeed, current.speed);
      if (choice.side) {
        const P = this.pass = this._passObj;
        P.key = leader.key; P.side = choice.side; P.oncoming = choice.oncoming; P.phase = 'pull'; P.t = 0; P.stall = 0; P.squeeze = 0; P.abortT = 0; P.mergeT = 0; P.end = null; P.reason = null;
        this.passAttempts++; this.defend = null;
        const b = line.bounds(veh.s, P.oncoming, true, this._b2);
        desiredU = this._passLane(leader, P.side, leader.hu + veh.halfW + p.passGap + (leader.racer ? 0 : 0.15), b, P.oncoming);
        oncoming = P.oncoming; wide = true; passing = true;
      }
    }
    // ---- defending: one early move to cover the side a challenger shows, never once it is alongside
    if (!route.closed && !this.pass && !launchHold && !this.perfect && !this.evade && p.aggression > 0.5) {
      if (this.defend) {
        const D = this.defend, C = this._find(D.key);
        D.t += dt;
        if (!C || C.d < -45 || C.d > 0 || D.t > 6) { this.defend = null; this.defendCooldown = 4; }
        else desiredU = C.d < -(veh.halfL + C.hs + 1) ? clamp(D.u, bounds.min, bounds.max) : clamp(veh.u, bounds.min, bounds.max);
      } else if (this.defendCooldown <= 0 && current.gap > 20) {
        for (let i = 0; i < obs.length; i++) {
          const o = obs[i];
          if (!o.racer || o.d > -(veh.halfL + o.hs + 3) || o.d < -22 || !(o.vs > v + 0.5 || Math.abs(o.u - veh.u) > 0.8)) continue;
          const side = Math.sign(o.u - veh.u); if (!side || Math.abs(o.u - veh.u) < 0.3) continue;
          const u = clamp(veh.u + side * Math.min(1.4, Math.abs(o.u - veh.u) + 0.4), bounds.min, bounds.max);
          if (Math.abs(u - veh.u) > 0.3 && this._corridor(u, true, this._c[1]).safe) {
            const D = this.defend = this._defObj; D.key = o.key; D.u = u; D.t = 0;
            desiredU = u;
          }
          break;
        }
      }
    }
    // Preserve space while running side by side, including on the starting grid.
    // Returning to the optimal line is itself a lane change and needs clearance.
    if (launchHold) desiredU = clamp(this.launchU, bounds.min, bounds.max);
    // Racing room: a racer pulled out beside or just behind us keeps its lane;
    // we do not chop across its nose, and may use the full asphalt to give room.
    for (let i = 0; !wide && i < obs.length; i++) if (roomFor(obs[i], veh) || obs[i].attack) wide = true;
    // Once a car has committed to a pass, hold the line: never move across toward it.
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!o.attack || o.d > veh.halfL + o.hs + 2 || o.d < -(veh.halfL + o.hs + 15)) continue;
      desiredU = o.attack > 0 ? Math.min(desiredU, veh.u + 0.05) : Math.max(desiredU, veh.u - 0.05);
    }
    const maneuverBounds = line.bounds(veh.s, oncoming, wide, this._mb);
    if (!this._corridor(desiredU, true, this._c[1]).safe && !passing) desiredU = clamp(veh.u, maneuverBounds.min, maneuverBounds.max);
    let holdAlongside = false;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (Math.abs(o.d) >= veh.halfL + o.hs + 4 && !roomFor(o, veh)) continue;
      if (o.racer && Math.abs(o.u - veh.u) < veh.halfW + o.hu + 3) holdAlongside = true;
      const still = o.vs < 0.5 && Math.abs(o.vu) < 0.3, clearance = veh.halfW + o.hu + (still ? Math.min(this._buffer, 0.15 + v * 0.02) : this._buffer);
      if (Math.abs(desiredU - o.u) < clearance) {
        const side = veh.u >= o.u ? 1 : -1;
        desiredU = clamp(o.u + side * clearance, maneuverBounds.min, maneuverBounds.max);
        if (Math.abs(desiredU - o.u) < clearance && o.d >= 0) targetSpeed = Math.min(targetSpeed, Math.max(0, o.vs - 3));
      }
    }
    // A head-on escape is one decision per approach. Fresh actor snapshots or
    // a small lateral crossing must never flip the chosen side of the car.
    if (this.evade) {
      const threat = this._find(this.evade.key);
      this.evade.lost = threat ? 0 : this.evade.lost + dt;
      if (this.evade.lost > 1.2 || threat && (threat.d < -veh.halfL - threat.hs - 3 || threat.vs >= -1)) this.evade = null;
    }
    if (!this.evade) {
      let threat = null, tBest = Infinity;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (!(o.vs < -1 && o.d > 0 && (o.d - veh.halfL - o.hs) / Math.max(1, v - o.vs) < 4.5 &&
          Math.min(Math.abs(o.u - veh.u), Math.abs(o.u + o.vu - veh.u)) < veh.halfW + o.hu + 0.8)) continue;
        const tt = o.d / (v - o.vs); if (tt < tBest) { tBest = tt; threat = o; }
      }
      if (threat) {
        const escape = line.bounds(veh.s, true, false, this._b3);
        const kerb = dir > 0 ? escape.max : escape.min, inner = dir > 0 ? escape.min : escape.max;
        const clearance = veh.halfW + threat.hu + 0.8;
        // Never escape across the oncoming car's own path: the far side of it is not a way out.
        const beyond = (u) => Math.abs(veh.u - threat.u) > threat.hu + veh.halfW * 0.5 && Math.sign(u - threat.u) !== Math.sign(veh.u - threat.u);
        const score = (u) => Math.min(clearance, Math.abs(u - threat.u - clamp(threat.vu, -1.5, 1.5))) +
          (u === kerb ? 0.8 : 0) - Math.abs(u - veh.u) * 0.1 - (this._corridor(u, true, this._c[1]).safe ? 0 : 10) - (beyond(u) ? 100 : 0);
        const sk = score(kerb), si = score(inner);
        const u = Math.max(sk, si) < -50 ? veh.u : sk >= si ? kerb : inner;
        this.evade = { key: threat.key, u, side: Math.sign(u - veh.u) || dir, lost: 0 };
        if (this.pass) this._passObj.end = 'evade';
        this.pass = null; passing = false; wide = false;
      }
    }
    if (this.evade) {
      const escape = line.bounds(veh.s, true, false, this._b3);
      desiredU = clamp(this.evade.u, escape.min, escape.max);
      oncoming = desiredU < bounds.min || desiredU > bounds.max;
      targetSpeed = Math.min(targetSpeed, Math.max(3, v - brakeV * dt * 0.65));
    }
    // Last word on the steering target, whatever chose it (line, pass, defence,
    // escape): never close laterally on a car that is, or is about to be, beside us.
    // A yawed body is wider across the road, and sideways speed needs room to stop.
    const egoVu = (-Math.sin(veh.yaw) * veh.vLong + Math.cos(veh.yaw) * veh.vLat) * frame.rx +
      (-Math.cos(veh.yaw) * veh.vLong - Math.sin(veh.yaw) * veh.vLat) * frame.rz;
    const bodyHalfW = veh.halfW * Math.abs(Math.cos(headingError)) + veh.halfL * Math.abs(Math.sin(headingError));
    let uMin = -Infinity, uMax = Infinity;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i], reach = veh.halfL + o.hs + Math.max(1.5, Math.abs(o.vs - v) * 0.6);
      // Squarely ahead of or behind us in our own lane is following, not alongside.
      if (Math.abs(o.d) >= reach || Math.abs(o.u - veh.u) < veh.halfW + o.hu - 0.1) continue;
      const side = Math.sign(o.u - veh.u) || 1, closing = Math.max(0, (egoVu - o.vu) * side);
      const gap = o.racer ? 0.45 : 0.6, line = o.u - side * (bodyHalfW + o.hu + gap);
      // Sideways speed must be shed before the gap runs out (about 3 m/s^2 of
      // lateral grip to spare): if not, straighten up away from the car now.
      const room = Math.max(0, (line - veh.u) * side), limit = closing * closing > 6 * room ? veh.u - side * Math.min(1, closing * 0.3) : alongsideLimit(Infinity * side, veh.u, bodyHalfW, o.u, o.hu, gap);
      if (side > 0) uMax = Math.min(uMax, limit); else uMin = Math.max(uMin, limit);
    }
    if (uMin > uMax) uMin = uMax = veh.u;
    desiredU = clamp(desiredU, uMin, uMax);
    const goalOffset = desiredU - baseU;
    const lateralRate = Math.min(2.1 + (1 - p.smooth) * 0.5 + (passing ? 0.4 * p.aggression : 0), 0.6 + v * 0.12);
    this.offset += clamp(goalOffset - this.offset, -lateralRate * dt, lateralRate * dt);
    // The smoothing lag must never carry the steering target into that car either.
    this.offset = clamp(this.offset, uMin - baseU, uMax - baseU);
    this._circuitProfile = null;
    if (Math.abs(this.offset) > 0.5 && !launchHold) {
      // A line held beside the racing line is its own bend: brake for the
      // curvature of that path (cheap parallel-curve estimate, no profile rebuild).
      this._off = this.offset; this._offWide = wide; this._lat = latV;
      if (route.closed) {
        const offset = Math.round(this.offset * 4) / 4;
        if (!this.alternateProfiles.has(offset)) this.alternateProfiles.set(offset, line.offsetProfile(veh, offset));
        this._circuitProfile = this.alternateProfiles.get(offset);
      }
      this._offCross = oncoming || baseU + this.offset < bounds.min || baseU + this.offset > bounds.max;
      targetSpeed = Math.min(targetSpeed, this._offSampler.limit(Math.max(3, v * 0.2)));
      const off = planBraking(v, brakeV, budget - 0.05, 0.35, this._offSampler, v * v / (2 * Math.max(1, brakeV * 0.7)) + 60, 4, this._plan2);
      targetSpeed = Math.min(targetSpeed, off.target);
      plannedBrake = Math.max(plannedBrake, off.brake);
    }
    // Brake until the bonnet has cleared an obstruction during a lane change.
    const wanted = this._corridor(baseU + this.offset, false, this._c[2]), here = this._corridor(veh.u, false, this._c[3]);
    targetSpeed = Math.min(targetSpeed, wanted.speed, here.speed);
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.vs < 0 || o.d < 0 || o.d > veh.halfL + o.hs + Math.max(8, (v - o.vs) * 2)) continue;
      if (this.elapsed < 2.5 && v < 6 && o.racer && o.vs > 0.2 && o.d > veh.halfL + o.hs + 2.5) continue;
      if (v < 5 && o.vs >= 0 && o.d > veh.halfL + o.hs + 2) continue;
      const futureGap = o.d + (o.vs - v) * 1.2;
      const lateralGap = Math.min(Math.abs(o.u - veh.u), Math.abs(o.u + o.vu * 0.8 - veh.u - egoVu * 0.8));
      const mergeBuffer = o.racer ? 2.5 : 5;
      // The car we are passing holds its own lane beside us; only a real squeeze counts.
      const margin = passing && o.key === this.pass.key ? 0.3 : 0.8;
      if (futureGap < veh.halfL + o.hs + mergeBuffer && lateralGap < veh.halfW + o.hu + margin) {
        // Yield before two predicted body corridors intersect. Slowing now
        // leaves the leading racer room to complete the merge without contact.
        targetSpeed = Math.min(targetSpeed, Math.max(0, o.vs - (o.racer ? 2 : 7)));
        plannedBrake = Math.max(plannedBrake, o.racer ? clamp((v - o.vs + 2) / brakeV, 0.15, 0.85) : 0.85);
      }
    }
    const kAhead = Math.max(Math.abs(line.sample(line.k, veh.s)), Math.abs(line.sample(line.k, veh.s + dir * 7.5)), Math.abs(line.sample(line.k, veh.s + dir * 15)));
    if (launchHold || Math.abs(this.offset) > 0.7) {
      // An alternative lane can be tighter than the minimum-curvature line.
      // Reserve lateral force for the transition and brake before its bend.
      for (let d = 0; d < v * v / (2 * Math.max(1, brakeV * 0.65)) + 40; d += 5) {
        const k = Math.abs(route.curv?.(veh.s + dir * d) || 0);
        const curveSpeed = Math.sqrt(latV * 0.9 / Math.max(1e-5, k));
        targetSpeed = Math.min(targetSpeed, Math.sqrt(curveSpeed * curveSpeed + 2 * brakeV * 0.6 * Math.max(0, d - 10)));
      }
    }
    const look = route.streetCircuit
      ? Math.max(2.4, Math.min(5 + v * .3, 22, .45 / Math.max(1e-4, kAhead)))
      : Math.max(2.4, Math.min(5 + v * 0.3, 22, 0.45 / Math.max(1e-4, kAhead)));
    const junctionLook = route.streetCircuit && Math.abs(route.curv(veh.s + dir * 4)) > .16 ? 6.5 : look;
    const targetS = veh.s + dir * junctionLook;
    const hold = !this.evade && !oncoming && holdAlongside;
    let target;
    // Still across the centre line (after an escape or a pass): the target may
    // stay there. Clamping it to our own carriageway is what once yanked a rival
    // straight back across into a car alongside.
    const across = oncoming || veh.u < bounds.min || veh.u > bounds.max || desiredU < bounds.min || desiredU > bounds.max;
    if (launchHold || hold) {
      const tb = line.bounds(targetS, across, wide, this._b4);
      target = route.point(targetS, clamp(clamp(desiredU, tb.min, tb.max), uMin, uMax), this._pt);
    } else target = line.point(targetS, this.offset, across || this.offset + baseU < bounds.min || this.offset + baseU > bounds.max, wide, this._pt);
    const dx = target.x - veh.x, dz = target.z - veh.z;
    const delta = Math.atan2(2 * veh.wb * (dx * Math.cos(veh.yaw) - dz * Math.sin(veh.yaw)), Math.max(1, dx * dx + dz * dz));
    const desiredYawRate = v * Math.tan(delta) / veh.wb;
    const yawErr = desiredYawRate - veh.w;
    this.yawI = v > 6 && Math.abs(headingError) < 0.6 ? clamp(this.yawI * Math.exp(-dt * 0.8) + yawErr * dt * 0.07, -0.12, 0.12) : this.yawI * Math.exp(-dt * 4);
    let steer = clamp(caps.steer(Math.tan(delta) / veh.wb, v) - veh.w * 0.04, -1, 1);
    // Catch the slide through the same rack and stability aids as a human.
    if (Math.abs(beta) > 0.25) steer = clamp(steer + beta * 0.4, -1, 1);
    const pathError = Math.abs(veh.u - (baseU + this.offset));
    if (pathError > 0.8 || Math.abs(headingError) > 0.25) targetSpeed = Math.min(targetSpeed, Math.sqrt(latV * 0.85 / Math.max(0.005, kAhead + pathError / Math.max(30, look * look))));

    let signalBrake = 0, held = false;
    if (signals) {
      const front = veh.s + dir * veh.halfL, j = signals.next(front, dir);
      if (j && j.main !== 'G') {
        const d = ((dir > 0 ? j.sF : j.sO) - front) * dir;
        const lateAmber = j.main === 'A' && v * v / (2 * Math.max(1, d)) > brakeV * 0.8;
        if (d >= -1 && d < 300 && !lateAmber) {
          targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * brakeV * 0.85 * Math.max(0, d - 3)));
          signalBrake = clamp(v * v / (2 * Math.max(0.5, d - 2)) / brakeV, 0, 1);
          if (d < 4 && v < 1) { held = true; signalBrake = 0.4; }
        }
      }
    }
    // Rare bounded hesitation: no deliberate spins, no dependence on race gap.
    if (!this.perfect && this.elapsed > this.nextMistake) { this.mistake = 0.35 + this.random() * 0.35; this.nextMistake = this.elapsed + 1 / Math.max(1e-5, p.mistakeRate) * (0.75 + this.random()); }
    if (this.mistake > 0) { this.mistake -= dt; targetSpeed *= 0.96; }

    // Boxed in at a standstill behind a stopped car with a clear lane beside it:
    // a car cannot step sideways at rest. Back off until the gap allows a
    // full-lock turn out, then creep out on lock until clear of its flank.
    const block = here.leader;
    if (!this.unbox && !held && block && block.vs < 1 && v < 3 && here.gap < 8 && this.recovery === 'drive' && Math.abs(desiredU - veh.u) > 0.3 &&
      Math.sign(desiredU - veh.u) !== Math.sign(block.u - veh.u) && this._corridor(desiredU, false, this._c[4]).speed > 3) {
      this.unbox = { key: block.key, side: Math.sign(desiredU - veh.u), phase: 'back', t: 0 };
    }
    if (this.unbox) {
      const X = this.unbox, B = this._find(X.key);
      X.t += dt;
      // Out means clear of the corridor it blocks, not merely of its paint.
      const need = B ? veh.halfW + B.hu + this._buffer + 0.15 - Math.abs(B.u - veh.u) : 0;
      if (!B || need <= 0 || B.d < 0 || B.vs > 2 || X.t > 12 || held) this.unbox = null;
      else {
        const R = veh.wb / Math.tan(Math.max(0.2, caps.lock(2))), gap = B.d - veh.halfL - B.hs;
        const reach = need >= R ? R : Math.sqrt(R * R - (R - need) * (R - need));
        if (X.phase === 'back') {
          let rearClear = true;
          for (let i = 0; i < obs.length; i++) { const o = obs[i]; if (o.d < 0 && o.d > -(veh.halfL + o.hs + 1.5) && Math.abs(o.u - veh.u) < veh.halfW + o.hu + 0.3) rearClear = false; }
          if (gap >= reach + 0.8 || !rearClear || X.t > 4) { X.phase = 'out'; X.t = 0; }
          else return this.result(0, veh.vLong > -1.5 ? 0.85 : 0, 0, false, false, 'backoff', 0, veh.u); // a slow, straight reverse
        }
        if (X.phase === 'out') {
          // Body-clear of its flank already: straighten and drive by; otherwise
          // a closing gap means backing off for another go.
          const flankClear = Math.abs(B.u - veh.u) >= veh.halfW + B.hu + 0.15;
          if (gap < 0.4 && veh.vLong > -0.2 && !flankClear) { X.phase = 'back'; X.t = 0; }
          // Stop the reverse roll first (forward drive, as the recovery rejoin does).
          if (veh.vLong < -0.2) return this.result(0.6, 0, 0, false, false, 'unbox', 2, veh.u);
          const brake = veh.vLong > 2.2 ? 0.3 : 0, throttle = veh.vLong < 1.6 ? 0.35 : 0;
          // Turn out to about 25 degrees off the road heading, no more.
          const across = Math.asin(clamp(-Math.sin(veh.yaw) * frame.rx - Math.cos(veh.yaw) * frame.rz, -1, 1));
          return this.result(throttle, brake, clamp(((flankClear ? 0 : X.side * 0.45) - across) * 3 * this.dir, -1, 1), false, false, 'unbox', 2, veh.u);
        }
      }
    }
    const intentionalStop = held || targetSpeed < 2 && here.leader;
    this.slow = !intentionalStop && (this.elapsed > 3 || veh.wallHit > 2) && (v < 1.2 && targetSpeed > 3 || Math.abs(headingError) > 1.2 && v < 7) ? this.slow + dt : Math.max(0, this.slow - dt);
    if (this.slow > 1.1 && this.recovery === 'drive') { this.recovery = 'reverse'; this.recoveryT = 0; this.slow = 0; this.yawI = 0; if (this.pass) this._passObj.end = 'recovery'; this.pass = null; this.defend = null; }
    if (this.recovery !== 'drive') {
      this.recoveryT += dt;
      let rearClear = true;
      for (let i = 0; i < obs.length; i++) { const o = obs[i]; if (o.d < 0 && o.d > -8 && Math.abs(o.u - veh.u) < veh.halfW + o.hu + 0.5) rearClear = false; }
      if (this.recovery === 'reverse') {
        if (this.recoveryT > 2.5 || !rearClear || v > 4) { this.recovery = 'rejoin'; this.recoveryT = 0; }
        else return this.result(0, 0.85, clamp(headingError * 1.8, -1, 1), false, false, 'reverse', targetSpeed, veh.u);
      }
      if (this.recovery === 'rejoin') {
        if (veh.vLong < -0.3) return this.result(0.8, 0, clamp(-headingError * 1.8, -1, 1), true, false, 'rejoin', targetSpeed, veh.u);
        steer = clamp(-headingError * 1.6 + (baseU - veh.u) * 0.35, -1, 1);
        targetSpeed = Math.min(targetSpeed, 6);
        if (Math.abs(headingError) < 0.3 && Math.abs(veh.u - baseU) < 1.3) { this.recovery = 'drive'; this.integral = 0; this.offset = veh.u - baseU; this.composure = Math.max(this.composure, 1.5); }
        else if (this.recoveryT > 5) { this.recovery = 'reverse'; this.recoveryT = 0; }
      }
    }
    const error = targetSpeed - Math.max(0, veh.vLong);
    this.integral = clamp(this.integral + error * dt * 0.45, -0.3, 0.9);
    const drive = caps.drive(v, veh.gear), curveDemand = v * v * kAhead;
    const reserve = Math.sqrt(Math.max(0.02, 1 - Math.min(0.99, curveDemand / Math.max(1, latV)) ** 2));
    let throttle = clamp(this.integral + error * 0.65 + 0.14, 0, 1);
    // Establish a merge gap while holding the launch lanes. The car farther
    // from the racing line lifts briefly instead of both cars braking hard
    // when the 150 m lane hold ends. Single-file grids need no launch lift.
    if (launchHold && this.elapsed < 3) for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.racer && Math.abs(o.d) < 15 && Math.abs(this.launchU - baseU) > Math.abs(o.u - baseU) + 1) { throttle = Math.min(throttle, 0.7); break; }
    }
    // Feather the power to keep longitudinal demand in the friction ellipse.
    if (v > 6) throttle = Math.min(throttle, clamp(latV * reserve / Math.max(1, drive), 0.15, 1));
    if (v > 8 && (Math.abs(veh.ay) > latV * 0.6 || Math.abs(beta) > 0.025 && caps.rearSlip() > 0.8)) throttle = Math.min(throttle, 0.55);
    if (veh.wheelspin > 0.25 && v > 4) throttle *= 1 - clamp(veh.wheelspin * 0.45, 0, 0.6);
    let brake = held ? 0.4 : clamp(Math.max(signalBrake, plannedBrake > 0.65 ? plannedBrake : 0, error < -0.15 ? clamp(-error * 0.38, 0, 1) : 0), 0, 1);
    // (from 3 m/s: a trail-braked RWD rear also lets go in tight street corners)
    if (v > 3 && here.gap > 8 && Math.abs(beta) > 0.04 && caps.rearSlip() > 1.15) brake *= clamp(1.15 / caps.rearSlip(), 0.25, 1);
    // Ordinary service brake must not accidentally select reverse while queuing.
    const safeBrake = veh.vLong < 1 && brake > 0 ? Math.min(0.45, brake) : brake;
    const nitro = veh.spec.nitrous === true && !this.perfect && !held && error > 3 && v > 15 && Math.abs(steer) < 0.18 && kAhead < 0.0015 && here.gap > v * 3 && veh.nitro > 0.15;
    const dbg = this.result(safeBrake > 0.03 ? 0 : throttle, safeBrake, steer, false, nitro, this.recovery, targetSpeed, baseU + this.offset);
    const d = this.debug;
    d.gap = here.gap; d.look = look; d.desiredU = desiredU; d.evadeSide = this.evade?.side ?? 0; d.passing = !!this.pass; d.passState = this.pass ? this.pass.phase : null;
    d.passKey = this.pass ? this.pass.key : null; d.passReason = this._passObj.reason; d.passEnd = this._passObj.end; d.passSide = this.pass ? this.pass.side : 0; d.defending = !!this.defend; d.oncoming = oncoming; d.overtakes = this.overtakes; d.abortedPasses = this.abortedPasses;
    d.leaderKey = current.leader ? current.leader.key : null; d.leaderU = current.leader ? current.leader.u : null; d.k = kAhead; d.heldT = this.heldT; d.draft = this.draft; d.band = this.band; d.composure = this.composure;
    return dbg;
  }
  result(throttle, brake, steer, handbrake, nitro, phase, targetSpeed, u) {
    const r = this._input, d = this.debug;
    r.throttle = throttle; r.brake = brake; r.steer = steer; r.handbrake = handbrake; r.nitro = nitro;
    d.phase = phase; d.targetSpeed = targetSpeed; d.u = u;
    return r;
  }
}
const SIDES = [-1, 1];
