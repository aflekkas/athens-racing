// node --import ./tools/damage-test-register.mjs --test tools/car-surface.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCarSurface, CAR_SURFACE_BYTES } from '../src/car-surface.js';
import { installDamageSystem } from '../src/damage.js';
import { Vehicle } from '../src/physics.js';
const route = { frame: () => ({ tx: 0, tz: -1 }), point: (s, u) => ({ x: u, y: 0, z: -s }) };
const spec = { mass: 1500, wheelbase: 2.6, width: 1.84, length: 4.4, wheelR: .33, drive: 'fwd', engine: 'turbo4', idle: 800, gears: [3.5, 2, 1], final: 4.1 };
function fixture() {
  const root = new THREE.Group(), body = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: '#b51c28' }); root.add(body);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, .7, 4.4, 4, 2, 8), paint); panel.position.y = .55; body.add(panel);
  const base = installDamageSystem({ root, body, paint, dims: { L: 4.4, W: 1.84, H: 1.5 }, wheels: [] });
  const originalGraph=[]; root.traverse(o=>originalGraph.push(o));
  const originalGeometry=panel.geometry, originalMaterial=panel.material;
  const car = installCarSurface(base);
  const v = new Vehicle(spec, route); v.wheelSurf = ['dirt', 'dirt', 'dirt', 'dirt']; v.vLong = 20; for (const c of v.corners) c.Fz = 3500;
  car.updateSurface(0, v); return { car, v, panel, originalGraph, originalGeometry, originalMaterial };
}
function compile(car) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  car.paint.onBeforeCompile(shader); return shader;
}
const hit = { localPoint: { x: -.9, y: .55, z: -.3 }, localNormal: { x: 1, y: 0, z: 0 }, ebs: 8 };
test('only supported loose-surface contacts accumulate bounded deterministic dirt', () => {
  const {car,v} = fixture(); v.wheelSurf = ['dirt', 'asphalt', 'sand', 'grass']; v.corners[2].Fz = 0;
  car.updateSurface(.1,v); assert.deepEqual(car.surface.dirt.toArray(), [2/230,0,0,.9/230]);
  const before = car.surface.dirt.toArray(); v.air=1; car.updateSurface(.1,v); v.air=0;v.bodyDynamic=true;car.updateSurface(.1,v);v.bodyDynamic=false;v.vLong=0;car.updateSurface(.1,v);
  assert.deepEqual(car.surface.dirt.toArray(),before);
  v.vLong=20;for(let i=0;i<10000;i++)car.updateSurface(.1,v);
  assert.deepEqual(car.surface.dirt.toArray(),[.8,0,0,.8]);car.disposeDamage();
});
test('real Vehicle.reset clears dirt with no damage and clears impact wear after recovery', () => {
  const {car,v}=fixture();car.updateSurface(.1,v);assert.ok(car.surface.dirt.x>0);
  v.reset(0,0);car.updateSurface(.1,v);assert.deepEqual(car.surface.dirt.toArray(),[0,0,0,0]);
  v.addDamage('left',8,hit);car.setDamage('left',v.damage.left,hit);assert.ok(car.surface.scuffs[2].w>0);
  v.reset(0,0);car.setDamage('left',v.damage.left);car.updateSurface(.1,v);
  assert.ok(car.surface.scuffs.every(p=>p.w===0));assert.deepEqual(car.surface.dirt.toArray(),[0,0,0,0]);car.disposeDamage();
});
test('scuffs follow impact zone and point; full repair removes dirt and scuffs', () => {
  const {car,v}=fixture();car.updateSurface(.1,v);car.setDamage('left',.3,hit);
  assert.deepEqual(car.surface.scuffs[2].toArray(),[-.9,.55,-.3,.42]);assert.ok(car.surface.scuffs.filter((p,i)=>i!==2).every(p=>p.w===0));
  car.setDamage('left',0);assert.ok(car.surface.scuffs.every(p=>p.w===0));assert.deepEqual(car.surface.dirt.toArray(),[0,0,0,0]);car.disposeDamage();
});
test('online snapshots and World detail Off hide private wear without wire fields', () => {
  const {car,v}=fixture();car.updateSurface(.1,v);car.setDamage('left',.3,hit);
  car.setDamageSnapshot({left:.3});assert.equal(car.surface.size.w,0);const dirt=car.surface.dirt.toArray();
  car.updateSurface(.1,v,true,true);assert.equal(car.surface.size.w,0);assert.deepEqual(car.surface.dirt.toArray(),dirt);
  car.updateSurface(0,v,false,false);assert.equal(car.surface.size.w,0);
  car.updateSurface(0,v,true,false);assert.equal(car.surface.size.w,1);car.disposeDamage();
});
test('shared shader program key keeps uniforms private and never recompiles for wear', () => {
  const a=fixture(),b=fixture(),sa=compile(a.car),sb=compile(b.car),key=a.car.paint.customProgramCacheKey(),version=a.car.paint.version;
  assert.equal(key,b.car.paint.customProgramCacheKey());assert.notEqual(sa.uniforms.carDirt.value,sb.uniforms.carDirt.value);assert.notEqual(sa.uniforms.carScuffs.value,sb.uniforms.carScuffs.value);
  for(let i=0;i<300;i++)a.car.updateSurface(.1,a.v,i%2===0,i%3===0);
  a.car.setDamage('left',.3,hit);assert.equal(a.car.paint.version,version);assert.equal(a.car.paint.customProgramCacheKey(),key);
  assert.deepEqual(b.car.surface.dirt.toArray(),[0,0,0,0]);assert.ok(b.car.surface.scuffs.every(p=>p.w===0));
  assert.ok(sa.vertexShader.includes('carSurfaceInverse * modelMatrix'));assert.ok(sa.fragmentShader.includes('carSurfaceSize.w > 0.5'));
  a.car.disposeDamage();b.car.disposeDamage();
});
test('surface installation adds no objects, geometry, materials, textures or paint changes', () => {
  const {car,v,panel,originalGraph,originalGeometry,originalMaterial}=fixture(),geometry=originalGeometry,material=originalMaterial,color=material.color.getHex(),rough=material.roughness;
  const before=originalGraph;const bytes=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0);
  for(let i=0;i<400;i++)car.updateSurface(.1,v);
  const after=[];car.root.traverse(o=>after.push(o));assert.deepEqual(after,before);assert.equal(panel.geometry,geometry);assert.equal(panel.material,material);assert.equal(material.map,null);assert.equal(material.color.getHex(),color);assert.equal(material.roughness,rough);
  assert.equal(Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0),bytes);assert.equal(CAR_SURFACE_BYTES,160);
  assert.equal(installCarSurface(car),car);car.disposeDamage();assert.equal(car.surface.size.w,0);
});
test('nonfinite input never poisons the bounded cosmetic state', () => {
  const {car,v}=fixture();v.vLong=Infinity;car.updateSurface(NaN,v);car.setDamage('left',.2,{localPoint:{x:NaN,y:Infinity,z:0}});
  assert.ok([...car.surface.dirt.toArray(),...car.surface.scuffs.flatMap(p=>p.toArray())].every(Number.isFinite));car.disposeDamage();
});

test('snapshot-only free-roam rendering consumes each real local impact and clears it on reset', () => {
  const {car,v}=fixture();v.addDamage('left',8,hit);car.setDamageSnapshot(v.damage);
  assert.equal(car.surface.scuffs[2].w,0);car.updateSurface(0,v,true,false);
  assert.ok(car.surface.scuffs[2].w>0);assert.deepEqual(car.surface.scuffs[2].toArray().slice(0,3),[-.9,.55,-.3]);
  const contact=car.surface.scuffs[2].toArray();v.lastDamage.localPoint.x=.9;
  car.updateSurface(0,v,true,false);assert.deepEqual(car.surface.scuffs[2].toArray(),contact,'same serial cannot relocate the scuff');
  v.reset(0,0);car.setDamageSnapshot(v.damage);car.updateSurface(0,v,true,false);assert.ok(car.surface.scuffs.every(p=>p.w===0));car.disposeDamage();
});
