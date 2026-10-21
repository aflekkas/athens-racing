import {terrainMaterial} from './terrain.js';
// Region-specific cover; the legacy Off rendering and other maps are untouched.
export function penteliTerrainMaterial(){
 const material=terrainMaterial(),before=material.onBeforeCompile;
 material.customProgramCacheKey=()=> 'penteli-mountain-v2';
 material.onBeforeCompile=sh=>{before(sh);
 sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aPCover;varying vec4 vPColor;').replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 c=vec3(34.,51.,27.);float rock=0.;if(aPCover>.5&&aPCover<1.5)c=vec3(27.,43.,25.);if(aPCover>1.5&&aPCover<2.5)c=vec3(49.,61.,32.);if(aPCover>2.5&&aPCover<3.5)c=vec3(95.,99.,71.);if(aPCover>3.5&&aPCover<5.5){c=aPCover<4.5?vec3(142.,145.,141.):vec3(116.,122.,117.);rock=aPCover<4.5?2.:1.;}if(aPCover>5.5)c=vec3(111.,111.,105.);vPColor=vec4(c/255.,rock);');
 sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 vPColor;')
 .replace('float steep =','vc=vPColor.rgb;float steep =')
 .replace('wSand = clamp','wSand=0.;wRock=max(min(1.,vPColor.a),smoothstep(.12,.38,steep));wGrass=max(wGrass,.65)*(1.-wRock);wSand = clamp')
 .replace('col = mix(vc, col, 0.45);',`vec3 stone=vec3(dot(r,vec3(.333)))*vec3(.98,1.,1.02);float quarry=smoothstep(1.3,1.8,vPColor.a);stone=mix(stone,vec3(.66,.68,.65)*(.85+.15*dot(r,vec3(.333))),quarry);col=mix(vc*(.78+.44*dot(sg,vec3(.333))),stone,wRock);col*=1.-(.16+.14*quarry)*wRock*smoothstep(.86,.98,abs(sin(vWP.y*.8+mid*.7)));`);
 };return material;
}
