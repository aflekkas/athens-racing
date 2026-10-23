import './vehicle-budget-support.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {WorldTraffic} from '../src/world-traffic.js';
import {RAGDOLL_CAP,LIFE,STEP} from '../src/impact-ragdoll.js';
const fields=['x','z','y','yaw','vx','vz','vy','age'];
function bike(id=66,x=9000){
 const root=new T.Group(),rider=new T.Group();rider.name='attached-rider';root.add(rider);
 const vehicle={x,y:24,z:18000,yaw:0,vLong:12,vLat:1,w:0,m:320,I:200,halfL:1.15,halfW:.4};
 return {id,type:{id:'police_moto',moto:true},police:true,active:true,len:2.3,wid:.8,mass:320,m:{root},vehicle,point:{edge:'bike-road',layer:1},v:12,riderNode:rider};
}
function fixture(cars=[bike()]){
 const scene=new T.Scene(),queries=[],stream={origin:{x:8704,z:17920},contact(x,z,o){queries.push({x,z,...o});return Math.abs(o.referenceY-24)<Math.abs(o.referenceY)?{y:24,layer:1}:{y:0,layer:0};}};
 const t=new WorldTraffic({stream},scene,{});t.cars=cars;t.pool={damageCar(){}};return {t,scene,stream,queries,c:cars[0]};
}

test('a physical police-bike collision creates a finite quantized world-space rider seed',()=>{
 const {t,c}=fixture();Object.assign(c.vehicle,{vLong:0,vLat:0});
 const actor={veh:{x:9000,y:24,z:18002.6,yaw:0,vLong:20,vLat:0,w:0,m:1400,I:2000,halfL:2.2,halfW:.9},kind:'player'},hits=[];
 t.collide(actor,hits,0);assert.ok(hits.length);assert.ok(c.rider,'actual physical collision ejects the bike rider');assert.deepEqual(Object.keys(c.rider),fields);
 for(const n of Object.values(c.rider)){assert.ok(Number.isFinite(n));assert.ok(Math.abs(n*100-Math.round(n*100))<1e-7);}
 assert.equal(c.rider.x,9000);assert.equal(c.rider.z,Math.round(c.vehicle.z*100)/100);assert.equal(c.rider.y,24);assert.equal(c.rider.yaw,0);assert.equal(c.rider.age,0);
 assert.equal(t.ejectRider(c,20),false,'one crash does not create a second seed');
});

test('replicas cannot create private ejections, and minor hits do not throw riders',()=>{
 const {t,c}=fixture();assert.equal(t.ejectRider(c,2.99),false);t.onlineDriver={id:'guest',player:{},gridSlot:1};assert.equal(t.ejectRider(c,20),false);assert.equal(c.rider,undefined);
 t.onlineAuthority=true;assert.equal(t.ejectRider(c,4),true);assert.equal(t.cars.length,1,'the fleet is not replaced or trimmed');
});

test('world-space launch velocity and absolute yaw round-trip through the eight physical fields',()=>{
 const {t,c}=fixture();Object.assign(c.vehicle,{yaw:1.2345,vLong:10.345,vLat:-2.123});assert.equal(t.ejectRider(c,6),true);
 assert.equal(c.rider.yaw,1.23);assert.equal(c.rider.vx,Math.round((-Math.sin(1.2345)*10.345+Math.cos(1.2345)*-2.123)*100)/100);
 const packet=fields.map(k=>Math.round(c.rider[k]*100)),restored=Object.fromEntries(fields.map((k,i)=>[k,packet[i]/100]));assert.deepEqual(restored,c.rider);assert.ok(packet.every(Number.isSafeInteger));
});

