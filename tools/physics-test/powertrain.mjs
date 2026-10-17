import { readFileSync } from 'node:fs';
import { powertrainFor } from '../../src/transmission.js';
export function catalogue() {
  const source = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
  return Function('return ' + source.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
}
export const flatRoute = { GR: null,
  frame: (s, o) => Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }),
  point: (s, u) => ({ x: u, z: -s, y: 0 }), y: () => 0, surfaceY: () => 0,
  urban: () => 1, edge: () => 900, lin: () => 0, project: (x, z) => ({ s: -z, u: x }) };
export function validatePowertrain(spec, pt = powertrainFor(spec)) {
  const heavy=['bus','van','truck'].includes(spec.vehicleClass),electric=!!spec.electric,bike=!!spec.twoWheeler;
  const errors = [], fail = message => errors.push(`${spec.id}: ${message}`);
  if (!pt) return [`${spec.id}: missing powertrain parameters`];
  for (const field of ['idleRpm','redlineRpm','limiterRpm','inertia','maxFreeRevRate','spoolTime','engineBraking','shiftTime'])
    if (!Number.isFinite(pt[field])) fail(`missing/invalid ${field}`);
  if (spec.idle !== pt.idleRpm || spec.redline !== pt.redlineRpm || spec.shiftT !== pt.shiftTime) fail('literal legacy rpm/shift fields disagree with powertrain');
  if (pt.idleRpm < (electric?0:heavy?500:bike?900:600) || pt.idleRpm > (electric?50:bike?2000:1100)) fail('idle outside 600–1100 rpm');
  if (!['turbov6','turbov8','turbov12','v8na','v8flat','na3','na4','na6','turbo3','turbo4','turbo5','turbo6','flat6','v10','v12','diesel','bike','electric'].includes(spec.engine)) fail('unknown engine class requires explicit validation bounds');
  const turbo = /^turbo/.test(spec.engine), diesel = spec.engine === 'diesel';
  const highTurbo = ['gr_yaris','gla45','cla45s'].includes(spec.id);
  const highNA = ['v8flat','flat6'].includes(spec.engine) || ['v10','v12'].includes(spec.engine) || spec.id === 'e36_m3';
  const [lo, hi] = spec.engine==='v8flat'?[7400,7900]:spec.engine==='v8na'?[6200,6800]:spec.engine==='turbov12'?[5800,6500]:electric?[10000,20000]:bike?[8000,12000]:heavy?[2000,4500]:diesel ? [4500,5000] : highTurbo ? [6500,7400] : turbo ? [6000,7100] :
    ['v10','v12'].includes(spec.engine) ? [8000,8700] : spec.engine === 'flat6' ? [7500,8200] : spec.id === 'e36_m3' ? [7300,7800] : [6000,7000];
  if (pt.redlineRpm < lo || pt.redlineRpm > hi) fail(`redline outside engine range ${lo}–${hi}`);
  if (pt.limiterRpm < pt.redlineRpm || pt.limiterRpm > pt.redlineRpm + 250) fail('limiter must be within 250 rpm above redline');
  if (pt.inertia < (bike?.02:electric?.08:.12) || pt.inertia > (heavy?2:.5) || diesel && pt.inertia < .30) fail('implausible engine/flywheel inertia');
  const maxRate = electric?12000:bike?9000:diesel ? 3500 : highNA ? 9000 : highTurbo ? 7000 : 6000;
  if (pt.maxFreeRevRate < (heavy?700:2000) || pt.maxFreeRevRate > maxRate) fail(`free-rev rate outside class (2000–${maxRate} rpm/s)`);
  if (pt.spoolTime < 0 || pt.spoolTime > 1.2 || !(turbo || diesel) && pt.spoolTime !== 0 || (turbo || diesel) && spec.hybrid?.simulation !== 'charged-blended-curve' && pt.spoolTime < .15) fail('spool time inconsistent with engine');
  if (pt.engineBraking < .08 || pt.engineBraking > .25) fail('implausible engine braking');
  const shiftRange = { amt: [.16,.25], manual: [.30,.50], automatic: [.25,.40], dct: [.08,.15] }[pt.gearboxType];
  if (!shiftRange || pt.shiftTime < shiftRange[0] || pt.shiftTime > shiftRange[1]) fail('shift time inconsistent with gearbox type');
  if ({ AMT: 'amt', MT: 'manual', AT: 'automatic', DCT: 'dct', CVT:'automatic', 'SINGLE SPEED':'automatic' }[spec.gearbox] !== pt.gearboxType) fail('literal gearbox disagrees with powertrain');
  if ((turbo || diesel) && spec.hybrid?.simulation !== 'charged-blended-curve' && (!Array.isArray(pt.torquePlateau) || pt.torquePlateau.length !== 2 || !pt.torquePlateau.every(Number.isFinite) || pt.torquePlateau[0] < pt.idleRpm || pt.torquePlateau[1] <= pt.torquePlateau[0] || pt.torquePlateau[1] >= pt.redlineRpm)) fail('missing/invalid turbo torque plateau');
  if (typeof pt.torqueConverter !== 'boolean') fail('missing converter policy');
  if (typeof pt.revMatch !== 'boolean') fail('missing revMatch policy');
  return errors;
}
