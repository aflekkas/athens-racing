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
export const PHOTO_ASSET_ID=/^[a-f\d]{32}$/i;
const transformDefaults={x:0,y:0,scale:1,rotation:0};
const transformBounds={x:[-1,1],y:[-1,1],scale:[.2,2],rotation:[-180,180]};
export function normalizeDecals(list){
  if(!Array.isArray(list))return [];
  const result=[];
  for(const d of list.slice(0,MAX_DECALS)){
    if(!d||typeof d!=='object'||!(d.id==='photo'||DECAL_LIBRARY.some(v=>v.id===d.id))||!DECAL_POSITIONS.includes(d.position))continue;
    if(d.id==='photo'&&(typeof d.assetId!=='string'||!PHOTO_ASSET_ID.test(d.assetId)))continue;
    const color=typeof d.color==='string'&&/^#[a-f\d]{6}$/i.test(d.color)?d.color.toLowerCase():DECAL_COLORS[0];
    const layer={id:d.id,position:d.position,color,...(d.id==='roundel'?{number:Number.isInteger(d.number)?Math.max(0,Math.min(999,d.number)):7}:{}),...(d.id==='photo'?{assetId:d.assetId.toLowerCase()}:{})};
    for(const [key,fallback] of Object.entries(transformDefaults)){
      const [min,max]=transformBounds[key],value=Number.isFinite(d[key])?Math.round(Math.max(min,Math.min(max,d[key]))*1000)/1000:fallback;
      if(value!==fallback)layer[key]=value;
    }
    if(d.flipX===true)layer.flipX=true;
    result.push(layer);
  }
  return result;
}
// Legacy tuples stay unchanged. Extended: [art,preset,hex,number|null,x,y,scale,
// rotation,flipX(0|1),assetId?]. Photo art index is 7; never carry URLs or image bytes.
export function packDecals(list){return normalizeDecals(list).map(d=>{
  const tuple=[d.id==='photo'?7:DECAL_LIBRARY.findIndex(v=>v.id===d.id),DECAL_POSITIONS.indexOf(d.position),d.color.slice(1)];
  if(d.id==='photo'||d.x!==undefined||d.y!==undefined||d.scale!==undefined||d.rotation!==undefined||d.flipX)tuple.push(d.number??null,d.x??0,d.y??0,d.scale??1,d.rotation??0,d.flipX?1:0,...(d.id==='photo'?[d.assetId]:[]));
  else if(d.id==='roundel')tuple.push(d.number);
  return tuple;
});}
export function unpackDecals(list){
  if(!Array.isArray(list))return [];
  return normalizeDecals(list.slice(0,MAX_DECALS).filter(d=>Array.isArray(d)&&Number.isInteger(d[0])&&Number.isInteger(d[1])&&typeof d[2]==='string'&&/^[a-f\d]{6}$/i.test(d[2])).map(d=>({id:d[0]===7?'photo':DECAL_LIBRARY[d[0]]?.id,position:DECAL_POSITIONS[d[1]],color:'#'+d[2],number:d[3],x:d[4],y:d[5],scale:d[6],rotation:d[7],flipX:d[8]===1,assetId:d[9]})));
}
