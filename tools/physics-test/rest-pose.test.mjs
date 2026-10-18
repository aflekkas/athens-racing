import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const {Vehicle}=await import('../../src/physics.js');
const OWNER='Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const MAX_PITCH_DEG=.5;
// Car specs are lifted from src/cars.js source, as the headless handling bench does (no three.js / models needed).
const src=readFileSync(new URL('../../src/cars.js',import.meta.url),'utf8'),arr=src.slice(src.indexOf('export const CARS = [')+'export const CARS = '.length);
let depth=0,end=0;for(let i=0;i<arr.length;i++){if(arr[i]==='[')depth++;else if(arr[i]===']'&&--depth===0){end=i+1;break;}}
const CARS=new Function('return '+arr.slice(0,end))();
const road=grade=>({GR:'GR',frame:(s,o)=>Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade,bank:0}),point:(s,u)=>({x:u,z:-s,y:grade*s}),y:s=>grade*s,surfaceY:s=>grade*s,urban:()=>1,edge:()=>900,lin:a=>a==='GR'?grade:0,project:(x,z)=>({s:-z,u:x})});
test('every car settles level at rest on flat ground and on a slope (the suspension adds no static pitch)',()=>{
 for(const grade of [0,.08])for(const spec of CARS){
  const car=new Vehicle(spec,road(grade));car.reset(100,0,0);for(let i=0;i<420;i++)car.update(1/60,{throttle:0,brake:0,steer:0});
  const pitch=car.pose.pitch*180/Math.PI,roll=car.pose.roll*180/Math.PI;
  assert.ok(Math.abs(pitch)<MAX_PITCH_DEG,`${spec.id} on a ${grade*100}% road rests ${pitch.toFixed(2)} degrees nose-${pitch>0?'up':'down'} relative to the road. ${OWNER}`);
  assert.ok(Math.abs(roll)<MAX_PITCH_DEG,`${spec.id} rests ${roll.toFixed(2)} degrees rolled. ${OWNER}`);
  assert.ok(Math.abs(car.pose.heave)<.03,`${spec.id} rests ${car.pose.heave.toFixed(3)} m off its static ride height. ${OWNER}`);
 }
});

// The visual attitude is the slope under the CAR, not the route's own gradient: a car pointing against the route
// direction (Psychiko starts reversed) used to pitch the wrong way, sinking its front wheels into the road and floating
// the tail ~20 cm up on a 7.5% street.
const place=car=>{const o={position:{set(){}},rotation:{x:0,z:0,set(x){this.x=x;}}};car.place(o);return o.rotation;};
test('the placed body pitches and banks with the slope along and across the car, whichever way it faces the route',()=>{
 const grade=.08,slope=Math.atan(grade)*180/Math.PI;
 for(const spec of CARS)for(const [name,yaw,pitch,bank] of [['along the route',0,slope,0],['against the route',Math.PI,-slope,0],['across the route',Math.PI/2,0,slope]]){
  const car=new Vehicle(spec,road(grade));car.reset(100,0,0);car.yaw=yaw;for(let i=0;i<120;i++)car.update(1/60,{throttle:0,brake:0,steer:0});
  const r=place(car),p=r.x*180/Math.PI,b=Math.abs(r.z*180/Math.PI);
  assert.ok(Math.abs(p-pitch)<.3,`${spec.id} facing ${name} on an 8% climb pitches ${p.toFixed(2)} degrees, ground says ${pitch.toFixed(2)}. ${OWNER}`);
  assert.ok(Math.abs(b-Math.abs(bank))<.3,`${spec.id} facing ${name} banks ${b.toFixed(2)} degrees, ground says ${Math.abs(bank).toFixed(2)}. ${OWNER}`);
 }
});
