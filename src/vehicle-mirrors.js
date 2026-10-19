// Surface-seated mirrors. Work in body-local metres and sample actual triangles,
// including the coarse LOD shell: nominal catalogue width is not a mounting point.
import * as THREE from './vehicle-primitives.js';
const V=()=>new THREE.Vector3();
export function nearestSurface(point,meshes,space){
  if(!space?.updateWorldMatrix)return null;
  space.updateWorldMatrix(true,true);const inverse=space.matrixWorld.clone().invert(),tri=new THREE.Triangle(),q=V();let best=null;
  for(const mesh of meshes||[]){
    if(!mesh?.geometry?.attributes?.position)continue;
    const a=mesh.geometry.attributes.position,index=mesh.geometry.index,m=inverse.clone().multiply(mesh.matrixWorld);
    for(let i=0;i<(index?.count||a.count);i+=3){
      for(const [j,v]of [[0,tri.a],[1,tri.b],[2,tri.c]])v.fromBufferAttribute(a,index?index.getX(i+j):i+j).applyMatrix4(m);
      tri.closestPointToPoint(point,q);const distance=q.distanceTo(point);
      if(!best||distance<best.distance)best={point:q.clone(),distance,mesh};
    }
  }return best;
}
function inMirror(o){for(let p=o;p;p=p.parent)if(p.userData.mirrorAssembly||/^mirror_[lr]$/.test(p.name))return true;return false;}
export function mirrorSurfaces(car,scope=car.body){const out=[];scope.traverse(o=>{if(o.isMesh&&!inMirror(o)&&!o.userData.mirrorArm&&(o.material===car.paint||o.userData.mirrorSupport))out.push(o);});return out;}
function armGeometry(a,b,r){const g=new THREE.CylinderGeometry(r,r,a.distanceTo(b),6,4);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());return g;}
// Called after part grouping, before compaction. Replace the disconnected offset
// blocks with one housing/face/stalk assembly whose root intersects real metal.
export function seatMirrors(car,scope=car.body,{bike=false}={}){
  scope.updateWorldMatrix(true,true);const groups=[],empty=[];
  scope.traverse(o=>{if(o.userData.mirrorAssembly&&!o.children.length)empty.push(o);});for(const o of empty)o.removeFromParent();
  scope.traverse(o=>{if(/^mirror_[lr]$/.test(o.name||o.userData.damagePart)&&!o.userData.mirrorAssembly){o.name=o.name||o.userData.damagePart;groups.push(o);}});
  const supports=mirrorSurfaces(car,scope),low=scope!==car.body;
  for(let group of groups){
    if(new THREE.Box3().setFromObject(group).isEmpty()){group.removeFromParent();continue;}
    const side=group.name.endsWith('l')?-1:1,inv=scope.matrixWorld.clone().invert();
    let housing;group.traverse(o=>{if(o.isMesh&&/housing/.test(o.name))housing=o;});
    const face=low?group.getObjectByName('mirror-face'):(side<0?car.mirrorL:car.mirrorR);
    const bounds=new THREE.Box3().setFromObject(housing||group),center=bounds.getCenter(V()).applyMatrix4(inv);
    if(face&&scope===car.body){new THREE.Box3().setFromObject(face).getCenter(center).applyMatrix4(inv);if(!face.name)center.z-=.055;}
    if(car.spec?.id==='gtv')center.z=car.shape.cowl-.12;
    if(car.spec?.mass&&car.spec.id!=='gtv'){
      // Door-corner mounting, independent of the cockpit camera's field of view.
      center.x=side*(car.dims.W/2+.055);center.y=car.shape.belt+.10-(car.shape.belt>=1?.04:0);// tall SUV sills: straddle the beltline instead of floating in the glass
      center.z=car.shape.cowl+.10;
    }
    const size=bounds.getSize(V());const classic=car.spec?.id==='gtv',modern=!!car.spec?.mass&&!classic,z4=car.spec?.id==='z4';
    // Commercial mirrors retain their tall bus/truck envelope.
    const width=classic?.126:bike?.125:car.spec?.mass?(z4?.210:car.shape.open?.185:.20):Math.min(.245,Math.max(.18,size.x)),height=classic?.126:bike?.075:z4?.135:Math.min(.48,Math.max(.105,size.y)),depth=bike?.045:z4?.115:.13;
    if(group.isMesh){const old=group,parent=old.parent;group=new THREE.Group();group.name=old.name;parent.add(group);old.removeFromParent();}
    group.clear();group.position.set(0,0,0);group.rotation.set(0,0,0);group.scale.set(1,1,1);
    // Builders put groups directly under scope; attach also supports nested player parts.
    scope.attach(group);group.position.set(0,0,0);group.quaternion.identity();group.scale.set(1,1,1);
    group.userData.damagePart=group.name;group.userData.mirrorAssembly=true;
    const desired=center.clone();desired.x=side*(bike?car.dims.W*.32:car.dims.W/2-.055);desired.y-=bike?.21:Math.min(.12,height*.7);desired.z+=bike?.11:0;if(modern)desired.z=car.shape.cowl+(car.shape.mirrorSetback??(car.modelKind==='huracan'?.28:.08));
    const hit=nearestSurface(desired,supports,scope);if(!hit)throw new Error('No body surface for '+group.name);
    // Position the housing from actual door metal, so narrow upper bodies and
    // coarse LOD shells cannot produce a long bridge from nominal car width.
    // The Huracan's raked A-pillar needs the foot aft of the sail and a raised stalk.
    if(modern)center.copy(hit.point).add(new THREE.Vector3(side*(car.modelKind==='huracan'?.12:.125),car.modelKind==='huracan'?.075:.085,car.modelKind==='huracan'?.025:.035));
    const commercial=group.userData.commercialMirror;
    const shell=new THREE.Mesh(commercial?new THREE.BoxGeometry(2,2,2):classic?new THREE.SphereGeometry(1,12,8):new THREE.SphereGeometry(1,low?6:modern?16:10,low?4:modern?10:6),classic?car.materials.chrome:bike||commercial?car.materials.black:car.paint);
    const vertices=shell.geometry.attributes.position;for(let i=0;i<vertices.count;i++){const x=vertices.getX(i),y=vertices.getY(i);vertices.setZ(i,commercial?vertices.getZ(i):Math.min(0,vertices.getZ(i)));if(modern){vertices.setY(i,y*(.88+.12*side*x));}}shell.geometry.computeVertexNormals();
    const orientation=new THREE.Quaternion();if(car.spec?.mass)orientation.setFromUnitVectors(new THREE.Vector3(0,0,1),car.seat.clone().sub(center).normalize());
    shell.quaternion.copy(orientation);
    shell.name='mirror-housing';shell.scale.set(width/2,height/2,depth/2);shell.position.copy(center);group.add(shell);
    const glass=face||new THREE.Mesh(new THREE.CircleGeometry(1,12),car.materials.chrome||car.materials.silver||car.materials.alloy||car.paint);
    glass.removeFromParent();glass.geometry=commercial?new THREE.PlaneGeometry(2,2):new THREE.CircleGeometry(1,modern&&!low?32:16);if(modern){const a=glass.geometry.attributes.position;for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i);a.setY(i,y*(.88+.12*side*x));}}glass.scale.set(width*(z4?.43:.41),height*(z4?.45:.37),1);glass.position.copy(center);glass.position.add(new THREE.Vector3(0,0,commercial?depth/2+.002:.002).applyQuaternion(orientation));glass.quaternion.copy(orientation);glass.name='mirror-face';group.add(glass);
    if(scope===car.body&&car.spec?.mass)car[side<0?'mirrorL':'mirrorR']=glass;
    const tip=center.clone().add(new THREE.Vector3(-side*width*.28,-height*.2,-depth*.25).applyQuaternion(orientation));
    const stalkRadius=bike||classic?.009:car.modelKind==='huracan'?.026:modern?.026:.019;
    // A dog-leg arm: door metal -> an elbow just below and behind the housing -> up into the housing. The door root sits
    // on the glass side of the glass plane, so a straight arm pierced the glass; the upper leg now lies wholly behind
    // that plane and the lower one crosses it clear below the glass.
    const elbow=center.clone().add(new THREE.Vector3(-side*width*.18,-(height*.37+stalkRadius*1.6),-depth*.3).applyQuaternion(orientation));
    const armMat=car.materials.black||car.materials.chrome||car.paint;
    const arm=new THREE.Mesh(armGeometry(hit.point,elbow,stalkRadius),armMat);arm.name='mirror-stalk';arm.userData.mirrorArm=true;group.add(arm);
    const upper=new THREE.Mesh(armGeometry(elbow,tip,stalkRadius),modern&&!commercial?car.paint:armMat);upper.name='mirror-stalk-upper';upper.userData.mirrorArm=true;group.add(upper);
    group.userData.mirrorRoot=hit.point.toArray();group.userData.mirrorCenter=center.toArray();scope.updateWorldMatrix(true,true);const shellCenter=scope.worldToLocal(new THREE.Box3().setFromObject(shell).getCenter(V()));group.userData.mirrorTipOffset=tip.clone().sub(shellCenter).toArray();group.userData.mirrorElbowOffset=elbow.clone().sub(shellCenter).toArray();group.userData.mirrorRadius=stalkRadius;
  }
}
// Mirror stalks remain separate from body batches and are re-seated after each
// impact. Detached assemblies stay hidden; repair restores the same rest root.
export function refreshMirrorAttachments(car){
  if(!car?.body?.traverse)return;
  const scopes=[];car.body.traverse(o=>{if(o.userData.mirrorAssembly)scopes.push(o);});
  for(const group of scopes){
    // Far traffic batches can bake the housing/stalk into the shell. Such a tag
    // is no longer an articulated assembly and must not abort crash processing.
    const housing=group.getObjectByName('mirror-housing'),arm=group.getObjectByName('mirror-stalk');
    if(!group.parent||!housing||!arm?.geometry||!group.userData.mirrorRoot||!group.userData.mirrorTipOffset)continue;
    const scope=group.parent,supports=mirrorSurfaces(car,scope),root=V().fromArray(group.userData.mirrorRoot);
    // All mirror groups and support triangles use the same body-local frame.
    const bodyPoint=car.body.worldToLocal(scope.localToWorld(root.clone()));
    car.damageLattice?.sample(bodyPoint.x,bodyPoint.y,bodyPoint.z,bodyPoint);
    root.add(bodyPoint);const hit=nearestSurface(root,supports,scope);if(!hit)continue;
    const shellCenter=new THREE.Box3().setFromObject(housing).getCenter(V());scope.worldToLocal(shellCenter);
    const center=shellCenter.clone().add(new THREE.Vector3().fromArray(group.userData.mirrorTipOffset)),upper=group.getObjectByName('mirror-stalk-upper');
    const elbow=upper&&group.userData.mirrorElbowOffset?shellCenter.clone().add(new THREE.Vector3().fromArray(group.userData.mirrorElbowOffset)):null;
    arm.geometry.dispose();arm.geometry=armGeometry(hit.point,elbow||center,group.userData.mirrorRadius);
    if(elbow){upper.geometry.dispose();upper.geometry=armGeometry(elbow,center,group.userData.mirrorRadius);}
    arm.userData.attachmentRoot=hit.point.toArray();arm.userData.attachmentTip=center.toArray();
  }
}