test('late replicas replay the same physical body on the correct ground layer and survive origin rebasing',()=>{
 const a=fixture(),b=fixture();a.t.ejectRider(a.c,6);a.c.rider.age=1.25;a.t.syncRiders();
 b.c.rider={...a.c.rider};b.t.onlineDriver={id:'guest',player:{},gridSlot:1};b.t.syncRiders();assert.deepEqual(b.c.riderBody.p,a.c.riderBody.p);
 assert.ok(a.queries.every(q=>q.x>8000&&q.z>17000&&q.referenceY>20),'ground receives absolute world coordinates and deck-height references');assert.equal(a.c.riderBody.riderReferenceY,24);
 const before=a.c.riderBody.p.slice();a.stream.origin={x:9216,z:18432};a.t.syncRiders();assert.deepEqual(a.c.riderBody.p,before);assert.deepEqual(a.t.riderRoot.position.toArray(),[-9216,0,-18432]);
 assert.equal(a.c.riderNode.visible,false);assert.equal(b.c.riderNode.visible,false);a.t.disposeRiders();b.t.disposeRiders();
});

test('snapshot object replacement and bounded visual extrapolation do not respawn the same ejection',()=>{
 const {t,c}=fixture();t.ejectRider(c,5);c.rider.age=.1;t.onlineDriver={id:'guest',player:{},gridSlot:1};t.syncRiders();const pool=t.riderBodies,spawn=pool.spawn.bind(pool);let spawns=0;pool.spawn=o=>{spawns++;return spawn(o);};const body=c.riderBody;
 t.t=.2;t.syncRiders();const extrapolated=body.age;assert.ok(extrapolated<=.3+STEP);assert.equal(c.rider.age,.1,'visual replay never mutates authority age');
 c.rider={...c.rider,age:.2};t.syncRiders();assert.equal(c.riderBody,body);assert.equal(spawns,0,'a later packet behind extrapolation does not restart the body');
 t.t=20;t.syncRiders();assert.ok(body.age<=.4+STEP,'replica extrapolation is capped at .2 seconds');assert.equal(c.rider.age,.2);t.disposeRiders();
});

test('rider pool eviction remains bounded and expiry/reset restore attached-rider consistency',()=>{
 const f=fixture(Array.from({length:RAGDOLL_CAP+1},(_,i)=>bike(66+i,9000+i*20))),{t}=f;
 for(const c of t.cars)t.ejectRider(c,5);t.syncRiders();assert.equal(t.riderBodies.bodies.length,RAGDOLL_CAP);assert.equal(t.riderBodies.bodies.filter(b=>b.active).length,RAGDOLL_CAP);assert.ok(t.cars.every(c=>c.active&&!c.riderNode.visible));
 let spawns=0;const spawn=t.riderBodies.spawn.bind(t.riderBodies);t.riderBodies.spawn=o=>{spawns++;return spawn(o);};t.syncRiders();assert.equal(spawns,0,'an evicted body stays evicted until a new seed');
 for(const c of t.cars)c.rider.age=LIFE;t.syncRiders();assert.ok(t.riderBodies.bodies.every(b=>!b.active));
 t.clearRiders();assert.ok(t.cars.every(c=>c.rider===null&&c.riderNode.visible));const root=t.riderRoot;t.disposeRiders();assert.equal(root.parent,null);assert.equal(t.riderBodies,null);
});

test('invalid physical seeds never hide an attached rider or allocate a visual pool',()=>{
 const {t,c}=fixture();c.rider={x:NaN,z:18000,y:24,yaw:0,vx:0,vz:0,vy:2,age:0};t.syncRiders();assert.equal(c.riderNode.visible,true);assert.equal(t.riderBodies,undefined);
});

test('only authority physics advances the transported rider age',()=>{
 const {t,c}=fixture();t.session.roads={graph:{edges:new Map()}};t.spawnT=1e9;t.ejectRider(c,5);c.active=false;t.update(.1,{x:9000,y:24,z:18000});assert.equal(c.rider.age,.1);
 t.onlineDriver={id:'guest',player:{},gridSlot:1};const at=t.t;t.update(1,{x:9000,y:24,z:18000});assert.equal(c.rider.age,.1);assert.equal(t.t,at,'replica calls cannot advance private NPC time');
 t.onlineAuthority=true;t.update(20,{x:9000,y:24,z:18000});assert.equal(c.rider.age,LIFE,'transport age is bounded to the existing eight-second lifetime');
});

