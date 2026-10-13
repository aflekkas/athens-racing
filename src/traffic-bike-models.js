// Reference-proportioned Athens two-wheel fleet. Metres, +Y up, -Z forward.
// Honda: hondanews.eu/eu/en/motorcycles/media/pressreleases/34935/sh150i-press-pack
// Piaggio: wlassets.piaggio.com/wlassets/piaggio/master/tech_spec/Beverly/2021/EN_NewBeverly_300/original/EN_NewBeverly_300.pdf
// Yamaha: cdn2.yamaha-motor.eu/prod/product-assets/2019/MT09TR/Factsheets/2019-MT09TR_bg-BG.pdf
// BMW: bmw-motorrad.ie/en/models/tour/r1250rt/technicaldata.html
import * as THREE from 'three';
import { makePlateMaterial, nextRegistration } from './vehicle-models.js';
export const BIKE_SPECS={
 delivery:{name:'Honda SH150i',L:2.030,W:.740,H:1.150,wb:1.340,seat:.799,r:.293},
 scooter:{name:'Piaggio Beverly 300',L:2.125,W:.800,H:1.260,wb:1.540,seat:.812,r:.280},
 moto:{name:'Yamaha Tracer 900',L:2.160,W:.850,H:1.375,wb:1.500,seat:.850,r:.300},
 police_moto:{name:'BMW R 1250 RT',L:2.222,W:.990,H:1.460,wb:1.485,seat:.805,r:.300},
};
const material=(color,roughness=.45,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
export function buildBikeModel(type,color,rng,opts={}){
 const id=type.id||'moto',tour=id==='police_moto',scoot=id==='delivery'||id==='scooter',delivery=id==='delivery',d=BIKE_SPECS[id]||BIKE_SPECS.moto,low=!!opts.low;
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);body.name=d.name;
 const paint=material(color||'#a8adb0',.28,.25),black=material('#171b20',.72),silver=material('#a1abb1',.25,.75),rubber=material('#16191b',.94),seat=material(id==='scooter'?'#342b28':'#202126',.92),engine=material('#454b50',.55,.65),uniform=material(tour?'#182e50':delivery?'#ba3436':'#3b4652',.9);
 const tail=new THREE.MeshStandardMaterial({color:'#b32129',emissive:'#ff1625',emissiveIntensity:.5}),head=new THREE.MeshStandardMaterial({color:'#eaf4f9',emissive:'#e1f1ff',emissiveIntensity:1.1});
 const glass=new THREE.MeshStandardMaterial({color:'#adc3cf',transparent:true,opacity:.34,side:THREE.DoubleSide,roughness:.14,depthWrite:false});
 const materials={paint,black,silver,rubber,seat,engine,uniform,tail,head,glass};
 const add=(g,m,p=[0,0,0],parent=body,name='')=>{const o=new THREE.Mesh(g,m);o.position.set(...p);parent.add(o);o.name=name;return o;};
 const box=(m,size,p,parent=body,name='')=>add(new THREE.BoxGeometry(...size),m,p,parent,name);
 const beam=(m,a,b,r=.025,parent=body)=>{const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b);const o=add(new THREE.CylinderGeometry(r,r,av.distanceTo(bv),low?3:8),m, [0,0,0],parent);o.position.copy(av).add(bv).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),bv.sub(av).normalize());return o;};
 // Cross-section loft: independent widths/heights along the body form sculpted fairings.
 const shell=(m,rings,parent=body,name='')=>{const n=low?4:12,p=[],idx=[];for(const [z,y,w,h]of rings)for(let j=0;j<n;j++){const a=j/n*Math.PI*2;p.push(Math.cos(a)*w,y+Math.sin(a)*h,z);}for(let i=0;i<rings.length-1;i++)for(let j=0;j<n;j++){const a=i*n+j,b=i*n+(j+1)%n,c=a+n,e=b+n;idx.push(a,b,c,b,e,c);}for(let j=1;j<n-1;j++){idx.push(0,j+1,j);const k=(rings.length-1)*n;idx.push(k,k+j,k+j+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();return add(g,m,[0,0,0],parent,name);};
 const mark=(o,n)=>{o.userData.damagePart=n;return o;};
 const wheels=[];
 for(const front of [true,false]){
  const R=!front&&id==='scooter'?.276:d.r, pivot=new THREE.Group(),spin=new THREE.Group();pivot.name=front?'front-steering-pivot':'rear-wheel-pivot';spin.name='wheel-spin';pivot.position.set(0,R,(front?-1:1)*d.wb/2);root.add(pivot);pivot.add(spin);
  const tyre=add(new THREE.TorusGeometry(R-.044,.044,low?4:8,low?10:28),rubber,[0,0,0],spin);tyre.rotation.y=Math.PI/2;tyre.scale.z=front?1:1.4;
  if(!low){const rim=add(new THREE.TorusGeometry(R-.077,.016,5,24),silver,[0,0,0],spin);rim.rotation.y=Math.PI/2;for(let k=0;k<5;k++){const a=k*Math.PI*2/5;beam(silver,[0,0,0],[0,Math.cos(a)*(R-.08),Math.sin(a)*(R-.08)],.015,spin);}}
  const disc=add(new THREE.CylinderGeometry(R*.49,R*.49,.012,low?8:20),silver,[-.07,0,0],spin);disc.rotation.z=Math.PI/2;
  const caliper=box(engine,[.055,.09,.065],[-.085,.055,.115],pivot);wheels.push({pivot,spin,front,r:R,side:0,caliper,angle:0});
 }
 const f=wheels[0].pivot;
 for(const s of [-1,1])beam(silver,[s*.085,0,0],[s*.085,.46,.135],.025,f);
 shell(paint,[[-.25,.14,.035,.01],[-.13,.30,.095,.025],[.10,.30,.10,.026],[.23,.17,.05,.018]],f,'front-fender');
 beam(engine,[-.09,.4,.12],[-.09,d.r,d.wb/2],.042);beam(silver,[.13,d.r,d.wb/2],[.15,.70,.35],.025);
 if(scoot){
  shell(paint,[[-.45,.30,.18,.06],[-.22,.29,.21,.06],[.12,.34,.23,.10],[.36,.57,.235,.15],[.72,.68,.18,.13],[.94,.69,.06,.07]]);
  // SH has a genuinely open, flat step-through floor; Beverly's raised tunnel is narrower.
  box(black,[.36,.045,.44],[0,.355,-.18]);
  shell(paint,[[-.77,.65,.08,.12],[-.64,.72,.20,.25],[-.51,.64,.23,.29],[-.40,.59,.16,.25]],body,'leg-shield');
  shell(black,[[-.405,.62,.15,.22],[-.37,.61,.14,.21]]);
  shell(paint,[[-.72,1.015,.05,.055],[-.63,1.045,.20,.095],[-.52,1.04,.17,.09],[-.46,1.025,.07,.04]],f.parent,'handlebar-cowl');
  shell(seat,[[.02,d.seat-.05,.11,.03],[.18,d.seat-.025,.22,.045],[.54,d.seat+.018,.22,.046],[.80,d.seat+.04,.12,.032]]);
  mark(box(head,[delivery?.20:.24,.105,.025],[0,1.058,-.713]),'light_fl');
  shell(engine,[[.13,.31,.10,.07],[.65,.31,.13,.095],[.78,.34,.075,.06]]);
 }else{
  shell(engine,[[-.29,.48,.15,.18],[.05,.45,.21,.19],[.24,.46,.16,.14]],body,'engine-block');
  shell(paint,[[-.55,.84,.10,.10],[-.37,.87,.24,.16],[-.12,.86,.24,.17],[.14,.79,.13,.08]],body,'fuel-tank');
  shell(seat,[[.06,d.seat-.025,.10,.025],[.23,d.seat-.01,.19,.045],[.52,d.seat+.05,.18,.04],[.83,d.seat+.10,.08,.025]]);
  shell(paint,[[.33,.77,.17,.065],[.68,.85,.19,.05],[.94,.86,.055,.035]],body,'tail-fairing');
  shell(paint,tour?[[-.90,.91,.13,.12],[-.76,.93,.34,.21],[-.56,.89,.34,.24],[-.35,.72,.19,.25]]:[[-.89,.98,.035,.045],[-.72,1.00,.23,.115],[-.48,.94,.24,.14],[-.25,.86,.16,.065]],body,'nose-fairing');
  for(const s of [-1,1]){mark(box(head,[tour?.20:.135,.075,.035],[s*(tour?.14:.11),.983,-.846]),s<0?'light_fl':'light_fr');beam(engine,[s*.15,.75,-.35],[s*.13,.47,.20],.03);beam(engine,[s*.13,.47,.2],[s*.12,.75,.48],.025);}
  if(!low)for(let i=0;i<3;i++)beam(silver,[(i-1)*.10,.46,-.28],[(i-1)*.08,.21,.05],.022);
  if(tour){for(const s of [-1,1]){box(engine,[.23,.19,.26],[s*.27,.47,-.17]);shell(paint,[[.25,.61,.13,.11],[.38,.61,.15,.20],[.76,.64,.15,.20],[.94,.66,.10,.12]]).position.x=s*.32;}}
  const wind=add(new THREE.PlaneGeometry(tour?.48:.32,tour?.43:.34),glass,[0,tour?1.25:1.205,-.67],body,'windscreen-glass');wind.rotation.set(-.27,Math.PI,0);mark(wind,'glass');
 }
 const barY=scoot?1.04:1.065,barZ=scoot?-.55:-.36;
 beam(silver,[-d.W*.36,barY,barZ],[d.W*.36,barY,barZ],.02);
 for(const s of [-1,1]){
  box(black,[.105,.04,.055],[s*d.W*.36,barY,barZ]);
  if(!low)beam(silver,[s*d.W*.32,barY,barZ],[s*d.W*.43,barY+.18,barZ-.10],.009);
  const mir=mark(box(black,[.125,.075,.045],[s*(d.W/2-.065),barY+.21,barZ-.11]),s<0?'mirror_l':'mirror_r');
  if(!low)box(silver,[.105,.055,.005],[0,0,.025],mir);
  box(black,[.12,.025,.17],[s*.20,.38,.12]);
 }
 const exhaust=add(new THREE.CylinderGeometry(.055,.067,.43,low?6:12),silver,[.22,.32,.49]);exhaust.rotation.x=Math.PI/2;
 if(!low){const cap=add(new THREE.CylinderGeometry(.037,.037,.012,10),black,[.22,.32,.71]);cap.rotation.x=Math.PI/2;box(black,[.10,.035,.36],[.235,.369,.49]);}
 const rearZ=d.L/2-.027;mark(box(tail,[.23,.07,.04],[0,scoot?.73:.85,rearZ-.08]),'light_rl');box(black,[.16,.22,.03],[0,.57,rearZ]);
 const plate=nextRegistration(),plateMat=materials.plate=makePlateMaterial(plate);add(new THREE.PlaneGeometry(.22,.105),plateMat,[0,.58,rearZ+.017],body,'registration-rear');
 if(delivery){box(silver,[.40,.025,.43],[0,.87,.65]);box(material('#b92626',.75),[.49,.44,.45],[0,1.11,.68],body,'insulated-delivery-box');box(black,[.495,.025,.455],[0,1.305,.68]);if(!low){for(const s of [-1,1])box(silver,[.007,.035,.33],[s*.247,1.08,.68]);box(silver,[.18,.035,.01],[0,1.08,.91]);}}
 if(!opts.parked){
  const rider=new THREE.Group();rider.name='attached-rider';body.add(rider);const sy=d.seat;
  beam(uniform,[0,sy+.13,.25],[0,sy+.48,.10],.145,rider);
  for(const s of [-1,1]){beam(uniform,[s*.13,sy+.10,.24],[s*.21,sy-.13,-.04],.065,rider);beam(black,[s*.21,sy-.13,-.04],[s*.20,.43,.13],.055,rider);box(black,[.13,.10,.23],[s*.20,.415,.065],rider);beam(uniform,[s*.13,sy+.42,.10],[s*.23,sy+.22,-.17],.055,rider);beam(uniform,[s*.23,sy+.22,-.17],[s*d.W*.36,barY,barZ],.045,rider);box(black,[.075,.06,.07],[s*d.W*.36,barY,barZ],rider);}
  add(new THREE.SphereGeometry(.158,low?6:16,low?4:10),tour?paint:black,[0,sy+.68,.05],rider,'helmet');box(black,[.25,.085,.075],[0,sy+.70,-.092],rider,'helmet-visor');
 }
 root.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true;}});
 const shape={...d,axleF:-d.wb/2,axleR:d.wb/2,wheelR:d.r};
 return {root,body,paint,tail,wheels,plate,materials,dims:{L:d.L,W:d.W,H:d.H},shape,modelKind:id,spec:{color:color||'#a8adb0',model:d.name},police:tour};
}
