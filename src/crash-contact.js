// Arcade-sim crash contacts for the road plane: one small solver shared by walls, rails, posts, AI traffic, rivals and other players.
//
// A contact is resolved AT THE CONTACT POINT with the car's mass and yaw inertia (so an offset hit spins the car and a square hit
// does not), with a normal restitution that falls with closing speed (a bump bounces, a crash crumples) and Coulomb friction along
// the tangent (so a glancing hit scrubs speed and swings the nose instead of sliding along a wall for free). Whatever is hit may
// have finite mass. A single contact may add at most YAW_KICK_MAX to the yaw rate, so a tap is never a spin-out; the tyres do the
// rest, and `crashRecover` gives a short stabilised moment after a hit so the car stays drivable (see Vehicle.step).
//
// Body frame (as in physics.js): x forward, y right, yaw rate w > 0 turns right. The normal always points from the thing that was
// hit TOWARDS the car being solved.
export const CRASH = {
  yawInertia: 1.25,     // contact-time yaw inertia scale: tyres and suspension resist rotation during the blow
  yawKickMax: 2.4,      // rad/s: most yaw rate one contact may add
  yawRateMax: 3.6,      // rad/s: |w| after any contact
  mu: 0.3,              // Coulomb friction, body against concrete / steel / paint
  scrapeLoad: 0.55,     // sustained scrape: share of the car's weight pressing on the wall (decel = mu * g * load)
  eLow: 0.3, eHigh: 0.1, // normal restitution at LOW / HIGH closing speed
  vLow: 3, vHigh: 15,    // m/s
  maxDv: 90,            // m/s: most velocity change one contact may deliver (a 160 km/h head-on of equal cars is 44 each)
  recover: 0.9,         // s: stabilised moment after a hard hit
};
const G = 9.81;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** normal restitution at closing speed vn (m/s): 0.3 for a bump, falling to 0.1 for a crash; none at all when merely resting */
export const restitutionAt = vn => (CRASH.eLow + (CRASH.eHigh - CRASH.eLow) * smooth(CRASH.vLow, CRASH.vHigh, vn)) * smooth(0.3, 1.5, vn);

/** soft limit on how much yaw rate one contact adds */
export function limitYawKick(w0, w1) {
  const dw = w1 - w0, cap = CRASH.yawKickMax;
  let w = w0 + cap * Math.tanh(dw / cap);
  const top = CRASH.yawRateMax;
  if (Math.abs(w) > top) w = Math.sign(w) * Math.max(top, Math.abs(w0));
  return w;
}

const frame = yaw => ({ fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw) });
/** world point -> body offsets (forward, right) from the car's centre */
export function bodyOffset(v, x, z) {
  const f = frame(v.yaw), dx = x - v.x, dz = z - v.z;
  return { px: dx * f.fx + dz * f.fz, py: dx * f.rx + dz * f.rz };
}
export const yawInertiaOf = v => (v.Iz || v.m * 1.6) * CRASH.yawInertia;

/**
 * Impulse on `v` from a contact at world point (x, z) with outward normal (nx, nz) (from the obstacle to the car).
 * o: { mass (obstacle, default immovable), restitution, mu, maxDv }.  Returns null when the contact is separating, else
 * { vn (closing speed), j (normal impulse), jt, dv (velocity change of the car's centre), e, px, py }.
 */
