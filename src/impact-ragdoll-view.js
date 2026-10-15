import * as THREE from 'three';
import { createHumanRig, makeLook } from './human.js';
import { RNG } from './util.js';
import { PARENTS, RagdollPool } from './impact-ragdoll.js';
// Three prebuilt skinned meshes, reusing crowd clothing and hair. No per-frame mesh creation.
export class ImpactBodies extends RagdollPool {
 constructor(scene,ground){
  super();this.ground=ground;this.v=new THREE.Vector3();this.d=new THREE.Vector3();this.inv=new THREE.Quaternion();this.side=new THREE.Vector3();this.up=new THREE.Vector3();this.forward=new THREE.Vector3();this.basis=new THREE.Matrix4();
  for(const b of this.bodies){
   const L=makeLook(new RNG(71),'street');Object.assign(L,{hat:null,bag:false,phone:false,cup:false,umbrella:false,skirt:false,role:'street'});
   const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,transparent:true});
   b.pedRig=createHumanRig(L,material);b.pedLook=L;
   const riderLook=makeLook(new RNG(17),'street');Object.assign(riderLook,{female:false,skirt:false,hat:null,bag:false,phone:false,cup:false,umbrella:false,sleeveless:false,longSleeve:true,hair:-1,role:'street'});
   riderLook.col.top.set('#3b4652');riderLook.col.bottom.set('#20252b');
   b.riderRig=createHumanRig(riderLook,material.clone());b.riderLook=riderLook;
   b.riderRig.mesh.visible=false;scene.add(b.riderRig.mesh);
   b.rig=b.pedRig;b.look=L;b.rot=Array.from({length:16},()=>new THREE.Quaternion());
   b.helmet = new THREE.Mesh(new THREE.SphereGeometry(.18,12,8),new THREE.MeshStandardMaterial({color:'#20262d',roughness:.5}));
   b.helmet.position.y=.15;b.riderRig.bones[3].add(b.helmet);b.helmet.visible=false;
   b.rig.mesh.visible=false;scene.add(b.rig.mesh);
  }
 }
 spawn(o){const b=super.spawn(o);b.rig.mesh.visible=false;b.rig=o.kind==='rider'?b.riderRig:b.pedRig;b.look=o.kind==='rider'?b.riderLook:b.pedLook;b.rig.mesh.visible=true;b.helmet.visible=o.kind==='rider';return b;}
 render(){
  for(const b of this.bodies){
   b.pedRig.mesh.visible=b.riderRig.mesh.visible=false;
   const {mesh,bones}=b.rig;mesh.visible=b.active;if(!b.active)continue;
   mesh.material.opacity=b.opacity;const p=b.p,k=b.look.k;
   mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.setScalar(k);
   for(let i=0;i<16;i++){
    const parent=PARENTS[i],child=i===0?1:i===1?2:i===2?3:i===4?5:i===5?6:i===7?8:i===8?9:i===10?11:i===11?12:i===13?14:i===14?15:-1;
    const j=i*3,bi=bones[i],rot=b.rot[i];
    if(i<3){
     const left=i===0?4:7,right=i===0?10:13;
     this.up.set(p[child*3]-p[j],p[child*3+1]-p[j+1],p[child*3+2]-p[j+2]).normalize();
     this.side.set(p[left*3]-p[right*3],p[left*3+1]-p[right*3+1],p[left*3+2]-p[right*3+2]).normalize();
     this.forward.crossVectors(this.side,this.up).normalize();this.side.crossVectors(this.up,this.forward).normalize();
     this.basis.makeBasis(this.side,this.up,this.forward);rot.setFromRotationMatrix(this.basis);
    }
    else if(child>=0){this.v.set(0,child<4?1:-1,0);this.d.set(p[child*3]-p[j],p[child*3+1]-p[j+1],p[child*3+2]-p[j+2]).normalize();rot.setFromUnitVectors(this.v,this.d);}
    else if(parent>=0)rot.copy(b.rot[parent]);
    this.v.set(p[j]/k,p[j+1]/k,p[j+2]/k);
    if(parent>=0){this.v.sub(this.d.set(p[parent*3]/k,p[parent*3+1]/k,p[parent*3+2]/k));this.inv.copy(b.rot[parent]).invert();this.v.applyQuaternion(this.inv);bi.quaternion.copy(this.inv).multiply(rot);}
    else bi.quaternion.copy(rot);
    bi.position.copy(this.v);
   }
   mesh.updateMatrixWorld(true);
  }
 }
 update(dt){super.update(dt,this.ground);this.render();}
 clear(){super.clear();this.render();}
}
