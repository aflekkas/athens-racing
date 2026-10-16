import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {loadMap} from '../../../src/map.js';
import {buildTerrain} from '../../../src/terrain.js';
import {RoadNetwork} from '../../../src/road-network-surface.js';
import {poses} from './measure.mjs';
globalThis.fetch=async u=>new Response(readFileSync(String(u)));globalThis.location={search:''};
const map=await loadMap(undefined,'./','megara',{preload:false}),network=new RoadNetwork(map);
const ter=buildTerrain(map.terrain,map.route,[],new THREE.Group(),{coastal:false,farmland:true,network});
const camera=new THREE.PerspectiveCamera(60,1.6,.2,16000),pose=poses(map)[2],renderer={getDrawingBufferSize:v=>v.set(960,600)};
camera.position.fromArray(pose.eye);camera.lookAt(...pose.target);camera.updateMatrixWorld();
ter.group.traverse(m=>{if(m.isMesh)m.onBeforeRender(renderer,null,camera);});
let checked=0,maxError=0;
for(const mesh of ter.group.children){if(!mesh.userData.terrainRefinement)continue;
 for(const patch of mesh.terrainLodState.patches){if(!patch.current||!patch.visible)continue;
  const p=mesh.geometry.attributes.position,ids=patch.levels[0].indices,a=ids[0],b=ids[1],c=ids[2];
  const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3,expected=(p.getY(a)+p.getY(b)+p.getY(c))/3;
  const actual=map.terrain.refinedHeight(x,z);assert.equal(patch.current,0);
  const g=mesh.geometry,index=g.index.array;let found=false;
  for(let k=g.drawRange.start;k<g.drawRange.start+g.drawRange.count;k+=3)if(index[k]===a&&index[k+1]===b&&index[k+2]===c){found=true;break;}
  assert.ok(found,'the exact sampled triangle must be in the active draw buffer');
  const error=Math.abs(actual-expected);assert.ok(error<.001,`contact/render error ${error}`);maxError=Math.max(maxError,error);checked++;
  if(checked===32)break;
 }if(checked===32)break;
}
assert.equal(checked,32);const result={map:'megara',checked,maxError,description:'Queries restore only their patch before sampling, and each exact sampled triangle is present in the current active draw buffer.'};
writeFileSync('.scratch/perf-2026-10-15/terrain/lod2-contact-check.json',JSON.stringify(result,null,2));console.log(result);