export function solveContact(v, nx, nz, x, z, o = {}) {
  if (!Number.isFinite(v.w)) v.w = 0;
  const f = frame(v.yaw), { px, py } = bodyOffset(v, x, z);
  const nF = nx * f.fx + nz * f.fz, nR = nx * f.rx + nz * f.rz;
  const m = v.m, I = yawInertiaOf(v), inv = 1 / m + (o.mass > 0 ? 1 / o.mass : 0);
  let vpx = v.vLong - v.w * py, vpy = v.vLat + v.w * px;
  const vn = -(vpx * nF + vpy * nR);
  if (!(vn > 0)) return null;
  const e = o.restitution ?? restitutionAt(vn), mu = o.mu ?? CRASH.mu;
  const rn = px * nR - py * nF;
  let j = (1 + e) * vn / (inv + rn * rn / I);
  j = Math.min(j, (o.maxDv ?? CRASH.maxDv) * m);
  const w0 = v.w;
  v.vLong += j * nF / m; v.vLat += j * nR / m; v.w += j * rn / I;
  // Coulomb friction along the tangent at the same point, bounded by mu * j
  vpx = v.vLong - v.w * py; vpy = v.vLat + v.w * px;
  const tF = -nR, tR = nF, vt = vpx * tF + vpy * tR, rt = px * tR - py * tF;
  const jt = clamp(-vt / (inv + rt * rt / I), -mu * j, mu * j);
  v.vLong += jt * tF / m; v.vLat += jt * tR / m; v.w += jt * rt / I;
  v.w = limitYawKick(w0, v.w);
  return { vn, j, jt, dv: j / m, e, px, py };
}

/**
 * Sustained contact (a car pressed against / sliding along a wall, no closing speed): Coulomb scrub at the contact point,
 * mu * load * dt of impulse, so sliding along a wall costs speed and drags the nose round instead of being free.
 */
export function scrapeContact(v, nx, nz, x, z, dt, o = {}) {
  if (!Number.isFinite(v.w)) v.w = 0;
  const f = frame(v.yaw), { px, py } = bodyOffset(v, x, z);
  const nF = nx * f.fx + nz * f.fz, nR = nx * f.rx + nz * f.rz;
  const vpx = v.vLong - v.w * py, vpy = v.vLat + v.w * px;
  if (-(vpx * nF + vpy * nR) > 0.05) return 0; // still closing: a real impact owns this
  const tF = -nR, tR = nF, vt = vpx * tF + vpy * tR;
  if (Math.abs(vt) < 0.05) return 0;
  const m = v.m, I = yawInertiaOf(v), rt = px * tR - py * tF, inv = 1 / m + (o.mass > 0 ? 1 / o.mass : 0);
  const stop = -vt / (inv + rt * rt / I), cap = (o.mu ?? CRASH.mu) * CRASH.scrapeLoad * m * G * dt;
  const jt = clamp(stop, -cap, cap), w0 = v.w;
  v.vLong += jt * tF / m; v.vLat += jt * tR / m; v.w += jt * rt / I;
  v.w = limitYawKick(w0, v.w);
  return Math.abs(jt) / m;
}

/**
 * A car dragged along a wall is helped round to run parallel to it (the way an arcade racer lets you slide along a wall instead
 * of pinning the nose in): while in contact, the heading is eased towards the wall's tangent at up to ALIGN_RATE rad/s, the
 * world velocity unchanged. Only for a nose (or tail, reversing) angled less than ~70 degrees into the wall, at speed: a square
 * hit is a stop, not a slide.
 */
const ALIGN_RATE = 2.2, ALIGN_GAIN = 4;
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export function alignAlong(v, nx, nz, dt) {
  const f = frame(v.yaw), fwd = v.vLong >= 0 ? 1 : -1, speed = Math.hypot(v.vLong, v.vLat);
  if (speed < 2) return 0;
  const dF = (f.fx * nx + f.fz * nz) * fwd; // < 0: heading into the wall
  if (!(dF < -0.05)) return 0;
  const tx = -nz, tz = nx, sgn = (tx * f.fx + tz * f.fz) * fwd >= 0 ? 1 : -1;
  // wanted heading: along the wall, leaning a few degrees OFF it so the car comes away from the face instead of pressing on it
  const lean = 0.12, ux = tx * sgn * Math.cos(lean) + nx * Math.sin(lean), uz = tz * sgn * Math.cos(lean) + nz * Math.sin(lean);
  const dx = ux * fwd, dz = uz * fwd; // (forward when driving forward, backward-facing when reversing)
  const want = Math.atan2(-dx, -dz), d = wrapPi(want - v.yaw);
  if (Math.abs(d) > 1.2) return 0;
  const turn = clamp(d * ALIGN_GAIN, -ALIGN_RATE, ALIGN_RATE) * dt * smooth(2, 7, speed);
  const wvx = f.fx * v.vLong + f.rx * v.vLat, wvz = f.fz * v.vLong + f.rz * v.vLat;
  v.yaw += turn;
  const g = frame(v.yaw);
  v.vLong = wvx * g.fx + wvz * g.fz; v.vLat = wvx * g.rx + wvz * g.rz;
  return turn;
}

