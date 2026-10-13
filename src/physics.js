// Vehicle dynamics, sim-leaning. Fixed 240 Hz substeps. See tools/physics-review.md for the derivations and tests.
//  - engine with per-type torque curves (turbo spool / lag, turbo-diesel), engine braking, rev limiter, clutch slip on
//    launch, automatic sequential gearbox with per-car shift times and rev-matched downshifts
//  - four wheels, each with its own load, slip angle, slip ratio and spin state (implicit integration), so
//    wheelspin, lock-ups, ABS and traction control are real
//  - driveline: engine inertia reflected through the gearing onto the driven axle's differential; open diff
//    (equal torque split) or a torque-sensing / clutch LSD (locking force capped by a bias coefficient); brake-based
//    "electronic diff lock" for open-diff cars; FWD / RWD / AWD only differ by which axle receives the torque
//  - combined-slip tyres (normalised Pacejka "similarity" method) with load sensitivity, peak slip angle and
//    slide falloff per car, tyre relaxation length
//  - per-wheel loads: lagged longitudinal / lateral weight transfer through the suspension (roll stiffness
//    distribution sets the under/oversteer balance), aero downforce, crests and dips of the real road profile
//  - stability control works by braking single wheels (outer front against oversteer), not by injecting yaw torque
//  - suspension pose (heave / pitch / roll springs per car) excited by road texture, bumps and expansion joints
//  - keyboard-friendly steering: speed-sensitive lock that tracks the tyres' useful slip angle, extra lock for
//    counter-steer
//  - crash damage per zone (front / rear / left / right) from the equivalent barrier speed of each impact
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep } from './util.js';
import { ROAD } from './road.js';

const G = 9.81, RHO = 1.2;
const POWER_MUL = 1;    // catalogue power / torque as quoted (spec.powerMul can override per car)
const H = 1 / 240;
const J_WHEEL = 1.1;    // kg m^2 per wheel (tyre + rim + brake disc)
const ETA = 0.92;       // driveline efficiency

