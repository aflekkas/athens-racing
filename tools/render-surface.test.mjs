import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { coarseTerrainSampler } from '../src/terrain-surface.js';
import {readFileSync} from 'node:fs';

test('coarse beach contacts match rendered triangles, including a lowered seam and both diagonals', () => {
  for (const heights of [[.2,2,1,.5],[2,.2,.5,1]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,heights[0],0,40,heights[1],0,0,heights[2],40,40,heights[3],40],3));
    geometry.setIndex(Math.abs(heights[0]-heights[3])<Math.abs(heights[1]-heights[2])?[0,2,1,1,2,3]:[0,2,3,0,3,1]);
    const mesh = new THREE.Mesh(geometry); mesh.userData.coarseTerrain=true;
    const group = new THREE.Group(); group.add(mesh); group.updateMatrixWorld(true);
    const sample = coarseTerrainSampler({GX:9,GZ:9,minX:0,minZ:0,T:10},group);
    const ray = new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
    for(const x of [2,13,27,38])for(const z of [3,17,29,37]){
      ray.ray.origin.set(x,10,z);const y=ray.intersectObject(mesh)[0].point.y;
      assert.ok(Math.abs(sample(x,z)-y)<1e-5);
    }
    assert.equal(sample(60,20),null,'an omitted coarse cell must not become a phantom surface');
  }
});

test('owner lock removes beach furniture and furniture-dependent anchors',()=>{
 for(const p of ['../src/nature.js','../src/people.js'])assert.doesNotMatch(readFileSync(new URL(p,import.meta.url),'utf8'),/sunbeds|beachBedPose|umbrellaGeo|parasolGeo/,'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.');
});

test('a hole surrounded by refined vertices is not a refined contact cell', async () => {
  const {installTerrainRefinement}=await import('../src/terrain-refinement.js');
  const p=[],index=[];
  for(let z=0;z<4;z++)for(let x=0;x<4;x++)p.push(x*10,1,z*10);
  for(let z=0;z<3;z++)for(let x=0;x<3;x++){
    if(x===1&&z===1)continue;
    const a=z*4+x;index.push(a,a+4,a+1,a+1,a+4,a+5);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setIndex(index);
  const group=new THREE.Group(),mesh=new THREE.Mesh(geo);mesh.userData.terrainRefinement=1;group.add(mesh);
  const terrain={minX:0,minZ:0,T:10,GX:4,GZ:4};installTerrainRefinement(terrain,group);
  assert.equal(terrain.refinedHeight(5,5),1);
  assert.equal(terrain.refinedHeight(15,15),null);
});
