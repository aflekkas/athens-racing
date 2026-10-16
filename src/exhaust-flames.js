import * as THREE from 'three';
import {canvasTex} from './util.js';
import {ExhaustPulse} from './exhaust-pops.js';
// Three crossed, textured ribbons per pipe. All GPU resources and mirror copies
// are pooled; local +Z is the exhaust axis, so no camera-dependent attachment.
const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`uniform sampler2D noiseMap;uniform float phase,seed,strength;varying vec2 vUv;
void main(){
 float t=vUv.y;
 float n=texture2D(noiseMap,vec2(t*1.7-phase*2.6+seed,vUv.x*.8+seed)).r;
 float fine=texture2D(noiseMap,vec2(vUv.x*2.+seed,t*3.-phase*4.)).r;
 float bend=sin(t*19.-phase*43.+seed*17.)*.11*t;
 float width=(1.-t)*(.80+.27*sin(t*23.-phase*51.+seed*9.))*(.6+.4*n);
 float edge=1.-smoothstep(width*.48,width,abs(vUv.x*2.-1.+bend));
 float tail=1.-smoothstep(.28+.35*n,1.,t);
 float alpha=edge*tail*(.55+.45*fine)*strength;
 vec3 core=mix(vec3(.18,.38,2.3),vec3(2.4,2.7,3.2),smoothstep(0.,.12,t));
 vec3 fire=mix(vec3(3.2,1.7,.12),vec3(2.2,.18,.015),smoothstep(.25,1.,t));
 vec3 color=mix(core,fire,smoothstep(.12,.34,t));
 gl_FragColor=vec4(color,alpha);
}`;
export class ExhaustFlames {
 constructor(car){
  this.pulse=new ExhaustPulse();this.group=new THREE.Group();this.group.name='svj-exhaust-flames';this.group.visible=false;car.body.add(this.group);this.flames=[];this.glows=[];
  const data=new Uint8Array(32*32*4);let seed=770;for(let i=0;i<data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=data[i+1]=data[i+2]=seed>>>24;data[i+3]=255;}
  this.noiseMap=new THREE.DataTexture(data,32,32);this.noiseMap.wrapS=this.noiseMap.wrapT=THREE.RepeatWrapping;this.noiseMap.magFilter=this.noiseMap.minFilter=THREE.LinearFilter;this.noiseMap.needsUpdate=true;
  this.glowMap=canvasTex(32,32,(c,w,h)=>{const g=c.createRadialGradient(16,16,0,16,16,16);g.addColorStop(0,'rgba(130,180,255,.65)');g.addColorStop(.3,'rgba(80,120,255,.15)');g.addColorStop(1,'rgba(60,80,255,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
  const geo=new THREE.PlaneGeometry(1,1,1,1);geo.rotateX(Math.PI/2);geo.translate(0,0,.5);
  // PlaneGeometry's top UV must correspond to the distant end of the jet.
  for(let i=0;i<geo.attributes.uv.count;i++)geo.attributes.uv.setY(i,geo.attributes.position.getZ(i));
  this.ribbonGeometry=geo;
  for(let k=0;k<car.exhaust.length;k++){
   const g=new THREE.Group();g.position.copy(car.exhaust[k]);this.group.add(g);
   const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:this.glowMap,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));glow.position.z=.025;glow.scale.set(.13,.13,1);g.add(glow);this.glows.push(glow);
   for(let j=0;j<3;j++){const m=new THREE.ShaderMaterial({uniforms:{noiseMap:{value:this.noiseMap},phase:{value:0},seed:{value:k*.37+j*.19},strength:{value:0}},vertexShader:vertex,fragmentShader:fragment,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});const f=new THREE.Mesh(geo,m);f.rotation.z=j*Math.PI/3;g.add(f);this.flames.push(f);}
  }
  this.light=new THREE.PointLight('#ff8833',0,4,2);this.light.position.set(0,.8,car.exhaust[0].z+.2);this.group.add(this.light);
  this.positions=new Float32Array(24);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(this.positions,3));this.sparks=new THREE.Points(g,new THREE.PointsMaterial({color:'#ffcc77',size:.025,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));this.sparks.frustumCulled=false;this.group.add(this.sparks);this.z=car.exhaust[0].z;
  this.mirrorRoot=this.group.clone(true);this.mirrorRoot.name='svj-mirror-flames';this.mirrorRoot.matrixAutoUpdate=false;this.mirrorRoot.visible=false;this.mirrorFlames=[];this.mirrorRoot.traverse(o=>{if(o.isMesh)this.mirrorFlames.push(o);});
 }
 update(dt,signals,enabled,quality='high'){
  const p=this.pulse;p.update(dt,signals,enabled);const duration=p.kind===2?.08:p.kind===3?.075:.06,age=duration-p.life;
  const a=p.life>0?p.level*Math.min(1,p.life/duration*3):0;this.group.visible=a>0;
  const variation=.78+.22*Math.sin(p.serial*12.3),length=(p.kind===2?.8:p.kind===3?.48:.44)*variation;
  for(let i=0;i<this.flames.length;i++){const f=this.flames[i],u=f.material.uniforms;u.strength.value=a*(p.kind===1?1.2:.8);u.phase.value=p.clock;u.seed.value=p.serial*.173+(i%3)*.19+Math.floor(i/3)*.37;
   f.scale.set(p.kind===2?.17:p.kind===3?.13:.12,1,length*(.8+.2*Math.sin(p.clock*177+i*1.7)));this.mirrorFlames[i].scale.copy(f.scale);}
  for(let i=0;i<this.glows.length;i++)this.glows[i].material.opacity=a*.24;
  this.light.visible=quality!=='potato'&&quality!=='low';this.light.intensity=this.light.visible?a*9:0;
  this.sparks.visible=quality!=='potato'&&p.kind===2&&p.serial%2===0;
  this.mirrorRoot.children[2].visible=this.light.visible;this.mirrorRoot.children[2].intensity=this.light.intensity;this.mirrorRoot.children[3].visible=this.sparks.visible;
  for(let i=0;i<8;i++){const t=age*(4+i*.23);this.positions[i*3]=(i%2?-.155:.155)+Math.sin(i*7)*t*.19;this.positions[i*3+1]=.72+Math.cos(i*4)*t*.16;this.positions[i*3+2]=this.z+t;}
  this.sparks.geometry.attributes.position.needsUpdate=true;this.sparks.material.opacity=a;
 }
 beginMirror(body){this.mirrorRoot.matrix.copy(body.matrixWorld);this.mirrorRoot.matrixWorldNeedsUpdate=true;this.mirrorRoot.visible=this.group.visible;}
 endMirror(){this.mirrorRoot.visible=false;}
 dispose(){this.mirrorRoot.removeFromParent();this.mirrorRoot.children[2].dispose();this.group.removeFromParent();for(const f of this.flames)f.material.dispose();for(const g of this.glows)g.material.dispose();this.ribbonGeometry.dispose();this.sparks.geometry.dispose();this.sparks.material.dispose();this.light.dispose();this.glowMap.dispose();this.noiseMap.dispose();}
}
