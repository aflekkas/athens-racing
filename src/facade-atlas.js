import * as THREE from 'three';
import { worldDetailEnabled } from './world-detail-state.js';

// Eight padded 256px tiles; all balconies, shutters and awnings are painted.
// One 1024x512 atlas (2.67 MiB including mipmaps), shared by the whole map.
export function createFacadeAtlas() {
  const c=document.createElement('canvas');c.width=1024;c.height=512;
  const g=c.getContext('2d');
  for(let style=0;style<8;style++){
    g.save();g.translate((style%4)*256,Math.floor(style/4)*256);
    g.fillStyle='#f2f0e8';g.fillRect(0,0,256,256);
    if(style===0){g.fillStyle='#d4cfc3';g.fillRect(0,240,256,10);}
    else if(style===7){g.fillStyle='#a3a8a7';for(let x=8;x<256;x+=16)g.fillRect(x,0,2,256);g.fillStyle='#59676b';g.fillRect(24,50,208,90);}
    else{
      g.fillStyle='#d4d0c7';g.fillRect(0,240,256,12);
      for(const x of [30,146]){
        g.fillStyle='#b6b4ac';g.fillRect(x-5,37,84,135);
        g.fillStyle=style===5?'#6e878d':'#47565d';g.fillRect(x,42,74,124);
        g.fillStyle='#e3dfd3';g.fillRect(x+35,42,4,124);g.fillRect(x,101,74,3);
        if(style===2){g.fillStyle='#71877c';g.fillRect(x,42,23,124);g.fillRect(x+51,42,23,124);g.fillStyle='#485d54';for(let y=47;y<163;y+=8){g.fillRect(x+2,y,19,2);g.fillRect(x+53,y,19,2);}}
      }
      if([1,3,4].includes(style)){
        g.fillStyle='#6c7471';g.fillRect(12,184,232,30);g.fillStyle='#eee9dc';g.fillRect(8,210,240,17);
        g.fillStyle='#9faaa6';for(let x=18;x<245;x+=13)g.fillRect(x,181,3,31);
      }
      if(style===3||style===4){g.fillStyle='#6f8d77';g.fillRect(18,30,220,30);g.fillStyle='#e0d8b9';for(let x=24;x<238;x+=24)g.fillRect(x,30,9,30);g.fillStyle='#596c5c';g.fillRect(18,57,220,5);}
      if(style===6){g.fillStyle='#b0a491';for(let y=0;y<256;y+=32){g.fillRect(0,y,256,2);for(let x=(y%64?30:0);x<256;x+=64)g.fillRect(x,y,2,32);}}
    }
    g.restore();
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

export function attachFacadeAtlas(material, atlas) {
  // map is retained for texture accounting/disposal; shader sampling is distance
  // gated instead of applying the tile over every far-away flat block.
  material.map=atlas;material.userData.worldFacade=true;
  material.customProgramCacheKey=()=> 'osm-facade-atlas-v2';
  material.onBeforeCompile=sh=>{
    sh.uniforms.uWorldDetail=worldDetailEnabled;
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 aFacade; varying vec4 vFacade; varying float vFacadeDistance;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvFacade=aFacade; vFacadeDistance=length((modelMatrix*vec4(position,1.)).xz-cameraPosition.xz);');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uWorldDetail; varying vec4 vFacade; varying float vFacadeDistance;')
      .replace('#include <map_fragment>',`#ifdef USE_MAP
float facadeMix=uWorldDetail*(1.-smoothstep(160.,240.,vFacadeDistance));
      if(facadeMix>0. && vFacade.w<.5){
        // A constant integer attribute can interpolate a few ULPs below its
        // value. Round before selecting a tile, especially at the style-4 seam.
        float style=floor(vFacade.z+.5);
        vec2 tile=vec2(mod(style,4.),1.-floor(style/4.));
        vec2 uv=(tile+(fract(vFacade.xy)*.984+.008))/vec2(4.,2.);
        vec3 paint=texture2D(map,uv).rgb;
        // Reuse the tile's windows as ground-floor shopfronts; a narrow door
        // appears once per facade bay without any new geometry.
        if(vFacade.y<1.){
          float door=step(.4,fract(vFacade.x))*step(fract(vFacade.x),.6);
          paint=mix(paint,vec3(.14,.20,.22),door*.75);
        }
        diffuseColor.rgb*=mix(vec3(1.),paint,facadeMix);
      }
#endif`);
  };
  return material;
}

/** AWT adapters can call this on each ≤40-triangle shell before batching, or
 * emit this same aFacade vec4 directly in the offline packed vertex stream. */
export function facadeCoordinates(geometry, {style=0,base=0,cx=0,cz=0}={}) {
  const p=geometry.attributes.position,n=geometry.attributes.normal,values=new Float32Array(p.count*4);
  for(let i=0;i<p.count;i++){
    values[i*4]=((p.getX(i)-cx)*n.getZ(i)-(p.getZ(i)-cz)*n.getX(i))/5.5;
    values[i*4+1]=(p.getY(i)-base)/3.1;values[i*4+2]=style;values[i*4+3]=Math.abs(n.getY(i))>.5?1:0;
  }
  geometry.setAttribute('aFacade',new THREE.BufferAttribute(values,4));return geometry;
}
