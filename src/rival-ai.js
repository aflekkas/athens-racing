// Race driving uses only ordinary Vehicle inputs. Geometry stays in route metres;
// closed routes repeat their line/profile, while vehicle.s stays unwrapped across laps.
const G = 9.81;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const wrap = (s, length) => ((s % length) + length) % length;
const pointOut = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });

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
    rearSlip: () => Math.max(...(veh.corners?.slice(2).map((c) => c.sN || 0) || [0])),
    vmax: sp.vmax / 3.6,
  };
}

// Entries may override these fields explicitly. Existing DRIVERS risk/mistakes
// remain useful for personality, but never increase grip or power.
export function driverPersonality(driver = {}) {
  const risk = clamp(driver.risk ?? 1, 0, 2);
  return {
    pace: driver.racePace ?? mix(0.999, 1.0, clamp((driver.pace ?? 0.9) - 0.86, 0, 0.07) / 0.07),
    aggression: driver.aggression ?? clamp(0.4 + risk * 0.25, 0, 1),
    smooth: driver.smooth ?? clamp(1 - (driver.mistakes ?? 1) * 0.22, 0.4, 1),
    risk,
    mistakeRate: driver.mistakeRate ?? (driver.mistakes ?? 1) / 360,
  };
}

/** Bounds are asphalt edges, not wall positions. Custom roadEdges(s,dir)
 * supplies {min,max} in signed route u, before body/safety clearance. */
export function racingBounds(route, s, dir = 1, halfWidth = 0.95, roadEdges, oncoming = false) {
  let b;
  if (roadEdges) b = roadEdges(s, dir);
  else if (route.closed) b = { min: -route.edge(s), max: route.edge(s) };
  else {
    const median = route.medHalf?.(s) ?? 0;
    const edge = route.edge(s);
    b = dir > 0 ? { min: median, max: edge } : { min: -edge, max: -median };
    if (oncoming && (route.div?.(s) ?? 0) < 0.3) b = { min: -edge, max: edge };
  }
  const clearance = halfWidth + 0.95;
  const min = b.min + clearance, max = b.max - clearance;
  return min <= max ? { min, max } : { min: (b.min + b.max) / 2, max: (b.min + b.max) / 2 };
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
    const lo = new Float64Array(this.n), hi = new Float64Array(this.n), frames = [];
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
      this.u[i] = clamp(route.closed ? route.racingU?.(s) ?? 0 : (b.min + b.max) / 2, b.min, b.max);
      this.x[i] = f.x + f.rx * this.u[i]; this.z[i] = f.z + f.rz * this.u[i];
    }
    // Projected multiscale relaxation minimises the squared second derivative
    // of the world path. Larger stencils establish turn-in/apex/exit; smaller
    // ones remove local kinks. All iterations retain asphalt/body clearance.
    for (const stride of [12, 6, 3, 1]) for (let pass = 0; pass < 120; pass++) {
      for (let i = 0; i < this.n; i++) {
        if (!this.closed && (i < stride * 2 || i >= this.n - stride * 2)) continue;
        const a = this.index(i - stride), b = this.index(i + stride), c = this.index(i - 2 * stride), d = this.index(i + 2 * stride), f = frames[i];
        const target = ((4 * (this.x[a] + this.x[b]) - this.x[c] - this.x[d]) / 6 - f.x) * f.rx +
          ((4 * (this.z[a] + this.z[b]) - this.z[c] - this.z[d]) / 6 - f.z) * f.rz;
        const projected = target / (f.uScale2 || 1);
        this.u[i] = clamp(mix(this.u[i], projected, 0.28), lo[i], hi[i]);
        this.x[i] = f.x + f.rx * this.u[i]; this.z[i] = f.z + f.rz * this.u[i];
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
        const f = frames[i], original = this.u[i];
        const score = () => curvatureCost(i - 1) + curvatureCost(i) + curvatureCost(i + 1);
        let bestU = original, bestScore = score();
        for (const u of [clamp(original - delta, lo[i], hi[i]), clamp(original + delta, lo[i], hi[i])]) {
          this.x[i] = f.x + f.rx * u; this.z[i] = f.z + f.rz * u;
          const cost = score();
          if (cost < bestScore) { bestScore = cost; bestU = u; }
        }
        this.u[i] = bestU; this.x[i] = f.x + f.rx * bestU; this.z[i] = f.z + f.rz * bestU;
      }
    }
    this.k = new Float64Array(this.n); this.grade = new Float64Array(this.n); this.vertical = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      // A broad geometric stencil avoids aliasing at sampled route vertices.
      const a = this.index(i - 2), b = this.index(i + 2);
      const ax = this.x[i] - this.x[a], az = this.z[i] - this.z[a], bx = this.x[b] - this.x[i], bz = this.z[b] - this.z[i];
      const denom = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(ax + bx, az + bz);
      this.k[i] = denom > 0.01 ? 2 * (ax * bz - az * bx) / denom : route.curv?.(i * this.step) || 0;
      this.grade[i] = frames[i].grade || 0;
      const s = i * this.step;
      this.vertical[i] = route.y ? (route.y(s - 3) - 2 * route.y(s) + route.y(s + 3)) / 9 : 0;
    }
  }
  index(i) { return this.closed ? (i % this.n + this.n) % this.n : clamp(i, 0, this.n - 1); }
  bounds(s, oncoming = false) { return racingBounds(this.route, s, this.dir, this.halfWidth, this.roadEdges, oncoming || this.closedRoad); }
  sample(A, s) {
    const t = (this.closed ? wrap(s, this.length) : clamp(s, 0, this.length)) / this.step, i = Math.floor(t);
    return mix(A[this.index(i)], A[this.index(i + 1)], t - i);
  }
  point(s, offset = 0, oncoming = false) {
    const b = this.bounds(s, oncoming), u = clamp(this.sample(this.u, s) + offset, b.min, b.max);
    return this.route.point(s, u, pointOut());
  }
  speedProfile(veh) {
    const caps = vehicleCapabilities(veh), v = new Float64Array(this.n);
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
      v[i] = limit;
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
  if (!cache.has(key)) cache.set(key, new RacingLine(route, { ...options, halfWidth: veh.halfW }));
  return cache.get(key);
}

