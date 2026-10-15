import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../../src/physics.js';
import { powertrainFor, shiftSchedule } from '../../src/transmission.js';
import { catalogue, flatRoute, validatePowertrain } from './powertrain.mjs';
const cars = catalogue(), pedal = { throttle: 1, brake: 0, steer: 0 };
const mk = (id, overrides = {}) => new Vehicle({ ...cars.find(c => c.id === id), ...overrides }, flatRoute);
function run(v, seconds, input = pedal, hz = 240) { for (let i = 0; i < Math.ceil(seconds * hz); i++) v.update(1 / hz, input); }

test('every trim has complete plausible powertrain parameters', () => {
  assert.ok(cars.length >= 52);
  for (const spec of cars) assert.deepEqual(validatePowertrain(spec), []);
});
test('validation rejects omissions, diesel overspeed, excessive rev rise and the wrong shift duration', () => {
  const spec = cars.find(c => c.id === 'taxi'), pt = powertrainFor(spec);
  assert.ok(validatePowertrain({ ...spec, engine: 'unknown-future-engine' }).length);
  assert.match(validatePowertrain({ ...spec, id: 'future-trim', powertrain: undefined }).join(), /missing/);
  for (const bad of [{ redlineRpm: 7000 }, { maxFreeRevRate: 8000 }, { shiftTime: .4 }, { inertia: .01 }, { spoolTime: 0 }, { idleRpm: undefined }])
    assert.ok(validatePowertrain(spec, { ...pt, ...bad }).length, JSON.stringify(bad));
});
test('heavy diesel free-revs slower than NA sports; both obey their class rate', () => {
  const times = {};
  for (const id of ['octavia_16tdi','e36_m3']) {
    const v = mk(id); v.setManual(true);
    let t = 0, previous = v.rpm, peak = 0;
    while (v.rpm < 4000 && t < 3) {
      v.update(1 / 240, { ...pedal, clutch: 1 }); t += 1 / 240;
      peak = Math.max(peak, (v.rpm - previous) * 240); previous = v.rpm;
    }
    assert.ok(v.rpm >= 4000); assert.ok(peak <= v.powertrain.maxFreeRevRate + 1e-5);
    assert.ok(v.kmh < .1); times[id] = t;
  }
  assert.ok(times.octavia_16tdi > times.e36_m3 * 1.5, JSON.stringify(times));
});
test('no-load limiter cuts and refires repeatedly rather than clamping rpm', () => {
  const v = mk('e36_m3'); v.setManual(true); run(v, 4, { ...pedal, clutch: 1 });
  let low = Infinity, high = 0, cuts = 0, firing = 0;
  for (let i = 0; i < 480; i++) { v.update(1 / 240, { ...pedal, clutch: 1 }); low = Math.min(low, v.rpm); high = Math.max(high, v.rpm); cuts += +v.limiter; firing += +!v.limiter; }
  assert.ok(cuts && firing && high - low > 150); assert.ok(high < v.powertrain.limiterRpm + 80);
  assert.ok(v.powertrainEvents.some(e => e.type === 'limiter-hit'));
});
test('gearbox equipment controls duration and torque handover independently of Auto / Manual policy', () => {
  const ratios = {};
  for (const id of ['cle200','huracan','golf_gti']) {
    const v = mk(id); v.setManual(true); v.reset(0, 0, 50 / 3.6); v.gear = 2; v.syncWheels();
    run(v, .05); const before = v.engT; assert.equal(v.shiftManual(1), true);
    const start = v.shiftStartEvent; assert.equal(start.gearboxType, v.powertrain.gearboxType);
    assert.equal(start.duration, v.powertrain.shiftTime); run(v, .04); ratios[id] = v.engT / before;
    run(v, v.powertrain.shiftTime); assert.equal(v.gear, 3); assert.equal(v.shiftEndEvent.type, 'shift-end');
    assert.ok(v.shiftEndEvent.serial > start.serial); assert.equal(v.gearChangeEvent.from, start.from); assert.equal(v.gearChangeEvent.to, start.to);
    assert.ok(v.shiftEndEvent.time - start.time >= start.duration - 1 / 240);
  }
  assert.equal(ratios.golf_gti, 0); assert.ok(ratios.huracan > .75); assert.ok(ratios.cle200 > .3 && ratios.cle200 < ratios.huracan);
});
test('9G converter creeps, slips at launch and locks once moving; manual stays still at idle', () => {
  const auto = mk('cle200'), manual = mk('golf_gti'), coast = { throttle: 0, brake: 0, steer: 0 };
  run(auto, 2, coast); run(manual, 2, coast);
  assert.ok(auto.kmh > .5 && auto.kmh < 9); assert.equal(manual.kmh, 0); assert.ok(auto.converterSlip > 0);
  run(auto, 12); assert.ok(auto.converterLocked); assert.equal(auto.converterSlip, 0);
  auto.reset(0, 0); run(auto, 2, { ...coast, brake: .4 }); assert.ok(auto.kmh < .1);
});
test('turbo retains lag while naturally aspirated engines have no synthetic boost', () => {
  const turbo = mk('golf_gti'), na = mk('e36_m3');
  for (const v of [turbo,na]) { v.setManual(true); v.rpm = 3500; run(v, .1, { ...pedal, clutch: 1 }); }
  assert.ok(turbo.boost > 0 && turbo.boost < .5); assert.equal(na.boost, 0);
  run(turbo, 1, { ...pedal, clutch: 1 }); assert.ok(turbo.boost > .8);
});
test('throttle/load shift scheduling separates cruise, hill load and WOT with downshift hysteresis', () => {
  for (const spec of cars) {
    const pt = powertrainFor(spec), cruise = shiftSchedule(pt,.15), hill = shiftSchedule(pt,.15,.85), full = shiftSchedule(pt,1);
    assert.ok(cruise.up < hill.up && hill.up < full.up); assert.ok(full.up < pt.redlineRpm);
    assert.ok(cruise.down < cruise.up * .8); assert.ok(full.down < full.up * .65);
  }
  const v = mk('cle200'); run(v, 12, { ...pedal, throttle: .25 }); const gear = v.gear;
  run(v, .8); assert.ok(v.gear < gear || v.pendingGear < gear && v.pendingGear > 0, `kickdown from ${gear} to ${v.gear}/${v.pendingGear}`);
});
test('overrun and serialised sound events survive render-frame boundaries and reset removes stale events', () => {
  const v = mk('golf_gti'); v.setManual(true); v.reset(0,0,80 / 3.6); v.gear = 3; v.syncWheels();
  run(v,.1,{ throttle:0,brake:0,steer:0 }); assert.ok(v.powertrainSignals.overrun); assert.ok(v.load < 0);
  v.shiftManual(1); run(v,1); const events = v.powertrainSignals.events;
  assert.ok(events.some(e=>e.type==='shift-start')); assert.ok(events.some(e=>e.type==='shift-end'));
  assert.ok(events.every((e,i)=>!i || e.serial > events[i-1].serial)); const serial = events.at(-1).serial;
  v.reset(0,0); assert.equal(v.powertrainSignals.events.length,0); v.shiftManual(1); assert.ok(v.shiftStartEvent.serial > serial);
});

