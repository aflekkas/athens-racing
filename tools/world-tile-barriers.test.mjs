import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldTileBarriers} from '../src/world-tile-barriers.js';
import {Vehicle} from '../src/physics.js';
import {catalogue} from './physics-test/powertrain.mjs';
import {flatAirborneRoute} from './physics-test/airborne-scenarios.mjs';
const speed=150/3.6;
function barriers(){const b=new WorldTileBarriers();b.install('bridge',{metadata:{origin:[0,0,0],rails:[[0,0,-200,0,0,200,.65]]}});return b;}
for(const angle of [Math.PI/2,Math.PI/18])for(const dt of [1/240,1/15]){
  test(`guarded bridge: actual Vehicle 150 km/h ${angle===Math.PI/2?'head-on':'glancing'} hit at ${1/dt} Hz cannot clip or launch`,()=>{
    const b=barriers(),v=new Vehicle(catalogue().find(c=>c.id==='carrera'),flatAirborneRoute);v.roadZ=()=>0;
    v.x=-6;v.z=30;v.yaw=-angle;v.vLong=speed;v.syncWheels();let hits=0,minX=Infinity,maxHeight=0,maxVertical=0;
    for(let i=0;i<Math.ceil(4/dt);i++){
      const old={x:v.x,y:v.y,z:v.z,yaw:v.yaw};v.update(dt,{throttle:0,brake:0,steer:0});
      const beforeY=v.y,beforeVy=v.vy;hits+=+b.resolve(v,old);
      assert.equal(v.y,beforeY);assert.equal(v.vy,beforeVy,'barrier never injects vertical speed');
      const extent=Math.abs(Math.sin(v.yaw))*v.halfL+Math.abs(Math.cos(v.yaw))*v.halfW;
      assert.ok(v.x+extent<=-.15+1e-5,'entire oriented body stays inside visible rail');
      minX=Math.min(minX,v.x);maxHeight=Math.max(maxHeight,v.y);maxVertical=Math.max(maxVertical,Math.abs(v.vy||0));
    }
    assert.ok(hits>0);assert.ok(maxHeight<.1);assert.ok(maxVertical<.1);assert.ok(minX>-20);
    // A square hit is a stop and a small bounce (restitution ~0.1 at this speed, src/crash-contact.js), not a dead stop on the rail: the car
    // ends well under 15 % of its approach speed and has come back past where it started.
    if(angle===Math.PI/2){assert.ok(Math.hypot(v.vLong,v.vLat)<speed*.15);assert.ok(v.x<-6,'bounced back off the rail');}
  });
}
test('guardrail sweep catches a complete crossing and ignores cars in the underpass',()=>{
 const b=barriers(),v={x:15,z:0,y:0,yaw:-Math.PI/2,halfL:2.5,halfW:1,vLong:speed,vLat:0,w:0};
 assert.ok(b.resolve(v,{x:-15,z:0,y:0,yaw:v.yaw}));assert.ok(v.x+v.halfL<-.15);
 v.x=15;v.y=-6;v.vLong=speed;assert.equal(b.resolve(v,{x:-15,z:0,y:-6,yaw:v.yaw}),false);
 b.remove('bridge');v.y=0;assert.equal(b.resolve(v,{x:-15,z:0,y:0,yaw:v.yaw}),false);
});
test('rotating rear corners cannot pass through a bridge rail',()=>{
 const b=barriers(),v={x:-1.2,z:0,y:0,yaw:-Math.PI/4,halfL:2.5,halfW:1,vLong:0,vLat:0,w:2};
 assert.ok(b.resolve(v,{x:-1.2,z:0,y:0,yaw:0}));assert.equal(v.yaw,0);assert.ok(v.x+v.halfW<-.15);
});
