import {account} from './account.js';
import {CARS} from './cars.js';
import {normalizeAppearance,normalizeDriver} from './customization-data.js';
import {savePaint,savedPaint} from './vehicle-paint.js';
import {createPresetRepository} from './customization-repository.js';
export {createPresetRepository};
const GUEST_KEY='paraliaki.customization.guest.v1',BASELINE_KEY='paraliaki.customization.guest-baseline.v1';
const copy=v=>structuredClone(v),read=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}};
let repository,signedIn=false,generation=0,identity='';
const activeLooks=new Map(),guestBaseline=read(BASELINE_KEY);
async function request(method,body){const r=await fetch('/api/customization',{signal:AbortSignal.timeout(15000),method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const out=await r.json();if(!r.ok)throw new Error(out.error||'Preset synchronization failed.');return out;}
export async function getCustomizationRepository(){
  const me=account.cached()||await account.get().catch(()=>({guest:true})),signed=!!me&&!me.guest,key=signed?String(me.customizationKey||me.username):'guest';
  if(signed&&!me.username)throw new Error('Choose a unique public username in Driver Account first.');
  if(!repository||identity!==key){signedIn=signed;identity=key;
    const guarded=async(method,body)=>{const matches=()=>{const current=account.cached();return current&&!current.guest&&String(current.customizationKey||current.username)===key;};if(!matches())throw new Error('Account changed. Reopen customization.');const out=await request(method,body);if(!matches())throw new Error('Account changed. Reopen customization.');return out;};
    const next=createPresetRepository(signed?{load:()=>guarded('GET'),write:v=>guarded('PUT',v)}:{load:()=>read(GUEST_KEY),write:v=>{const latest=read(GUEST_KEY);if((latest.revision||0)!==v.revision)throw new Error('Guest presets changed in another tab. Reload before saving.');const saved={...v,revision:v.revision+1};localStorage.setItem(GUEST_KEY,JSON.stringify(saved));return saved;}});
    repository=next;await next.reload();
    if(repository!==next)throw new Error('Account changed. Reopen customization.');
  }
  return {repository,signedIn};
}
export function getDriverAppearance(carId){return normalizeDriver(activeLooks.get(carId)?.driver);}
export function currentCarAppearance(spec){return normalizeAppearance(activeLooks.get(spec.id)||{paint:savedPaint(spec),driver:getDriverAppearance(spec.id)});}
function publish(spec,clean,onChange){activeLooks.set(spec.id,clean);savePaint(spec.id,clean.paint);globalThis.window?.dispatchEvent(new CustomEvent('customizationchange',{detail:{carId:spec.id,appearance:copy(clean)}}));onChange?.(copy(clean));}
export function applyCustomization(spec,appearance,{onChange}={}){
  const clean=normalizeAppearance(appearance),signed=account.cached()&&!account.cached().guest;
  if(signed&&!guestBaseline[spec.id]){const full=CARS.find(c=>c.id===spec.id)||spec;guestBaseline[spec.id]=currentCarAppearance(full);try{localStorage.setItem(BASELINE_KEY,JSON.stringify(guestBaseline));}catch{}}
  if(!signed){guestBaseline[spec.id]=clean;try{localStorage.setItem(BASELINE_KEY,JSON.stringify(guestBaseline));}catch{}}
  publish(spec,clean,onChange);return clean;
}
export async function syncSavedCustomization(){const token=++generation;const state=await getCustomizationRepository();if(token!==generation)return;const manifest=state.repository.snapshot();for(const p of manifest.presets)if(manifest.active[p.carId]===p.id)applyCustomization({id:p.carId},p);}
account.onChange(me=>{
  const next=me&&!me.guest?String(me.customizationKey||me.username):'guest';if(next===identity)return;
  generation++;repository=null;identity='';activeLooks.clear();
  // Shared car APIs persist for rendering; restore guest baseline on account
  // switches so one account's uploaded face never becomes another's guest look.
  for(const [carId,look] of Object.entries(guestBaseline)){if(/^[a-z0-9_-]{1,32}$/.test(carId))publish({id:carId},normalizeAppearance(look));}
  syncSavedCustomization().catch(()=>{});
});
if(typeof window!=='undefined')queueMicrotask(()=>syncSavedCustomization().catch(()=>{}));
