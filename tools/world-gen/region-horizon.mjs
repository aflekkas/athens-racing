import {paintPenteli} from './penteli-scenery.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {terrainWorldPositions} from '../../src/terrain-layout.js';
import {encodeGeometryPack} from '../../src/baked-geometry.js';
// A small render-only background sampled from the actual emitted source planes.
// Active cells keep all original detail/contact geometry; no connecting terrain.
export async function bakeRegionHorizon(bake,transform,out,scenery,cover){
 const terrain=bake.map.terrain,a=transform.position([terrain.minX,0,terrain.minZ]),b=transform.position([terrain.minX+(terrain.GX-1)*terrain.T,0,terrain.minZ+(terrain.GZ-1)*terrain.T]),step=32,x0=Math.floor(a[0]/512)*512,z0=Math.floor(a[2]/512)*512,nx=Math.ceil((b[0]-x0)/step)+1,nz=Math.ceil((b[2]-z0)/step)+1;
 if(nx*nz>65535)throw Error('Regional background vertex budget exceeded');
 const positions=new Float32Array(nx*nz*3),colors=new Uint8Array(nx*nz*3),normals=new Int8Array(nx*nz*3),urban=new Uint8Array(nx*nz),quality=new Float64Array(nx*nz).fill(Infinity);
 for(const mesh of bake.terrainGroup.children){if(!mesh.isMesh)continue;const g=mesh.geometry,p=terrainWorldPositions(mesh),ix=g.userData.terrainLodSource||g.index.array,range=mesh.userData.terrainLod?.[0]||g.drawRange,resolution=(mesh.userData.coarseTerrain?4:1)/(mesh.userData.terrainRefinement||1);
  for(let i=range.start||0,end=Math.min(ix.length,(range.start||0)+range.count);i<end;i+=3){const ids=[ix[i],ix[i+1],ix[i+2]],v=ids.map(j=>transform.position([p[j*3],p[j*3+1],p[j*3+2]])),[a,b,c]=v,det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(det)<1e-9)continue;
   const loX=Math.max(0,Math.ceil((Math.min(...v.map(p=>p[0]))-x0)/step)),hiX=Math.min(nx-1,Math.floor((Math.max(...v.map(p=>p[0]))-x0)/step)),loZ=Math.max(0,Math.ceil((Math.min(...v.map(p=>p[2]))-z0)/step)),hiZ=Math.min(nz-1,Math.floor((Math.max(...v.map(p=>p[2]))-z0)/step));
   for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++){const k=z*nx+x;if(quality[k]<=resolution)continue;const px=x0+x*step,pz=z0+z*step,u=((b[2]-c[2])*(px-c[0])+(c[0]-b[0])*(pz-c[2]))/det,w=((c[2]-a[2])*(px-c[0])+(a[0]-c[0])*(pz-c[2]))/det,weights=[u,w,1-u-w];if(weights.some(n=>n< -1e-6))continue;quality[k]=resolution;positions.set([px,weights.reduce((n,w,j)=>n+w*v[j][1],0),pz],k*3);
    const attribute=(name,size)=>Array.from({length:size},(_,c)=>weights.reduce((n,w,j)=>n+w*(g.attributes[name]?.getComponent(ids[j],c)??0),0));colors.set(attribute('color',3).map(v=>Math.round(v*255)),k*3);normals.set(transform.normal(attribute('normal',3)).map(v=>Math.round(v*127)),k*3);urban[k]=Math.round(attribute('aU',1)[0]*255);
   }
  }
 }
 const indices=[];for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){const a=z*nx+x,b=a+1,c=a+nx,d=c+1;if([a,b,c,d].some(i=>!Number.isFinite(quality[i])))continue;indices.push(a,c,b,b,c,d);}
 const arrays=[positions,colors,normals,urban,new Uint16Array(indices)],meshes=[{surface:'penteliTerrain',attributes:{position:{array:0,size:3},color:{array:1,size:3,normalized:true},normal:{array:2,size:3,normalized:true},aU:{array:3,size:1,normalized:true}},index:4}];
 if(cover){meshes[0].surface='penteliMountain';meshes[0].attributes.aPCover={array:arrays.length,size:1,normalized:false};arrays.push(paintPenteli(positions,[0,0,0],cover));}
 // A byte mask reuses the horizon grid for distant forest; exclude roads, built land,
 // quarry scars and incomplete terrain. Runtime interpolates this same ground.
 const forest=new Uint8Array(nx*nz);if(cover)for(let k=0;k<forest.length;k++){
  if(!Number.isFinite(quality[k]))continue;const x=positions[k*3],z=positions[k*3+2],kind=cover(x,z);if(!['default','wood','scrub'].includes(kind))continue;
  const p=transform.inverse([x,0,z]),n=bake.network;if(n.nearMain(p[0],p[2])){const q=n.project(p[0],p[2]);if(Math.abs(q.u)<bake.map.route.edge(q.s)+30)continue;}
  if(n.candidates(p[0],p[2]).some(s=>n.distance(s,p[0],p[2])<s.hw+s.sw+30))continue;forest[k]=kind==='scrub'?2:1;
 }
 const forestArray=arrays.length;arrays.push(forest);
 scenery?.traverse(mesh=>{if(!mesh.isMesh||!mesh.name.startsWith('building-blocks:'))return;const attributes={};for(const[name,a]of Object.entries(mesh.geometry.attributes)){const values=[];for(let i=0;i<a.count;i++){let row=Array.from({length:a.itemSize},(_,j)=>a.getComponent(i,j));if(name==='position')row=transform.position(row);if(name==='normal')row=transform.normal(row);values.push(...row);}const packed=name==='normal'?Int8Array.from(values,v=>Math.round(v*127)):name==='color'?Uint8Array.from(values,v=>Math.round(v*255)):new Float32Array(values);attributes[name]={array:arrays.length,size:a.itemSize,normalized:name==='normal'||name==='color'};arrays.push(packed);}const index=arrays.length;arrays.push(mesh.geometry.index?new Uint16Array(mesh.geometry.index.array):Uint16Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i));meshes.push({surface:'penteliBuilding',attributes,index});});
 const raw=encodeGeometryPack({kind:'penteli-regional-terrain-v1',bounds:[x0,z0,x0+(nx-1)*step,z0+(nz-1)*step],spacing:step,forest:{array:forestArray,nx,nz,residentBytes:1179648},meshes},arrays),body=gzipSync(new Uint8Array(raw),{level:9}),sha256=createHash('sha256').update(body).digest('hex'),file='region-horizon-'+sha256+'.bin.gz';await mkdir(resolve(out,'data/tiles/penteli'),{recursive:true});await writeFile(resolve(out,'data/tiles/penteli',file),body);
 return{file,url:'/world/cells/'+sha256+'.bin.gz',sha256,bytes:body.length,decodedBytes:raw.byteLength,residentBytes:arrays.reduce((n,a)=>n+a.byteLength*2,0)+65536+1179648,triangles:meshes.reduce((n,m)=>n+arrays[m.index].length/3,0),landmarkMeshes:meshes.length-1};
}
