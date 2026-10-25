import { canonicalJSON } from '../src/route-definition.js';
import { recoveryDataBytes, recoveryCanonicalSize } from './route-road-wire.mjs';
const numbers = ['halfLength','halfWidth','layer','leftM','offsetM','rightM','x','y','yaw','z'];
const numeric = new Set(numbers), stride = numbers.length + 1, rows = 128;
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
// Copy every ordered certified record, but store repeated proof metadata once.
// No cache object is retained: leases survive eviction without pinning a cell.
export function createRecoveryQueryBuilder({maxBytes,initialBytes=0}) {
 let retained=initialBytes+4096,scratch=0,peak=retained,count=0,finished=false,decodeScratch=0;
 let metadataIndex=new Map(); const footprintIndex=new Map(),footprints=[]; const metadata=[],chunks=[],edges=[],edgeRows=[],edgeSurfaces=[];
 const check=(extra=0)=>{peak=Math.max(peak,retained+scratch+extra);if(peak>maxBytes)throw Object.assign(Error('Recovery candidate memory budget exceeded'),{memory:{retained,scratch,peak,count,metadata:metadata.length,edges:edges.length,surfaces:edgeSurfaces.length,initialBytes}});}; check();
 const add=a=>{
  if(finished)throw Error('Recovery context already finalized');
  // Compare the exact old identity tuple against packed rows. No per-anchor
  // string/set allocation is needed, and the first encountered record wins.
  for(let i=0;i<count;i++){const row=chunks[Math.floor(i/rows)],o=i%rows*stride;if(row[o+4]===a.offsetM&&row[o+6]===a.x&&row[o+9]===a.z&&metadata[row[o+10]].edgeId===a.edgeId)return;}
  const working=recoveryDataBytes(a)*2+512;check(working);if(working>decodeScratch){retained+=working-decodeScratch;decodeScratch=working;}
  const m=Object.create(null); for(const key of Object.keys(a))if(!numeric.has(key)&&key!=='footprints')m[key]=a[key];
  let fp;
  if(Object.hasOwn(a,'footprints')){
   const key=canonicalJSON(a.footprints);let i=footprintIndex.get(key);
   if(i===undefined){const bytes=recoveryDataBytes(a.footprints)*2+key.length*2+128;check(bytes);retained+=bytes;i=footprints.length;footprints.push(freeze(structuredClone(a.footprints)));footprintIndex.set(key,i);}
   fp=i;
  }
  const size=recoveryCanonicalSize(m).codeUnits*2+64, objectBytes=recoveryDataBytes(m)*2;
  check(size+objectBytes+512);
  const key=canonicalJSON([m,fp??null]);let index=metadataIndex.get(key);
  if(index===undefined){index=metadata.length;retained+=objectBytes+128;scratch+=size+128;const copy=structuredClone(m);if(fp!==undefined)copy.footprints=footprints[fp];metadata.push(freeze(copy));metadataIndex.set(key,index);}
  if(count%rows===0){check(stride*rows*8*2+128);retained+=stride*rows*8*2+128;chunks.push(new Float64Array(stride*rows));}
  const row=chunks[Math.floor(count/rows)],offset=count%rows*stride;for(let i=0;i<numbers.length;i++)row[offset+i]=a[numbers[i]];row[offset+numbers.length]=index;count++;check();
 };
 return {add,addEdge(e){if(finished)throw Error('Recovery context already finalized');if(edges.includes(e.id))return;
   let surface=edgeSurfaces.indexOf(e.surface);
   const surfaceBytes=surface<0?64+e.surface.length*2:0;
   const rowBytes=edges.length%rows===0?rows*3*8*2+128:0;
   const bytes=64+e.id.length*2+surfaceBytes+rowBytes;check(bytes);retained+=bytes;
   if(surface<0){surface=edgeSurfaces.length;edgeSurfaces.push(e.surface);}
   if(rowBytes)edgeRows.push(new Float64Array(rows*3));const i=edges.length,o=i%rows*3,row=edgeRows[Math.floor(i/rows)];row[o]=e.layer;row[o+1]=surface;row[o+2]=e.flags;edges.push(e.id);
  },finish(){
  if(finished)throw Error('Recovery context already finalized');finished=true;metadataIndex=null;scratch=0;
  const candidates={length:count,*[Symbol.iterator](){for(let i=0;i<count;i++){const row=chunks[Math.floor(i/rows)],offset=i%rows*stride;const a={...metadata[row[offset+numbers.length]]};for(let j=0;j<numbers.length;j++)a[numbers[j]]=row[offset+j];yield Object.freeze(a);}},map(fn){const result=[];let bytes=retained,i=0;for(const a of this){const value=fn(a,i++);bytes+=recoveryDataBytes(value)*2+32;if(bytes>maxBytes)throw Error('Recovery candidate memory budget exceeded');result.push(value);}return result;}};
  const edgeView={length:edges.length,*[Symbol.iterator](){for(let i=0;i<edges.length;i++){const row=edgeRows[Math.floor(i/rows)],o=i%rows*3;yield {id:edges[i],layer:row[o],surface:edgeSurfaces[row[o+1]],flags:row[o+2]};}},map(fn){const result=[];let bytes=retained,i=0;for(const e of this){const value=fn(e,i++);bytes+=recoveryDataBytes(value)*2+32;if(bytes>maxBytes)throw Error('Recovery candidate memory budget exceeded');result.push(value);}return result;}};
  return {candidates:Object.freeze(candidates),edges:Object.freeze(edgeView),edgeFor(id){const i=edges.indexOf(id);if(i<0)return null;const row=edgeRows[Math.floor(i/rows)],o=i%rows*3;return {id:edges[i],layer:row[o],surface:edgeSurfaces[row[o+1]],flags:row[o+2]};},hasSurface(layer,surface){const s=edgeSurfaces.indexOf(surface);if(s<0)return false;for(let i=0;i<edges.length;i++){const row=edgeRows[Math.floor(i/rows)],o=i%rows*3;if(row[o]===layer&&row[o+1]===s)return true;}return false;},bytes:retained,peakBytes:peak};
 }};
}
