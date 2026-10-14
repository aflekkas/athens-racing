import {normalizeManifest,normalizeAppearance,newCustomizationId,CUSTOMIZATION_LIMITS as L} from './customization-data.js';
const copy=v=>structuredClone(v);
export function createPresetRepository({load,write,clock=()=>Date.now(),id=newCustomizationId}={}){
  let value=normalizeManifest({});const persist=async next=>{const saved=normalizeManifest(await write(copy(next)));value=saved;return copy(saved);};
  return {
    async reload(){value=normalizeManifest(await load());return copy(value);},
    snapshot:()=>copy(value),
    forCar:carId=>value.presets.filter(p=>p.carId===carId).map(copy),
    selected:carId=>copy(value.presets.find(p=>p.id===value.active[carId])||null),
    async save(carId,name,appearance,presetId){
      const next=copy(value),existing=next.presets.find(p=>p.id===presetId&&p.carId===carId);
      if(!existing&&(next.presets.length>=L.presets||next.presets.filter(p=>p.carId===carId).length>=L.presetsPerCar))throw new Error('Preset limit reached. Delete an unused preset.');
      const clean=String(name||'').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,40);if(!clean)throw new Error('Give this preset a name.');
      const p={id:existing?.id||id(),name:clean,carId,...normalizeAppearance(appearance),updatedAt:clock()};
      if(existing)next.presets[next.presets.indexOf(existing)]=p;else next.presets.push(p);next.active[carId]=p.id;
      await persist(next);return copy(p);
    },
    async select(carId,presetId){const p=value.presets.find(p=>p.id===presetId&&p.carId===carId);if(!p)throw new Error('Preset not found for this car.');const next=copy(value);next.active[carId]=p.id;await persist(next);return copy(p);},
    async rename(presetId,name){const p=value.presets.find(p=>p.id===presetId);if(!p)throw new Error('Preset not found.');return this.save(p.carId,name,p,p.id);},
    async duplicate(presetId,name){const p=value.presets.find(p=>p.id===presetId);if(!p)throw new Error('Preset not found.');return this.save(p.carId,name||p.name+' copy',p);},
    async delete(presetId){const next=copy(value),p=next.presets.find(p=>p.id===presetId);if(!p)return;next.presets=next.presets.filter(p=>p.id!==presetId);if(next.active[p.carId]===presetId)delete next.active[p.carId];await persist(next);},
  };
}
