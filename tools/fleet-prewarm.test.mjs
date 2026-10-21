import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAFFIC_TYPES} from './vehicle-budget-support.mjs';
const {fleetTemplateSet}=await import('../src/traffic-fleet.js');
import {packFleetTemplate,unpackFleetTemplate} from '../src/fleet-template-codec.js';
const {Traffic}=await import('../src/traffic.js');
import * as T from 'three';

const create=document.createElement;
document.createElement=tag=>{const canvas=create(tag),ctx=canvas.getContext('2d');ctx.getImageData=()=>({width:canvas.width,height:canvas.height,data:new Uint8ClampedArray(canvas.width*canvas.height*4)});return canvas;};
test('worker fleet packets preserve native geometry, transforms, material properties and semantic references',()=>{
 for(const type of TRAFFIC_TYPES.filter(t=>(t.w>0&&!t.bus&&!t.scooter)||t.id==='police'))for(const source of fleetTemplateSet(type)){
  const packet=structuredClone(packFleetTemplate(source)),steps=unpackFleetTemplate(packet);let result;do{result=steps.next();}while(!result.done);const restored=result.value.car;
  const a=[],b=[];source.car.root.traverse(o=>a.push(o));restored.root.traverse(o=>b.push(o));assert.equal(a.length,b.length,type.id);
  for(let i=0;i<a.length;i++){assert.equal(a[i].name,b[i].name);assert.deepEqual(a[i].position.toArray(),b[i].position.toArray());assert.deepEqual(a[i].quaternion.toArray(),b[i].quaternion.toArray());assert.deepEqual(a[i].scale.toArray(),b[i].scale.toArray());assert.deepEqual(a[i].userData,b[i].userData);if(!a[i].isMesh)continue;for(const k of Object.keys(a[i].geometry.attributes))assert.deepEqual(a[i].geometry.attributes[k].array,b[i].geometry.attributes[k].array);assert.deepEqual(a[i].geometry.index?.array,b[i].geometry.index?.array);for(const k of ['color','emissive','roughness','metalness','opacity','transparent','side'])assert.deepEqual(a[i].material[k],b[i].material[k]);}
  assert.equal(restored.body.userData.fleetNode,source.car.body.userData.fleetNode);assert.equal(restored.wheels.length,source.car.wheels.length);for(let i=0;i<restored.wheels.length;i++)assert.equal(restored.wheels[i].pivot.userData.fleetNode,source.car.wheels[i].pivot.userData.fleetNode);
  assert.equal(result.value.cabin?.key,source.cabin?.key);
 }
});
test('deferred streamed pool creates no models until iterated and preserves deterministic population',()=>{
 const scene=new T.Scene(),pool=new Traffic(scene,{closed:true},{},{poolSize:24,policePoolSize:5,roadVehiclesOnly:true,deferBuild:true,buildProxies:false});assert.equal(scene.children.length,0);let count=0;for(const step of pool.build)if(step.type)count++;assert.equal(count,29);assert.equal(pool.cars.length,29);assert.equal(pool.cars.filter(c=>c.police).length,5);assert.equal(pool.proxies,null);assert.ok(pool.cars.every(c=>!c.m.root.visible));
});
