import * as THREE from 'three';
// The retained Psychiko trees use merged cell meshes instead of instances.
// Keep their existing distance shader, and fade newly rebuilt cells as well.
export function fadeMergedVegetation(mesh) {
  const source=mesh.material,material=mesh.material=source.clone(),born=performance.now(),age={value:0};
  material.customProgramCacheKey=()=>source.customProgramCacheKey()+'-vegetation-arrival-v1';
  material.onBeforeCompile=shader=>{
    source.onBeforeCompile(shader);shader.uniforms.uVegetationArrival=age;
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uVegetationArrival;').replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      if(smoothstep(0.,1.2,uVegetationArrival)<=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715)))))discard;
    `);
  };
  mesh.onBeforeRender=()=>{age.value=(performance.now()-born)/1000;};
  mesh.geometry.addEventListener('dispose',()=>material.dispose());
  return mesh;
}
// Opaque ordered dithering: no transparent sorting, extra passes or textures.
// Distance is evaluated every frame, not at the 8 m instance-list rebuilds.
export class VegetationFade {
  constructor(){this.clock={value:0};this.eye={value:new THREE.Vector2()};this.start=performance.now();this.batches=new Set();}
  attach(mesh,capacity){
    const data=new Float32Array(capacity*4),attribute=new THREE.InstancedBufferAttribute(data,4);attribute.setUsage(THREE.DynamicDrawUsage);mesh.geometry.setAttribute('aVegetationFade',attribute);
    const batch={attribute,ids:new Uint32Array(capacity),count:0,lookup:null};this.batches.add(batch);mesh.userData.vegetationFade=batch;
    const source=mesh.material,before=source.onBeforeCompile.bind(source),key=source.customProgramCacheKey.bind(source),material=mesh.material=source.clone();
    material.customProgramCacheKey=()=>key()+'-vegetation-dither-v1';
    material.onBeforeCompile=shader=>{
      before(shader);shader.uniforms.uVegetationTime=this.clock;shader.uniforms.uVegetationEye=this.eye;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 aVegetationFade;uniform float uVegetationTime;uniform vec2 uVegetationEye;varying float vVegetationFade;').replace('#include <begin_vertex>',`#include <begin_vertex>
        float vd=distance(instanceMatrix[3].xz,uVegetationEye);
        float enter=aVegetationFade.x<=0. ? 1. : smoothstep(aVegetationFade.x,aVegetationFade.x+aVegetationFade.z,vd);
        float leave=1.-smoothstep(aVegetationFade.y-aVegetationFade.z,aVegetationFade.y,vd);
        vVegetationFade=enter*leave*smoothstep(0.,1.2,uVegetationTime-aVegetationFade.w);
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vVegetationFade;').replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
        // Stable screen-door coverage, including late cells entering the view.
        float threshold=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
        if(vVegetationFade<=threshold)discard;
      `);
    };
  }
  update(x,z){this.clock.value=(performance.now()-this.start)/1000;this.eye.value.set(x,z);}
  begin(){for(const b of this.batches){b.lookup=new Map();for(let i=0;i<b.count;i++)b.lookup.set(b.ids[i],b.attribute.getW(i));b.count=0;}}
  write(mesh,slot,key,lower,upper,width){const b=mesh.userData.vegetationFade,id=typeof key==='number'?key>>>0:(Math.imul(Math.round(key.x*100),73856093)^Math.imul(Math.round(key.z*100),19349663)^key.species)>>>0,birth=b.lookup.get(id)??this.clock.value;b.ids[slot]=id;b.count=Math.max(b.count,slot+1);b.attribute.setXYZW(slot,lower,upper,width,birth);}
  end(){for(const b of this.batches){b.lookup=null;b.attribute.needsUpdate=true;}}
}
