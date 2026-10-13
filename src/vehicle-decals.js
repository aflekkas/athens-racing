/**
 * Garage API (all art is original procedural canvas art):
 *   listDecals() -> [{id,name,number?,positions,colors}]
 *   getCarDecals(carId) -> [{id,position,color,number?}]
 *   setCarDecals(carId,list) -> validated list; [] clears. Max eight layers.
 * Example: setCarDecals('z4',[{id:'roundel',position:'doors',color:'#ffffff',number:42}]).
 * Presets: bonnet / doors (both sides, text readable) / roof / rear.
 * Convertible roof presets use the painted tonneau. Changes persist per car and
 * update local CarModel instances on their next update, including garage previews.
 * A `vehicledecalschange` window event carries {carId,decals} for optional UI refresh.
 * applyCarDecals(model,list,{local:false}) sets a remote livery without writing storage.
 * packDecals/unpackDecals provide the bounded, compact multiplayer representation.
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { DECAL_LIBRARY,DECAL_POSITIONS,DECAL_COLORS,normalizeDecals,packDecals,unpackDecals } from './vehicle-decal-data.js';
export { packDecals,unpackDecals };
const cache=new Map(),versions=new Map();
const key=id=>'paraliaki.decals.'+id;
export function listDecals(){return DECAL_LIBRARY.map(d=>({...d,positions:[...DECAL_POSITIONS],colors:[...DECAL_COLORS]}));}
export function getCarDecals(carId){
  if(!cache.has(carId)){let list=[];try{list=normalizeDecals(JSON.parse(localStorage.getItem(key(carId))||'[]'));}catch{}cache.set(carId,list);}
  return cache.get(carId).map(d=>({...d}));
}
export function setCarDecals(carId,list){
  const decals=normalizeDecals(list);cache.set(carId,decals);versions.set(carId,(versions.get(carId)||0)+1);
  try{localStorage.setItem(key(carId),JSON.stringify(decals));}catch{}
  globalThis.window?.dispatchEvent(new CustomEvent('vehicledecalschange',{detail:{carId,decals:getCarDecals(carId)}}));
  return getCarDecals(carId);
}
globalThis.window?.addEventListener('storage',event=>{if(event.key?.startsWith('paraliaki.decals.')){const id=event.key.slice(17);cache.delete(id);versions.set(id,(versions.get(id)||0)+1);}});
function art(d){
  const canvas=document.createElement('canvas');canvas.width=d.id==='roundel'?512:1024;canvas.height=512;
  const c=canvas.getContext('2d');c.fillStyle=d.color;c.strokeStyle=d.color;c.lineWidth=12;c.textAlign='center';c.textBaseline='middle';
  if(d.id==='stripes'){for(const x of [340,552])c.fillRect(x,0,132,512);}
  if(d.id==='roundel'){
    c.translate(-256,0);
    c.beginPath();c.arc(512,256,242,0,Math.PI*2);c.fill();
    const rgb=new THREE.Color(d.color);c.fillStyle=rgb.r+rgb.g+rgb.b>1.2?'#111820':'#ffffff';
    c.font='900 270px Arial';c.fillText(String(d.number),512,270,440);
  }
  if(d.id==='athens'){c.font='900 italic 125px Arial';c.fillText('ATHENS',512,190,950);c.font='700 73px Arial';c.fillText('STREET RACERS',512,310,950);c.fillRect(70,375,884,12);}
  if(d.id==='greek_flag'){
    c.fillStyle='#1265b2';c.fillRect(100,40,824,432);c.fillStyle='#ffffff';
    for(let i=1;i<9;i+=2)c.fillRect(100,40+i*48,824,48);
    c.fillStyle='#1265b2';c.fillRect(100,40,240,240);c.fillStyle='#ffffff';c.fillRect(196,40,48,240);c.fillRect(100,136,240,48);
  }
  if(d.id==='flames'){
    for(let i=0;i<5;i++){const y=50+i*92;c.beginPath();c.moveTo(50,y+85);c.bezierCurveTo(290,y-20,470,y+120,720+i*40,y-25);c.bezierCurveTo(590,y+120,340,y+50,235,y+150);c.bezierCurveTo(175,y+130,115,y+110,50,y+85);c.fill();}
  }
  if(d.id==='apex'){c.beginPath();c.moveTo(80,380);c.lineTo(220,110);c.lineTo(360,380);c.lineTo(260,315);c.lineTo(220,240);c.lineTo(180,315);c.closePath();c.fill();c.font='900 italic 190px Arial';c.fillText('ASR',675,250,600);c.font='40px Arial';c.fillText('RACE WORKSHOP',660,378,560);}
  if(d.id==='ion'){c.lineWidth=28;c.beginPath();c.ellipse(210,255,125,155,.45,0,Math.PI*2);c.stroke();c.font='900 italic 245px Arial';c.fillText('COAST',640,255,580);c.font='40px Arial';c.fillText('WORKS',650,395,580);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
function projectors(model,d){
  const s=model.shape,W=model.dims.W,L=model.dims.L;
  const wide=d.id==='stripes',round=d.id==='roundel';
  if(d.position==='doors')return [-1,1].map(sign=>({p:[sign*W/2,s.belt-.21,(s.cowl+Math.min(s.back,.8))*.5],r:[0,sign*Math.PI/2,0],size:[round?.53:Math.min(1.2,s.wb-.8),round?.53:.43,.48]}));
  if(d.position==='rear')return [{p:[0,s.rear-.22,L/2],r:[0,0,0],size:[round?.38:W*.58,round?.38:.25,.40]}];
  const roof=d.position==='roof',open=s.open||model.spec.convertible;
  const z=roof?(open?s.back+.28:(s.header+s.roofBack)/2):(s.cowl-L/2)/2;
  return [{p:[0,roof?(open?s.belt+.05:s.H):s.belt-.03,z],r:[-Math.PI/2,0,0],size:[wide?W*.8:round?.72:W*.63,round?.72:roof?(open?.47:Math.max(.5,s.roofBack-s.header-.1)):Math.max(.6,s.cowl+L/2-.2),roof&&!open?.34:.55]}];
}
export function applyCarDecals(model,list,{local=false}={}){
  const decals=normalizeDecals(list),signature=JSON.stringify(decals);
  model.localDecals=local;model.decalVersion=versions.get(model.spec.id)||0;
  if(model.decalSignature===signature)return;
  const obsolete=[];model.body.traverse(o=>{if(o.userData.vehicleDecal)obsolete.push(o);});
  const oldMaterials=new Set(obsolete.map(o=>o.material));for(const o of obsolete){o.removeFromParent();o.geometry.dispose();}for(const m of oldMaterials){m.map.dispose();m.dispose();}
  model.decals=decals;model.decalSignature=signature;model.decalDamageKey=JSON.stringify(model.damage);if(!decals.length)return;
  model.body.updateWorldMatrix(true,true);const invBody=model.body.matrixWorld.clone().invert(),receivers=[];
  model.body.traverse(o=>{if(o.isMesh&&!o.userData.vehicleDecal&&(o.material===model.paint||model.paintAccents?.includes(o.material)||o.material===model.materials?.black||o.name==='roof'))receivers.push(o);});
  decals.forEach((d,index)=>{
    const material=new THREE.MeshStandardMaterial({map:art(d),transparent:true,depthWrite:false,roughness:.38,metalness:.08,polygonOffset:true,polygonOffsetFactor:-3-index,polygonOffsetUnits:-2,side:THREE.FrontSide});
    let used=false;
    for(const q of projectors(model,d))for(const receiver of receivers){
      if(receiver.material===model.materials?.black&&d.position!=='roof')continue;
      // Project in car-body coordinates even while the vehicle is pitched/in the world.
      const proxy=new THREE.Mesh(receiver.geometry,receiver.material);proxy.matrixWorld.multiplyMatrices(invBody,receiver.matrixWorld);
      const geometry=new DecalGeometry(proxy,new THREE.Vector3(...q.p),new THREE.Euler(...q.r),new THREE.Vector3(...q.size));
      if(!geometry.attributes.position.count){geometry.dispose();continue;}
      // Procedural body panels can have mirrored winding. Orient vinyl towards
      // the projector so it never shows on the inside of the cabin through glass.
      const outward=new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(...q.r));
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
      const positions=geometry.attributes.position;
      for(let i=0;i<positions.count;i+=3){
        a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);
        normal.crossVectors(b.sub(a),c.sub(a));
        if(normal.dot(outward)<0)for(const attr of Object.values(geometry.attributes))for(let k=0;k<attr.itemSize;k++){
          const j=(i+1)*attr.itemSize+k,l=(i+2)*attr.itemSize+k,t=attr.array[j];attr.array[j]=attr.array[l];attr.array[l]=t;
        }
        const normals=geometry.attributes.normal;
        for(let j=i;j<i+3;j++)if(a.fromBufferAttribute(normals,j).dot(outward)<0)normals.setXYZ(j,-a.x,-a.y,-a.z);
      }
      geometry.applyMatrix4(proxy.matrixWorld.clone().invert());
      const decal=new THREE.Mesh(geometry,material);decal.name='vinyl-'+d.id;decal.userData.vehicleDecal=true;decal.renderOrder=3+index;decal.castShadow=false;decal.receiveShadow=true;receiver.add(decal);used=true;
    }
    if(!used){material.map.dispose();material.dispose();}
  });
}
export function updateCarDecals(model){
  if(model.localDecals&&model.decalVersion!==(versions.get(model.spec.id)||0))applyCarDecals(model,getCarDecals(model.spec.id),{local:true});
  if(model.decals?.length&&model.decalDamageKey!==JSON.stringify(model.damage)){
    model.decalSignature=null;applyCarDecals(model,model.decals,{local:model.localDecals});
  }
}
