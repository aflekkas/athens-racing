import {ASSET_ID_RE,CUSTOMIZATION_LIMITS as L,newCustomizationId} from './customization-data.js';
const urls=new Map(),publicPhotos=new Set();let dbPromise;
export const isPublicPhotoSticker=id=>ASSET_ID_RE.test(id||'')&&publicPhotos.has(id);
function db(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('asr-photo-stickers',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Photo storage is unavailable.'));});}
async function transaction(mode,fn){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('photos',mode),r=fn(tx.objectStore('photos'));let value;r.onsuccess=()=>value=r.result;r.onerror=()=>reject(r.error);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Photo could not be saved.'));});}
export async function listLocalPhotos(){return transaction('readonly',s=>s.getAll());}
export function photoStickerUrl(id){return ASSET_ID_RE.test(id||'')?(urls.get(id)||'/api/customization/assets/'+id):null;}
export async function resolvePhotoSticker(id){
  if(!ASSET_ID_RE.test(id||''))return null;
  const local=await transaction('readonly',s=>s.get(id)).catch(()=>null);if(local?.blob)return local.blob;
  const response=await fetch('/api/customization/assets/'+id,{signal:AbortSignal.timeout(15000)}).catch(()=>null);if(!response?.ok)return null;
  if(!['image/png','image/jpeg','image/webp'].includes(response.headers.get('Content-Type')?.split(';')[0])||Number(response.headers.get('Content-Length')||0)>L.assetBytes)return null;
  const blob=await response.blob();if(blob.size>L.assetBytes)return null;publicPhotos.add(id);return blob;
}
export async function preparePhotoUrl(id){if(urls.has(id))return urls.get(id);const blob=await resolvePhotoSticker(id);if(!blob)return null;const url=URL.createObjectURL(blob);urls.set(id,url);return url;}
export function releasePhotoUrl(id){const url=urls.get(id);if(url)URL.revokeObjectURL(url);urls.delete(id);}
export async function savePhotoSticker(blob,{signedIn=false,width,height}={}){
  if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>L.assetBytes)throw new Error('Photo exceeds the rendering limit.');
  if(signedIn){const r=await fetch('/api/customization/assets',{signal:AbortSignal.timeout(15000),method:'POST',headers:{'Content-Type':blob.type},body:blob});const out=await r.json();if(!r.ok)throw new Error(out.error||'Photo upload failed.');publicPhotos.add(out.id);return out;}
  const photos=await listLocalPhotos();if(photos.length>=L.assets||photos.reduce((n,a)=>n+a.blob.size,0)+blob.size>L.accountBytes)throw new Error('Photo storage is full. Remove an unused photo first.');
  const asset={id:newCustomizationId(),blob,width,height,type:blob.type,size:blob.size};await transaction('readwrite',s=>s.put(asset));return {id:asset.id,width,height,type:blob.type,size:blob.size};
}
export async function deletePhotoSticker(id,{signedIn=false}={}){
  if(!ASSET_ID_RE.test(id||''))return;
  if(signedIn){const r=await fetch('/api/customization/assets/'+id,{signal:AbortSignal.timeout(15000),method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error||'Photo removal failed.');}
  else await transaction('readwrite',s=>s.delete(id));publicPhotos.delete(id);releasePhotoUrl(id);
}
export async function decodeUserPhoto(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP photo.');
  if(file.size>L.uploadBytes)throw new Error('Choose a photo smaller than 8 MiB.');
  // Header check before decoding protects against extreme source dimensions.
  const header=new Uint8Array(await file.slice(0,65536).arrayBuffer());const view=new DataView(header.buffer);let w=0,h=0;
  if(file.type==='image/png'&&header.length>=24){w=view.getUint32(16);h=view.getUint32(20);}
  if(file.type==='image/jpeg'){let at=2;while(at+9<header.length){if(header[at++]!==255)break;while(header[at]===255)at++;const marker=header[at++],n=view.getUint16(at);if([192,193,194].includes(marker)){h=view.getUint16(at+3);w=view.getUint16(at+5);break;}if(n<2)break;at+=n;}}
  if(w>16384||h>16384||w*h>40e6)throw new Error('Photo dimensions are too large.');
  let image;try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw new Error('This photo could not be decoded.');}
  if(image.width>16384||image.height>16384||image.width*image.height>40e6){image.close();throw new Error('Photo dimensions are too large.');}return image;
}
// Square crop with horizontal/vertical framing, or fit preserving the full photo.
export async function renderPhotoSticker(image,{mode='fit',x=0,y=0,zoom=1}={}){
  let edge=L.imageEdge;
  for(let attempt=0;attempt<5;attempt++){
    const canvas=document.createElement('canvas');canvas.width=edge;canvas.height=edge;const c=canvas.getContext('2d');
    if(mode==='crop'){
      const side=Math.min(image.width,image.height)/Math.max(1,Math.min(3,zoom));
      const sx=(image.width-side)*Math.max(0,Math.min(1,(x+1)/2)),sy=(image.height-side)*Math.max(0,Math.min(1,(y+1)/2));c.drawImage(image,sx,sy,side,side,0,0,edge,edge);
    }else{const ratio=Math.min(edge/image.width,edge/image.height),w=image.width*ratio,h=image.height*ratio;c.drawImage(image,(edge-w)/2,(edge-h)/2,w,h);}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.84-attempt*.1));
    if(blob&&blob.size<=L.assetBytes)return {blob,width:edge,height:edge,canvas};edge=Math.round(edge*.75);
  }throw new Error('Photo could not be compressed. Try a simpler image.');
}
