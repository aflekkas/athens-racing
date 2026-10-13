// First-person interior: dashboard, instrument cluster with live gauges (canvas texture), shift lights,
// steering wheel the driver's hands hold, centre nav screen, working rear-view + door mirrors (render target),
// and an interior shell (headliner, pillars, door cards) generated from the body loft for closed cars.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './util.js';
import { TX, GLSL_HELPERS } from './tex.js';
import { CAR_ENV } from './cars.js';
import { nearestSurface } from './vehicle-mirrors.js';

/**
 * Interior trim: grained soft-touch plastics, perforated / stitched leather and suede-like fabric, sampled
 * tri-planar in object space from the photographed leather scan (normal + roughness) so any shape takes it.
 */
export function trimMat(color, { rough = 0.7, scale = 0.12, nk = 0.7, metal = 0, stitch = 0, side = THREE.FrontSide, sheen = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side });
  m.customProgramCacheKey = () => `trim6_${scale}_${nk}_${stitch}_${sheen}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tLN: { value: TX.leather_nor }, tLR: { value: TX.leather_arm } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tLN; uniform sampler2D tLR; varying vec3 vOP; varying vec3 vON; vec2 iUV; vec3 iN; float iR;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 an = abs(normalize(vON));
        iUV = (an.y > max(an.x, an.z) ? vOP.xz : an.x > an.z ? vOP.zy : vOP.xy) / ${scale.toFixed(3)};
        iN = texture2D(tLN, iUV).xyz * 2.0 - 1.0;
        iR = texture2D(tLR, iUV).g;
        diffuseColor.rgb *= 0.9 + 0.2 * texture2D(tLR, iUV * 0.37).r;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.75 + 0.5 * iR), 0.05, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, iUV, iN, ${nk.toFixed(2)});`);
    // suede-like fabrics: a soft rim sheen
    if (sheen > 0) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float nv = abs(dot(normalize(normal), normalize(vViewPosition))); totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - nv, 3.0) * ${sheen.toFixed(2)}; }`);
  };
  return m;
}
/** a reflection-only layer (additive): glass covers and windscreens that pick up the sky without hiding what's behind */
export function glassSheen(strength = 1) {
  return new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: strength, specularIntensity: 1 });
}
const TRIM = () => trimMat('#1d1d1f', { rough: 0.62, scale: 0.16, nk: 0.55 });

const LABELS=new Map();
function labelMaterial(text,color='#d7dcdf'){
  const key=text+'|'+color;if(LABELS.has(key))return LABELS.get(key);
  const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');x.fillStyle=color;x.textAlign='center';x.textBaseline='middle';x.font='500 36px Arial';
  const lines=text.split('\n');lines.forEach((l,i)=>x.fillText(l,256,64+(i-(lines.length-1)/2)*49));
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,toneMapped:false});LABELS.set(key,m);return m;
}
let WOOD;
function woodTrim(){
  if(WOOD)return WOOD;
  const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');x.fillStyle='#795132';x.fillRect(0,0,512,128);
  for(let i=0;i<95;i++){x.strokeStyle=i%3===0?'#9c6d45':'#604029';x.globalAlpha=.22;x.lineWidth=.5+(i%4)*.3;x.beginPath();for(let k=0;k<=32;k++){const y=i*1.7+Math.sin(k*.32+i*.26)*2+Math.sin(k*.12+i*.31)*3;k?x.lineTo(k*16,y):x.moveTo(k*16,y);}x.stroke();}
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
  return WOOD=new THREE.MeshPhysicalMaterial({map,color:'#ddbb8d',roughness:.31,clearcoat:.8,clearcoatRoughness:.24,envMap:CAR_ENV.tex});
}
let MIRROR_FALLBACK;
function mirrorFallback(){
  if(MIRROR_FALLBACK)return MIRROR_FALLBACK;
  const c=document.createElement('canvas');c.width=512;c.height=144;const x=c.getContext('2d'),sky=x.createLinearGradient(0,0,0,144);
  sky.addColorStop(0,'#708da3');sky.addColorStop(.5,'#b4c7cd');sky.addColorStop(.51,'#7c8a85');sky.addColorStop(1,'#4c545a');x.fillStyle=sky;x.fillRect(0,0,512,144);
  x.fillStyle='#636a70';x.beginPath();x.moveTo(235,76);x.lineTo(282,76);x.lineTo(440,144);x.lineTo(70,144);x.fill();
  MIRROR_FALLBACK=new THREE.CanvasTexture(c);MIRROR_FALLBACK.colorSpace=THREE.SRGBColorSpace;return MIRROR_FALLBACK;
}
// A single canvas draw keeps animated instruments at one draw call per vehicle.
function instrumentDial(g,{x,y,r,max,value,step=1,label='',red=Infinity,classic=false}){
  g.fillStyle='#0b0d10';g.strokeStyle=classic?'#a7a28c':'#777f84';g.lineWidth=3;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.stroke();
  g.textAlign='center';g.textBaseline='middle';
  for(let v=0;v<=max+.001;v+=step/5){const major=Math.abs(v/step-Math.round(v/step))<.005,a=Math.PI*.75+v/max*Math.PI*1.5;
    g.strokeStyle=v>=red?'#cb463d':classic?'#e5dec5':'#e1e7eb';g.lineWidth=major?2.7:1.2;g.beginPath();g.moveTo(x+Math.cos(a)*(r-5),y+Math.sin(a)*(r-5));g.lineTo(x+Math.cos(a)*(r-(major?17:10)),y+Math.sin(a)*(r-(major?17:10)));g.stroke();
    if(major){g.fillStyle=classic?'#ece3ca':'#d7e0e8';g.font=`${Math.round(r*.18)}px Arial`;g.fillText(Math.round(v),x+Math.cos(a)*(r-31),y+Math.sin(a)*(r-31));}}
  const a=Math.PI*.75+clamp(value/max,0,1)*Math.PI*1.5;g.strokeStyle=classic?'#ece1c3':'#f16c4d';g.lineWidth=3.2;g.beginPath();g.moveTo(x-Math.cos(a)*r*.12,y-Math.sin(a)*r*.12);g.lineTo(x+Math.cos(a)*(r-21),y+Math.sin(a)*(r-21));g.stroke();
  g.fillStyle='#33383a';g.beginPath();g.arc(x,y,7,0,Math.PI*2);g.fill();g.fillStyle=classic?'#c1bca7':'#bbc7cf';g.font=`${Math.round(r*.12)}px Arial`;g.fillText(label,x,y+r*.47);
}

// Bake only direct static meshes; each moving frame is compacted independently.
function compactCockpit(parent,keep=new Set()){
  const batches=new Map();parent.updateMatrixWorld(true);
  for(const mesh of [...parent.children]){
    if(!mesh.isMesh||keep.has(mesh)||Array.isArray(mesh.material)||mesh.material.transparent)continue;
    const side=mesh.userData.damageInterior?mesh.userData.damageSide||'interior':'fixed';
    const key=mesh.material.uuid+'|'+side;
    if(!batches.has(key))batches.set(key,{material:mesh.material,side,meshes:[]});
    batches.get(key).meshes.push(mesh);
  }
  for(const {material,side,meshes}of batches.values()){
    if(meshes.length<2)continue;
    const geometries=meshes.map(mesh=>{
      mesh.updateMatrix();let geo=mesh.geometry.clone().applyMatrix4(mesh.matrix);
      if(geo.index){const indexed=geo;geo=indexed.toNonIndexed();indexed.dispose();}
      for(const key of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(key))geo.deleteAttribute(key);
      return geo;
    });
    const geometry=mergeGeometries(geometries,false);for(const geo of geometries)geo.dispose();
    if(!geometry)continue;
    const combined=new THREE.Mesh(geometry,material);combined.name='cockpit-batch-'+side;
    if(side!=='fixed'){combined.userData.damageInterior=true;combined.userData.damageSide=side;}
    for(const mesh of meshes){mesh.removeFromParent();mesh.geometry.dispose();}
    parent.add(combined);
  }
}

export class Cockpit {
  constructor(spec, model, mirrorTex) {
    this.spec = spec; this.model = model;
    if (model.exteriorDash) model.exteriorDash.visible = false;
    const isMini=spec.id==='mini',isBMW=spec.id==='z4',isSkoda=spec.id==='taxi'||spec.police||spec.id==='superb',isClassic=spec.id==='gtv',isPorsche=spec.id==='carrera',isYaris=spec.id==='gr_yaris';
    const g=this.group=new THREE.Group();g.name='cockpit';(model.visualLOD?.levels[0].object||model.body).add(g);
    const eye=this.eye=model.seat.clone(),wheelC=this.wheelC=eye.clone().add(new THREE.Vector3(0,-.33,-.43));
    const trim=TRIM(),soft=trimMat('#111315',{rough:.8,scale:.18,nk:.4,side:THREE.DoubleSide});
    const alu=new THREE.MeshStandardMaterial({color:'#9ba1a6',metalness:.86,roughness:.32,envMap:CAR_ENV.tex});
    const gloss=new THREE.MeshPhysicalMaterial({color:'#101113',roughness:.22,clearcoat:.7,envMap:CAR_ENV.tex});
    const leatherTop=trimMat(isBMW?'#171412':'#141416',{rough:.64,scale:.08,nk:.45});
    const wood=woodTrim();
    const part=(geo,mat,x,y,z,rx=0,name='')=>{const o=new THREE.Mesh(geo,mat);o.position.set(x,y,z);o.rotation.x=rx;o.name=name;g.add(o);return o;};
    const box=(w,h,d,mat,x,y,z,r=.008,rx=0,name='')=>part(Math.min(w,h,d)<.012?new THREE.BoxGeometry(w,h,d):new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/3,h/3,d/3)),mat,x,y,z,rx,name);
    const label=(text,w,h,x,y,z,colour='#d7dcdf',rx=0)=>part(new THREE.PlaneGeometry(w,h),labelMaterial(text,colour),x,y,z,rx);
    let wsZ,wsY,W;
    if(spec.body==='mini'){wsZ=model.shape.cowl;wsY=model.shape.belt;W=model.dash.w;}
    else{const sh=model.shape;wsZ=-sh.ws[1]*sh.L/2+.05;wsY=sh.belt+.03;W=sh.W*(spec.fleet?.82:isPorsche?.78:isYaris?.84:.92);}
    const topY=Math.min(eye.y-.21,wsY+.06),faceZ=wheelC.z-.15;
    // The padded upper roll and lower knee bolster are separate surfaces, with the actual
    // model's wood, textile or aluminium fascia between them.
    const prof=new THREE.Shape();prof.moveTo(wsZ-.05,wsY-.04);
    prof.quadraticCurveTo((wsZ+faceZ)/2,topY+.035,faceZ+.018,topY);
    prof.quadraticCurveTo(faceZ+.075,topY-.035,faceZ+.055,topY-.10);
    prof.lineTo(faceZ-.045,topY-.37);prof.lineTo(wsZ-.05,topY-.37);prof.closePath();
    const dashWidth=W-(isBMW?.10:isSkoda?.05:0); // The G29 cabin tapers inside the exterior door skin.
    const dashGeo=new THREE.ExtrudeGeometry(prof,{depth:dashWidth,bevelEnabled:false,curveSegments:8});
    dashGeo.applyMatrix4(new THREE.Matrix4().set(0,0,1,-dashWidth/2,0,1,0,0,1,0,0,0,0,0,0,1));dashGeo.computeVertexNormals();
    part(dashGeo,soft,0,0,0,0,'dashboard');
    box(W*.96,.06,.13,leatherTop,0,topY-.005,faceZ-.015,.024);
    const fascia=isClassic?wood:isMini?alu:isSkoda?trimMat('#515459',{rough:.95,scale:.07,nk:.4}):alu;
    box(W*.91,isClassic?.145:isMini?.075:.045,.025,fascia,0,topY-.105,faceZ+.06,.01);
    if(isSkoda){
      // Octavia IV's broad soft textile shelf and silver lower contour.
      box(W*.94,.025,.045,alu,0,topY-.155,faceZ+.088);
      box(W*.91,.004,.005,new THREE.MeshBasicMaterial({color:'#72a6bd'}),0,topY-.146,faceZ+.113);
    }
    if(isYaris){
      // MY24 GR Yaris integrates the cluster and angled centre stack into one flat hood.
      box(W*.68,.235,.085,trim,-W*.12,topY-.027,faceZ-.025,.013,0,'gr-yaris-driver-fascia');
      box(.33,.225,.07,trim,-.005,topY-.23,faceZ+.12,.01,-.12);
    }
    box(W*.35,.16,.028,trim,W*.275,topY-.26,faceZ+.037,.015);
    box(.10,.012,.012,alu,W*.29,topY-.215,faceZ+.056,.004);
    // Instrument cover is correctly sized for each dashboard; no universal half-cylinder hood.
    const cw=isMini?.29:isPorsche?.48:isClassic?.38:isYaris?.42:.43,ch=isMini?.14:isClassic?.165:.17;
    const cy=topY+(isMini?.025:isClassic?-.035:.015),cz=faceZ+(isYaris?.035:.106);
    const ctex=this.clusterCanvas=document.createElement('canvas');ctex.width=1024;ctex.height=384;
    this.clusterTex=new THREE.CanvasTexture(ctex);this.clusterTex.colorSpace=THREE.SRGBColorSpace;this.clusterTex.anisotropy=4;
    const cluster=part(new THREE.PlaneGeometry(cw,ch),new THREE.MeshBasicMaterial({map:this.clusterTex,toneMapped:false,transparent:true}),eye.x,cy,cz,-.16,'instrument-cluster');
    if(isMini){
      const outline=new THREE.Shape(),w=cw+.010,h=ch+.010,rr=h/2;outline.moveTo(-w/2+rr,-h/2);outline.lineTo(w/2-rr,-h/2);outline.absarc(w/2-rr,0,rr,-Math.PI/2,Math.PI/2,false);outline.lineTo(-w/2+rr,h/2);outline.absarc(-w/2+rr,0,rr,Math.PI/2,Math.PI*1.5,false);outline.closePath();
      part(new THREE.ExtrudeGeometry(outline,{depth:.017,bevelEnabled:false,curveSegments:12}),trim,eye.x,cy,cz-.019,-.16);
    }else if(isClassic){
      for(const sx of [-1,1]){
        const tube=part(new THREE.CylinderGeometry(ch*.515,ch*.515,.052,32).rotateX(Math.PI/2),trim,eye.x+sx*cw*.233,cy,cz-.036,-.16);tube.scale.x=.99;
      }
    }else box(cw+.025,ch+.025,.028,trim,eye.x,cy,cz-.018,.012,-.16);
    if(!isMini&&!isClassic)box(cw+.045,.033,.10,leatherTop,eye.x,cy+ch*.56,cz-.027,.016,-.1);
    this.shiftLeds=[];
    // Centre display: circular MINI housing, low integrated 991 PCM, raised G29/Octavia TFT.
    const ncan=this.navCanvas=document.createElement('canvas');ncan.width=256;ncan.height=160;
    this.navTex=new THREE.CanvasTexture(ncan);this.navTex.colorSpace=THREE.SRGBColorSpace;
    const nx=isBMW?.025:isYaris?-.005:0,ny=topY+(isMini?-.065:isPorsche?-.15:isYaris?.02:.035),nz=faceZ+.137;
    const nw=isMini?.225:isPorsche?.245:isBMW?.285:isSkoda?.31:.265,nh=isMini?.125:isPorsche?.135:.153;
    if(!isClassic){
      const bezel=box(nw+.025,nh+.025,.027,gloss,nx,ny,nz-.018,.01,-.15);
      const nav=part(new THREE.PlaneGeometry(nw,nh),new THREE.MeshBasicMaterial({map:this.navTex,toneMapped:false}),nx,ny,nz,-.15,'infotainment');
      if(isYaris){bezel.rotation.y=-.12;nav.rotation.y=-.12;}
    }
    if(isMini){
      part(new THREE.CircleGeometry(.166,40),gloss,nx,ny,nz-.04,-.15);
      for(const [r,t,mat]of [[.166,.0025,alu],[.157,.002,new THREE.MeshBasicMaterial({color:'#86b9c6'})]])part(new THREE.TorusGeometry(r,t,5,40),mat,nx,ny,nz-.01,-.15);
      label('MODE  •  MINI  •  MENU',.14,.012,0,ny-.116,nz+.019,'#bfc4c8',-.15);
    }
    const vent=(x,y,w=.12,h=.042,round=false)=>{
      const z=faceZ+.122;
      if(round){part(new THREE.CircleGeometry(h/2,24),trim,x,y,z);part(new THREE.TorusGeometry(h/2,.0018,6,24),alu,x,y,z+.002);}
      else{box(w,h,.022,trim,x,y,z,.006);box(w-.009,h-.01,.023,gloss,x,y,z+.004,.004);}
      for(let j=-1;j<=1;j++)box(round?h*.72:w*.88,.0028,.006,alu,x,y+j*h*.22,z+.017,.001);
      box(.013,.008,.009,trim,x,y,z+.022,.003);
    };
    if(isMini){for(const x of [-W/2+.09,-.235,.235,W/2-.09])vent(x,topY-.08,.08,.085,true);}
    else if(isClassic){for(const x of [-W/2+.085,W/2-.085])vent(x,topY-.09,.08,.07,true);}
    else if(isYaris){for(const x of [-W/2+.08,W/2-.08])vent(x,topY-.025,.09,.093,true);vent(-.005,topY-.112,.24,.03);}
    else if(isPorsche){for(const x of [-W/2+.10,-.17,.17,W/2-.10])vent(x,topY-.09,.11,x===-.17||x===.17?.12:.055);}
    else{for(const x of [-W/2+.105,W/2-.105])vent(x,topY-.079,.15,.043);for(const x of [-.073,.073])vent(x,topY-(isSkoda?.205:.09),.135,.043);}
    // Switch faces are an inexpensive shared canvas atlas; knobs and buttons have real depth.
    const climateY=topY-(isPorsche?.267:isMini?.265:isSkoda?.153:.186);
    box(.255,.047,.025,gloss,0,climateY,faceZ+.144,.004);
    label(isClassic?'ARIA   CALDO':isSkoda?'MENU  CLIMA   ▵   SET':isMini?'21°     AUTO     21°':'20.0°   AUTO  A/C   20.0°',.22,.026,0,climateY,faceZ+.159,isClassic?'#d5c4a5':'#dddcd1');
    if(!isSkoda&&!isClassic)for(const i of (isMini?[-1,0,1]:[-1,1])){
      const x=i*.084;part(new THREE.CylinderGeometry(.02,.021,.024,20).rotateX(Math.PI/2),alu,x,climateY,faceZ+.169);
      part(new THREE.CircleGeometry(.016,20),trim,x,climateY,faceZ+.182);label(i===0?'AUTO':'21',.02,.012,x,climateY,faceZ+.184,'#e5bdae');
    }
    if(isMini)for(let i=-2;i<=2;i++)box(.015,.031,.025,i===0?new THREE.MeshStandardMaterial({color:'#b72524',roughness:.25}):alu,i*.034,topY-.325,faceZ+.162,.005,-.23);
    if(isClassic){
      box(.24,.059,.034,alu,0,topY-.17,faceZ+.129);box(.17,.035,.035,trim,0,topY-.17,faceZ+.136);
      label('88  92  96  100  104',.14,.017,0,topY-.17,faceZ+.156,'#e4d7b5');
      for(const x of [-.102,.102])part(new THREE.CylinderGeometry(.015,.015,.014,16).rotateX(Math.PI/2),trim,x,topY-.17,faceZ+.151);
      // The 2000 GTV has three small auxiliary gauges in the wood fascia.
      for(const [i,name]of ['BENZINA','ACQUA','OLIO'].entries()){
        const x=(i-1)*.077;part(new THREE.CircleGeometry(.031,24),trim,x,topY-.065,faceZ+.094);
        part(new THREE.TorusGeometry(.031,.002,6,24),alu,x,topY-.065,faceZ+.096);
        label(name,.044,.01,x,topY-.073,faceZ+.10,'#e9debc');
        const n=box(.0018,.021,.002,alu,x,topY-.056,faceZ+.10,.0005);n.rotation.z=(i-1)*.4;
      }
    }
    const consoleY=topY-.37;
    box(isPorsche?.285:.245,.09,.61,trim,0,consoleY-.016,faceZ+.37,.025,isPorsche?.25:.12,'centre-console');
    box(.205,.018,.41,isClassic?wood:alu,0,consoleY+.046,faceZ+.34,.008,isPorsche?.25:.12);
    if(isPorsche)for(const sx of [-1,1])for(let i=0;i<5;i++)box(.033,.012,.031,gloss,sx*.093,consoleY+.07-i*.007,faceZ+.28+i*.042,.003);
    const manual=spec.transmission==='manual';
    const lever=this.lever=part(new THREE.CylinderGeometry(.009,.012,isSkoda&&!manual?.025:manual?.13:.10,10),alu,-.04,consoleY+.12,faceZ+.29,-.18,'gear-lever');
    const knob=this.knob=isSkoda&&!manual?box(.043,.027,.055,gloss,-.04,consoleY+.13,faceZ+.29,.009):manual?part(new THREE.SphereGeometry(.027,12,8),isClassic?wood:trim,-.04,consoleY+.186,faceZ+.276):box(.04,.076,.042,gloss,-.04,consoleY+.178,faceZ+.278,.012,-.20);
    this.selectorX=-.04;
    if(manual){const boot=part(new THREE.ConeGeometry(.055,.075,16),trim,-.04,consoleY+.09,faceZ+.30);boot.scale.z=.85;label(isClassic?'1 3 5\n2 4 R':isPorsche?'1 3 5 7\n2 4 6 R':'1 3 5\n2 4 6',.027,.022,-.04,consoleY+.205,faceZ+.286,'#ddd8d0',-.65);}
    else label('P R N D',.042,.075,.042,consoleY+.11,faceZ+.30,'#d5dfe7',-Math.PI/2);
    if(isBMW||isMini)part(new THREE.CylinderGeometry(.028,.031,.023,24),alu,.069,consoleY+.066,faceZ+.46);
    if(manual){const handbrake=box(.025,.022,.17,trim,.10,consoleY+.085,faceZ+.48,.009,-.20);handbrake.rotation.y=-.10;}
    for(const x of manual?[eye.x-.15,eye.x-.04,eye.x+.075]:[eye.x-.07,eye.x+.075]){
      const pedal=box(.06,.014,.105,alu,x,.31,faceZ-.02,.003,-.5);
      for(let j=-1;j<=1;j++)box(.052,.002,.005,trim,x,.321+j*.008,faceZ-.02+j*.023,.001,-.5);
    }
    if(spec.taxi){box(.19,.066,.05,trim,.35,topY+.015,faceZ);label('TAXI  € 4.00',.175,.045,.35,topY+.015,faceZ+.027,'#b7d3a3');}
    // Wheel dimensions and driver IK hooks stay unchanged. Distinct hub/trim shapes matter at this range.
    const wheel=this.wheel=new THREE.Group();wheel.name='steering-wheel';wheel.position.copy(wheelC);wheel.rotation.order='XYZ';this.wheelTilt=-.36;
    const spin=this.wheelSpin=new THREE.Group();wheel.add(spin);const r=.18;
    const rim=new THREE.Mesh(new THREE.TorusGeometry(r,isClassic?.011:.019,8,48),isClassic?wood:trimMat('#151617',{rough:.62,scale:.04,nk:.6}));spin.add(rim);
    const spokeMat=isClassic?alu:trim;
    for(const a of isSkoda?[0,Math.PI]:[0,Math.PI,-Math.PI/2]){const sp=new THREE.Mesh(new RoundedBoxGeometry(r*.83,isClassic?.025:.041,.016,1,.005),spokeMat);sp.position.set(Math.cos(a)*r*.51,Math.sin(a)*r*.51,-.012);sp.rotation.z=a;spin.add(sp);if(isClassic)for(let i=0;i<3;i++){const hole=new THREE.Mesh(new THREE.CircleGeometry(.004+i*.001,10),trim);hole.position.set(Math.cos(a)*(.07+i*.029),Math.sin(a)*(.07+i*.029),-.003);spin.add(hole);}}
    const hub=new THREE.Mesh(isMini||isClassic?new THREE.CylinderGeometry(isClassic?.038:.075,isClassic?.038:.073,isClassic?.025:.045,28).rotateX(Math.PI/2):new RoundedBoxGeometry(isBMW?.135:.145,isBMW?.10:.103,.047,1,.022),trim);hub.position.z=-.012;spin.add(hub);
    if(isMini){const ring=new THREE.Mesh(new THREE.TorusGeometry(.076,.002,5,32),alu);ring.position.z=.012;spin.add(ring);}
    const badge=new THREE.Mesh(new THREE.CircleGeometry(isClassic?.022:.023,32),model.materials?.badge||alu);badge.position.z=.016;spin.add(badge);
    const col=new THREE.Mesh(new THREE.CylinderGeometry(.032,.047,.26,12),trim);col.rotation.x=Math.PI/2;col.position.z=-.145;wheel.add(col);
    if(!isClassic)for(const sx of [-1,1]){const control=new THREE.Mesh(new RoundedBoxGeometry(.061,.039,.012,1,.004),gloss);control.position.set(sx*.104,0,.008);spin.add(control);for(let j=-1;j<=1;j++){const key=new THREE.Mesh(new THREE.BoxGeometry(.009,.002,.001),alu);key.position.set(sx*.104+j*.016,0,.015);spin.add(key);}}
    if(!manual)for(const sx of [-1,1]){const paddle=new THREE.Mesh(new RoundedBoxGeometry(.025,.066,.009,1,.003),alu);paddle.position.set(sx*.116,.025,-.04);wheel.add(paddle);}
    for(const sx of [-1,1]){const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.008,.011,.08,8),trim);stalk.rotation.z=Math.PI/2;stalk.position.set(sx*.096,0,-.10);wheel.add(stalk);}
    wheel.rotation.x=this.wheelTilt;g.add(wheel);
    // Three independent rearward views; each optical face has its own target.
    // Dimensions are metres. The centre unit hangs from the windscreen header.
    const fallback=mirrorTex&&!mirrorTex.isRenderTargetTexture?mirrorTex:mirrorFallback().clone();
    this.mirrors=[];this.mirrorUpdates=0;this.mirrorFallback=fallback;this.ownsMirrorFallback=!(mirrorTex&&!mirrorTex.isRenderTargetTexture);
    const addMirror=(mesh,name,width,height,hfov)=>{
      const geometry=mesh.geometry.clone(),uv=geometry.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;
      mesh.geometry=geometry;mesh.material=new THREE.MeshBasicMaterial({map:fallback,toneMapped:false,side:THREE.DoubleSide});
      const camera=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov/2))/(width/height))),width/height,.08,600);
      this.mirrors.push({name,mesh,camera,width,height,target:null,material:mesh.material,fallback});
    };
    const desiredMount=new THREE.Vector3(0,model.shape.H-.09,model.shape.header-.10);
    const root=nearestSurface(desiredMount,[model.windscreen],model.body).point;
    const mirror=new THREE.Mesh(new THREE.PlaneGeometry(.25,.07));mirror.name='interior-rearview-face';
    // A short forward/downward bracket follows the rake of the windscreen.
    // Keeping the glass behind the header made it dominate the driver's view.
    const mY=Math.min(model.shape.H-.135,root.y-.045);
    model.body.updateWorldMatrix(true,true);
    const origin=model.body.localToWorld(new THREE.Vector3(0,mY,model.shape.cowl+2));
    const direction=new THREE.Vector3(0,0,-1).transformDirection(model.body.matrixWorld);
    const windscreenHit=new THREE.Raycaster(origin,direction,0,4).intersectObject(model.windscreen,false)[0];
    const mZ=(windscreenHit?model.body.worldToLocal(windscreenHit.point).z:root.z-.14)+.045;
    mirror.position.set(0,mY,mZ);
    mirror.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),eye.clone().sub(mirror.position).normalize().add(new THREE.Vector3(0,0,1)).normalize());
    const mframe=new THREE.Mesh(new RoundedBoxGeometry(.266,.084,.026,1,.008),new THREE.MeshStandardMaterial({color:'#0e0e0f',roughness:.4}));
    mframe.position.copy(mirror.position).add(new THREE.Vector3(0,0,-.015).applyQuaternion(mirror.quaternion));mframe.quaternion.copy(mirror.quaternion);
    const tip=mframe.position.clone();
    const mount=this.mirrorMount=new THREE.Mesh(new THREE.SphereGeometry(.015,8,6),mframe.material);mount.name='rearview-mount';mount.position.copy(root);
    const stem=this.mirrorStem=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,root.distanceTo(tip),6),mframe.material);stem.name='rearview-stalk';
    stem.position.copy(root).add(tip).multiplyScalar(.5);stem.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tip.sub(root).normalize());
    g.add(mirror,mframe,stem,mount);addMirror(mirror,'interior',384,108,28);
    this.mirrorMat=mirror.material; // Inspector compatibility.
    for(const [key,name]of [['mirrorL','left'],['mirrorR','right']]){
      const mesh=model[key];if(mesh)addMirror(mesh,name,256,112,20);
    }
    // ---- door cards / A-pillars / headliner from the loft (closed cars)
    if (model.bodyMesh) {
      const shellMat = [trimMat('#3a3836', { rough: 0.95, scale: 0.05, nk: 0.35, side: THREE.BackSide, sheen: 0.25 }),
        new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false, envMap: CAR_ENV.tex, envMapIntensity: 0.6 }),
        trimMat('#1f1e1d', { rough: 0.8, scale: 0.16, nk: 0.5, side: THREE.BackSide })];
      const shell = new THREE.Mesh(model.bodyMesh.geometry, shellMat); shell.scale.setScalar(0.995); shell.position.y = 0.003;
      g.add(shell); this.shell = shell;
    }
    // door top rails + grab handles for all
    for (const sx of [-1, 1]) {
      const doorStart=g.children.length;
      const rail = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.05, 1.1, 1, 0.02), spec.body === 'mini' ? soft : trim);
      rail.position.set(sx * ((model.shape.profile ? model.shape.W/2-.18 : W / 2 + 0.03)-(isBMW?.10:isSkoda?.05:0)), (spec.body === 'mini' ? 0.97 : model.shape.belt + 0.02), eye.z - 0.15); g.add(rail);
      const doorX=sx*((model.shape.profile?model.shape.W/2-.18:W/2+.03)-(isBMW?.10:isSkoda?.05:0)),doorY=rail.position.y-.17;
      const doorTrim=isBMW?trimMat('#69422b',{rough:.78,scale:.07,nk:.4}):isSkoda?fascia:soft;
      box(.045,.29,.77,doorTrim,doorX,doorY,eye.z-.13,.015,0,'door-card');
      box(.081,.035,.33,trim,doorX-sx*.04,doorY-.035,eye.z-.10,.014);
      box(.017,.025,.115,alu,doorX-sx*.038,doorY+.074,eye.z-.30,.006);
      if(isClassic){for(let j=0;j<5;j++)box(.006,.003,.64,trim,doorX-sx*.025,doorY-.045-j*.023,eye.z-.13,.001);}
      else box(.031,.009,.067,gloss,doorX-sx*.064,doorY-.013,eye.z-.17,.003);
      for(const mesh of g.children.slice(doorStart)){mesh.userData.damageInterior=true;mesh.userData.damageSide=sx<0?'left':'right';}
    }
    // Preserve the wheel's animated frames and the selector/mirror mesh handles.
    // Door batches stay separate by side so damage can hide one door's lining.
    compactCockpit(spin);
    compactCockpit(wheel);
    compactCockpit(g,new Set([lever,knob,mirror,stem,mount,this.shell]));
    const cockpitLOD=this.lod=new THREE.LOD();cockpitLOD.name='cockpit-lod';
    const nearParent=g.parent;nearParent.add(cockpitLOD);cockpitLOD.addLevel(g,0);
    const distantDash=model.exteriorDash||new THREE.Group();
    cockpitLOD.addLevel(distantDash,15,.08);distantDash.visible=false;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.wheelEuler = new THREE.Euler(this.wheelTilt, 0, 0, 'XYZ');
    this.wheelInfo = { pos: wheelC, angle: 0, euler: this.wheelEuler, r };
    this.frame = 0;
  }
  /** steer: front wheel angle (rad) */
  update(dt, st) {
    const ang = -st.steerInput * 2.35;
    this.wheelSpin.rotation.z = ang; this.wheelInfo.angle = ang;
    // shift lights
    const k = clamp((st.rpm / st.redline - 0.7) / 0.27, 0, 1);
    const blink = st.rpm > st.redline * 0.97 && Math.sin(performance.now() * 0.05) > 0;
    this.shiftLeds.forEach((m, i) => { m.opacity = blink ? 1 : (i / 8 < k ? 1 : 0.1); });
    this.knob.position.x = this.lever.position.x = this.selectorX; // Automatic selector remains fixed while the gearbox changes.
    if ((this.frame++ & 1) === 0) this.drawCluster(st);
  }
  drawCluster(st){
    const g=this.clusterCanvas.getContext('2d'),W=1024,H=384,id=this.spec.id;g.clearRect(0,0,W,H);g.fillStyle='#090c0f';
    if(id==='mini'){
      g.beginPath();g.roundRect(0,0,W,H,180);g.fill();
      g.strokeStyle='#8a969c';g.lineWidth=5;g.beginPath();g.roundRect(4,4,W-8,H-8,175);g.stroke();
      // 2021 F57's oval TFT: RPM crescent at left, digital speed in the centre, fuel at right.
      g.lineWidth=9;for(let i=0;i<=7;i++){const a=Math.PI*.78+i/7*Math.PI*1.43,x=244+Math.cos(a)*155,y=194+Math.sin(a)*155;g.fillStyle=i>=6?'#e96058':'#e1ddc7';g.font='24px Arial';g.textAlign='center';g.fillText(i,x,y);}
      g.strokeStyle='#e0d9be';g.beginPath();g.arc(244,194,126,Math.PI*.78,Math.PI*2.21);g.stroke();
      const a=Math.PI*.78+clamp(st.rpm/8000,0,1)*Math.PI*1.43;g.strokeStyle='#f8f0d6';g.beginPath();g.moveTo(244+Math.cos(a)*96,194+Math.sin(a)*96);g.lineTo(244+Math.cos(a)*139,194+Math.sin(a)*139);g.stroke();
      g.fillStyle='#216274';g.beginPath();g.arc(529,202,105,0,7);g.fill();g.strokeStyle='#5bb1be';g.lineWidth=3;g.stroke();
      g.fillStyle='#f3f4ee';g.font='72px Arial';g.fillText(Math.round(st.kmh),529,218);g.font='21px Arial';g.fillText('km/h',529,254);g.fillText(st.gearLabel,375,203);
      g.strokeStyle='#d9d3b8';g.lineWidth=8;g.beginPath();g.arc(788,194,125,-Math.PI*.48,Math.PI*.48);g.stroke();
      g.fillStyle='#d5d5cc';g.font='22px Arial';g.fillText('+23.0°C',690,68);g.fillText('12:41',350,68);g.fillText('0',811,340);g.fillText('1',811,56);
    }else if(id==='gtv'){
      // Transparent space between the separate period instrument pods.
      instrumentDial(g,{x:273,y:195,r:173,max:8,value:st.rpm/1000,step:1,label:'GIRI / MIN ×1000',red:5.8,classic:true});
      instrumentDial(g,{x:749,y:195,r:173,max:240,value:st.kmh,step:20,label:'km / h',classic:true});
      g.fillStyle='#111';g.fillRect(700,248,97,23);g.fillStyle='#d8d0b5';g.font='18px monospace';g.textAlign='center';g.fillText('0 4 7 2 6',749,266);
    }else if(id==='carrera'){
      g.fillRect(0,0,W,H);
      // 991.1: five overlapping instruments, central tachometer and right-hand TFT.
      instrumentDial(g,{x:104,y:208,r:92,max:10,value:6,step:2,label:'°C'});
      instrumentDial(g,{x:298,y:203,r:127,max:330,value:st.kmh,step:30,label:'km/h'});
      instrumentDial(g,{x:522,y:194,r:158,max:9,value:st.rpm/1000,step:1,label:'1/min ×1000',red:7.8});
      instrumentDial(g,{x:741,y:203,r:125,max:10,value:0,step:2,label:''});
      g.fillStyle='#0e1720';g.beginPath();g.arc(741,203,111,0,7);g.fill();g.strokeStyle='#96a8ad';g.lineWidth=2;g.beginPath();g.moveTo(669,241);g.lineTo(719,210);g.lineTo(756,157);g.lineTo(825,148);g.stroke();
      g.fillStyle='#cbd5da';g.font='19px Arial';g.fillText('Navigation',741,123);g.font='14px Arial';g.fillText('Athens',741,268);
      instrumentDial(g,{x:927,y:208,r:88,max:4,value:2.7,step:1,label:'bar'});
      g.fillStyle='#eef0ee';g.font='italic 25px Georgia';g.fillText('Carrera',522,128);g.font='44px Arial';g.fillText(Math.round(st.kmh),522,257);g.font='18px Arial';g.fillText('km/h     '+st.gearLabel,522,284);
    }else if(id==='gr_yaris'){
      g.fillRect(0,0,W,H);instrumentDial(g,{x:518,y:194,r:158,max:8,value:st.rpm/1000,step:1,label:'×1000 r/min',red:7});
      g.fillStyle='#ebedf1';g.font='bold 58px Arial';g.textAlign='center';g.fillText(Math.round(st.kmh),180,169);g.font='22px Arial';g.fillText('km/h',180,204);g.font='bold 68px Arial';g.fillText(st.gearLabel,518,241);
      g.fillStyle='#ba2f39';g.fillRect(45,294,192,6);g.font='20px Arial';g.fillStyle='#d7dbe1';g.fillText('GR-FOUR',150,277);g.fillText('53 : 47',150,338);
      g.font='21px monospace';g.fillText('WATER   90°C',838,116);g.fillText('OIL     96°C',838,165);g.fillText('BOOST   0.0',838,214);g.fillStyle='#889398';g.font='17px Arial';g.fillText('GRAVEL',838,308);
    }else if(id==='taxi'||id==='police_octavia'||id==='superb'){
      g.fillRect(0,0,W,H);instrumentDial(g,{x:228,y:192,r:172,max:6,value:st.rpm/1000,step:1,label:'×1000 rpm',red:4.5});instrumentDial(g,{x:799,y:192,r:172,max:260,value:st.kmh,step:20,label:'km/h'});
      g.fillStyle='#e0edf0';g.font='49px Arial';g.textAlign='center';g.fillText(Math.round(st.kmh),512,186);g.font='20px Arial';g.fillText('km/h',512,221);g.fillText(st.gearLabel,512,269);g.font='19px Arial';g.fillStyle='#9bcac7';g.fillText('23.0°C',512,49);g.fillText(id==='superb'?'SUPERB':'OCTAVIA',512,337);
    }else{
      g.fillRect(0,0,W,H);const accent='#dd9a63';g.strokeStyle='#6f8291';g.lineWidth=5;
      for(const sx of [-1,1]){g.beginPath();g.moveTo(512+sx*178,336);g.lineTo(512+sx*373,277);g.lineTo(512+sx*417,87);g.lineTo(512+sx*280,35);g.stroke();}
      g.textAlign='center';g.font='65px Arial';g.fillStyle='#eef2f4';g.fillText(Math.round(st.kmh),242,217);g.font='20px Arial';g.fillText('km/h',242,252);g.fillStyle=accent;g.font='53px Arial';g.fillText(st.gearLabel,785,212);g.font='21px Arial';g.fillText((st.rpm/1000).toFixed(1)+' × 1000',785,252);
      g.strokeStyle=accent;g.lineWidth=9;g.beginPath();g.moveTo(690,335);g.lineTo(872,282);g.lineTo(890,282-clamp(st.rpm/st.redline,0,1)*180);g.stroke();
      g.strokeStyle='#8299a5';g.lineWidth=4;g.beginPath();g.moveTo(476,299);g.lineTo(514,211);g.lineTo(479,129);g.lineTo(544,86);g.stroke();g.fillStyle='#d0dce0';g.font='20px Arial';g.fillText(id==='z4'?'M40i':this.spec.short,512,39);g.fillText('+23.0°C',512,358);
    }
    this.clusterTex.needsUpdate=true;
  }
  // Fit the real door mirrors in the forward view without moving the driver's
  // seat or inventing oversized mirror glass. Preserve wider user FOV choices.
  mirrorFov(aspect){
    let tangent=0;this.model.root.updateMatrixWorld(true);
    // Account for the angled glass corners: a centre-only fit cuts off the
    // passenger edge of the 991 rear-view unit at narrow viewport aspects.
    for(const {mesh}of this.mirrors){
      mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y]){
        const p=this.model.body.worldToLocal(mesh.localToWorld(new THREE.Vector3(x,y,box.max.z)));
        tangent=Math.max(tangent,(Math.abs(p.x-this.eye.x)+.012)/Math.max(.15,this.eye.z-p.z));
      }
    }
    return THREE.MathUtils.radToDeg(2*Math.atan(tangent*1.035/aspect));
  }
  renderMirrors(renderer,scene,{enabled=true,frame=0}={}){
    if(!enabled){for(const m of this.mirrors)if(m.material.map!==m.fallback){m.material.map=m.fallback;m.material.needsUpdate=true;}return;}
    if(this.mirrorUpdates&&frame%2)return;
    const body=this.model.body,root=this.model.root,visible=root.visible,target=renderer.getRenderTarget(),shadow=renderer.shadowMap.autoUpdate;
    root.updateMatrixWorld(true);
    // Compute camera poses before hiding our cabin. Opponents and traffic remain
    // in the scene; each camera is at its own physical mirror, aimed rearward.
    for(const m of this.mirrors){
      if(!m.target){m.target=new THREE.WebGLRenderTarget(m.width,m.height,{depthBuffer:true});m.target.texture.name='mirror-'+m.name;m.target.texture.colorSpace=THREE.SRGBColorSpace;}
      m.mesh.geometry.computeBoundingBox();m.mesh.geometry.boundingBox.getCenter(m.camera.position);m.mesh.localToWorld(m.camera.position);body.getWorldQuaternion(m.camera.quaternion);
      m.camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));m.camera.updateMatrixWorld(true);
    }
    root.visible=false;renderer.shadowMap.autoUpdate=false;
    try{for(const m of this.mirrors){renderer.setRenderTarget(m.target);renderer.render(scene,m.camera);if(m.material.map!==m.target.texture){m.material.map=m.target.texture;m.material.needsUpdate=true;}}this.mirrorUpdates++;}
    finally{renderer.setRenderTarget(target);renderer.shadowMap.autoUpdate=shadow;root.visible=visible;}
  }
  disposeMirrors(){for(const m of this.mirrors)m.target?.dispose();if(this.ownsMirrorFallback)this.mirrorFallback.dispose();}
  setVisible(v) { this.lod.visible = v; }
}