function obstacle(route, record, dir) {
  if (record.veh) {
    const v = record.veh, f = route.frame(v.s, {}), yaw = Math.atan2(-f.tx, -f.tz), angle = wrapPi(v.yaw - yaw);
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    return { ref: record, racer: true, s: v.s, u: v.u, hs: c * v.halfL + s * v.halfW, hu: c * v.halfW + s * v.halfL, vs: (v.vLong * Math.cos(angle) + v.vLat * Math.sin(angle)) * dir, vu: -v.vLong * Math.sin(angle) + v.vLat * Math.cos(angle) };
  }
  return { ref: record, racer: false, s: record.s, u: record.u, hs: record.hs ?? (record.len ? record.len / 2 : 2.2), hu: record.hu ?? (record.wid ? record.wid / 2 : 1), vs: (record.vs ?? (record.crash ? record.crash.vs : record.cross ? record.xvs : (record.dir || 1) * (record.v || 0))) * dir, vu: record.vu ?? (record.crash ? record.crash.vu : record.cross ? record.xvu : record.uv) ?? 0 };
}
const obstacleKey = (record) => record.veh || record.a?.veh || record.a || record;

export class RivalAI {
  constructor(route, veh, options = {}) {
    this.route = route; this.veh = veh; this.spec = veh.spec; this.dir = options.dir || 1;
    this.perfect = !!options.perfect; this.personality = driverPersonality(options.driver);
    this.line = getLine(route, veh, options); this.profile = this.line.speedProfile(veh);
    this.offset = veh.u - this.line.sample(this.line.u, veh.s);
    this.passOffset = null; this.passT = 0; this.elapsed = 0; this.slow = 0; this.recovery = 'drive';
    this.pass = null; this.passCountTarget = null; this.evade = null; this.overtakes = 0; this.abortedPasses = 0;
    this.recoveryT = 0; this.integral = 0; this.yawI = 0; this.mistake = 0;
    this.alternateProfiles = new Map();
    let hash = 2166136261; for (const c of options.driver?.id || 'reference') hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    this.seed = hash >>> 0; this.nextMistake = 80 + this.random() * 200;
    this.launchS = veh.s; this.launchU = veh.u;
    this.launchHoldDistance = Math.hypot(veh.vLong, veh.vLat) < 1 ? 150 : 0;
    this.reaction = this.perfect ? 0 : 0.04 + (1 - this.personality.aggression) * 0.12 + this.random() * 0.08;
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  update(dt, { racers = [], traffic = [], signals, pace = 1, closeRacing = false, gapToPlayer = 0 } = {}) {
    const veh = this.veh, route = this.route, dir = this.dir, line = this.line, p = this.personality;
    const v = Math.hypot(veh.vLong, veh.vLat), caps = vehicleCapabilities(veh), frame = route.frame(veh.s, {});
    const heading = Math.atan2(-frame.tx * dir, -frame.tz * dir), headingError = wrapPi(heading - veh.yaw);
    this.elapsed += dt; this.passT = Math.max(0, this.passT - dt);
    if (this.elapsed < this.reaction && v < 0.5) return this.result({ brake: 0.4 }, { phase: 'launch', targetSpeed: 0, u: veh.u });
    const obs = [...racers.filter((c) => c.veh !== veh).map((c) => obstacle(route, c, dir)), ...traffic.filter((c) => c.active !== false).map((c) => obstacle(route, c, dir))];
    for (const o of obs) { o.d = (o.s - veh.s) * dir; if (route.closed) o.d = wrap(o.d + route.length / 2, route.length) - route.length / 2; }
    let racePace = this.perfect ? 1 : p.pace;
    // Optional close racing changes the driver's target by at most one percent;
    // it never modifies vehicle forces, specs, position or collision behavior.
    if (closeRacing) racePace *= 1 + clamp(-gapToPlayer / 1000, -0.01, 0.01);
    let targetSpeed = line.sample(this.profile, veh.s + dir * Math.max(3, v * 0.18)) * racePace * pace;
    let plannedBrake = 0;
    for (let d = 4; d < v * v / (2 * Math.max(1, caps.brake(v) * 0.7)) + 70; d += 4) {
      const future = line.sample(this.profile, veh.s + dir * d) * racePace * pace;
      const need = (v * v - future * future) / (2 * Math.max(1, d - v * 0.25));
      if (need > caps.brake(v) * 0.7) targetSpeed = Math.min(targetSpeed, future);
      if (need > 0) plannedBrake = Math.max(plannedBrake, need / caps.brake(v));
    }
    const baseU = line.sample(line.u, veh.s), bounds = line.bounds(veh.s);
    const horizon = Math.max(35, v * 4), buffer = 0.35 + (1 - p.aggression) * 0.25;
    const corridor = (u, changing = false) => {
      let speed = caps.vmax, gap = Infinity, leader = null, safe = true;
      for (const o of obs) {
        if (o.d < -horizon || o.d > horizon + Math.max(0, -o.vs) * 5) continue;
        const lateral = veh.halfW + o.hu + buffer;
        const time = clamp(o.d / Math.max(1, v - o.vs), 0, 3);
        const ou = o.u + clamp(o.vu * time, -1.5, 1.5);
        if (Math.abs(ou - u) > lateral) continue;
        const g = o.d - veh.halfL - o.hs;
        // Never move across an alongside car or cut off a fast follower.
        if (changing && o.d < veh.halfL + o.hs + 5 && o.d > -veh.halfL - o.hs - Math.max(5, (o.vs - v) * 1.5)) safe = false;
        if (g >= -veh.halfL * 2 && g < gap) { gap = g; leader = o; }
        if (this.elapsed < 2.5 && v < 6 && o.racer && o.vs > 0.2 && g > 2.5) continue;
        if (g > -veh.halfL * 2) {
          // Racers share the braking profile and can follow at a shorter
          // headway; civilians retain the larger stopping-space allowance.
          const lv = Math.max(0, o.vs), standstill = o.racer ? 2.6 : 3;
          const headway = o.racer ? 0.25 + (1 - p.aggression) * 0.1 : 0.35;
          const space = Math.max(0, g - standstill - lv * headway);
          speed = Math.min(speed, Math.sqrt(lv * lv + 2 * caps.brake(v) * 0.75 * space));
          if (g < standstill + 2 + v * headway) speed = Math.min(speed, Math.max(0, lv + (g - standstill) * 0.65));
        }
      }
      return { speed, gap, leader, safe };
    };
    const current = corridor(veh.u);
    let desiredU = baseU;
    let oncoming = false;
    if (this.passOffset !== null && this.passT > 0) desiredU = clamp(baseU + this.passOffset, bounds.min, bounds.max);
    const launchHold = (veh.s - this.launchS) * dir < this.launchHoldDistance && this.elapsed < 20;
    const leaderExpected = current.leader ? line.sample(this.profile, current.leader.s + dir * Math.max(3, current.leader.vs * 0.18)) * racePace * pace : 0;
    const genuinelySlower = current.leader && (!current.leader.racer || current.leader.vs < leaderExpected - Math.max(2, leaderExpected * 0.06));
    const leaderKey = current.leader ? obstacleKey(current.leader.ref) : null;
    if (this.passLeader !== leaderKey) { this.passLeader = leaderKey; this.deficitT = 0; }
    this.deficitT = genuinelySlower ? (this.deficitT || 0) + dt : Math.max(0, (this.deficitT || 0) - dt * 2);
    const passTime = current.leader ? (Math.max(0, current.gap) + 2 * veh.halfL + 2 * current.leader.hs + 10) / Math.max(0.5, targetSpeed - current.leader.vs) : Infinity;
    const passDistance = current.leader ? clamp(v * passTime + 30, 125, 400) : 125;
    let passRoom = !current.leader || passTime < 6;
    for (let d = 0; passRoom && d <= passDistance; d += 25) if (Math.abs(route.curv?.(veh.s + dir * d) || 0) >= 0.006) passRoom = false;
    // Check the whole closing horizon, including cars outside the ordinary
    // following scan. Reserve time to pull out AND return, at achievable speed.
    const passHorizon = (leader, u) => {
      const passingSpeed = Math.min(targetSpeed, Math.max(v, leader.vs + 8 + p.aggression * 6));
      const remaining = Math.max(0, leader.d + veh.halfL + leader.hs + 8);
      return { speed: passingSpeed, seconds: remaining / Math.max(3, passingSpeed - leader.vs) +
        (Math.abs(u - veh.u) + Math.abs(u - baseU)) / 2.1 + 1.5 + (1 - p.aggression) * 1.5 };
    };
    const twoWayClear = (leader, u) => {
      const { speed, seconds } = passHorizon(leader, u), distance = speed * seconds + 25;
      if (route.closed || line.roadEdges) return false;
      for (let d = 0; d <= distance + 20; d += 20) {
        const s = veh.s + dir * d;
        if ((route.div?.(s) ?? 0) >= 0.3 || (route.medHalf?.(s) ?? 0) > 0.15 || Math.abs(route.curv?.(s) || 0) >= 0.006) return false;
      }
      return !obs.some((o) => o.vs < -1 && o.d > -veh.halfL - o.hs &&
        o.d - veh.halfL - o.hs < (speed - o.vs) * seconds + 25);
    };
    if (this.passCountTarget) {
      const leader = obs.find((o) => obstacleKey(o.ref) === this.passCountTarget);
      if (leader && leader.d < -veh.halfL - leader.hs - 8) { this.overtakes++; this.passCountTarget = null; }
      else if (!leader) this.passCountTarget = null;
    }
    if (this.pass) {
      const leader = obs.find((o) => obstacleKey(o.ref) === this.pass.key);
      const b = line.bounds(veh.s, this.pass.oncoming);
      desiredU = clamp(this.pass.u, b.min, b.max); oncoming = this.pass.oncoming;
      const cleared = !leader || leader.d < -veh.halfL - leader.hs - 8;
      const abort = !cleared && oncoming && !twoWayClear(leader, desiredU);
      if (!cleared) targetSpeed = Math.min(targetSpeed, passHorizon(leader, desiredU).speed);
      if ((cleared || abort) && corridor(baseU, true).safe) {
        if (cleared) this.overtakes++; else this.abortedPasses++;
        this.pass = null; this.passOffset = null; this.passT = 0;
        desiredU = baseU; oncoming = false;
      } else if (abort) {
        // Make room behind the car we were passing before tucking back in.
        targetSpeed = Math.min(targetSpeed, Math.max(0, leader.vs - 7));
        plannedBrake = Math.max(plannedBrake, 0.85);
      }
    }
    if (!this.pass && !launchHold && passRoom && this.deficitT > 1.1 - p.aggression * 0.5 && current.leader && current.leader.vs >= 0 && current.gap < horizon && current.leader.vs < targetSpeed - 1.5) {
      const candidates = [bounds.min, bounds.max, baseU];
      // A two-way road needs enough closing distance for the complete pass
      // and return; personality changes the reserve, never the road bounds.
      const b = line.bounds(veh.s, true), oppositeU = dir > 0 ? b.min : b.max;
      if (twoWayClear(current.leader, oppositeU)) candidates.push(oppositeU);
      let bestScore = Math.min(targetSpeed, current.speed) + 0.4;
      for (const u of candidates) {
        const r = corridor(u, true), crosses = obs.some((o) => Math.abs(o.d) < veh.halfL + o.hs + 3 && o.u > Math.min(veh.u, u) - o.hu - veh.halfW && o.u < Math.max(veh.u, u) + o.hu + veh.halfW);
        if (!r.safe || crosses) continue;
        const score = Math.min(targetSpeed, r.speed) - Math.abs(u - veh.u) * 0.12;
        if (score > bestScore) { bestScore = score; desiredU = u; oncoming = u < bounds.min || u > bounds.max; }
      }
      if (Math.abs(desiredU - baseU) > 0.3) {
        this.passOffset = desiredU - baseU; this.passT = 2.5;
        // Ordinary same-carriageway moves remain relative to the racing line
        // and keep their short hold. Only a two-way pass needs a lane lock
        // until its original leader is cleared; a fixed u through later bends
        // would unnecessarily abandon the optimal line.
        if (oncoming) this.pass = { key: obstacleKey(current.leader.ref), u: desiredU, oncoming };
        else this.passCountTarget = obstacleKey(current.leader.ref);
      }
    }
    // One early defensive move toward the inside, with space for the challenger.
    if (!launchHold && passRoom && !current.leader && this.passT === 0 && p.aggression > 0.6 && !this.perfect) {
      const challenger = obs.find((o) => o.racer && o.d < -9 && o.d > -35 && o.vs > v + 1);
      if (challenger) {
        const inside = baseU + Math.sign(line.sample(line.k, veh.s + dir * 30)) * 0.45;
        if (corridor(inside, true).safe) desiredU = clamp(inside, bounds.min, bounds.max);
      }
    }
    // Preserve space while running side by side, including on the starting grid.
    // Returning to the optimal line is itself a lane change and needs clearance.
    if (launchHold) desiredU = clamp(this.launchU, bounds.min, bounds.max);
    const maneuverBounds = line.bounds(veh.s, oncoming);
    if (!corridor(desiredU, true).safe) desiredU = clamp(veh.u, maneuverBounds.min, maneuverBounds.max);
    const alongside = obs.filter((o) => Math.abs(o.d) < veh.halfL + o.hs + 4);
    for (const o of alongside) {
      const clearance = veh.halfW + o.hu + buffer;
      if (Math.abs(desiredU - o.u) < clearance) {
        const side = veh.u >= o.u ? 1 : -1;
        desiredU = clamp(o.u + side * clearance, maneuverBounds.min, maneuverBounds.max);
        if (Math.abs(desiredU - o.u) < clearance && o.d >= 0) targetSpeed = Math.min(targetSpeed, Math.max(0, o.vs - 3));
      }
    }
    // A head-on escape is one decision per approach. Fresh actor snapshots or
    // a small lateral crossing must never flip the chosen side of the car.
    if (this.evade) {
      const threat = obs.find((o) => obstacleKey(o.ref) === this.evade.key);
      this.evade.lost = threat ? 0 : this.evade.lost + dt;
      if (this.evade.lost > 1.2 || threat && (threat.d < -veh.halfL - threat.hs - 3 || threat.vs >= -1)) this.evade = null;
    }
    if (!this.evade) {
      const threat = obs.filter((o) => o.vs < -1 && o.d > 0 &&
        (o.d - veh.halfL - o.hs) / Math.max(1, v - o.vs) < 4.5 &&
        Math.min(Math.abs(o.u - veh.u), Math.abs(o.u + o.vu - veh.u)) < veh.halfW + o.hu + 0.8)
        .sort((a, b) => a.d / (v - a.vs) - b.d / (v - b.vs))[0];
      if (threat) {
        const escape = line.bounds(veh.s, true);
        const kerb = dir > 0 ? escape.max : escape.min, inner = dir > 0 ? escape.min : escape.max;
        const clearance = veh.halfW + threat.hu + 0.8;
        const score = (u) => Math.min(clearance, Math.abs(u - threat.u - clamp(threat.vu, -1.5, 1.5))) +
          (u === kerb ? 0.8 : 0) - Math.abs(u - veh.u) * 0.1 - (corridor(u, true).safe ? 0 : 10);
        const u = score(kerb) >= score(inner) ? kerb : inner;
        this.evade = { key: obstacleKey(threat.ref), u, side: Math.sign(u - veh.u) || dir, lost: 0 };
        this.pass = null; this.passOffset = null; this.passT = 0;
      }
    }
    if (this.evade) {
      const escape = line.bounds(veh.s, true);
      desiredU = clamp(this.evade.u, escape.min, escape.max);
      oncoming = desiredU < bounds.min || desiredU > bounds.max;
      targetSpeed = Math.min(targetSpeed, Math.max(3, v - caps.brake(v) * dt * 0.65));
    }
    const goalOffset = desiredU - baseU;
    const lateralRate = Math.min(2.1 + (1 - p.smooth) * 0.5, 0.4 + v * 0.08);
    this.offset += clamp(goalOffset - this.offset, -lateralRate * dt, lateralRate * dt);
    if (Math.abs(this.offset) > 0.5 && !launchHold) {
      // A parallel passing line can become a tighter bend when clipped against
      // the asphalt edge. Its own backward pass supplies real braking points.
      const offset = Math.round(this.offset * 4) / 4;
      const canCross = oncoming || baseU + this.offset < bounds.min || baseU + this.offset > bounds.max;
      const key = `${offset}:${canCross}`;
      if (!this.alternateProfiles.has(key)) this.alternateProfiles.set(key, line.offsetProfile(veh, offset, canCross));
      const profile = this.alternateProfiles.get(key);
      targetSpeed = Math.min(targetSpeed, line.sample(profile, veh.s + dir * Math.max(3, v * 0.2)) * racePace * pace);
      for (let d = 4; d < v * v / (2 * Math.max(1, caps.brake(v) * 0.7)) + 60; d += 4) {
        const future = line.sample(profile, veh.s + dir * d) * racePace * pace;
        const need = (v * v - future * future) / (2 * Math.max(1, d - v * 0.35));
        if (need > caps.brake(v) * 0.65) targetSpeed = Math.min(targetSpeed, future);
        if (need > 0) plannedBrake = Math.max(plannedBrake, need / caps.brake(v));
      }
    }
    // Brake until the bonnet has cleared an obstruction during a lane change.
    const wanted = corridor(baseU + this.offset), here = corridor(veh.u);
    targetSpeed = Math.min(targetSpeed, wanted.speed, here.speed);
    const egoVu = (-Math.sin(veh.yaw) * veh.vLong + Math.cos(veh.yaw) * veh.vLat) * frame.rx +
      (-Math.cos(veh.yaw) * veh.vLong - Math.sin(veh.yaw) * veh.vLat) * frame.rz;
    for (const o of obs) {
      if (o.vs < 0 || o.d < 0 || o.d > veh.halfL + o.hs + Math.max(8, (v - o.vs) * 2)) continue;
      if (this.elapsed < 2.5 && v < 6 && o.racer && o.vs > 0.2 && o.d > veh.halfL + o.hs + 2.5) continue;
      if (v < 5 && o.vs >= 0 && o.d > veh.halfL + o.hs + 2) continue;
      const futureGap = o.d + (o.vs - v) * 1.2;
      const lateralGap = Math.min(Math.abs(o.u - veh.u), Math.abs(o.u + o.vu * 0.8 - veh.u - egoVu * 0.8));
      const mergeBuffer = o.racer ? 2.5 : 5;
      if (futureGap < veh.halfL + o.hs + mergeBuffer && lateralGap < veh.halfW + o.hu + 0.8) {
        // Yield before two predicted body corridors intersect. Slowing now
        // leaves the leading racer room to complete the merge without contact.
        targetSpeed = Math.min(targetSpeed, Math.max(0, o.vs - (o.racer ? 2 : 7)));
        plannedBrake = Math.max(plannedBrake, o.racer ? clamp((v - o.vs + 2) / caps.brake(v), 0.15, 0.85) : 0.85);
      }
    }
    const kAhead = Math.max(Math.abs(line.sample(line.k, veh.s)), Math.abs(line.sample(line.k, veh.s + dir * 7.5)), Math.abs(line.sample(line.k, veh.s + dir * 15)));
    if (launchHold || Math.abs(this.offset) > 0.7) {
      // An alternative lane can be tighter than the minimum-curvature line.
      // Reserve lateral force for the transition and brake before its bend.
      for (let d = 0; d < v * v / (2 * Math.max(1, caps.brake(v) * 0.65)) + 40; d += 5) {
        const k = Math.abs(route.curv?.(veh.s + dir * d) || 0);
        const curveSpeed = Math.sqrt(caps.lat(v) * 0.9 / Math.max(1e-5, k));
        targetSpeed = Math.min(targetSpeed, Math.sqrt(curveSpeed * curveSpeed + 2 * caps.brake(v) * 0.6 * Math.max(0, d - 10)));
      }
    }
    const look = Math.max(2.4, Math.min(5 + v * 0.3, 22, 0.45 / Math.max(1e-4, kAhead)));
    const targetS = veh.s + dir * look;
    const targetBounds = line.bounds(targetS, oncoming);
    const holdAlongside = !this.evade && !oncoming && alongside.some((o) => o.racer && Math.abs(o.u - veh.u) < veh.halfW + o.hu + 3);
    const target = launchHold || holdAlongside ? route.point(targetS, clamp(desiredU, targetBounds.min, targetBounds.max), pointOut()) :
      line.point(targetS, this.offset, oncoming || this.offset + baseU < bounds.min || this.offset + baseU > bounds.max);
    const dx = target.x - veh.x, dz = target.z - veh.z;
    const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
    const lat = dx * rx + dz * rz, lon = dx * fx + dz * fz;
    const delta = Math.atan2(2 * veh.wb * lat, Math.max(1, dx * dx + dz * dz));
    const beta = Math.atan2(veh.vLat, Math.max(2, Math.abs(veh.vLong)));
    const desiredYawRate = v * Math.tan(delta) / veh.wb;
    const yawErr = desiredYawRate - veh.w;
    this.yawI = v > 6 && Math.abs(headingError) < 0.6 ? clamp(this.yawI * Math.exp(-dt * 0.8) + yawErr * dt * 0.07, -0.12, 0.12) : this.yawI * Math.exp(-dt * 4);
    let steer = clamp(caps.steer(Math.tan(delta) / veh.wb, v) - veh.w * 0.04, -1, 1);
    // Catch the slide through the same rack and stability aids as a human.
    if (Math.abs(beta) > 0.25) steer = clamp(steer + beta * 0.4, -1, 1);
    const pathError = Math.abs(veh.u - (baseU + this.offset));
    if (pathError > 0.8 || Math.abs(headingError) > 0.25) targetSpeed = Math.min(targetSpeed, Math.sqrt(caps.lat(v) * 0.85 / Math.max(0.005, kAhead + pathError / Math.max(30, look * look))));

    let signalBrake = 0, held = false;
    if (signals) {
      const front = veh.s + dir * veh.halfL, j = signals.next(front, dir);
      if (j && j.main !== 'G') {
        const d = ((dir > 0 ? j.sF : j.sO) - front) * dir;
        const lateAmber = j.main === 'A' && v * v / (2 * Math.max(1, d)) > caps.brake(v) * 0.8;
        if (d >= -1 && d < 300 && !lateAmber) {
          targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * caps.brake(v) * 0.85 * Math.max(0, d - 3)));
          signalBrake = clamp(v * v / (2 * Math.max(0.5, d - 2)) / caps.brake(v), 0, 1);
          if (d < 4 && v < 1) { held = true; signalBrake = 0.4; }
        }
      }
    }
    // Rare bounded hesitation: no deliberate spins, no dependence on race gap.
    if (!this.perfect && this.elapsed > this.nextMistake) { this.mistake = 0.35 + this.random() * 0.35; this.nextMistake = this.elapsed + 1 / Math.max(1e-5, p.mistakeRate) * (0.75 + this.random()); }
    if (this.mistake > 0) { this.mistake -= dt; targetSpeed *= 0.96; }