test('turbo torque plateau survives sparse catalogue anchors; NA torque stays peaked', () => {
  for (const spec of cars) {
    const v = new Vehicle(spec, flatRoute); v.boost = 1;
    if (v.powertrain.torquePlateau) {
      const [a,b] = v.powertrain.torquePlateau;
      for (const rpm of [a,(a+b)/2,b]) assert.ok(Math.abs(v.torqueMax(rpm) / spec.torque - 1) < .001, spec.id);
    }
  }
  const na = mk('carrera'); na.boost = 1;
  assert.ok(na.torqueMax(2000) < na.torqueMax(5600) * .8);
});
test('manual clutch hold extends torque interruption; rev matching is optional', () => {
  const v = mk('golf_gti'); v.setManual(true); v.reset(0,0,60/3.6); v.gear=3; v.syncWheels();
  v.shiftManual(-1); run(v,.5,{ ...pedal,clutch:1 }); assert.equal(v.gear,2); assert.equal(v.engT,0);
  run(v,.1); assert.ok(v.engT > 0);
  const a=mk('e36_m3'),b=mk('e36_m3');
  for (const q of [a,b]) { q.setManual(true);q.reset(0,0,65/3.6);q.gear=3;q.syncWheels();run(q,.1); }
  b.revMatch=true; a.shiftManual(-1); b.shiftManual(-1);
  run(a,.2,{ throttle:0,brake:0,steer:0 });run(b,.2,{ throttle:0,brake:0,steer:0 });
  assert.ok(b.rpm > a.rpm + 500);
});

test('PDK/DSG and converter automatics protect unsafe paddle downshifts even in Manual policy', () => {
  for (const id of ['taxi','huracan','cle200']) {
    const v=mk(id);v.setManual(true);v.reset(0,0,130/3.6);v.gear=2;v.syncWheels();
    assert.equal(v.shiftManual(-1),false);assert.equal(v.shiftFeedback.reason,'overrev_protection');assert.equal(v.pendingGear,0);
  }
});

test('heavy braking downshifts safely instead of applying the light-throttle anti-hunting ceiling', () => {
  const v=mk('cle200');v.setManual(false);v.reset(0,0,100/3.6);v.gear=4;v.syncWheels();
  v.update(1/240,{throttle:0,brake:1,steer:0});
  assert.equal(v.pendingGear,3);assert.ok(v.shiftStartEvent);assert.ok(v.powertrainSignals.rpm < v.spec.redline);
});
