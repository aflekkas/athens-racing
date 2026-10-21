// Materials for the streamed Athens map. The asphalt and paving scans are the same shared library
// textures the hand-tuned maps use (src/road-asphalt.js): no new textures, no per-street data. Tile
// meshes carry plain tile-local positions; 512 m is a whole number of texture periods, so planar
// UVs taken straight from the local position continue seamlessly across every tile border.
import * as THREE from 'three';
import {TX,loadTextureSubset} from './tex.js';
import {settings,onSettings} from './settings.js';
import {detailNoise,SEA_TIME,patchMaterial,GROUND_GLSL,GROUND_VERTEX_VARYINGS,GROUND_VERTEX_BODY,GROUND_APPLY,FACADE_GLSL,FACADE_VERTEX_VARYINGS,FACADE_VERTEX_BODY,FACADE_APPLY,SEA_GLSL,SEA_VERTEX_VARYINGS,SEA_VERTEX_BODY,SEA_APPLY,FOAM_GLSL,FOAM_VERTEX_VARYINGS,FOAM_VERTEX_BODY,FOAM_APPLY} from './athens-detail.js';
export const ASPHALT_PERIOD=512/122,PAVING_PERIOD=512/160,URBAN_PERIOD=512/80;
// Mean grey of each scan, so palette colour keeps the street's overall tone and the scan only adds grain.
const MEAN={asphalt:.096,paving:.198};
export const ATHENS_TEXTURES=['asphalt_diff','paver_diff'];
export function loadAthensTextures(renderer){
  return loadTextureSubset(ATHENS_TEXTURES).then(textures=>{if(renderer){for(const t of textures)if(t.image)renderer.initTexture(t);renderer.initTexture(detailNoise());}return textures;});
}
function scanned(color,key,period,mean,contrast,{vertexColors=false,strength=1,drift=[61,80]}={}){
  const m=new THREE.MeshBasicMaterial({color:new THREE.Color(...color),vertexColors,side:THREE.FrontSide});
  m.customProgramCacheKey=()=>`athens-scan-${key}-${period.toFixed(4)}-${vertexColors?1:0}-${strength}-${drift.join('x')}`;
  m.onBeforeCompile=shader=>{
    shader.uniforms.scanMap={value:TX[key]};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vScanUV;').replace('#include <begin_vertex>',`#include <begin_vertex>\nvScanUV=position.xz/${period.toFixed(6)};`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vScanUV;uniform sampler2D scanMap;').replace('#include <color_fragment>',`#include <color_fragment>
 vec3 scan=texture2D(scanMap,vScanUV).rgb;float grain=dot(scan,vec3(.333));
 // Long-wavelength tone drift; its wavelengths (texture units) divide a tile length for seamless borders.
 float drift=.96+.04*sin(vScanUV.x*6.283185/${drift[0].toFixed(1)}+sin(vScanUV.y*6.283185/${drift[1].toFixed(1)}));
 diffuseColor.rgb*=mix(vec3(1.),mix(vec3(grain),scan,.5)/${mean.toFixed(3)}*drift*${contrast.toFixed(3)},${strength.toFixed(3)});`);
  };
  return m;
}
/** materialFactory for WorldTileScene: (tileSurface, linear rgb, hasVertexColors) -> material. */
export function athensMaterial(surface,rgb,vertexColors){
  if(surface==='asphalt')return scanned(rgb,'asphalt_diff',ASPHALT_PERIOD,MEAN.asphalt,1);
  if(surface==='paving')return scanned(rgb,'paver_diff',PAVING_PERIOD,MEAN.paving,1);
  // Ground between buildings: the paving scan at twice the paving period, softened, over the muted urban vertex colour.
  if(surface==='urban')return scanned(rgb,'paver_diff',URBAN_PERIOD,MEAN.paving,1,{vertexColors,strength:.7,drift:[40,80]});
  const dressed=dressedMaterial(surface,rgb,vertexColors);if(dressed)return dressed;
  const m=new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb),vertexColors,side:THREE.FrontSide});
  if(surface==='marking'){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;}
  return m;
}

// Dry limestone: broken strata, small fissures and grey-green scrub pockets.
// Reuses the existing noise atlas; coordinates repeat exactly at cell borders.
const LIMESTONE_GLSL=`vec3 coastLimestone(vec3 colour,vec3 pos){
 vec3 n=abs(normalize(cross(dFdx(pos),dFdy(pos))));
 vec2 p=n.y>.65?pos.xz:n.x>n.z?pos.zy:pos.xy;
 vec4 coarse=texture2D(detailMap,p/128.),mid=texture2D(detailMap,p/16.),fine=texture2D(detailMap,p/2.);
 float strata=sin(p.y*2.1+mid.b*9.);float fissure=smoothstep(.86,.98,abs(strata))*(.3+.7*mid.r);
 vec3 stone=colour*(.62+.65*coarse.b)*(.82+.28*fine.g)*(1.-.24*fissure);
 float pocket=smoothstep(.42,.66,texture2D(detailMap,pos.xz/64.).b+.13*mid.b)*smoothstep(.35,.82,n.y);
 return mix(stone,vec3(.115,.145,.075)*(.75+.5*fine.g),pocket*.78);
}`;

// World detail layers (src/athens-detail.js). Every one reads the shared `uWorldDetail` uniform, so Off draws the plain colour.
function dressedMaterial(surface,rgb,vertexColors){
  const base=()=>new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb),vertexColors,side:THREE.FrontSide});
  if(surface==='coastalGround'||surface==='coastalUrban'){
    const m=surface==='coastalUrban'?scanned(rgb,'paver_diff',URBAN_PERIOD,MEAN.paving,1,{vertexColors,strength:.7,drift:[40,80]}):base(),scan=m.onBeforeCompile;
    patchMaterial(m,{key:'athens-'+surface+'-v1',vertexVaryings:GROUND_VERTEX_VARYINGS+'attribute vec4 aCoastColor;varying vec4 vCoastColor;varying vec3 vCoastP;',vertexBody:GROUND_VERTEX_BODY+'vCoastColor=aCoastColor;vCoastP=position;',fragmentGlsl:GROUND_GLSL+LIMESTONE_GLSL+'varying vec4 vCoastColor;varying vec3 vCoastP;',apply:`diffuseColor.rgb=mix(diffuseColor.rgb,vCoastColor.rgb,uWorldDetail);${GROUND_APPLY}
      vec3 limestone=coastLimestone(vCoastColor.rgb,vCoastP);
      diffuseColor.rgb=mix(diffuseColor.rgb,limestone,uWorldDetail*vCoastColor.a);`});
    const patch=m.onBeforeCompile;m.onBeforeCompile=shader=>{patch(shader);if(surface==='coastalUrban'){// Insert the old scan before the coastal mix, so Off is byte-for-byte the original courtyard recipe.
      const marker='#include <color_fragment>';shader.fragmentShader=shader.fragmentShader.replace(marker,marker+'\n//COAST_SCAN_END');scan(shader);}
    };return m;
  }
  if(surface==='ground')return patchMaterial(base(),{key:'athens-ground-v1',vertexVaryings:GROUND_VERTEX_VARYINGS,vertexBody:GROUND_VERTEX_BODY,fragmentGlsl:GROUND_GLSL,apply:GROUND_APPLY});
  if(surface==='building')return patchMaterial(base(),{key:'athens-building-v1',vertexVaryings:FACADE_VERTEX_VARYINGS,vertexBody:FACADE_VERTEX_BODY,fragmentGlsl:FACADE_GLSL,apply:FACADE_APPLY});
  if(surface==='sea')return patchMaterial(base(),{key:'athens-sea-v1',vertexVaryings:SEA_VERTEX_VARYINGS,vertexBody:SEA_VERTEX_BODY,fragmentGlsl:SEA_GLSL,apply:SEA_APPLY,uniforms:{uSeaTime:SEA_TIME}});
  if(surface==='coastalDetail'||surface==='coastalBuilding'){
    const m=surface==='coastalBuilding'?dressedMaterial('building',rgb,vertexColors):base(),off=onSettings((s,key)=>{if(!key||key==='worldDetail')m.visible=s.worldDetail!==false;});
    if(surface==='coastalDetail')patchMaterial(m,{key:'coastal-limestone',vertexVaryings:GROUND_VERTEX_VARYINGS+'attribute float aRock;varying float vRock;varying vec3 vRockP;',vertexBody:GROUND_VERTEX_BODY+'vRock=aRock;vRockP=position;',fragmentGlsl:GROUND_GLSL+LIMESTONE_GLSL+'varying float vRock;varying vec3 vRockP;',apply:`diffuseColor.rgb=mix(diffuseColor.rgb,coastLimestone(diffuseColor.rgb,vRockP),vRock*uWorldDetail);`});
    m.visible=settings.worldDetail!==false;m.addEventListener('dispose',off);return m;
  }
  if(surface==='foam'){
    const m=patchMaterial(base(),{key:'athens-foam-v1',vertexVaryings:FOAM_VERTEX_VARYINGS,vertexBody:FOAM_VERTEX_BODY,fragmentGlsl:FOAM_GLSL,apply:FOAM_APPLY,uniforms:{uSeaTime:SEA_TIME}});
    m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-1;
    // World detail Off removes the foam strip's draw call altogether.
    const off=onSettings((s,key)=>{if(!key||key==='worldDetail')m.visible=s.worldDetail!==false;});m.visible=settings.worldDetail!==false;m.addEventListener('dispose',off);
    return m;
  }
  return null;
}
