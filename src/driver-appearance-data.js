// DOM/Three-free appearance contract shared by Driver and multiplayer validation.
import {characterPreset} from './character-presets.js';
export const DEFAULT_DRIVER_APPEARANCE=Object.freeze({skin:'#b67c56',shirt:'#16181c',hair:'#30231c',hairStyle:'curly',helmet:false});
export const DRIVER_HAIR_STYLES=Object.freeze(['short','curly','messy','long','none']);
export const DRIVER_BUILDS=Object.freeze(['slim','average','broad']);
const bounded=(v,min,max,fallback)=>Number.isFinite(v)?Math.round(Math.max(min,Math.min(max,v))*1000)/1000:fallback;
function physicalLook(d){
  const result={...DEFAULT_DRIVER_APPEARANCE};
  for(const key of ['skin','shirt','hair'])if(typeof d[key]==='string'&&/^#[a-f\d]{6}$/i.test(d[key]))result[key]=d[key].toLowerCase();
  if(DRIVER_HAIR_STYLES.includes(d.hairStyle))result.hairStyle=d.hairStyle;
  result.helmet=d.helmet===true;
  if('heightCm'in d)result.heightCm=bounded(d.heightCm,140,210,175);
  if('hairVolume'in d)result.hairVolume=bounded(d.hairVolume,.5,1.8,1);
  if(DRIVER_BUILDS.includes(d.build))result.build=d.build;
  if(['male','female'].includes(d.gender))result.gender=d.gender;
  return result;
}
export function normalizeDriverAppearance(value){
  const input=value&&typeof value==='object'?value:{},preset=characterPreset(input.presetId),d={...preset?.look,...input};
  const result=physicalLook(d);
  if(preset)result.presetId=preset.id;
  if(['none','sprayCan'].includes(d.accessory))result.accessory=d.accessory;
  if(result.accessory==='sprayCan')result.accessoryColor=typeof d.accessoryColor==='string'&&/^#[a-f\d]{6}$/i.test(d.accessoryColor)?d.accessoryColor.toLowerCase():'#ef57aa';
  // Vasilis always travels with Jonia. Only one bounded passenger is allowed;
  // client fields cannot remove her, add a second passenger or insert nested data.
  if(preset?.id==='vasilis_pefaltes'){
    const source=input.passenger&&typeof input.passenger==='object'?input.passenger:{};
    result.passenger={...physicalLook({...preset.look.passenger,...source}),id:'jonia_peroti',gender:'female'};
  }
  return result;
}