    const intentionalStop = held || targetSpeed < 2 && here.leader;
    this.slow = !intentionalStop && (this.elapsed > 3 || veh.wallHit > 2) && (v < 1.2 && targetSpeed > 3 || Math.abs(headingError) > 1.2 && v < 7) ? this.slow + dt : Math.max(0, this.slow - dt);
    if (this.slow > 1.1 && this.recovery === 'drive') { this.recovery = 'reverse'; this.recoveryT = 0; this.slow = 0; this.yawI = 0; }
    if (this.recovery !== 'drive') {
      this.recoveryT += dt;
      const rearClear = !obs.some((o) => o.d < 0 && o.d > -8 && Math.abs(o.u - veh.u) < veh.halfW + o.hu + 0.5);
      if (this.recovery === 'reverse') {
        if (this.recoveryT > 2.5 || !rearClear || v > 4) { this.recovery = 'rejoin'; this.recoveryT = 0; }
        else return this.result({ throttle: 0, brake: 0.85, steer: clamp(headingError * 1.8, -1, 1) }, { targetSpeed, phase: 'reverse' });
      }
      if (this.recovery === 'rejoin') {
        if (veh.vLong < -0.3) return this.result({ throttle: 0.8, brake: 0, handbrake: true, steer: clamp(-headingError * 1.8, -1, 1) }, { targetSpeed, phase: 'rejoin' });
        steer = clamp(-headingError * 1.6 + (baseU - veh.u) * 0.35, -1, 1);
        targetSpeed = Math.min(targetSpeed, 6);
        if (Math.abs(headingError) < 0.3 && Math.abs(veh.u - baseU) < 1.3) { this.recovery = 'drive'; this.integral = 0; this.offset = veh.u - baseU; }
        else if (this.recoveryT > 5) { this.recovery = 'reverse'; this.recoveryT = 0; }
      }
    }
    const error = targetSpeed - Math.max(0, veh.vLong);
    this.integral = clamp(this.integral + error * dt * 0.45, -0.3, 0.9);
    const drive = caps.drive(v, veh.gear), curveDemand = v * v * kAhead;
    const reserve = Math.sqrt(Math.max(0.02, 1 - Math.min(0.99, curveDemand / Math.max(1, caps.lat(v))) ** 2));
    let throttle = clamp(this.integral + error * 0.65 + 0.14, 0, 1);
    // Establish a merge gap while holding the launch lanes. The car farther
    // from the racing line lifts briefly instead of both cars braking hard
    // when the 150 m lane hold ends. Single-file grids need no launch lift.
    if (!route.closed && launchHold && this.elapsed < 3 && obs.some((o) => o.racer && Math.abs(o.d) < 15 &&
      Math.abs(this.launchU - baseU) > Math.abs(o.u - baseU) + 1)) throttle = Math.min(throttle, 0.7);
    // Feather the power to keep longitudinal demand in the friction ellipse.
    if (v > 6) throttle = Math.min(throttle, clamp(caps.lat(v) * reserve / Math.max(1, drive), 0.15, 1));
    if (v > 8 && (Math.abs(veh.ay) > caps.lat(v) * 0.6 || Math.abs(beta) > 0.025 && caps.rearSlip() > 0.8)) throttle = Math.min(throttle, 0.55);
    if (veh.wheelspin > 0.25 && v > 4) throttle *= 1 - clamp(veh.wheelspin * 0.45, 0, 0.6);
    let brake = held ? 0.4 : clamp(Math.max(signalBrake, plannedBrake > 0.65 ? plannedBrake : 0, error < -0.15 ? clamp(-error * 0.38, 0, 1) : 0), 0, 1);
    if (v > 6 && here.gap > 8 && Math.abs(beta) > 0.04 && caps.rearSlip() > 1.15) brake *= clamp(1.15 / caps.rearSlip(), 0.25, 1);
    // Ordinary service brake must not accidentally select reverse while queuing.
    const safeBrake = veh.vLong < 1 && brake > 0 ? Math.min(0.45, brake) : brake;
    const nitro = veh.spec.nitrous === true && !this.perfect && !held && error > 3 && v > 15 && Math.abs(steer) < 0.18 && kAhead < 0.0015 && here.gap > v * 3 && veh.nitro > 0.15;
    return this.result({ throttle: safeBrake > 0.03 ? 0 : throttle, brake: safeBrake, steer, nitro }, { targetSpeed, gap: here.gap, phase: this.recovery, look, u: baseU + this.offset, desiredU, evadeSide: this.evade?.side ?? 0, passing: !!this.pass, oncoming, overtakes: this.overtakes, abortedPasses: this.abortedPasses, k: kAhead });
  }
  result(input, debug) { this.debug = debug; return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...input }; }
}
