// Vehicle dynamics, sim-leaning. Fixed 240 Hz substeps.
//  - engine with per-type torque curves (turbo spool / lag, NA flat-six, V12, turbo-diesel), engine braking,
//    rev limiter, clutch slip on launch, automatic sequential gearbox with per-car shift times and rev-matched downshifts
//  - wheel-speed state per axle (implicit integration) so wheelspin, lock-ups, ABS and traction control are real
//  - combined-slip tyres (normalised Pacejka "similarity" method) with load sensitivity, peak slip angle and
//    slide falloff per car, tyre relaxation length
//  - per-wheel loads: lagged longitudinal / lateral weight transfer through the suspension (roll stiffness
//    distribution sets the under/oversteer balance), aero downforce, crests and dips of the real road profile
//  - suspension pose (heave / pitch / roll springs per car) excited by road texture, bumps and expansion joints
//  - keyboard-friendly steering: speed-sensitive lock that tracks the tyres' useful slip angle, extra lock for
//    counter-steer, light stability control (per car) that steps aside once you deliberately break traction
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep } from './util.js';
import { ROAD } from './road.js';

const G = 9.81, RHO = 1.2;
const POWER_MUL = 1.3;  // a little extra shove: it's still a race
const H = 1 / 240;
const J_WHEEL = 1.1;    // kg m^2 per wheel (tyre + rim + brake disc)