/** how much of a penetration to remove this step: all of a shallow one, never a teleport for a deep one */
export const correction = (pen, max = 0.3) => Math.min(Math.max(0, pen), max);

/** remember the wall a car is dragging along, for a moment, so the alignment keeps working between touches */
export function noteWall(v, nx, nz) { v.wallSlide = { nx, nz, t: 0.14 }; }

/** note a hit for the stabilised moment that follows, and for the camera / sound hooks (peak velocity change this frame) */
export function noteHit(v, dv) {
  v.crashDv = Math.max(v.crashDv || 0, dv);
  if (dv > 3) v.crashRecover = Math.max(v.crashRecover || 0, CRASH.recover * smooth(3, 14, dv) + 0.25);
}

// ---------------------------------------------------------------- vehicle against vehicle (world space)
const axesOf = (yaw) => [{ x: Math.cos(yaw), z: -Math.sin(yaw) }, { x: -Math.sin(yaw), z: -Math.cos(yaw) }];
const reach = (v, n) => { const [r, f] = axesOf(v.yaw); return Math.abs(r.x * n.x + r.z * n.z) * (v.halfW || 1) + Math.abs(f.x * n.x + f.z * n.z) * (v.halfL || 2.2); };
export const worldVelocity = v => ({ x: -Math.sin(v.yaw) * v.vLong + Math.cos(v.yaw) * v.vLat, z: -Math.cos(v.yaw) * v.vLong - Math.sin(v.yaw) * v.vLat });
export const massOf = v => v.m || v.spec?.mass || 1500;
const inertiaOf = v => v.Iz || massOf(v) * ((2 * (v.halfL || 2.2)) ** 2 + (2 * (v.halfW || 1)) ** 2) / 12 * 1.2;

/**
 * Oriented-box overlap of two cars on the road plane. Among the axes the cars are closing along it takes the shallowest (a pose
 * that arrives deep inside the other car must not read as a sideways touch). Returns { nx, nz (from b to a), depth, x, z } or null.
 * The contact point is the middle of the overlap along the contact face, halfway between the two faces.
 */
export function carOverlap(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  if (Math.hypot(dx, dz) > (a.halfL || 2.2) + (b.halfL || 2.2) + 0.5) return null;
  const va = worldVelocity(a), vb = worldVelocity(b);
  let depth = Infinity, normal = null, aDepth = Infinity, aNormal = null;
  for (const axis of [...axesOf(a.yaw), ...axesOf(b.yaw)]) {
    const d = dx * axis.x + dz * axis.z, o = reach(a, axis) + reach(b, axis) - Math.abs(d);
    if (o <= 0) return null;
    const s = d >= 0 ? 1 : -1, n = { x: axis.x * s, z: axis.z * s };
    if (o < depth) { depth = o; normal = n; }
    if (o < aDepth && -((va.x - vb.x) * n.x + (va.z - vb.z) * n.z) > 0.05) { aDepth = o; aNormal = n; }
  }
  if (aNormal) { normal = aNormal; depth = aDepth; }
  // contact point: along the contact face, the middle of where the two boxes overlap; across it, halfway between the faces
  const tx = -normal.z, tz = normal.x;
  const ta = a.x * tx + a.z * tz, tb = b.x * tx + b.z * tz, ea = reach(a, { x: tx, z: tz }), eb = reach(b, { x: tx, z: tz });
  const lo = Math.max(ta - ea, tb - eb), hi = Math.min(ta + ea, tb + eb), mid = (lo + hi) / 2;
  const na = a.x * normal.x + a.z * normal.z - reach(a, normal) + depth / 2; // b's face sits depth/2 beyond a's near face
  return { nx: normal.x, nz: normal.z, depth, x: normal.x * na + tx * mid, z: normal.z * na + tz * mid };
}

