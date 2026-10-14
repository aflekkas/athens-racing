// Physical appearance only. No dialogue, abilities, scores or identity metadata.
// Tune these plain looks when the user supplies additional appearance details.
const freezeLook=look=>Object.freeze({...look,...(look.passenger?{passenger:Object.freeze(look.passenger)}:{})});
export const CHARACTER_PRESETS=Object.freeze([
  Object.freeze({id:'alex_david',name:'Alex David',look:freezeLook({presetId:'alex_david',gender:'male',heightCm:163,build:'average',skin:'#b67c56',shirt:'#284c5e',hair:'#171411',hairStyle:'curly',hairVolume:1.65,helmet:false,accessory:'none'})}),
  Object.freeze({id:'alex_adelman',name:'Alex Adelman',look:freezeLook({presetId:'alex_adelman',gender:'male',heightCm:168,build:'average',skin:'#b67c56',shirt:'#686357',hair:'#30231c',hairStyle:'messy',hairVolume:1.15,helmet:false,accessory:'sprayCan',accessoryColor:'#ef57aa'})}),
  Object.freeze({id:'vasilis_pefaltes',name:'Vasilis Pefaltes',
    // TODO: Replace the neutral Vasilis and Jonia looks with user-supplied details.
    appearanceTODO:'Awaiting user appearance details for Vasilis Pefaltes and Jonia Peroti.',
    look:freezeLook({presetId:'vasilis_pefaltes',gender:'male',heightCm:175,build:'average',skin:'#b67c56',shirt:'#465568',hair:'#30231c',hairStyle:'short',hairVolume:1,helmet:false,accessory:'none',
      passenger:{id:'jonia_peroti',gender:'female',heightCm:165,build:'average',skin:'#b67c56',shirt:'#596879',hair:'#30231c',hairStyle:'long',hairVolume:1,helmet:false}})}),
]);
export const characterPreset=id=>CHARACTER_PRESETS.find(p=>p.id===id);
export const characterPresetLook=id=>{const p=characterPreset(id);return p?structuredClone(p.look):null;};