// torque curves: [rpm / redline, fraction of peak torque]
const ENGINES = {
  turbo4: { curve: [[0, 0.5], [0.2, 0.78], [0.3, 1], [0.78, 1], [1, 0.8], [1.1, 0.7]], lag: 0.55, boostMin: 0.6, Je: 0.13, lsd: 0.25 },
  turbo5: { curve: [[0, 0.45], [0.22, 0.72], [0.36, 1], [0.82, 0.97], [1, 0.84], [1.1, 0.75]], lag: 0.75, boostMin: 0.52, Je: 0.15, lsd: 0.65 },
  flat6: { curve: [[0, 0.48], [0.3, 0.7], [0.6, 0.92], [0.82, 1], [1, 0.93], [1.1, 0.85]], lag: 0, Je: 0.11, lsd: 0.6 },
  v12: { curve: [[0, 0.58], [0.3, 0.84], [0.6, 1], [0.86, 0.98], [1, 0.9], [1.1, 0.8]], lag: 0, Je: 0.24, lsd: 0.7 },
  diesel: { curve: [[0, 0.42], [0.22, 0.85], [0.36, 1], [0.66, 0.9], [1, 0.62], [1.1, 0.5]], lag: 0.9, boostMin: 0.48, Je: 0.21, lsd: 0.15 },
};
function curveAt(c, x) {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const a = c[i - 1], b = c[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  return c[c.length - 1][1];
}
// deterministic hash noise for the road surface
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

export class Vehicle {
  constructor(spec, route) {
    this.route = route;
    this.setSpec(spec);
    this.reset(0, 0);
  }
  setSpec(spec) {
    this.spec = spec;
    this.eng = ENGINES[spec.engine] || ENGINES.turbo4;
    this.m = spec.mass;
    this.wb = spec.body === 'mini' ? 2.46 : spec.body === 'wedge' ? 2.7 : spec.body === 'coupe' ? 2.45 : spec.body === 'sedan' ? 2.78 : 2.55;
    const fw = spec.frontW ?? 0.55;
    this.b = this.wb * fw; this.a = this.wb - this.b;   // a: CG -> front axle, b: CG -> rear axle
    this.Iz = this.m * this.a * this.b * (spec.yawI ?? 1) * 1.05;
    this.halfW = spec.body === 'mini' ? 0.86 : spec.body === 'wedge' ? 1.0 : 0.92;
    this.halfL = spec.body === 'mini' ? 1.91 : spec.body === 'wedge' ? 2.35 : 2.2;
    this.hcg = spec.hcg ?? 0.5;
    this.track = spec.track ?? 1.55;
    this.awd = spec.drive === 'awd';
    this.shareR = spec.drive === 'fwd' ? 0 : spec.drive === 'awd' ? (spec.awdRear ?? 0.6) : 1;
    // tyre shape: peak slip angle, peak slip ratio, sliding friction as a share of peak (peakier tyres snap more)
    this.aPk = spec.alphaPk ?? 0.11;
    this.kPk = this.aPk * 0.9;
    const C = spec.mfC ?? 1.5;
    this.mfC = C; this.mfB = Math.tan(Math.PI / (2 * C));
    this.slideK = clamp(1 - (C - 1.3) * 0.9, 0.62, 0.95);
    this.slope0 = C * this.mfB; // d f / d s at the origin
    this.lsd = this.eng.lsd ?? 0.5;
    // suspension natural frequency -> spring / damper per unit mass
    const wn = 2 * Math.PI * (spec.susHz ?? 1.8);
    this.kS = wn * wn; this.cS = 2 * (spec.susZ ?? 0.45) * wn;
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
    this.wheel = [{ vw: speed, aDyn: 0, abs: 1, k: 0, sy: 0, sx: 0, Fx: 0, Fy: 0, Fz: 0, lock: 0 }, { vw: speed, aDyn: 0, abs: 1, k: 0, sy: 0, sx: 0, Fx: 0, Fy: 0, Fz: 0, lock: 0 }];
    this.boost = 0; this.tcCut = 0; this.escCut = 0; this.limiter = false; this.load = 0; this.engT = 0;
    this.wallHit = 0; this.offroad = 0; this.reverse = false; this.topSpeed = 0; this.drift = 0; this.driftLatch = 0;
    this.shiftEvent = 0; this.bumpHit = 0; this.rough = 0; this.absOn = false; this.tcOn = false; this.escOn = false;
    this.skid = 0; this.wheelspin = 0; this.lockup = 0; this.lastV = speed; this.lastBumpCell = -1;
  }
  get speed() { return Math.hypot(this.vLong, this.vLat); }
  get kmh() { return Math.abs(this.vLong) * 3.6; }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  velocityWorld(out = new THREE.Vector3()) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return out.set(fx * this.vLong + rx * this.vLat, 0, fz * this.vLong + rz * this.vLat);
  }
  ratio(g = this.gear) { return this.spec.gears[g - 1] * this.spec.final; }
  /** full-throttle engine torque (N m) at rpm, including turbo boost */
  torqueMax(rpm) {
    const sp = this.spec, e = this.eng;
    let shape = curveAt(e.curve, rpm / sp.redline);
    if (e.lag) shape *= lerp(e.boostMin, 1, this.boost);
    const T = sp.torque * POWER_MUL * shape;
    const cap = sp.power * 1000 * POWER_MUL / Math.max(60, rpm * Math.PI / 30) * 1.04;
    return Math.min(T, cap);
  }
  /** steering lock: full lock when parking; at speed, about what the front tyres can use (keyboard friendly) */
  lockAt(av) {
    const sp = this.spec;
    const raw = sp.steer * (0.14 + 0.86 / (1 + av / 15));
    const grip = this.wb * sp.grip * G / Math.max(1, av * av) + this.aPk * 1.25;
    return Math.min(raw, grip);
  }

  /** input: {throttle, brake, steer (-1 left..1 right), handbrake, nitro} */
  update(dt, input) {
    // something outside the integrator (a crash, a wall) changed our speed: let the wheels follow
    if (Math.abs(this.vLong - this.lastV) > 1.5) for (const W of this.wheel) if (Math.abs(W.vw) > 0.5 || Math.abs(this.vLong) > 0.5) W.vw = this.vLong;
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
    const vx = this.vLong, vy = this.vLat, av = Math.abs(vx);
    const thrIn = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    const beta = Math.atan2(vy, Math.max(2, av));

    // ---------------- steering: speed-sensitive lock, extra room to counter-steer a slide, rack rate per car
    const lock = this.lockAt(av);
    const sIn = clamp(inp.steer, -1, 1);
    const counter = Math.sign(sIn) === Math.sign(beta) ? Math.min(0.35, Math.abs(beta) * 0.9) : 0;
    // drift latch: handbrake (or a held slide on power) tells the assists you mean it
    if (inp.handbrake && av > 8) this.driftLatch = 1;
    else this.driftLatch = Math.max(0, this.driftLatch - dt * (thrIn > 0.4 && Math.abs(beta) > 0.1 ? 0.12 : 1.2));
    // a light counter-steer helper when the rear steps out and you aren't steering into it
    const helper = clamp(beta * 0.55, -0.22, 0.22) * smoothstep(5, 14, av) * (Math.abs(sIn) < 0.1 ? 1 : 0.35) * (1 - 0.6 * this.driftLatch);
    const target = sIn * (lock + counter) + helper;
    const rate = (sp.steerRate ?? 1) * (2.4 + 1.5 / (1 + av / 10));
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const delta = this.steer;

    // ---------------- suspension-filtered accelerations (drive the load transfer: weight shifts with the springs)
    const LT = this.lt, kS = this.kS * 1.6, cS = this.cS * 1.25;
    LT.axV += (kS * (this.axRaw ?? 0) - kS * LT.ax - cS * LT.axV) * dt; LT.ax += LT.axV * dt;
    LT.ayV += (kS * (this.ayRaw ?? 0) - kS * LT.ay - cS * LT.ayV) * dt; LT.ay += LT.ayV * dt;
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
    const dLong = this.m * axL * this.hcg / this.wb;
    const Fzf = Math.max(150, W * (this.b / this.wb) + DF * aeroF - dLong);
    const Fzr = Math.max(150, W * (this.a / this.wb) + DF * (1 - aeroF) + dLong);
    const dLat = this.m * ayL * this.hcg / this.track, rsF = sp.rsF ?? 0.55;
    const Fz0f = this.m * G * 0.25, Fz0r = Fz0f; // one nominal tyre load: the lighter axle's tyres work in a grippier range
    const mu0 = sp.grip * (this.offroad ? 0.62 : 1);
    const ls = sp.loadSens ?? 0.15;
    // axle grip from two wheels with load sensitivity (the axle that carries more of the roll transfer loses grip)
    const axleCap = (Fz, dL, Fz0) => {
      const l = Math.max(0, Fz * 0.5 + dL * 0.5), r = Math.max(0, Fz * 0.5 - dL * 0.5);
      const cl = mu0 * l * Math.max(0.4, 1 - ls * (l / Fz0 - 1)), cr = mu0 * r * Math.max(0.4, 1 - ls * (r / Fz0 - 1));
      return { cap: cl + cr, drive: lerp(2 * Math.min(cl, cr), cl + cr, this.lsd) };
    };
    const capFr = axleCap(Fzf, dLat * rsF, Fz0f), capRr = axleCap(Fzr, dLat * (1 - rsF), Fz0r);

    // ---------------- engine / gearbox
    const R = sp.wheelR, e = this.eng, red = sp.redline;
    if (av < 0.8 && brk > 0.5 && thrIn < 0.1 && vx < 0.5) this.reverse = true;
    if (thrIn > 0.1 && this.reverse && vx > -0.8) this.reverse = false;
    const thrRaw = this.reverse ? brk : thrIn;
    this.shiftT = Math.max(0, this.shiftT - dt); this.shiftCool = Math.max(0, this.shiftCool - dt);
    if (this.shiftT <= 0 && this.pendingGear) { this.gear = this.pendingGear; this.pendingGear = 0; }
    const sR = this.shareR, sF = 1 - sR;
    const vwD = this.wheel[0].vw * sF + this.wheel[1].vw * sR;
    const gr = this.reverse ? -sp.gears[0] * sp.final * 1.1 : this.ratio();
    const wheelRpm = vwD / R * gr * 60 / (2 * Math.PI);
    // turbo spool
    const e_r = this.rpm / red;
    if (e.lag) { const tgt = thrRaw * smoothstep(0.12, 0.42, e_r); const tau = e.lag * (sp.turbo ?? 1) * (tgt > this.boost ? 1 : 0.35); this.boost += (tgt - this.boost) * Math.min(1, dt / Math.max(0.05, tau)); }
    // automatic sequential box: shift points follow the throttle; kick-down; rev-matched downshifts when braking
    if (!this.reverse && this.shiftT <= 0 && this.shiftCool <= 0 && av > 0.5) {
      const nG = sp.gears.length;
      const up = red * lerp(0.6, 0.975, smoothstep(0.2, 0.9, thrRaw));
      const rpmIn = (g) => vwD / R * this.ratio(g) * 60 / (2 * Math.PI);
      if (this.gear < nG && rpmIn(this.gear) > up && this.clutch >= 1) this.shift(this.gear + 1, sp.shiftT ?? 0.15);
      else if (this.gear > 1) {
        const dn = rpmIn(this.gear - 1);
        const downAt = brk > 0.2 ? red * 0.72 : red * lerp(0.32, 0.6, thrRaw);
        if (dn < red * 0.9 && (rpmIn(this.gear) < downAt || (thrRaw > 0.92 && dn < red * 0.8 && rpmIn(this.gear) < red * 0.55))) this.shift(this.gear - 1, (sp.shiftT ?? 0.15) * 0.7);
      }
    }
    // clutch: slips on launch (holds revs up), otherwise locked to the driven wheels
    const launchRpm = sp.idle + (red * (sp.engine === 'diesel' ? 0.38 : 0.5) - sp.idle) * thrRaw;
    const shifting = this.shiftT > 0;
    const slipGear = this.reverse || this.gear === 1;
    const engaged = !shifting && Math.abs(wheelRpm) > sp.idle * 0.9 && (!slipGear || Math.abs(wheelRpm) >= launchRpm * 0.98);
    this.clutch = engaged ? 1 : shifting ? 0 : clamp(Math.abs(wheelRpm) / Math.max(1, launchRpm), 0, 0.99);
    let rpmT = engaged ? Math.abs(wheelRpm) : shifting ? (this.pendingGear ? Math.abs(vwD / R * this.ratio(this.pendingGear) * 60 / (2 * Math.PI)) : this.rpm) : launchRpm;
    if (shifting && this.pendingGear < this.gear && this.pendingGear) rpmT *= 1.05; // throttle blip
    rpmT = Math.max(rpmT, sp.idle);
    this.rpm = engaged ? Math.max(sp.idle, Math.abs(wheelRpm)) : damp(this.rpm, rpmT, shifting ? 18 : 9, dt);
    // limiter (fuel cut with hysteresis)
    if (this.rpm > red * 1.005) this.limiter = true; else if (this.rpm < red * 0.97) this.limiter = false;
    // traction control trims torque while the driven wheels spin
    const thr = thrRaw * (1 - this.tcCut) * (1 - this.escCut);
    let Te = this.torqueMax(this.rpm) * thr;
    const Teb = sp.torque * (sp.ebrake ?? 0.15) * (0.25 + 0.75 * e_r) * Math.max(0, 1 - thrRaw * 4);
    if (this.limiter) Te = 0;
    if (shifting) Te = 0;
    let Tnet = engaged ? Te - Teb : Te * (shifting ? 0 : 1);
    this.engT = Tnet;
    this.load = clamp(Tnet / (sp.torque * POWER_MUL), -1, 1);
    // nitro: extra fuel and a squirt of shove
    this.nitroOn = !!inp.nitro && this.nitro > 0.01 && thrIn > 0.2 && !this.reverse;
    let nitroF = 0;
    if (this.nitroOn) { Tnet *= 1.25; nitroF = this.m * 3.0; this.nitro = Math.max(0, this.nitro - dt * 0.2); }
    // speed governor at the car's quoted top speed
    const vmax = sp.vmax / 3.6 * (this.nitroOn ? 1.08 : 1);
    if (Tnet > 0) Tnet *= 1 - smoothstep(vmax * 0.975, vmax * 1.01, av);
    if (this.reverse && vx < -7) Tnet = 0;
    const Fdrive = Tnet * gr * 0.92 / R; // at the contact patch, signed (reverse -> negative)

    // ---------------- brakes (bias per car), ABS per axle; handbrake locks the rear
    const brakeIn = this.reverse ? thrIn : brk;
    const Fbrake = brakeIn * sp.brake * mu0 * this.m * G * 1.15;
    const bias = sp.bias ?? 0.65;

    // ---------------- per-axle tyres
    const sinD = Math.sin(delta), cosD = Math.cos(delta);
    const axles = [
      { W: this.wheel[0], cap: capFr, Fz: Fzf, x: this.a, drive: Fdrive * sF + nitroF * sF, brake: Fbrake * bias, hb: 0, steer: true, share: sF },
      { W: this.wheel[1], cap: capRr, Fz: Fzr, x: -this.b, drive: Fdrive * sR + nitroF * sR, brake: Fbrake * (1 - bias), hb: inp.handbrake && av > 0.5 ? this.m * G * 0.9 : 0, steer: false, share: sR },
    ];
    let FxB = 0, FyB = 0, Mz = 0, maxSy = 0, maxSpin = 0, maxLock = 0, skid = 0;
    this.absOn = false;
    const engJ = engaged ? e.Je * gr * gr : 0;
    for (const A of axles) {
      const Wh = A.W;
      // contact-patch velocity in the wheel frame
      const vyA = vy + A.x * this.w;
      const c = A.steer ? cosD : 1, s_ = A.steer ? sinD : 0;
      const vgx = vx * c + vyA * s_, vgy = -vx * s_ + vyA * c;
      // slip angle with relaxation length (~0.45 m)
      const aT = Math.atan(vgy / Math.max(Math.abs(vgx), 1.0));
      Wh.aDyn += (aT - Wh.aDyn) * Math.min(1, (Math.abs(vgx) + 1.5) * dt / 0.45);
      const capX = Math.max(1, A.drive > 0 ? A.cap.drive : A.cap.cap);
      const cap = A.cap.cap;
      const vref = Math.max(Math.abs(vgx), 3);
      const tyre = (vw) => {
        const kap = (vw - vgx) / vref;
        const sx = kap / this.kPk * (cap / capX), sy = Math.tan(Wh.aDyn) / Math.tan(this.aPk);
        const sN = Math.hypot(sx, sy);
        let f;
        if (sN < 1) f = Math.sin(this.mfC * Math.atan(this.mfB * sN));
        else f = 1 - (1 - this.slideK) * (1 - Math.exp(-(sN - 1) * 1.6));
        const k = sN > 1e-6 ? f / sN : this.slope0;
        return { Fx: cap * k * sx, Fy: -cap * k * sy, sx, sy, sN };
      };
      // wheel speed: implicit update (drive torque, brake torque, tyre reaction, wheel + engine inertia)
      const M = (2 * J_WHEEL + engJ * A.share) / (R * R);
      const t0 = tyre(Wh.vw);
      const kx = cap * this.slope0 / (this.kPk * vref) * (cap / capX);
      const den = 1 + dt * kx / M;
      let Fb = A.brake * Wh.abs + A.hb;
      const free = Wh.vw + dt * (A.drive - t0.Fx) / M / den;
      const dvb = dt * Fb / M / den;
      Wh.vw = Math.abs(free) <= dvb ? 0 : free - Math.sign(free) * dvb;
      const t1 = tyre(Wh.vw);
      // ABS: back the pressure off while the axle is past peak slip under braking
      if (A.brake > 0 && !A.hb && av > 2 && t1.sx < -1.15) { Wh.abs = Math.max(0.35, Wh.abs - dt * 9); this.absOn = true; }
      else Wh.abs = Math.min(1, Wh.abs + dt * 4);
      // traction control (driven axles)
      if (A.share > 0) maxSpin = Math.max(maxSpin, t1.sx);
      maxLock = Math.max(maxLock, -t1.sx);
      maxSy = Math.max(maxSy, Math.abs(t1.sy));
      skid = Math.max(skid, t1.sN);
      Wh.sx = t1.sx; Wh.sy = t1.sy; Wh.Fx = t1.Fx; Wh.Fy = t1.Fy; Wh.Fz = A.Fz;
      // to the body frame
      const fx = t1.Fx * c - t1.Fy * s_, fy = t1.Fx * s_ + t1.Fy * c;
      FxB += fx; FyB += fy; Mz += A.x * fy;
    }
    // traction control and stability control (both relax once you have deliberately unsettled the car)
    const tcK = (sp.tc ?? 0.5) * (1 - 0.7 * this.driftLatch);
    const spinOver = Math.max(0, maxSpin - 1.6);
    this.tcCut = clamp(this.tcCut + (spinOver > 0 ? spinOver * tcK * 6 : -3) * dt, 0, 0.95 * Math.sqrt(tcK));
    this.tcOn = this.tcCut > 0.05;
    const escK = (sp.esc ?? 0.4) * (1 - 0.85 * this.driftLatch) * smoothstep(3, 10, av);
    this.escOn = false;
    const wGrip = sp.grip * G / Math.max(5, av);
    const wDes = clamp(vx * Math.tan(delta) / this.wb, -wGrip, wGrip);
    const over = this.w - wDes;
    if (escK > 0 && Math.abs(beta) > 0.07 && Math.abs(this.w) > Math.abs(wDes) + 0.05) {
      {
        // brake-steer moment (individual wheel braking) and a throttle cut
        const mMax = this.m * G * this.track * 0.6;
        Mz -= clamp(over * this.Iz * 14, -mMax, mMax) * escK;
        this.escCut = Math.min(0.9 * Math.min(1, escK * 2), this.escCut + dt * escK * 8);
        this.escOn = true;
      }
    }
    // sideslip limiter: a car sliding sideways beyond what its driver can be expected to catch
    const bLim = 0.1 + 0.12 * (sp.drift ?? 1);
    if (escK > 0 && Math.abs(beta) > bLim) {
      const ex = beta - Math.sign(beta) * bLim;
      Mz += clamp(ex * this.Iz * 30, -this.m * G * this.track * 0.6, this.m * G * this.track * 0.6) * escK;
      this.escCut = Math.min(0.9 * Math.min(1, escK * 2), this.escCut + dt * escK * 10);
      this.escOn = true;
    }
    if (!this.escOn) this.escCut = Math.max(0, this.escCut - dt * 2);

    // ---------------- aero / rolling resistance / grade, then integrate (body frame)
    const drag = 0.5 * RHO * sp.cdA * (this.dragMul ?? 1) * vx * Math.abs(vx);
    const roll = 0.012 * W * Math.sign(vx) * Math.min(1, av * 4);
    const grade = route.lin(route.GR, this.s);
    const ax = (FxB - drag - roll) / this.m - G * grade;
    const ay = FyB / this.m;
    this.axRaw = ax; this.ayRaw = ay;
    this.vLong += (ax + this.w * vy) * dt;
    this.vLat += (ay - this.w * vx) * dt;
    const kin = smoothstep(0.8, 3.2, av);
    this.w += Mz / this.Iz * dt;
    // low speed: kinematic steering (tyre model is ill-conditioned when parking)
    if (kin < 1) {
      this.w = lerp(this.vLong * Math.tan(delta) / this.wb, this.w, kin);
      this.vLat = lerp(damp(this.vLat, 0, 10, dt), this.vLat, kin);
    }
    if (!this.reverse && Math.abs(this.vLong) < 0.05 && thrIn < 0.05 && brk > 0) this.vLong = 0;
    if (Math.abs(this.vLong) < 0.03 && thrRaw < 0.05) { this.vLong = 0; this.vLat *= 0.9; for (const Wh of this.wheel) Wh.vw = 0; }
    this.ax = damp(this.ax, ax, 10, dt); this.ay = damp(this.ay, ay, 10, dt);
    this.drift = Math.abs(beta) > 0.16 && av > 12 ? Math.abs(beta) : 0;
    this.slipF = Math.abs(this.wheel[0].aDyn); this.slipR = Math.abs(this.wheel[1].aDyn);
    this.spin = clamp((maxSpin - 1) * 0.4, 0, 1);
    this.wheelspin = clamp((maxSpin - 1.1) / 3, 0, 1) * smoothstep(0.5, 3, Math.max(av, Math.abs(this.wheel[0].vw), Math.abs(this.wheel[1].vw)));
    this.lockup = clamp((maxLock - 1.1) / 3, 0, 1) * smoothstep(1, 4, av);
    // tyre noise: scrub starts before the limit, squeal at and beyond peak slip
    this.skid = clamp((skid - 0.72) / 0.7, 0, 1.5) * smoothstep(2, 8, Math.max(av, Math.abs(this.wheel[1].vw)));

    // ---------------- world motion
    this.yaw -= this.w * dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.x += (fx * this.vLong + rx * this.vLat) * dt;
    this.z += (fz * this.vLong + rz * this.vLat) * dt;

    // ---------------- road frame & walls
    const pr = route.project(this.x, this.z, this.s, 6);
    this.s = pr.s; this.u = pr.u;
    const lim = ROAD.limits(route, this.s, this._lim || (this._lim = {}));
    const urb = route.urban(this.s);
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
        for (const Wh of this.wheel) Wh.vw = this.vLong;
      }
    }
    this.y = route.surfaceY(this.s, this.u);
    this.grade = f.grade; this.bank = f.bank;

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
