import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as THREE from 'three';
import './vehicle-budget-support.mjs';
import {RoadNetwork} from '../src/road-network-surface.js';
import {loadMap} from '../src/map.js';
import {buildFurniture} from '../src/road.js';
import {buildSpeedSigns} from '../src/speed-signs.js';
import {buildRoadworks} from '../src/roadworks.js';
import {EventMarkers} from '../src/event-markers.js';
import {createRoadsideModels} from '../src/roadside.js';
import {megaraGantryLabels,megaraGantryPier} from '../src/gantry-legs.js';
import {twoSidedSignGeometry} from '../src/sign-mount.js';

// Inspect the actual rendered vertices and instance matrices, not copied mount
// constants. Both outer sides of a two-faced mesh are audited independently.
function instances(root) {
 root.updateMatrixWorld(true);const out=[];
 root.traverse(o=>{if(!o.isMesh)return;for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){
  const matrix=o.matrixWorld.clone();if(o.isInstancedMesh){const m=new THREE.Matrix4();o.getMatrixAt(i,m);matrix.multiply(m);}
  out.push({o,matrix,center:new THREE.Vector3().setFromMatrixPosition(matrix)});
 }});return out;
}
function planes(item){
 const {o,matrix}=item,p=o.geometry.attributes.position,n=o.geometry.attributes.normal,found=new Map();
 if(!n)return [];
 for(let i=0;i<p.count;i++){
  const normal=new THREE.Vector3().fromBufferAttribute(n,i).transformDirection(matrix);
  if(Math.abs(normal.y)>.01)continue;
  const point=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix),distance=point.dot(normal);
  const key=normal.toArray().map(v=>v.toFixed(3)).join(',')+':'+distance.toFixed(3);
  found.set(key,{normal,point});
 }
 return [...found.values()];
}
function clearance(face,post){
 const p=post.o.geometry.attributes.position;let max=-Infinity;
 for(let i=0;i<p.count;i++)max=Math.max(max,new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(post.matrix).sub(face.point).dot(face.normal));
 return -max;
}
function audit(root,label){
 const items=instances(root),faces=items.filter(a=>a.o.material?.map),posts=items.filter(a=>!a.o.material?.map&&a.o.geometry.type==='BoxGeometry'&&a.o.geometry.parameters.height>2*a.o.geometry.parameters.depth);let count=0;
 for(const item of faces){
  // Groups keep individual signs together; instanced signs share a top-level
  // group, so select their physical post by its horizontal centre (<1 metre).
  const supports=posts.filter(p=>p.o.parent===item.o.parent&&(item.o.isInstancedMesh?Math.hypot(p.center.x-item.center.x,p.center.z-item.center.z)<.5:true));
  for(const plane of planes(item))for(const post of supports){
   assert.ok(clearance(plane,post)>.001,`${label}: post crosses face plane (${clearance(plane,post)}m) face=${item.o.position.toArray()} rot=${item.o.rotation.y} normal=${plane.normal.toArray()} post=${post.o.position.toArray()} dims=${JSON.stringify(post.o.geometry.parameters)}`);count++;
  }
 }
 return count;
}
test('all map sign instances and both event directions mount faces beyond actual support surfaces',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=async p=>new Response(readFileSync(resolve(import.meta.dirname,'..',String(p))));globalThis.location={search:''};
 let count=0;
 try{for(const id of ['riviera','penteli','megara','psychiko']){
  const map=await loadMap(undefined,'./',id,{preload:false}),scene=new THREE.Group();
  map.roadNetwork=new RoadNetwork(map);const works=buildRoadworks(map,new THREE.Group(),{heightC:()=>0},{makeLabel:()=>new THREE.Mesh(new THREE.PlaneGeometry(2.6,.65),new THREE.MeshBasicMaterial({map:new THREE.Texture()}))});if(works)count+=audit(works.group,id+' roadworks');buildSpeedSigns(map,scene,()=>0);count+=audit(scene,id+' mapped signs');
  if(id==='megara'){
   const labels=megaraGantryLabels(map.route,map.route.start,()=>new THREE.Mesh(new THREE.PlaneGeometry(5.8,1.05),new THREE.MeshBasicMaterial({map:new THREE.Texture()})));
   const p=megaraGantryPier(map.route,map.route.start),post=new THREE.Mesh(new THREE.BoxGeometry(p.width,p.height,p.depth),new THREE.MeshBasicMaterial());post.position.set(p.x,p.y,p.z);post.rotation.y=p.yaw;labels.add(post);count+=audit(labels,'megara fixed gantry');
   for(const item of instances(labels).filter(a=>a.o.material.map)){const n=planes(item)[0].normal,f=map.route.frame(map.route.start,{});assert.ok(Math.abs(n.x*f.tx+n.z*f.tz)>.9999,'gantry lettering faces either traffic approach');}
  }
  if(id==='riviera'||id==='psychiko'){const furniture=new THREE.Group();buildFurniture(map,furniture,()=>0,{});count+=audit(furniture,id+' furniture');}
  for(const dir of [-1,1]){const events=new EventMarkers(new THREE.Group(),map.route);events.arch(map.route.start,'START','#ffffff',dir);events.camera(map.route.start+30,1,dir);count+=audit(events.group,id+' event '+dir);}
 }}finally{globalThis.fetch=prior;}
 assert.ok(count>200,'must audit all generated instances: '+count);console.log('Actual sign/support face checks:',count);
});
test('bus-stop and parking faces sit ahead of the full pole and panel thickness',()=>{
 const {models}=createRoadsideModels();
 for(const name of ['stop','parking']){
  const model=models[name],face=model.parts.find(p=>p.key==='sign').geometry.attributes.position;
  for(const part of model.parts.filter(p=>p.key!=='sign')){const p=part.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(p.getZ(i)<face.getZ(0),name+' support must be behind face');}
 }
});
test('two-sided lettering has outward normals and winding without mirrored transforms',()=>{
 const g=twoSidedSignGeometry(2,1,.5),p=g.attributes.position,n=g.attributes.normal,idx=g.index;
 for(let i=0;i<idx.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,idx.getX(i)),b=new THREE.Vector3().fromBufferAttribute(p,idx.getX(i+1)),c=new THREE.Vector3().fromBufferAttribute(p,idx.getX(i+2)),normal=new THREE.Vector3().fromBufferAttribute(n,idx.getX(i));assert.ok(b.sub(a).cross(c.sub(a)).dot(normal)>0);assert.ok(a.z*normal.z>.25);}
});