// torque curves: [rpm / redline, fraction of peak torque]; the power cap in torqueMax() shapes the top end.
// lsd: locking coefficient of the stock differential, |T_left - T_right| <= lsd * |T_axle| (0 = open diff)
const ENGINES = {
  turbo3: { curve: [[0,0.4],[0.25,0.58],[0.46,1],[0.65,1],[1,0.68],[1.1,0.55]], lag: 0.48, boostMin: 0.5, Je: 0.12, lsd: 0.35 },
  na4: { curve: [[0,0.4],[0.25,0.68],[0.5,0.92],[0.65,1],[0.85,0.92],[1,0.69],[1.1,0.55]], lag: 0, Je: 0.13, lsd: 0.25 },
  turbo4: { curve: [[0, 0.5], [0.2, 0.86], [0.24, 1], [0.7, 1], [1, 0.8], [1.1, 0.7]], lag: 0.55, boostMin: 0.6, Je: 0.13, lsd: 0 },
  turbo5: { curve: [[0, 0.45], [0.22, 0.72], [0.36, 1], [0.82, 0.97], [1, 0.84], [1.1, 0.75]], lag: 0.75, boostMin: 0.52, Je: 0.15, lsd: 0.4 },
  // BMW B58: 500 N m from 1600-4500 rpm, 250 kW 5000-6500 rpm (redline ~7000)
  turbo6: { curve: [[0, 0.45], [0.18, 0.88], [0.23, 1], [0.64, 1], [0.93, 0.79], [1, 0.72], [1.1, 0.6]], lag: 0.45, boostMin: 0.55, Je: 0.17, lsd: 0.3 },
  flat6: { curve: [[0, 0.48], [0.3, 0.7], [0.6, 0.92], [0.82, 1], [1, 0.93], [1.1, 0.85]], lag: 0, Je: 0.11, lsd: 0.4 },
  v12: { curve: [[0, 0.58], [0.3, 0.84], [0.6, 1], [0.86, 0.98], [1, 0.9], [1.1, 0.8]], lag: 0, Je: 0.24, lsd: 0.4 },
  diesel: { curve: [[0, 0.42], [0.22, 0.85], [0.32, 1], [0.55, 1], [0.8, 0.86], [1, 0.62], [1.1, 0.5]], lag: 0.9, boostMin: 0.48, Je: 0.21, lsd: 0 },
};
function curveAt(c, x) {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const a = c[i - 1], b = c[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  return c[c.length - 1][1];
}
// deterministic hash noise for the road surface
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const BODY_WB = { mini: 2.46, wedge: 2.7, coupe: 2.45, sedan: 2.78 };
const newCorner = (v) => ({ vw: v, aDyn: 0, abs: 1, k: 0, sy: 0, sx: 0, sN: 0, Fx: 0, Fy: 0, Fz: 0, lock: 0, esc: 0, edl: 0 });
// damage: an impact below ~8 km/h equivalent barrier speed is absorbed by the bumper; full crush of a zone at
// ~54 km/h (front / rear crumple zones) or ~32 km/h (doors and sills have far less crush space)
const DIG_RES = 0.09 * 9.81; // m/s^2 of extra resistance with the wheels dug in to the hubs (dig = 1): about what spinning tyres still push
const DMG_V0 = 2.2, DMG_FULL = { front: 15, rear: 15, left: 9, right: 9 };

export class Vehicle {
  constructor(spec, route) {
    this.route = route;
    this.setSpec(spec);
    this.manual = !!spec.manual;
    this.reset(0, 0);
  }
  setSpec(spec) {
    this.spec = spec;
    this.eng = ENGINES[spec.engine] || ENGINES.turbo4;
    this.m = spec.mass;
    this.wb = spec.wheelbase ?? BODY_WB[spec.body] ?? 2.55;
    const fw = spec.frontW ?? 0.55;
    this.b = this.wb * fw; this.a = this.wb - this.b;   // a: CG -> front axle, b: CG -> rear axle
    // yaw inertia: dynamic index I / (m a b) ~ 1 for road cars; yawI tweaks it per car
    this.Iz = this.m * this.a * this.b * (spec.yawI ?? 1) * 1.05;
    this.halfW = (spec.width ?? (spec.body === 'mini' ? 1.72 : spec.body === 'wedge' ? 2.0 : 1.84)) / 2;
    this.halfL = (spec.length ?? (spec.body === 'mini' ? 3.82 : spec.body === 'wedge' ? 4.7 : 4.4)) / 2;
    this.hcg = spec.hcg ?? 0.5;
    this.track = spec.track ?? this.halfW * 2 * 0.86;
    this.awd = spec.drive === 'awd';
    this.shareR = spec.drive === 'fwd' ? 0 : spec.drive === 'awd' ? (spec.awdRear ?? 0.6) : 1;
    this.shareR0 = this.shareR; // base split; an AWD coupling shifts torque rearwards while drifting (see step)
    // tyre shape: peak slip angle, peak slip ratio, sliding friction as a share of peak (peakier tyres snap more)
    this.aPk = spec.alphaPk ?? 0.11;
    this.kPk = this.aPk * 0.9;
    const C = spec.mfC ?? 1.5;
    this.mfC = C; this.mfB = Math.tan(Math.PI / (2 * C));
    this.slideK = clamp(1 - (C - 1.3) * 0.9, 0.62, 0.95);
    this.slope0 = C * this.mfB; // d f / d s at the origin (the steepest point of the curve)
    this.lsd = spec.lsd ?? this.eng.lsd ?? 0;
    // friction ellipse: a tyre's driving / braking peak is ~10% above its cornering peak (longer contact-patch
    // footprint along the rolling direction); sets launch traction and stopping distances
    this.muX = spec.muX ?? 1.1;
    this.slideV = spec.slideV ?? 0.16; // extra friction lost at high sliding speed (spinning / locked rubber)
    // suspension natural frequency -> spring / damper per unit mass
    const wn = 2 * Math.PI * (spec.susHz ?? 1.8);
    this.kS = wn * wn; this.cS = 2 * (spec.susZ ?? 0.45) * wn;
    // wheel positions (body frame: x forward, y right): FL, FR, RL, RR
    const t2 = this.track / 2;
    this.cx = [this.a, this.a, -this.b, -this.b]; this.cy = [-t2, t2, -t2, t2];
    this.damageFx();
  }
  reset(s, u, speed = 0) {
    const f = this.route.frame(s, {});
    const p = this.route.point(s, u);
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.yaw = Math.atan2(-f.tx, -f.tz); // forward = (-sin yaw, -cos yaw)
    this.vLong = speed; this.vLat = 0; this.w = 0;
    this.s = s; this.u = u;
    this.gear = 1; this.rpm = this.spec.idle; this.shiftT = 0; this.shiftCool = 0; this.pendingGear = 0; this.clutch = 1;
    this.steer = 0; this.slipF = 0; this.slipR = 0; this.spin = 0; this.ax = 0; this.ay = 0;
    this.nitro = 0.35; this.nitroOn = false;
    this.pose = { roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0 };
    this.lt = { ax: 0, axV: 0, ay: 0, ayV: 0 }; // load-transfer accelerations as felt through the springs
    this.axRaw = 0; this.ayRaw = 0;
    // corners: per-wheel state [FL, FR, RL, RR]; wheel: per-axle summary [front, rear] (wheel[i].vw spins the meshes)
    this.corners = [newCorner(speed), newCorner(speed), newCorner(speed), newCorner(speed)];
    this.wheel = [newCorner(speed), newCorner(speed)];
    this.boost = 0; this.tcCut = 0; this.escCut = 0; this.limiter = false; this.load = 0; this.engT = 0;
    this.dig = 0; this.digF = 0; this.digB = 0; this.curbHit = 0;
    // history from before the reset must not leak into the first step after it (a NaN or a teleport would): the
    // integrator's differences and every per-car cache ground.js keeps (contact history, airborne state, kerb zones)
    this.roadPrev = this.roadFPrev = this.lastAbsBeta = undefined;
    this._gx = this._gz = this._gy = this._gt = this._gu = undefined; this._curbZ = null;
    this.air = 0; this.vy = 0; this.yAir = undefined; this.sink = 0; this.water = 0; this.gradeG = undefined; this.grade = 0; this.bank = 0;
    this.wallNx = this.wallNz = 0; this.curbScrape = false;
    this.wallHit = 0; this.offroad = 0; this.reverse = false; this.topSpeed = 0; this.drift = 0; this.driftLatch = 0;
    this.shiftEvent = 0; this.bumpHit = 0; this.rough = 0; this.absOn = false; this.tcOn = false; this.escOn = false;
    this.skid = 0; this.wheelspin = 0; this.lockup = 0; this.lastV = speed; this.lastBumpCell = -1; this.kickT = 0; this.wasDeclutched = false; this.rearDrag = 0; this.dragI = 0; this.flickT = 0; this.bigSteerT = 9; this.bigSteerSide = 0; this.shareR = this.shareR0;
    this.damage = { front: 0, rear: 0, left: 0, right: 0 }; this.smoke = false; this.lastDamage = null;
    this.damageFx();
  }
  get speed() { return Math.hypot(this.vLong, this.vLat); }
  get kmh() { return Math.abs(this.vLong) * 3.6; }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  velocityWorld(out = new THREE.Vector3()) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return out.set(fx * this.vLong + rx * this.vLat, 0, fz * this.vLong + rz * this.vLat);
  }
  ratio(g = this.gear) { return this.spec.gears[g - 1] * this.spec.final; }
  /** full-throttle engine torque (N m) at rpm, including turbo boost and crash damage */
  torqueMax(rpm) {
    const sp = this.spec, e = this.eng, pm = (sp.powerMul ?? POWER_MUL) * (this.engHealth ?? 1);
    // Optional absolute rpm/Nm anchors preserve individual engines' torque and power peaks.
    let shape = sp.torqueCurve ? curveAt(sp.torqueCurve, rpm) / sp.torque : curveAt(e.curve, rpm / sp.redline);
    if (e.lag) shape *= lerp(e.boostMin, 1, this.boost);
    const T = sp.torque * pm * shape;
    const cap = sp.power * 1000 * pm / Math.max(60, rpm * Math.PI / 30) * 1.04;
    return Math.min(T, cap);
  }
  /** steering lock: full lock when parking; at speed, about what the front tyres can use (keyboard friendly) */
  lockAt(av) {
    const sp = this.spec;
    const raw = sp.steer * (0.14 + 0.86 / (1 + av / 15));
    const grip = this.wb * sp.grip * G / Math.max(1, av * av) + this.aPk * 1.25;
    return Math.min(raw, grip);
  }

  /**
   * Crash damage. zone: 'front' | 'rear' | 'left' | 'right'. e: { kind, sev, car, side, zone, dv, heavy }.
   * Two call forms:
   *   traffic events (e.sev is a number): sev = closing speed along the contact normal (m/s) and dv = this car's
   *     |delta-v| from the impulse. Damage is sized from sev; dv only gates it (dv > 0: an impulse actually acted,
   *     sev > 0: the bodies were approaching). dv itself is NOT the closing speed: for equal cars it is already
   *     ~sev (1 + e) / 2, so feeding it through the reduced-mass split below would halve the energy twice.
   *   direct calls (walls, tests; no e.sev): dv is the closing speed (> 0 while approaching).
   * Separating or resting contact does nothing. The crush energy this car absorbs becomes an equivalent barrier
   * speed (EBS), with vc the closing speed:
   *   rigid object (no e.car / kind 'wall'): EBS = vc
   *   car of mass m2: E = 1/2 mu vc^2 (mu = m1 m2 / (m1 + m2)), shared by structural stiffness
   *   (equal cars: half each -> EBS = vc / 2; a lorry / bus is far stiffer, this car takes 3/4)
   * (translational mu: an upper bound on an off-centre hit, where rotation takes some of the energy)
   * Damage grows linearly with EBS above the bumper's elastic limit (crush depth ~ EBS for a linear crush
   * stiffness) and accumulates. Returns the increment. Deterministic: no randomness.
   */
  addDamage(zone, dv, e = {}) {
    zone = zone || e.zone;
    dv = +(dv ?? e.dv) || 0;
    const hasSev = typeof e.sev === 'number';
    const vc = hasSev ? (Number.isFinite(e.sev) ? e.sev : 0) : dv;
    if (!(dv > 0) || !(vc > 0) || !(zone in this.damage)) return 0;
    const m1 = this.m;
    let ebs = vc;
    if (e.car && e.kind !== 'wall') {
      const m2 = e.car.mass ?? (e.heavy ? 12000 : m1);
      const mu = m1 * m2 / (m1 + m2), share = m2 > 3000 ? 0.75 : 0.5;
      ebs = vc * Math.sqrt(share * mu / m1);
    }
    const inc = clamp((ebs - DMG_V0) / (DMG_FULL[zone] - DMG_V0), 0, 1);
    if (inc <= 0) return 0;
    this.damage[zone] = Math.min(1, this.damage[zone] + inc);
    this.lastDamage = { zone, inc, ebs, kind: e.kind };
    this.damageFx();
    return inc;
  }
  /** effects of the damage state: modest engine loss (cooling / intake) from the front, a toe / tie-rod pull
   *  towards a damaged side, a little drag from bent panels; radiator steam once the front is badly crushed */
  damageFx() {
    const d = this.damage || { front: 0, rear: 0, left: 0, right: 0 };
    this.engHealth = 1 - 0.3 * smoothstep(0.35, 1, d[this.spec.engineZone || 'front']);
    this.toePull = 0.006 * (d.right - d.left);   // rad of steer offset at the road wheels (~0.35 deg, one bent wheel)
    this.dmgDrag = 1 + 0.06 * Math.max(d.front, d.rear) + 0.03 * Math.max(d.left, d.right);
    if (d.front >= 0.6) this.smoke = true;
  }

  /** set every wheel to its free-rolling speed: the contact-patch velocity (body velocity + yaw rate x lever
   *  arm) along that wheel's heading, so a steered or yawing car doesn't get a slip spike after the reset */
  syncWheels() {
    const d = this.steer + (this.toePull || 0), c = Math.cos(d), s = Math.sin(d), C4 = this.corners;
    for (let i = 0; i < 4; i++) {
      const vxp = this.vLong - this.w * this.cy[i], vyp = this.vLat + this.w * this.cx[i];
      C4[i].vw = i < 2 ? vxp * c + vyp * s : vxp;
    }
    this.wheel[0].vw = (C4[0].vw + C4[1].vw) * 0.5; this.wheel[1].vw = (C4[2].vw + C4[3].vw) * 0.5;
  }

  /** input: {throttle, brake, steer (-1 left..1 right), handbrake, nitro} */
  update(dt, input) {
    if (!(dt > 0)) return; // a zero / negative / NaN step would divide by zero in the integrator (suspension, ABS rates)
    // something outside the integrator (a crash, a wall) changed our speed: let the wheels follow
    if (Math.abs(this.vLong - this.lastV) > 1.5) this.syncWheels();
    const N = Math.max(1, Math.round(dt / H));
    const h = dt / N;
    this.bumpHit = 0;
    for (let i = 0; i < N; i++) this.step(h, input);
    this.lastV = this.vLong;
    this.topSpeed = Math.max(this.topSpeed, this.kmh);
  }

  /** road height profile under a point (texture + discrete bumps / joints / manholes), metres */
  roadZ(s, side) {
    const urb = this.route.urban(s);
    let z = 0.0022 * (Math.sin(s * 2.31 + side) + 0.6 * Math.sin(s * 5.7 + side * 2.1) + 0.4 * Math.sin(s * 0.83 + side * 0.7));
    // patched asphalt: long, gentle undulations, rougher out of town on the cliff road
    z += (0.006 + 0.008 * (1 - urb)) * Math.sin(s * 0.21 + Math.sin(s * 0.047) * 2.5);
    // discrete events every ~35 m cell: expansion joints, manhole covers (in town), sunken patches
    const cell = Math.floor(s / 35), hs = hash(cell);
    if (hs < 0.45) {
      const at = cell * 35 + 5 + hash(cell + 0.5) * 25, w = hs < 0.15 ? 0.35 : 1.6;
      const d = (s - at) / w;
      if (Math.abs(d) < 1) z += (hs < 0.15 ? 0.012 : hs < 0.3 ? -0.014 : 0.01) * (0.5 + 0.5 * Math.cos(d * Math.PI)) * (side > 0 && hs < 0.3 ? 0.4 : 1);
    }
    if (this.offroad) z += 0.03 * (Math.sin(s * 3.1 + side) + Math.sin(s * 7.7 + side * 3)) * 0.5;
    return z;
  }

  step(dt, inp) {
    const sp = this.spec, route = this.route;
    const vx = this.vLong, vy = this.vLat, av = Math.abs(vx), vt = Math.hypot(vx, vy);
    const thrIn = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    const beta = Math.atan2(vy, Math.max(2, av));

    // ---------------- steering: speed-sensitive lock, extra room to counter-steer a slide, rack rate per car
    const lock = this.lockAt(vt);
    const sIn = clamp(inp.steer, -1, 1);
    const counter = Math.sign(sIn) === Math.sign(beta) ? Math.min(0.5, Math.abs(beta) * 1.0) : 0; // enough opposite lock to catch ~40 deg
    // drift latch: handbrake (or a held slide on power) tells the assists you mean it. It stays latched while the car
    // is still sliding, so TC / ESC / the steering helper don't straighten the car out under you mid-drift
    const sliding = Math.abs(beta) > 0.1 && vt > 6;
    // a Scandinavian flick (a big steering reversal at speed) is a drift entry: latch straight away
    this.flickT = Math.max(0, this.flickT - dt); this.bigSteerT += dt;
    if (Math.abs(sIn) > 0.5) {
      // (a lift-off with the car loaded up: a quick lane change on the throttle isn't a feint)
      if (Math.sign(sIn) !== this.bigSteerSide && this.bigSteerT < 0.8 && vt > 12 && thrIn < 0.3 && Math.abs(this.ay) > 4) { this.driftLatch = 1; this.flickT = 0.7; }
      this.bigSteerSide = Math.sign(sIn); this.bigSteerT = 0;
    }
    // power-over on a driven rear: throttle with the rear tyres at their limit means it (before TC can hide the spin)
    const rearAtLimit = this.shareR > 0 && Math.max(this.corners[2].sN, this.corners[3].sN) > 0.9 && Math.abs(beta) > 0.05 && vt > 6;
    if (inp.handbrake && vt > 6) this.driftLatch = 1;
    else if (rearAtLimit && thrIn > 0.6) this.driftLatch = Math.min(1, this.driftLatch + dt * 4);
    else if (sliding && thrIn > 0.5 && this.shareR > 0 && this.spin > 0.2) this.driftLatch = Math.min(1, this.driftLatch + dt * 3);
    // counter-steering into a slide (feint, lift-off, power-over) is the same statement of intent
    // (tail out and still rotating into the turn: w opposite to beta. Mid-slalom the yaw follows the new steering instead)
    else if (sliding && Math.sign(sIn) === Math.sign(beta) && Math.abs(sIn) > 0.15 && this.w * beta < -0.02) this.driftLatch = Math.min(1, this.driftLatch + dt * 4);
    else if (this.flickT <= 0) this.driftLatch = Math.max(0, this.driftLatch - dt * (sliding ? (thrIn > 0.2 ? 0.05 : 0.3) : 1.5));
    // AWD slide assist: the electronically controlled coupling moves torque rearward once you're drifting (spec.awdDrift,
    // rear share), approximating the rear-biased end of a variable split such as the 2024 GR Yaris Track mode
    // (60:40 .. 30:70; Gravel 53:47), so throttle swings the tail instead of the fronts pulling it straight. It eases
    // back to the base split (spec.awdRear) as the latch releases (coupling response ~0.2-0.3 s)
    // It also leans rearward on its own when you're hard on the throttle in a loaded corner (no effect in a straight line)
    if (this.awd) {
      const rearPull = Math.max(this.driftLatch, smoothstep(0.6, 1, thrIn) * smoothstep(3, 7, Math.abs(this.ay)));
      const tgt = lerp(this.shareR0, Math.max(this.shareR0, sp.awdDrift ?? 0.7), rearPull);
      this.shareR += clamp(tgt - this.shareR, -dt * 2.5, dt * 2.5);
    }
    // a light counter-steer helper when the rear steps out and you aren't steering into it (a steering input aid,
    // the car's yaw still comes only from tyre forces)
    const helper = clamp(beta * 0.55, -0.22, 0.22) * smoothstep(5, 14, vt) * (Math.abs(sIn) < 0.1 ? 1 : 0.35) * (1 - 0.6 * this.driftLatch);
    const target = sIn * (lock + counter) + helper;
    const rate = (sp.steerRate ?? 1) * (2.4 + 1.5 / (1 + vt / 10));
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const delta = this.steer + this.toePull;   // bent steering after a side impact pulls the car

    // ---------------- suspension-filtered accelerations (drive the load transfer: weight shifts with the springs)
    const LT = this.lt, kS = this.kS * 1.6, cS = this.cS * 1.25;
    LT.axV += (kS * this.axRaw - kS * LT.ax - cS * LT.axV) * dt; LT.ax += LT.axV * dt;
    LT.ayV += (kS * this.ayRaw - kS * LT.ay - cS * LT.ayV) * dt; LT.ay += LT.ayV * dt;
    const axL = clamp(LT.ax, -16, 12), ayL = clamp(LT.ay, -16, 16);

    // ---------------- normal loads
    const DF = 0.5 * RHO * (sp.clA ?? 0) * vx * vx, aeroF = sp.aeroF ?? 0.45;
    // crests unload the car, dips load it: vertical curvature of the real road
    const y0 = route.y(this.s - 3), y1 = route.y(this.s), y2 = route.y(this.s + 3);
    const vcurv = (y0 - 2 * y1 + y2) / 9;
    const P = this.pose;
    const roadAvg = (this.roadZ(this.s + this.a, -1) + this.roadZ(this.s + this.a, 1) + this.roadZ(this.s - this.b, -1) + this.roadZ(this.s - this.b, 1)) * 0.25;
    const susp = this.kS * (roadAvg - P.heave) + this.cS * ((roadAvg - (this.roadPrev ?? roadAvg)) / dt - P.heaveV);
    this.roadPrev = roadAvg;
    const vMul = clamp(1 + vx * vx * vcurv / G + clamp(susp / G, -0.5, 0.6), 0.15, 2.2);
    const W = this.m * G * vMul;
    // longitudinal transfer: m ax h = dFz * wb
    const dLong = this.m * axL * this.hcg / this.wb;
    const Fzf = Math.max(300, W * (this.b / this.wb) + DF * aeroF - dLong);
    const Fzr = Math.max(300, W * (this.a / this.wb) + DF * (1 - aeroF) + dLong);
    // lateral transfer: the roll moment m ay h is reacted by (Fz_left - Fz_right) * track / 2, so each side moves
    // by m ay h / track in total, split between the axles by roll stiffness (rsF front). ay > 0 (turning right)
    // loads the left wheels.
    const dLat = this.m * ayL * this.hcg / this.track, rsF = sp.rsF ?? 0.55;
    const dF = dLat * rsF, dR = dLat * (1 - rsF);
    const C4 = this.corners, cx = this.cx, cy = this.cy;
    C4[0].Fz = clamp(Fzf / 2 + dF, 0, Fzf); C4[1].Fz = Fzf - C4[0].Fz;
    C4[2].Fz = clamp(Fzr / 2 + dR, 0, Fzr); C4[3].Fz = Fzr - C4[2].Fz;
    const Fz0 = this.m * G * 0.25; // one nominal tyre load: lightly loaded tyres have the higher friction coefficient
    const mu0 = sp.grip * (this.offroad ? 0.62 : 1) * (this.surfMu ?? 1)
    const ls = sp.loadSens ?? 0.15;
    const cap = this._cap || (this._cap = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) { const fz = C4[i].Fz; cap[i] = Math.max(1, mu0 * fz * Math.max(0.4, 1 - ls * (fz / Fz0 - 1))); }

    // ---------------- engine / gearbox
    const R = sp.wheelR, e = this.eng, red = sp.redline;
    // reverse is selected only once the car has actually stopped on the brake (not while still rolling forward)
    if (av < 0.1 && vt < 0.5 && brk > 0.5 && thrIn < 0.1) this.reverse = true;
    if (thrIn > 0.1 && this.reverse && vx > -0.8) this.reverse = false;
    const thrRaw = this.reverse ? brk : thrIn;
    this.shiftT = Math.max(0, this.shiftT - dt); this.shiftCool = Math.max(0, this.shiftCool - dt);
    if (this.shiftT <= 0 && this.pendingGear) { this.gear = this.pendingGear; this.pendingGear = 0; }
    const sR = this.shareR, sF = 1 - sR;
    const vwF = (C4[0].vw + C4[1].vw) * 0.5, vwR = (C4[2].vw + C4[3].vw) * 0.5;
    const vwD = vwF * sF + vwR * sR; // differential carrier speed (contact-patch units)
    const gr = this.reverse ? -sp.gears[0] * sp.final * 1.1 : this.ratio();
    const wheelRpm = vwD / R * gr * 60 / (2 * Math.PI);
    // turbo spool
    const e_r = this.rpm / red;
    if (e.lag) { const tgt = thrRaw * smoothstep(0.12, 0.42, e_r); const tau = e.lag * (sp.turbo ?? 1) * (tgt > this.boost ? 1 : 0.35); this.boost += (tgt - this.boost) * Math.min(1, dt / Math.max(0.05, tau)); }
    if (!this.manual) {
    // automatic sequential box: shift points follow the throttle; kick-down; rev-matched downshifts when braking
    // mid-drift it holds the gear (a locked or spinning axle says nothing about road speed): no shifts on the
    // handbrake, and while latched only an upshift at the limiter or a downshift once the car has really slowed
    const holdGear = sR > 0 && (inp.handbrake || (this.driftLatch > 0.3 && Math.abs(beta) > 0.1)); // fwd: the box reads the (honest) front wheels
    if (!this.reverse && this.shiftT <= 0 && this.shiftCool <= 0 && av > 0.5 && !(holdGear && inp.handbrake)) {
      const nG = sp.gears.length;
      const up = holdGear ? red * 0.99 : red * lerp(0.6, 0.975, smoothstep(0.2, 0.9, thrRaw));
      const rpmIn = (g) => vwD / R * this.ratio(g) * 60 / (2 * Math.PI);
      const rpmRoad = (g) => vt / R * this.ratio(g) * 60 / (2 * Math.PI);
      if (this.gear < nG && rpmIn(this.gear) > up && this.clutch >= 1) this.shift(this.gear + 1, sp.shiftT ?? 0.15);
      else if (holdGear) { if (this.gear > 1 && rpmRoad(this.gear) < red * 0.25 && rpmRoad(this.gear - 1) < red * 0.7) this.shift(this.gear - 1, (sp.shiftT ?? 0.15) * 0.7); }
      else if (this.gear > 1) {
        const dn = rpmIn(this.gear - 1);
        const downAt = brk > 0.2 ? red * 0.72 : red * lerp(0.32, 0.6, thrRaw);
        if (dn < red * 0.9 && (rpmIn(this.gear) < downAt || (thrRaw > 0.92 && dn < red * 0.8 && rpmIn(this.gear) < red * 0.55))) this.shift(this.gear - 1, (sp.shiftT ?? 0.15) * 0.7);
      }
    }
    }
    // clutch: slips on launch (holds revs up), otherwise locked to the driven wheels
    const launchRpm = sp.idle + (red * (sp.engine === 'diesel' ? 0.38 : 0.5) - sp.idle) * thrRaw;
    const shifting = this.shiftT > 0;
    const slipGear = this.reverse || this.gear === 1;
    // handbrake: the driver dips the clutch so the engine can't fight the locked rears (rwd / awd); revs flare on throttle
    const hbClutch = !!inp.handbrake && sR > 0;
    const engaged = !hbClutch && !shifting && Math.abs(wheelRpm) > sp.idle * 0.9 && (!slipGear || Math.abs(wheelRpm) >= launchRpm * 0.98);
    this.clutch = engaged ? 1 : shifting || hbClutch ? 0 : clamp(Math.abs(wheelRpm) / Math.max(1, launchRpm), 0, 0.99);
    let rpmT = engaged ? Math.abs(wheelRpm) : hbClutch ? sp.idle + thrRaw * (red * 0.85 - sp.idle) : shifting ? (this.pendingGear ? Math.abs(vwD / R * this.ratio(this.pendingGear) * 60 / (2 * Math.PI)) : this.rpm) : launchRpm;
    if (shifting && this.pendingGear < this.gear && this.pendingGear) rpmT *= 1.05; // throttle blip
    rpmT = Math.max(rpmT, sp.idle);
    // clutch kick: letting the clutch out on a flared engine dumps its flywheel energy into the driven wheels
    if (engaged && this.wasDeclutched && this.rpm > Math.abs(wheelRpm) + 300) this.kickT = (this.rpm - Math.abs(wheelRpm)) * Math.PI / 30 * e.Je / 0.18;
    this.wasDeclutched = hbClutch;
    this.kickT = Math.max(0, this.kickT - dt * this.kickT / 0.18);
    this.rpm = engaged ? Math.max(sp.idle, Math.abs(wheelRpm)) : damp(this.rpm, rpmT, shifting ? 18 : 9, dt);
    // limiter (fuel cut with hysteresis)
    if (this.rpm > red * 1.005) this.limiter = true; else if (this.rpm < red * 0.97) this.limiter = false;
    // traction control trims torque while the driven wheels spin
    const thr = thrRaw * (1 - this.tcCut) * (1 - this.escCut);
    let Te = this.torqueMax(this.rpm) * thr;
    // engine braking (pumping + friction) opposes the crank's rotation, whichever way the wheels drive it
    const Teb = sp.torque * (sp.ebrake ?? 0.15) * (0.25 + 0.75 * e_r) * Math.max(0, 1 - thrRaw * 4) * (wheelRpm < 0 ? -1 : 1);
    if (this.limiter) Te = 0;
    if (shifting) Te = 0;
    let Tnet = engaged ? Te - Teb + this.kickT : hbClutch ? 0 : Te * (shifting ? 0 : 1);
    this.engT = Tnet;
    this.load = clamp(Tnet / (sp.torque * (sp.powerMul ?? POWER_MUL)), -1, 1);
    // nitro: extra fuel and a squirt of shove
    this.nitroOn = !!inp.nitro && this.nitro > 0.01 && thrIn > 0.2 && !this.reverse;
    let nitroF = 0;
    if (this.nitroOn) { Tnet *= 1.25; nitroF = this.m * 3.0; this.nitro = Math.max(0, this.nitro - dt * 0.2); }
    // speed governor at the car's quoted top speed
    const vmax = sp.vmax / 3.6 * (this.nitroOn ? 1.08 : 1);
    if (Tnet > 0) Tnet *= 1 - smoothstep(vmax * 0.975, vmax * 1.01, av);
    if (this.reverse) Tnet *= 1 - smoothstep(5.5, 7, -vx); // reverse governor (~25 km/h), smooth so the wheels don't overshoot
    const Fdrive = Tnet * gr * ETA / R; // at the contact patches, signed (reverse -> negative)
    // engine + gearbox inertia seen at the driven contact patches (kg) while the clutch is locked: Je (i/R)^2
    const Jeq = engaged ? e.Je * gr * gr / (R * R) : 0;

    // ---------------- brakes (bias per car), ABS per wheel; handbrake on the rear
    const brakeIn = this.reverse ? thrIn : brk;
    const Fbrake = brakeIn * sp.brake * mu0 * this.m * G * 1.15;
    const bias = sp.bias ?? 0.65;
    const hbF = inp.handbrake ? this.m * G * 0.45 : 0; // per rear wheel (Coulomb: also holds the car at rest)

    // ---------------- per-wheel tyres
    const sinD = Math.sin(delta), cosD = Math.cos(delta);
    const mw = J_WHEEL / (R * R);
    const S = this._S || (this._S = Array.from({ length: 4 }, () => ({ vgx: 0, vgy: 0, vref: 1, kx: 0, Fb: 0, sg: 0, G: 0, p: 0, c: 1, s: 0, brk: 0, d: 0 })));
    const tyre = (i, vw, out) => {
      const Wc = C4[i], Si = S[i];
      const kap = (vw - Si.vgx) / Si.vref;
      const sx = kap / this.kPk, sy = Math.tan(Wc.aDyn) / Math.tan(this.aPk);
      const sN = Math.hypot(sx, sy);
      let f;
      if (sN < 1) f = Math.sin(this.mfC * Math.atan(this.mfB * sN));
      else {
        f = 1 - (1 - this.slideK) * (1 - Math.exp(-(sN - 1) * 1.6));
        // past the peak the rubber is sliding and friction keeps falling with sliding speed: once a tyre lets go it
        // stays gone until the torque eases (taller gear, more speed), then it hooks up again
        const vs = Math.hypot(vw - Si.vgx, Si.vgy);
        f *= 1 - this.slideV * (1 - Math.exp(-vs / 7)) * Math.min(1, (sN - 1) * 2);
      }
      const k = sN > 1e-6 ? f / sN : this.slope0;
      out.Fx = cap[i] * this.muX * k * sx; out.Fy = -cap[i] * k * sy; out.sx = sx; out.sy = sy; out.sN = sN;
      return out;
    };
    const tt = this._tt || (this._tt = { Fx: 0, Fy: 0, sx: 0, sy: 0, sN: 0 });
    this.absOn = false;
    for (let i = 0; i < 4; i++) {
      const Wc = C4[i], Si = S[i], front = i < 2;
      // contact-patch velocity: body velocity plus yaw rate x lever arm, then into the wheel frame
      const vxp = vx - this.w * cy[i], vyp = vy + this.w * cx[i];
      const c = front ? cosD : 1, s_ = front ? sinD : 0;
      Si.c = c; Si.s = s_;
      Si.vgx = vxp * c + vyp * s_; Si.vgy = -vxp * s_ + vyp * c;
      // slip angle with relaxation length (~0.45 m)
      const aT = Math.atan(Si.vgy / Math.max(Math.abs(Si.vgx), 1.0));
      Wc.aDyn += (aT - Wc.aDyn) * Math.min(1, (Math.hypot(Si.vgx, Si.vgy) + 1.5) * dt / 0.45); // patch speed, so it stays quick sideways
      Si.vref = Math.max(Math.abs(Si.vgx), 3);
      // implicit wheel-speed update linearises the tyre around the current slip with its steepest slope
      Si.kx = cap[i] * this.muX * this.slope0 / (this.kPk * Si.vref);
      Si.p = dt / (mw + dt * Si.kx);
      Si.brk = (front ? Fbrake * bias : Fbrake * (1 - bias)) * 0.5;
      Si.Fb = Si.brk * Wc.abs + (front ? 0 : hbF + this.rearDrag * cap[i]) + Wc.esc + Wc.edl;
      Si.sg = Math.abs(Wc.vw) > 1e-3 ? Math.sign(Wc.vw) : 0;
      Si.G = -tyre(i, Wc.vw, tt).Fx - Si.Fb * Si.sg;
    }
    // per axle: half shafts L / R joined by the differential. Implicit Euler for the two wheel speeds with
    //   (mw + dt kx_i) dv_i = dt (Fd/2 +- Lk/2 + G_i)          (open diff: equal force to each side)
    //   Fd = Feng - Jeq (dv_L + dv_R) / (2 dt)                  (engine inertia on the carrier, clutch locked)
    // Lk is the LSD locking force: whatever would equalise the two sides, capped at lsd |Fd| (Coulomb clutch).
    const solveAxle = (iL, iR, Feng, Je, lsd) => {
      const A = S[iL], B = S[iR], pL = A.p, pR = B.p;
      const K = 1 + Je * (pL + pR) / (4 * dt);
      const sol = (Lk) => {
        const Fd = (Feng - Je / (2 * dt) * ((pL - pR) * Lk / 2 + pL * A.G + pR * B.G)) / K;
        A.d = pL * (Fd / 2 + Lk / 2 + A.G); B.d = pR * (Fd / 2 - Lk / 2 + B.G);
        return Fd;
      };
      const Fd0 = sol(0);
      if (lsd > 0) {
        const g0 = C4[iL].vw + A.d - C4[iR].vw - B.d;
        sol(1);
        const g1 = C4[iL].vw + A.d - C4[iR].vw - B.d;
        const capL = lsd * Math.abs(Fd0);
        sol(clamp(g1 !== g0 ? -g0 / (g1 - g0) : 0, -capL, capL));
      }
    };
    const lsdF = sF > 0 ? this.lsd : 0, lsdR = sR > 0 ? this.lsd : 0;
    solveAxle(0, 1, (Fdrive + nitroF) * sF, Jeq * sF, lsdF);
    solveAxle(2, 3, (Fdrive + nitroF) * sR, Jeq * sR, lsdR);
    // brakes are Coulomb friction: they can stop a wheel but never spin it backwards
    for (let i = 0; i < 4; i++) {
      const Wc = C4[i], Si = S[i];
      let v = Wc.vw + Si.d;
      if (Si.sg !== 0) { if (Math.sign(v) !== Si.sg) v = 0; }
      else if (Si.Fb > 0) { const dvb = Si.p * Si.Fb; v = Math.abs(Si.d) <= dvb ? 0 : Si.d - Math.sign(Si.d) * dvb; }
      Wc.vw = v;
    }
    let FxB = 0, FyB = 0, Mz = 0, maxSpin = 0, maxLock = 0, skid = 0;
    const dirD = this.reverse ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      const Wc = C4[i], Si = S[i];
      const t1 = tyre(i, Wc.vw, tt);
      // ABS: back the pressure off while this wheel is past peak slip under braking
      // slip is signed along the wheel's x axis: spin / lock are measured against the direction of drive / travel
      const sxT = t1.sx * (Si.vgx < 0 ? -1 : 1), sxD = t1.sx * dirD;
      // spec.abs = false: driver aids off
      if (sp.abs !== false && Si.brk > 0 && !(i >= 2 && hbF) && av > 2 && sxT < -1.15) { Wc.abs = Math.max(0.35, Wc.abs - dt * 9); this.absOn = true; }
      else Wc.abs = Math.min(1, Wc.abs + dt * 4);
      if ((i < 2 ? sF : sR) > 0) maxSpin = Math.max(maxSpin, sxD);
      maxLock = Math.max(maxLock, -sxT);
      skid = Math.max(skid, t1.sN);
      Wc.sx = t1.sx; Wc.sy = t1.sy; Wc.sN = t1.sN; Wc.Fx = t1.Fx; Wc.Fy = t1.Fy;
      // to the body frame; yaw moment about the CG (x forward, y right, positive = yaw right)
      const fx = t1.Fx * Si.c - t1.Fy * Si.s, fy = t1.Fx * Si.s + t1.Fy * Si.c;
      FxB += fx; FyB += fy; Mz += cx[i] * fy - cy[i] * fx;
    }
    // axle summaries (API: wheel[0] front, wheel[1] rear)
    for (let j = 0; j < 2; j++) {
      const A = this.wheel[j], L = C4[j * 2], Rr = C4[j * 2 + 1];
      A.vw = (L.vw + Rr.vw) * 0.5; A.aDyn = (L.aDyn + Rr.aDyn) * 0.5; A.abs = Math.min(L.abs, Rr.abs);
      A.sx = Math.abs(L.sx) > Math.abs(Rr.sx) ? L.sx : Rr.sx; A.sy = (L.sy + Rr.sy) * 0.5; A.sN = Math.max(L.sN, Rr.sN);
      A.Fx = L.Fx + Rr.Fx; A.Fy = L.Fy + Rr.Fy; A.Fz = L.Fz + Rr.Fz;
    }

    // ---------------- front-drive drift: the rear tyres have no drive torque to keep them sliding, so a slid FWD car
    // straightens itself. A driver holds it sideways by dragging the rears (feathered handbrake / left-foot braking)
    // just past their peak slip, which turns the rear force vector backwards and leaves less of it to resist the
    // slide; the front axle pulls the car through. Once you've committed (latched, sliding, on the power) the car does
    // that brake modulation for you, so throttle + counter-steer sustain the drift. Straighten up and it lets go.
    // (AWD: only the feint's dab, a nose-heavy AWD car understeers through a plain feint; once it's sliding the rear-biased
    // coupling holds it on the throttle)
    const flickDab = this.flickT > 0 && Math.sign(this.w) === Math.sign(inp.steer) && Math.abs(this.w) > 0.2;
    const dragWant = (sR === 0 || this.awd) && this.driftLatch > 0.5 && ((sR === 0 && sliding && thrIn > 0.15) || flickDab) && !inp.handbrake && !this.reverse;
    // like the driver's hand on the lever it feathers to hold the slide angle: more drag below the car's natural drift
    // angle, less above it, damped by how fast the angle is changing (steering + throttle still place the car)
    const ab = Math.abs(beta), dB = (ab - (this.lastAbsBeta ?? ab)) / dt;
    this.lastAbsBeta = ab;
    const eB = (sp.driftAngle ?? 0.45) - ab;
    if (dragWant) { this.dragI = clamp(this.dragI + dt * eB * 6, 0, 0.9); this.rearDrag = clamp(this.dragI + 2.5 * eB - 0.6 * dB, 0, 1.2); }
    else { this.dragI = Math.max(0, this.dragI - dt * 5); this.rearDrag = Math.max(0, this.rearDrag - dt * 5); }

    // ---------------- traction control (throttle cut), electronic diff lock (brake the spinning wheel of an
    // open diff so the other side can drive) and stability control (single-wheel braking); all relax once you
    // have deliberately unsettled the car
    // latched it becomes a drift mode, not "off": lots of wheelspin allowed, but a runaway (spinning faster and faster
    // as the sliding rubber loses grip) is still reined in, so steady throttle holds an angle instead of spinning
    const tcK = lerp(sp.tc ?? 0.5, 0.5, this.driftLatch);
    const spinOver = Math.max(0, maxSpin - lerp(1.6, sp.driftSpin ?? 4.5, this.driftLatch));
    this.tcCut = clamp(this.tcCut + (spinOver > 0 ? spinOver * tcK * 6 : -3) * dt, 0, 0.95 * Math.sqrt(tcK));
    // crawling in soft sand the traction control cuts as hard as it can, as real systems do on low grip (it's what
    // lets a car with its wheels spinning claw its way out rather than dig itself in)
    const tcSand = (this.surfSoft ?? 0) * (1 - smoothstep(3, 8, av));
    if (tcSand > 0.05 && spinOver > 0) this.tcCut = Math.min(0.92 * tcSand, Math.max(this.tcCut, this.tcCut + spinOver * 4 * tcSand * dt));
    const edlK = sp.edl ?? (this.lsd < 0.2 ? tcK : 0);
    for (let j = 0; j < 2; j++) {
      const L = C4[j * 2], Rr = C4[j * 2 + 1], driven = (j ? sR : sF) > 0;
      for (const [Wc, O, ci] of [[L, Rr, cap[j * 2]], [Rr, L, cap[j * 2 + 1]]]) {
        const ws = Wc.sx * dirD, os = O.sx * dirD;
        const ex = driven && edlK > 0 && thrRaw > 0.1 ? Math.max(0, ws - 1.3) * (ws > os + 0.4 ? 1 : 0) : 0;
        Wc.edl = ex > 0 ? Math.min(0.7 * ci, Wc.edl + dt * ci * 6 * ex * edlK) : Math.max(0, Wc.edl - dt * ci * 4);
      }
    }
    this.tcOn = this.tcCut > 0.05 || C4.some((c) => c.edl > 50);
    const escK = (sp.esc ?? 0.4) * (1 - 0.95 * this.driftLatch) * smoothstep(3, 10, vt);
    this.escOn = false;
    const wGrip = sp.grip * G / Math.max(5, vt);
    const wDes = clamp(vx * Math.tan(delta) / this.wb, -wGrip, wGrip);
    const over = this.w - wDes;
    let Mreq = 0;
    if (escK > 0 && Math.abs(beta) > 0.07 && Math.abs(this.w) > Math.abs(wDes) + 0.05) Mreq -= over * this.Iz * 14 * escK;
    // sideslip limiter: a car sliding sideways beyond what its driver can be expected to catch
    const bLim = 0.1 + 0.12 * (sp.drift ?? 1);
    if (escK > 0 && Math.abs(beta) > bLim) Mreq += (beta - Math.sign(beta) * bLim) * this.Iz * 30 * escK;
    const mMax = this.m * G * this.track * 0.6;
    Mreq = clamp(Mreq, -mMax, mMax);
    // braking a left wheel yaws the car left (Mz = -y Fx): oversteer is caught with the outer front wheel
    const t2 = this.track / 2;
    C4[0].esc = Mreq < 0 ? Math.min(0.9 * cap[0], -Mreq / t2) : 0;
    C4[1].esc = Mreq > 0 ? Math.min(0.9 * cap[1], Mreq / t2) : 0;
    C4[2].esc = C4[3].esc = 0;
    if (Math.abs(Mreq) > 1) { this.escOn = true; this.escCut = Math.min(0.9 * Math.min(1, escK * 2), this.escCut + dt * escK * 9); }
    else this.escCut = Math.max(0, this.escCut - dt * 2);

    // ---------------- aero / rolling resistance / grade, then integrate (body frame)
    const drag = 0.5 * RHO * sp.cdA * (this.dragMul ?? 1) * this.dmgDrag * vx * Math.abs(vx);
    const roll = 0.012 * W * Math.sign(vx) * Math.min(1, av * 4);
    const grade = this.gradeG ?? route.lin(route.GR, this.s);
    let ax = (FxB - drag - roll) / this.m - G * grade - (this.surfDrag ?? 0) * Math.sign(vx) * Math.min(1, av / 2);
    // ---------------- soft ground (sand above all). Wheels spinning in place dig ruts: they sink, lose grip and must
    // climb out of the hole they dug, so flooring it only digs deeper. digF / digB (0..1): the wall of sand piled in
    // front of / behind the wheels by spinning them forwards / in reverse. Rolling without wheelspin fills the ruts in
    // again: ease the throttle, or reverse out the way you came (into the shallow side) and have another go.
    const soft = this.surfSoft ?? 0;
    if (soft > 0) {
      let spinV = 0;
      for (let i = 0; i < 4; i++) { if ((i < 2 ? sF : sR) <= 0) continue; const d = C4[i].vw - S[i].vgx; if (Math.abs(d) > Math.abs(spinV)) spinV = d; }
      const sv = Math.abs(spinV), fill = dt * av * 0.4;
      const dig = dt * soft * 0.55 * clamp((sv - 2) / 5, 0, 1) * (1 - smoothstep(0.5, 3.5, av));
      if (spinV > 0) this.digF = Math.min(1, this.digF + dig * (1 - 0.7 * this.digB)); else this.digB = Math.min(1, this.digB + dig * (1 - 0.7 * this.digF)); // packed tracks dig less
      // deep loose sand (surfBow): crawling through it pushes a bow wave up in front of the tyres until it stops you;
      // the way back is over your own packed tracks, and rolling away leaves the ruts behind
      const pile = dt * av * (this.surfBow ?? 0) * (1 - smoothstep(3, 7, av));
      // (while the other side's bow wave is still there you are rolling back along your own tracks: no new pile)
      if (vx >= 0) { this.digF = Math.min(1, this.digF + pile * (1 - this.digB)); this.digB = Math.max(0, this.digB - fill); }
      else { this.digB = Math.min(1, this.digB + pile * (1 - this.digF)); this.digF = Math.max(0, this.digF - fill); }
    } else { this.digF = Math.max(0, this.digF - dt * 2); this.digB = Math.max(0, this.digB - dt * 2); }
    this.dig = Math.max(this.digF, this.digB);
    // Coulomb resistance: the surface's own (tyres sinking, bulldozing sand) plus the ruts'. At rest it holds the car
    // until the tyres push harder than it.
    let held = false;
    const push = av > 0.3 ? Math.sign(vx) : Math.sign(ax);
    const res = (this.surfRes ?? 0) + DIG_RES * (push >= 0 ? this.digF + 0.1 * this.digB : this.digB + 0.1 * this.digF);
    if (res > 0) {
      if (av > 0.3) ax -= Math.sign(vx) * res;
      else { const hold = res * 2.2; const stop = ax + vx / dt; if (Math.abs(stop) <= hold) { ax = -vx / dt; held = true; } else ax -= Math.sign(stop) * res; } // a car settled in sand takes more to break free
    }
    const ay = FyB / this.m;
    this.axRaw = held ? 0 : ax; this.ayRaw = ay;
    this.vLong += (ax + this.w * vy) * dt;
    this.vLat += (ay - this.w * vx) * dt;
    const kin = smoothstep(0.8, 3.2, vt);
    this.w += Mz / this.Iz * dt;
    // low speed: kinematic steering (tyre model is ill-conditioned when parking)
    if (kin < 1) {
      this.w = lerp(this.vLong * Math.tan(delta) / this.wb, this.w, kin);
      this.vLat = lerp(damp(this.vLat, 0, 10, dt), this.vLat, kin);
    }
    if (!this.reverse && Math.abs(this.vLong) < 0.05 && thrIn < 0.05 && brk > 0) this.vLong = 0;
    // at rest (|vLat| gate: a car sliding sideways passes through vLong = 0 and must not be stopped dead)
    if (Math.abs(this.vLong) < 0.03 && Math.abs(this.vLat) < 0.4 && thrRaw < 0.05) { this.vLong = 0; this.vLat *= 0.9; for (const Wc of C4) Wc.vw = 0; this.wheel[0].vw = this.wheel[1].vw = 0; }
    this.ax = damp(this.ax, ax, 10, dt); this.ay = damp(this.ay, ay, 10, dt);
    this.drift = Math.abs(beta) > 0.16 && vt > 12 ? Math.abs(beta) : 0;
    this.slipF = Math.abs(this.wheel[0].aDyn); this.slipR = Math.abs(this.wheel[1].aDyn);
    this.spin = clamp((maxSpin - 1) * 0.4, 0, 1);
    const vwMax = Math.max(Math.abs(C4[0].vw), Math.abs(C4[1].vw), Math.abs(C4[2].vw), Math.abs(C4[3].vw));
    this.wheelspin = clamp((maxSpin - 1.1) / 3, 0, 1) * smoothstep(0.5, 3, Math.max(av, vwMax));
    this.lockup = clamp((maxLock - 1.1) / 3, 0, 1) * smoothstep(1, 4, av);
    // tyre noise: scrub starts before the limit, squeal at and beyond peak slip
    this.skid = clamp((skid - 0.72) / 0.7, 0, 1.5) * smoothstep(2, 8, Math.max(av, vwMax));

    // ---------------- world motion
    this.yaw -= this.w * dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.x += (fx * this.vLong + rx * this.vLat) * dt;
    this.z += (fz * this.vLong + rz * this.vLat) * dt;

    // ---------------- road frame & walls (ground: hook point)
    // ground: the player's car can leave the road (pavement, dirt, hillside, sea); see ground.js
    const urb = route.urban(this.s);
    if (this.ground) this.ground.resolve(this, dt);
    else {
      const pr = route.project(this.x, this.z, this.s, 6);
      this.s = pr.s; this.u = pr.u;
      const lim = ROAD.limits(route, this.s, this._lim || (this._lim = {}));
      this.offroad = Math.abs(this.u) > route.edge(this.s) + 0.6 + this.halfW * 0.4 && urb < 0.5 ? 1 : 0;
      const f = route.frame(this.s, this._f || (this._f = {}));
      const hi = lim.max - this.halfW, lo = lim.min + this.halfW;
      if (this.u > hi || this.u < lo) {
        const side = this.u > hi ? 1 : -1;
        const pen = side > 0 ? this.u - hi : lo - this.u;
        this.x -= f.rx * pen * side; this.z -= f.rz * pen * side; this.u -= pen * side;
        const wvx = fx * this.vLong + rx * this.vLat, wvz = fz * this.vLong + rz * this.vLat;
        const vn = wvx * f.rx * side + wvz * f.rz * side;
        if (vn > 0) {
          const vt = wvx * f.tx + wvz * f.tz;
          const hit = Math.min(1, vn / 14);
          const keep = 1 - Math.min(0.35, vn * 0.025);
          const nvx = f.tx * vt * keep - f.rx * side * vn * 0.18, nvz = f.tz * vt * keep - f.rz * side * vn * 0.18;
          this.vLong = nvx * fx + nvz * fz; this.vLat = nvx * rx + nvz * rz;
          const roadYaw = Math.atan2(-f.tx, -f.tz);
          let dy = roadYaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
          if (Math.abs(dy) < 1.3) { this.yaw += dy * Math.min(0.5, 0.08 + hit * 0.6); this.w *= 1 - 0.5 * hit; }
          this.wallHit = Math.max(this.wallHit, vn);
          P.rollV += side * vn * 0.25; P.heaveV += vn * 0.05;
          this.wallSide = side;
          this.syncWheels();
        }
      }
      this.y = route.surfaceY(this.s, this.u);
      this.grade = f.grade; this.bank = f.bank;
    }

    // ---------------- suspension pose (visual + camera): springs per car, excited by the road
    const rollK = (sp.rollK ?? 1) * 0.0055, pitchK = (sp.pitchK ?? 1) * 0.0042;
    const kP = this.kS, cP = this.cS;
    const roadL = (this.roadZ(this.s + this.a, -1) + this.roadZ(this.s - this.b, -1)) * 0.5, roadR = (this.roadZ(this.s + this.a, 1) + this.roadZ(this.s - this.b, 1)) * 0.5;
    const roadF = (this.roadZ(this.s + this.a, -1) + this.roadZ(this.s + this.a, 1)) * 0.5, roadB = (this.roadZ(this.s - this.b, -1) + this.roadZ(this.s - this.b, 1)) * 0.5;
    const rollRoad = (roadR - roadL) / this.track * 0.6, pitchRoad = (roadF - roadB) / this.wb * 0.6;
    P.rollV += (kP * (-ayL * rollK + rollRoad - P.roll) - cP * P.rollV) * dt;
    P.pitchV += (kP * (axL * pitchK + pitchRoad - P.pitch) - cP * P.pitchV) * dt;
    P.heaveV += (kP * (roadAvg - P.heave) - cP * P.heaveV + clamp(-vx * vx * vcurv, -4, 4) * 0.25) * dt;
    P.roll = clamp(P.roll + P.rollV * dt, -0.13, 0.13); P.pitch = clamp(P.pitch + P.pitchV * dt, -0.09, 0.09); P.heave = clamp(P.heave + P.heaveV * dt, -0.08, 0.1);
    // bump events (for the sound and the camera): a sharp change in the road under the front wheels
    const cell = Math.floor((this.s + this.a) / 35);
    if (cell !== this.lastBumpCell) { this.lastBumpCell = cell; }
    const dz = Math.abs(roadF - (this.roadFPrev ?? roadF)) / Math.max(dt, 1e-4);
    this.roadFPrev = roadF;
    this.bumpHit = Math.max(this.bumpHit, clamp(dz * 0.06 - 0.02, 0, 1) * Math.min(1, av / 8));
    this.rough = (this.offroad ? 1 : 0.25 + 0.35 * (1 - urb)) * Math.min(1, av / 25);
  }
  /** Opt-in sequential manual box; existing clutch, shift time and fuel-cut limiter remain in charge. */
  setManual(enabled) { this.manual = !!enabled; }
  shiftManual(direction) {
    if (!this.manual || this.reverse || this.shiftT > 0 || this.shiftCool > 0 || !direction) return false;
    const g = this.gear + Math.sign(direction), sp = this.spec;
    if (g < 1 || g > sp.gears.length) return false;
    // Reject a downshift that would mechanically over-rev the engine, even with the fuel cut active.
    const c = this.corners, vw = (c[0].vw + c[1].vw) * 0.5 * (1 - this.shareR) + (c[2].vw + c[3].vw) * 0.5 * this.shareR;
    if (g < this.gear && Math.abs(vw / sp.wheelR * this.ratio(g) * 60 / (2 * Math.PI)) > sp.redline) return false;
    this.shift(g, (sp.shiftT ?? 0.15) * (g < this.gear ? 0.7 : 1));
    return true;
  }
  shift(g, t) {
    this.shiftEvent = g > this.gear ? 1 : -1;
    this.pendingGear = g; this.shiftT = t; this.shiftCool = t + 0.35;
  }
  applyImpulse(jx, jz, yawKick = 0) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const dvx = jx / this.m, dvz = jz / this.m;
    this.vLong += dvx * fx + dvz * fz; this.vLat += dvx * rx + dvz * rz;
    this.w += yawKick;
  }
  /** world transform for the visual model */
  place(obj) {
    obj.position.set(this.x, this.y, this.z);
    obj.rotation.set(Math.atan(this.grade || 0), this.yaw, 0, 'YXZ');
    obj.rotation.z = Math.atan(this.bank || 0);
  }
}
