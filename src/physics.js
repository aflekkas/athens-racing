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
import { damageIncrement, equivalentBarrierSpeed } from './damage-math.js';
import { ROAD } from './road.js';
import { carTransmission, manualMode } from './transmission.js';
import { ENGINE_ABUSE, resetEngineAbuse, predictedGearRpm, shiftFeedback, updateMechanicalOverrev, updateManualHeat, engineWearFactor } from './engine-abuse.js';
import { wetBaseGrip, wetTyreScale, wetPeakScale } from './wet-grip.js';
import { suspensionRoadInput } from './suspension-road-input.js';
import { tyreTelemetry } from './tyre-telemetry.js';

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
const DIG_RES = 0.09 * 9.81; // m/s^2 of extra resistance with the wheels dug in to the hubs (dig = 1): about what spinning tyres still push

export class Vehicle {
  constructor(spec, route) {
    this.route = route;
    this.setSpec(spec);
    this.manual = !!spec.manual;
    this.reset(0, 0);
  }
  setSpec(spec) {
    this.spec = spec;
    if (this.playerGearbox) this.manual = manualMode(spec, this.manualPreference);
    if (spec.nitrous !== true) { this.nitro = 0; this.nitroOn = false; }
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
    this.slideLong = clamp(1 - (C - 1.3) * 0.9, 0.62, 0.95);
    this.slideK = spec.slideGrip ?? clamp(1 - (C - 1.3) * 0.5, 0.78, 0.97);
    this.slope0 = C * this.mfB; // d f / d s at the origin (the steepest point of the curve)
    this.lsd = spec.lsd ?? this.eng.lsd ?? 0;
    // friction ellipse: a tyre's driving / braking peak is ~10% above its cornering peak (longer contact-patch
    // footprint along the rolling direction); sets launch traction and stopping distances
    this.muX = spec.muX ?? 1.1;
    this.slideV = spec.slideV ?? 0.09; // progressive friction loss at high sliding speed (spinning / locked rubber)
    // suspension natural frequency -> spring / damper per unit mass (kS / cS: legacy, kept for external readers)
    const wn = 2 * Math.PI * (spec.susHz ?? 1.8);
    this.kS = wn * wn; this.cS = 2 * (spec.susZ ?? 0.45) * wn;
    // wheel positions (body frame: x forward, y right): FL, FR, RL, RR
    const t2 = this.track / 2;
    this.cx = [this.a, this.a, -this.b, -this.b]; this.cy = [-t2, t2, -t2, t2];
    this.setupSuspension();
    // compliance / roll understeer: bushes, the steering column and roll steer let the front wheels yield in proportion
    // to the front axle's lateral force. Sets the steady-state understeer gradient (deg of steer per g; real road cars
    // ~1-4: nose-heavy hatches the most, rear-engined cars the least), on top of the tyres' own ~0.3-0.5
    // (default from the weight split: nose-heavy cars are set up with more of it; spec.usGrad overrides)
    const usG = spec.usGrad ?? clamp(0.8 + (fw - 0.39) * 8.5, 0.6, 3);
    // (the tyres alone give ~0.45 deg/g on a nose-heavy car, slightly less than nothing on a tail-heavy one)
    this.kComp = Math.max(0, usG - 0.45 + 4.5 * Math.max(0, 0.5 - fw)) / 57.3; // rad of road-wheel angle per g of front-axle force
    this.gripR = spec.gripRear ?? 1;                                     // rear tyres vs front (staggered sizes)
    this.damageFx();
  }
  reset(s, u, speed = 0) {
    const f = this.route.contactFrame?.(s, u, {}) || this.route.frame(s, {});
    const p = this.route.point(s, u);
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.yaw = Math.atan2(-f.tx, -f.tz); // forward = (-sin yaw, -cos yaw)
    this.vLong = speed; this.vLat = 0; this.w = 0;
    this.s = s; this.u = u;
    this.gear = 1; this.rpm = this.spec.idle; this.shiftT = 0; this.shiftCool = 0; this.pendingGear = 0; this.clutch = 1;
    this.steer = 0; this.slipF = 0; this.slipR = 0; this.spin = 0; this.ax = 0; this.ay = 0;
    this.nitro = this.spec.nitrous === true ? 0.35 : 0; this.nitroOn = false;
    this.pose = { roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0 };
    this.resetSuspension(); this.wheelBump = null;
    this.wheelMu = this.wheelPeak = this.wheelSlide = this.wheelSlideV = null;
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
    this.shiftEvent = 0; this.gearChangeEvent = null; this.bumpHit = 0; this.rough = 0; this.absOn = false; this.tcOn = false; this.escOn = false;
    this.skid = 0; this.wheelspin = 0; this.lockup = 0; this.lastV = speed; this.lastBumpCell = -1; this.kickT = 0; this.wasDeclutched = false; this.rearDrag = 0; this.dragI = 0; this.flickT = 0; this.bigSteerT = 9; this.bigSteerSide = 0; this.shareR = this.shareR0; this.powerT = 0; this.burnout = false; this.burnoutPrimed = false; this.handbrakeInput = false;
    this.damage = { front: 0, rear: 0, left: 0, right: 0 }; this.smoke = false; this.lastDamage = null;
    this.damageFx();
  }
  get tyreTelemetry() { return tyreTelemetry(this); }
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
  // ---------------- capability API (for the AI planner): what this car can do on a flat, dry road, from the same tyre,
  // load-transfer, brake and engine model the sim runs. m/s^2; the planner adds grade itself. Stable signatures.
  /** steady-state tyre capacity of one axle (N) with lateral transfer dLat across it and an axle load Fz */
  _axleCap(Fz, dLat, front) {
    const sp = this.spec, ls = sp.loadSens ?? 0.15, Fz0 = this.m * G * 0.25, mu0 = sp.grip * (front ? 1 : this.gripR) * wetBaseGrip('asphalt'); // live wet grip: rivals plan earlier braking / slower bends
    const c = (fz) => { fz = Math.max(0, fz); return mu0 * fz * Math.max(0.4, 1 - ls * (fz / Fz0 - 1)); };
    return c(Fz / 2 + dLat / 2) + c(Fz / 2 - dLat / 2);
  }
  /** max steady cornering acceleration at speed v (m/s): the first axle to saturate sets it */
  maxLatAccel(v = 20) {
    const sp = this.spec, m = this.m, fw = sp.frontW ?? 0.55, rsF = sp.rsF ?? 0.55;
    const DF = 0.5 * RHO * (sp.clA ?? 0) * v * v, aeroF = sp.aeroF ?? 0.45;
    let ay = sp.grip * G;
    for (let it = 0; it < 12; it++) {
      const dLat = m * ay * this.hcg / this.track;
      const cF = this._axleCap(m * G * fw + DF * aeroF, 2 * dLat * rsF, true), cR = this._axleCap(m * G * (1 - fw) + DF * (1 - aeroF), 2 * dLat * (1 - rsF), false);
      ay = 0.5 * ay + 0.5 * Math.min(cF / (m * fw), cR / (m * (1 - fw))) * 0.97;   // ~3% for the slip the tyres can't all hold at once
    }
    return ay;
  }
  /** max straight-line braking deceleration from speed v (m/s): grip with the weight thrown forward, brake bias, ABS */
  maxBrakeDecel(v = 20) {
    const sp = this.spec, m = this.m, fw = sp.frontW ?? 0.55, bias = sp.bias ?? 0.65;
    const DF = 0.5 * RHO * (sp.clA ?? 0) * v * v, aeroF = sp.aeroF ?? 0.45, drag = 0.5 * RHO * sp.cdA * v * v;
    const Fb = sp.brake * sp.grip * m * G * 1.15;
    let a = sp.grip * G;
    for (let it = 0; it < 12; it++) {
      const dLong = m * a * this.hcg / this.wb;
      const gF = this._axleCap(m * G * fw + DF * aeroF + dLong, 0, true) * this.muX, gR = this._axleCap(m * G * (1 - fw) + DF * (1 - aeroF) - dLong, 0, false) * this.muX;
      const abs = sp.abs === false ? 0.85 : 0.94;                     // ABS cycling (or locked wheels without it)
      a = 0.5 * a + 0.5 * ((Math.min(Fb * bias, gF) + Math.min(Fb * (1 - bias), gR)) * abs + drag) / m;
    }
    return a;
  }
  /** max straight-line acceleration at speed v (m/s) in a gear (default: the best one): traction or engine, less drag */
  maxDriveAccel(v = 20, gear = 0) {
    const sp = this.spec, m = this.m, fw = sp.frontW ?? 0.55, R = sp.wheelR, sR = this.shareR0;
    const drag = 0.5 * RHO * sp.cdA * v * v + 0.012 * m * G;
    const eng = (g) => { const rpm = v / R * this.ratio(g) * 30 / Math.PI; if (rpm > sp.redline * 1.01) return 0; const bo = this.boost; this.boost = 1; const T = this.torqueMax(Math.max(rpm, sp.idle * 1.5)); this.boost = bo; return T * this.ratio(g) * ETA / R; };
    let Fe = 0;
    if (gear) Fe = eng(gear); else for (let g = 1; g <= sp.gears.length; g++) Fe = Math.max(Fe, eng(g));
    if (v >= sp.vmax / 3.6) Fe = 0;
    let a = 0.5 * G;
    for (let it = 0; it < 12; it++) {
      const dLong = m * a * this.hcg / this.wb;
      const gF = this._axleCap(m * G * fw - dLong, 0, true) * this.muX * (sR < 1 ? 1 : 0), gR = this._axleCap(m * G * (1 - fw) + dLong, 0, false) * this.muX * (sR > 0 ? 1 : 0);
      const trac = sR === 0 ? gF : sR === 1 ? gR : Math.min(gF / (1 - sR), gR / sR);
      a = 0.5 * a + 0.5 * (Math.min(Fe, trac * 0.95) - drag) / m;
    }
    return a;
  }
  /** rack-limited road-wheel lock at speed v (rad) */
  steerLockAt(v = 20) { return this.rackLock(v); }
  /** road-wheel angle (rad) that holds path curvature k (1/m) at speed v (m/s) in steady state: Ackermann plus the
   *  understeer gradient (tyres + compliance). Feed-forward for the AI */
  steerForCurvature(k, v = 20) { const ay = v * v * k; return this.wb * k + (this.kComp + 0.45 / 57.3) * ay / G; }
  /** normalised steer input (-1..1) that holds path curvature k (1/m) at speed v in steady state, with the car's current
   *  steering assist (steerAssist) and its live front-axle direction: the inverse of the input mapping in step() */
  steerInputFor(k, v = this.speed) {
    const sp = this.spec, ay = v * v * k, sg = Math.sign(k) || 1;
    const need = this.wb * k + (0.45 / 57.3) * ay / G;                 // effective road-wheel angle (the tyres' own gradient)
    const comp = this.kComp * ay / G;                                   // compliance the wheels will yield
    const A = clamp(this.steerAssist ?? 1, 0, 1) * smoothstep(4, 9, v), rack = this.rackLock(v);
    const thF = Math.atan2(this.vLat + this.a * this.w, Math.max(2, Math.abs(this.vLong)));
    const into = Math.max(1e-3, thF * sg + this.aPk * (sp.steerPk ?? 1) * wetPeakScale(this.surf));
    return clamp((need + comp * (1 - A)) / ((1 - A) * rack + A * into), -1, 1);
  }
  /** understeer gradient this car is set up with (deg / g) */
  get understeerGradient() { return this.kComp * 57.3 + 0.45; }

