// Reference-proportioned, editable vehicle meshes. Metres; nose -Z; wheels turn about X.
import * as THREE from 'three';
import { MERCEDES_MODELS, buildMercedes } from './player-mercedes.js';
import { ROAD_MODELS, buildRoadCar } from './player-road-cars.js';
import { PASSENGER_MODELS, buildPassengerModel } from './traffic-passenger-models.js';
import { buildPoliceModel } from './police-models.js';
import { seatMirrors } from './vehicle-mirrors.js';
import { installDamageSystem } from './damage.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, canvasTex } from './util.js';
import { formatPlate } from './plate.js';
import { buildOriginalPlayerSkin, refineOriginalPlayer } from './player-original-surfaces.js';
import { refineSportsPlayer } from './player-sports-surfaces.js';
import { tintGlass } from './glass-tint.js';
import { isPlayerVehicle, refinePlayerDetails, groupPlayerParts, installPlayerLOD } from './player-vehicle-details.js';

export const MODEL = {
  ...MERCEDES_MODELS,
  ...ROAD_MODELS,
  carrera: { profile:'carrera',axleOffset:-.18, L:4.491,W:1.808,H:1.303,wb:2.45,track:1.525,r:.331,belt:.88,front:.62,rear:.79,cowl:-.68,header:-.04,back:1.57,roofBack:.54,seatZ:.36,eyeY:1.00,leather:'#6b4934',rim:.241,doors:2,tyreF:.235,tyreR:.285,rearLow:true },
  gr_yaris: { profile:'yaris',axleOffset:0, L:3.995,W:1.805,H:1.455,wb:2.56,track:1.554,r:.319,belt:.98,front:.78,rear:1.04,cowl:-.84,header:-.31,back:1.84,roofBack:1.47,seatZ:.20,eyeY:1.155,leather:'#26272a',rim:.229,doors:2,tyreF:.225,tyreR:.225,blackRoof:true },
  gtv: { profile:'gtv',axleOffset:-.015, L:4.10,W:1.58,H:1.328,wb:2.35,track:1.30,r:.313,belt:.88,front:.77,rear:.87,cowl:-.77,header:-.27,back:1.30,roofBack:.69,seatZ:.19,eyeY:1.015,leather:'#a2764e',rim:.178,doors:2,tyreF:.165,tyreR:.165,classic:true,rearLow:true },
  mini: { L:3.85,W:1.727,H:1.415,wb:2.495,track:1.485,r:0.316,belt:0.96,front:0.85,rear:0.89,cowl:-0.62,header:-0.23,back:1.12,roofBack:0.68,open:true,seatZ:0.29,eyeY:1.16,leather:'#965d37',rim:0.223 },
  z4: { L:4.324,W:1.864,H:1.304,wb:2.47,track:1.60,r:0.335,belt:0.87,front:0.65,rear:0.91,cowl:-0.46,header:0.13,back:0.98,roofBack:0.65,open:true,seatZ:0.47,eyeY:1.04,leather:'#ac6335',rim:0.241 },
  octavia: { L:4.689,W:1.829,H:1.47,wb:2.686,track:1.54,r:0.323,belt:0.98,front:0.77,rear:0.97,cowl:-0.91,header:-0.35,back:1.75,roofBack:0.91,seatZ:0.20,eyeY:1.16,leather:'#363a3b',rim:0.216 },
  superb: { L:4.869,W:1.864,H:1.469,wb:2.841,track:1.584,r:0.332,belt:0.99,front:0.76,rear:0.96,cowl:-0.93,header:-0.37,back:1.80,roofBack:0.96,seatZ:0.20,eyeY:1.16,leather:'#343432',rim:0.229 },
  dolphin: { L:4.29,W:1.77,H:1.57,wb:2.70,track:1.53,r:0.326,belt:1.04,front:0.79,rear:1.05,cowl:-1.03,header:-0.57,back:1.91,roofBack:1.27,seatZ:0.02,eyeY:1.32,leather:'#444954',rim:0.216,ev:true },
  atto3: { L:4.455,W:1.875,H:1.615,wb:2.72,track:1.575,r:0.346,belt:1.10,front:0.85,rear:1.08,cowl:-0.91,header:-0.42,back:1.95,roofBack:1.21,seatZ:0.07,eyeY:1.36,leather:'#454955',rim:0.229,ev:true },
};
for(const [id,fleet]of Object.entries({golf:'hatch',corolla:'sedan',superb:'taxi_superb',police_octavia:'taxi'})){
  const d=PASSENGER_MODELS[fleet];MODEL[id]={...d,axleOffset:d.ax,front:d.sections[0][2],rear:d.sections.at(-1)[2],seatZ:.20,eyeY:id==='superb'?1.14:id==='golf'?1.15:d.H-.292,leather:'#363a3b',rim:.216,doors:4,tyreF:.205,tyreR:.205};
}
const V = (x,y,z) => new THREE.Vector3(x,y,z);
const mat = (color,roughness=0.45,metalness=0) => new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});
function mesh(parent,geo,m,pos=[0,0,0],rot=[0,0,0],name='') { const o=new THREE.Mesh(geo,m);o.position.set(...pos);o.rotation.set(...rot);o.name=name;parent.add(o);return o; }
function playerDetailParent(p){for(let o=p;o;o=o.parent)if(o.userData.playerDetail)return true;return false;}
function box(p,m,size,pos,rad=0.02,rot=[0,0,0],name='') {return mesh(p,new RoundedBoxGeometry(...size,playerDetailParent(p)?1:2,Math.min(rad,...size.map(v=>v/2))),m,pos,rot,name);}
function line(p,m,points,r=0.004) {const curve=new THREE.CurvePath();for(let i=1;i<points.length;i++)curve.add(new THREE.LineCurve3(V(...points[i-1]),V(...points[i])));return mesh(p,new THREE.TubeGeometry(curve,playerDetailParent(p)?Math.min(40,Math.max(8,points.length*2)):Math.max(8,points.length*2),r,5,false),m);}
function surface(p,m,fn,nu=32,nv=12,name='') {
  if(playerDetailParent(p)&&!m.transparent){nu=Math.min(nu,96);nv=Math.min(nv,12);}
  const a=[],idx=[],uv=[];for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){a.push(...fn(i/nu,j/nv));uv.push(i/nu,j/nv);}
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const k=i*(nv+1)+j;idx.push(k,k+nv+1,k+1,k+1,k+nv+1,k+nv+2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return mesh(p,g,m,[0,0,0],[0,0,0],name);
}
function patch(p,m,pts,name='') { return surface(p,m,(u,v)=>{const a=V(...pts[0]).lerp(V(...pts[1]),u),b=V(...pts[3]).lerp(V(...pts[2]),u);return a.lerp(b,v).toArray();},10,5,name); }
function disk(p,m,r,pos,rot=[0,0,0]) { return mesh(p,new THREE.CircleGeometry(r,32),m,pos,rot); }
function ring(p,m,r,t,pos,rot=[0,0,0],arc=Math.PI*2) {return mesh(p,new THREE.TorusGeometry(r,t,8,48,arc),m,pos,rot);}
function textMaterial(text,bg='#15181c',fg='#d8dde0',w=512,h=96) {const map=canvasTex(w,h,(c,W,H)=>{if(bg){c.fillStyle=bg;c.fillRect(0,0,W,H);}c.fillStyle=fg;c.font=`600 ${H*.6}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(text,W/2,H/2);});return new THREE.MeshStandardMaterial({map,roughness:0.4,transparent:!bg,depthWrite:!!bg});}
let registration=1000;
export function nextRegistration(taxi=false) {const n=registration++;const letters='ABEZHIKMNOPTYX';return `${taxi?'TAA':'IK'+letters[Math.floor(n/9000)%letters.length]} ${1000+n%9000}`;}
export function makePlateMaterial(number=nextRegistration()) {
  number=formatPlate(number)||nextRegistration();
  const map=canvasTex(512,112,(g,w,h)=>{
    g.fillStyle='#ecece4';g.fillRect(0,0,w,h);
    g.fillStyle='#154493';g.fillRect(0,0,48,h);
    g.fillStyle='#ffda42';
    for(let i=0;i<12;i++){const a=i*Math.PI/6;g.beginPath();g.arc(24+13*Math.cos(a),31+13*Math.sin(a),2,0,7);g.fill();}
    g.fillStyle='white';g.font='bold 23px Arial';g.textAlign='center';g.fillText('GR',24,93);
    // Keep the whole username inside the white area, with padding for ink
    // overhang and the border. Measure at full size before reducing the font.
    const left=72,right=w-24,maxWidth=right-left;
    let size=73;g.font=`600 ${size}px Arial`;
    const metrics=g.measureText(number);
    const inkWidth=Math.max(metrics.width,metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight);
    size=Math.min(size,Math.floor(size*maxWidth/Math.max(1,inkWidth)));
    g.font=`600 ${size}px Arial`;g.fillStyle='#15191b';g.textBaseline='middle';
    // The width argument also guards against browser/font metric differences.
    g.fillText(number,(left+right)/2,59,maxWidth);
    g.strokeStyle='#394047';g.lineWidth=4;g.strokeRect(2,2,w-4,h-4);
  });
  return new THREE.MeshStandardMaterial({map,roughness:0.4});
}
function emblem(kind) {const map=canvasTex(128,128,(g)=>{g.fillStyle='#14171a';g.beginPath();g.arc(64,64,61,0,7);g.fill();g.strokeStyle='#ccd0d5';g.lineWidth=5;g.stroke();if(kind==='z4'){for(let i=0;i<4;i++){g.beginPath();g.moveTo(64,64);g.arc(64,64,39,i*Math.PI/2,(i+1)*Math.PI/2);g.closePath();g.fillStyle=i%2?'#eef1f4':'#2478bc';g.fill();}g.fillStyle='white';g.font='bold 19px Arial';g.textAlign='center';g.fillText('B M W',64,24);}else{g.fillStyle='#eff1f2';g.textAlign='center';g.font=`bold ${kind==='mini'?23:19}px Arial`;g.fillText(({mini:'MINI',carrera:'PORSCHE',gr_yaris:'TOYOTA',gtv:'ALFA',golf:'VW',corolla:'TOYOTA',dolphin:'BYD',atto3:'BYD'}[kind]||'ŠKODA'),64,72);}});return new THREE.MeshStandardMaterial({map,metalness:.45,roughness:.24});}
function palette(car,d) {const paint=car.paint||new THREE.MeshPhysicalMaterial({color:car.spec.color,metalness:.48,roughness:.26,clearcoat:1,clearcoatRoughness:.08});paint.side=THREE.DoubleSide;return {paint,black:mat('#15191c',.64),rubber:mat('#151718',.89),seam:mat('#25292c',.67),chrome:mat('#c5cbd1',.23,.94),alloy:mat('#818b97',.3,.9),darkAlloy:mat('#252d37',.32,.78),glass:tintGlass(new THREE.MeshPhysicalMaterial({roughness:.08,metalness:0,transparent:true,side:THREE.DoubleSide,depthWrite:false}),d.open?'open':'cabin'),head:mat('#17242d',.19,.6),led:new THREE.MeshStandardMaterial({color:'#e6f4ff',emissive:'#cfedff',emissiveIntensity:1.5,roughness:.18}),tail:car.tail||new THREE.MeshStandardMaterial({color:'#6c1015',emissive:'#f62022',emissiveIntensity:.55,roughness:.24}),red:mat('#820713',.24),seat:mat(d.leather,.68),cloth:mat('#242628',.95),badge:emblem(car.modelKind)};}
function widthAt(d,z) {const e=Math.max(0,(Math.abs(z)/(d.L/2)-.73)/.27);return d.W/2*(1-.095*e*e);}
function topAt(d,z) {return z<d.cowl?lerp(d.front,d.belt,Math.sin(clamp((z+d.L/2)/(d.cowl+d.L/2),0,1)*Math.PI/2)):z>d.back?lerp(d.belt,d.rear,(z-d.back)/(d.L/2-d.back)):d.belt;}
export function sideSkinX(d,z,y) {
  // The side curvature depends on absolute height, never on the arch cut-out height.
  // Reparameterising it from each arch edge caused the old fender dents and floating trim.
  const v=clamp((y-.19)/(topAt(d,z)-.19),0,1),w=widthAt(d,z);
  const bulge=.019*Math.exp(-Math.pow((Math.abs(z)-d.wb/2)/.42,2));
  return w-.075*Math.pow(1-v,5)-.026*Math.pow(v,8)+bulge*Math.sin(v*Math.PI)-.013*Math.sin(v*Math.PI*2);
}
function skin(car,d,M,low) {
  if(d.profile)return shapedSkin(car,d,M,low);
  const p=car.body, arch=d.r+.06;
  // Actual open wheel wells: the lower edge follows the tyre envelope at both axles.
  for(const s of [-1,1]) {
    surface(p,M.paint,(u,v)=>{const z=lerp(-d.L/2,d.L/2,u),w=widthAt(d,z);let y0=.19;for(const axle of [-d.wb/2,d.wb/2]){const dz=z-axle;if(Math.abs(dz)<arch)y0=Math.max(y0,d.r+Math.sqrt(arch*arch-dz*dz));}const y=lerp(y0,topAt(d,z),v);return [s*sideSkinX(d,z,y),y,z];},low?64:160,12,'body-side');
    for(const z of [-d.wb/2,d.wb/2]) {
      const pts=[];for(let i=0;i<=32;i++){const a=Math.PI*i/32;const zz=z+Math.cos(a)*arch;const yy=d.r+Math.sin(a)*arch;pts.push([s*(sideSkinX(d,zz,yy)+.004),yy,zz]);}
      line(p,car.modelKind==='mini'||d.ev?M.black:M.paint,pts,car.modelKind==='mini'?.024:.012);
      // Liner sits inside the arch; not a solid disc that covers the wheel.
      surface(p,M.black,(u,v)=>{const a=u*Math.PI;return [s*lerp(d.track/2-.10,widthAt(d,z)-.01,v),d.r+Math.sin(a)*(arch-.008),z+Math.cos(a)*(arch-.008)];},32,3);
    }
    box(p,M.black,[.035,.065,d.wb-.69],[s*(d.W/2-.025),.225,0],.015);
    const sideSeam=(pts,r)=>{const curve=new THREE.CatmullRomCurve3(pts.map(v=>V(...v)));return line(p,M.seam,curve.getPoints(60).map(({y,z})=>[s*(sideSkinX(d,z,y)+.003),y,z]),r);};
    // belt edge, shoulder crease, door shut lines, flush handles and fuel flap
    line(p,M.chrome,[[s*(widthAt(d,d.cowl)-.03),d.belt+.006,d.cowl],[s*(d.W/2-.027),d.belt+.007,0],[s*(widthAt(d,d.back)-.03),d.belt+.007,d.back]],.007);
    const doorEnds=d.open||d.doors===2?[.67]:[.38,1.12];
    for(const z of doorEnds)sideSeam([[s*(widthAt(d,z)-.021),topAt(d,z)-.016,z],[s*widthAt(d,z),.7,z+.025],[s*(widthAt(d,z)-.024),.28,z-.06]],.003);
    sideSeam([[s*(widthAt(d,d.cowl)-.018),d.belt-.02,d.cowl],[s*widthAt(d,d.cowl),.65,d.cowl-.02],[s*(d.W/2-.025),.28,d.cowl+.1],[s*(d.W/2-.025),.27,doorEnds[0]-.06]],.003);
    for(const z of doorEnds)box(p,car.modelKind==='mini'?M.chrome:M.paint,[.028,.034,.15],[s*(sideSkinX(d,z-.15,d.belt-.105)+.007),d.belt-.105,z-.15],.014);
    if(!low) {const z=d.wb/2+.04;sideSeam([[s*(widthAt(d,z)+.01),d.belt-.13,z-.065],[s*(widthAt(d,z)+.015),d.belt-.25,z-.065],[s*(widthAt(d,z+.13)+.015),d.belt-.25,z+.065],[s*(widthAt(d,z+.13)+.01),d.belt-.13,z+.065],[s*(widthAt(d,z)+.01),d.belt-.13,z-.065]],.0025);}
  }
  for(const s of [-1,1])surface(p,M.paint,(u,v)=>{const z=lerp(d.cowl,d.back,u);return [s*lerp(widthAt(d,z)-.026,d.W/2-.115,v),d.belt+.008*Math.sin(v*Math.PI),z];},low?24:56,5,'door-shoulder');
  // Crowned hood and boot, separate from the open cabin.
  for(const [a,b,name] of [[-d.L/2,d.cowl,'bonnet'],[d.back,d.L/2,'boot']])surface(p,M.paint,(u,v)=>{const z=lerp(a,b,u),x=2*v-1;return[x*(widthAt(d,z)-.025),topAt(d,z)+.045*(1-x*x),z];},low?20:45,20,name);
  for(const end of [-1,1])surface(p,M.paint,(u,v)=>{const x=2*u-1,z=end*d.L/2,w=widthAt(d,z),bulge=.019*Math.exp(-Math.pow((Math.abs(z)-d.wb/2)/.42,2)),edge=w-.075*Math.pow(1-v,5)-.026*Math.pow(v,8)+bulge*Math.sin(v*Math.PI)-.013*Math.sin(v*Math.PI*2);return[x*edge,lerp(.19,topAt(d,z),v)+.045*(1-x*x)*Math.pow(v,8),z];},24,8,end<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.84,.09,d.L*.88],[0,.195,0],.03,[0,0,0],'undertray');
  if(car.modelKind==='mini')for(const s of [-1,1])surface(p,mat('#eeeae1',.33,.2),(u,v)=>{const z=lerp(-d.L/2+.12,d.cowl-.06,u),x=s*lerp(.19,.34,v);return[x,topAt(d,z)+.045*(1-Math.pow(x/(widthAt(d,z)-.025),2))+.002,z];},32,3);
  // Bonnet shut lines and pressed character lines catch the environment reflections.
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=16;i++){const z=lerp(-d.L/2+.12,d.cowl-.02,i/16),x=s*(widthAt(d,z)*.7);pts.push([x,topAt(d,z)+.045*(1-Math.pow(x/(widthAt(d,z)-.025),2))+.002,z]);}line(p,M.seam,pts,.0025);}
}
// Dedicated silhouette surfaces for the rear-engine coupe, rally hatch and Bertone notchback.
function profileAt(points,z){for(let i=1;i<points.length;i++)if(z<=points[i][0]){const [a,b]=[points[i-1],points[i]],t=clamp((z-a[0])/(b[0]-a[0]),0,1);return lerp(a[1],b[1],t*t*(3-2*t));}return points.at(-1)[1];}
function shoulderY(d,z){
  const F=-d.L/2,R=d.L/2;
  if(d.profile==='carrera')return profileAt([[F,.62],[-1.82,.78],[-1.25,.86],[d.cowl,d.belt],[.35,.88],[1.04,1.00],[1.47,.97],[R,.79]],z);
  if(d.profile==='yaris')return profileAt([[F,.78],[-1.35,.88],[d.cowl,.98],[.5,1.00],[1.38,1.08],[R,1.04]],z);
  return profileAt([[F,.77],[-1.93,.82],[d.cowl,.88],[.6,.88],[d.back,.89],[R,.87]],z);
}
function shapedWidth(d,z,y){
  const W=d.W/2,F=-d.L/2,R=d.L/2,ax=d.axleOffset||0;
  let w;
  if(d.profile==='carrera')w=profileAt([[F,W*.78],[-1.72,W*.95],[-1.1,W*.95],[-.35,W*.86],[.35,W*.90],[1.05,W],[1.60,W*.98],[R,W*.84]],z);
  else if(d.profile==='yaris')w=profileAt([[F,W*.88],[-1.30,W],[-.58,W*.91],[.42,W*.92],[1.25,W],[R,W*.91]],z);
  else w=profileAt([[F,W*.91],[-1.2,W*.99],[.4,W],[1.3,W*.99],[R,W*.94]],z);
  const v=clamp((y-.17)/(shoulderY(d,z)-.17),0,1);
  return w-.060*(1-v)**4-.014*v**6;
}
function deckY(d,x,z){
  const h=shoulderY(d,z),w=shapedWidth(d,z,h),q=x/w;
  if(d.profile==='carrera'&&z<d.cowl){const k=clamp((d.cowl-z)/.5,0,1),wings=.11*Math.exp(-(((z+1.55)/.58)**2));return h+.028*(1-q*q)-wings*(1-Math.exp(-(((Math.abs(q)-.72)/.22)**2)))*k;}
  return h+.028*(1-q*q);
}
function shapedSkin(car,d,M,low){
  const p=car.body,F=-d.L/2,R=d.L/2,ax=d.axleOffset||0,arch=d.r+.055;
  for(const s of [-1,1]){
    surface(p,M.paint,(u,v)=>{const z=lerp(F,R,u);let bottom=.18;for(const a of [-d.wb/2+ax,d.wb/2+ax])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=lerp(bottom,shoulderY(d,z),v);return [s*shapedWidth(d,z,y),y,z];},low?64:180,16,'body-side');
    for(const a of [-d.wb/2+ax,d.wb/2+ax]){
      const pts=[];for(let i=0;i<=40;i++){const t=Math.PI*i/40,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);pts.push([s*(shapedWidth(d,z,y)+.001),y,z]);}line(p,M.paint,pts,d.profile==='yaris'?.018:.008);
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+(arch-.006)*Math.cos(t),y=d.r+(arch-.006)*Math.sin(t);return[s*lerp(d.track/2-.12,shapedWidth(d,z,y)-.008,v),y,z];},40,4);
      surface(p,M.black,(u,v)=>{const t=u*Math.PI;return[s*(d.track/2-.17),d.r+Math.sin(t)*(arch-.007)*v,a+Math.cos(t)*(arch-.007)*v];},40,6,'inner-wheel-housing');
    }
    // A painted shoulder rolls over the haunches to the smaller glasshouse.
    surface(p,M.paint,(u,v)=>{const z=lerp(d.cowl,d.back,u),y=lerp(shoulderY(d,z),d.belt+.014,v),x=lerp(shapedWidth(d,z,shoulderY(d,z)),d.W/2-.14,v);return[s*x,y+.015*Math.sin(v*Math.PI),z];},64,10,'sculpted-shoulder');
    const end=d.profile==='carrera'?.72:d.profile==='yaris'?.61:.60;
    const shut=[[d.cowl+.03,d.belt-.015],[d.cowl+.14,.48],[d.cowl+.23,.285],[end-.10,.285],[end+.015,.49],[end,d.belt-.025]];
    const curve=new THREE.CatmullRomCurve3(shut.map(([z,y])=>V(0,y,z)));
    line(p,M.seam,curve.getPoints(90).map(({y,z})=>[s*(shapedWidth(d,z,y)+.002),y,z]),.0024);
    box(p,d.classic?M.chrome:M.paint,[.024,.028,.14],[s*(shapedWidth(d,end-.17,d.belt-.1)+.008),d.belt-.1,end-.17],.01);
    const sill=[];for(let i=0;i<=24;i++){const z=lerp(-d.wb/2+ax+.37,d.wb/2+ax-.38,i/24);sill.push([s*(shapedWidth(d,z,.22)+.005),.225,z]);}line(p,d.classic?M.chrome:M.black,sill,d.classic?.012:.025);
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=lerp(a,b,u),x=(2*v-1)*shapedWidth(d,z,shoulderY(d,z));return[x,deckY(d,x,z),z];},48,32,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=lerp(.18,shoulderY(d,z),v),x=(2*u-1)*shapedWidth(d,z,y);return[x,y+.028*(1-(2*u-1)**2)*v**8,z];},32,12,z<0?'front-bumper':'rear-bumper');
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=24;i++){const z=lerp(F+.12,d.cowl-.025,i/24),x=s*shapedWidth(d,z,shoulderY(d,z))*(d.profile==='carrera'?.52:.73);pts.push([x,deckY(d,x,z)+.002,z]);}line(p,M.seam,pts,.0023);}
  if(d.classic){line(p,M.chrome,[[-.67,.795,F-.003],[0,.813,F-.003],[.67,.795,F-.003]],.006);line(p,M.seam,[[-.67,.887,d.back+.045],[0,.916,d.back+.045],[.67,.887,d.back+.045]],.0025);}
  box(p,M.black,[d.W*.77,.075,d.L*.90],[0,.20,0],.025,[0,0,0],'undertray');
}
function roofY(d,u,x=0){const drop=d.profile==='yaris'?.115:d.profile==='carrera'?.065:.012;return d.H-.045-drop*u+.022*Math.sin(u*Math.PI)+(lerp(.018,.012,u)+.042*Math.sin(u*Math.PI))*(1-x*x);}
function shapedCabin(car,d,M,low){
  const p=car.body,W=d.W/2,rw=W-(d.profile==='carrera'?.27:.22),bw=W-.14;
  const frontPoint=(u,v)=>{const x=2*u-1;return[x*lerp(bw,rw,v),lerp(d.belt+.014,roofY(d,0,1),v)+.018*(1-x*x),lerp(d.cowl,d.header,v)-.045*(1-x*x)];};
  const rearPoint=(u,v)=>{const x=2*u-1;return[x*lerp(rw,bw,v),lerp(roofY(d,1,1),d.belt+.014,v)+.012*(1-x*x),lerp(d.roofBack,d.back,v)];};
  car.windscreen=surface(p,M.glass,frontPoint,24,10,'windscreen');surface(p,M.glass,rearPoint,22,12,'rear-glass');
  const roofMat=d.blackRoof?M.black:M.paint;
  surface(p,roofMat,(u,v)=>{const x=2*v-1;return[x*rw,roofY(d,u,x),lerp(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u)];},30,20,'roof');
  surface(p,M.cloth,(u,v)=>{const x=2*v-1;return[x*(rw-.008),roofY(d,u,x)-.018,lerp(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u)];},30,20,'headliner');
  for(const s of [-1,1]){
    const end=d.profile==='carrera'?d.back-.29:d.profile==='yaris'?d.back-.27:d.back-.12;
    const roofEnd=d.profile==='carrera'?d.roofBack-.025:d.profile==='yaris'?d.roofBack-.10:d.roofBack-.025;
    const A0=[s*bw,d.belt+.014,d.cowl],A1=[s*rw,roofY(d,0,1),d.header];
    const C0=[s*bw,d.belt+.014,end],C1=[s*rw,roofY(d,(roofEnd-d.header)/(d.roofBack-d.header),1)-.05,roofEnd];
    const ap=d.classic?.045:.078;
    // Broad sheet-metal A/C pillars, with glazing inset inside each opening.
    patch(p,M.paint,[A0,A1,[s*rw,roofY(d,0,1)-.058,d.header+ap],[s*bw,d.belt+.014,d.cowl+ap]],'solid-a-pillar');
    const outerC1=[s*rw,roofY(d,1,1),d.roofBack],outerC0=[s*bw,d.belt+.014,d.back];
    surface(p,M.paint,(u,v)=>{const inner=V(...C1).lerp(V(...C0),v),outer=V(...outerC1).lerp(V(...outerC0),v);const q=inner.lerp(outer,u);q.x+=s*.035*Math.sin(u*Math.PI)*Math.sin(v*Math.PI);return q.toArray();},18,18,'solid-c-pillar');
    const b=d.profile==='carrera'?.54:d.profile==='yaris'?.62:.46;
    const bHalf=d.classic?.018:d.profile==='yaris'?.045:.027;
    const top=z=>{const u=clamp((z-d.header)/(d.roofBack-d.header),0,1);return roofY(d,u,1)-.055;};
    const sideGlass=(z0,z1,front)=>surface(p,M.glass,(u,v)=>{const z=lerp(lerp(z0[0],z0[1],v),lerp(z1[0],z1[1],v),u);return[s*lerp(bw,rw,v),lerp(d.belt+.029,top(z),v),z];},18,10,front?'front-door-glass':'rear-door-glass');
    sideGlass([d.cowl+ap,d.header+ap],[b-bHalf,b-bHalf],true);sideGlass([b+bHalf,b+bHalf],[end,roofEnd],false);
    patch(p,d.classic?M.chrome:M.black,[[s*bw,d.belt+.019,b-bHalf],[s*rw,top(b),b-bHalf],[s*rw,top(b),b+bHalf],[s*bw,d.belt+.019,b+bHalf]],'solid-b-pillar');
    // A continuous painted upper rail joins sheet-metal roof, pillars and glass.
    surface(p,roofMat,(u,v)=>{const z=lerp(d.header,d.roofBack,u);return[s*(rw+.004*Math.sin(v*Math.PI)),roofY(d,u,1)-v*.058,z];},36,4,'solid-roof-rail');
    line(p,d.classic?M.chrome:M.black,[[s*bw,d.belt+.021,d.cowl+ap],[s*bw,d.belt+.021,end]],.006);
    box(p,M.black,[.14,.032,.07],[s*(W+.015),d.belt+.06,d.cowl+.11],.012);
    box(p,M.paint,[.22,.105,.12],[s*(W+.08),d.belt+.10,d.cowl+.11],.035);
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.185,.071),M.chrome,[s*(W+.08),d.belt+.10,d.cowl+.176]);
    box(p,M.black,[.055,.30,1.4],[s*(W-.25),d.belt-.19,.20],.025);box(p,M.seat,[.035,.11,.65],[s*(W-.27),d.belt-.19,.14],.02);
    line(p,M.black,[[s*.08,d.belt+.048,d.cowl-.02],[s*.24,d.belt+.06,d.cowl-.065],[s*.54,d.belt+.045,d.cowl-.065]],.006);
  }
  for(let i=0;i<7;i++){const v=(i+1)/9,pts=[];for(let j=0;j<=18;j++){const q=rearPoint(.08+.84*j/18,v);q[1]-=.003;pts.push(q);}line(p,M.alloy,pts,.0013);}
  cabinFittings(car,d,M,low);
}

function cabin(car,d,M,low) {
  if(d.profile)return shapedCabin(car,d,M,low);
  const p=car.body,W=d.W/2;
  const glass=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*lerp(W-.115,W-.23,v),lerp(d.belt+.014,d.H-.045,v)+.018*(1-x*x),lerp(d.cowl,d.header,v)-.045*(1-x*x)];},24,10,'windscreen');car.windscreen=glass;
  for(const s of [-1,1])line(p,car.modelKind==='mini'?M.black:M.paint,[[s*(W-.115),d.belt,d.cowl],[s*(W-.17),lerp(d.belt,d.H-.045,.5),lerp(d.cowl,d.header,.5)],[s*(W-.23),d.H-.045,d.header]],.026);
  line(p,d.open?M.black:M.paint,[[-W+.23,d.H-.045,d.header],[0,d.H-.025,d.header-.04],[W-.23,d.H-.045,d.header]],car.modelKind==='z4'?.014:.018);
  for(const s of [-1,1]) {
    line(p,M.black,[[s*.08,d.belt+.047,d.cowl-.02],[s*.22,d.belt+.065,d.cowl-.06],[s*.56,d.belt+.057,d.cowl-.07]],.007); // wipers
    const z=d.cowl+.1;
    box(p,M.black,[.15,.036,.06],[s*(W+.025),d.belt+.062,z],.015,[0,s*.15,0]);
    box(p,M.paint,[.245,.115,.125],[s*(W+.095),d.belt+.105,z],.045);
    box(p,M.black,[.224,.094,.009],[s*(W+.095),d.belt+.105,z+.062],.022);
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.205,.078),M.chrome,[s*(W+.095),d.belt+.105,z+.068],[0,0,0]);
    if(!d.open){
      const A0=[s*(W-.115),d.belt+.014,d.cowl],A1=[s*(W-.23),d.H-.045,d.header];
      const C1=[s*(W-.23),d.H-.045,d.roofBack],C0=[s*(W-.115),d.belt+.014,d.back];
      const bz=car.modelKind==='carrera'?.30:car.modelKind==='gtv'?.35:d.doors===2?.61:.34,topK=(bz-d.header)/(d.roofBack-d.header),bottomK=(bz-d.cowl)/(d.back-d.cowl);
      const B0=V(...A0).lerp(V(...C0),bottomK).toArray(),B1=V(...A1).lerp(V(...C1),topK).toArray();
      const b0a=[B0[0],B0[1],bz-.037],b0b=[B0[0],B0[1],bz+.037],b1a=[B1[0],B1[1],bz-.037],b1b=[B1[0],B1[1],bz+.037];
      patch(p,M.glass,[A0,A1,b1a,b0a],'front-door-glass');line(p,M.black,[A0,A1,b1a,b0a,A0],.009);
      patch(p,M.glass,[b0b,b1b,C1,C0],'rear-door-glass');line(p,M.black,[b0b,b1b,C1,C0,b0b],.009);
      patch(p,M.black,[b0a,b1a,b1b,b0b],'b-pillar');
      line(p,M.chrome,[A0,A1,C1,C0,A0],.006);
      // Solid upper rails bridge the roof edge to the side glass. Both share the same endpoints.
      line(p,M.paint,[A1,[(A1[0]+C1[0])/2,d.H-.045,(d.header+d.roofBack)/2],C1],.023);
      patch(p,M.paint,[[s*(W-.23),d.H-.045,d.roofBack],[s*(W-.29),d.H-.045,d.roofBack-.015],[s*(W-.22),d.belt+.014,d.back+.03],C0],'c-pillar');
      line(p,M.paint,[C1,C0],.028);
    }
    box(p,M.black,[.06,.31,d.open?1.02:1.9],[s*(W-.125),d.belt-.20,d.open?.15:.40],.035);
    box(p,M.seat,[.035,.12,.65],[s*(W-.16),d.belt-.19,.15],.024);
    box(p,M.chrome,[.018,.025,.12],[s*(W-.185),d.belt-.1,-.12],.009);
  }
  if(!d.open){
    // Share the windscreen's bowed top edge and the rear glass edge exactly.
    surface(p,d.blackRoof?M.black:M.paint,(u,v)=>{const x=2*v-1,z=lerp(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u);return[x*(W-.23),d.H-.045+(lerp(.018,.012,u)+.055*Math.sin(u*Math.PI))*(1-x*x),z];},30,20,'roof');
    surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*lerp(W-.23,W-.115,v),lerp(d.H-.045,d.belt+.014,v)+.012*(1-x*x),lerp(d.roofBack,d.back,v)];},22,12,'rear-glass');
    // Roof has a proper inner lining visible from the driving camera.
    const lining=mat('#70706b',.95);lining.side=THREE.DoubleSide;
    surface(p,lining,(u,v)=>{const x=2*v-1;return [x*(W-.245),d.H-.073+(.045+.025*Math.sin(u*Math.PI))*(1-x*x),lerp(d.header+.024,d.roofBack-.025,u)];},16,10);
    if(!d.classic&&car.modelKind!=='carrera')box(p,M.black,[.065,.075,.17],[0,d.H+.025,d.roofBack-.1],.025,[.25,0,0]);
    for(let i=0;i<7;i++){const z=lerp(d.roofBack+.08,d.back-.08,i/6),k=(z-d.roofBack)/(d.back-d.roofBack),half=lerp(W-.23,W-.115,k);const pts=[];for(let j=0;j<=16;j++){const x=lerp(-half*.86,half*.86,j/16);pts.push([x,lerp(d.H-.045,d.belt+.014,k)+.012*(1-(x/half)**2)-.003,z]);}line(p,M.alloy,pts,.0015);}
  }else{
    box(p,M.cloth,[d.W*.77,.12,car.modelKind==='mini'?.33:.23],[0,d.belt+.055,d.back+.10],.045);
    for(const s of [-1,1])line(p,M.alloy,[[s*.37-.14,d.belt+.03,d.back-.13],[s*.37-.14,d.belt+.30,d.back-.11],[s*.37,d.belt+.34,d.back-.1],[s*.37+.14,d.belt+.30,d.back-.11],[s*.37+.14,d.belt+.03,d.back-.13]],.026);
  }
  cabinFittings(car,d,M,low);
}
function cabinFittings(car,d,M,low){
  const p=car.body;
  box(p,M.cloth,[d.W*.80,.075,d.back-d.cowl],[0,.36,(d.back+d.cowl)/2],.02);
  // Separate sculpted cushions, shoulder bolsters, head restraints and stitching.
  const rows=car.modelKind==='z4'||d.seats===2?[d.seatZ]:[d.seatZ,d.open?.90:.99];
  for(const [ri,z]of rows.entries())for(const s of [-1,1]){
    const x=s*d.W*.215, y=ri?(d.rearLow?.36:.48):(d.seatBase??.43), backH=ri&&d.rearLow?.32:.48;
    box(p,M.seat,[.43,.12,.46],[x,y,z-.05],.06);
    box(p,M.seat,[.43,backH,.115],[x,y+backH/2+.03,z+.17],.055,[.14,0,0]);
    for(const b of [-1,1]){box(p,M.seat,[.08,.14,.43],[x+b*.20,y+.025,z-.04],.037);box(p,M.seat,[.08,backH-.04,.14],[x+b*.20,y+backH/2+.03,z+.12],.035,[.14,0,b*-.1]);}
    for(const b of [-1,1])box(p,M.chrome,[.013,.12,.013],[x+b*.066,y+backH+.08,z+.21],.004);
    box(p,M.seat,[.25,.16,.10],[x,y+backH+.18,z+.22],.035);
    if(!low)for(const b of [-1,1])line(p,M.alloy,[[x+b*.155,y+.1,z-.21],[x+b*.155,y+.1,z+.08],[x+b*.155,y+.23,z+.098],[x+b*.155,y+.44,z+.15]],.0015);
    // Seat belt buckles and belt webbing.
    box(p,M.red,[.037,.042,.055],[x-s*.255,y+.06,z+.07],.009);
    if(!low)line(p,M.black,[[x+s*.245,y+.1,z+.18],[x+s*.245,y+.55,z+.26]],.013);
  }
  // Exterior-only dashboard for traffic and rivals; the player Cockpit replaces this group.
  const dashboard=car.exteriorDash=new THREE.Group();dashboard.name='exterior-dashboard';p.add(dashboard);
  box(dashboard,M.black,[d.W-.28,.17,.24],[0,d.belt-.08,d.cowl+.10],.04);
  box(dashboard,M.black,[.26,.14,.025],[0,d.belt-.035,d.cowl+.25],.012);
  ring(dashboard,M.black,.16,.016,[-d.W*.215,d.eyeY-.30,d.seatZ-.43],[-.36,0,0]);
  for(const x of [-.10,.10])box(dashboard,M.alloy,[.11,.018,.025],[-d.W*.215+x,d.eyeY-.30,d.seatZ-.43],.004);
  // Centre tunnel remains visible in exterior views too.
  box(p,M.black,[.22,.16,.70],[0,.50,d.seatZ-.12],.045);
}
function wheels(car,d,M,low) {
  car.wheels=[];
  for(const front of [true,false])for(const s of [-1,1]) {
    const pivot=new THREE.Group();pivot.name=`${front?'front':'rear'}-${s<0?'left':'right'}-steering`;pivot.position.set(s*(d.mercedes&&!front?d.trackRear||d.track:d.track)/2,d.r,(front?-1:1)*d.wb/2+(d.axleOffset||0));car.root.add(pivot);
    const spin=new THREE.Group();spin.name='wheel-spin';pivot.add(spin);
    const width=(front?d.tyreF:d.tyreR)||(car.modelKind==='z4'?(front?.255:.275):.215), R=d.r, rim=d.rim;
    const points=[[rim,-width*.49],[R*.91,-width*.51],[R*.986,-width*.40],[R,-width*.29],[R,width*.29],[R*.986,width*.40],[R*.91,width*.51],[rim,width*.49]].map(([r,z])=>new THREE.Vector2(r,z));
    const tg=new THREE.LatheGeometry(points,low?32:64);tg.rotateZ(Math.PI/2);mesh(spin,tg,M.rubber);
    // Four circumferential tread channels and sidewall moulding.
    for(const x of [-.28,-.09,.09,.28])ring(spin,M.seam,R-.001,.003,[x*width,0,0],[0,Math.PI/2,0]);
    ring(spin,M.seam,R*.89,.002,[s*width*.512,0,0],[0,Math.PI/2,0]);
    const ox=s*(width*.47);
    const barrel=new THREE.CylinderGeometry(rim,rim,width*.90,low?24:48,1,true);barrel.rotateZ(Math.PI/2);mesh(spin,barrel,M.darkAlloy);
    ring(spin,M.chrome,rim-.004,.008,[ox,0,0],[0,Math.PI/2,0]);
    const disc=new THREE.CylinderGeometry(rim*.86,rim*.86,.016,48);disc.rotateZ(Math.PI/2);mesh(spin,disc,M.alloy,[s*width*.20,0,0]);
    const caliper=box(pivot,car.spec.visual?.caliper?mat(car.spec.visual.caliper,.34,.5):car.modelKind==='z4'?mat('#154eaf',.34,.5):car.modelKind==='gr_yaris'?M.red:M.darkAlloy,[.065,.135,.07],[s*width*.24,0,rim*.73],.02);caliper.name='fixed-brake-caliper';
    const n=car.spec.visual?.spokes || (car.modelKind==='mini'?6:5);
    for(let k=0;k<n;k++)for(const branch of (car.modelKind==='mini'?[0]:[-1,1])){
      const a=k*Math.PI*2/n+(branch*.065),r= rim*.58;
      const o=box(spin,M.chrome,[.025,rim*.76,low?.031:.023],[ox,Math.cos(a)*r,Math.sin(a)*r],.006,[a,0,0]);
      if(!low){for(let j=0;j<2;j++){const ang=a+j*.085;disk(spin,M.darkAlloy,.008,[s*width*.22,Math.cos(ang)*rim*.71,Math.sin(ang)*rim*.71],[0,s*Math.PI/2,0]);}}
    }
    disk(spin,M.darkAlloy,.058,[ox+s*.009,0,0],[0,s*Math.PI/2,0]);
    disk(spin,M.badge,.034,[ox+s*.011,0,0],[0,s*Math.PI/2,0]);
    if(!low)for(let k=0;k<5;k++){const a=k*Math.PI*2/5;disk(spin,M.chrome,.006,[ox+s*.012,Math.cos(a)*.045,Math.sin(a)*.045],[0,s*Math.PI/2,0]);}
    car.wheels.push({pivot,spin,front,r:R,restY:pivot.position.y,side:s,angle:0,caliper});
  }
}
function exhaust(p,M,x,y,z,wide=false) {
  const g=new THREE.Group();p.add(g);g.position.set(x,y,z);g.name='exhaust-outlet';
  const tube=new THREE.CylinderGeometry(.043,.043,.21,24,1,true);tube.rotateX(Math.PI/2);const o=mesh(g,tube,M.chrome);if(wide)o.scale.x=1.65;
  const lip=ring(g,M.chrome,.043,.005,[0,0,.106]);if(wide)lip.scale.x=1.65;
  const soot=disk(g,M.black,.037,[0,0,.078]);if(wide)soot.scale.x=1.65;
  return V(x,y,z+.11);
}
function fascia(car,d,M,low,plate) {
  if(['carrera','gr_yaris','gtv'].includes(car.modelKind)){specialFascia(car,d,M,low,plate);return;}
  const p=car.body,F=-d.L/2-.008,R=d.L/2+.007,W=d.W/2,mini=car.modelKind==='mini',bmw=car.modelKind==='z4';
  const plateM=makePlateMaterial(plate);M.plate=plateM;car.plate=plate;
  for(const [z,y,ry] of [[F-.009,.40,Math.PI],[R+.009,.50,0]]){box(p,M.black,[.55,.125,.019],[0,y,z],.01);mesh(p,new THREE.PlaneGeometry(.52,.11),plateM,[0,y,z+(z<0?-.012:.012)],[0,ry,0],'registration');}
  const grY=mini?.61:bmw?.57:.65;
  if(mini){
    box(p,M.chrome,[.88,.265,.04],[0,grY,F-.005],.12);
    box(p,M.black,[.83,.22,.048],[0,grY,F-.014],.095);
    for(let i=0;i<5;i++)box(p,M.darkAlloy,[.69,.012,.018],[0,grY-.073+i*.037,F-.045],.002);
    box(p,M.black,[.36,.032,.09],[0,topAt(d,-1.36)+.04,-1.36],.015,[-.05,0,0]);
  }else if(bmw){
    for(const s of [-1,1]){box(p,M.chrome,[.47,.235,.035],[s*.254,grY,F-.008],.085,[0,0,s*.10]);box(p,M.black,[.428,.19,.04],[s*.254,grY,F-.028],.065,[0,0,s*.1]);for(let i=0;i<7;i++)box(p,M.alloy,[.009,.14,.012],[s*.254+(i-3)*.05,grY,F-.054],.002,[0,0,s*.1]);}
  }else if(!d.ev){
    const pts=[[-.47,grY+.12,F],[.47,grY+.12,F],[.34,grY-.10,F-.025],[-.34,grY-.10,F-.025]];
    patch(p,M.black,pts);line(p,M.chrome,[...pts,pts[0]],.015);
    for(let i=-8;i<=8;i++)box(p,M.chrome,[.009,.18,.018],[i*.046,grY,F-.025],.002);
  }else{
    box(p,M.darkAlloy,[d.W*.68,.045,.024],[0,grY+.11,F-.016],.012);
    mesh(p,new THREE.PlaneGeometry(.15,.034),textMaterial('BYD'),[0,grY+.115,F-.033],[0,Math.PI,0]);
  }
  // Lower intake openings, splitter, bumper reflectors and parking sensors.
  box(p,M.black,[d.W*.59,.105,.025],[0,.265,F-.013],.035);
  for(const s of [-1,1]){
    box(p,M.black,[mini?.19:.23,mini?.11:.19,.035],[s*W*.78,.37,F+.015],.025,[0,0,s*.07]);
    if(!low)for(let j=0;j<3;j++)box(p,M.darkAlloy,[.13,.009,.01],[s*W*.78,.31+j*.033,F-.012],.002);
    if(mini){
      const g=new THREE.Group();g.position.set(s*.59,d.front-.14,F-.009);g.rotation.set(0,0,0);p.add(g);
      const o=disk(g,M.head,.148,[0,0,0],[0,Math.PI,0]);o.scale.y=1.1;
      const rim=ring(g,M.chrome,.148,.011,[0,0,-.006]);rim.scale.y=1.1;
      ring(g,M.led,.124,.006,[0,0,-.013]);disk(g,M.chrome,.058,[0,-.007,-.017],[0,Math.PI,0]);
      ring(g,M.led,.051,.006,[0,-.007,-.019]);
      box(p,M.chrome,[.205,.30,.026],[s*.64,.77,R-.006],.056);
      box(p,M.red,[.179,.274,.03],[s*.64,.77,R+.008],.049);
      const x=s*.64,z=R+.029;line(p,M.tail,[[x-.07,.88,z],[x+.07,.67,z]],.009);line(p,M.tail,[[x+.07,.88,z],[x-.07,.67,z]],.009);line(p,M.tail,[[x,.895,z],[x,.645,z]],.009);line(p,M.tail,[[x-.075,.77,z],[x+.075,.77,z]],.009);
    }else{
      const x=s*W*.69,y=d.front-.066,outer=s*W*.86,inner=s*W*.49;
      patch(p,M.head,[[inner,y+.035,F],[outer,y+.045,F],[outer,y-.045,F],[inner,y-.070,F]]);
      line(p,M.led,[[inner,y+.024,F-.003],[x,y+.030,F-.003],[outer,y+.037,F-.003]],.008);
      if(bmw)for(const dx of [-.054,.054])line(p,M.led,[[x+dx-.017,y+.012,F-.003],[x+dx-.017,y-.036,F-.003],[x+dx+.027,y-.036,F-.003]],.006);
      else line(p,M.led,[[inner,y-.055,F-.003],[x,y-.039,F-.003],[outer,y-.032,F-.003]],.005);
      const ty=d.rear-.12;
      // Keep the lens and its light guide together on the rear cap, inside its tapered edges.
      const rearOuter=s*W*.86,lensZ=R+.008;
      patch(p,M.red,[[s*.32,ty+.04,lensZ],[rearOuter,ty+.075,lensZ],[rearOuter,ty-.064,lensZ],[s*.50,ty-.045,lensZ]]);
      line(p,M.tail,[[s*.35,ty+.025,lensZ+.003],[rearOuter-s*.025,ty+.05,lensZ+.003],[rearOuter-s*.025,ty-.038,lensZ+.003],[s*.56,ty-.039,lensZ+.003]],.009);
      if(d.ev)line(p,M.tail,[[-W*.83,ty+.035,lensZ+.003],[0,ty+.035,lensZ+.003],[W*.83,ty+.035,lensZ+.003]],.006);
    }
    box(p,M.red,[.18,.028,.02],[s*W*.77,.32,R+.012],.01);
    if(!low)for(const end of [-1,1])disk(p,M.black,.013,[s*W*.58,.40,end*(d.L/2+.013)],[0,end<0?Math.PI:0,0]);
  }
  box(p,M.black,[d.W*.82,.14,.055],[0,.245,R],.025);
  for(const x of [-.34,-.17,0,.17,.34])box(p,M.black,[.018,.09,.19],[x,.195,R-.06],.008);
  // Actual open, soot-darkened exhaust outlets (EVs deliberately have none).
  car.exhaust=[];
  if(mini)for(const x of [-.061,.061])car.exhaust.push(exhaust(p,M,x,.26,R+.008));
  else if(bmw)for(const x of [-.66,.66])car.exhaust.push(exhaust(p,M,x,.27,R-.006,true));
  else if(!d.ev)car.exhaust.push(exhaust(p,M,-.59,.19,R-.13));
  disk(p,M.badge,mini?.042:.035,[0,d.front+.065,F+.065],[-.7,Math.PI,0]);
  disk(p,M.badge,.037,[0,d.rear-.095,R+.024]);
  if(mini)for(const s of [-1,1])for(let i=0;i<3;i++)box(p,M.chrome,[.07-i*.014,.006,.008],[s*(.065-i*.006),d.rear-.09+i*.014,R+.024],.002);
  if(!mini){const name=bmw?'Z4     M40i':d.ev?'B U I L D   Y O U R   D R E A M S':'Š K O D A';mesh(p,new THREE.PlaneGeometry(bmw?.46:.61,.044),textMaterial(name,null,'#dce0e4'),[0,d.rear-.205,R+.023]);}
  if(car.spec.taxi){const sign=new THREE.Group();p.add(sign);sign.position.set(0,d.H+.09,.05);box(sign,M.black,[.61,.035,.23],[0,-.078,0],.025);box(sign,mat('#e7dba6',.45),[.56,.15,.17],[0,0,0],.026);const tm=textMaterial('TAXI','#efe6b7','#141818');tm.emissive=new THREE.Color('#efe5bb');tm.emissiveMap=tm.map;tm.emissiveIntensity=.25;for(const s of [-1,1])mesh(sign,new THREE.PlaneGeometry(.48,.106),tm,[0,0,s*.087],[0,s<0?Math.PI:0,0]);}
}
// The new cars have their own lamps, bumpers and grilles; all fascia surfaces seat against the end caps.
function specialFascia(car,d,M,low,plate){
  const p=car.body,W=d.W/2,F=-d.L/2-.007,R=d.L/2+.007,k=car.modelKind;
  const classic=k==='gtv',porsche=k==='carrera',toyota=k==='gr_yaris';
  const plateM=M.plate=makePlateMaterial(plate);car.plate=plate;
  for(const end of [-1,1]){const z=end<0?F:R,y=classic?.34:.40;box(p,M.black,[.55,.124,.018],[0,y,z],.01);mesh(p,new THREE.PlaneGeometry(.52,.11),plateM,[0,y,z+end*.012],[0,end<0?Math.PI:0,0],'registration');}
  if(classic){
    box(p,M.black,[d.W*.88,.23,.018],[0,.65,F],.014);
    for(const s of [-1,1])for(const x of [.33,.57]){const r=x>.5?.093:.079;disk(p,M.head,r,[s*x,.665,F-.014],[0,Math.PI,0]);ring(p,M.chrome,r,.008,[s*x,.665,F-.015]);disk(p,M.chrome,r*.69,[s*x,.665,F-.019],[0,Math.PI,0]);}
    for(const s of [-1,1])for(let i=0;i<5;i++)box(p,M.chrome,[.13,.006,.009],[s*.16,.60+i*.026,F-.013],.002);
    const shield=[[-.085,.77,F-.026],[.085,.77,F-.026],[.035,.54,F-.026],[-.035,.54,F-.026]];
    patch(p,M.black,shield);line(p,M.chrome,[...shield,shield[0]],.008);
    for(const end of [-1,1]){box(p,M.chrome,[d.W*.9,.062,.078],[0,.46,end<0?F-.018:R+.018],.019);for(const s of [-1,1])box(p,M.black,[.044,.14,.09],[s*.48,.46,end<0?F-.027:R+.027],.01);}
    for(const s of [-1,1]){box(p,M.chrome,[.32,.142,.024],[s*.48,.73,R],.02);box(p,M.red,[.295,.117,.026],[s*.48,.73,R+.013],.014);box(p,M.tail,[.19,.065,.007],[s*.49,.71,R+.029],.008);box(p,mat('#c98118',.25),[.082,.063,.008],[s*.585,.75,R+.029],.007);}
  }else if(porsche){
    for(const s of [-1,1]){
      // Oval lenses are projected onto the wing crown, not suspended as flat discs above it.
      const cx=s*.60,cz=-1.91;
      const lens=new THREE.CircleGeometry(1,48),a=lens.attributes.position;
      for(let i=0;i<a.count;i++){const x=cx+a.getX(i)*.138,z=cz+a.getY(i)*.195;a.setXYZ(i,x,deckY(d,x,z)+.004,z);}lens.computeVertexNormals();mesh(p,lens,M.head);
      const outline=[];for(let i=0;i<=48;i++){const t=i*Math.PI/24,x=cx+.138*Math.cos(t),z=cz+.195*Math.sin(t);outline.push([x,deckY(d,x,z)+.006,z]);}line(p,M.chrome,outline,.006);
      const projector=[];for(let i=0;i<=32;i++){const t=i*Math.PI/16,x=cx+.054*Math.cos(t),z=cz+.072*Math.sin(t);projector.push([x,deckY(d,x,z)+.009,z]);}line(p,M.led,projector,.005);
      box(p,M.head,[.37,.105,.025],[s*.53,.30,F],.025);for(let j=-1;j<=1;j++)box(p,M.darkAlloy,[.32,.007,.012],[s*.53,.30+j*.022,F-.018],.002);
      box(p,M.led,[.29,.013,.01],[s*.53,.37,F-.008],.006);
      patch(p,M.red,[[s*.31,.78,R+.002],[s*.76,.79,R+.002],[s*.74,.70,R+.002],[s*.38,.715,R+.002]]);
      line(p,M.tail,[[s*.34,.76,R+.007],[s*.72,.765,R+.007]],.01);
    }
    // Rear engine grille follows the crowned deck, between glass and the deployable spoiler seam.
    for(let i=0;i<9;i++){const z=d.back+.045+i*.035;surface(p,M.black,(u,v)=>{const zz=z+v*.012,x=lerp(-.46,.46,u);return [x,deckY(d,x,zz)+.003,zz];},8,1);}
    line(p,M.seam,[[-.60,deckY(d,-.60,d.L/2-.07)+.002,d.L/2-.07],[0,deckY(d,0,d.L/2-.07)+.002,d.L/2-.07],[.60,deckY(d,.60,d.L/2-.07)+.002,d.L/2-.07]],.003);
  }else{
    // GR Yaris: deep cooling opening, dark carbon roof, wide angular rear lamps and a hatch spoiler.
    const grill=[[-.60,.61,F],[.60,.61,F],[.68,.25,F],[-.68,.25,F]];patch(p,M.black,grill);line(p,M.darkAlloy,[...grill,grill[0]],.013);
    for(let i=-7;i<=7;i++)line(p,M.darkAlloy,[[i*.075,.28,F-.008],[i*.075,.58,F-.008]],.004);
    for(const s of [-1,1]){patch(p,M.head,[[s*.34,.73,F-.005],[s*.74,.765,F-.005],[s*.75,.65,F-.005],[s*.39,.66,F-.005]]);line(p,M.led,[[s*.38,.707,F-.01],[s*.70,.734,F-.01],[s*.72,.674,F-.01]],.008);}
    box(p,M.black,[d.W*.83,.15,.015],[0,.86,R],.015);
    for(const s of [-1,1]){patch(p,M.red,[[s*.48,.945,R+.01],[s*.76,.965,R+.01],[s*.77,.79,R+.01],[s*.57,.76,R+.01]]);line(p,M.tail,[[s*.51,.917,R+.014],[s*.72,.933,R+.014],[s*.72,.824,R+.014],[s*.59,.80,R+.014]],.009);}
    box(p,M.black,[1.15,.043,.21],[0,roofY(d,1,0)+.018,d.roofBack+.075],.014);
    mesh(p,new THREE.PlaneGeometry(.083,.045),textMaterial('GR','#b7141d'),[.4,.57,F-.023],[0,Math.PI,0]);
  }
  if(!classic)box(p,M.black,[d.W*.82,.11,.04],[0,.245,R],.024);
  car.exhaust=[];for(const x of (classic?[-.51]:[-.62,.62]))car.exhaust.push(exhaust(p,M,x,.25,R+.004,porsche));
  disk(p,M.badge,.034,[0,d.front-.005,F-.023],[0,Math.PI,0]);
  mesh(p,new THREE.PlaneGeometry(porsche?.50:.34,.044),textMaterial(porsche?'P O R S C H E':classic?'2000 GTV':'GR YARIS','#15181c'),[0,d.rear-.16,R+.018]);
  if(!low)for(const s of [-1,1])for(const end of [-1,1])disk(p,M.black,.011,[s*W*.60,.42,end<0?F-.01:R+.01],[0,end<0?Math.PI:0,0]);
}
export function damageSystem(car) { return installDamageSystem(car); }
export function buildDetailedCar(car,kind,opts={}) {
  car.modelKind=kind in MODEL?kind:'octavia';const visual=car.spec.visual||{}, d={...MODEL[car.modelKind],amg:car.spec.visual?.amg ?? MODEL[car.modelKind].amg},low=!!opts.low;
  if(visual.amg && kind==='cle'){d.W=1.936;d.track=1.663;d.trackRear=1.691;}
  if(visual.rim)d.rim=visual.rim*.0254/2;
  if(visual.ride)car.body.position.y=visual.ride;
  car.dims={L:d.L,W:d.W,H:d.H};car.shape={...d,ws:[-d.header/(d.L/2),-d.cowl/(d.L/2)],roofT:[-d.roofBack/(d.L/2),-d.header/(d.L/2)]};
  car.seat=V(-d.W*.215,d.eyeY,d.seatZ);car.dash={y:d.belt,z:d.cowl+.14,w:d.W-.28,x:car.seat.x,wheelY:d.eyeY-.30,wheelZ:d.seatZ-.43,wheelR:.18};
  const M=palette(car,d);car.paint=M.paint;car.tail=M.tail;car.materials=M;
  const playerModel=isPlayerVehicle(car);car.root.userData.playerDetail=playerModel;
  if(d.mercedes){
    buildMercedes(car,d,M,low,opts.plate||nextRegistration(),{mesh,box,line,surface,patch,ring,cabinFittings,makePlateMaterial});
    wheels(car,d,M,low);
  }else if(ROAD_MODELS[kind]){
    buildRoadCar(car,d,M,low,opts.plate||nextRegistration(),{surface,box,line,patch,mesh,ring,disk,cabin,cabinFittings,wheels,makePlateMaterial,textMaterial});
  }else if(car.spec.fleet){
    const build=car.spec.police?buildPoliceModel:buildPassengerModel;
    const source=build({id:car.spec.fleet},car.spec.color,null,{low:false,parked:true,playerCabin:true});
    const replacements=new Map(Object.keys(source.materials).filter(k=>M[k]).map(k=>[source.materials[k],M[k]]));
    // Mirrored fleet lens polygons have opposite winding; preserve their two-sided optics.
    for(const [original,replacement]of replacements)replacement.side=original.side;
    source.body.traverse(o=>{if(o.isMesh){if(replacements.has(o.material))o.material=replacements.get(o.material);if(!o.geometry.attributes.uv)o.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(o.geometry.attributes.position.count*2),2));}});
    // Replace coarse traffic furniture with the player cabin; preserve the traffic shell/fascia.
    for(const o of [...source.body.children])if(/^(dashboard|centre-console|front-seat|headrest|rear-bench|steering-wheel)/.test(o.name))o.removeFromParent();
    for(const o of [...source.body.children])car.body.add(o);
    for(const o of car.body.children){if(o.name==='bumper_f'||o.name==='bumper_r'){o.name=o.name==='bumper_f'?'front-bumper':'rear-bumper';delete o.userData.damagePart;}if(o.name==='underfloor')o.name='undertray';}
    // Traffic's bumper tag includes the upper grille and plate carrier. Keep
    // those on the steel end cap when only the player bumper cover detaches.
    car.body.updateMatrixWorld(true);car.body.traverse(o=>{if(o.isMesh&&/^bumper_[fr]$/.test(o.userData.damagePart)){const box=new THREE.Box3().setFromObject(o);if(box.max.y>.535)o.userData.damagePart='structure';}});
    car.windscreen=car.body.getObjectByName('windscreen-glass');car.windscreen.userData.damagePart='glass_windscreen';
    car.mirrorL=car.body.getObjectByName('mirror_l').getObjectByName('mirror-face');car.mirrorR=car.body.getObjectByName('mirror_r').getObjectByName('mirror-face');
    M.plate=source.materials.plate;car.plate=source.plate;car.exhaust=[V(-d.W*.28,.167,d.L/2-.047)];
    if(source.setStrobe){car.strobeMaterials=source.strobeMaterials;car.setStrobe=source.setStrobe;car.police=true;}
    cabinFittings(car,d,M,low);wheels(car,d,M,low);
  }else{
    if(!playerModel||!buildOriginalPlayerSkin(car,d,M,low))skin(car,d,M,low);
    cabin(car,d,M,low);wheels(car,d,M,low);fascia(car,d,M,low,opts.plate||nextRegistration(car.spec.taxi));
  }
  if(car.spec.visual?.lip)box(car.body,M.black,[d.W*.84,.035,.12],[0,['panda','yaris','ibiza','golf','mini_jcw','gr_yaris'].includes(kind)?d.H-.04:d.rear+.035,d.L/2-.11],.012,[0,0,0],'trim-spoiler-lip');
  if(car.spec.visual?.m){
    box(car.body,M.black,[d.W*.80,.09,.10],[0,.22,-d.L/2+.03],.012,[0,0,0],'m-front-splitter');
    box(car.body,M.black,[d.W*.76,.12,.10],[0,.24,d.L/2-.03],.012,[0,0,0],'m-rear-diffuser');
  }
  if(car.spec.visual){
    const badge=mesh(car.body,new THREE.PlaneGeometry(.34,.055),textMaterial(car.spec.short,null),[d.W*.25,d.rear-.10,d.L/2+.025]);badge.name='trim-badge';
  }
  if(playerModel){refinePlayerDetails(car,d,M);refineOriginalPlayer(car,d,M,low);refineSportsPlayer(car,d,M,low);}
  // Apply trim parts after body refinements, which can replace the stock fascia.
  if(visual.exhaust){
    const old=[];car.body.traverse(o=>{if(/exhaust/.test(o.name))old.push(o);});for(const o of old)o.removeFromParent();
    const n=visual.exhaust,mid=kind==='mini'||kind==='mini_jcw',high=kind==='huracan';
    const xs=n===4?[-.66,-.54,.54,.66]:n===2?(mid?[-.065,.065]:[-d.W*.30,d.W*.30]):[-d.W*.29];
    car.exhaust=xs.map(x=>exhaust(car.body,M,x,high?.626:.25,d.L/2+(high?.07:-.03)));
  }
  if(visual.kit){
    box(car.body,M.black,[d.W*.82,.055,.14],[0,.20,-d.L/2+.08],.012,[0,0,0],'trim-front-splitter');
    box(car.body,M.black,[d.W*.77,.11,.14],[0,.22,d.L/2-.04],.012,[0,0,0],'trim-rear-diffuser');
    for(const x of [-.48,-.24,0,.24,.48])box(car.body,M.black,[.025,.12,.20],[x,.18,d.L/2-.04],.005,[0,0,0],'trim-diffuser-fin');
    const stripe=visual.kit==='GTI'?M.red:M.chrome;
    box(car.body,stripe,[d.W*.54,.018,.015],[0,.56,-d.L/2-.008],.003,[0,0,0],'trim-grille-stripe');
  }
  // Light automotive tint: preserve the cabin through both side panes. Physical
  // dielectric specular gives the stronger grazing reflections without metallic glass.
  tintGlass(M.glass,d.open?'open':'cabin');
  if(playerModel||ROAD_MODELS[kind]||d.mercedes){M.glass.metalness=0;M.glass.roughness=.06;M.glass.ior=1.52;M.glass.envMapIntensity=.7;M.glass.forceSinglePass=true;}
  car.root.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true;}});
  const grouped=groupPlayerParts(car,d);
  if(!grouped){
    for(const side of [-1,1]){const face=car[side<0?'mirrorL':'mirrorR'],g=new THREE.Group();g.name=side<0?'mirror_l':'mirror_r';car.body.add(g);g.attach(face);}
    seatMirrors(car);
  }
  if(grouped){
    for(const [name,part] of Object.entries(grouped.parts))if(!['doors','mirrors','lights','glass'].includes(name))compactMeshes(part,grouped.keep);
  }else compactMeshes(car.body, new Set([car.windscreen,car.mirrorL,car.mirrorR,...car.exteriorDash.children]));
  for(const w of car.wheels)compactMeshes(w.spin);
  installPlayerLOD(car,d);
  damageSystem(car);
  if(!low){
    const cloud=canvasTex(32,32,(g,w,h)=>{const a=g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);a.addColorStop(0,'rgba(220,225,225,.6)');a.addColorStop(1,'rgba(220,225,225,0)');g.fillStyle=a;g.fillRect(0,0,w,h);});
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(36),3));
    car.steam=new THREE.Points(geo,new THREE.PointsMaterial({map:cloud,color:'#d9dce0',size:.22,transparent:true,opacity:.4,depthWrite:false}));car.steam.visible=false;car.steam.frustumCulled=false;car.body.add(car.steam);car.steamTime=0;
  }
  return car;
}
export function animateDetailedCar(car,dt,speed,steer,brake,pose,axles=null,yawRate=0) {
  const d=MODEL[car.modelKind];
  if(pose){car.body.position.y=pose.heave;car.body.rotation.set(pose.pitch,0,pose.roll,'YXZ');}
  for(const w of car.wheels){
    // Physics steer is positive right; Three.js yaw is positive left.
    let angle=0;if(w.front&&Math.abs(steer)>.0001){const radius=d.wb/Math.tan(Math.abs(steer));angle=-Math.sign(steer)*Math.atan(d.wb/Math.max(.1,radius-Math.sign(steer)*w.side*d.track/2));}
    w.pivot.rotation.y=angle;
    const corner=axles?.[axles.length===4?(w.front?0:2)+(w.side>0?1:0):(w.front?0:1)];
    const axleSpeed=corner?.vw;
    // Physics owns unsprung wheel-centre travel. Keep the rest position stable
    // across frames; body-mounted wheels must not count body heave twice.
    w.restY ??= w.pivot.position.y;
    const travel=Number.isFinite(corner?.zu)?corner.zu:0;
    let height=w.restY+travel;
    if(w.pivot.parent===car.body){
      // Remove the body's heave AND pitch/roll height at this corner.
      car.body.updateMatrix();const e=car.body.matrix.elements;
      height=(height-e[13]-e[1]*w.pivot.position.x-e[9]*w.pivot.position.z)/e[5];
    }
    w.pivot.position.y=height;
    const v=(Number.isFinite(axleSpeed)?axleSpeed:speed)+(axles?.length===4?0:-yawRate*w.side*d.track/2);
    w.angle=(w.angle-v*dt/w.r)%(Math.PI*2);w.spin.rotation.x=w.angle;
  }
  car.tail.emissiveIntensity=brake?2.8:car.lightsOn?1.6:.55;
  car.updateSignalLights?.(dt,speed);
  if(car.steam){car.steam.visible=(car.steamAmount||0)>.01;car.steam.material.opacity=Math.min(.18,car.steamAmount||0);car.steamTime+=dt;if(car.steam.visible){const a=car.steam.geometry.attributes.position;for(let i=0;i<a.count;i++){const age=(car.steamTime*.55+i/a.count)%1;a.setXYZ(i,Math.sin(i*2.4+age*3)*(.08+age*.17),d.front+.12+age*.72,-d.L/2+.23+age*.12);}a.needsUpdate=true;}}
  car.updateDamage?.(dt);
}
const TRAFFIC_TEMPLATES=new Map();
// Night driving (weather.js): headlamp lenses and DRLs light up, tails glow at their running level. Emissive only.
export function setCarLights(car,on) {
  car.lightsOn=!!on;const M=car.materials;if(!M)return;
  M.head.emissive.set(on?'#fff1da':'#000000');M.head.emissiveIntensity=on?7:0;M.led.emissiveIntensity=on?5:1.5;
}
export function setTrafficLights(on) {for(const t of TRAFFIC_TEMPLATES.values())setCarLights(t,on);}
export function trafficDetailedModel(type,color,rng) {
  const key=type.model+':'+(type.taxi?'taxi':'civil');let template=TRAFFIC_TEMPLATES.get(key);
  if(!template){
    template={spec:{color:'#ffffff',taxi:type.taxi},root:new THREE.Group(),body:new THREE.Group(),wheels:[]};template.root.add(template.body);
    buildDetailedCar(template,type.model,{low:true,plate:'TEMPLATE'});
    template.root.traverse(o=>{if(o.isMesh)o.geometry.userData.shared=true;});
    TRAFFIC_TEMPLATES.set(key,template);
  }
  const root=template.root.clone(true),body=root.children[0];
  const paint=template.paint.clone();paint.color.set(color);const tail=template.tail.clone(),plate=nextRegistration(type.taxi),plateMat=makePlateMaterial(plate);
  root.traverse(o=>{if(o.isMesh){if(o.material===template.paint)o.material=paint;else if(o.material===template.tail)o.material=tail;else if(o.material===template.materials.plate)o.material=plateMat;}});
  const car={root,body,paint,tail,plate,spec:{color,taxi:type.taxi},modelKind:template.modelKind,dims:template.dims,shape:template.shape,seat:template.seat.clone()};
  car.wheels=template.wheels.map(w=>{const pivot=root.getObjectByName(w.pivot.name);return{pivot,spin:pivot.getObjectByName('wheel-spin'),front:w.front,r:w.r,side:w.side,angle:0};});
  damageSystem(car);return car;
}

// Bake decorative pieces by material without baking steering, spinning or mirror transforms.
function compactMeshes(parent,exclude=new Set()) {
  const groups=new Map(),remove=[];parent.updateMatrixWorld(true);const inverse=parent.matrixWorld.clone().invert();
  parent.traverse(o=>{if(!o.isMesh||exclude.has(o)||o.material.transparent)return;for(let p=o;p&&p!==parent;p=p.parent)if(p.userData.mirrorAssembly)return;const key=o.material.uuid;if(!groups.has(key))groups.set(key,{material:o.material,geos:[]});let g=o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));if(g.index)g=g.toNonIndexed();for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);groups.get(key).geos.push(g);remove.push(o);});
  for(const o of remove)o.removeFromParent();
  for(const {material,geos}of groups.values()){const g=mergeGeometries(geos,false);if(g){const o=mesh(parent,g,material);o.name='assembled-'+(material.name||'trim');o.castShadow=true;o.receiveShadow=true;}for(const g of geos)g.dispose();}
}
