// One shared, deterministic 128² RGBA atlas: streak / mist / puddle / foam.
// No simulated drops, emitters, lights, render targets or post-processing.
import * as THREE from 'three';
export const RAIN_BUDGET = Object.freeze({ layers: 2, sprayCards: 18, textureBytes: 65536 });
let atlas;
export function rainAtlas() {
  if (atlas) return atlas;
  const n=128, data=new Uint8Array(n*n*4);
  const waves=Array.from({length:n},(_,i)=>[Math.sin(i*.7),Math.sin(i*.4),Math.sin((i+.5)/n*29),Math.sin((i+.5)/n*23)]);
  const streak=Array.from({length:28},(_,i)=>Math.round(220*Math.sin(i/28*Math.PI)));
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const i=(y*n+x)*4, u=(x+.5)/n, v=(y+.5)/n;
    const dx=u*2-1,dy=v*2-1,r2=dx*dx+dy*dy,r=Math.sqrt(r2);
    // Sparse fixed streaks, wrapped by the texture sampler at runtime.
    const column=(x*37)%127, phase=(y+column*13)%128;
    data[i]=column<5 && phase<28 ? streak[phase] : 0;
    data[i+1]=Math.round(255*Math.max(0,1-r2)**2);
    const puddle=Math.sqrt(((u-.48)*8)**2+((v-.52)*10)**2)+.12*waves[x][2]*waves[y][3];
    data[i+2]=Math.round(255*(1-THREE.MathUtils.smoothstep(puddle,.65,1)));
    data[i+3]=Math.round(255*Math.max(0,1-Math.abs(r-.68)/.18));
  }
  atlas=new THREE.DataTexture(data,n,n);atlas.wrapS=atlas.wrapT=THREE.RepeatWrapping;
  atlas.magFilter=atlas.minFilter=THREE.LinearFilter;atlas.generateMipmaps=false;atlas.needsUpdate=true;
  atlas.name='rain-overlay-atlas';atlas.userData.shared=true;return atlas;
}
export function createRain() {
  const g=new THREE.PlaneGeometry(2,2), inst=new THREE.InstancedBufferGeometry();
  inst.index=g.index;inst.attributes=g.attributes;
  inst.setAttribute('aLayer',new THREE.InstancedBufferAttribute(new Float32Array([0,1]),1));inst.instanceCount=2;
  const mat=new THREE.ShaderMaterial({uniforms:{uMap:{value:rainAtlas()},uTime:{value:0},uCol:{value:new THREE.Vector3(.5,.5,.5)},uAlpha:{value:0}},
    vertexShader:`attribute float aLayer; varying vec2 vUv; varying float vLayer;
      void main(){vLayer=aLayer;vUv=uv;float d=mix(3.,9.,aLayer);gl_Position=projectionMatrix*vec4(position.x*d/projectionMatrix[0][0],position.y*d/projectionMatrix[1][1],-d,1.);}`,
    fragmentShader:`uniform sampler2D uMap;uniform float uTime,uAlpha;uniform vec3 uCol;varying vec2 vUv;varying float vLayer;
      void main(){vec2 p=vUv*vec2(3.+vLayer,2.+vLayer);p+=vec2(uTime*.045,uTime*(.9+vLayer*.3));float a=texture2D(uMap,p).r*uAlpha;gl_FragColor=vec4(uCol,a);}`,
    transparent:true,depthWrite:false});
  const mesh=new THREE.Mesh(inst,mat);mesh.name='rain-streak-overlays';mesh.frustumCulled=false;mesh.renderOrder=7;mesh.visible=false;
  return {mesh,mat};
}
export class SprayCards {
  constructor(scene) {
    const base=new THREE.PlaneGeometry(1,1),g=this.g=new THREE.InstancedBufferGeometry();g.index=base.index;g.attributes=base.attributes;
    this.pos=new Float32Array(18*3);this.shape=new Float32Array(18*3);this.k=0;
    g.setAttribute('aCentre',new THREE.InstancedBufferAttribute(this.pos,3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape',new THREE.InstancedBufferAttribute(this.shape,3).setUsage(THREE.DynamicDrawUsage));g.instanceCount=0;
    this.mat=new THREE.ShaderMaterial({uniforms:{uMap:{value:rainAtlas()},uCol:{value:new THREE.Vector3(.6,.6,.6)}},
      vertexShader:`attribute vec3 aCentre,aShape;varying vec2 vUv;varying float vA;void main(){vUv=uv;vA=aShape.z;vec4 p=viewMatrix*vec4(aCentre,1.);p.xy+=position.xy*aShape.xy;gl_Position=projectionMatrix*p;}`,
      fragmentShader:`uniform sampler2D uMap;uniform vec3 uCol;varying vec2 vUv;varying float vA;void main(){gl_FragColor=vec4(uCol,texture2D(uMap,vUv).g*vA);}`,
      transparent:true,depthWrite:false});
    this.pts=new THREE.Mesh(g,this.mat);this.pts.name='tyre-spray-cards';this.pts.frustumCulled=false;this.pts.renderOrder=5;this.pts.visible=false;scene.add(this.pts);
  }
  begin(){this.k=0;}
  add(x,y,z,speed,alpha){if(this.k>=18)return;const i=this.k++*3;this.pos.set([x,y,z],i);this.shape.set([.7+speed*.018,.45+speed*.025,alpha],i);}
  update(){this.g.instanceCount=this.k;this.g.attributes.aCentre.needsUpdate=true;this.g.attributes.aShape.needsUpdate=true;}
}
// Water-entry splash: one expanding mist billboard plus one flat foam decal.
export class WaterSplash {
  constructor(scene,waterY) {
    this.waterY=waterY;this.t=9;this.life=new Float32Array(1);
    const material=(foam)=>new THREE.ShaderMaterial({uniforms:{uMap:{value:rainAtlas()},uAlpha:{value:0}},
      vertexShader:foam?'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}':
        'varying vec2 vUv;void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(0.,0.,0.,1.);p.xy+=position.xy*vec2(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));gl_Position=projectionMatrix*p;}',
      fragmentShader:`uniform sampler2D uMap;uniform float uAlpha;varying vec2 vUv;void main(){gl_FragColor=vec4(.82,.88,.90,texture2D(uMap,vUv).${foam?'a':'g'}*uAlpha);}`,
      transparent:true,depthWrite:false});
    this.pts=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material(false));
    this.ring=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material(true));this.ring.rotation.x=-Math.PI/2;
    for(const o of [this.pts,this.ring]){o.visible=false;scene.add(o);}
  }
  burst(x,z,vx,vz,power=1){this.power=THREE.MathUtils.clamp(power,.3,1);this.t=0;this.life[0]=1;this.pts.position.set(x,this.waterY+.6,z);this.ring.position.set(x,this.waterY+.04,z);this.update(0);}
  update(dt){if(this.t>4)return;this.t+=dt;const fade=Math.max(0,1-this.t/2.5);this.life[0]=fade;
    this.pts.visible=this.ring.visible=fade>0;
    this.pts.scale.set(4+this.t*6,2+this.t*4,1);this.pts.position.y=this.waterY+.6+this.t*.4;
    this.ring.scale.setScalar(5+this.t*15);this.pts.material.uniforms.uAlpha.value=fade*this.power*.75;this.ring.material.uniforms.uAlpha.value=fade*.65;
  }
}
