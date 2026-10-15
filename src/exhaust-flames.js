import * as THREE from 'three';
import {canvasTex} from './util.js';
import {ExhaustPulse} from './exhaust-pops.js';
// All geometry, materials, light and spark vertices are constructed once per car.
export class ExhaustFlames {
 constructor(car){
  this.pulse=new ExhaustPulse();this.group=new THREE.Group();this.group.name='svj-exhaust-flames';this.group.visible=false;car.body.add(this.group);this.flames=[];this.glows=[];
  this.glowMap=canvasTex(32,32,(c,w,h)=>{const g=c.createRadialGradient(16,16,0,16,16,16);g.addColorStop(0,'rgba(255,200,90,.8)');g.addColorStop(.3,'rgba(255,100,20,.25)');g.addColorStop(1,'rgba(255,70,10,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
  for(const tip of car.exhaust){
   const g=new THREE.Group();g.position.copy(tip);this.group.add(g);
   const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:this.glowMap,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));glow.position.z=.08;glow.scale.set(.45,.45,1);g.add(glow);this.glows.push(glow);
   for(let j=0;j<2;j++){const m=new THREE.MeshBasicMaterial({color:j?'#b9d6ff':'#ff6618',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});const geo=new THREE.ConeGeometry(j?.045:.085,j?.32:.62,8,1,true);geo.rotateX(Math.PI/2);geo.translate(0,0,j?.16:.31);const f=new THREE.Mesh(geo,m);g.add(f);this.flames.push(f);}
  }
  this.light=new THREE.PointLight('#ff8833',0,4,2);this.light.position.set(0,.8,car.exhaust[0].z+.2);this.group.add(this.light);
  this.positions=new Float32Array(24);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(this.positions,3));this.sparks=new THREE.Points(g,new THREE.PointsMaterial({color:'#ffbb55',size:.025,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));this.sparks.frustumCulled=false;this.group.add(this.sparks);this.z=car.exhaust[0].z;
  this.mirrorRoot=this.group.clone(true);this.mirrorRoot.name='svj-mirror-flames';this.mirrorRoot.matrixAutoUpdate=false;this.mirrorRoot.visible=false;this.mirrorFlames=[];this.mirrorRoot.traverse(o=>{if(o.isMesh)this.mirrorFlames.push(o);});
 }
 update(dt,signals,enabled,quality='high'){
  const p=this.pulse;p.update(dt,signals,enabled);const a=p.life>0?p.level*Math.min(1,p.life*22):0;this.group.visible=a>0;
  for(let i=0;i<this.flames.length;i++){const f=this.flames[i];f.material.opacity=a*(i%2?.85:.65);f.scale.z=.65+.35*Math.sin(p.clock*113+i);this.mirrorFlames[i].scale.z=f.scale.z;}
  for(let i=0;i<this.glows.length;i++)this.glows[i].material.opacity=a*.55;
  this.light.visible=quality!=='potato'&&quality!=='low';this.light.intensity=this.light.visible?a*9:0;
  this.sparks.visible=quality!=='potato'&&p.kind===2&&p.serial%2===0;
  this.mirrorRoot.children[2].visible=this.light.visible;this.mirrorRoot.children[2].intensity=this.light.intensity;this.mirrorRoot.children[3].visible=this.sparks.visible;
  for(let i=0;i<8;i++){const t=(.17-p.life)*(2+i*.13);this.positions[i*3]=(i%2?-.155:.155)+Math.sin(i*7)*t*.13;this.positions[i*3+1]=.72+Math.cos(i*4)*t*.1;this.positions[i*3+2]=this.z+t;}
  this.sparks.geometry.attributes.position.needsUpdate=true;this.sparks.material.opacity=a;
 }
 beginMirror(body){this.mirrorRoot.matrix.copy(body.matrixWorld);this.mirrorRoot.matrixWorldNeedsUpdate=true;this.mirrorRoot.visible=this.group.visible;}
 endMirror(){this.mirrorRoot.visible=false;}
 dispose(){this.mirrorRoot.removeFromParent();this.mirrorRoot.children[2].dispose();this.group.removeFromParent();this.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.light.dispose();this.glowMap.dispose();}
}
