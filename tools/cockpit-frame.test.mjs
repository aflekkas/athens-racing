import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {CARS,CarModel,Cockpit} from './vehicle-budget-support.mjs';
import {windscreenGlass,closedCockpit,HEADER_BAND_NDC} from '../src/cockpit-structure.js';
import {DEFAULTS} from '../src/settings.js';
import {OWNER_VEHICLE_DECISION as WHY} from '../src/vehicle-budgets.js';
// Cockpit pillars and header must sit on the body's own windscreen frame. A bowed screen has its highest vertices at
// the centre line; building the frame from "the highest row" bent both pillars inwards across the view.
const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const GLASS_EXEMPT=new Set(['mirror-mount','wiper','deck']); // the rear-view stalk, wiper blades and the bonnet seen through the glass legitimately appear in it
function glassPoints(model){
 const glass=windscreenGlass(model);assert.ok(glass,model.spec.id+' has no windscreen glass to frame. '+WHY);
 model.root.updateMatrixWorld(true);const p=glass.geometry.attributes.position,out=[];
 for(let i=0;i<p.count;i++)out.push(model.body.worldToLocal(glass.localToWorld(v().fromBufferAttribute(p,i))));
 return out;
}
function corners(points){
 const box=new T.Box3().setFromPoints(points),mid=(box.min.y+box.max.y)/2,low=points.filter(p=>p.y<mid),high=points.filter(p=>p.y>=mid);
 const edge=(rows,s)=>rows.reduce((a,p)=>s*p.x>s*a.x?p:a);
 return {bl:edge(low,-1),br:edge(low,1),tl:edge(high,-1),tr:edge(high,1),box};
}
function beamEnds(mesh,model){
 mesh.updateWorldMatrix(true,false);const h=mesh.geometry.parameters.height/2;
 return [v(0,-h,0),v(0,h,0)].map(p=>model.body.worldToLocal(p.applyMatrix4(mesh.matrixWorld)));
}
function meshPoints(mesh,model){
 mesh.updateWorldMatrix(true,false);const a=mesh.geometry.attributes.position,out=[];
 for(let i=0;i<a.count;i++)out.push(model.body.worldToLocal(v().fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld)));
 return out;
}
function hull(points){
 const pts=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lower=[],upper=[];
 for(const p of pts){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
 for(const p of pts.reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const distanceInside=(poly,p)=>Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length],e=b.clone().sub(a);return (e.x*(p.y-a.y)-e.y*(p.x-a.x))/e.length();}));
