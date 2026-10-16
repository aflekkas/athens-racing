import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { CARS, CarModel, Cockpit } from './vehicle-budget-support.mjs';
import { loadMap } from '../src/map.js';
import * as EV from '../src/events.js';
import { EventMarkers } from '../src/event-markers.js';
import { Vehicle } from '../src/physics.js';
import { DEFAULTS } from '../src/settings.js';
import { gantryLegFrame, megaraGantryPier } from '../src/gantry-legs.js';
import { soloStartPosition, raceGridSlot } from '../src/start-placement.js';

// Project each real leg's box into the central view, then raycast the overlap.
// Sampling in each projected box catches thin posts that a coarse screen grid misses.
function obstruction(camera, legs) {
  const ray = new THREE.Raycaster(), v = new THREE.Vector3(); ray.far = 20;
  for (const leg of legs) {
    leg.geometry.computeBoundingBox(); const b = leg.geometry.boundingBox;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,front=false;
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
      v.set(x,y,z).applyMatrix4(leg.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if(v.z<0)front=true; v.applyMatrix4(camera.projectionMatrix);
      minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);
    }
    if(!front)continue;
    minX=Math.max(-.9,minX);maxX=Math.min(.9,maxX);minY=Math.max(-.8,minY);maxY=Math.min(.85,maxY);
    if(minX>maxX||minY>maxY)continue;
    for(let x=0;x<=8;x++)for(let y=0;y<=8;y++){
      ray.setFromCamera(new THREE.Vector2(minX+(maxX-minX)*x/8,minY+(maxY-minY)*y/8),camera);
      const hit=ray.intersectObject(leg,false)[0];if(hit&&hit.distance<20)return hit.distance;
    }
  }
  return null;
}
function dispose(root){root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material)){m.map?.dispose();m.dispose();}});}

test('every map, event spawn and eight grid slots keep gantry legs outside the near cockpit view', async()=>{
  const priorFetch=globalThis.fetch,priorLocation=globalThis.location,fixtures=[];
  globalThis.fetch=async url=>new Response(readFileSync(resolve(import.meta.dirname,'..',String(url))));globalThis.location={search:''};
  try {
    for(const id of ['riviera','penteli','megara','psychiko']){
      const map=await loadMap(undefined,'./',id,{preload:false}),route=map.route,scene=new THREE.Group(),mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
      if(id==='riviera'||id==='psychiko'){
        scene.add(gantryLegFrame(route,route.start,mat));if(!route.closed)scene.add(gantryLegFrame(route,route.finish,mat));else route.fixedGantries=[route.start];
      }else if(id==='megara'){
        const p=megaraGantryPier(route,route.start),leg=new THREE.Mesh(new THREE.BoxGeometry(p.width,p.height,p.depth),mat);leg.name='gantry-leg';leg.position.set(p.x,p.y,p.z);leg.rotation.y=p.yaw;scene.add(leg);route.fixedGantries=[route.start];
      }
      const ctx={map,mapId:id,route,marks:map.data.marks,events:map.events},defs=[EV.freeRoam(id),...EV.getEvents(id)];
      for(const def of defs){
        const r=EV.resolve(def,ctx),world=scene.clone(),markers=new EventMarkers(world,route);
        if(def.type!=='free')markers.build(r,{start:id==='riviera'?route.start:NaN,finish:id==='riviera'?route.finish:NaN});
        world.updateMatrixWorld(true);const legs=[];world.traverse(o=>{if(o.name==='gantry-leg')legs.push(o);});
        fixtures.push({id,def,r,route,legs,world});
      }
    }
  } finally {globalThis.fetch=priorFetch;globalThis.location=priorLocation;}
  let checks=0,legacyHit=false;
  for(const spec of CARS){
    const model=new CarModel(spec),cockpit=new Cockpit(spec,model,null),camera=new THREE.PerspectiveCamera(DEFAULTS.cockpitFov,16/9,.03,500);
    for(const f of fixtures){
      const {route,r,def}=f,veh=new Vehicle(spec,route);
      const positions=[soloStartPosition(route,r.s0,r.dir,def.type==='free')];
      if(def.type!=='free')for(let i=0;i<8;i++)positions.push(raceGridSlot(route,r.s0,r.dir,i,spec.length));
      function view(p){veh.reset(p.s,p.u,0);if(r.dir<0)veh.yaw+=Math.PI;veh.place(model.root);model.root.updateMatrixWorld(true);camera.position.copy(model.body.localToWorld(cockpit.eye.clone()));model.body.getWorldQuaternion(camera.quaternion);camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(cockpit.eyePitch??-.045,0,0,'YXZ')));camera.updateMatrixWorld(true);return obstruction(camera,f.legs);}
      for(const [i,p] of positions.entries()){
        const distance=view(p);assert.equal(distance,null,`${f.id}/${def.id}/${spec.id}/slot${i}: gantry leg ${distance}m in central cockpit view`);checks++;
      }
      if(f.id==='riviera'&&def.type==='free'&&spec.id==='mini')legacyHit=view({s:r.s0-4,u:route.laneU(r.s0-4,1)})!==null;
    }
    dispose(model.root);
  }
  assert.ok(legacyHit,'regression fixture must detect the original MINI start post');
  console.log(`Gantry clearance: ${checks} real-cockpit/map/event/slot checks; legacy MINI obstruction detected.`);
});

test('live spawn and gantry builders use the guarded helpers',()=>{
  const source=n=>readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
  assert.match(source('main.js'),/soloStartPosition\(route, base, dir, def\.type === 'free'/);
  assert.match(source('main.js'),/return raceGridSlot\(route, base, G\.ev\.r\.dir/);
  assert.match(source('road.js'),/gantryLegFrame\(route, s,/);
  assert.match(source('event-markers.js'),/gantryLegFrame\(route, s, poleM, 'event', dir\)/);
  assert.match(source('maps/megara.js'),/megaraGantryPier\(route, startS\)/);
});
