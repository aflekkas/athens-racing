import {facadeMaterial} from './buildings.js';
import {decodeGeometryPack} from './baked-geometry.js';
import {terrainMaterial} from './terrain.js';
import {penteliTerrainMaterial} from './penteli-terrain.js';
import * as THREE from 'three';
import {createFarScenery,installAerial,AP_K} from './env.js';
import {ATHENS_PROJECTION} from './world-manifest.js';
import {settings,onSettings} from './settings.js';
// One distant silhouette set, owned jointly by the resident region cells. It
// never creates road/contact cells across the geographic gap.
export class WorldRegionalScenery {
 constructor(parent,kind='penteli',{trees}={}){this.trees=trees;installAerial(AP_K);this.kind=kind;this.parent=parent;this.cells=new Set();this.root=null;this.origin={x:0,z:0};this.controller=new AbortController();this.asset=null;this.assetPromise=null;this.cameraFars=new Map();this.off=onSettings((s,k)=>{if((!k||k==='worldDetail')&&this.root)this.root.visible=s.worldDetail!==false;});}
 async prepare(spec){if(!spec?.terrain)return;if(spec.kind!==this.kind)throw Error('Regional scenery kind mismatch');if(this.assetPromise){if(this.terrainHash!==spec.terrain.sha256)throw Error('Conflicting regional terrain');return this.assetPromise;}const a=spec.terrain;this.terrainHash=a.sha256;this.assetPromise=(async()=>{const r=await fetch(a.url,{signal:this.controller.signal});if(!r.ok)throw Error('Regional terrain unavailable');const body=await r.arrayBuffer();if(body.byteLength!==a.bytes||a.decodedBytes>8*1024**2)throw Error('Regional terrain budget');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==a.sha256)throw Error('Regional terrain integrity');const raw=await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(raw.byteLength!==a.decodedBytes)throw Error('Regional terrain decoded budget');const pack=decodeGeometryPack(raw);if(pack.metadata.kind!==this.kind+'-regional-terrain-v1')throw Error('Regional terrain recipe');this.asset={...pack,bytes:a.decodedBytes};})().catch(error=>{this.assetPromise=null;throw error;});return this.assetPromise;}
 get cachedBytes(){return this.asset?.bytes||0;}
 buildTerrain(root){if(!this.asset)return;const {arrays:a,metadata:m}=this.asset,b=m.bounds,width=Math.ceil((b[2]-b[0])/512),height=Math.ceil((b[3]-b[1])/512),data=new Uint8Array(width*height),mask=new THREE.DataTexture(data,width,height,THREE.RedFormat);mask.minFilter=mask.magFilter=THREE.NearestFilter;this.mask={data,width,height,x:b[0]/512,z:b[1]/512,texture:mask};
  // These masked landmarks are beyond the authored 240 m facade fade; retain
  // their exact far colour without allocating duplicate near-facade atlases.
  for(const spec of m.meshes||[{surface:'penteliTerrain',attributes:{position:{array:0,size:3},color:{array:1,size:3,normalized:true},normal:{array:2,size:3,normalized:true},aU:{array:3,size:1,normalized:true}},index:4}]){const g=new THREE.BufferGeometry();for(const[name,d]of Object.entries(spec.attributes))g.setAttribute(name,new THREE.BufferAttribute(a[d.array],d.size,!!d.normalized));g.setIndex(new THREE.BufferAttribute(a[spec.index],1));
  const material=spec.surface.endsWith('Building')?facadeMaterial(null):spec.surface==='penteliMountain'?penteliTerrainMaterial():terrainMaterial(),before=material.onBeforeCompile;material.onBeforeCompile=sh=>{before(sh);sh.uniforms.uRegionCells={value:mask};sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\n varying vec2 vRegionUV;').replace('#include <begin_vertex>',`#include <begin_vertex>\n vRegionUV=(position.xz-vec2(${b[0].toFixed(1)},${b[1].toFixed(1)}))/vec2(${(width*512).toFixed(1)},${(height*512).toFixed(1)});`);sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\n uniform sampler2D uRegionCells;varying vec2 vRegionUV;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\n if(texture2D(uRegionCells,vRegionUV).r>.5)discard;');};material.customProgramCacheKey=()=>spec.surface+'-regional-background-v1';
  const mesh=new THREE.Mesh(g,material);mesh.name=this.kind+' distant source '+spec.surface;mesh.frustumCulled=false;mesh.renderOrder=-997;root.add(mesh);root.userData.ownedMaterials.push(material);}for(const key of this.cells)this.mark(key,true);
 }
 mark(key,on){if(!this.mask)return;const[x,z]=key.split(',').map(Number),m=this.mask,a=x-m.x,b=z-m.z;if(a>=0&&b>=0&&a<m.width&&b<m.height){m.data[b*m.width+a]=on?255:0;m.texture.needsUpdate=true;}}
 add(key,spec){if(!spec)return;if(spec.kind!==this.kind)throw Error('Unknown regional silhouette recipe');this.cells.add(key);this.mark(key,true);if(this.root)return;
  const p=spec.projection,P=ATHENS_PROJECTION,sx=P.metresPerLon/p.mlon,sz=P.metresPerLat/p.mlat,dx=(p.lon0-P.lon0)*P.metresPerLon,dz=(P.lat0-p.lat0)*P.metresPerLat,root=createFarScenery(p,this.kind);root.updateMatrixWorld(true);const materials=new Map();
  const affine=new THREE.Matrix4().set(sx,0,0,dx,0,1,0,0,0,0,sz,dz,0,0,0,1);
  root.traverse(o=>{if(!o.isMesh)return;let material=materials.get(o.material);if(!material){const source=o.material;material=source.clone();const before=source.onBeforeCompile.bind(source);material.onBeforeCompile=sh=>{before(sh);sh.vertexShader=sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n gl_Position.z=gl_Position.w*.99999;');};material.customProgramCacheKey=()=>source.customProgramCacheKey()+'-regional-far';material.depthWrite=false;materials.set(source,material);}o.material=material;o.frustumCulled=false;o.renderOrder=-998;o.geometry.applyMatrix4(affine.clone().multiply(o.matrixWorld));o.position.set(0,0,0);o.rotation.set(0,0,0);o.scale.set(1,1,1);o.updateMatrix();});
  for(const m of root.userData.ownedMaterials||[])m.dispose();root.userData.ownedMaterials=[...materials.values()];this.buildTerrain(root);this.trees?.setMountainForest(this.asset);this.root=root;this.parent.add(root);root.visible=settings.worldDetail!==false;this.rebase(this.origin);
 }
 view(camera){const active=this.has(camera.position.x+this.origin.x,camera.position.z+this.origin.z);if(active&&camera.far<90000){this.cameraFars.set(camera,camera.far);camera.far=90000;camera.updateProjectionMatrix();}else if(!active&&this.cameraFars.has(camera)){camera.far=this.cameraFars.get(camera);camera.updateProjectionMatrix();this.cameraFars.delete(camera);}}
 has(x,z){return this.cells.has(`${Math.floor(x/512)},${Math.floor(z/512)}`);}
 rebase(origin){this.origin=origin;if(this.root)this.root.position.set(-origin.x,0,-origin.z);}
 remove(key){this.cells.delete(key);this.mark(key,false);if(!this.cells.size)this.clear();}
 clear(){this.trees?.setMountainForest(null);if(!this.root)return;this.root.traverse(o=>o.geometry?.dispose());for(const m of this.root.userData.ownedMaterials||[])m.dispose();this.root.removeFromParent();this.root=null;this.mask?.texture.dispose();this.mask=null;}
 dispose(){for(const[camera,far]of this.cameraFars){camera.far=far;camera.updateProjectionMatrix();}this.cameraFars.clear();this.controller.abort();this.off();this.cells.clear();this.clear();this.asset=null;this.assetPromise=null;}
}
export class WorldRegionalScenerySet{
 constructor(parent,{trees}={}){this.parent=parent;this.trees=trees;this.layers=new Map();this.owners=new Map();this.origin={x:0,z:0};}
 layer(kind){if(!['penteli','megara'].includes(kind))throw Error('Unknown regional silhouette recipe');let layer=this.layers.get(kind);if(!layer){layer=new WorldRegionalScenery(this.parent,kind,kind==='penteli'?{trees:this.trees}:{});layer.rebase(this.origin);this.layers.set(kind,layer);}return layer;}
 prepare(spec){return spec?.kind?this.layer(spec.kind).prepare(spec):undefined;}
 add(key,spec){if(!spec)return;this.layer(spec.kind).add(key,spec);this.owners.set(key,spec.kind);}
 remove(key){const kind=this.owners.get(key);if(kind)this.layers.get(kind).remove(key);this.owners.delete(key);}
 rebase(origin){this.origin=origin;for(const l of this.layers.values())l.rebase(origin);}
 view(camera){const x=camera.position.x+this.origin.x,z=camera.position.z+this.origin.z;for(const l of this.layers.values())if(!l.has(x,z))l.view(camera);for(const l of this.layers.values())if(l.has(x,z))l.view(camera);}
 has(x,z){return[...this.layers.values()].some(l=>l.has(x,z));}
 get cachedBytes(){return[...this.layers.values()].reduce((n,l)=>n+l.cachedBytes,0);}
 dispose(){for(const l of this.layers.values())l.dispose();this.layers.clear();this.owners.clear();}
}
