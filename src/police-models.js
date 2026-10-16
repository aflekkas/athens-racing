// Police-only variants; emissive strobes have no shadow/light cost.
import * as THREE from './vehicle-primitives.js';
import { damageSystem } from './vehicle-models.js';
import { buildPassengerModel, passengerSideX } from './traffic-passenger-models.js';
import { buildBikeModel } from './traffic-bike-models.js';
import { canvasTex } from './util.js';
const mat=(color,roughness=.45,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
function box(p,m,size,pos,r=.025){const o=new THREE.Mesh(new THREE.BoxGeometry(...size),m);o.position.set(...pos);p.add(o);return o;}
function label(text){const map=canvasTex(Math.max(192,text.length*48),96,(g,w,h)=>{g.fillStyle='#ffffff';g.font='bold 63px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2,w*.94);});return new THREE.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:.5,side:THREE.DoubleSide});}
function plane(p,m,w,h,pos,ry=0){const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);o.position.set(...pos);o.rotation.y=ry;p.add(o);return o;}
function strobes(car){
  const left=new THREE.MeshStandardMaterial({color:'#145ac5',emissive:'#1478ff',emissiveIntensity:0,roughness:.18});
  left.userData.fleetLivery=true;const right=left.clone();car.strobeMaterials=[left,right];
  car.setStrobe=(on,t=0)=>{const phase=((Number(t)||0)% .64+.64)%.64,side=phase<.32?0:1,p=phase%.32,flash=p<.065||(p>=.105&&p<.17);left.emissiveIntensity=on&&flash&&side===0?9:0;right.emissiveIntensity=on&&flash&&side===1?9:0;};
  return [left,right];
}
function sidePatch(car,m,s,z0,z1,y0,y1){
  const d=car.shape,p=[],uv=[],idx=[],N=car.low?2:6,M=1;
  // Fit the actual triangulated skin: evaluating its smooth design curve can
  // put a decal below the coarser panel between body stations.
  car.body.updateMatrixWorld(true);const panels=[];
  car.body.traverse(o=>{if(o.isMesh&&o.name==='painted-side')panels.push(o);});
  const ray=new THREE.Raycaster(),direction=new THREE.Vector3(-s,0,0);
  for(let i=0;i<=N;i++)for(let j=0;j<=M;j++){
    const z=z0+(z1-z0)*i/N,y=y0+(y1-y0)*j/M;
    ray.set(new THREE.Vector3(s*2,y,z),direction);
    const hit=ray.intersectObjects(panels,false)[0];
    const x=hit?Math.abs(hit.point.x):passengerSideX(d,z,y);
    p.push(s*(x+(m.transparent?.006:.003)),y,z);uv.push(s>0?1-i/N:i/N,j/M);
  }
  for(let i=0;i<N;i++)for(let j=0;j<M;j++){const k=i*(M+1)+j;idx.push(k,k+M+1,k+1,k+1,k+M+1,k+M+2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();car.body.add(new THREE.Mesh(g,m));
}
export function buildPoliceModel(type,color,rng,opts={}){
  if(type.moto)return policeBike(type,color,rng,opts);
  const car=buildPassengerModel({...type,id:'taxi',taxi:false},color||'#f0f1ed',rng,opts),p=car.body,d=car.shape;
  car.low=!!opts.low;
  const blue=mat('#143c75');blue.side=THREE.DoubleSide;const black=mat('#171d25'),silver=mat('#969ea7',.25,.75),lamps=strobes(car);
  for(const s of [-1,1]){
    sidePatch(car,blue,s,-1.04,1.03,.64,.87);
    sidePatch(car,label('ΕΛΛΗΝΙΚΗ ΑΣΤΥΝΟΜΙΑ'),s,-.86,.84,.70,.82);
    sidePatch(car,blue,s,1.58,1.94,.69,.89);sidePatch(car,label('100'),s,1.60,1.92,.72,.86);
    box(p,black,[.13,.065,.25],[s*.45,d.H+.025,.20]);
    box(p,lamps[s<0?0:1],[.48,.095,.22],[s*.30,d.H+.10,.20]);
    box(p,lamps[s<0?0:1],[.11,.045,.032],[s*.32,.55,-d.L/2-.028],.008);
  }
  box(p,silver,[1.12,.035,.27],[0,d.H+.055,.20]);
  plane(p,label('ΑΣΤΥΝΟΜΙΑ'),.80,.095,[0,.80,d.L/2+.031]);
  car.body.traverse(o=>{if(o.isMesh&&(o.material===blue||o.material.map))o.material.userData.fleetLivery=true;});car.police=true;return car;
}

function policeBike(type,color,rng,opts){
 const car=buildBikeModel({...type,id:'police_moto'},color||'#eeeeea',rng,opts),p=car.body;
 const lamps=strobes(car),blue=mat('#143c75'),black=mat('#151c23'),silver=mat('#929da8',.3,.65);
 for(const s of [-1,1]){
  box(p,blue,[.012,.115,.43],[s*.473,.68,.61]);
  plane(p,label('ΕΛ.ΑΣ.'),.30,.065,[s*.483,.69,.61],s*Math.PI/2);
  box(p,black,[.14,.03,.16],[s*.27,1.03,-.70]);
  box(p,lamps[s<0?0:1],[.11,.075,.065],[s*.27,1.08,-.765]);
  box(p,silver,[.025,.31,.025],[s*.29,.95,.76]);
  box(p,lamps[s<0?0:1],[.105,.075,.065],[s*.29,1.14,.76]);
  plane(p,label('ΑΣΤΥΝΟΜΙΑ'),.34,.052,[s*.345,.96,-.57],s*Math.PI/2);
 }
 car.modelKind='police_moto';car.police=true;return car;
}
// Standalone API retains damage attachment; central traffic cache calls the raw builder.
export function policeModel(type,color,rng,opts={}){const car=buildPoliceModel(type,color,rng,opts);damageSystem(car);return car;}
