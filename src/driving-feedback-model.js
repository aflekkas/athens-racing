// UI models only. Physics owns tyre limits, damage and recovery outcomes.
const clamp = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
// ENGINE HOT only once the coolant reaches the temperature where physics starts wearing the engine (engine-abuse.js),
// not on the ordinary warm-up after a knock or a long pull, which players read as a random warning.
export const ENGINE_HOT_C = 125;
export function damageFeedback(vehicle, { spectating = false, towLabel = 'TOW', repairAvailable = false, towCost = '5 seconds' } = {}) {
  if (!vehicle) return { visible: false };
  const damage = clamp(vehicle.engineDamage), health = Number.isFinite(vehicle.engHealth) ? clamp(vehicle.engHealth) : 1 - damage;
  const hot = vehicle.coolantTemp >= ENGINE_HOT_C, stopped = !!(vehicle.engineFailureReason || vehicle.engineStalled || vehicle.drivetrainBroken);
  const bent = vehicle.cornerDamage?.some(d => d > .05);
  const body = !!vehicle.damageSignificant || Object.values(vehicle.damage || {}).some(d => d > .1);
  const impact = clamp(vehicle.impactMechanical);
  if (!(damage > .01 || impact > .01 || health < .99 || hot || stopped || bent || body)) return { visible: false };
  const failure = vehicle.engineFailureReason;
  let cause = failure === 'mechanical_overrev' ? 'Unsafe downshift · mechanical over-rev'
    : failure === 'overheating' ? 'Engine overheated'
    : failure === 'drivetrain' || vehicle.drivetrainBroken ? 'Impact broke the drivetrain'
    : stopped ? 'Impact stopped the engine'
    : hot ? vehicle.radiatorDamage > .1 ? 'Impact damaged the radiator · overheating' : 'Engine overheating'
    : impact > .01 ? 'Crash damage: engine, steering and top speed'
    : damage > .01 ? 'Engine wear from over-rev or heat'
    : body && !bent ? 'Bodywork dented'
    : 'Impact damage';
  if (cause === 'Impact damage' && vehicle.lastDamage?.zone) cause = `${vehicle.lastDamage.zone} impact damage`;
  const top = Math.round(100 * (1 - (1 / (1 + 0.6 * impact)) ** (1 / 3) * (health) ** (1 / 3)));
  const effect = stopped ? 'No engine power' : health < .99 ? `${Math.round(health * 100)}% engine power available${top >= 3 ? ` · top speed −${top}%` : ''}${Math.abs(vehicle.steerPull || 0) > .002 ? ' · steering pulls' : ''}`
    : bent ? 'Wheel damage affects steering' : body ? 'Cosmetic damage · full engine power' : hot ? 'Engine is hot · full power available' : 'Full engine power available';
  const repairAction = spectating ? 'Watching this driver · recovery is their choice'
    : repairAvailable ? 'Tow to the road · damage stays until restart' : 'Recovery unavailable right now';
  return { visible: true, title: stopped ? 'ENGINE DISABLED' : hot ? 'ENGINE HOT' : health <= .55 ? 'LIMP MODE' : body && !bent && health >= .99 ? 'BODY DAMAGE' : 'CAR IMPAIRED', cause, effect, repairAction,
    health, tone: stopped || health < .3 ? 'bad' : 'warn' };
}
