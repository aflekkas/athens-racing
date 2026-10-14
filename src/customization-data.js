// Bounded JSON only. Image bytes live separately; no identity or external URLs.
import { normalizeDecals } from './vehicle-decal-data.js';
export const CUSTOMIZATION_LIMITS = Object.freeze({ presets:64, presetsPerCar:16, assets:16, assetBytes:96*1024, accountBytes:1536*1024, imageEdge:512, uploadBytes:8*1024*1024, manifestBytes:128*1024 });
export const ASSET_ID_RE=/^[a-f0-9]{32}$/;
export const DEFAULT_DRIVER=Object.freeze({skin:'#b67c56',shirt:'#16181c',hair:'#30231c',hairStyle:'curly',helmet:false});
export const color=(v,fallback)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)?v.toLowerCase():fallback;
export function normalizeDriver(d={}){return {skin:color(d?.skin,DEFAULT_DRIVER.skin),shirt:color(d?.shirt,DEFAULT_DRIVER.shirt),hair:color(d?.hair,DEFAULT_DRIVER.hair),hairStyle:['short','curly','none'].includes(d?.hairStyle)?d.hairStyle:DEFAULT_DRIVER.hairStyle,helmet:d?.helmet===true};}
const clamp=(v,min,max,fallback)=>Number.isFinite(v)?Math.round(Math.max(min,Math.min(max,v))*1000)/1000:fallback;
// Preserve the existing library API and extend only validated fields until its
// rendering owner lands the same extension in normalizeDecals.
export function normalizeStickerLayers(list){
  if(!Array.isArray(list))return [];
  return list.slice(0,8).flatMap(d=>{
    if(!d||typeof d!=='object')return [];
    let base=d.id==='photo'&&ASSET_ID_RE.test(d.assetId||'')&&['bonnet','doors','roof','rear'].includes(d.position)?{id:'photo',assetId:d.assetId,position:d.position,color:'#ffffff'}:normalizeDecals([d])[0];
    if(!base)return [];
    return [{...base,x:clamp(d.x,-1,1,0),y:clamp(d.y,-1,1,0),scale:clamp(d.scale,.2,2,1),rotation:clamp(d.rotation,-180,180,0),flipX:d.flipX===true}];
  });
}
export function normalizeAppearance(value={}){return {paint:color(value.paint,'#315476'),decals:normalizeStickerLayers(value.decals),driver:normalizeDriver(value.driver)};}
export function normalizePreset(value,cars){
  if(!value||typeof value!=='object'||!ASSET_ID_RE.test(value.id||'')||typeof value.carId!=='string'||!/^[a-z0-9_-]{1,32}$/.test(value.carId)||(cars&&!cars.has(value.carId)))return null;
  const name=String(value.name||'').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,40);
  if(!name)return null;
  return {id:value.id,name,carId:value.carId,...normalizeAppearance(value),updatedAt:Number.isSafeInteger(value.updatedAt)&&value.updatedAt>=0?value.updatedAt:0};
}
export function normalizeManifest(value,cars){
  const presets=[],seen=new Set(),counts=new Map();
  for(const v of (Array.isArray(value?.presets)?value.presets:[]).slice(0,CUSTOMIZATION_LIMITS.presets)){
    const p=normalizePreset(v,cars);if(!p||seen.has(p.id)||(counts.get(p.carId)||0)>=CUSTOMIZATION_LIMITS.presetsPerCar)continue;
    presets.push(p);seen.add(p.id);counts.set(p.carId,(counts.get(p.carId)||0)+1);
  }
  const active={};for(const p of presets)if(value?.active?.[p.carId]===p.id)active[p.carId]=p.id;
  return {version:1,revision:Number.isSafeInteger(value?.revision)&&value.revision>=0?value.revision:0,presets,active};
}
export function referencedAssets(manifest){return new Set((manifest.presets||[]).flatMap(p=>p.decals.filter(d=>d.id==='photo').map(d=>d.assetId)));}
export function newCustomizationId(){const b=crypto.getRandomValues(new Uint8Array(16));return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');}
