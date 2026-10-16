import {buildCockpitStructure} from './cockpit-structure.js';
import {drawPovInstruments} from './pov-instruments.js';
import {derivePovEye} from './pov-camera.js';
import {setVehicleCockpitView} from './glass-tint.js';
// First-person interior: dashboard, instrument cluster with live gauges (canvas texture), shift lights,
// steering wheel and controls, centre nav screen, working rear-view + door mirrors (render target),
// and an interior shell (headliner, pillars, door cards) generated from the body loft for closed cars.
import * as THREE from './vehicle-primitives.js';
import {FleetCockpit} from './fleet-cockpit.js';
import { RoundedBoxGeometry } from './vehicle-primitives.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './util.js';
import { TX, GLSL_HELPERS } from './tex.js';
import { CAR_ENV } from './cars.js';
import { nearestSurface } from './vehicle-mirrors.js';
import { COND_STATE } from './env.js';
import { RENDER } from './graphics.js';
import { CockpitLamps, drawCockpitLamps, lampArtVersion } from './cockpit-telltales.js';
import { shiftGateOffset, selectShiftKind, shiftAnimDuration, shiftEnvelope, smootherstep, cockpitShiftHardware } from './cockpit-controls.js';
// Night in the cabin: a faint instrument / street-light spill on the cockpit's own trim (emissive, no extra light)
// and door / rear-view glass that darkens with the scene. Both are display-referred, so they divide out the
// exposure the night brings up everything else by (env.js COND_STATE).
const CABIN_GLOW = { value: 0 };
// Rear view: ONE low-res render from a rearward camera at the interior mirror, cropped per mirror (the interior glass
// takes the centre, each door mirror looks back along its own flank into the next lane). One fixed resolution,
// refresh rate and draw distance; Settings > Mirrors switches it off. The mirror pass has no shadows map
// update and no post (the main view's exposure and grade apply to the glass like everything else).
const REAR_H = 84, REAR_V = 26, REAR_PITCH = -2.5; // shared view: horizontal / vertical field (deg), aim below level
// The mirror view is fixed with the one graphics look (graphics.js RENDER.mirror: every n-th frame, far plane m, width px).
/** Owner-locked (docs/OWNER-DECISIONS.md): mirrors render only from inside the car. The chase / third-person camera
 * shows no mirror and no rear-view strip, and skips the mirror pass entirely. */
export const mirrorsInView = (cam) => cam === 'cockpit';
const MIRROR_VIEWS = { interior: { yaw: 0, hfov: 36 }, left: { yaw: 17, hfov: 26 }, right: { yaw: -17, hfov: 26 } }; // yaw > 0 toward the car's left
// the crop of the shared view a glass shows: (u0, v0, du, dv), image u -> 1 is the car's left behind
function rearWindow(yaw, hfov, aspect, out = new THREE.Vector4()) {
  const r = THREE.MathUtils.degToRad, tH = Math.tan(r(REAR_H / 2)), tV = Math.tan(r(REAR_V / 2));
  const a = Math.tan(r(yaw - hfov / 2)), b = Math.tan(r(yaw + hfov / 2)), dv = Math.min(1, Math.tan(r(hfov / 2)) / aspect / tV);
  return out.set(0.5 + a / (2 * tH), 0.5 - dv / 2, (b - a) / (2 * tH), dv);
}
let DARK_GLASS;
const darkGlass = () => DARK_GLASS ||= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { needsUpdate: true });
const _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), REAR_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(REAR_PITCH));
const sceneLight = () => clamp(COND_STATE.ambient ?? 1, 0.03, 1) / Math.max(COND_STATE.exposure || 1, 0.05);
const MIRROR_FLIP=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
const HARD_STEER=1.0;

/**
 * Interior trim: grained soft-touch plastics, perforated / stitched leather and suede-like fabric, sampled
 * tri-planar in object space from the photographed leather scan (normal + roughness) so any shape takes it.
 */
