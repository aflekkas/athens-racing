// Bounded paint and driver looks; legacy car stickers are ignored.
import { DEFAULT_DRIVER_APPEARANCE, normalizeDriverAppearance } from './driver-appearance-data.js';
export const CUSTOMIZATION_LIMITS = Object.freeze({ presets:64, presetsPerCar:16, manifestBytes:128*1024 });
export const ASSET_ID_RE=/^[a-f0-9]{32}$/;
export const DEFAULT_DRIVER=DEFAULT_DRIVER_APPEARANCE;
export const color=(v,fallback)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)?v.toLowerCase():fallback;
export const normalizeDriver=normalizeDriverAppearance;
// Older manifests may contain decals; normalization deliberately ignores them.
export function normalizeAppearance(value={}){return {paint:color(value.paint,'#315476'),driver:normalizeDriver(value.driver)};}
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
export function newCustomizationId(){const b=crypto.getRandomValues(new Uint8Array(16));return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');}
