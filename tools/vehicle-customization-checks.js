// Real Three/Canvas/IndexedDB checks in tools/models.html; no identity photos.
import * as THREE from 'three';
import {CARS,CarModel} from '../src/cars.js';
import {Driver} from '../src/driver.js';
import {applyCarDecals,packDecalsForNetwork} from '../src/vehicle-decals.js';
import {savePhotoSticker,deletePhotoSticker} from '../src/photo-stickers.js';
export async function runVehicleCustomizationChecks(){
  let passed=0;const check=(ok,label)=>{if(!ok)throw new Error(label);passed++;};
  const a=new Driver(),b=new Driver(),meshes=[];a.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
  const hand=a.arms[1].hand.position.clone(),hairScale=a.hairBase.scale.clone();
  const owned=a._ownedGeometries,shared=new Set();b.root.traverse(o=>{if(o.geometry&&!b._ownedGeometries.has(o.geometry))shared.add(o.geometry);});
  const disposal=new Map();for(const r of [...owned,...shared,...a._ownedMaterials,...a._ownedTextures])r.addEventListener('dispose',()=>disposal.set(r,(disposal.get(r)||0)+1));
  a.setAppearance({skin:'#885533',shirt:'#168bda',hair:'#f4d397',hairStyle:'short',helmet:false});
  check(a.appearanceMaterials.skin.color.getHexString()==='885533'&&a.appearanceMaterials.shirt.color.getHexString()==='168bda','Skin and clothes change actual materials');
  check(a.hairGroup.visible&&!a.curlMesh.visible&&!a.hairBase.visible,'Short hair uses fitted scalp');
  check(a.arms[1].hand.position.equals(hand)&&a.hairBase.scale.equals(hairScale),'Appearance preserves hand pose and roof fit');
  check(b.appearanceMaterials.skin.color.getHexString()!=='885533','Drivers have isolated materials');
  a.setAppearance({...a.appearance,hairStyle:'curly'});check(a.curlMesh.visible&&a.hairBase.visible,'Curly hair restores animated locks');
  a.setAppearance({...a.appearance,hairStyle:'none'});check(!a.hairGroup.visible,'No-hair option hides all scalp meshes');
  a.setAppearance({...a.appearance,helmet:true});check(a.helmetGroup.visible&&!a.hairGroup.visible,'Helmet replaces hair');
  const geometries=[...owned];a.dispose();a.dispose();check(geometries.every(g=>disposal.get(g)===1),'Owned driver geometry disposed once');
  check([...shared].every(g=>!disposal.has(g)),'Disposing one driver preserves shared primitives');b.dispose();
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const c=canvas.getContext('2d');
  c.fillStyle='#168bda';c.fillRect(0,0,256,256);c.fillStyle='#ffd23f';c.beginPath();c.arc(128,106,74,0,7);c.fill();c.fillStyle='#111820';c.fillRect(90,83,13,13);c.fillRect(152,83,13,13);c.lineWidth=7;c.strokeStyle='#111820';c.beginPath();c.arc(128,111,38,0,Math.PI);c.stroke();c.fillStyle='white';c.font='bold 28px Arial';c.textAlign='center';c.fillText('TEST FACE',128,225);
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png')),assets=[];
  const car=new CarModel(CARS.find(s=>s.id==='z4'),{decals:[]});const decals=()=>{const out=[];car.body.traverse(o=>{if(o.userData.vehicleDecal)out.push(o);});return out;};
  try{
    const photo=await savePhotoSticker(blob,{width:256,height:256});assets.push(photo.id);
    const layer={id:'photo',assetId:photo.id,position:'doors',scale:1.1,rotation:12,x:-.15,flipX:true};
    applyCarDecals(car,[layer,{id:'roundel',position:'bonnet',number:88,color:'#ffffff'}]);await car.decalReady;
    const projected=decals().filter(o=>o.name==='vinyl-photo');
    check(projected.length>=2&&projected.every(o=>o.material.opacity===1),'Guest blob projects onto both real door surfaces');
    check(projected.every(o=>o.material.map.repeat.x===-1&&o.material.map.offset.x===1),'Photo horizontal flip applied to UV texture');
    check(decals().every(o=>o.parent.material!==car.materials.glass),'Decals never use glass as receiver');
    check(packDecalsForNetwork(car.decals).length===1,'Guest-only photo omitted from wire; library decal preserved');
    const map=projected[0].material.map,pixel=map.image.getContext('2d').getImageData(256,212,1,1).data;
    check(pixel[0]>200&&pixel[1]>150,'Photo texture contains decoded fixture pixels');
    const geometry=projected[0].geometry.attributes.position.array.slice();
    applyCarDecals(car,[{...layer,x:.5,rotation:-25,scale:.7}]);await car.decalReady;
    const moved=decals()[0].geometry.attributes.position.array;check(geometry.length!==moved.length||geometry.some((v,i)=>v!==moved[i]),'Transform edits change projected geometry');
    const late=await savePhotoSticker(blob,{width:256,height:256});assets.push(late.id);
    const original=globalThis.createImageBitmap;let resume,started;
    const gate=new Promise(r=>resume=r),entered=new Promise(r=>started=r);
    globalThis.createImageBitmap=async(...args)=>{started();await gate;return original(...args);};
    try{
      applyCarDecals(car,[{...layer,assetId:late.id}]);const pending=car.decalReady;
      await entered;const old=decals()[0].material;let disposed=0;old.map.addEventListener('dispose',()=>disposed++);
      applyCarDecals(car,[]);resume();await pending;
      check(disposed===1&&old.opacity===0&&decals().length===0,'Late image load cannot revive cleared/disposed layers');
    }finally{resume?.();globalThis.createImageBitmap=original;}
    applyCarDecals(car,[layer]);await car.decalReady;
    return {passed,car,fixture:canvas};
  }finally{for(const id of assets)await deletePhotoSticker(id);}
}
