// Gameplay calibration, in m/s. Cosmetic crush is independent of the mechanical
// budget: repeated small dents must never become a ruined engine.
export const COSMETIC_EBS = 12 / 3.6;
export const MECHANICAL_EBS = 40 / 3.6;
export const WRECK_EBS = 90 / 3.6;
export const WRECK_MECHANICAL = 0.98;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const groundKinds = new Set(['kerb', 'curb', 'ground', 'suspension', 'bump-road', 'landing']);
export const isGroundContact = kind => groundKinds.has(kind);

export function damageIncrement(ebs, zone) {
  const full = { front: 80 / 3.6, rear: 80 / 3.6, left: 65 / 3.6, right: 65 / 3.6 }[zone];
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

export function mechanicalIncrement(frontalEbs) {
  if (!Number.isFinite(frontalEbs) || frontalEbs <= MECHANICAL_EBS) return 0;
  return Math.min(1, ((frontalEbs - MECHANICAL_EBS) / (WRECK_EBS - MECHANICAL_EBS)) ** 2);
}

export function impactPowerFactor(mechanical) {
  const damage = clamp(Number.isFinite(mechanical) ? mechanical : 0, 0, 1);
  // At most 20% loss through 65% mechanical damage; limp follows several big hits.
  return 1 - 0.2 * smooth(0, 0.65, damage) - 0.65 * smooth(0.65, 1, damage);
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
