// Local plastic deformation: a small rest-space lattice is changed only on impacts,
// then skinned on the CPU. No per-frame vertex work; visual meshes/materials are copy-on-write.
import * as THREE from 'three';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,f=0)=>Number.isFinite(v)?v:f;
const ZONES=['front','rear','left','right'];
const debrisPool=new Set(), MAX_DEBRIS=72;
const point=new THREE.Vector3(), delta=new THREE.Vector3();

export class DamageLattice {
  constructor(dims,cheap=false){
    this.d={L:finite(dims.L,4.3),W:finite(dims.W,1.8),H:finite(dims.H,1.5)};
    this.n=cheap?[7,4,13]:[11,6,23];this.values=new Float32Array(this.n[0]*this.n[1]*this.n[2]*3);
  }
  clear(){this.values.fill(0);}
  impact(zone,amount,impact={}){
    if(!ZONES.includes(zone)||!Number.isFinite(amount)||amount<=0)return;
    const d=this.d,side=zone==='left'||zone==='right';
    const fallback={x:side?(zone==='left'?-d.W/2:d.W/2):0,y:.55,z:side?0:zone==='front'?-d.L/2:d.L/2};
    const p=impact.localPoint||fallback,n=impact.localNormal||{x:side?(zone==='left'?1:-1):0,y:0,z:side?0:zone==='front'?1:-1};
    const px=clamp(finite(p.x,fallback.x),-d.W*.6,d.W*.6),py=clamp(finite(p.y,.55),.15,d.H),pz=clamp(finite(p.z,fallback.z),-d.L*.52,d.L*.52);
    let nx=finite(n.x),ny=clamp(finite(n.y),-.25,.25),nz=finite(n.z),length=Math.hypot(nx,ny,nz);
    if(length<.01){nx=side?(zone==='left'?1:-1):0;nz=side?0:zone==='front'?1:-1;length=1;}nx/=length;ny/=length;nz/=length;
    const strength=clamp(amount,0,1),radius=side?.85:1.10;
    const [X,Y,Z]=this.n;
    for(let iz=0;iz<Z;iz++)for(let iy=0;iy<Y;iy++)for(let ix=0;ix<X;ix++){
      const x=(ix/(X-1)-.5)*d.W*1.3,y=iy/(Y-1)*d.H*1.1,z=(iz/(Z-1)-.5)*d.L*1.1;
      const q=((x-px)/(side?.85:radius))**2+((y-py)/.9)**2+((z-pz)/(side?radius:1.05))**2;
      if(q>=1)continue;
      const fall=(1-q)**2;
      // Roof rail, A/B pillars and sill are stiffer than door skins / crash boxes.
      const pillar=side&&y>.65&&(Math.abs(z+d.L*.18)<.19||Math.abs(z-d.L*.08)<.16);
      const resist=pillar?.25:y>d.H*.70?.35:y<.28?.60:1;
      const depth=(side?.34:.64)*strength*fall*resist,k=((iz*Y+iy)*X+ix)*3;
      this.values[k]=clamp(this.values[k]+nx*depth,-.30,.30);
      this.values[k+2]=clamp(this.values[k+2]+nz*depth,-.62,.62);
      // Compressed bonnet/boot rises in a smooth fold, never high-frequency random spikes.
      const inward=zone==='front'?z-pz:pz-z;
      const deck=clamp((y-.48)/.30,0,1)*clamp((d.H*.85-y)/.27,0,1);
      const fold=clamp((inward-.08)/.42,0,1); // mounting face stays low; the deck folds behind it
      const buckle=!side?.65*fold*(1-q)*Math.pow(strength,1.5)*Math.exp(-(((inward-.45)/.60)**2))*Math.exp(-(((x-px)/1.25)**2))*deck:0;
      const wrinkle=!side?.018*strength*strength*fall*Math.sin(inward*18+x*7):0;
      const bulge=!side?Math.sign(x)*.08*strength*fall*clamp((Math.abs(x)-d.W*.24)/.25,0,1):0;
      this.values[k]=clamp(this.values[k]+bulge,-.30,.30);
      this.values[k+1]=clamp(this.values[k+1]+ny*depth+buckle+wrinkle,-.16,.50);
    }
  }
  sample(x,y,z,out){
    const [X,Y,Z]=this.n,d=this.d;
    const u=clamp((x/(d.W*1.3)+.5)*(X-1),0,X-1.000001),v=clamp(y/(d.H*1.1)*(Y-1),0,Y-1.000001),w=clamp((z/(d.L*1.1)+.5)*(Z-1),0,Z-1.000001);
    const a=Math.floor(u),b=Math.floor(v),c=Math.floor(w),fu=u-a,fv=v-b,fw=w-c;out.set(0,0,0);
    for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const weight=(i?fu:1-fu)*(j?fv:1-fv)*(k?fw:1-fw),idx=(((c+k)*Y+b+j)*X+a+i)*3;
      out.x+=this.values[idx]*weight;out.y+=this.values[idx+1]*weight;out.z+=this.values[idx+2]*weight;
    }return out;
  }
}
function partId(o){return o.userData.damagePart||(/^(bumper_[fr]|bonnet|boot|door_|mirror_|light_|glass_)/.test(o.name)?o.name:'');}
function discard(item){item.mesh.removeFromParent();if(item.owned){item.mesh.geometry.dispose();item.mesh.material.dispose();}for(const geometry of item.snapshotGeometries||[])geometry.dispose();debrisPool.delete(item);}
function visibleInTree(node){for(let p=node;p;p=p.parent)if(!p.visible)return false;return true;}
function sceneOf(root){let o=root;while(o.parent)o=o.parent;return o.isScene?o:null;}
function spawnDebris(car,source,normal,glass=false){
  const scene=sceneOf(car.root);if(!scene)return;
  while(debrisPool.size>=MAX_DEBRIS)discard(debrisPool.values().next().value);
  car.root.updateMatrixWorld(true);
  let mesh;const snapshotGeometries=[];
  if(glass){mesh=new THREE.Mesh(new THREE.TetrahedronGeometry(.018),new THREE.MeshStandardMaterial({color:'#9db0b5',metalness:.3,roughness:.22}));new THREE.Box3().setFromObject(source).getCenter(mesh.position);scene.add(mesh);}
  else{
    mesh=new THREE.Group();const visual=source.clone(true);visual.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();snapshotGeometries.push(o.geometry);}});visual.visible=true;mesh.add(visual);scene.add(mesh);
    visual.matrix.copy(source.matrixWorld);visual.matrix.decompose(visual.position,visual.quaternion,visual.scale);
    const center=new THREE.Box3().setFromObject(visual).getCenter(new THREE.Vector3());mesh.position.copy(center);visual.position.sub(center);
  }
  mesh.name='damage-debris';mesh.userData.damageDebris=true;
  const index=car.damageDebris.length,velocity=new THREE.Vector3(normal.x,0,normal.z).applyQuaternion(car.root.quaternion).multiplyScalar(-.65);
  velocity.y=.55+(index%3)*.22;velocity.x+=Math.sin(index*2.4)*.45;velocity.z+=Math.cos(index*2.4)*.45;
  const bounds=new THREE.Box3().setFromObject(mesh),center=bounds.getCenter(new THREE.Vector3());
  // The pivot can be at the car origin; keep full bounds above the road when settling.
  const target=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0).applyQuaternion(car.root.quaternion),Math.sign(normal.z||1)*Math.PI/2);
  const groundNormal=new THREE.Vector3(0,1,0).applyQuaternion(car.root.quaternion);if(groundNormal.y<.8)groundNormal.set(0,1,0);
  const item={mesh,velocity,snapshotGeometries,target:glass?null:target,groundNormal,groundOrigin:car.root.position.clone(),spin:new THREE.Vector3(.35,glass?.6:.10,.2),floor:car.root.position.y+.012,age:0,owned:glass,settled:false,centerOffset:center.sub(mesh.position)};
  car.damageDebris.push(item);debrisPool.add(item);
}
function crackGlass(car){
  if(car.crackedGlass||typeof document==='undefined')return;
  const glass=car.damageParts.find(p=>p.id==='glass_windscreen'||/windscreen/.test(p.id))?.node||car.windscreen;
  if(!glass)return;let source=glass.isMesh?glass:null;glass.traverse(o=>{if(!source&&o.isMesh)source=o;});if(!source)return;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const c=canvas.getContext('2d');
  c.strokeStyle='rgba(235,243,247,.85)';c.lineWidth=1;
  for(let i=0;i<15;i++){const a=i*Math.PI*2/15;c.beginPath();c.moveTo(196,153);for(let j=1;j<=5;j++){const r=j*28;c.lineTo(196+Math.cos(a+Math.sin(i+j)*.07)*r,153+Math.sin(a+Math.cos(i-j)*.1)*r*.65);}c.stroke();}
  for(let ring=1;ring<5;ring++){c.beginPath();for(let i=0;i<=15;i++){const a=i*Math.PI*2/15,r=ring*25*(1+.1*Math.sin(i*2));const x=196+Math.cos(a)*r,y=153+Math.sin(a)*r*.65;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.stroke();}
  const map=new THREE.CanvasTexture(canvas),material=new THREE.MeshBasicMaterial({map,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const overlay=new THREE.Mesh(source.geometry,material);overlay.name='damage-cracks';source.add(overlay);car.crackedGlass=overlay;
}

function crashInternals(car){
  const d=car.dims,ends={},resources=[];
  const dark=new THREE.MeshStandardMaterial({color:'#22282a',roughness:.92}),metal=new THREE.MeshStandardMaterial({color:'#515859',metalness:.5,roughness:.8});resources.push(dark,metal);
  for(const [zone,sign]of [['front',-1],['rear',1]]){
    const g=new THREE.Group();g.name='damage-internal-'+zone;g.visible=false;car.body.add(g);ends[zone]=g;
    const box=(size,pos,mat=dark)=>{const geo=new THREE.BoxGeometry(...size,car.damageCheap?1:6,car.damageCheap?1:3,car.damageCheap?1:4),m=new THREE.Mesh(geo,mat);m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;g.add(m);resources.push(geo);return m;};
    const end=sign*(d.L/2-.38),engine=(car.spec?.engineZone||'front')===zone;
    // Filled structural volume / firewall: cap the hull so missing plastic never reveals the far wheels.
    box([d.W*.84,.36,.60],[0,.42,end-sign*.16]);
    box([d.W*.79,.13,.13],[0,.40,end+sign*.12],metal); // crash beam
    box([d.W*.63,.26,.10],[0,.51,end+sign*.09],metal); // folded radiator or rear bulkhead
    if(engine)box([d.W*.48,.24,.48],[0,.47,end-sign*.37],metal);
    else{
      const geo=new THREE.CylinderGeometry(.31,.28,.12,16),m=new THREE.Mesh(geo,metal);m.position.set(0,.30,end-sign*.34);g.add(m);resources.push(geo); // spare wheel well
      box([d.W*.43,.13,.19],[0,.23,end-sign*.16],metal); // silencer
    }
  }
  return {ends,resources};
}

export function installDamageSystem(car){
  car.damage={front:0,rear:0,left:0,right:0};car.damageMeshes=[];car.damageParts=[];car.damageDebris=[];car.visualCornerDamage=[0,0,0,0];
  const internal=crashInternals(car),hiddenInterior=new Map();
  const lattice=car.damageLattice=new DamageLattice(car.dims,!!car.damageCheap),records=[];
  car.body.updateMatrixWorld(true);const inverse=car.body.matrixWorld.clone().invert();
  car.body.traverse(o=>{
    const id=partId(o);let namedAncestor=false,glassAncestor=false;for(let p=o.parent;p&&p!==car.body;p=p.parent){if(partId(p))namedAncestor=true;if(/^glass/.test(partId(p)||p.name))glassAncestor=true;}
    if(id&&!namedAncestor){const bounds=new THREE.Box3().setFromObject(o);if(bounds.isEmpty())return;const center=bounds.getCenter(new THREE.Vector3()).applyMatrix4(inverse);car.damageParts.push({node:o,id,center,detachable:!/^bumper/.test(id)||bounds.getSize(new THREE.Vector3()).y<.46,damage:0,state:'intact',position:o.position.clone(),rotation:o.rotation.clone(),visible:o.visible,materials:[]});}
    if(glassAncestor||o.userData.damageInterior||!o.isMesh||!o.geometry?.attributes.position||/glass|windscreen/.test(id)||o===car.windscreen)return;
    const toBody=inverse.clone().multiply(o.matrixWorld);o.geometry.computeBoundingBox();const bounds=o.geometry.boundingBox.clone().applyMatrix4(toBody);records.push({o,toBody,toLocal:toBody.clone().invert(),bounds,rest:null});car.damageMeshes.push(o);
  });
  function deform(hitZone,hit){
    const d=car.dims,p=hit?.localPoint||{x:hitZone==='left'?-d.W/2:hitZone==='right'?d.W/2:0,y:.55,z:hitZone==='front'?-d.L/2:hitZone==='rear'?d.L/2:0};
    const area=new THREE.Box3(new THREE.Vector3(p.x-1.3,p.y-1.1,p.z-1.25),new THREE.Vector3(p.x+1.3,p.y+1.1,p.z+1.25));
    for(const r of records){
      if(hitZone&&!r.rest&&!r.bounds.intersectsBox(area))continue;
      const {o,toBody,toLocal}=r;
      if(!r.rest){o.geometry=o.geometry.clone();r.rest=o.geometry.attributes.position.array.slice();}
      const a=o.geometry.attributes.position,rest=r.rest;
      for(let i=0;i<a.count;i++){
        point.set(rest[i*3],rest[i*3+1],rest[i*3+2]).applyMatrix4(toBody);lattice.sample(point.x,point.y,point.z,delta);point.add(delta).applyMatrix4(toLocal);a.setXYZ(i,point.x,point.y,point.z);
      }
      a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();o.geometry.computeBoundingBox();
    }
  }
  function restoreParts(){
    car.visualCornerDamage.fill(0);
    for(const [node,visible]of hiddenInterior)node.visible=visible;hiddenInterior.clear();
    for(const group of Object.values(internal.ends))group.visible=false;
    for(const p of car.damageParts){p.node.visible=p.visible;p.node.position.copy(p.position);p.node.rotation.copy(p.rotation);p.damage=0;p.state='intact';for(const [mesh,original,broken]of p.materials){mesh.material=original;broken.dispose();}p.materials=[];}
    if(car.crackedGlass){car.crackedGlass.material.map.dispose();car.crackedGlass.material.dispose();car.crackedGlass.removeFromParent();car.crackedGlass=null;}
    for(const item of car.damageDebris)discard(item);car.damageDebris=[];
  }
  function parts(zone,amount,impact,silent){
    const d=car.dims,side=zone==='left'||zone==='right',p=impact.localPoint||{x:side?(zone==='left'?-d.W/2:d.W/2):0,y:.55,z:side?0:zone==='front'?-d.L/2:d.L/2};
    if(!side&&car.damage[zone]>.15)internal.ends[zone].visible=true;
    if(side&&car.damage[zone]>.45)car.root.traverse(node=>{if(node.userData.damageInterior&&(node.userData.damageSide===zone||node.userData.damageSide===(zone==='left'?-1:1))){if(!hiddenInterior.has(node))hiddenInterior.set(node,node.visible);node.visible=false;}});
    const n=impact.localNormal||{x:side?(zone==='left'?1:-1):0,y:0,z:side?0:zone==='front'?1:-1};
    if(!silent){for(const w of car.wheels||[]){const index=(w.front?0:2)+(w.side>0?1:0),pos=w.pivot.position;const exposure=Math.exp(-((p.x-pos.x)**2+(p.z-pos.z)**2)/1.7);car.visualCornerDamage[index]=clamp(car.visualCornerDamage[index]+amount*exposure*.22,0,.22);}}
    for(const part of car.damageParts){
      if(!/^(bumper|mirror|light)/.test(part.id))continue;
      const c=part.center,dist=Math.hypot((c.x-p.x)/(side?.8:1.5),(c.z-p.z)/(side?1.2:.8));
      const proximity=clamp(1-dist*.65,0,1);if(proximity<=0)continue;
      part.damage=clamp(part.damage+amount*proximity,0,1);
      if(/^light/.test(part.id)&&part.damage>.20&&part.state==='intact'){
        part.state='broken';part.node.traverse(o=>{if(!o.isMesh||Array.isArray(o.material))return;const original=o.material,broken=original.clone();broken.userData.damageBroken=true;broken.emissive?.set(0);broken.emissiveIntensity=0;broken.color?.multiplyScalar(.28);broken.roughness=.85;o.material=broken;part.materials.push([o,original,broken]);});
        if(!silent&&visibleInTree(part.node))for(let i=0;i<(impact.cheap?2:5);i++)spawnDebris(car,part.node,n,true);
      }
      const bumper=/^bumper/.test(part.id),mirror=/^mirror/.test(part.id);
      if((bumper&&part.detachable&&part.damage>.57||mirror&&part.damage>.28)&&part.state!=='detached'){
        if(!silent&&visibleInTree(part.node))spawnDebris(car,part.node,n);part.state='detached';part.node.visible=false;
      }else if(bumper&&part.detachable&&part.damage>.15&&part.state==='intact')part.state='hanging';
    }
    if((zone==='front'&&(impact.ebs||0)>12)||impact.roll)crackGlass(car);
  }
  car.setDamage=(zone,amount,impact)=>{
    if(!ZONES.includes(zone))return;const value=clamp(finite(Number(amount)),0,1),old=car.damage[zone];if(Math.abs(value-old)<.0001)return;
    if(impact){
      const d=car.dims,side=zone==='left'||zone==='right',p=impact.localPoint,n=impact.localNormal;
      const fallback={x:side?(zone==='left'?-d.W/2:d.W/2):0,y:.55,z:side?0:zone==='front'?-d.L/2:d.L/2};
      impact={...impact,ebs:finite(impact.ebs),localPoint:p?{x:finite(p.x,fallback.x),y:finite(p.y,.55),z:finite(p.z,fallback.z)}:fallback,
        localNormal:n?{x:finite(n.x),y:finite(n.y),z:finite(n.z)}:{x:side?(zone==='left'?1:-1):0,y:0,z:side?0:zone==='front'?1:-1}};
    }
    car.damage[zone]=value;
    // Replays/network packets retain the established four-zone format. Rebuild deterministically
    // on rewind/repair, and never create transient debris while scrubbing snapshots.
    if(value<old){lattice.clear();restoreParts();for(const z of ZONES)if(car.damage[z]){lattice.impact(z,car.damage[z]);parts(z,car.damage[z],{},true);}}
    else{const hit=impact||{};lattice.impact(zone,value-old,hit);}
    deform(value<old?null:zone,impact);
    if(value>=old)parts(zone,value-old,impact||{},!impact);
  };
  car.updateDamage=(dt)=>{
    dt=clamp(finite(dt),0,.1);
    for(const part of car.damageParts){for(const [, ,material]of part.materials){material.emissiveIntensity=0;material.emissive?.setHex(0);}if(part.state==='hanging'){part.node.position.y=part.position.y-.025-.035*part.damage;part.node.rotation.z=part.rotation.z+.018*Math.sin((car.damageTime||0)*7);}}
    car.damageTime=(car.damageTime||0)+dt;
    if(Math.abs(car.root.rotation.z)+Math.abs(car.body.rotation.z)>1.15&&Math.max(...Object.values(car.damage))>.2)crackGlass(car);
    for(let i=0;i<(car.wheels||[]).length;i++){const w=car.wheels[i],index=(w.front?0:2)+(w.side>0?1:0),bend=car.wheelCamber?.[index]??((index%2?-1:1)*car.visualCornerDamage[index]);if(w.pivot)w.pivot.rotation.z=bend+Math.sin((w.angle||0)*2)*Math.abs(bend)*.12;}
    for(let i=car.damageDebris.length-1;i>=0;i--){
      const item=car.damageDebris[i];if(!debrisPool.has(item)){car.damageDebris.splice(i,1);continue;}
      item.age+=dt;if(item.age>14){discard(item);car.damageDebris.splice(i,1);continue;}
      if(item.settled)continue;
      item.velocity.y-=9.81*dt;item.mesh.position.addScaledVector(item.velocity,dt);if(item.target)item.mesh.quaternion.slerp(item.target,1-Math.exp(-dt*5));else{item.mesh.rotation.x+=item.spin.x*dt;item.mesh.rotation.z+=item.spin.z*dt;}item.mesh.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(item.mesh),n=item.groundNormal,o=item.groundOrigin;
      const roadPlane=item.floor-(n.x*(item.mesh.position.x-o.x)+n.z*(item.mesh.position.z-o.z))/n.y;
      const floor=car.damageGround?.(item.mesh.position.x,item.mesh.position.z)??roadPlane;
      if(bounds.min.y<floor){item.mesh.position.y+=floor-bounds.min.y;item.velocity.y=Math.abs(item.velocity.y)>.6?-item.velocity.y*.18:0;item.velocity.x*=.55;item.velocity.z*=.55;item.spin.multiplyScalar(.4);if(Math.hypot(item.velocity.x,item.velocity.y,item.velocity.z)<.1)item.settled=true;}
    }
  };
  car.disposeDamage=()=>{restoreParts();for(const r of records)if(r.rest)r.o.geometry.dispose();for(const g of Object.values(internal.ends))g.removeFromParent();for(const r of internal.resources)r.dispose();};
  return car;
}
