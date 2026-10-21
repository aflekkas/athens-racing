import {faceTexture} from './speed-signs.js';
import {roadSignAtlas} from './road-signs.js';
import {municipalBinLabelTexture} from './street-life.js';
import {roadNetworkMaterial} from './road-network.js';
import {penteliRoadMaterial} from './maps/penteli-surface.js';
import {terrainMaterial} from './terrain.js';
import {penteliTerrainMaterial} from './penteli-terrain.js';
import {facadeMaterial} from './buildings.js';
import {createFacadeAtlas} from './facade-atlas.js';
// Materials for the streamed Athens map. The asphalt and paving scans are the same shared library
// textures the hand-tuned maps use (src/road-asphalt.js): no new textures, no per-street data. Tile
// meshes carry plain tile-local positions; 512 m is a whole number of texture periods, so planar
// UVs taken straight from the local position continue seamlessly across every tile border.
import * as THREE from 'three';
import {TX,GLSL_HELPERS,loadTextureSubset} from './tex.js';
import {settings,onSettings} from './settings.js';
import {detailNoise,SEA_TIME,patchMaterial,GROUND_GLSL,GROUND_VERTEX_VARYINGS,GROUND_VERTEX_BODY,GROUND_APPLY,FACADE_GLSL,FACADE_VERTEX_VARYINGS,FACADE_VERTEX_BODY,FACADE_APPLY,FACADE_PLAIN,SEA_GLSL,SEA_VERTEX_VARYINGS,SEA_VERTEX_BODY,SEA_APPLY,FOAM_GLSL,FOAM_VERTEX_VARYINGS,FOAM_VERTEX_BODY,FOAM_APPLY} from './athens-detail.js';
export const ASPHALT_PERIOD=512/122,PAVING_PERIOD=512/160,URBAN_PERIOD=512/80;
// Mean grey of each scan, so palette colour keeps the street's overall tone and the scan only adds grain.
const MEAN={asphalt:.096,paving:.198};
export const ATHENS_TEXTURES=['asphalt_diff','paver_diff'];
export const PENTELI_TEXTURES=['asphalt_nor','ground_diff','ground_nor','grass_diff','grass_nor','sand_diff','sand_nor','rock_diff','rock_nor','concrete_diff'];
export function loadAthensTextures(renderer,{penteli=false}={}){
  return loadTextureSubset(penteli?[...ATHENS_TEXTURES,...PENTELI_TEXTURES]:ATHENS_TEXTURES).then(textures=>{if(renderer){for(const t of textures)if(t.image)renderer.initTexture(t);if(settings.worldDetail!==false)renderer.initTexture(detailNoise());}return textures;});
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
  if(surface==='megaraTerrain')return terrainMaterial();
  if(surface==='megaraNetwork')return roadNetworkMaterial();
  if(surface.startsWith('megaraSolid:')){const o=JSON.parse(surface.slice(12));return new THREE.MeshStandardMaterial({...o,color:new THREE.Color(...rgb),vertexColors});}
  if(surface==='megaraTyre'){
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(...rgb),roughness:.97,vertexColors});m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 tyreLocal;').replace('#include <begin_vertex>','#include <begin_vertex>\ntyreLocal=position;');sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 tyreLocal;').replace('#include <color_fragment>','#include <color_fragment>\nfloat tread=step(.44,length(tyreLocal.xz));float groove=step(.83,fract(atan(tyreLocal.z,tyreLocal.x)*15.2789+tyreLocal.y*7.));diffuseColor.rgb*=1.-tread*groove*.45;');};m.customProgramCacheKey=()=> 'megara-streamed-tyre-v1';return m;
  }
  if(surface==='megaraFence'){
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(...rgb),vertexColors,transparent:true,opacity:.47,depthWrite:false,side:THREE.DoubleSide,roughness:.67,metalness:.25});m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vFenceUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFenceUV=uv;');sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vFenceUV;').replace('#include <alphatest_fragment>',`vec2 diamond=vec2(vFenceUV.x+vFenceUV.y,vFenceUV.x-vFenceUV.y)/.105;vec2 fw=max(fwidth(diamond),vec2(.001));vec2 d=abs(fract(diamond+.5)-.5);vec2 wires=1.-smoothstep(vec2(.032)-fw*.5,vec2(.032)+fw*.5,d);diffuseColor.a*=max(wires.x,wires.y)*clamp(1.5/max(fw.x,fw.y),0.,1.);if(diffuseColor.a<.018)discard;\n#include <alphatest_fragment>`);};m.customProgramCacheKey=()=> 'megara-streamed-fence-v1';return m;
  }
  if(surface.startsWith('megaraAsphalt@')||surface.startsWith('megaraWornAsphalt@')||surface.startsWith('megaraRubber@')){
    const [type,cell]=surface.split('@'),[cx,cz]=cell.split(',').map(Number),worn=type==='megaraWornAsphalt',rubber=type==='megaraRubber';
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(...rgb),vertexColors,side:THREE.DoubleSide,roughness:.92,transparent:rubber,opacity:rubber?.075:1,depthWrite:!rubber,polygonOffset:rubber,polygonOffsetFactor:rubber?-1:0});
    m.onBeforeCompile=sh=>{sh.uniforms.tSurface={value:TX.asphalt_diff};sh.uniforms.tSurfaceN={value:TX.asphalt_nor};sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMegaraWorld;').replace('#include <begin_vertex>',`#include <begin_vertex>\nvMegaraWorld=position+vec3(${(cx*512).toFixed(1)},0.,${(cz*512).toFixed(1)});`);sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMegaraWorld;uniform sampler2D tSurface;uniform sampler2D tSurfaceN;\n'+GLSL_HELPERS).replace('#include <color_fragment>',rubber?'#include <color_fragment>\ndiffuseColor.a*=smoothstep(.20,.70,fbm2(vMegaraWorld.xz*.22));':`#include <color_fragment>\nvec2 uvMegara=vMegaraWorld.xz/3.4;vec3 scan=texNoTile(tSurface,uvMegara).rgb;float lum=dot(scan,vec3(.3333));float macro=fbm2(vMegaraWorld.xz*.045);vec2 repairCell=floor(vMegaraWorld.xz/vec2(8.,19.));vec2 repairUV=fract(vMegaraWorld.xz/vec2(8.,19.));float repair=step(.84,h12(repairCell))*step(.12,repairUV.x)*step(repairUV.x,.88)*step(.18,repairUV.y)*step(repairUV.y,.83);diffuseColor.rgb=${worn?'vec3(.245,.245,.232)':'vec3(.135,.132,.126)'}*(.65+lum*3.8)*(.83+.32*macro)*(1.-.2*repair);`).replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nvec3 scannedNormal=texture2D(tSurfaceN,vMegaraWorld.xz/2.6).xyz*2.-1.;normal=perturb(-vViewPosition,normal,vMegaraWorld.xz/2.6,scannedNormal,.5);');};m.customProgramCacheKey=()=>surface+'-v1';return m;
  }
  if(surface==='megaraRubber')return new THREE.MeshStandardMaterial({color:new THREE.Color(...rgb),vertexColors,transparent:true,opacity:.075,depthWrite:false,side:THREE.DoubleSide});
  if(surface.startsWith('penteliProp:')){const {texture,...options}=JSON.parse(surface.slice(12)),map=!texture?null:texture.kind==='speed'?faceTexture(texture.value):texture.kind==='road-sign'?roadSignAtlas(texture.keys):municipalBinLabelTexture();const m=new THREE.MeshStandardMaterial({...options,color:new THREE.Color(...rgb),vertexColors,map});const off=onSettings((s,k)=>{if(!k||k==='worldDetail')m.visible=s.worldDetail!==false;});m.visible=settings.worldDetail!==false;m.addEventListener('dispose',()=>{off();map?.dispose();});return m;}
  if(surface==='penteliNetwork')return roadNetworkMaterial();
  if(surface==='penteliRoad')return penteliRoadMaterial();
  if(surface==='penteliMountain')return penteliTerrainMaterial();
  if(surface==='penteliTerrain')return terrainMaterial();
  if(surface==='penteliBuilding')return facadeMaterial(typeof document==='undefined'?null:createFacadeAtlas());
  if(surface==='penteliScenery'||surface==='penteliRail'||surface==='penteliConcrete'){
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(...rgb),vertexColors,map:surface==='penteliConcrete'?TX.concrete_diff:null,roughness:surface==='penteliRail'?.42:.92,metalness:surface==='penteliRail'?.68:0,side:THREE.DoubleSide});
    // Same daylight fill as the authored mountain props, without new lights.
    m.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * .52;');};
    m.customProgramCacheKey=()=>surface+'-v1';return m;
  }
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
    const patch=m.onBeforeCompile;m.onBeforeCompile=function(shader){patch.call(this,shader);if(surface==='coastalUrban'){// Insert the old scan before the coastal mix, so Off is byte-for-byte the original courtyard recipe.
      const marker='#include <color_fragment>';shader.fragmentShader=shader.fragmentShader.replace(marker,marker+'\n//COAST_SCAN_END');scan(shader);}
    };return m;
  }
  if(surface==='ground')return patchMaterial(base(),{key:'athens-ground-v1',vertexVaryings:GROUND_VERTEX_VARYINGS,vertexBody:GROUND_VERTEX_BODY,fragmentGlsl:GROUND_GLSL,apply:GROUND_APPLY});
  if(surface==='building')return patchMaterial(base(),{key:'athens-building-v1',vertexVaryings:FACADE_VERTEX_VARYINGS,vertexBody:FACADE_VERTEX_BODY,fragmentGlsl:FACADE_GLSL,apply:FACADE_APPLY,plain:FACADE_PLAIN});
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
