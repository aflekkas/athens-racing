// Penteli appearance only: unchanged route/DEM meshes, source-based paint and verges.
import * as THREE from 'three';
import { TX } from '../tex.js';
import { REFLECT_LAYER, COND_STATE } from '../env.js';

const NOISE = `
float ph(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float pn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(ph(i),ph(i+vec2(1,0)),f.x),mix(ph(i+vec2(0,1)),ph(i+1.),f.x),f.y);}
float pf(vec2 p){return .53*pn(p)+.28*pn(p*2.03)+.13*pn(p*4.07)+.06*pn(p*8.11);}
`;
const rgb = hex => `vec3(${new THREE.Color(hex).toArray().map(v=>v.toFixed(5)).join(',')})`;

export function penteliRoadMaterial() {
  const mat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.94});
  mat.userData.uniforms={uCross:{value:new Float32Array(16).fill(-9999)},uStop:{value:new Float32Array(8).fill(-9999)},uStopO:{value:new Float32Array(8).fill(-9999)}};
  mat.customProgramCacheKey=()=> 'penteli-double-solid-v1';
  mat.onBeforeCompile=sh=>{
    sh.uniforms.pAsphalt={value:TX.asphalt_diff};
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 aSU; attribute float aEdge; attribute float aMouth; varying vec2 pSU; varying float pEdge; varying float pMouth;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\npSU=aSU;pEdge=aEdge;pMouth=aMouth;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 pSU; varying float pEdge; varying float pMouth; uniform sampler2D pAsphalt; ${NOISE}
      float pb(float x,float centre,float width){float a=max(fwidth(x),.003);return 1.-smoothstep(width*.5-a,width*.5+a,abs(x-centre));}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
      float s=pSU.x,u=pSU.y,au=abs(u); float grain=dot(texture2D(pAsphalt,vec2(u,s)*.29).rgb,vec3(.333));
      vec3 tarmac=${rgb('#72787b')}*(.79+.48*grain)*(.94+.12*pn(vec2(u*.25,s*.03)));
      // All eight public panoramas show the double solid white centre marking.
      float centre=pb(u,-.135,.105)+pb(u,.135,.105);
      float edge=pb(au,pEdge-.19,.115)*(1.-pMouth);
      float paint=clamp(centre+edge,0.,1.)*(.91+.09*pn(vec2(u*24.,s*8.)));
      vec3 surface=mix(tarmac,${rgb('#e4e3d9')},paint);
      float brokenEdge=smoothstep(pEdge-.08,pEdge+.08,au+(.5-pn(vec2(s*2.,u*7.)))*.11);
      vec3 gravel=mix(${rgb('#8c8774')},${rgb('#c0b69a')},pn(vec2(s*13.,u*16.)))*(.8+.28*pn(vec2(s*.45,u*.8)));
      diffuseColor.rgb=mix(surface,gravel,brokenEdge);`);
  };
  return mat;
}

export function buildPenteliSurface(scene,map,heightC) {
  // Common terrain owns its material and quantized-position decoder.
  const group=new THREE.Group();group.name='penteli-road';scene.add(group);
  const asphalt=penteliRoadMaterial(), route=map.route;
  for(let start=-60;start<route.length+60;start+=400){
    const end=Math.min(start+400,route.length+60),positions=[],su=[],edges=[],mouths=[],indices=[];
    let row=0;
    for(let s=start;s<=end+.01;s+=2,row++){
      const edge=route.edge(s),left=.42+.16*Math.sin(s*.19)+.1*Math.sin(s*.73),right=.46+.19*Math.sin(s*.13)+.08*Math.sin(s*.61);
      const us=[-edge-left,-edge-.04,-edge,0,edge,edge+.04,edge+right];
      for(let j=0;j<us.length;j++){
        const u=us[j],p=route.point(s,u);
        if(j===0||j===6)p.y=Math.min(p.y-.055,Math.max(p.y-.22,heightC(p.x,p.z)+.04));
        positions.push(p.x,p.y+.012,p.z);su.push(s,u);edges.push(edge);mouths.push(j<3?+(map.roadNetwork?.mouth(s,-1)||false):j>3?+(map.roadNetwork?.mouth(s,1)||false):0);
        if(row&&j){if((j===1||j===6)&&map.roadNetwork?.mouth(s-1,j===1?-1:1,1))continue;const a=(row-1)*7+j-1,b=a+7;indices.push(a,a+1,b,a+1,b+1,b);}
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('aSU',new THREE.Float32BufferAttribute(su,2));
    geometry.setAttribute('aEdge',new THREE.Float32BufferAttribute(edges,1));
    geometry.setAttribute('aMouth',new THREE.Float32BufferAttribute(mouths,1));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,asphalt);mesh.receiveShadow=true;mesh.layers.enable(REFLECT_LAYER);group.add(mesh);
  }
  // The common refined terrain owns shoulders and wheel contact on every map.
  // A second decorative fill ribbon can cross a neighbouring hairpin leg.
  return {group,asphalt,dispose(){group.removeFromParent();group.traverse(o=>o.geometry?.dispose());asphalt.dispose();}};
}
