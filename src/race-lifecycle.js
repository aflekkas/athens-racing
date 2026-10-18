import { angularVelocity, restoreRigidState } from './airborne-dynamics.js';
// Selection is keyed by driver identity, never a timer or lobby array position.
export class SpectatorSelection {
  constructor() { this.reset(); }
  reset(raceId = null) { this.raceId = raceId; this.id = null; }
  target(raceId, drivers) {
    if (raceId !== this.raceId) this.reset(raceId);
    if (!drivers.some(p => p.id === this.id)) this.id = drivers[0]?.id ?? null;
    return drivers.find(p => p.id === this.id) || null;
  }
  choose(id, raceId, drivers) {
    this.target(raceId, drivers);
    if (drivers.some(p => p.id === id)) this.id = id;
    return this.target(raceId, drivers);
  }
  step(direction, raceId, drivers) {
    const current = this.target(raceId, drivers);
    if (current) this.id = drivers[(drivers.indexOf(current) + direction + drivers.length) % drivers.length].id;
    return this.target(raceId, drivers);
  }
}

export const raceProgress = (event, s) => (s - (event?.s0 || 0)) * (event?.dir || 1);
export function rankDrivers(drivers, progress) {
  return [...drivers].sort((a, b) => {
    if (a.finish != null || b.finish != null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    if (!!a.dnf !== !!b.dnf) return a.dnf ? 1 : -1;
    return progress(b) - progress(a) || String(a.id).localeCompare(String(b.id));
  });
}

export function driverTelemetry({ member, state, event, startAt, now, ranked, progress }) {
  if (!member || !state) return null;
  const index = ranked.findIndex(p => p.id === member.id), leader = ranked[0];
  const ahead = index > 0 ? ranked[index - 1] : null, behind = ranked[index + 1] || null;
  const distance = other => other ? progress(other) - progress(member) : null;
  // Only recorded finish times support seconds. Running comparisons are distance.
  const comparison = ahead || behind;
  const timed = member.finish != null && comparison?.finish != null;
  return {
    member, state, pos: member.dnf ? null : index + 1,
    time: member.finish ?? Math.max(0, (now - startAt) / 1000),
    progress: Math.max(0, progress(member)),
    ahead, behind, leader, aheadMetres: distance(ahead), behindMetres: distance(behind), leaderMetres: distance(leader),
    gap: timed ? member.finish - comparison.finish : distance(comparison) ?? NaN,
    gapUnit: timed ? 's' : 'm', comparison,
    status: member.dnf ? 'DNF' : member.finish != null ? 'FINISHED' : member.connected === false ? 'DISCONNECTED' : 'RACING',
  };
}

const engineFields = ['impactMechanical', 'maxImpactEbs', 'engineDamage', 'engHealth', 'coolantTemp', 'engineStalled', 'drivetrainBroken', 'engineFailureReason', 'mechanicalOverrevRpm'];
// Lightweight cosmetic telemetry rides the existing state cadence; no wheel-force arrays.
export function spectatorState(vehicle) {
  const state = Object.fromEntries(engineFields.filter(k => vehicle[k] !== undefined).map(k => [k, vehicle[k]]));
  for (const [field, key] of [['bodyHeave', 'heave'], ['bodyPitch', 'pitch'], ['bodyRoll', 'roll']]) if (Number.isFinite(vehicle.pose?.[key])) state[field] = vehicle.pose[key];
  state.vy = vehicle.vy || 0; state.bodyDynamic = !!vehicle.bodyDynamic; state.air = !!vehicle.air;
  if (vehicle.rigid) {
    state.bodyQ = vehicle.rigid.q.slice();
    [state.angularX, state.angularY, state.angularZ] = angularVelocity(vehicle);
  }
  const tyres = vehicle.tyreTelemetry;
  if (tyres) {
    const axle = a => Object.fromEntries(['utilization', 'slipDemand', 'saturated', 'sliding', 'contact'].map(k => [k, a[k]]));
    state.tyreTelemetry = { front: axle(tyres.front), rear: axle(tyres.rear), understeer: tyres.understeer };
  }
  return state;
}
export function applySpectatorState(vehicle, snapshot) {
  if (vehicle.pose) for (const [field, key] of [['bodyHeave', 'heave'], ['bodyPitch', 'pitch'], ['bodyRoll', 'roll']]) vehicle.pose[key] = snapshot[field] || 0;
  vehicle.bodyDynamic = snapshot.bodyDynamic === true; vehicle.air = snapshot.air ? 1 : 0;
  vehicle.bodyQ = snapshot.bodyQ || null; vehicle.vy = snapshot.vy || 0;
  vehicle.remoteTyreTelemetry = snapshot.tyreTelemetry || null;
  vehicle.remoteEngineTelemetry = Number.isFinite(snapshot.engHealth);
  for (const key of engineFields) vehicle[key] = snapshot[key];
}

// Resume physical state without copying derived or remote display telemetry.
export function restoreVehicleState(vehicle, state) {
  // Initialise the new damage object's caches before restoring mechanical telemetry;
  // damageFx on resume must not erase the engine state it has just received.
  if (state.damage && typeof vehicle.damageFx === 'function') {
    vehicle.damage = { ...state.damage }; vehicle.damageFx();
  }
  for (const [key, value] of Object.entries(state)) {
    if (key === 'damage' && state.damage && typeof vehicle.damageFx === 'function') continue;
    if (key === 'tyreTelemetry' || key === 'remoteTyreTelemetry') continue;
    let owner = vehicle, descriptor;
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
      owner = Object.getPrototypeOf(owner);
    }
    // Restore plain writable data only; never invoke an accessor setter.
    if (descriptor && (!('value' in descriptor) || !descriptor.writable)) continue;
    vehicle[key] = value;
  }
  if (typeof vehicle.step === 'function') restoreRigidState(vehicle, state);
  return vehicle;
}