// The parent integration supplies the physical protocol/adapter; this isolated
// branch still has the legacy protocol. An explicit root also audits that exact
// implementation before integration, without copying or editing its source.
const protocolRoot=process.env.WORLD_TRAFFIC_PROTOCOL_ROOT;
const protocol=await import(protocolRoot?new URL('file://'+protocolRoot+'/src/shared-world-protocol.js').href:'../src/shared-world-protocol.js');
test('physical snapshot boundary preserves the actual world rider seed and deterministic replay',{skip:typeof protocol.packWorldCar!=='function'},async()=>{
 const {Traffic}=await import('../src/traffic.js');
 const {applyWorldTrafficCar}=await import(protocolRoot?new URL('file://'+protocolRoot+'/src/mp-world-traffic.js').href:'../src/mp-world-traffic.js');
 const a=fixture([bike(72)]),b=fixture([bike(72)]);
 for(const f of [a,b]){const c=f.c;Object.assign(c,{dir:1,indL:{},indR:{},flash:{},cop:{siren:true,chase:true,target:1},s:0,u:0});
  f.t.cars=Array.from({length:74},(_,id)=>id===72?c:{id,active:false,m:{root:new T.Group()}});
  f.t.pool={carBody:Traffic.prototype.carBody,initDrive(){},damageCar(){}};f.t.route={project:()=>({s:0,u:0})};f.t.session.roads={graph:{nearest:()=>({edge:'bike-road'}),edges:new Map([['bike-road',{value:{points:[[9000,24,17900],[9000,24,18100]]}}]])}};
 }
 Object.assign(a.c.vehicle,{vLong:0,vLat:0});a.t.collide({veh:{x:9000,y:24,z:18002.6,yaw:0,vLong:20,vLat:0,w:0,m:1400,I:2000,halfL:2.2,halfW:.9},kind:'player'},[],0);assert.ok(a.c.rider);a.c.rider.age=1.25;const row=protocol.packWorldCar(a.t,a.c);assert.equal(row.length,40);assert.ok(protocol.validWorldCarRow(row),'genuine physical ejection must satisfy the real validator');
 assert.ok(row.every(Number.isSafeInteger));assert.equal(row[protocol.WORLD_CAR.CONTACT]&2,2);
 const applied=applyWorldTrafficCar(b.t,row);assert.equal(applied,b.c);assert.deepEqual(b.c.rider,a.c.rider);
 a.t.syncRiders();b.t.onlineDriver={id:'guest',player:{},gridSlot:1};b.t.syncRiders();assert.deepEqual(b.c.riderBody.p,a.c.riderBody.p);
 const body=b.c.riderBody;applyWorldTrafficCar(b.t,row);b.t.syncRiders();assert.equal(b.c.riderBody,body,'real adapter object replacement must not respawn the body');a.t.disposeRiders();b.t.disposeRiders();
});

test('an ejected bike stays a visible stationary wreck instead of rejoining without its rider',()=>{
 const {t,c}=fixture(),edge={id:'bike-road',points:[[9000,24,18100],[9000,24,17900]]};t.t=5;t.session.safePose=()=>true;t.route={project:()=>({s:0,u:0})};
 Object.assign(c,{crashed:true,recoveryT:5,contactAt:-10,v:0});Object.assign(c.vehicle,{vLong:0,vLat:0});t.ejectRider(c,5);c.rider.age=LIFE;
 t.candidate=()=>({...c.vehicle});t.poseBlocked=()=>false;t.recover(c,edge,.1,[]);
 assert.equal(c.crashed,true,'a bike with an ejected driver cannot resume autonomous driving');assert.equal(c.active,true,'a visible wreck must remain present');assert.equal(c.vehicle.vLong,0);
 c.visibilityTracked=true;c.lastSeenAt=0;c.recoveryT=9;t.t=20;assert.equal(t.retireUnseen(c,[{...c.vehicle}]),false,'nearby witnesses protect the bike');
 assert.equal(t.retireUnseen(c,[]),true,'existing unseen-wreck retirement still works');assert.equal(c.active,false);
});