/**
 * One car's half of a car-to-car contact. `other` supplies its own mass, inertia and velocity at the point, but is not changed:
 * online each driver resolves only their own car and the other driver resolves theirs from the same numbers, so the exchange is
 * equal and opposite (both use the same normal, point, masses, restitution and friction).
 * c: { nx, nz (from other to this), x, z }.  Returns { vn, j, dv, ... } or null if separating.
 */
export function solveCarHalf(v, other, c, o = {}) {
  if (!Number.isFinite(v.w)) v.w = 0;
  const f = frame(v.yaw), { px, py } = bodyOffset(v, c.x, c.z);
  const nF = c.nx * f.fx + c.nz * f.fz, nR = c.nx * f.rx + c.nz * f.rz;
  const m = massOf(v), mo = massOf(other), I = yawInertiaOf(v), Io = inertiaOf(other) * CRASH.yawInertia;
  // the other body's point velocity (world): its centre's plus w x r, in its own body frame (w > 0 turns right)
  const of = frame(other.yaw), roX = c.x - other.x, roZ = c.z - other.z;
  const roF = roX * of.fx + roZ * of.fz, roR = roX * of.rx + roZ * of.rz;
  const opF = (other.vLong || 0) - (other.w || 0) * roR, opR = (other.vLat || 0) + (other.w || 0) * roF;
  const opx = of.fx * opF + of.rx * opR, opz = of.fz * opF + of.rz * opR;
  // this car's point velocity (world)
  const vpF = v.vLong - v.w * py, vpR = v.vLat + v.w * px;
  const vrx = f.fx * vpF + f.rx * vpR - opx, vrz = f.fz * vpF + f.rz * vpR - opz; // relative velocity at the contact point
  const vn = -(vrx * c.nx + vrz * c.nz);
  if (!(vn > 0)) return null;
  // r x n and r x t for both bodies (body frames, x forward, y right), so one set of numbers serves both halves
  const tx = -c.nz, tz = c.nx, tF = tx * f.fx + tz * f.fz, tR = tx * f.rx + tz * f.rz;
  const onF = c.nx * of.fx + c.nz * of.fz, onR = c.nx * of.rx + c.nz * of.rz, tFo = tx * of.fx + tz * of.fz, tRo = tx * of.rx + tz * of.rz;
  const rnA = px * nR - py * nF, rnB = roF * onR - roR * onF, rtA = px * tR - py * tF, rtB = roF * tRo - roR * tFo;
  const e = o.restitution ?? restitutionAt(vn), mu = o.mu ?? CRASH.mu;
  const j = Math.min((1 + e) * vn / (1 / m + 1 / mo + rnA * rnA / I + rnB * rnB / Io), (o.maxDv ?? CRASH.maxDv) * Math.min(m, mo));
  // friction along the face from the tangential slide that is left once the normal blow has landed on both bodies: computed from the
  // pre-impact state of both, so the other driver's half (same inputs, mirrored) comes out equal and opposite
  const vt = vrx * tx + vrz * tz + j * (rnA * rtA / I + rnB * rtB / Io);
  const jt = clamp(-vt / (1 / m + 1 / mo + rtA * rtA / I + rtB * rtB / Io), -mu * j, mu * j);
  const w0 = v.w;
  v.vLong += (j * nF + jt * tF) / m; v.vLat += (j * nR + jt * tR) / m; v.w += (j * rnA + jt * rtA) / I;
  v.w = limitYawKick(w0, v.w);
  return { vn, j, jt, dv: j / m, e, px, py, mass: mo };
}

