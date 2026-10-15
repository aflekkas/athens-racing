import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTerrainHeight } from '../src/terrain-contact.js';

// Independent barycentric interpolation of the mesh's indexed triangles.
function plane(a,b,c,x,z){const det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det;return u*a[1]+v*b[1]+(1-u-v)*c[1];}
const terrain={GX:2,GZ:2,T:10,minX:2980,minZ:1000};
test('mountain contacts follow both mesh diagonals across steep non-coplanar cells',()=>{
  for(const H of [[519.6,514.9,522.5,512.9],[515,514,516,523],[12,12,12,12]]){
    const vertices=[[2980,H[0],1000],[2990,H[1],1000],[2980,H[2],1010],[2990,H[3],1010]];
    const tris=Math.abs(H[0]-H[3])<Math.abs(H[1]-H[2])?[[0,2,3],[0,3,1]]:[[0,2,1],[1,2,3]];
    for(const ids of tris)for(const weights of [[1/3,1/3,1/3],[.1,.2,.7],[.7,.2,.1]]){
      const points=ids.map(i=>vertices[i]),x=points.reduce((v,p,i)=>v+p[0]*weights[i],0),z=points.reduce((v,p,i)=>v+p[2]*weights[i],0);
      assert.ok(Math.abs(sampleTerrainHeight(terrain,H,x,z)-plane(...points,x,z))<1e-8);
    }
  }
});
test('cell edges are continuous and outside-map recovery sentinel remains unchanged',()=>{
  const t={GX:3,GZ:3,T:10,minX:0,minZ:0},H=[10,15,12,16,25,17,13,18,20];
  for(let z=.25;z<19;z+=.5)assert.ok(Math.abs(sampleTerrainHeight(t,H,10-1e-7,z)-sampleTerrainHeight(t,H,10+1e-7,z))<1e-5);
  for(const [x,z] of [[-1,0],[0,-1],[20,5],[5,20]])assert.equal(sampleTerrainHeight(t,H,x,z),-30);
  assert.equal(sampleTerrainHeight(t,H,0,0),10);
});

// Compact GPU layouts and the LOD/contact contract run in the normal gates.
import './terrain-layout.test.mjs';
