// Police-only variants; emissive strobes have no shadow/light cost.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { trafficDetailedModel, damageSystem, sideSkinX, makePlateMaterial, nextRegistration } from './vehicle-models.js';
import { canvasTex } from './util.js';
const mat=(color,roughness=.45,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
function box(p,m,size,pos,r=.025){const o=new THREE.Mesh(new RoundedBoxGeometry(...size,2,Math.min(r,...size.map(n=>n/2))),m);o.position.set(...pos);p.add(o);return o;}
function label(text){const map=canvasTex(Math.max(192,text.length*48),96,(g,w,h)=>{g.fillStyle='#ffffff';g.font='bold 63px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2,w*.94);});return new THREE.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:.5,side:THREE.DoubleSide});}
function plane(p,m,w,h,pos,ry=0){const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);o.position.set(...pos);o.rotation.y=ry;p.add(o);return o;}
function strobes(car){
  const left=new THREE.MeshStandardMaterial({color:'#145ac5',emissive:'#1478ff',emissiveIntensity:0,roughness:.18});
  const right=left.clone();car.strobeMaterials=[left,right];
  car.setStrobe=(on,t=0)=>{const phase=((Number(t)||0)% .64+.64)%.64,side=phase<.32?0:1,p=phase%.32,flash=p<.065||(p>=.105&&p<.17);left.emissiveIntensity=on&&flash&&side===0?9:0;right.emissiveIntensity=on&&flash&&side===1?9:0;};
  return [left,right];
}
function sidePatch(car,m,s,z0,z1,y0,y1){
  const d=car.shape,p=[],uv=[],idx=[],N=24;
  for(let i=0;i<=N;i++)for(let j=0;j<=2;j++){const z=z0+(z1-z0)*i/N,y=y0+(y1-y0)*j/2;p.push(s*(sideSkinX(d,z,y)+(m.transparent?.006:.0025)),y,z);uv.push(s>0?1-i/N:i/N,j/2);}
  for(let i=0;i<N;i++)for(let j=0;j<2;j++){const k=i*3+j;idx.push(k,k+3,k+1,k+1,k+3,k+4);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();car.body.add(new THREE.Mesh(g,m));
}
export function policeModel(type,color,rng,opts={}){
  if(type.moto)return policeBike(type,color,opts);
  const car=trafficDetailedModel(type,color||'#f0f1ed',rng),p=car.body,d=car.shape;
  const blue=mat('#143c75');blue.side=THREE.DoubleSide;const black=mat('#171d25'),silver=mat('#969ea7',.25,.75),lamps=strobes(car);
  for(const s of [-1,1]){
    sidePatch(car,blue,s,-1.04,1.03,.64,.87);
    sidePatch(car,label('ΕΛΛΗΝΙΚΗ ΑΣΤΥΝΟΜΙΑ'),s,-.86,.84,.70,.82);
    sidePatch(car,blue,s,1.70,2.06,.69,.89);sidePatch(car,label('100'),s,1.72,2.04,.72,.86);
    box(p,black,[.13,.065,.25],[s*.45,d.H+.025,.20]);
    box(p,lamps[s<0?0:1],[.48,.095,.22],[s*.30,d.H+.10,.20]);
    box(p,lamps[s<0?0:1],[.11,.045,.032],[s*.32,.55,-d.L/2-.028],.008);
  }
  box(p,silver,[1.12,.035,.27],[0,d.H+.055,.20]);
  plane(p,label('ΑΣΤΥΝΟΜΙΑ'),.80,.095,[0,.80,d.L/2+.031]);
  car.police=true;damageSystem(car);return car;
}
function policeBike(type,color,opts){
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);
  const paint=mat(color||'#eeeeea',.3,.18),blue=mat('#15365e'),black=mat('#171c21'),metal=mat('#a8afb6',.28,.75),rubber=mat('#161819',.92),skin=mat('#bf947b');
  const tail=new THREE.MeshStandardMaterial({color:'#a31922',emissive:'#f52228',emissiveIntensity:.6});
  const plate=nextRegistration(),car={root,body,paint,tail,plate,wheels:[],dims:{L:type.len,W:type.wid,H:1.85},shape:{L:type.len,W:type.wid,H:1.85},spec:{color},modelKind:'police_moto',police:true};
  const lamps=strobes(car),R=.31;
  for(const front of [true,false]){
    const pivot=new THREE.Group(),spin=new THREE.Group();pivot.position.set(0,R,front?-.76:.73);root.add(pivot);pivot.add(spin);
    const tyre=new THREE.Mesh(new THREE.TorusGeometry(.25,.06,10,32),rubber);tyre.rotation.y=Math.PI/2;spin.add(tyre);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.21,.018,6,24),metal);rim.rotation.y=Math.PI/2;spin.add(rim);
    for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const spoke=box(spin,metal,[.04,.40,.025],[0,0,0],.008);spoke.rotation.x=a;}
    for(const s of [-1,1]){const disc=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.015,24),metal);disc.rotation.z=Math.PI/2;disc.position.x=s*.09;spin.add(disc);box(pivot,blue,[.065,.12,.06],[s*.11,.035,.12]);}
    car.wheels.push({pivot,spin,front,r:R,side:0});
  }
  box(body,black,[.30,.30,1.12],[0,.55,.08],.06); // frame and shaft housing
  box(body,metal,[.52,.20,.34],[0,.52,-.20],.07); // opposed twin cylinders
  box(body,paint,[.48,.34,.60],[0,.82,-.20],.10); // tank
  box(body,black,[.39,.11,.68],[0,.89,.34],.05); // joined touring saddle
  box(body,paint,[.66,.50,.37],[0,.94,-.64],.11); // touring nose
  box(body,blue,[.67,.115,.27],[0,.99,-.66]);
  for(const s of [-1,1]){
    box(body,metal,[.055,.54,.055],[s*.10,.51,-.70],.012).rotation.x=-.22;
    box(body,paint,[.25,.35,.49],[s*.31,.64,.58],.065); // panniers
    box(body,blue,[.255,.12,.42],[s*.31,.68,.58]);
    plane(body,label('ΔΙ.ΑΣ.'),.31,.08,[s*.443,.68,.58],s*Math.PI/2);
    box(body,metal,[.07,.065,.38],[s*.30,.33,.68]); // silencers
    box(body,lamps[s<0?0:1],[.12,.07,.04],[s*.235,1.07,-.842],.012);
    box(body,black,[.025,.25,.025],[s*.28,.90,.79],.006);
    box(body,black,[.025,.025,.14],[s*.28,1.015,.84],.006);
    box(body,lamps[s<0?0:1],[.10,.07,.055],[s*.28,1.05,.90],.012);
    box(body,black,[.08,.04,.20],[s*.28,1.14,-.35]);
    box(body,paint,[.16,.08,.065],[s*.36,1.17,-.48]);
  }
  const head=new THREE.MeshStandardMaterial({color:'#e5edf1',emissive:'#dae7f5',emissiveIntensity:1.5});box(body,head,[.35,.11,.025],[0,.90,-.832]);
  const wind=new THREE.MeshPhysicalMaterial({color:'#9fb3c1',transparent:true,opacity:.28,roughness:.1,side:THREE.DoubleSide,depthWrite:false});
  const screen=plane(body,wind,.47,.37,[0,1.29,-.59],Math.PI);screen.rotation.x=.20;screen.name='windscreen-glass';
  box(body,tail,[.24,.07,.04],[0,.83,.99]);plane(body,makePlateMaterial(plate),.23,.09,[0,.65,1.01]);
  // Rider is omitted for parked bikes; uniform, boots and white helmet remain attached on active units.
  if(!opts.parked){
    const limb=(a,b,r,m)=>{const v=new THREE.Vector3(...a),w=new THREE.Vector3(...b),o=new THREE.Mesh(new THREE.CapsuleGeometry(r,v.distanceTo(w),4,8),m);o.position.copy(v).add(w).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),w.sub(v).normalize());body.add(o);};
    limb([0,1.00,.25],[0,1.43,.12],.17,blue);
    for(const s of [-1,1]){limb([s*.18,1.02,.20],[s*.23,.78,-.13],.08,blue);limb([s*.23,.78,-.13],[s*.22,.46,.08],.075,blue);box(body,black,[.14,.11,.28],[s*.23,.41,.01]);limb([s*.17,1.36,.09],[s*.28,1.15,-.20],.065,blue);limb([s*.28,1.15,-.20],[s*.29,1.15,-.40],.05,blue);box(body,black,[.085,.065,.08],[s*.29,1.15,-.40]);}
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.18,20,12),paint);helmet.position.set(0,1.68,.09);body.add(helmet);
    box(body,black,[.30,.105,.10],[0,1.70,-.065],.03); // visor flush to helmet front
  }
  root.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true;}});damageSystem(car);return car;
}
