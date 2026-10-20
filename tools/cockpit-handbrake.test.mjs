import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {buildHandbrake,hasElectricHandbrake,HANDBRAKE_REST,HANDBRAKE_PULLED} from '../src/cockpit-handbrake.js';
import {CARS,CarModel,Cockpit} from './vehicle-budget-support.mjs';
import {CAR_MODELS} from '../src/car-catalog.js';
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md, "Handbrake shown in the cabin"): the cabin's handbrake visibly moves while it is held.
globalThis.Image??=class{set src(v){}}; // the cluster's lamp art needs an image constructor; Node has none
const tip=hb=>{hb.group.updateMatrixWorld(true);return hb.grip.getWorldPosition(new T.Vector3());};
test('a mechanical handbrake lever swings up to its stop while held and drops back on release',()=>{
  const hb=buildHandbrake(new T.Group(),{id:'mini_jcw'},new T.Vector3(.09,.5,.3));assert.equal(hb.kind,'lever');
  hb.update(0,false);const rest=tip(hb);assert.equal(hb.pivot.rotation.x,HANDBRAKE_REST);
  for(let i=0;i<30;i++)hb.update(1/60,true);const pulled=tip(hb);
  assert.ok(Math.abs(hb.pivot.rotation.x-HANDBRAKE_PULLED)<.02,'reaches the pulled stop within half a second');
  assert.ok(pulled.y-rest.y>.1,'the grip rises by a hand\'s breadth (>10 cm)');assert.ok(hb.pull>.99);
  for(let i=0;i<30;i++)hb.update(1/60,false);assert.ok(Math.abs(hb.pivot.rotation.x-HANDBRAKE_REST)<.02,'returns on release');assert.ok(tip(hb).distanceTo(rest)<.01);
  hb.update(1/60,true);assert.ok(hb.pivot.rotation.x>HANDBRAKE_REST+.1,'moves at once, with no dead zone');
});
test('an electric parking brake has a button that sinks and lights red while held, and goes dark on release',()=>{
  const hb=buildHandbrake(new T.Group(),{id:'golf_r'},new T.Vector3(.09,.5,.3));assert.equal(hb.kind,'button');
  hb.update(0,false);const dark=hb.lamp.color.clone(),up=hb.grip.position.y;
  for(let i=0;i<30;i++)hb.update(1/60,true);
  assert.ok(hb.lamp.color.r>.95&&hb.lamp.color.g<.1&&hb.lamp.color.b<.1,'a lit red lamp');assert.ok(hb.lamp.color.r>dark.r*3);assert.ok(hb.grip.position.y<up-.004,'the button is pressed in');
  for(let i=0;i<30;i++)hb.update(1/60,false);assert.ok(hb.lamp.color.r<.3);assert.ok(Math.abs(hb.grip.position.y-up)<5e-4);
});
test('every kept car has a handbrake control in its cockpit, lever or button by car, and it follows the held handbrake',()=>{
  const state=(handbrake)=>({steerInput:0,kmh:0,rpm:900,redline:6500,gearLabel:'N',gear:0,ignition:true,handbrake,vehicle:{}});
  for(const m of CAR_MODELS){
    const spec=CARS.find(c=>c.id===m.car),car=new CarModel(spec),cockpit=new Cockpit(spec,car);
    assert.ok(cockpit.handbrake,m.car+' has a handbrake control');assert.equal(cockpit.handbrake.kind,hasElectricHandbrake(spec)?'button':'lever',m.car);
    for(let i=0;i<30;i++)cockpit.update(1/60,state(true));assert.ok(cockpit.handbrake.pull>.99,m.car+' pulled');
    for(let i=0;i<30;i++)cockpit.update(1/60,state(false));assert.ok(cockpit.handbrake.pull<.01,m.car+' released');
    cockpit.disposeMirrors();car.disposeDamage?.();
  }
});
