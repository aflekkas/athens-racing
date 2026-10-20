// Gameplay calibration, in m/s. Cosmetic crush is independent of the mechanical
// budget: a light tap dents the paint and costs nothing; anything real costs power, top speed and a straight wheel, for good
// (owner 2026-10-20: "we should arguably make the damage more punishing, rn it's not punishing").
export const COSMETIC_EBS = 12 / 3.6;
export const MECHANICAL_EBS = 40 / 3.6; // a square frontal hit above this can also wreck the engine (terminal logic below)
export const WRECK_EBS = 90 / 3.6;
export const WRECK_MECHANICAL = 0.98;
// Lasting mechanical damage, by the hit's equivalent barrier speed in any direction: none below TAP_EBS (trading paint), a
// smooth rise to a ruined car at RUIN_EBS. A frontal hit weighs most; side and rear hits hurt the suspension, steering and exhaust.
export const TAP_EBS = 18 / 3.6;
export const RUIN_EBS = 80 / 3.6;
// The end that carries the engine weighs most (power, drivetrain); the far end only gets suspension and alignment wear.
export const ZONE_WEIGHT = { front: 1, rear: 0.4, left: 0.5, right: 0.5 };
export const ZONE_WEIGHT_REAR_ENGINE = { front: 0.5, rear: 1, left: 0.5, right: 0.5 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const groundKinds = new Set(['kerb', 'curb', 'ground', 'suspension', 'bump-road', 'landing']);
export const isGroundContact = kind => groundKinds.has(kind);

export function damageIncrement(ebs, zone) {
  const full = { front: 60 / 3.6, rear: 60 / 3.6, left: 50 / 3.6, right: 50 / 3.6 }[zone]; // (80 / 65 km/h before 2026-10-20: dents show sooner and deeper)
  if (!Number.isFinite(ebs) || ebs <= COSMETIC_EBS || !Number.isFinite(full)) return 0;
  return Math.min(1, (ebs * ebs - COSMETIC_EBS * COSMETIC_EBS) / (full * full - COSMETIC_EBS * COSMETIC_EBS));
}

// EBS already uses speed into the contact normal. Only its nose-directed impulse
// can damage the powertrain; a front-corner glancing hit gets another projection.
export function frontalBarrierSpeed(ebs, zone, { localNormal, kind } = {}) {
  if (!Number.isFinite(ebs) || ebs <= 0 || zone !== 'front' || isGroundContact(kind) || kind === 'tyre') return 0;
  if (!localNormal) return ebs; // legacy direct front impacts are square-on
  const { x, y = 0, z } = localNormal, length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 0.01) return 0;
  const alignment = z / length;
  return alignment >= Math.SQRT1_2 - 1e-9 ? ebs * alignment : 0;
}

/** lasting mechanical damage one impact adds (0..1), from its equivalent barrier speed and the zone it landed on */
export function mechanicalIncrement(ebs, zone = 'front', engineZone = 'front') {
  const w = (engineZone === 'rear' ? ZONE_WEIGHT_REAR_ENGINE : ZONE_WEIGHT)[zone];
  if (!Number.isFinite(ebs) || ebs <= TAP_EBS || !(w > 0)) return 0;
  return w * Math.min(1, (ebs - TAP_EBS) / (RUIN_EBS - TAP_EBS)) ** 2;
}

/** engine power left (1 = all of it) at a mechanical damage level; never below limp */
export function impactPowerFactor(mechanical) {
  const damage = clamp(Number.isFinite(mechanical) ? mechanical : 0, 0, 1);
  return 1 - 0.55 * damage ** 0.85;
}
/** extra drag on a damaged car (a worse top speed, on top of the lost power): 1 = none */
export function impactDragFactor(mechanical) {
  const damage = clamp(Number.isFinite(mechanical) ? mechanical : 0, 0, 1);
  return 1 + 0.6 * damage;
}

export function isTerminalImpact(impactEbs, impactMechanical = 0) {
  return Number.isFinite(impactEbs) && impactEbs >= WRECK_EBS ||
    Number.isFinite(impactMechanical) && impactMechanical >= WRECK_MECHANICAL && impactMechanical <= 1;
}

export function equivalentBarrierSpeed(closingSpeed, selfMass, otherMass, { rigid = false } = {}) {
  if (!Number.isFinite(closingSpeed) || closingSpeed <= 0) return 0;
  if (rigid || otherMass == null) return closingSpeed;
  const m1 = Number.isFinite(selfMass) && selfMass > 0 ? selfMass : 1500;
  const m2 = Number.isFinite(otherMass) && otherMass > 0 ? otherMass : m1;
  const share = m2 > 3000 && m1 <= 3000 ? 0.75 : m1 > 3000 && m2 <= 3000 ? 0.25 : 0.5;
  return closingSpeed * Math.sqrt(share * m2 / (m1 + m2));
}
