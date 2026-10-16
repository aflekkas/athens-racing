import * as THREE from 'three';
// Native fleet silhouettes share authored dimensions and wheel pivots. The
// close body is untouched; these planes are only used beyond 18/65 metres.
export function installFleetLOD(car){
 const d=car.dims,m=car.materials,s=car.shape,body=car.body;
 const high=new THREE.Group();high.name='fleet-close-detail';for(const o of [...body.children])high.add(o);
 const far=new THREE.Group();far.name='fleet-distance-shell';
 const box=(parent,mat,w,h,l,x,y,z,name)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),mat);o.position.set(x,y,z);o.name=name;parent.add(o);return o;};
 const black=m.black||m.rubber,metal=m.alloy||m.silver||m.chrome||m.paint;
 const bike=!!car.spec.twoWheeler;
 if(bike){
  box(far,m.paint,d.W*.45,.28,d.L*.52,0,.62,.02,'bike-body');
  box(far,m.seat||black,.30,.08,.55,0,s.seat||.8,.36,'bike-seat');
  const rider=new THREE.Group();rider.name='attached-rider';far.add(rider);
  box(rider,m.uniform||black,.30,.44,.19,0,(s.seat||.8)+.27,.17,'rider-torso');
  box(rider,black,.25,.25,.25,0,(s.seat||.8)+.63,.05,'rider-helmet');
  for(const side of [-1,1])box(rider,black,.11,.37,.16,side*.18,(s.seat||.8)-.08,.11,'rider-leg');
 }else if(car.spec.nativeFleet==='bus'){
  box(far,m.paint,d.W,d.H-.35,d.L,0,(d.H+.35)/2,0,'bus-body');
  for(const side of [-1,1])box(far,m.glass,.008,1.2,d.L*.96,side*(d.W/2+.005),2.05,0,'bus-side-glass');
  box(far,m.glass,d.W*.90,1.4,.008,0,2.1,-d.L/2-.005,'bus-windscreen');
 }else if(car.spec.nativeFleet==='truck'){
  box(far,m.paint,d.W,d.H-.7,d.L*.65,0,(d.H+.7)/2,d.L*.15,'truck-box');
  box(far,m.paint,d.W*.94,1.7,d.L*.28,0,1.15,-d.L*.35,'truck-cab');
  box(far,m.glass,d.W*.85,.65,.01,0,1.65,-d.L*.49,'truck-windscreen');
 }else{
  const belt=s.belt||1.15,cowl=s.cowl??-d.L*.35,back=s.back??d.L*.42,header=s.header??-d.L*.28,roof=s.roofBack??d.L*.35;
  box(far,m.paint,d.W,belt-.2,d.L,0,(belt+.2)/2,0,'fleet-belt');
  const positions=[[-d.W*.43,belt,cowl],[d.W*.43,belt,cowl],[-d.W*.34,d.H,header],[d.W*.34,d.H,header],[-d.W*.43,belt,back],[d.W*.43,belt,back],[-d.W*.34,d.H,roof],[d.W*.34,d.H,roof]];
  const panel=(indices,mat,name)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>positions[i]),3));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();const o=new THREE.Mesh(g,mat);o.name=name;far.add(o);};
  panel([0,1,3,2],m.glass,'windscreen');panel([4,6,7,5],m.glass,'rear-glass');panel([0,2,6,4],m.glass,'left-glass');panel([1,5,7,3],m.glass,'right-glass');panel([2,3,7,6],m.paint,'roof');
 }
 for(const side of [-1,1])for(const end of [-1,1])box(far,end<0?m.head||metal:m.tail,d.W*.20,.09,.012,side*d.W*.32,bike?.8:.68,end*d.L*.501,'distance-lamp');
 if(car.police){
  for(const side of [-1,1])box(far,car.strobeMaterials?.[side<0?0:1]||m.head,.42,.085,.20,side*.25,d.H+.09,.15,'police-lightbar');
 }
 const mid=far.clone(true);mid.name='fleet-road-detail';
 const lod=new THREE.LOD();lod.addLevel(high,0);lod.addLevel(mid,18,.08);lod.addLevel(far,65,.12);body.add(lod);car.visualLOD=lod;
 for(const w of car.wheels){const near=new THREE.Group();for(const o of [...w.spin.children])near.add(o);const low=new THREE.Group();const tyre=new THREE.Mesh(new THREE.CylinderGeometry(w.r,w.r,.18,4),m.rubber||black);tyre.rotation.z=Math.PI/2;low.add(tyre);const wl=new THREE.LOD();wl.addLevel(near,0);wl.addLevel(low,18,.08);w.spin.add(wl);}
}
