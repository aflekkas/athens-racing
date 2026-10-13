// Seated driver. Coordinates and public fields match the cockpit / car placement contract.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trimMat } from './cockpit.js';
import { clamp, RNG } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const SPHERE = new THREE.SphereGeometry(1, 18, 12);
const ARM = new THREE.CapsuleGeometry(.5, 1, 5, 12);
const CURL = new THREE.TorusGeometry(.65, .28, 5, 10, Math.PI * 1.75);

// A loft makes the cheeks, temples, jaw and chin read as a human head from every angle.
function headGeometry() {
  const rings = [
    [-.118,.019,.033,-.028],[-.107,.040,.048,-.022],[-.086,.061,.065,-.010],
    [-.056,.075,.078,0],[-.025,.084,.087,.004],[0,.087,.092,.006],
    [.028,.085,.095,.009],[.055,.082,.095,.012],[.082,.071,.084,.015],
    [.105,.049,.063,.016],[.120,.021,.030,.016],[.124,.001,.001,.016],
  ];
  const positions = [], indices = [], n = 32;
  for (const [y,w,d,z] of rings) for (let i=0;i<=n;i++) {
    const a=i/n*Math.PI*2, s=Math.sin(a), c=Math.cos(a);
    // The face is a gently flattened plane, with cheek projection below the eyes.
    const front=c<0 ? -Math.pow(-c,.62) : c;
    positions.push(s*w,y,z+front*d);
  }
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++) {
    const a=j*(n+1)+i,b=a+n+1;
    indices.push(a,a+1,b,b,a+1,b+1);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
const HEAD = headGeometry();

function scalpGeometry() {
  const p=[],ix=[],n=32,rows=9;
  for(let j=0;j<=rows;j++)for(let i=0;i<=n;i++) {
    const a=i/n*Math.PI*2, front=Math.max(0,-Math.cos(a));
    const edge=1.86-front*.76, t=.001+(j/rows)*edge;
    p.push(Math.sin(t)*Math.sin(a)*.089,Math.cos(t)*.124+.005,Math.sin(t)*Math.cos(a)*.100+.013);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+n+1;ix.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
const SCALP=scalpGeometry();

export class Driver {
  constructor({hair=true,shirt='#f6f4ee',skin='#c98b62',helmet=false}={}) {
    const root=this.root=new THREE.Group(); root.name='driver';
    const skinM=new THREE.MeshStandardMaterial({color:skin,roughness:.68});
    const lipM=new THREE.MeshStandardMaterial({color:new THREE.Color(skin).lerp(new THREE.Color('#92534d'),.42),roughness:.78});
    const shadowM=new THREE.MeshStandardMaterial({color:new THREE.Color(skin).multiplyScalar(.48),roughness:.88});
    const shirtM=trimMat(shirt,{rough:.9,scale:.025,nk:.18,sheen:.06});
    const hairM=new THREE.MeshStandardMaterial({color:'#30221b',roughness:.94});
    const irisM=new THREE.MeshStandardMaterial({color:'#332b23',roughness:.6});
    const eyeM=new THREE.MeshStandardMaterial({color:'#c9bbaa',roughness:.6});
    const add=(geo,mat,x,y,z,sx=1,sy=1,sz=1,parent=root)=>{
      const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
    };
    const ell=(mat,x,y,z,sx,sy,sz,parent=root)=>add(SPHERE,mat,x,y,z,sx,sy,sz,parent);
    this.torso=ell(shirtM,0,-.29,.058,.194,.282,.105);
    this.torso.rotation.x=-.12;
    // Shoulder yoke, neckline and two turned collar points, separate from the torso fabric.
    ell(shirtM,0,-.095,.034,.196,.08,.095);
    ell(skinM,0,-.047,-.025,.061,.037,.031);
    for(const sx of [-1,1]) {
      const collar=add(new THREE.BoxGeometry(.052,.012,.086),shirtM,sx*.045,-.051,-.055);
      collar.rotation.set(-.22,sx*.28,sx*.25);
    }
    const seam=add(new THREE.BoxGeometry(.012,.27,.008),shirtM,0,-.23,-.048);seam.rotation.x=-.1;
    for(let i=0;i<3;i++)ell(shadowM,0,-.14-i*.069,-.059-i*.004,.003,.003,.0015);
    const neck=this.neck=new THREE.Group();root.add(neck);
    add(new THREE.CylinderGeometry(.047,.057,.12,16),skinM,0,.014,.014,1,1,1,neck);
    const head=this.head=new THREE.Group();head.position.set(0,.17,0);neck.add(head);
    add(HEAD,skinM,0,0,0,1,1,1,head);
    // Ears have a recessed concha and lobe rather than featureless beads.
    for(const sx of [-1,1]) {
      ell(skinM,sx*.089,-.009,.012,.014,.032,.019,head);
      ell(shadowM,sx*.097,-.007,.003,.004,.017,.010,head);
      ell(skinM,sx*.094,-.027,.005,.008,.009,.009,head);
      // Sockets sit within the face. Small off-white surfaces avoid toy-like staring eyes.
      ell(shadowM,sx*.038,.018,-.082,.023,.010,.006,head);
      ell(eyeM,sx*.038,.017,-.086,.017,.0055,.005,head);
      ell(irisM,sx*.037,.017,-.090,.005,.0048,.0017,head);
      const brow=ell(hairM,sx*.038,.035,-.081,.024,.004,.005,head);brow.rotation.z=sx*-.08;
      // Lower orbital ridge and cheek volume blend into the main loft.
      ell(skinM,sx*.048,-.003,-.078,.029,.016,.009,head);
    }
    const bridge=ell(skinM,0,.001,-.093,.011,.027,.014,head);bridge.rotation.x=-.12;
    ell(skinM,0,-.020,-.108,.014,.010,.014,head);
    for(const sx of [-1,1]) {
      ell(skinM,sx*.012,-.026,-.098,.009,.007,.008,head);
      ell(shadowM,sx*.008,-.030,-.104,.003,.0018,.003,head);
    }
    ell(lipM,0,-.051,-.079,.021,.0035,.005,head);
    ell(lipM,0,-.057,-.078,.018,.0045,.004,head);
    ell(shadowM,0,-.054,-.083,.017,.0008,.0007,head);
    ell(skinM,0,-.085,-.065,.026,.014,.009,head);

    this.arms=[];
    for(const sx of [-1,1]) {
      const up=new THREE.Mesh(ARM,skinM),fo=new THREE.Mesh(ARM,skinM);
      const sleeve=new THREE.Mesh(ARM,shirtM);sleeve.scale.set(1.16,.53,1.16);sleeve.position.y=.44;up.add(sleeve);
      const hand=new THREE.Group();
      // A palm and four bent fingers follow the rim tangent; the thumb closes around its inside.
      ell(skinM,0,0,0,.034,.017,.035,hand);
      for(let j=0;j<4;j++) {
        const z=(j-1.5)*.015;
        ell(skinM,.024,.005,z,.012,.013,.0065,hand);
        const finger=ell(skinM,.023,-.009,z,.008,.017,.006,hand);finger.rotation.z=-.5;
        ell(skinM,.010,-.020,z,.011,.007,.006,hand);
      }
      const thumb=ell(skinM,-.024,-.008,sx*.018,.011,.013,.022,hand);thumb.rotation.y=sx*-.5;
      root.add(up,fo,hand);this.arms.push({sx,up,fo,hand});
    }
    this.curls=[];this.curlMesh=null;this.hairBase=null;
    this.hw={x:0,vx:0,z:0,vz:0};
    this._m=new THREE.Matrix4();this._v=new THREE.Vector3();this._s=new THREE.Vector3();
    this._shoulder=new THREE.Vector3();this._hand=new THREE.Vector3();this._elbow=new THREE.Vector3();
    this._tan=new THREE.Vector3();this._out=new THREE.Vector3();this._normal=new THREE.Vector3();this._delta=new THREE.Vector3();
    if(helmet) {
      const shellM=new THREE.MeshStandardMaterial({color:'#24282a',roughness:.32,metalness:.08});
      // An open-face shell leaves the facial structure visible and clears the neck.
      add(new THREE.SphereGeometry(1,24,16,0,Math.PI*2,0,Math.PI*.60),shellM,0,.015,.014,.104,.134,.116,head);
      for(const sx of [-1,1])ell(shellM,sx*.098,-.010,.025,.017,.055,.048,head);
      const strap=add(new THREE.TorusGeometry(.073,.006,6,24,Math.PI),hairM,0,-.052,.007,1,.75,1,head);strap.rotation.x=Math.PI/2;
    } else if(hair) {
      // Fixed scalp survives the legacy roof-clearance scale on the moving hair layer.
      add(SCALP,hairM,0,0,0,1,1,1,head);
      this.hairBase=ell(hairM,0,.085,.019,.079,.045,.084,head);
      this._hairRestY=.085;
      const rng=new RNG(1234);
      for(let i=0;i<64;i++) {
        const a=i*2.39996323,y=.18+.82*(i+.5)/64,r=Math.sqrt(1-y*y);
        const dir=new THREE.Vector3(Math.sin(a)*r,y,Math.cos(a)*r);
        const rest=new THREE.Vector3(dir.x*.091,dir.y*.124+.006,dir.z*.102+.015);
        if(dir.z<-.3&&dir.y<.5)rest.y+=.019;
        const rot=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),dir);
        rot.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),rng.range(0,Math.PI*2)));
        this.curls.push({rest,off:new THREE.Vector3(),vel:new THREE.Vector3(),dir,rot,s:rng.range(.012,.019),w:rng.range(.65,1),ph:rng.range(0,Math.PI*2),f:rng.range(9,16)});
      }
      const curlMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.86});
      this.curlMesh=new THREE.InstancedMesh(CURL,curlMat,this.curls.length);this.curlMesh.castShadow=true;
      this.curlMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.curls.forEach((c,i)=>this.curlMesh.setColorAt(i,new THREE.Color('#39271d').multiplyScalar(rng.range(.8,1.15))));
      head.add(this.curlMesh);this._writeHair();
    }
    // Merge rigid facial details and fingers by material; retain the animated public meshes.
    mergeRigidMeshes(head, this.hairBase);
    for (const a of this.arms) mergeRigidMeshes(a.hand);
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    this.update(0,0,0,{x:0,y:0,z:0},{pos:new THREE.Vector3(0,-.135,-.53),angle:0,euler:new THREE.Euler(-.36,0,0),r:.18},0);
  }

  impulse(strength,dx=0,dz=0) {
    const kick=clamp(strength,0,2);
    for(const c of this.curls){c.vel.x+=dx*kick*.025;c.vel.y+=kick*.012;c.vel.z+=dz*kick*.025;}
    this.hw.vx+=kick*.16;this.hw.vz+=dx*kick*.16;
  }

  /** Wheel position is in driver-parent space, before the driver's placement transform. */
  update(dt,t,speed,acc,wheel,steer=0,heaveV=0) {
    const h=clamp(dt,0,1/30),ax=acc?.x||0,ay=acc?.y||0,az=acc?.z||0;
    if(wheel)for(const a of this.arms) {
      const shoulder=this._shoulder.set(a.sx*.18,-.10,.035);
      const ang=(a.sx>0?.25:Math.PI-.25)+(wheel.angle||0);
      const hand=this._hand.set(Math.cos(ang)*wheel.r,Math.sin(ang)*wheel.r,0).applyEuler(wheel.euler).add(wheel.pos).sub(this.root.position);
      const elbow=this._elbow.copy(shoulder).lerp(hand,.5);elbow.x+=a.sx*.064;elbow.y-=.115;elbow.z+=.045;
      beam(a.up,shoulder,elbow,.098,this._delta);beam(a.fo,elbow,hand,.071,this._delta);a.hand.position.copy(hand);
      const tan=this._tan.set(-Math.sin(ang),Math.cos(ang),0).applyEuler(wheel.euler);
      const out=this._out.set(Math.cos(ang),Math.sin(ang),0).applyEuler(wheel.euler);
      this._normal.crossVectors(tan,out);a.hand.quaternion.setFromRotationMatrix(this._m.makeBasis(out,this._normal,tan));
    }
    const hw=this.hw;
    hw.vx+=(-hw.x*100-hw.vx*15+az*.010)*h;
    hw.vz+=(-hw.z*100-hw.vz*15-ax*.010)*h;
    hw.x=clamp(hw.x+hw.vx*h,-.085,.085);hw.z=clamp(hw.z+hw.vz*h,-.075,.075);
    this.neck.rotation.x=hw.x;this.neck.rotation.z=hw.z;
    this.head.rotation.y=Math.sin(t*.48)*.022-steer*.26;
    if(!this.curls.length)return;
    const wind=Math.min(1,Math.abs(speed)/40),step=h/2;
    for(let k=0;k<2;k++)for(const c of this.curls) {
      c.vel.x+=(-c.off.x*240-c.vel.x*25-ax*.0008+c.w*Math.sin(t*c.f+c.ph)*wind*.020)*step;
      c.vel.y+=(-c.off.y*240-c.vel.y*25-ay*.0007-heaveV*.04)*step;
      c.vel.z+=(-c.off.z*240-c.vel.z*25-az*.0008+wind*wind*.12*c.w)*step;
      c.off.addScaledVector(c.vel,step);
      if(c.off.lengthSq()>.000064)c.off.setLength(.008);
    }
    this._writeHair();
  }

  _writeHair() {
    let x=0,y=0,z=0;
    this.curls.forEach((c,i)=>{this._v.copy(c.rest).add(c.off);this._s.setScalar(c.s);this._m.compose(this._v,c.rot,this._s);this.curlMesh.setMatrixAt(i,this._m);x+=c.off.x;y+=c.off.y;z+=c.off.z;});
    const n=this.curls.length;
    this.hairBase.position.set(x/n*.3,(this.hairY??this._hairRestY)+y/n*.3,.019+z/n*.3);
    this.curlMesh.instanceMatrix.needsUpdate=true;
    // Conservative fixed bound includes short hair's maximum spring displacement.
    this.curlMesh.boundingSphere ||= new THREE.Sphere(new THREE.Vector3(0,.06,.015),.18);
  }
}

function beam(mesh,a,b,thick,delta) {
  delta.subVectors(b,a);const len=delta.length();
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  if(len>1e-7)mesh.quaternion.setFromUnitVectors(UP,delta.multiplyScalar(1/len));
  mesh.scale.set(thick,len*.5,thick);
}

// Every vertex remains in its original parent space; only the draw submission is combined.
function mergeRigidMeshes(parent, retained = null) {
  const groups = new Map();
  for (const child of parent.children) {
    if (!child.isMesh || child.isInstancedMesh || child === retained) continue;
    if (!groups.has(child.material)) groups.set(child.material, []);
    groups.get(child.material).push(child);
  }
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
      // These solid-colour skin, eye and hair details have no texture coordinates.
      geometry.deleteAttribute('uv');
      return geometry;
    });
    const merged = new THREE.Mesh(mergeGeometries(geometries), material);
    for (const mesh of meshes) parent.remove(mesh);
    for (const geometry of geometries) geometry.dispose();
    parent.add(merged);
  }
}
