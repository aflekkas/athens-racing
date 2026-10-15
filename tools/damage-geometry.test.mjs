// node --import ./tools/damage-test-register.mjs --test tools/damage-geometry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDamageSystem } from '../src/damage.js';
import { Vehicle } from '../src/physics.js';
const route = { frame: () => ({ tx: 0, tz: -1 }), point: (s,u) => ({ x:u,y:0,z:-s }) };
const spec = { mass:1500,wheelbase:2.6,width:1.84,length:4.4,wheelR:.33,drive:'fwd',engine:'turbo4',idle:800,gears:[3.5,2,1],final:4.1 };
function model({ bakedMirror = false } = {}) {
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);
  const paint=new THREE.MeshStandardMaterial(),panel=new THREE.Mesh(new THREE.BoxGeometry(1.8,.6,4.4,8,4,24),paint);panel.position.y=.55;body.add(panel);
  const bumper=new THREE.Group();bumper.name='bumper_f';bumper.position.set(0,.5,-2.15);bumper.add(new THREE.Mesh(new THREE.BoxGeometry(1.6,.2,.15,8,4,4),paint));body.add(bumper);
  if(bakedMirror){const tag=new THREE.Group();tag.userData.mirrorAssembly=true;tag.userData.mirrorRoot=[-.9,.8,-.5];tag.userData.mirrorTipOffset=[0,0,0];body.add(tag);}
  return installDamageSystem({ root,body,paint,dims:{L:4.4,W:1.84,H:1.5},wheels:[] });
}
test('online absolute damage produces identical geometry after different impact histories and clocks', () => {
  const a=model(),b=model();
  a.setDamage('front',.3,{localPoint:{x:-.6,y:.8,z:-2},ebs:16});a.setDamage('front',.64,{localPoint:{x:.5,y:.6,z:-2},ebs:12});
  b.setDamage('front',.64,{localPoint:{x:.1,y:.4,z:-2},ebs:20});b.setDamage('right',.2,{ebs:8});
  const snapshot={front:.64,rear:.13,left:.28,right:.42};a.setDamageSnapshot(snapshot);b.setDamageSnapshot(snapshot);
  for(let i=0;i<11;i++)a.updateDamage(.1);b.updateDamage(.01);
  assert.deepEqual(a.damageMeshes.map(m=>Array.from(m.geometry.attributes.position.array)),b.damageMeshes.map(m=>Array.from(m.geometry.attributes.position.array)));
  const parts=c=>c.damageParts.map(p=>({id:p.id,state:p.state,visible:p.node.visible,position:p.node.position.toArray(),rotation:p.node.rotation.toArray()}));
  assert.deepEqual(parts(a),parts(b));assert.equal(a.damageDebris.length+b.damageDebris.length,0);
  a.setDamageSnapshot({});b.setDamageSnapshot({});assert.deepEqual(a.damage,b.damage);a.disposeDamage();b.disposeDamage();
});
test('a physical wall crash produces visible deformation, broken parts and repairable state', () => {
  const car=model(),v=new Vehicle(spec,route),rest=car.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());
  v.addDamage('front',60/3.6,{kind:'wall'});
  assert.ok(v.damage.front>.2);assert.ok(v.lastDamage);
  assert.doesNotThrow(()=>car.setDamage('front',v.damage.front,v.lastDamage));
  assert.ok(car.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((n,i)=>Math.abs(n-rest[k][i])>1e-5)),'crash cannot silently stop deforming the rendered car');
  assert.notEqual(car.damageParts.find(p=>p.id==='bumper_f').state,'intact');
  v.reset(0,0);car.setDamage('front',0);
  assert.equal(v.engHealth,1);assert.ok(car.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((n,i)=>Math.abs(n-rest[k][i])<1e-6)));
  car.disposeDamage();
});
test('far traffic baked mirror tags cannot throw and interrupt damage/repair', () => {
  const car=model({bakedMirror:true});
  assert.doesNotThrow(()=>car.setDamage('rear',.5));
  assert.ok(car.damageMeshes.some(m=>m.geometry.attributes.position.needsUpdate || m.geometry.attributes.position.version>0));
  assert.doesNotThrow(()=>car.setDamage('rear',0));car.disposeDamage();
});

test('real traffic fleet near/far graphs survive a crash, isolate geometry and repair',async()=>{
  // Geometry builders only need a canvas texture object; no raster assertions here.
  const previous=globalThis.document,noop=()=>{},gradient={addColorStop:noop};
  const ctx=new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
  try{
    const {TRAFFIC_TYPES,trafficModel}=await import('../src/cars.js'),{RNG}=await import('../src/util.js');
    for(const id of ['police','bus']){
      const type=TRAFFIC_TYPES.find(t=>t.id===id),a=trafficModel(type,type.colors[0],new RNG(41)),b=trafficModel(type,type.colors[0],new RNG(42));
      const rest=a.damageMeshes.map(m=>m.geometry.attributes.position.array.slice()),twin=b.damageMeshes.map(m=>m.geometry.attributes.position.array.slice());
      assert.doesNotThrow(()=>a.setDamage('rear',.5),id+' must not throw after far mirror compaction');
      assert.ok(a.damageMeshes.some((m,k)=>m.geometry.attributes.position.array.some((n,i)=>Math.abs(n-rest[k][i])>1e-5)),id+' must visibly deform');
      assert.ok(b.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((n,i)=>n===twin[k][i])),id+' twin must remain intact');
      assert.doesNotThrow(()=>a.setDamage('rear',0));
      assert.ok(a.damageMeshes.every((m,k)=>m.geometry.attributes.position.array.every((n,i)=>Math.abs(n-rest[k][i])<1e-6)),id+' repair must restore geometry');
      a.disposeDamage?.();b.disposeDamage?.();
    }
  }finally{globalThis.document=previous;}
});
