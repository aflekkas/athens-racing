// One shared, deterministic 128² RGBA atlas: streak / mist / puddle / foam.
// Falling streaks are deterministic instanced quads; no per-drop CPU simulation or extra passes.
import * as THREE from 'three';
export const RAIN_BUDGET = Object.freeze({ streaks: 640, lowStreaks: 320, sprayCards: 18, textureBytes: 65536 });
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
  const g=new THREE.PlaneGeometry(1,1), inst=new THREE.InstancedBufferGeometry();
  inst.index=g.index;inst.attributes=g.attributes;
  const seeds=new Float32Array(RAIN_BUDGET.streaks*4);
  // Stable independent positions, widths and fall rates: no repeating screen tile.
  let seed=7193;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<seeds.length;i++)seeds[i]=random();
  inst.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seeds,4));inst.instanceCount=RAIN_BUDGET.lowStreaks;
  const mat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uCol:{value:new THREE.Vector3(.5,.5,.5)},uAlpha:{value:0},
    uVelocity:{value:new THREE.Vector3()},uLamp:{value:new Float32Array(16)},uHead:{value:new THREE.Vector4()},uForward:{value:new THREE.Vector3(0,0,-1)}},
    vertexShader:/* glsl */`attribute vec4 aSeed;uniform float uTime;uniform vec3 uVelocity,uCol,uForward;uniform vec4 uLamp[4],uHead;
      varying vec2 vUv;varying float vFade;varying vec3 vCol;
      void main(){
        vUv=uv;
        vec3 fall=vec3(1.4,-14.-aSeed.w*5.,.6);
        // A world-aligned volume wraps beyond the visible near field, including during turns.
        vec3 span=vec3(32.,24.,32.);
        vec3 rel=mod(aSeed.xyz*span+fall*uTime-cameraPosition,span)-span*.5;
        vec3 world=cameraPosition+rel;
        vec4 p=viewMatrix*vec4(world,1.);
        vec3 velocity=mat3(viewMatrix)*(fall-uVelocity);
        float exposure=.018+aSeed.w*.012;
        vec4 tail=projectionMatrix*vec4(p.xyz-velocity*exposure,1.);
        vec4 head=projectionMatrix*p;
        vec2 delta=tail.xy/max(tail.w,.2)-head.xy/max(head.w,.2);
        vec2 axis=length(delta)>.00001?normalize(delta):vec2(0.,1.);
        vec2 side=vec2(axis.y,-axis.x); // preserve the quad winding (front-facing)
        // Width in metres, with a subpixel floor to avoid sparkling at distance.
        float width=max((.009+aSeed.w*.012)*projectionMatrix[1][1]/max(-p.z,1.),.00065);
        gl_Position=mix(head,tail,uv.y);
        gl_Position.xy+=side*position.x*width*gl_Position.w;
        vFade=smoothstep(.7,2.5,-p.z)*(1.-smoothstep(12.,16.,length(rel.xz)))*mix(.65,1.,aSeed.w);
        vCol=uCol;
        vec3 hr=world-uHead.xyz;float along=dot(hr,uForward);
        float beam=smoothstep(.82,.98,dot(normalize(hr+vec3(.0001)),uForward));
        vCol+=vec3(.26,.25,.22)*uHead.w*beam*smoothstep(0.,3.,along)*(1.-smoothstep(12.,45.,along));
        for(int i=0;i<4;i++){vec3 d=world-uLamp[i].xyz;vCol+=vec3(.30,.23,.14)*uLamp[i].w/(dot(d,d)+4.);}
      }`,
    fragmentShader:/* glsl */`uniform float uAlpha;varying vec2 vUv;varying float vFade;varying vec3 vCol;
      void main(){float across=1.-smoothstep(.05,.5,abs(vUv.x-.5));float ends=sin(vUv.y*3.14159265);
        gl_FragColor=vec4(vCol,uAlpha*vFade*across*ends*ends);}`,
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
    this.mat=new THREE.ShaderMaterial({uniforms:{uMap:{value:rainAtlas()},uTime:{value:0},uCol:{value:new THREE.Vector3(.6,.6,.6)}},
      vertexShader:`attribute vec3 aCentre,aShape;varying vec2 vUv;varying float vA;void main(){vUv=uv;vA=aShape.z;vec4 p=viewMatrix*vec4(aCentre,1.);p.xy+=position.xy*aShape.xy;gl_Position=projectionMatrix*p;}`,
      fragmentShader:`uniform sampler2D uMap;uniform float uTime;uniform vec3 uCol;varying vec2 vUv;varying float vA;void main(){float cloud=texture2D(uMap,vUv).g;float curl=.8+.2*sin(vUv.x*17.+uTime*3.)*sin(vUv.y*13.-uTime*2.);gl_FragColor=vec4(uCol,cloud*curl*vA);}`,
      transparent:true,depthWrite:false});
    this.pts=new THREE.Mesh(g,this.mat);this.pts.name='tyre-spray-cards';this.pts.frustumCulled=false;this.pts.renderOrder=5;this.pts.visible=false;scene.add(this.pts);
  }
  begin(){this.k=0;}
  add(x,y,z,speed,alpha){if(this.k>=18)return;const i=this.k++*3;this.pos.set([x,y,z],i);this.shape.set([.6+speed*.04,.35+speed*.012,alpha],i);}
  update(dt=0){this.mat.uniforms.uTime.value+=dt;this.g.instanceCount=this.k;this.g.attributes.aCentre.needsUpdate=true;this.g.attributes.aShape.needsUpdate=true;}
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
