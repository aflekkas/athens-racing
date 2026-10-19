// Materials for the streamed Athens map. The asphalt and paving scans are the same shared library
// textures the hand-tuned maps use (src/road-asphalt.js): no new textures, no per-street data. Tile
// meshes carry plain tile-local positions; 512 m is a whole number of texture periods, so planar
// UVs taken straight from the local position continue seamlessly across every tile border.
import * as THREE from 'three';
import {TX,loadTextureSubset} from './tex.js';
export const ASPHALT_PERIOD=512/122,PAVING_PERIOD=512/160;
// Mean grey of each scan, so palette colour keeps the street's overall tone and the scan only adds grain.
const MEAN={asphalt:.096,paving:.198};
export const ATHENS_TEXTURES=['asphalt_diff','paver_diff'];
export function loadAthensTextures(renderer){
  return loadTextureSubset(ATHENS_TEXTURES).then(textures=>{if(renderer)for(const t of textures)if(t.image)renderer.initTexture(t);return textures;});
}
function scanned(color,key,period,mean,contrast){
  const m=new THREE.MeshBasicMaterial({color:new THREE.Color(...color),side:THREE.FrontSide});
  m.customProgramCacheKey=()=>'athens-scan-'+key;
  m.onBeforeCompile=shader=>{
    shader.uniforms.scanMap={value:TX[key]};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vScanUV;').replace('#include <begin_vertex>',`#include <begin_vertex>\nvScanUV=position.xz/${period.toFixed(6)};`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vScanUV;uniform sampler2D scanMap;').replace('#include <color_fragment>',`#include <color_fragment>
 vec3 scan=texture2D(scanMap,vScanUV).rgb;float grain=dot(scan,vec3(.333));
 // Long-wavelength tone drift with an integer number of cycles per 512 m tile (no seam).
 float drift=.96+.04*sin(vScanUV.x*6.283185/61.+sin(vScanUV.y*6.283185/80.));
 diffuseColor.rgb*=mix(vec3(grain),scan,.5)/${mean.toFixed(3)}*drift*${contrast.toFixed(3)};`);
  };
  return m;
}
/** materialFactory for WorldTileScene: (tileSurface, linear rgb, hasVertexColors) -> material. */
export function athensMaterial(surface,rgb,vertexColors){
  if(surface==='asphalt')return scanned(rgb,'asphalt_diff',ASPHALT_PERIOD,MEAN.asphalt,1);
  if(surface==='paving')return scanned(rgb,'paver_diff',PAVING_PERIOD,MEAN.paving,1);
  const m=new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb),vertexColors,side:THREE.FrontSide});
  if(surface==='marking'){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;}
  return m;
}
