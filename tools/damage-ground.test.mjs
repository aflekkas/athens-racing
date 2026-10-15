// Real Ground contact paths; only its browser-only road builder is stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ground } from '../src/ground.js';
import { Vehicle } from '../src/physics.js';
const frame=(s,out={})=>Object.assign(out,{tx:0,tz:-1,rx:1,rz:0,grade:0});
const route={length:1000,closed:false,frame,edge:()=>7,medHalf:()=>0,div:()=>0,urban:()=>1,point:(s,u)=>({x:u,y:0,z:-s}),project:(x,z)=>({s:-z,u:x}),surfaceY:()=>0,y:()=>0,bank:()=>0};
const spec={mass:1500,wheelbase:2.6,width:1.84,length:4.4,wheelR:.33,drive:'fwd',engine:'turbo4',idle:800,gears:[3.5,2,1],final:4.1};
const mk=()=>{const v=new Vehicle(spec,route);v.reset(200,2,0);return v;};
function ground(){const g=Object.create(Ground.prototype);g.route=route;g.out={};g.limits=()=>({min:-100,max:100});g.walls=()=>null;g.at=(x,z,s,u,out={})=>Object.assign(out,{y:0,hump:0,surf:'asphalt',water:0});return g;}

test('actual wall normals at 10/20/40/70 km/h distinguish head-on from glancing contacts',()=>{
 for(const kmh of [10,20,40,70])for(const angle of [0,30,60,80]){
  const v=mk(),g=ground(),a=angle*Math.PI/180;v.vLong=kmh/3.6;
  g._hit(v,Math.sin(a),Math.cos(a),.01,undefined,{kind:'wall'});
  assert.equal(v.engineStalled,false);
  if(kmh<=40 || angle>=60)assert.equal(v.impactMechanical,0);
  else assert.ok(v.impactMechanical>0);
  if(kmh===10)assert.deepEqual(v.damage,{front:0,rear:0,left:0,right:0});
 }
});

test('real kerb climb, glancing tyre rub and drop never create a crash',()=>{
 for(const [long,lat]of [[20,12],[30,2],[20,-12]]){
  const g=ground(),v=mk();v.u=7.18-v.track/2+.02;v.x=v.u;v.vLong=long;v.vLat=lat;v._curbZ=[0,lat<0?2:0,0,lat<0?2:0];
  if(lat<0){v.u-=.04;v.x=v.u;}
  let calls=0;const add=v.addDamage.bind(v);v.addDamage=(...args)=>{calls++;return add(...args);};
  g._curbs(v);assert.ok(v.curbHit>0,'exercise the actual kerb impulse');assert.equal(calls,0);assert.equal(v.lastDamage,null);assert.equal(v.engHealth,1);assert.equal(v.impactMechanical,0);
 }
});

test('landing after a crest uses suspension/ground contact, never engine damage',()=>{
 const g=ground(),v=mk();v.vLong=70/3.6;v.air=1;v.yAir=.01;v.vy=-12;
 let calls=0;v.addDamage=()=>{calls++;};g.resolve(v,1/60);
 assert.equal(v.air,0);assert.ok(v.bumpHit>0);assert.equal(calls,0);assert.equal(v.lastDamage,null);assert.equal(v.engHealth,1);assert.equal(v.impactMechanical,0);
 // Repeated suspension inputs and flat ground bumps stay outside the crash budget.
 for(let i=0;i<100;i++){v.wheelBump=[.16,0,.16,0];v.stepSuspension(1/120,0,0,1,v.wheelBump,10);}
 assert.equal(v.impactMechanical,0);assert.equal(v.engineStalled,false);
});

test('small solid bollard hits are cosmetic; a nose-first large solid hit still matters',()=>{
 const g=ground(),v=mk();v.vLong=20/3.6;g._hit(v,0,1,.02,undefined,{kind:'bollard'});
 assert.ok(v.damage.front>0&&v.damage.front<.05);assert.equal(v.impactMechanical,0);assert.equal(v.engHealth,1);
 v.reset(200,2,70/3.6);g._hit(v,0,1,.02,undefined,{kind:'bollard'});assert.ok(v.impactMechanical>.3);
});

test('a sustained 90 km/h barrier scrape ignores tangential speed and cannot damage the engine',()=>{
 const g=ground(),v=mk();for(let i=0;i<200;i++){v.vLong=90/3.6;v.vLat=2/3.6;v.w=0;g._hit(v,-1,0,.01);}
 assert.deepEqual(v.damage,{front:0,rear:0,left:0,right:0});assert.equal(v.impactMechanical,0);assert.equal(v.maxImpactEbs,0);assert.equal(v.lastDamage,null);assert.equal(v.engHealth,1);
});


test('tyre barriers absorb speed with less rebound and damage, and deliver the actual impact impulse', () => {
  const concrete = mk(), tyre = mk(), g = ground(); concrete.vLong = tyre.vLong = 20;
  let impact;
  g._hit(concrete, 0, 1, .01, undefined, {kind:'wall'});
  g._hit(tyre, 0, 1, .01, undefined, {kind:'tyre', restitution:.08, damageScale:.35, onImpact: hit => { impact = hit; }});
  assert.equal(impact.speed, 20); assert.equal(impact.vz, -20);
  assert.ok(Math.abs(tyre.vLong) < Math.abs(concrete.vLong));
  assert.ok(tyre.damage.front < concrete.damage.front);
  assert.ok(Math.abs(tyre.vLong) < 2);
});
