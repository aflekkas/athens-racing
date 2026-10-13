// Shared impact calibration; speeds are m/s. Below ~8 km/h bumper elasticity absorbs the hit.
// Permanent damage tracks crush energy above that limit. Zone values remain replay-compatible [0, 1].
export function damageIncrement(ebs, zone) {
  const full = { front: 15, rear: 15, left: 9, right: 9 }[zone];
  if (!Number.isFinite(ebs) || ebs <= 2.2 || !Number.isFinite(full)) return 0;
  return Math.min(1, (ebs * ebs - 2.2 * 2.2) / (full * full - 2.2 * 2.2));
}

export function equivalentBarrierSpeed(closingSpeed, selfMass, otherMass, { rigid = false } = {}) {
  if (!Number.isFinite(closingSpeed) || closingSpeed <= 0) return 0;
  if (rigid || otherMass == null) return closingSpeed;
  const m1 = Number.isFinite(selfMass) && selfMass > 0 ? selfMass : 1500;
  const m2 = Number.isFinite(otherMass) && otherMass > 0 ? otherMass : m1;
  const share = m2 > 3000 && m1 <= 3000 ? 0.75 : m1 > 3000 && m2 <= 3000 ? 0.25 : 0.5;
  return closingSpeed * Math.sqrt(share * m2 / (m1 + m2));
}