// ---------------------------------------------------------------- separation and the two ways to resolve a pair
const snapshot = v => ({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, vLong: v.vLong, vLat: v.vLat, w: v.w || 0, m: massOf(v), Iz: v.Iz, halfL: v.halfL, halfW: v.halfW, hcg: v.hcg, spec: v.spec });
/** the car's contact point when only the normal and depth are known: the middle of the overlap, on the face that meets the other car */
export function pointOnFace(v, nx, nz, depth) {
  const r = reach(v, { x: nx, z: nz });
  return { x: v.x - nx * (r - depth / 2), z: v.z - nz * (r - depth / 2) };
}
/** move `v` along (nx, nz) (from the other car to v) by dist, keeping the road coordinates in step */
function shift(v, dx, dz, route) {
  v.x += dx; v.z += dz;
  if (route && v.s !== undefined) { const p = route.project(v.x, v.z, v.s, 6); v.s = p.s; v.u = p.u; }
}
/**
 * Ease an overlap apart without a jump: what is left to separate after the blow's own separation, at most 12 cm a call, shared
 * between the two cars by inverse mass (`share` is this car's part). Called every frame a pair still overlaps, impulse or not.
 */
export function easeApart(v, c, left, share, route) {
  const d = Math.min(0.12, Math.max(0, left) * 0.5) * share;
  if (d > 0) shift(v, c.nx * d, c.nz * d, route);
}
const worldDelta = (v, before) => { const a = worldVelocity(v); return { x: a.x - before.x, z: a.z - before.z }; };
/**
 * One car's half of a contact, complete: the blow (both cars' mass, inertia, restitution by speed, friction at the contact point),
 * then the car's own part of the separation. The two cars met `depth / closing` seconds ago: rewind to then and run the rest of
 * the step on the new velocity (so each is displaced by its own velocity change times that time: the lighter further), and ease
 * what still overlaps. `other` is a frozen copy of the other car as it was before the blow.
 */
export function resolveHalf(v, other, c, o = {}) {
  const before = worldVelocity(v), ob = worldVelocity(other);
  const hit = solveCarHalf(v, other, c, o);
  if (!hit) { easeApart(v, c, c.depth, o.share ?? 0.5, o.route); return null; }
  const tr = Math.min(0.05, c.depth / Math.max(hit.vn, 1.5)), d = worldDelta(v, before);
  shift(v, d.x * tr, d.z * tr, o.route);
  // what the blow gave the pair along the normal, from this car's side: its own change plus the other's (mirrored: equal and opposite
  // impulse on a car of mass m2, estimated from this car's impulse) -- the other half does the same on its side
  const otherDv = hit.j / hit.mass, gained = (d.x * c.nx + d.z * c.nz + otherDv) * tr;
  easeApart(v, c, c.depth + 0.01 - gained, o.share ?? hit.mass / (hit.mass + massOf(v)), o.route);
  noteHit(v, hit.dv);
  void ob;
  return hit;
}
/** two local cars (a rival and the player, offline): both halves from the same frozen state, so the exchange is equal and opposite */
export function resolveCarPair(a, b, o = {}) {
  const c = carOverlap(a, b);
  if (!c) return null;
  const sa = snapshot(a), sb = snapshot(b), ma = massOf(a), mb = massOf(b);
  const hitA = resolveHalf(a, sb, c, { route: o.route, share: mb / (ma + mb), mu: o.mu });
  const hitB = resolveHalf(b, sa, { nx: -c.nx, nz: -c.nz, x: c.x, z: c.z, depth: c.depth }, { route: o.route, share: ma / (ma + mb), mu: o.mu });
  return { c, hitA, hitB, vn: Math.max(hitA?.vn ?? 0, hitB?.vn ?? 0) };
}
