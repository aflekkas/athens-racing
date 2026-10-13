// DOM/Three-free catalogue and validation shared by the garage and race server.
export const DECAL_COLORS = Object.freeze(['#ffffff','#111820','#e53935','#ffd23f','#168bda','#45c287']);
export const DECAL_POSITIONS = Object.freeze(['bonnet','doors','roof','rear']);
export const DECAL_LIBRARY = Object.freeze([
  {id:'stripes',name:'Twin racing stripes'},
  {id:'roundel',name:'Race number',number:true},
  {id:'athens',name:'ATHENS STREET RACERS'},
  {id:'greek_flag',name:'Greek flag'},
  {id:'flames',name:'Flames'},
  {id:'apex',name:'ASR Lab / original team mark'},
  {id:'ion',name:'Coast Works / original team mark'},
].map(d=>Object.freeze(d)));
export const MAX_DECALS=8;
export function normalizeDecals(list){
  if(!Array.isArray(list))return [];
  const result=[];
  for(const d of list.slice(0,MAX_DECALS)){
    if(!d||typeof d!=='object'||!DECAL_LIBRARY.some(v=>v.id===d.id)||!DECAL_POSITIONS.includes(d.position))continue;
    const color=typeof d.color==='string'&&/^#[a-f\d]{6}$/i.test(d.color)?d.color.toLowerCase():DECAL_COLORS[0];
    result.push({id:d.id,position:d.position,color,...(d.id==='roundel'?{number:Number.isInteger(d.number)?Math.max(0,Math.min(999,d.number)):7}:{})});
  }
  return result;
}
// Wire form: [art index, preset index, six hex digits, optional race number].
export function packDecals(list){return normalizeDecals(list).map(d=>[DECAL_LIBRARY.findIndex(v=>v.id===d.id),DECAL_POSITIONS.indexOf(d.position),d.color.slice(1),...(d.id==='roundel'?[d.number]:[])]);}
export function unpackDecals(list){
  if(!Array.isArray(list))return [];
  return normalizeDecals(list.slice(0,MAX_DECALS).filter(d=>Array.isArray(d)&&Number.isInteger(d[0])&&Number.isInteger(d[1])&&typeof d[2]==='string'&&/^[a-f\d]{6}$/i.test(d[2])).map(d=>({id:DECAL_LIBRARY[d[0]]?.id,position:DECAL_POSITIONS[d[1]],color:'#'+d[2],number:d[3]})));
}
