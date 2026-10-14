import {normalizeAppearance,normalizeDriver} from './customization-data.js';
import {savePaint,savedPaint} from './vehicle-paint.js';
import {createPresetRepository} from './customization-repository.js';
export {createPresetRepository};
const KEY='paraliaki.customization.guest.v1';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}');}catch{return {};}};
let loading;
const activeLooks=new Map();
export async function getCustomizationRepository(){
 if(!loading)loading=(async()=>{const repository=createPresetRepository({load:read,write:v=>{const latest=read();if((latest.revision||0)!==v.revision)throw new Error('Looks changed in another tab. Reload before saving.');const saved={...v,revision:v.revision+1};localStorage.setItem(KEY,JSON.stringify(saved));return saved;}});await repository.reload();return {repository};})().catch(e=>{loading=null;throw e;});
 return loading;
}
export function getDriverAppearance(carId){return normalizeDriver(activeLooks.get(carId)?.driver);}
export function currentCarAppearance(spec){return normalizeAppearance(activeLooks.get(spec.id)||{paint:savedPaint(spec),driver:getDriverAppearance(spec.id)});}
export function applyCustomization(spec,appearance,{onChange}={}){
 const clean=normalizeAppearance(appearance);activeLooks.set(spec.id,clean);savePaint(spec.id,clean.paint);
 globalThis.window?.dispatchEvent(new CustomEvent('customizationchange',{detail:{carId:spec.id,appearance:structuredClone(clean)}}));onChange?.(structuredClone(clean));return clean;
}
export async function syncSavedCustomization(){const {repository}=await getCustomizationRepository();const manifest=repository.snapshot();for(const p of manifest.presets)if(manifest.active[p.carId]===p.id)applyCustomization({id:p.carId},p);}
if(typeof window!=='undefined')queueMicrotask(()=>syncSavedCustomization().catch(()=>{}));
