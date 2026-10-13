import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { CARS, routes, driveCorner } from './driver-feel.mjs';
import { Vehicle } from '../../src/physics.js';
import { RivalAI, vehicleCapabilities } from '../../src/rival-ai.js';
import { WEATHER, advanceRoadWetness, wetGripAt, wetPeakScale } from '../../src/wet-grip.js';
const dry = () => Object.assign(WEATHER, { wet: 0, rain: 0, gripScale: 1 });
const wet = () => { dry(); advanceRoadWetness(240, 1); };
const report=[];
test('wetness builds with rain intensity, dries slowly, and puddles/paint/kerbs are slipperier', () => {
  try {
    dry(); advanceRoadWetness(10, .5); assert.ok(WEATHER.wet > .1 && WEATHER.wet < .5);
    advanceRoadWetness(240, 1); assert.ok(Math.abs(WEATHER.gripScale - .76) < .001);
    const asphalt = wetGripAt('asphalt', { puddle: 0 });
    assert.ok(asphalt >= .75 && asphalt <= .78);
    assert.ok(wetGripAt('asphalt', { puddle: 1 }) < asphalt * .85);
    assert.ok(wetGripAt('asphalt', { puddle: 0, paint: true }) < asphalt * .8);
    assert.ok(wetGripAt('pavement', { puddle: 0 }) < asphalt * .9);
    assert.ok(wetPeakScale('asphalt') > 1.1);
    advanceRoadWetness(10,0); assert.ok(WEATHER.wet > .8, 'water remains after rain stops');
    advanceRoadWetness(1000,0); assert.ok(WEATHER.gripScale > .999);
  } finally { dry(); }
});
test('wet driver-feel corners: all six cars, three maps, 60/90/120 km/h; aids remain stable', () => {
  try {
    for (const {def,route} of routes) for (const car of CARS) for (const kmh of [60,90,120]) {
      dry();const a=driveCorner(car,route,kmh);
      wet();const b=driveCorner(car,route,kmh);
      const label=`${def.id}/${car.id}/${kmh}`, ratio=b.maxG/a.maxG;
      assert.ok(ratio > .55 && ratio < .9, `${label} wet peak ratio ${ratio}`);
      assert.ok(b.trace.every(t=>Number.isFinite(t.pathG)&&Math.abs(t.betaDeg)<20), `${label} wet stability`);
      assert.ok(b.trace.every(t=>t.driftLatch===0), `${label} no accidental drift mode`);
      report.push({map:def.id,car:car.id,kmh,dryG:a.maxG,wetG:b.maxG,ratio,maxBeta:Math.max(...b.trace.map(t=>Math.abs(t.betaDeg)))});
    }
  } finally { dry(); mkdirSync('.scratch/modes-v3',{recursive:true});writeFileSync('.scratch/modes-v3/wet-driver-feel.json',JSON.stringify(report,null,2)); }
});
test('wet rival scenario: capability-based brake/corner profile slows before the bends', () => {
  const route=routes[0].route;
  try {
    for(const car of CARS){
      dry();const vehicle=new Vehicle(car,route);vehicle.reset(route.start+100,route.laneU(route.start+100,0),25);
      const caps=vehicleCapabilities(vehicle),d={lat:caps.lat(25),brake:caps.brake(25)};
      const ai=new RivalAI(route,vehicle,{perfect:true}),a=ai.line.speedProfile(vehicle);
      wet();const w={lat:caps.lat(25),brake:caps.brake(25)},b=ai.line.speedProfile(vehicle);
      assert.ok(w.lat<d.lat*.85,car.id+' live lateral capability');assert.ok(w.brake<d.brake*.9,car.id+' live braking capability');
      const curved=[];for(let i=0;i<a.length;i++)if(Math.abs(ai.line.k[i])>.004)curved.push(b[i]/a[i]);
      assert.ok(curved.reduce((s,r)=>s+r,0)/curved.length<.94,car.id+' slower wet bend profile');
      const input=ai.update(1/60);assert.ok(Number.isFinite(input.steer));
    }
  }finally{dry();}
});