  /** rack-limited road-wheel lock (rad): full lock when parking, a slower ratio at speed */
  rackLock(av) { return this.spec.steer * (0.14 + 0.86 / (1 + av / 15)); }
  /** steering lock: full lock when parking; at speed, about what the front tyres can use (open-loop estimate, used for
   *  the cockpit wheel; the sim itself tracks the front tyres' peak slip, see step) */
  lockAt(av) {
    const sp = this.spec;
    const raw = sp.steer * (0.14 + 0.86 / (1 + av / 15));
    const grip = this.wb * sp.grip * G / Math.max(1, av * av) + this.aPk * 1.25;
    return Math.min(raw, grip);
  }

  /** Crash energy uses closing speed, never delta-v twice. Traffic sev is closing speed, dv gates
   * approaching impulses; direct wall calls pass closing speed as dv. Contact vectors use visual-car
   * coordinates (x right, y up, -z front). Four replay zone totals retain their original [0, 1] format. */
  addDamage(zone, dv, e = {}) {
    zone = zone || e.zone;
    dv = +(dv ?? e.dv);
    const vc = typeof e.sev === 'number' ? e.sev : dv;
    if (!Number.isFinite(dv) || !(dv > 0) || !Number.isFinite(vc) || !(vc > 0) ||
        !Object.hasOwn(this.damage, zone)) return 0;
    const ebs = equivalentBarrierSpeed(vc, this.m,
      e.car ? (e.car.mass ?? (e.heavy ? 12000 : this.m)) : undefined, { rigid: e.kind === 'wall' });
    const inc = damageIncrement(ebs, zone);
    if (inc <= 0) return 0;
    this.damageFx(); // initialise caches after reset before applying corner-local damage
    this.damage[zone] = Math.min(1, this.damage[zone] + inc);
    const vector = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.z)
      ? { x: v.x, y: Number.isFinite(v.y) ? v.y : 0, z: v.z } : undefined;
    const point = vector(e.localPoint), normal = vector(e.localNormal);
    const bend = smoothstep(5, 22, ebs); // ordinary parking taps never bend suspension
    for (let i = 0; i < 4; i++) {
      let exposure;
      if (point) {
        const dx = point.x - this.cy[i], dz = point.z + this.cx[i];
        exposure = Math.exp(-(dx * dx + dz * dz) / (2 * 0.95 * 0.95));
      } else {
        exposure = zone === 'front' ? (i < 2 ? 0.75 : 0.03) : zone === 'rear' ? (i > 1 ? 0.75 : 0.03)
          : (i % 2 === (zone === 'right' ? 1 : 0) ? (i < 2 ? 0.9 : 0.5) : 0.015);
      }
      this.cornerDamage[i] = Math.min(1, this.cornerDamage[i] + bend * exposure);
    }
    this.maxImpactEbs = Math.max(this.maxImpactEbs, ebs);
    const engineZone = this.spec.engineZone || 'front';
    // A very large engine-bay strike can stall; a 100 km/h barrier impact ends the race in any direction.
    if ((zone === engineZone && ebs >= 75 / 3.6) || ebs >= 100 / 3.6) this.engineStalled = true;
    // No random source: an uncommon structural failure on enormous impacts remains deterministic in replay.
    const failureKey = Math.round(ebs * 10) + Math.round((point?.x || 0) * 100) * 3 +
      { front: 11, rear: 23, left: 37, right: 53 }[zone];
    if (ebs >= 115 / 3.6 && hash(failureKey) < 0.12) this.drivetrainBroken = true;
    this.lastDamage = { zone, inc, ebs, kind: e.kind, localPoint: point, localNormal: normal,
      serial: this._damageSerial = (this._damageSerial || 0) + 1 };
    this.damageFx();
    return inc;
  }

  /** Bounded corner alignment, delayed cooling failure, and light intermittent steam. Call once per step
   * with dt; zero-dt calls apply new damage without advancing thermal / wobble time. */
  damageFx(dt = 0) {
    const d = this.damage || { front: 0, rear: 0, left: 0, right: 0 };
    if (this._damageState !== this.damage || !this.cornerDamage) {
      this._damageState = this.damage;
      // Legacy/replay totals have no contact history; give them a conservative axle/side reconstruction.
      this.cornerDamage = [0, 1, 2, 3].map(i => clamp((i < 2 ? d.front : d.rear) * 0.25 +
        (i % 2 ? d.right : d.left) * 0.3, 0, 1));
      this.coolantTemp = 90; this.radiatorDamage = 0; this.maxImpactEbs = 0;
      this.engineStalled = false; this.drivetrainBroken = false;
      resetEngineAbuse(this); // Vehicle.reset/tow replaces damage and fully repairs engine abuse too.
      this._damageClock = 0; this._damageWheelPhase = 0;
    }
    const h = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    const av = Number.isFinite(this.vLong) ? Math.abs(this.vLong) : 0;
    this._damageClock += h;
    this._damageWheelPhase = (this._damageWheelPhase + h * av / Math.max(0.2, this.spec.wheelR || 0.33)) % (Math.PI * 2);
    this.radiatorDamage = Math.max(this.radiatorDamage, smoothstep(0.42, 0.95, d.front));
    const heatRate = this.engineStalled ? -0.6 : this.radiatorDamage * (1.2 + 0.9 * clamp(this.load || 0, 0, 1));
    this.coolantTemp = clamp(this.coolantTemp + h * (heatRate - (1 - this.radiatorDamage) *
      Math.max(0, this.coolantTemp - 90) * (0.025 + av * 0.001)), 90, 145);
    updateManualHeat(this, h);
    const thermalLoss = smoothstep(112, 140, this.coolantTemp);
    if (this.coolantTemp >= 142) this.engineStalled = true;
    const wearFactor = engineWearFactor(this);
    this.engHealth = this.engineStalled || this.drivetrainBroken ? 0 : clamp(1 -
      0.45 * smoothstep(0.35, 1, d[this.spec.engineZone || 'front']) - 0.65 * thermalLoss, 0.08, 1) * wearFactor;
    const c = this.cornerDamage;
    this.wheelWobble = 0.002 * Math.max(c[0], c[1]) * Math.sin(this._damageWheelPhase) * smoothstep(1, 8, av);
    this.toePull = clamp(0.04 * (c[1] - c[0]) + 0.015 * (c[3] - c[2]) + this.wheelWobble, -0.055, 0.055);
    this.wheelCamber ||= [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) this.wheelCamber[i] = (i % 2 ? -1 : 1) * c[i] * 0.22;
    this.dmgDrag = 1 + 0.14 * Math.max(d.front, d.rear) + 0.08 * Math.max(d.left, d.right) + 0.1 * Math.max(...c);
    // A ruptured hot radiator emits little intermittent vapour, never a perpetual white exhaust plume.
    const pulse = Math.max(0, Math.sin(this._damageClock * 2.3) - 0.3) / 0.7;
    this.steamAmount = 0.18 * this.radiatorDamage * smoothstep(104, 120, this.coolantTemp) * pulse;
    this.smoke = this.steamAmount > 0.005;
    this.damageSignificant = Math.max(d.front, d.rear, d.left, d.right) > 0.24;
  }

  /**
   * Suspension: a sprung body (heave z, pitch th nose-up, roll ph right-side-up) on four corners, each a coil spring
   * with bump / rebound damping and a bump stop, an anti-roll bar per axle, and an unsprung wheel (mu kg) riding on
   * its own tyre spring. Everything is in deviations from static ride height, so at rest it sits still. Lateral and
   * longitudinal load transfer come out of it: the inertial moments m ay h / m ax h act on the body (less the share
   * the suspension geometry carries straight to the tyres: roll centre / anti-dive-squat, which acts at once), the
   * body rolls / pitches against the springs and bars, and the tyre loads follow. Roll stiffness splits between the
   * axles as spec.rsF says, so the old balance tuning still holds; the total from spec.rollGrad (deg/g).
   * Road inputs (texture, bumps, kerbs) act on each tyre's contact patch, low-passed over the patch length (a tyre
   * envelops a sharp edge), never on the body directly.
   */
  setupSuspension() {
    const sp = this.spec, m = this.m, fw = sp.frontW ?? 0.55, t = this.track;
    const mu = this.mUns = sp.unsprung ?? clamp(m * 0.027, 30, 48);   // per corner: wheel, tyre, hub, brake, half the links
    const ms = this.mSpr = m - 4 * mu;
    this.Ixx = ms * (this.halfW * 0.72) ** 2;                          // roll inertia of the body
    this.Iyy = ms * (this.halfL * 0.62) ** 2;                          // pitch inertia
    const fF = sp.rideF ?? (sp.susHz ?? 1.8), fR = sp.rideR ?? (sp.susHz ?? 1.8) * 1.08; // flat ride: rear a touch stiffer
    const msF = ms * fw / 2, msR = ms * (1 - fw) / 2;                  // sprung mass per corner
    const kF = (2 * Math.PI * fF) ** 2 * msF, kR = (2 * Math.PI * fR) ** 2 * msR;
    this.kSpr = [kF, kF, kR, kR];
    // damping: a road car runs ~0.25-0.3 of critical in bump and ~0.5-0.7 in rebound (spec.susZ ~ the average)
    const z = sp.susZ ?? 0.45, zB = z * 0.65, zR = z * 1.35;
    this.cBump = this.kSpr.map((k, i) => 2 * zB * Math.sqrt(k * (i < 2 ? msF : msR)));
    this.cReb = this.kSpr.map((k, i) => 2 * zR * Math.sqrt(k * (i < 2 ? msF : msR)));
    // roll stiffness: total from the roll gradient (deg/g; legacy rollK 1 ~ 3.1 deg/g), split by rsF; the bars make
    // up whatever the springs don't (k t^2 / 2 per axle from the springs, kb t^2 from a bar acting on dL - dR)
    this.rcK = sp.rollCentre ?? 0.12;                                 // share of the roll moment the roll centres carry
    const grad = (sp.rollGrad ?? 3.1 * (sp.rollK ?? 1)) / 57.3;        // rad per g
    // (stiff springs alone may exceed an axle's share: then the car is stiffer in roll than asked, but the split
    // between the axles, the balance, stays rsF)
    // the tyres are springs in series with each axle's springs + bar, so size the suspension for the target
    // including them: series(Ksusp, Ktyre) per axle
    const ktR = (sp.tyreK ?? 240e3) * t * t / 2;                       // one axle's two tyres in roll
    const ser = (a, b) => a * b / (a + b), inv = (Ke) => Ke < ktR * 0.95 ? 1 / (1 / Ke - 1 / ktR) : ktR * 19;
    const rsF = sp.rsF ?? 0.55, KsF = kF * t * t / 2, KsR = kR * t * t / 2;
    const Kphi = Math.max(ms * G * this.hcg * (1 - this.rcK) / grad, ser(KsF, ktR) / rsF, ser(KsR, ktR) / (1 - rsF)) * 1.02;
    const kbF = Math.max(0, (inv(rsF * Kphi) - KsF) / (t * t)), kbR = Math.max(0, (inv((1 - rsF) * Kphi) - KsR) / (t * t));
    this.rollGradEff = ms * G * this.hcg * (1 - this.rcK) / Kphi * 57.3; // deg/g actually achieved (body on the tyres)
    this.kBar = [kbF, kbR];
    this.antiPitch = sp.antiPitch ?? 0.3;                              // anti-dive / anti-squat share of pitch transfer
    // tyre: vertical stiffness ~ 200-280 N/mm for these sizes, a little damping
    const kt = this.kTyre = sp.tyreK ?? 240e3;
    this.cTyre = 2 * 0.06 * Math.sqrt(kt * mu);
    this.travel = sp.travel ?? 0.075;                                  // bump travel to the bump stop (m)
    // static loads: the tyre carries its corner's sprung share plus the wheel itself; the spring only the sprung share
    this.Fs0 = [msF * G, msF * G, msR * G, msR * G];
    this.Ft0 = this.Fs0.map((f) => f + mu * G);
  }
  resetSuspension() {
    this.sus = { z: 0, zv: 0, th: 0, thv: 0, ph: 0, phv: 0, zu: [0, 0, 0, 0], zuv: [0, 0, 0, 0], r: [0, 0, 0, 0], rv: [0, 0, 0, 0], d: [0, 0, 0, 0], Ft: this.Ft0.slice(), fresh: true };
  }
  /** put the suspension at rest on road inputs r[4]: wheels on them, the body on the plane they make */
  settleSuspension(r) {
    const S = this.sus, t = this.track;
    for (let i = 0; i < 4; i++) { S.r[i] = r[i]; S.rv[i] = 0; S.zu[i] = r[i]; S.zuv[i] = 0; S.d[i] = 0; S.Ft[i] = this.Ft0[i]; }
    S.z = (r[0] + r[1] + r[2] + r[3]) / 4;
    S.th = ((r[0] + r[1]) - (r[2] + r[3])) / 2 / this.wb;
    S.ph = ((r[1] + r[3]) - (r[0] + r[2])) / 2 / t;
    S.zv = S.thv = S.phv = 0; S.fresh = false;
  }
  /** an outside shove to the body (walls, landings): velocity changes in heave (m/s), pitch and roll (rad/s) */
  bodyKick(heave = 0, pitch = 0, roll = 0) {
    const S = this.sus; if (!S) return;
    S.zv += clamp(heave, -3, 3); S.thv += clamp(pitch, -3, 3); S.phv += clamp(roll, -4, 4);
  }
  /**
   * Integrate the suspension over dt (n substeps). ax / ay: body-frame accelerations (ay > 0 turning right);
   * gEff: effective gravity / g (crests < 1, dips > 1); rIn[i]: road height under each contact patch relative to the
   * plane the car is placed on (m); patchV: speed the patch moves over the road (for the enveloping filter).
   * Writes each corner's tyre load Fz, wheel travel zu / compression d.
   */
  stepSuspension(dt, ax, ay, gEff, rIn, patchV) {
    const S = this.sus, mu = this.mUns, ms = this.mSpr, n = 4, h = dt / n;
    const cx = this.cx, cy = this.cy, k = this.kSpr, kt = this.kTyre, ct = this.cTyre, kb = this.kBar;
    const hEl = this.hcg * (1 - this.rcK), hP = this.hcg * (1 - this.antiPitch);
    const Mroll = ms * ay * hEl, Mpitch = ms * ax * hP, gx = G * (gEff - 1);
    // tyre enveloping: a wheel can't follow an edge faster than its own radius lets it roll over it. Onto a step of
    // height dh the hub rises along an arc over ~sqrt(2 R dh) of travel (0.28 m for a 12 cm kerb), never less than the
    // contact patch's ~0.15 m
    const Rw = this.spec.wheelR ?? 0.32, vP = Math.max(1, patchV);
    const Fs = this._Fs || (this._Fs = [0, 0, 0, 0]);
    for (let it = 0; it < n; it++) {
      for (let i = 0; i < 4; i++) {
        const r0 = S.r[i], tau = clamp(Math.max(0.15, Math.sqrt(2 * Rw * Math.abs(rIn[i] - r0))) / vP, 0.004, 0.08);
        S.r[i] += (rIn[i] - r0) * Math.min(1, h / tau); S.rv[i] = (S.r[i] - r0) / h;
      }
      // corner forces (deviation from static)
      for (let i = 0; i < 4; i++) {
        const zb = S.z + cx[i] * S.th + cy[i] * S.ph, zbv = S.zv + cx[i] * S.thv + cy[i] * S.phv;
        const d = S.zu[i] - zb, dv = S.zuv[i] - zbv;                   // compression (+) and its rate
        let f = k[i] * d + (dv > 0 ? this.cBump[i] : this.cReb[i]) * dv;
        if (d > this.travel) f += k[i] * 12 * (d - this.travel) + this.cBump[i] * 2 * Math.max(0, dv); // bump stop
        S.d[i] = d; Fs[i] = f;
      }
      for (let j = 0; j < 2; j++) { const fb = kb[j] * (S.d[j * 2] - S.d[j * 2 + 1]); Fs[j * 2] += fb; Fs[j * 2 + 1] -= fb; }
      // a spring can only push: fully extended, the wheel hangs from the body (droop)
      for (let i = 0; i < 4; i++) Fs[i] = Math.max(Fs[i], -this.Fs0[i]);
      let Fz = 0, My = 0, Mx = 0;
      for (let i = 0; i < 4; i++) {
        const tc = S.r[i] - S.zu[i], tcv = S.rv[i] - S.zuv[i];
        const Ft = Math.max(0, this.Ft0[i] + kt * tc + ct * tcv);     // tyre load: can't pull, the wheel can lift off
        S.Ft[i] = Ft;
        S.zuv[i] += ((Ft - this.Ft0[i]) - Fs[i] - mu * gx) / mu * h;
        S.zu[i] += S.zuv[i] * h;
        Fz += Fs[i]; My += cx[i] * Fs[i]; Mx += cy[i] * Fs[i];
      }
      S.zv += (Fz / ms - gx) * h; S.z += S.zv * h;
      S.thv += (My + Mpitch) / this.Iyy * h; S.th += S.thv * h;
      S.phv += (Mx + Mroll) / this.Ixx * h; S.ph += S.phv * h;
    }
    // tyre loads seen by the tyres: the elastic part (through the springs, just integrated) plus what the geometry
    // carries at once (roll centres, anti-dive / anti-squat)
    const m = this.m, dLat = m * ay * this.hcg * this.rcK / this.track, dLong = m * ax * this.hcg * this.antiPitch / this.wb, rsF = this.spec.rsF ?? 0.55;
    const C4 = this.corners;
    for (let i = 0; i < 4; i++) {
      const geo = (i < 2 ? -dLong : dLong) / 2 + (cy[i] < 0 ? 1 : -1) * dLat * (i < 2 ? rsF : 1 - rsF);
      C4[i].Fz = Math.max(0, S.Ft[i] + (S.Ft[i] > 0 ? geo : 0));
      C4[i].zu = S.zu[i]; C4[i].travel = S.d[i];
    }
    // the visual body pose (vehicle-models.js / camera), legacy signs: pitch > 0 nose up, roll < 0 leaning out of a
    // right-hander
    const P = this.pose;
    P.heave = S.z; P.pitch = S.th; P.roll = -S.ph; P.heaveV = S.zv; P.pitchV = S.thv; P.rollV = -S.phv;
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
    // fine texture: ~1 mm at metre wavelengths (real asphalt; anything bigger at ~1 m would sit right on the wheel-hop
    // resonance at town speeds and make every tyre chatter), a little more at car-length waves
    let z = 0.0008 * Math.sin(s * 2.31 + side) + 0.0022 * 0.4 * Math.sin(s * 0.83 + side * 0.7) + 0.0012 * Math.sin(s * 0.47 + side * 1.3);
    // patched asphalt: long, gentle undulations, rougher out of town on the cliff road
    z += (0.006 + 0.008 * (1 - urb)) * Math.sin(s * 0.21 + Math.sin(s * 0.047) * 2.5);
    // discrete events every ~35 m cell: expansion joints, manhole covers (in town), sunken patches
    const cell = Math.floor(s / 35), hs = hash(cell);
    if (hs < 0.45 && this.roadEvents !== false) { // (roadEvents = false: texture only, for tests)
      const at = cell * 35 + 5 + hash(cell + 0.5) * 25, w = hs < 0.15 ? 0.35 : 1.6;
      const d = (s - at) / w;
      if (Math.abs(d) < 1) z += (hs < 0.15 ? 0.012 : hs < 0.3 ? -0.014 : 0.01) * (0.5 + 0.5 * Math.cos(d * Math.PI)) * (side > 0 && hs < 0.3 ? 0.4 : 1);
    }
    // off the tarmac: a loose surface's ripples (a few mm: soft ground absorbs them; real humps come from ground.js as
    // wheel steps). The tyres ride over this now, so it is sized as a surface, not a camera wobble
    if (this.offroad) z += 0.004 * (Math.sin(s * 1.7 + side) + 0.6 * Math.sin(s * 4.3 + side * 3));
    return z;
  }

  step(dt, inp) {
    this.damageFx(dt);
    const sp = this.spec, route = this.route;
    const vx = this.vLong, vy = this.vLat, av = Math.abs(vx), vt = Math.hypot(vx, vy);
    const thrIn = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    const beta = Math.atan2(vy, Math.max(2, av));
    // Space / pad handbrake + deliberate throttle: FWD holds its rear brakes;
    // RWD / AWD use a front line-lock. At road speed the normal drift handbrake remains.
    const burnout = !!inp.handbrake && thrIn > 0.65 && brk < 0.2 && vt < 15 / 3.6 && !this.reverse;
    this.handbrakeInput = !!inp.handbrake;
    this.burnout = burnout;
    if (!burnout) this.burnoutPrimed = false;
    if (burnout) { this.tcCut = this.escCut = 0; for (const c of this.corners) c.edl = c.esc = 0; }

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
    // With aids on, throttle plus steering is a grip request. Power-only drift
    // entry requires TC off; handbrake and lift-off feints remain explicit entries.
    const rearAtLimit = this.shareR > 0 && Math.max(this.corners[2].sN, this.corners[3].sN) > 1.1 && Math.abs(beta) > 0.12 && vt > 6;
    // With TC off, holding full power/lock for 0.4 s commits to power-over.
    const powerSlideAllowed = (sp.tc ?? 0.5) <= 0;
    const powerIntent = powerSlideAllowed && this.shareR > 0 && thrIn > 0.95 && Math.abs(sIn) > 0.9 && Math.max(this.corners[2].sN, this.corners[3].sN) > 1.0 && vt > 6;
    this.powerT = powerIntent ? (this.powerT ?? 0) + dt : 0;
    if (inp.handbrake && vt > 6) this.driftLatch = 1;
    else if (this.powerT > 0.4) this.driftLatch = Math.min(1, this.driftLatch + dt * 3);
    else if (powerSlideAllowed && rearAtLimit && thrIn > 0.8) this.driftLatch = Math.min(1, this.driftLatch + dt * 4);
    else if (this.driftLatch > 0 && sliding && thrIn > 0.5 && this.shareR > 0 && this.spin > 0.2) this.driftLatch = Math.min(1, this.driftLatch + dt * 3);
    // Counter-steer sustains an established deliberate drift; ordinary recovery
    // must not itself disable grip assists or start rear-brake drift holding.
    else if (this.driftLatch > 0 && sliding && Math.sign(sIn) === Math.sign(beta) && Math.abs(sIn) > 0.15 && this.w * beta < -0.02) this.driftLatch = Math.min(1, this.driftLatch + dt * 4);
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
    const rack = this.rackLock(vt);
    const raw = sIn * (rack + counter) + helper;
    // steering assist (digital input: keyboard / touch). The input range maps onto the angle that asks the front tyres
    // for their peak slip from the direction the front axle is actually travelling (thF): full input = all the grip the
    // fronts have, never more (past the peak they only scrub and plough); half input = half of it. Counter-steer maps
    // onto the same peak on the other side of thF, so in a slide full opposite lock catches it. steerAssist: 1 full,
    // ~0.35 light (analog stick / wheel: the driver can still over-drive the fronts), 0 off (raw rack ratio)
    const thF = Math.atan2(vy + this.a * this.w, Math.max(2, av)), aOpt = this.aPk * (sp.steerPk ?? 1) * wetPeakScale(this.surf);
    const into = Math.max(0, thF * Math.sign(sIn || 1) + aOpt);   // room towards the input side
    // compliance: the front axle's lateral force (as a share of its static load) bends the wheels back out of the turn
    const comp = this.kComp * clamp(this.wheel[0].Fy / (this.m * G * (sp.frontW ?? 0.55)), -1.5, 1.5);
    const assisted = clamp(sIn * into + comp + helper, -(rack + 0.5), rack + 0.5);
    // (mid-drift, latched, the driver wants the wheel more directly: the assist eases to half)
    const A = clamp(this.steerAssist ?? 1, 0, 1) * smoothstep(4, 9, vt) * (1 - 0.5 * this.driftLatch);
    let target = lerp(raw, assisted, A);
    // Light assist must still catch gross front-tyre over-driving. At road
    // speeds the raw rack can ask for twice peak slip, so blending it with
    // 35% assist alone makes full stick scrub away ~20% of lateral grip.
    // Leave a small amount of scrub for feedback, and release the guard for
    // deliberate slides / counter-steer or when the driver disables assist.
    const guard = clamp(this.steerAssist ?? 1, 0, 1) * smoothstep(4, 9, vt) * (1 - this.driftLatch);
    const catchingSlide = counter > 0 && sliding;
    if (guard > 0 && vx > 0 && !catchingSlide && target * sIn > 0) {
      const useful = Math.max(0, thF * Math.sign(sIn) + aOpt * 1.15 + comp * Math.sign(sIn));
      const excess = Math.max(0, Math.abs(target) - useful);
      target -= Math.sign(target) * excess * Math.min(1, guard / 0.35);
    }
    const rate = (sp.steerRate ?? 1) * (2.4 + 1.5 / (1 + vt / 10));
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const delta = this.steer + this.toePull - comp;   // bent steering after a side impact pulls the car

    // ---------------- normal loads: the suspension (see stepSuspension). Crests unload the car and dips load it
    // (vertical curvature of the real road); each contact patch rides over the road texture plus whatever ground.js
    // found under that wheel (kerbs, humps: wheelBump)
    const DF = 0.5 * RHO * (sp.clA ?? 0) * vx * vx, aeroF = sp.aeroF ?? 0.45;
    const contact = suspensionRoadInput(this, ROAD), gEff = contact.effectiveGravity;
    const W = this.m * G * gEff;
    const C4 = this.corners, cx = this.cx, cy = this.cy;
    const rIn = this._rIn || (this._rIn = [0, 0, 0, 0]), wb = this.wheelBump;
    // Texture is tied to the actual wheel's route coordinate. Turning across
    // the road must not march four wheels over fictitious fore/aft bumps.
    for (let i = 0; i < 4; i++) rIn[i] = this.roadZ(this.s + cx[i] * contact.along + cy[i] * contact.across, cy[i] < 0 ? -1 : 1) + (wb ? clamp(wb[i] || 0, -0.25, 0.3) : 0);
    const gradeNow = contact.grade;
    // first step after a reset / respawn / teleport: settle the car on the ground it was put on (wheels on their road
    // inputs, the body on the plane through them, at rest) instead of dropping it onto a kerb or median from flat.
    // With ground.js, wait until it has reported the wheels' ground (wheelBump)
    if (this.sus.fresh && (wb || !this.ground)) this.settleSuspension(rIn);
    this.stepSuspension(dt, clamp(this.axRaw + G * gradeNow, -16, 12), clamp(this.ayRaw, -16, 16), gEff, rIn, vt);
    for (let i = 0; i < 4; i++) C4[i].Fz += DF * (i < 2 ? aeroF : 1 - aeroF) / 2; // downforce straight onto the tyres
    const Fz0 = this.m * G * 0.25; // one nominal tyre load: lightly loaded tyres have the higher friction coefficient
    // Legacy headless sand grounds have no per-wheel data; retain their trap grip.
    const mu0 = sp.grip * (this.surfMu ?? 1) * (this.surf === 'sand' || this.surf === 'deepsand' ? 0.62 : 1);
    const ls = sp.loadSens ?? 0.15;
    // Surface owner: wetTyreScale is a separate multiplier after your dry per-wheel surface/traction hook.
    const cap = this._cap || (this._cap = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) { const fz = C4[i].Fz; cap[i] = Math.max(1, (this.wheelMu ? sp.grip * this.wheelMu[i] : mu0) * wetTyreScale(this, i) * (i < 2 ? 1 : this.gripR) * fz * Math.max(0.4, 1 - ls * (fz / Fz0 - 1))); }

    // ---------------- engine / gearbox
    const R = sp.wheelR, e = this.eng, red = sp.redline;
    // reverse is selected only once the car has actually stopped on the brake (not while still rolling forward)
    if (av < 0.1 && vt < 0.5 && brk > 0.5 && thrIn < 0.1) this.reverse = true;
    if (thrIn > 0.1 && this.reverse && vx > -0.8) this.reverse = false;
    const thrRaw = this.reverse ? brk : thrIn;
    this.engineThrottle = thrRaw;
    this.shiftT = Math.max(0, this.shiftT - dt); this.shiftCool = Math.max(0, this.shiftCool - dt);
    if (this.shiftT <= 0 && this.pendingGear) { this.gear = this.pendingGear; this.pendingGear = 0; }
    const sR = burnout && this.awd ? 1 : this.shareR, sF = 1 - sR;
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
    const holdGear = burnout || sR > 0 && (inp.handbrake || (this.driftLatch > 0.3 && Math.abs(beta) > 0.1)); // fwd: the box reads the (honest) front wheels
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
    const launchRpm = sp.idle + (red * (burnout ? 0.9 : sp.engine === 'diesel' ? 0.38 : 0.5) - sp.idle) * thrRaw;
    const shifting = this.shiftT > 0;
    const slipGear = this.reverse || this.gear === 1;
    // handbrake: the driver dips the clutch so the engine can't fight the locked rears (rwd / awd); revs flare on throttle
    const hbClutch = !!inp.handbrake && sR > 0 && !burnout;
    // Rev with the clutch dipped, then dump the stored flywheel momentum once.
    // This breaks traction on lower-torque FWD cars without adding engine power.
    const burnoutDump = burnout && !this.burnoutPrimed && this.rpm >= red * 0.8;
    if (burnoutDump) this.burnoutPrimed = true;
    const burnoutClutch = burnout && !this.burnoutPrimed;
    const engaged = !hbClutch && !burnoutClutch && !shifting && Math.abs(wheelRpm) > sp.idle * 0.9 && (!slipGear || Math.abs(wheelRpm) >= launchRpm * 0.98);
    this.clutch = engaged ? 1 : shifting || hbClutch || burnoutClutch ? 0 : clamp(Math.abs(wheelRpm) / Math.max(1, launchRpm), 0, 0.99);
    let rpmT = engaged ? Math.abs(wheelRpm) : hbClutch ? sp.idle + thrRaw * (red * 0.85 - sp.idle) : shifting ? (this.pendingGear ? Math.abs(vwD / R * this.ratio(this.pendingGear) * 60 / (2 * Math.PI)) : this.rpm) : launchRpm;
    if (shifting && this.pendingGear < this.gear && this.pendingGear) rpmT *= 1.05; // throttle blip
    rpmT = Math.max(rpmT, sp.idle);
    // clutch kick: letting the clutch out on a flared engine dumps its flywheel energy into the driven wheels
    if (engaged && this.wasDeclutched && this.rpm > Math.abs(wheelRpm) + 300) this.kickT = (this.rpm - Math.abs(wheelRpm)) * Math.PI / 30 * e.Je / 0.18;
    if (burnoutDump) this.kickT = Math.max(0, this.rpm - Math.abs(wheelRpm)) * Math.PI / 30 * e.Je / 0.18;
    this.wasDeclutched = hbClutch;
    this.kickT = Math.max(0, this.kickT - dt * this.kickT / 0.18);
    this.rpm = engaged ? Math.max(sp.idle, Math.abs(wheelRpm)) : damp(this.rpm, rpmT, shifting ? 18 : 9, dt);
    if (this.manual) this.rpm = Math.min(this.rpm, red * ENGINE_ABUSE.displayRatio);
    if (updateMechanicalOverrev(this, dt, wheelRpm, engaged)) this.damageFx();
    // limiter (fuel cut with hysteresis)
    if (this.rpm > red * 1.005) this.limiter = true; else if (this.rpm < red * 0.97) this.limiter = false;
    // traction control trims torque while the driven wheels spin
    const thr = thrRaw * (1 - this.tcCut) * (1 - this.escCut);
    let Te = this.torqueMax(this.rpm) * thr;
    // engine braking (pumping + friction) opposes the crank's rotation, whichever way the wheels drive it
    const Teb = sp.torque * (sp.ebrake ?? 0.15) * (0.25 + 0.75 * e_r) * Math.max(0, 1 - (this.manual && this.limiter ? 0 : thrRaw) * 4) * (wheelRpm < 0 ? -1 : 1);
    // A manual fuel cut closes the throttle for engine braking, letting revs fall
    // through hysteresis and bounce instead of hanging at the cut indefinitely.
    if (this.limiter) Te = 0;
    if (shifting) Te = 0;
    let Tnet = engaged ? Te - Teb + this.kickT : hbClutch || burnoutClutch ? 0 : Te * (shifting ? 0 : 1) + (burnout ? this.kickT : 0);
    this.engT = Tnet;
    this.load = clamp(Tnet / (sp.torque * (sp.powerMul ?? POWER_MUL)), -1, 1);
    // nitro: extra fuel and a squirt of shove
    if (sp.nitrous !== true) this.nitro = 0;
    this.nitroOn = sp.nitrous === true && !!inp.nitro && this.nitro > 0.01 && thrIn > 0.2 && !this.reverse;
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
    const hbF = inp.handbrake && !(burnout && sR > 0) ? this.m * G * 0.45 : 0;
    const lineF = burnout && sR > 0 ? this.m * G * 0.7 : 0; // per front wheel during a brake stand

    // ---------------- per-wheel tyres
    const sinD = Math.sin(delta), cosD = Math.cos(delta);
    const mw = J_WHEEL / (R * R);
    const S = this._S || (this._S = Array.from({ length: 4 }, () => ({ vgx: 0, vgy: 0, vref: 1, kx: 0, Fb: 0, sg: 0, G: 0, p: 0, c: 1, s: 0, brk: 0, d: 0 })));
    const tyre = (i, vw, out) => {
      const Wc = C4[i], Si = S[i];
      const kap = (vw - Si.vgx) / Si.vref;
      const peak = (this.wheelPeak?.[i] ?? 1) * wetPeakScale(this._wsurf?.[i] || this.surf);
      const sx = kap / (this.kPk * peak), sy = Math.tan(Wc.aDyn) / Math.tan(this.aPk * peak);
      const sN = Math.hypot(sx, sy);
      let f;
      if (sN < 1) f = Math.sin(this.mfC * Math.atan(this.mfB * sN));
      else {
        // Broaden lateral breakaway without changing locked-wheel stopping
        // distances or launch traction. Combined slip still shares one force
        // budget, and reverse keeps its existing parking/tyre behaviour.
        const lateral = vx > 0 ? sy * sy / (sN * sN) : 0;
        const looseSlide = this.wheelSlide?.[i] ?? lerp(this.slideLong, this.slideK, lateral);
        // Sustained brake-stand slip cooks the driven tread; kinetic grip falls,
        // while breakaway still uses the ordinary static peak.
        const slide = burnout && (i < 2 ? sF : sR) > 0 ? Math.min(looseSlide, 0.45) : looseSlide;
        f = 1 - (1 - slide) * (1 - Math.exp(-(sN - 1) * 1.6));
        // past the peak the rubber is sliding and friction keeps falling with sliding speed: once a tyre lets go it
        // stays gone until the torque eases (taller gear, more speed), then it hooks up again
        const vs = Math.hypot(vw - Si.vgx, Si.vgy);
        const slideV = this.wheelSlideV?.[i] ?? lerp(sp.slideV ?? 0.16, this.slideV, lateral);
        f *= 1 - slideV * (1 - Math.exp(-vs / 7)) * Math.min(1, (sN - 1) * 2);
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
      Si.kx = cap[i] * this.muX * this.slope0 / (this.kPk * (this.wheelPeak?.[i] ?? 1) * wetPeakScale(this._wsurf?.[i] || this.surf) * Si.vref);
      Si.p = dt / (mw + dt * Si.kx);
      Si.brk = (front ? Fbrake * bias : Fbrake * (1 - bias)) * 0.5;
      Si.Fb = Si.brk * Wc.abs + (front ? lineF : hbF + this.rearDrag * cap[i]) + Wc.esc + Wc.edl;
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
    // A locked tyre at walking pace has static friction, which the regularised
    // slip-ratio curve cannot represent at zero velocity. Let the held axle
    // react against the driven axle within its real contact-patch capacity.
    if (burnout) {
      const hold = sR > 0 ? [0, 1] : [2, 3];
      let existing = 0, capacity = 0;
      for (const i of hold) { existing += C4[i].Fx * S[i].c; capacity += cap[i] * this.muX * Math.abs(S[i].c); }
      const reaction = clamp(-(FxB - existing) - this.m * vx * 10, -capacity, capacity);
      FxB += reaction - existing;
      for (const i of hold) { const old = C4[i].Fx * S[i].c, force = reaction * cap[i] / (cap[hold[0]] + cap[hold[1]]); Mz -= cy[i] * (force - old); C4[i].Fx = force / S[i].c; }
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
    // (AWD / RWD: only the feint's dab, the rally driver's handbrake flick in the feint: a car with rear grip to spare
    // understeers through a plain feint; once it's sliding the throttle (rear-biased coupling on AWD) holds it)
    const flickDab = this.flickT > 0 && Math.sign(this.w) === Math.sign(inp.steer) && Math.abs(this.w) > 0.2;
    const dragWant = this.driftLatch > 0.5 && ((sR === 0 && sliding && thrIn > 0.15) || flickDab) && !inp.handbrake && !this.reverse;
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
    // A driven tyre shares one budget between steering and drive. Judge its
    // own combined slip rather than pairing max wheelspin with another tyre's
    // lateral demand. Applies to FWD, AWD and RWD; straight launches and explicit
    // handbrake/feint/aids-off drifts retain their existing slip thresholds.
    let combOver = 0, cornerDemand = 0;
    for (let i = 0; i < 4; i++) {
      const Wc = C4[i];
      if ((i < 2 ? sF : sR) <= 0) continue;
      const lateral = smoothstep(0.15, 0.6, Math.abs(Wc.sy));
      cornerDemand = Math.max(cornerDemand, lateral);
      if (Wc.sx * dirD <= 0.1) continue;
      // Slip angle is not force-linear: 0.6 of peak angle already asks for
      // ~0.94 of lateral peak. Reserve that force, not just the angle fraction.
      const fyDemand = Math.sin(this.mfC * Math.atan(this.mfB * Math.min(1, Math.abs(Wc.sy))));
      const sxBudget = Math.sqrt(Math.max(0.09, 1.05 ** 2 - fyDemand ** 2));
      const reserveOver = (Wc.sx * dirD - sxBudget) * smoothstep(0.9, 1.05, Wc.sN);
      combOver = Math.max(combOver, Math.max(Wc.sN - 1.05, reserveOver) * lateral);
    }
    const spinOver = Math.max(0, maxSpin - lerp(1.6, sp.driftSpin ?? 4.5, this.driftLatch), combOver * (1 - this.driftLatch));
    // Strength controls attack rate. In grip cornering TC must be able to cut
    // enough torque to keep a high-power rear gripped; the former 64% ceiling
    // on the Z4 could never reserve its lateral force in a low gear.
    const tcMax = tcK > 0 ? lerp(0.95 * Math.sqrt(tcK), 0.95, cornerDemand * (1 - this.driftLatch)) : 0;
    const tcAttack = combOver > 0 && this.driftLatch < 0.1 ? 10 : 6;
    this.tcCut = clamp(this.tcCut + (spinOver > 0 ? spinOver * tcK * tcAttack : -3) * dt, 0, tcMax);
    // crawling in soft sand the traction control cuts as hard as it can, as real systems do on low grip (it's what
    // lets a car with its wheels spinning claw its way out rather than dig itself in)
    const tcSand = (this.surfSoft ?? 0) * (1 - smoothstep(3, 8, av));
    if (tcSand > 0.05 && spinOver > 0) this.tcCut = Math.min(0.92 * tcSand, Math.max(this.tcCut, this.tcCut + spinOver * 4 * tcSand * dt));
    if (burnout) this.tcCut = 0;
    const edlK = burnout ? 0 : sp.edl ?? (this.lsd < 0.2 ? tcK : 0);
    for (let j = 0; j < 2; j++) {
      const L = C4[j * 2], Rr = C4[j * 2 + 1], driven = (j ? sR : sF) > 0;
      for (const [Wc, O, ci] of [[L, Rr, cap[j * 2]], [Rr, L, cap[j * 2 + 1]]]) {
        const ws = Wc.sx * dirD, os = O.sx * dirD;
        const ex = driven && edlK > 0 && thrRaw > 0.1 ? Math.max(0, ws - 1.3) * (ws > os + 0.4 ? 1 : 0) : 0;
        Wc.edl = ex > 0 ? Math.min(0.7 * ci, Wc.edl + dt * ci * 6 * ex * edlK) : Math.max(0, Wc.edl - dt * ci * 4);
      }
    }
    this.tcOn = this.tcCut > 0.05 || C4.some((c) => c.edl > 50);
    const escK = (burnout ? 0 : sp.esc ?? 0.4) * (1 - 0.95 * this.driftLatch) * smoothstep(3, 10, vt);
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
    const grade = gradeNow; // (along the body: see gradeNow above, shared with the suspension)
    // back along your own tracks (marked by the bow wave you pushed up going the other way) the sand is packed
    const packed = 1 - 0.65 * (vx < 0 ? this.digF : this.digB);
    let ax = (FxB - drag - roll) / this.m - G * grade - (this.surfDrag ?? 0) * packed * Math.sign(vx) * Math.min(1, av / 2);
    // ---------------- soft ground (sand above all). Wheels spinning in place dig ruts: they sink, lose grip and must
    // climb out of the hole they dug, so flooring it only digs deeper. digF / digB (0..1): the wall of sand piled in
    // front of / behind the wheels by spinning them forwards / in reverse. Rolling without wheelspin fills the ruts in
    // again: ease the throttle, or reverse out the way you came (into the shallow side) and have another go.
    const soft = this.surfSoft ?? 0;
    if (soft > 0) {
      let spinV = 0;
      for (let i = 0; i < 4; i++) { if ((i < 2 ? sF : sR) <= 0) continue; const d = C4[i].vw - S[i].vgx; if (Math.abs(d) > Math.abs(spinV)) spinV = d; }
      const sv = Math.abs(spinV), fill = dt * av * 0.18;
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
    const res = (this.surfRes ?? 0) * (push >= 0 ? 1 - 0.65 * this.digB : 1 - 0.65 * this.digF) + DIG_RES * (push >= 0 ? this.digF + 0.1 * this.digB : this.digB + 0.1 * this.digF);
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
          this.bodyKick(vn * 0.05, 0, side * vn * 0.25);
          this.wallSide = side;
          this.syncWheels();
        }
      }
      this.y = route.surfaceY(this.s, this.u);
      this.grade = f.grade; this.bank = f.bank;
    }

    // ---------------- bump events (sound, camera shake): how hard the front tyres are being hit, from their load swing
    const ftl = (C4[0].Fz + C4[1].Fz) * 0.5, swing = Math.abs(ftl - (this._ftlPrev ?? ftl)) / Math.max(dt, 1e-4);
    this._ftlPrev = ftl;
    this.bumpHit = Math.max(this.bumpHit, clamp(swing / (this.m * G) * 0.35 - 0.12, 0, 1) * Math.min(1, av / 6));
    this.rough = (this.offroad ? 1 : 0.25 + 0.35 * (1 - urb)) * Math.min(1, av / 25);
  }
  /** Player policy is opt-in here; AI vehicles keep the automatic box on every chassis.
   *  ai=true is also used by the browser's autodrive verification mode. */
  setManual(enabled, { ai = false } = {}) {
    this.playerGearbox = !ai; this.manualPreference = !!enabled;
    this.manual = ai ? false : manualMode(this.spec, enabled);
    return this.manual;
  }
  shiftManual(direction) {
    if (!this.manual && carTransmission(this.spec) !== 'auto') return shiftFeedback(this, false, 'mode');
    if (this.reverse) return shiftFeedback(this, false, 'reverse');
    if (this.shiftT > 0 || this.shiftCool > 0) return shiftFeedback(this, false, 'cooldown');
    if (!Number.isFinite(direction) || !direction) return shiftFeedback(this, false, 'bounds');
    const g = this.gear + Math.sign(direction), sp = this.spec;
    if (g < 1 || g > sp.gears.length) return shiftFeedback(this, false, 'bounds', g);
    const rpm = predictedGearRpm(this, g), unsafe = g < this.gear && rpm > sp.redline;
    // A stick accepts a money shift. Automated/paddle boxes still protect their engine.
    if (unsafe && !this.manual) return shiftFeedback(this, false, 'overrev_protection', g, rpm);
    this._unsafeShift = this.manual && g < this.gear ? { gear: g, from: this.gear, unsafe } : null;
    this.shift(g, (sp.shiftT ?? 0.15) * (g < this.gear ? 0.7 : 1));
    return shiftFeedback(this, true, unsafe ? 'mechanical_overrev' : 'shifted', g, rpm, unsafe);
  }
  shift(g, t) {
    this.shiftEvent = g > this.gear ? 1 : -1;
    // Animation hook: persistent event with a monotonic serial (survives shiftEvent's frame reset).
    this.gearChangeEvent = { serial: this.gearChangeSerial = (this.gearChangeSerial || 0) + 1,
      from: this.gear, to: g, direction: this.shiftEvent, duration: t, manual: this.manual };
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
