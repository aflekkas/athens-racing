// Separate storage keeps per-config seat choices independent of global settings.
const KEY='paraliaki.seat-position';
const clamp=v=>Number.isFinite(+v)?Math.max(-.08,Math.min(.08,+v)):0;
let saved={};try{saved=JSON.parse(globalThis.localStorage?.getItem(KEY)||'{}')||{};}catch{}
if(typeof saved!=='object'||Array.isArray(saved))saved={};
const zero=Object.freeze({height:0,position:0});
export function seatPosition(id){const s=saved[id];return s&&typeof s==='object'?s:zero;}
for(const id of Object.keys(saved)){const s=saved[id];saved[id]={height:clamp(s?.height),position:clamp(s?.position)};}
export function setSeatPosition(id,key,value){
  if(!id||!['height','position'].includes(key))return;
  saved[id]={...seatPosition(id),[key]:clamp(value)};
  try{globalThis.localStorage?.setItem(KEY,JSON.stringify(saved));}catch{}
}
export function resetSeatPosition(id){delete saved[id];try{globalThis.localStorage?.setItem(KEY,JSON.stringify(saved));}catch{}}
