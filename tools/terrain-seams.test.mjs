import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {coarseTerrainSampler} from '../src/terrain-surface.js';
import {stitchTerrainBoundaries, terrainBoundaryEdges, refinedTerrainBoundary} from '../src/terrain-seams.js';
function grid(x0,step,height){const p=[],ix=[];const n=4/step;for(let z=0;z<=n;z++)for(let x=0;x<=n;x++)p.push(x0+x*step,height(x0+x*step,z*step),z*step);for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x;ix.push(a,a+n+1,a+n+2,a,a+n+2,a+1);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('color',new T.Float32BufferAttribute(p.map(()=>.5),3));g.setAttribute('aU',new T.Float32BufferAttribute(p.filter((_,i)=>i%3===0).map(()=>0),1));g.setIndex(ix);g.computeVertexNormals();return g;}
test('mixed-resolution boundaries are watertight without moving finer road vertices or reversing faces',()=>{
 const coarse=grid(0,4,()=>20),fine=grid(4,1,(x,z)=>3+Math.sin(z)),original=fine.attributes.position.array.slice();
 const {transitions,splitTriangles}=stitchTerrainBoundaries([{geometry:coarse,step:4},{geometry:fine,step:1}]);assert.ok(splitTriangles>0);assert.deepEqual(fine.attributes.position.array,original);
 const meshes=[coarse,fine,...transitions].map(g=>new T.Mesh(g,new T.MeshBasicMaterial()));let area=0;
 for(const m of meshes){const p=m.geometry.attributes.position,ix=m.geometry.index.array;for(let i=0;i<ix.length;i+=3){const [a,b,c]=ix.slice(i,i+3);const cross=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));assert.ok(cross>0,'all terrain faces must point upwards');area+=cross/2;}}
 assert.equal(area,32,'transition tessellation preserves coverage without overlap');
 const ray=new T.Raycaster();const sample=(x,z)=>{ray.set(new T.Vector3(x,100,z),new T.Vector3(0,-1,0));const hits=ray.intersectObjects(meshes);assert.ok(hits.length,'missing terrain coverage');return hits[0].point.y;};
 const group=new T.Group();group.add(...meshes);const contact=coarseTerrainSampler({GX:9,GZ:5,T:1,minX:0,minZ:0},group);
 for(let x=.125;x<8;x+=.25)for(let z=.125;z<4;z+=.25)assert.ok(Math.abs(contact(x,z)-sample(x,z))<1e-6,'contact must match final transition triangles');
 for(let z=.125;z<4;z+=.25)assert.ok(Math.abs(sample(4-1e-6,z)-sample(4+1e-6,z))<.0001,'shared edge must have the same height on both sides');
});

test('cell-derived refined boundaries exactly match exposed triangle edges',()=>{
 const g=grid(0,1,()=>0),vertices=new Map();
 for(let i=0;i<g.attributes.position.count;i++)vertices.set(i,i);
 const fast=refinedTerrainBoundary(new Set([0,1,3,4]),vertices,3,5,2);
 const key=([a,b])=>Math.min(a,b)+':'+Math.max(a,b);
 assert.deepEqual(fast.map(key).sort(),terrainBoundaryEdges(g,1).map(e=>key([e.a,e.b])).sort());
});