test('every player configuration frames its windscreen with pillars and a header that follow the glass edge',()=>{
 assert.ok(CARS.length>=78,'expected every player configuration, got '+CARS.length);
 for(const spec of CARS){
  const model=new CarModel(spec),cockpit=new Cockpit(spec,model);cockpit.setVisible(true);const points=glassPoints(model),{bl,br,tl,tr,box}=corners(points),id=spec.id;
  const pillars=[],headers=[];cockpit.structure.traverse(o=>{if(o.userData.cockpitStructure==='pillar')pillars.push(o);if(o.userData.cockpitStructure==='header')headers.push(o);});
  assert.equal(pillars.length,2,id+' needs two pillars. '+WHY);assert.equal(headers.length,1,id+' needs one header. '+WHY);
  for(const [pillar,low,high] of [[pillars.find(p=>p.position.x<0),bl,tl],[pillars.find(p=>p.position.x>0),br,tr]]){
   assert.ok(pillar,id+' missing a pillar on one side. '+WHY);
   const [a,b]=beamEnds(pillar,model).sort((p,q)=>p.y-q.y),edge=high.clone().sub(low),axis=b.clone().sub(a);
   assert.ok(a.distanceTo(low)<.05,`${id}: pillar foot ${a.toArray().map(x=>x.toFixed(2))} is ${a.distanceTo(low).toFixed(3)} m from the glass corner ${low.toArray().map(x=>x.toFixed(2))}. ${WHY}`);
   // the pillar leaves the glass top corner no further than a short frame extension, and never leans inboard of it beyond the edge's own taper
   assert.ok(b.distanceTo(high)<.26,`${id}: pillar top is ${b.distanceTo(high).toFixed(3)} m off the glass top corner (bent beam). ${WHY}`);
   const sideways=Math.sign(high.x)*(b.x-high.x);assert.ok(sideways>-.06,`${id}: pillar top leans ${(-sideways).toFixed(3)} m inboard of the glass edge. ${WHY}`);
   const angle=T.MathUtils.radToDeg(axis.angleTo(edge));assert.ok(angle<5,`${id}: pillar is ${angle.toFixed(1)} degrees off the windscreen edge. ${WHY}`);
   const along=edge.clone().normalize(),off=a.clone().sub(low).addScaledVector(along,-a.clone().sub(low).dot(along)).length();
   assert.ok(off<.04,`${id}: pillar runs ${off.toFixed(3)} m beside the glass edge. ${WHY}`);
  }
  const [hl,hr]=beamEnds(headers[0],model).sort((p,q)=>p.x-q.x);
  assert.ok(Math.abs(hl.x-tl.x)<.14&&Math.abs(hr.x-tr.x)<.14,`${id}: header spans ${hl.x.toFixed(2)}..${hr.x.toFixed(2)}, glass top is ${tl.x.toFixed(2)}..${tr.x.toFixed(2)}. ${WHY}`);
  assert.ok(Math.abs(hl.y-hr.y)<.02&&Math.abs(hl.z-hr.z)<.02,`${id}: header is not level across the car. ${WHY}`);
  assert.ok(Math.min(hl.y,hr.y)>=box.max.y-.01,`${id}: header (${hl.y.toFixed(3)}) cuts into the bowed glass top (${box.max.y.toFixed(3)}). ${WHY}`);
  assert.ok(Math.min(hl.y,hr.y)<box.max.y+.3,`${id}: header floats ${(hl.y-box.max.y).toFixed(3)} m above the glass. ${WHY}`);
  cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
test('nothing but the mirror stalk and wipers crosses the windscreen aperture seen from the driver\'s eye',()=>{
 for(const spec of CARS){
  const model=new CarModel(spec),cockpit=new Cockpit(spec,model),eye=cockpit.eye,id=spec.id;cockpit.setVisible(true);model.root.updateMatrixWorld(true);
  const project=p=>{const d=eye.z-p.z;return d>.05?v((p.x-eye.x)/d,(p.y-eye.y)/d,0):null;};
  const aperture=hull(glassPoints(model).map(project).filter(Boolean));assert.ok(aperture.length>=3,id+' windscreen is not in front of the eye. '+WHY);
  cockpit.structure.traverse(o=>{
   const role=o.userData.cockpitStructure;if(!o.isMesh||!role||GLASS_EXEMPT.has(role))return;
   const samples=o.geometry.parameters?.height?(()=>{const [a,b]=beamEnds(o,model);return [0,.25,.5,.75,1].map(t=>a.clone().lerp(b,t));})():meshPoints(o,model);
   for(const p of samples){const q=project(p);if(!q)continue;
    // the frame sits on the glass edge: its axis may reach the boundary, never run well inside it
    assert.ok(distanceInside(aperture,q)<.03,`${id}: ${role} (${p.toArray().map(x=>x.toFixed(2))}) crosses the windscreen aperture by ${(distanceInside(aperture,q)*100).toFixed(1)}% of a metre of view. ${WHY}`);}
  });
  cockpit.disposeMirrors();model.disposeDamage?.();
 }
});

test('every closed car shows a thin header band across the top of the default POV frame (convertibles keep the frame top edge only)',()=>{
 const camera=new T.PerspectiveCamera(DEFAULTS.cockpitFov,1.6,.035,100);let closed=0;
 for(const spec of CARS){
  const model=new CarModel(spec),cockpit=new Cockpit(spec,model),id=spec.id;cockpit.setVisible(true);model.root.updateMatrixWorld(true);
  const header=cockpit.structure.getObjectByName('cockpit-header');assert.ok(header,id+' has no header. '+WHY);
  if(!closedCockpit(model))continue;
  if(['van','truck','bus'].includes(spec.nativeFleet))continue; // van / truck / bus windscreens are taller than the frame: their roof is out of view by construction
  closed++;
  camera.position.copy(cockpit.eye);camera.rotation.set(cockpit.eyePitch,0,0);camera.updateMatrixWorld(true);
  const [a,b]=beamEnds(header,model),half=header.geometry.parameters.width/2;
  // lower edge of the band along its length, seen from the seated eye: the part inside the frame is a thin top band
  let inside=0;
  for(let i=0;i<=20;i++){
   const p=a.clone().lerp(b,i/20);p.y-=half;const ndc=p.project(camera);
   if(Math.abs(ndc.x)>1)continue;inside++;
   assert.ok(ndc.y<.985,`${id}: header lower edge at NDC y ${ndc.y.toFixed(3)} is out of the top of the default frame, the roof is missing. ${WHY}`);
   assert.ok(ndc.y>.6,`${id}: header lower edge at NDC y ${ndc.y.toFixed(3)} is a thick beam across the view, not a thin band. ${WHY}`);
  }
  assert.ok(inside>=6,`${id}: only ${inside}/21 header samples fall inside the default frame. ${WHY}`);
  cockpit.disposeMirrors();model.disposeDamage?.();
 }
 assert.ok(closed>=50,'expected most configurations to be closed cars, got '+closed);
});