export function trimMat(color, { rough = 0.7, scale = 0.12, nk = 0.7, metal = 0, stitch = 0, side = THREE.FrontSide, sheen = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side });
  m.customProgramCacheKey = () => `trim6_${scale}_${nk}_${stitch}_${sheen}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tLN: { value: TX.leather_nor }, tLR: { value: TX.leather_arm }, uCabinGlow: { get value() { return m.userData.cabinGlow ? CABIN_GLOW.value : 0; } } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tLN; uniform sampler2D tLR; uniform float uCabinGlow; varying vec3 vOP; varying vec3 vON; vec2 iUV; vec3 iN; float iR;
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
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, iUV, iN, ${nk.toFixed(2)});`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += (diffuseColor.rgb + 0.035) * vec3(0.85, 0.92, 1.0) * uCabinGlow;');
    // suede-like fabrics: a soft rim sheen
    if (sheen > 0) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float nv = abs(dot(normalize(normal), normalize(vViewPosition))); totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - nv, 3.0) * ${sheen.toFixed(2)}; }`);
  };
  return m;
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
    if(major){g.fillStyle=classic?'#ece3ca':'#d7e0e8';g.font=`${Math.round(r*(max>20?.14:.18))}px Arial`;const inset=Math.max(31,g.measureText(String(Math.round(v))).width/2+19);g.fillText(Math.round(v),x+Math.cos(a)*(r-inset),y+Math.sin(a)*(r-inset));}}
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
    if(spec.nativeFleet)return new FleetCockpit(spec,model);
    this.spec = spec; this.model = model;
    if (model.exteriorDash) model.exteriorDash.visible = false;
    const isMini=spec.body==='mini'||spec.body==='mini_jcw',isBMW=spec.body==='z4',isSkoda=spec.body==='octavia'||spec.police||spec.body==='superb',isClassic=spec.body==='gtv',isPorsche=spec.body==='carrera',isYaris=spec.body==='gr_yaris';
    const isMercedes=spec.marque==='mercedes',isMercCoupe=spec.body==='cle';
    const g=this.group=new THREE.Group();g.name='cockpit';(model.visualLOD?.levels[0].object||model.body).add(g);
    const eye=this.eye=model.seat.clone(),wheelC=this.wheelC=eye.clone().add(new THREE.Vector3(0,-.40,-.43));
    const trim=TRIM();
    const alu=new THREE.MeshStandardMaterial({color:'#9ba1a6',metalness:.86,roughness:.32,envMap:CAR_ENV.tex});
    const gloss=new THREE.MeshPhysicalMaterial({color:'#101113',roughness:.22,clearcoat:.7,envMap:CAR_ENV.tex});
    const leatherTop=trimMat(isBMW?'#171412':'#141416',{rough:.64,scale:.08,nk:.45});
    const wood=woodTrim();
    const part=(geo,mat,x,y,z,rx=0,name='')=>{const o=new THREE.Mesh(geo,mat);o.position.set(x,y,z);o.rotation.x=rx;o.name=name;g.add(o);return o;};
    const box=(w,h,d,mat,x,y,z,r=.008,rx=0,name='')=>part(Math.min(w,h,d)<.012?new THREE.BoxGeometry(w,h,d):new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/3,h/3,d/3)),mat,x,y,z,rx,name);
    const label=(text,w,h,x,y,z,colour='#d7dcdf',rx=0)=>part(new THREE.PlaneGeometry(w,h),labelMaterial(text,colour),x,y,z,rx);
    // Keep the instrument/controls anchors; the connected low-poly shell is
    // fitted after deriving the seated eye.
    const topY=eye.y-.44,faceZ=eye.z-.95;
    const cw=isClassic?.34:.38,ch=.09,cy=eye.y-.43,cz=faceZ+.08;
    const clusterX=eye.x;
    const ctex=this.clusterCanvas=document.createElement('canvas');ctex.width=1024;ctex.height=384;
    this.clusterTex=new THREE.CanvasTexture(ctex);this.clusterTex.colorSpace=THREE.SRGBColorSpace;
    box(cw+.012,ch+.012,.015,trim,clusterX,cy,cz-.01,0,0,'instrument-backing');
    part(new THREE.PlaneGeometry(cw,ch),new THREE.MeshBasicMaterial({map:this.clusterTex,toneMapped:false,transparent:true}),clusterX,cy,cz,0,'instrument-cluster');
    this.shiftLeds=[];
    const ncan=this.navCanvas=document.createElement('canvas');ncan.width=256;ncan.height=160;
    this.navTex=new THREE.CanvasTexture(ncan);this.navTex.colorSpace=THREE.SRGBColorSpace;
    part(new THREE.PlaneGeometry(.17,.06),new THREE.MeshBasicMaterial({map:this.navTex,toneMapped:false}),0,topY+.01,faceZ+.075,0,'navigation-band');
    const consoleY=topY-.37;
    box(isPorsche?.285:.245,.09,.61,trim,0,consoleY-.016,faceZ+.37,.025,isPorsche?.25:.12,'centre-console');
    box(.205,.018,.41,isClassic?wood:alu,0,consoleY+.046,faceZ+.34,.008,isPorsche?.25:.12);
    if(isPorsche)for(const sx of [-1,1])for(let i=0;i<5;i++)box(.033,.012,.031,gloss,sx*.093,consoleY+.07-i*.007,faceZ+.28+i*.042,.003);
    const shiftHw=this.shiftHardware=cockpitShiftHardware(spec);
    const dual=shiftHw.stick&&shiftHw.paddles;
    const manual=shiftHw.stick&&!shiftHw.paddles;
    const lever=this.lever=part(new THREE.CylinderGeometry(.009,.012,isSkoda&&!manual?.025:manual?.13:.10,10),alu,-.04,consoleY+.12,faceZ+.29,-.18,'gear-lever');
    const knob=this.knob=isSkoda&&!manual?box(.043,.027,.055,gloss,-.04,consoleY+.13,faceZ+.29,.009):manual?part(new THREE.SphereGeometry(.027,12,8),isClassic?wood:trim,-.04,consoleY+.186,faceZ+.276):box(.04,.076,.042,gloss,-.04,consoleY+.178,faceZ+.278,.012,-.20);
    if(isMercedes){lever.visible=false;knob.visible=false;box(.075,.014,.023,gloss,wheelC.x+.13,wheelC.y,wheelC.z-.07,.004);label('D  N  R',.055,.015,wheelC.x+.14,wheelC.y+.012,wheelC.z-.055);}
    this.selectorX=-.04;
    this.stickLever=null;this.stickKnob=null;this.stickParts=null;this.selectorParts=null;this._prndLabel=null;
    if(manual){const boot=part(new THREE.ConeGeometry(.055,.075,16),trim,-.04,consoleY+.09,faceZ+.30);boot.scale.z=.85;label(isClassic?'1 3 5\n2 4 R':isPorsche?'1 3 5 7\n2 4 6 R':'1 3 5\n2 4 6',.027,.022,-.04,consoleY+.205,faceZ+.286,'#ddd8d0',-.65);}
    else this._prndLabel=label('P R N D',.042,.075,.042,consoleY+.11,faceZ+.30,'#d5dfe7',-Math.PI/2);
    if(dual){
      const sLever=this.stickLever=part(new THREE.CylinderGeometry(.009,.012,.13,10),alu,-.04,consoleY+.12,faceZ+.29,-.18,'gear-lever-manual');
      const sKnob=this.stickKnob=part(new THREE.SphereGeometry(.027,12,8),isClassic?wood:trim,-.04,consoleY+.186,faceZ+.276,0,'gear-knob-manual');
      const sBoot=part(new THREE.ConeGeometry(.055,.075,16),trim,-.04,consoleY+.09,faceZ+.30);sBoot.scale.z=.85;
      const gate=label(isClassic?'1 3 5\n2 4 R':isPorsche?'1 3 5 7\n2 4 6 R':'1 3 5\n2 4 6',.027,.022,-.04,consoleY+.205,faceZ+.286,'#ddd8d0',-.65);
      this.stickParts=[sLever,sKnob,sBoot,gate];
      this.selectorParts=[lever,knob,this._prndLabel];
    }
    if(isBMW||isMini)part(new THREE.CylinderGeometry(.028,.031,.023,24),alu,.069,consoleY+.066,faceZ+.46);
    // A tactile lever is available even in cars with a factory electronic brake.
    const brakePivot=this.handbrakePivot=new THREE.Group();brakePivot.name='handbrake-pivot';
    brakePivot.position.set(.09,consoleY+.075,faceZ+.57);g.add(brakePivot);
    const brakeGrip=new THREE.Mesh(new RoundedBoxGeometry(.031,.029,.18,1,.009),trim);
    brakeGrip.name='handbrake-grip';brakeGrip.position.z=-.08;brakePivot.add(brakeGrip);
    this.controlTargets={handbrake:new THREE.Vector3(),shifter:new THREE.Vector3(),pull:0,manual:false,gear:1,shiftSerial:0,shiftBlend:0,paddleL:0,paddleR:0,paddleLT:new THREE.Vector3(),paddleRT:new THREE.Vector3()};
    this._brakeGrip=brakeGrip;
    for(const x of (manual||dual)?[eye.x-.15,eye.x-.04,eye.x+.075]:[eye.x-.07,eye.x+.075]){
      const pedal=box(.06,.014,.105,alu,x,.31,faceZ-.02,.003,-.5);
      for(let j=-1;j<=1;j++)box(.052,.002,.005,trim,x,.321+j*.008,faceZ-.02+j*.023,.001,-.5);
    }
    if(spec.taxi){box(.19,.066,.05,trim,.35,topY-.085,faceZ);label('TAXI  € 4.00',.175,.045,.35,topY-.085,faceZ+.027,'#b7d3a3');}
    // Preserve steering/paddle control anchors. The fitted POV rim is built below.
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
    this.paddleL=null;this.paddleR=null;
    if(shiftHw.paddles)for(const sx of [-1,1]){const paddle=new THREE.Mesh(new RoundedBoxGeometry(.025,.066,.009,1,.003),alu);paddle.name=sx<0?'paddle-left':'paddle-right';paddle.position.set(sx*.118,.058,-.04);wheel.add(paddle);if(sx<0)this.paddleL=paddle;else this.paddleR=paddle;}
    for(const sx of [-1,1]){const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.008,.011,.08,8),trim);stalk.rotation.z=Math.PI/2;stalk.position.set(sx*.096,0,-.10);wheel.add(stalk);}
    this._shift={serial:0,t:0,dur:.38,fromX:0,fromZ:0,toX:0,toZ:0,kind:'none',dir:0,queued:false,qT:0,tap:false,paddle:0};
    this._levX=0;this._levZ=0;this._gateTmp={x:0,z:0};
    this._leverBase=this.lever.position.clone();this._knobBase=this.knob.position.clone();
    this._leverTiltX=-.18;
    if(this.paddleL)this._paddleBaseLZ=this.paddleL.position.z;
    if(this.paddleR)this._paddleBaseRZ=this.paddleR.position.z;
    if(this.stickLever){this._stickLeverBase=this.stickLever.position.clone();this._stickKnobBase=this.stickKnob.position.clone();}
    wheel.rotation.x=this.wheelTilt;g.add(wheel);
    // Three independent rearward views; each optical face has its own target.
    // Dimensions are metres. The centre unit hangs from the windscreen header.
    const fallback=mirrorTex&&!mirrorTex.isRenderTargetTexture?mirrorTex:mirrorFallback().clone();
    this.mirrors=[];this.mirrorUpdates=0;this.mirrorFallback=fallback;this.ownsMirrorFallback=!(mirrorTex&&!mirrorTex.isRenderTargetTexture);
    this.rearCamera=new THREE.PerspectiveCamera(REAR_V,Math.tan(THREE.MathUtils.degToRad(REAR_H/2))/Math.tan(THREE.MathUtils.degToRad(REAR_V/2)),.3,600);this.rearTarget=null;
    const addMirror=(mesh,name)=>{
      const geometry=mesh.geometry.clone(),uv=geometry.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;
      geometry.computeBoundingBox();const [w,h]=geometry.boundingBox.getSize(new THREE.Vector3()).toArray().sort((a,b)=>b-a);
      const view=MIRROR_VIEWS[name],win=rearWindow(view.yaw,view.hfov,w/Math.max(h,1e-3));
      mesh.geometry=geometry;const material=mesh.material=new THREE.MeshBasicMaterial({map:fallback,toneMapped:false,side:THREE.DoubleSide});
      material.customProgramCacheKey=()=>'cockpit-mirror-window-v1';
      material.onBeforeCompile=sh=>{sh.uniforms.uMirWin={value:win};sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform vec4 uMirWin;').replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * uMirWin.zw + uMirWin.xy;\n#endif');};
      this.mirrors.push({name,mesh,window:win,material,fallback});
    };
    const desiredMount=new THREE.Vector3(0,model.shape.H-.09,model.shape.header-.10);
    const root=nearestSurface(desiredMount,[model.windscreen],model.body).point;
    const mirror=new THREE.Mesh(new THREE.PlaneGeometry(.29,.08));mirror.name='interior-rearview-face';
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
    const mframe=new THREE.Mesh(new RoundedBoxGeometry(.306,.094,.026,1,.008),new THREE.MeshStandardMaterial({color:'#0e0e0f',roughness:.4}));
    mframe.position.copy(mirror.position).add(new THREE.Vector3(0,0,-.015).applyQuaternion(mirror.quaternion));mframe.quaternion.copy(mirror.quaternion);
    // The stalk leaves the BACK of the housing and runs forward / up into the windscreen, so every point of it lies
    // behind the glass plane: it can never cross or show through the glass. (The raked screen puts the header
    // point on the driver's side of the glass, which made a stalk to it cut across the face.)
    const glassN=new THREE.Vector3(0,0,1).applyQuaternion(mirror.quaternion),glassUp=new THREE.Vector3(0,1,0).applyQuaternion(mirror.quaternion);
    const tip=mframe.position.clone().addScaledVector(glassN,-.013).addScaledVector(glassUp,.012);
    const stalkDir=glassN.clone().negate().addScaledVector(glassUp,.55).normalize();
    model.windscreen.updateWorldMatrix(true,false);
    const stalkHit=new THREE.Raycaster(model.body.localToWorld(tip.clone()),stalkDir.clone().transformDirection(model.body.matrixWorld),0,.45).intersectObject(model.windscreen,false)[0];
    if(stalkHit)root.copy(model.body.worldToLocal(stalkHit.point.clone()));
    else{
      // no screen within reach: bring the mirror toward the driver until the header mount is behind its back face
      const d=root.clone().sub(tip).dot(glassN);
      if(d>-.01){const shift=glassN.clone().multiplyScalar(d+.01);mirror.position.add(shift);mframe.position.add(shift);tip.add(shift);}
    }
    const mount=this.mirrorMount=new THREE.Mesh(new THREE.SphereGeometry(.015,8,6),mframe.material);mount.name='rearview-mount';mount.position.copy(root);
    const stem=this.mirrorStem=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,root.distanceTo(tip),6),mframe.material);stem.name='rearview-stalk';
    stem.position.copy(root).add(tip).multiplyScalar(.5);stem.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tip.sub(root).normalize());
    g.add(mirror,mframe,stem,mount);addMirror(mirror,'interior');
    this.mirrorMat=mirror.material; // Inspector compatibility.
    for(const [key,name]of [['mirrorL','left'],['mirrorR','right']]){
      const mesh=model[key];if(mesh)addMirror(mesh,name);
    }
    // ---- door cards / A-pillars / headliner from the loft (closed cars)
    compactCockpit(spin);
    compactCockpit(wheel,new Set([this.paddleL,this.paddleR].filter(Boolean)));
    compactCockpit(g,new Set([lever,knob,mirror,stem,mount,this.shell,...(this.stickParts||[])]));
    // only the cabin's own trim takes the night instrument glow (trimMat also dresses drivers and pedestrians)
    g.traverse(o=>{for(const m of [].concat(o.material||[]))if(/^trim6_/.test(m.customProgramCacheKey?.()||''))m.userData.cabinGlow=true;});
    const cockpitLOD=this.lod=new THREE.LOD();cockpitLOD.name='cockpit-lod';
    const nearParent=g.parent;nearParent.add(cockpitLOD);cockpitLOD.addLevel(g,0);
    const distantDash=model.exteriorDash||new THREE.Group();
    cockpitLOD.addLevel(distantDash,15,.08);distantDash.visible=false;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.wheelEuler = new THREE.Euler(this.wheelTilt, 0, 0, 'XYZ');
    this.wheelInfo = { pos: wheelC, angle: 0, euler: this.wheelEuler, r, controls: this.controlTargets };
    this.lamps = new CockpitLamps();
    this.clusterAge = 0;this.lod.visible=false;
    derivePovEye(model,this);buildCockpitStructure(model,this);
  }
  /** steer: front wheel angle (rad) */
  update(dt, st) {
    CABIN_GLOW.value = 0.3 * clamp(1 - (COND_STATE.ambient ?? 1) * 1.6, 0, 1) / Math.max(COND_STATE.exposure || 1, 0.05);
    this.updateStructure(st);
    const ang = -st.steerInput * 2.35;
    this.wheelSpin.rotation.z = ang; this.wheelInfo.angle = ang;
    const controls=this.controlTargets;
    // Reach first, then raise the lever; keep the palm target on its moving grip.
    controls.pull += ((st.handbrake?1:0)-controls.pull)*(1-Math.exp(-12*Math.max(0,dt)));
    this.handbrakePivot.rotation.x=-.12+Math.max(0,(controls.pull-.55)/.45)*.52;
    this.handbrakePivot.updateMatrix();
    controls.handbrake.copy(this._brakeGrip.position).applyMatrix4(this.handbrakePivot.matrix);
    controls.handbrake.y+=.018;
    controls.manual=!!st.manual;controls.gear=st.gear;controls.held=!!st.handbrake;
    this.updateShiftControls(dt,st,controls);
    const activeKnob=(this.stickKnob&&controls.manual)?this.stickKnob:this.knob;
    controls.shifter.copy(activeKnob.position);controls.shifter.y+=.012;
    if(this.stickParts){
      const showStick=!!controls.manual;
      for(const m of this.stickParts)m.visible=showStick;
      for(const m of this.selectorParts)m.visible=!showStick;
    }
    // shift lights
    const k = clamp((st.rpm / st.redline - 0.7) / 0.27, 0, 1);
    const blink = st.rpm > st.redline * 0.97 && Math.sin(performance.now() * 0.05) > 0;
    this.shiftLeds.forEach((m, i) => { m.opacity = blink ? 1 : (i / 8 < k ? 1 : 0.1); });
    if(!this.shiftHardware.stick||(this.stickKnob&&!controls.manual))this.knob.position.x=this.lever.position.x=this.selectorX; // Automatic selector remains fixed while the gearbox changes.
    this.lampState = this.lamps.update(dt, st);
    this.clusterAge += Math.max(0, dt);
    // Quantise to displayed precision. Stationary instruments upload nothing once the lamps settle.
    const display = { ...st, kmh: Math.round(st.kmh), rpm: Math.round(st.rpm / 50) * 50 };
    const key = [display.kmh, display.rpm, st.redline, st.gearLabel, lampArtVersion, ...this.lampState.map(l => l[1])].join('|');
    if (this.detailed !== false && key !== this.clusterKey && (this.clusterAge >= .1 || this.clusterKey === undefined)) {
      this.clusterAge = 0; this.clusterKey = key; this.drawCluster(display);
    }
  }
  gearCount(st){return st.gearCount||this.spec?.gears?.length||6;}
  /** Serialised shift choreography: the lever strokes its H-gate, a paddle pulls, the hand follows. */
  updateShiftControls(dt,st,controls){
    const S=this._shift,h=Math.max(0,dt);
    // Sol-era shift-start/end events win when the vehicle provides them; otherwise the gear-change serial.
    const ev=st.shiftStartEvent||st.shiftStart||st.gearChangeEvent||st.gearChange||null;
    if(ev&&ev.serial!==undefined&&ev.serial!==S.serial){
      const wasActive=S.kind!=='none'&&S.t<S.dur;
      S.serial=ev.serial;
      let dir=ev.direction||0;
      if(!dir){const from=ev.from??controls.gear,to=ev.to??st.gear;dir=(to==='R'||from==='R')?(to==='R'?-1:1):Math.sign(to-from)||0;}
      const manualEv=ev.manual!==undefined?!!ev.manual:!!st.manual;
      const kind=selectShiftKind({manual:manualEv,stick:this.shiftHardware.stick,paddles:this.shiftHardware.paddles,autoOverride:st.autoOverride||0,shiftType:ev.shiftType||ev.type||st.shiftType||st.gearboxType,direction:dir||1});
      S.kind=kind;S.dir=kind==='paddle'&&!dir?1:dir;
      S.dur=shiftAnimDuration(kind,ev.duration!==undefined?ev.duration:st.shiftDuration);
      if(S.dur<=0)S.kind='none';
      // Retarget from the lever's current offset so rapid consecutive shifts never snap.
      S.fromX=this._levX;S.fromZ=this._levZ;
      shiftGateOffset(ev.to!==undefined?ev.to:st.gear,this.gearCount(st),this._gateTmp);
      S.toX=this._gateTmp.x;S.toZ=this._gateTmp.z;
      // A fresh stroke restarts; a chained one keeps the hand at the lever.
      S.t=(S.kind!=='none'&&wasActive)?Math.min(S.t,S.dur*.3):0;
      S.qT=0;S.tap=false;S.paddle=0;
      if(S.kind!=='none'&&controls.held)S.kind='none';
      else if(S.kind==='lever'&&Math.abs(this.wheelInfo.angle)>HARD_STEER)S.queued=true;
      else if(S.kind==='paddle')S.paddle=S.dir;
    }
    const endEv=st.shiftEndEvent||st.shiftEnd||null;
    if(endEv&&endEv.serial!==undefined&&endEv.serial===S.serial&&S.kind!=='none')S.t=Math.max(S.t,S.dur*.72);
    // Queue while the wheel is hard over; after ~0.6 s fall back to a short tap so the hand never leaves long.
    if(S.queued){
      S.qT+=h;
      const hard=Math.abs(this.wheelInfo.angle)>HARD_STEER;
      if(!hard||S.qT>.6){S.queued=false;if(hard){S.tap=true;S.dur=Math.min(S.dur,.2);}}
    }else if(S.kind!=='none'&&S.t<S.dur)S.t=Math.min(S.dur,S.t+h);
    const prog=S.kind==='none'?1:Math.min(1,S.t/Math.max(1e-3,S.dur));
    let ox,oz;
    if(S.kind==='lever'){
      // Old gate -> neutral -> new gate, eased per leg: never a diagonal robot slide.
      if(prog<1){
        if(prog<.5){const k=smootherstep(prog*2);ox=S.fromX*(1-k);oz=S.fromZ*(1-k);}
        else{const k=smootherstep((prog-.5)*2);ox=S.toX*k;oz=S.toZ*k;}
      }else{ox=S.toX;oz=S.toZ;}
    }else if(controls.manual){
      // At rest the stick sits in its current gate; settle there instead of snapping.
      shiftGateOffset(controls.gear,this.gearCount(st),this._gateTmp);
      const k=1-Math.exp(-10*h);
      ox=this._levX+(this._gateTmp.x-this._levX)*k;oz=this._levZ+(this._gateTmp.z-this._levZ)*k;
    }else{ox=this._levX;oz=this._levZ;}
    this._levX=ox;this._levZ=oz;
    // Pose the visible stick; the automatic selector never moves with the gearbox.
    let lv=null,kb=null,lb=null,nb=null;
    if(this.stickKnob&&controls.manual){lv=this.stickLever;kb=this.stickKnob;lb=this._stickLeverBase;nb=this._stickKnobBase;}
    else if(this.shiftHardware.stick&&!this.stickKnob){lv=this.lever;kb=this.knob;lb=this._leverBase;nb=this._knobBase;}
    if(lv&&(controls.manual||S.kind==='lever')){
      lv.position.set(lb.x+ox*.45,lb.y,lb.z+oz*.45);
      lv.rotation.x=this._leverTiltX+oz*3.2;lv.rotation.z=-ox*3.2;
      kb.position.set(nb.x+ox,nb.y,nb.z+oz);
    }
    // The paddle itself moves during the shift; there are no visible hands.
    const penv=S.kind==='paddle'?Math.sin(Math.min(1,prog)*Math.PI):0;
    controls.paddleL=S.paddle<0?penv:0;controls.paddleR=S.paddle>0?penv:0;
    if(this.paddleL)this.paddleL.position.z=this._paddleBaseLZ+(S.paddle<0?penv*.012:0);
    if(this.paddleR)this.paddleR.position.z=this._paddleBaseRZ+(S.paddle>0?penv*.012:0);
    this.wheel.updateMatrix();
    if(this.paddleL)controls.paddleLT.copy(this.paddleL.position).applyMatrix4(this.wheel.matrix);
    if(this.paddleR)controls.paddleRT.copy(this.paddleR.position).applyMatrix4(this.wheel.matrix);
    controls.shiftBlend=S.kind==='lever'?(S.tap?shiftEnvelope(prog)*.45:shiftEnvelope(prog)):0;
    controls.shiftSerial=S.serial;
  }
  drawCluster(st){
    if(this.model.cockpitView){drawPovInstruments(this.clusterCanvas,st,this.lampState,this.spec);this.clusterTex.needsUpdate=true;return;}
    const g=this.clusterCanvas.getContext('2d'),W=1024,H=384,id=this.spec.body==='octavia'?'taxi':this.spec.body;g.clearRect(0,0,W,H);g.fillStyle='#090c0f';
    if(id==='mini'||id==='mini_jcw'){
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
    }else if(id==='yaris'){
      g.fillRect(0,0,W,H);g.fillStyle='#91b7a6';g.font='110px monospace';g.textAlign='center';g.fillText(Math.round(st.kmh),510,215);g.font='28px monospace';g.fillText('km/h     '+st.gearLabel,510,264);g.font='20px monospace';g.fillText('ODO  184205       FUEL ▮▮▮▮',510,335);
    }else if(['huracan','aventador'].includes(id)){
      g.fillRect(0,0,W,H);instrumentDial(g,{x:510,y:192,r:165,max:10,value:st.rpm/1000,step:1,label:'',red:8.5});
      g.fillStyle='#eeeeea';g.font='bold 70px monospace';g.textAlign='center';g.fillText(st.gearLabel,510,232);g.font='17px Arial';g.fillText('RPM ×1000',510,285);g.font='58px Arial';g.fillText(Math.round(st.kmh),160,200);g.font='22px Arial';g.fillText('km/h',160,236);g.fillStyle='#e7892b';g.font='20px Arial';g.fillText('STRADA',840,120);g.fillText(id==='aventador'?'AVENTADOR SVJ':'HURACÁN EVO',840,310);
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
      instrumentDial(g,{x:522,y:194,r:158,max:9,value:st.rpm/1000,step:1,label:'',red:7.8});
      instrumentDial(g,{x:741,y:203,r:125,max:10,value:0,step:2,label:''});
      g.fillStyle='#0e1720';g.beginPath();g.arc(741,203,111,0,7);g.fill();g.strokeStyle='#96a8ad';g.lineWidth=2;g.beginPath();g.moveTo(669,241);g.lineTo(719,210);g.lineTo(756,157);g.lineTo(825,148);g.stroke();
      g.fillStyle='#cbd5da';g.font='19px Arial';g.fillText('Navigation',741,102);g.font='14px Arial';g.fillText('Athens',741,268);
      instrumentDial(g,{x:927,y:208,r:88,max:4,value:2.7,step:1,label:'bar'});
      g.fillStyle='#eef0ee';g.font='italic 25px Georgia';g.fillText('Carrera',522,128);g.font='15px Arial';g.fillText('1/min ×1000',522,154);g.font='44px Arial';g.fillText(Math.round(st.kmh),522,257);g.font='18px Arial';g.fillText('km/h     '+st.gearLabel,522,284);
    }else if(id==='gr_yaris'){
      g.fillRect(0,0,W,H);instrumentDial(g,{x:518,y:194,r:158,max:8,value:st.rpm/1000,step:1,label:'',red:7});
      g.fillStyle='#ebedf1';g.font='bold 58px Arial';g.textAlign='center';g.fillText(Math.round(st.kmh),180,169);g.font='22px Arial';g.fillText('km/h',180,204);g.font='bold 68px Arial';g.fillText(st.gearLabel,518,241);g.font='17px Arial';g.fillText('×1000 r/min',518,285);
      g.fillStyle='#ba2f39';g.fillRect(45,82,192,6);g.font='20px Arial';g.fillStyle='#d7dbe1';g.fillText('GR-FOUR',150,65);g.fillText('53 : 47',150,338);
      g.font='21px monospace';g.fillText('WATER   90°C',838,95);g.fillText('OIL     96°C',838,140);g.fillText('BOOST   0.0',838,185);g.fillStyle='#889398';g.font='17px Arial';g.fillText('GRAVEL',838,340);
    }else if(['taxi','police_octavia','superb','panda','jazz','ibiza','golf','e36','corolla','cla','cle','gla','gla45'].includes(id)){
      const diesel=['taxi','superb','police_octavia'].includes(id),rpmMax=diesel?6:8;g.fillRect(0,0,W,H);instrumentDial(g,{x:228,y:192,r:172,max:rpmMax,value:st.rpm/1000,step:1,label:'×1000 rpm',red:st.redline/1000});instrumentDial(g,{x:799,y:192,r:172,max:260,value:st.kmh,step:20,label:'km/h'});
      g.fillStyle='#e0edf0';g.font='49px Arial';g.textAlign='center';g.fillText(Math.round(st.kmh),512,186);g.font='20px Arial';g.fillText('km/h',512,221);g.fillText(st.gearLabel,512,269);g.font='19px Arial';g.fillStyle='#9bcac7';g.fillText('23.0°C',512,49);g.font='16px Arial';g.fillText(this.spec.short,512,337,190);
    }else{
      g.fillRect(0,0,W,H);const accent='#dd9a63';g.strokeStyle='#6f8291';g.lineWidth=5;
      for(const sx of [-1,1]){g.beginPath();g.moveTo(512+sx*178,336);g.lineTo(512+sx*373,277);g.lineTo(512+sx*417,87);g.lineTo(512+sx*280,35);g.stroke();}
      g.textAlign='center';g.font='65px Arial';g.fillStyle='#eef2f4';g.fillText(Math.round(st.kmh),242,217);g.font='20px Arial';g.fillText('km/h',242,252);g.fillStyle=accent;g.font='53px Arial';g.fillText(st.gearLabel,785,212);g.font='21px Arial';g.fillText((st.rpm/1000).toFixed(1)+' × 1000',785,252);
      g.strokeStyle=accent;g.lineWidth=9;g.beginPath();g.moveTo(690,335);g.lineTo(872,282);g.lineTo(890,282-clamp(st.rpm/st.redline,0,1)*180);g.stroke();
      g.strokeStyle='#8299a5';g.lineWidth=4;g.beginPath();g.moveTo(476,299);g.lineTo(514,211);g.lineTo(479,129);g.lineTo(544,86);g.stroke();g.fillStyle='#d0dce0';g.font='20px Arial';g.fillText(id==='z4'?'M40i':this.spec.short,512,39);g.fillText('+23.0°C',512,358);
    }
    drawCockpitLamps(g, this.lampState || this.lamps.update(0, st), id);
    this.clusterTex.needsUpdate=true;
  }
  // Keep a natural forward view. Door mirrors outside it are reached with
  // mouse look; fitting the passenger mirror must not widen the whole cabin.
  mirrorFov(aspect){
    let tangent=0;this.model.root.updateMatrixWorld(true);
    // Account for the angled glass corners: a centre-only fit cuts off the
    // passenger edge of the 991 rear-view unit at narrow viewport aspects.
    for(const {mesh,name}of this.mirrors){
      if(name!=='interior')continue;
      mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y]){
        const p=this.model.body.worldToLocal(mesh.localToWorld(new THREE.Vector3(x,y,box.max.z)));
        tangent=Math.max(tangent,(Math.abs(p.x-this.eye.x)+.012)/Math.max(.15,this.eye.z-p.z));
      }
    }
    return Math.min(71,THREE.MathUtils.radToDeg(2*Math.atan(tangent*1.035/aspect)));
  }
  renderMirrors(renderer,scene,{enabled=true,now=performance.now(),far}={}){
    if(!enabled){
      this.rearLast=undefined;
      // Mirrors off: dark glass that follows the scene's light (unlit, so never a daylight grey under night exposure)
      // (a map stays bound either way: switching mirrors on / off never recompiles the glass)
      const k=sceneLight(),glass=darkGlass();for(const m of this.mirrors){m.material.map=glass;m.material.color.set('#485158').multiplyScalar(k);}
      return;
    }
    const T=RENDER.mirror;
    this.mirrorCalls=(this.mirrorCalls||0)+1;
    if(this.rearLast!==undefined&&now>=this.rearLast&&now-this.rearLast<150&&this.mirrorCalls<T.every)return;
    const height=Math.round(T.width*Math.tan(THREE.MathUtils.degToRad(REAR_V/2))/Math.tan(THREE.MathUtils.degToRad(REAR_H/2)));
    if(this.rearTarget&&this.rearTarget.width!==T.width){this.rearTarget.dispose();this.rearTarget=null;}
    if(!this.rearTarget){this.rearTarget=new THREE.WebGLRenderTarget(T.width,height,{depthBuffer:true});this.rearTarget.texture.name='mirror-rear-view';this.rearTarget.texture.colorSpace=THREE.SRGBColorSpace;}
    const cam=this.rearCamera,f=far??T.far;if(cam.far!==f){cam.far=f;cam.updateProjectionMatrix();}
    const body=this.model.body,root=this.model.root,visible=root.visible,target=renderer.getRenderTarget(),shadow=renderer.shadowMap.autoUpdate;
    root.updateMatrixWorld(true);
    // at the interior glass (our own car is hidden for the pass), aimed straight back and a little down
    const interior=this.mirrors.find(m=>m.name==='interior')?.mesh;
    if(interior){interior.geometry.computeBoundingBox();interior.geometry.boundingBox.getCenter(_rp);interior.localToWorld(cam.position.copy(_rp));}
    else body.localToWorld(cam.position.set(0,this.model.shape?.H??1.2,0));
    cam.quaternion.copy(body.getWorldQuaternion(_rq)).multiply(MIRROR_FLIP).multiply(REAR_TILT);cam.updateMatrixWorld(true);
    this.model.exhaustFlames?.beginMirror(body);
    root.visible=false;renderer.shadowMap.autoUpdate=false;
    try{
      renderer.setRenderTarget(this.rearTarget);renderer.render(scene,cam);
      for(const m of this.mirrors){m.material.map=this.rearTarget.texture;m.material.color.set(0xffffff);}
      this.mirrorUpdates++;this.mirrorCalls=0;this.rearLast=now;
    }finally{this.model.exhaustFlames?.endMirror();renderer.setRenderTarget(target);renderer.shadowMap.autoUpdate=shadow;root.visible=visible;}
  }
  disposeMirrors(){this.rearTarget?.dispose();this.rearTarget=null;if(this.ownsMirrorFallback)this.mirrorFallback.dispose();}
  setVisible(v) { this.wheel.visible=false;this.lod.visible = v; setVehicleCockpitView(this.model,v); }
  /** Full cabin (gauges, trim, controls) or the exterior dashboard the LOD uses beyond 15 m.
   * Outside cockpit views the cabin is behind tinted glass ~5 m away: ~35 draws and a cluster upload per frame. */
  setDetail(full) { if(this.detailed===full)return;this.detailed=full;this.lod.levels[1].distance=full?15:0; }
}
