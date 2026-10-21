// The Riviera's 14-triangle hipped house and shutter facade, instanced once per
// height family. Placement rows belong to streamed cells; no extra textures.
import * as THREE from 'three';
import {deriveBuildingMeshes} from './world-tile-buildings.js';
import {athensMaterial} from './athens-materials.js';
export class PenteliHouses {
 constructor(parent,{enabled=true}={}){this.tiles=new Map();this.group=new THREE.Group();this.group.name='penteli-infill';this.group.visible=enabled;parent.add(this.group);this.last={x:Infinity,z:Infinity};this.models=[];
  for(const height of [3.4]){
   const built=deriveBuildingMeshes({buildings:[0,0,4,0],buildingCorners:[-5,-5,5,-5,5,5,-5,5],buildingHeights:[0,height]},{ids:['penteli-infill'],origin:[0,0,0],inferredCoastal:true},new Uint8Array([2]),new Uint8Array([3])),spec=built.meshes[0];let g=new THREE.BufferGeometry();
   for(const[name,a]of Object.entries(spec.attributes))g.setAttribute(name,new THREE.BufferAttribute(built.arrays[a.array],a.itemSize,!!a.normalized));g.setIndex(new THREE.BufferAttribute(built.arrays[spec.index],1));
   const indexed=g;g=g.toNonIndexed();indexed.dispose();const positions=Array.from(g.attributes.position.array),facades=Array.from(g.attributes.aFacade.array),parts=new Array(positions.length/3).fill(0);
   const quad=(a,b,c,d,part)=>{for(const p of [a,b,c,a,c,d]){positions.push(...p);facades.push(0,0);parts.push(part);}};
   quad([-5,3.1,5],[5,3.1,5],[5,2.7,8],[-5,2.7,8],1);
   quad([-5,2.7,8],[5,2.7,8],[5,2.35,8],[-5,2.35,8],1);
   for(const x of [-3,0,3]){quad([x-.65,.8,6],[x+.65,.8,6],[x+.65,.8,7.2],[x-.65,.8,7.2],2);quad([x-.1,0,6.5],[x+.1,0,6.5],[x+.1,.8,6.5],[x-.1,.8,6.5],2);}
   g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('aFacade',new THREE.Uint16BufferAttribute(facades,2));g.setAttribute('aPart',new THREE.Float32BufferAttribute(parts,1));g.setAttribute('iKind',new THREE.InstancedBufferAttribute(new Float32Array(192),1));
   const material=athensMaterial('building',[1,1,1],false),before=material.onBeforeCompile;
   material.side=THREE.DoubleSide;material.onBeforeCompile=shader=>{before(shader);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aPart;attribute float iKind;varying float vPart;varying vec2 vAwning;')
     .replace('#include <begin_vertex>','#include <begin_vertex>\nvPart=aPart;vAwning=position.xz;transformed.y=min(transformed.y,3.4)+max(0.,transformed.y-3.4)*.45;if(aPart>.5&&iKind<.5||aPart>.5&&iKind>1.5)transformed=vec3(0.);if(iKind>1.5)transformed.y=min(transformed.y,3.4);')
     .replace('vFacW=position;vFacW.y=transformed.y;','if(iKind>1.5){vFac.z=6.;vFacB.y=0.;}else if(iKind>.5&&!roofV)vFac.z=4.;vFacW=(instanceMatrix*vec4(transformed,1.)).xyz;')
     .replace('modelViewMatrix*vec4(transformed,1.)','modelViewMatrix*instanceMatrix*vec4(transformed,1.)');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vPart;varying vec2 vAwning;').replace('#include <opaque_fragment>','if(vPart>.5)outgoingLight=vPart>1.5?vec3(.24,.15,.08):mix(vec3(.10,.22,.14),vec3(.75,.74,.65),step(.5,fract(vAwning.x*1.5)));\n#include <opaque_fragment>');
   };material.customProgramCacheKey=()=> 'penteli-instanced-village-v2';
   const mesh=new THREE.InstancedMesh(g,material,192);mesh.name='penteli-infill:'+height;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;this.group.add(mesh);this.models.push({height,mesh});
  }
  this.matrix=new THREE.Matrix4();this.position=new THREE.Vector3();this.scale=new THREE.Vector3();this.rotation=new THREE.Quaternion();this.axis=new THREE.Vector3(0,1,0);
 }
 addTile(key,packet){const i=packet.metadata.extensions?.worldDetail?.penteliHouses;if(i==null)return;this.tiles.set(key,{rows:packet.arrays[i],origin:packet.metadata.origin});this.last.x=Infinity;}
 removeTile(key){if(this.tiles.delete(key))this.last.x=Infinity;}
 setEnabled(on){this.group.visible=on;this.last.x=Infinity;}
 update({position:p}){if(!this.group.visible||Math.hypot(p.x-this.last.x,p.z-this.last.z)<10)return;const candidates=[];
  for(const{rows:r,origin:o}of this.tiles.values())for(let i=0;i<r.length;i+=7){const x=r[i]+o[0],z=r[i+2]+o[2],distance=Math.hypot(x-p.x,z-p.z);if(distance<650)candidates.push({x,z,r,i,distance});}candidates.sort((a,b)=>a.distance-b.distance);
  for(const{height,mesh}of this.models){let count=0;for(const{x,z,r,i}of candidates){if(count===192)break;this.matrix.compose(this.position.set(x,r[i+1],z),this.rotation.setFromAxisAngle(this.axis,r[i+3]),this.scale.set(r[i+4]/10,r[i+5]/height,r[i+6]/10));mesh.geometry.attributes.iKind.setX(count,r[i+5]<2?2:Math.abs(r[i+5]-3.41)<.005?1:0);mesh.setMatrixAt(count++,this.matrix);}mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.iKind.needsUpdate=true;}
  this.last={x:p.x,z:p.z};
 }
 dispose(){this.group.removeFromParent();for(const{mesh}of this.models){mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}this.tiles.clear();}
}
