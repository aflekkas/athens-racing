// Offline metadata repair only. Never regenerate or re-encode authored geometry.
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../../src/baked-geometry.js';
import {tileTables} from '../../src/world-tile-format.js';
export const ORIGINAL_MEGARA_IMPORTER_SHA256='096bef3ee71d76dc6af8d98befb0afdd13ba550605b08d2f978c2b03725d2be5';
const hash=b=>createHash('sha256').update(b).digest('hex'),HEX=/^[a-f0-9]{64}$/,contracts=new WeakSet(),MAX_RAW=64*1024**2;
const freeze=o=>{if(o&&typeof o==='object'){for(const v of Object.values(o))freeze(v);Object.freeze(o);}return o;};
const fail=reason=>{throw Error('Megara graph repair: '+reason);};
const bytes=b=>typeof b==='string'?Buffer.from(b):Buffer.from(b.buffer,b.byteOffset,b.byteLength);
/** expectedManifestHash is the caller's immutable trust root, never derived from
 * the supplied manifest. The supported old importer was independently audited. */
export function megaraSurfaceRepairContract({manifestBytes,expectedManifestHash,mapBytes,contextBytes,importerBytes}){
 for(const [name,value]of Object.entries({manifestBytes,mapBytes,contextBytes}))if(value==null)fail('missing '+name);
 if(!HEX.test(expectedManifestHash)||hash(manifestBytes)!==expectedManifestHash)fail('original manifest hash');
 const manifest=JSON.parse(bytes(manifestBytes)),locks=manifest.sourceHashes;
 if(manifest.world!=='megara'||!HEX.test(manifest.revision)||!manifest.tiles||!locks)fail('original regional identity');
 for(const [path,body]of [['data/maps/megara/map.json',mapBytes],['tools/maps/megara/raw/context.json',contextBytes]])if(hash(body)!==locks[path])fail('source hash '+path);
 if(locks['tools/import-track-region.mjs']!==ORIGINAL_MEGARA_IMPORTER_SHA256||importerBytes!=null&&hash(importerBytes)!==ORIGINAL_MEGARA_IMPORTER_SHA256)fail('unsupported original importer');
 const map=JSON.parse(bytes(mapBytes)),context=JSON.parse(bytes(contextBytes)),ways=new Map(context.map(w=>[w.id,w])),roles={};
 if(map.id!=='megara'||!Array.isArray(map.roadNetwork?.roads))fail('source road network');
 for(const road of map.roadNetwork.roads){
  const part=road.part||0,tags=ways.get(road.id)?.tags,key=`${road.id}-${part}`;
  if(!Number.isSafeInteger(road.id)||!Number.isSafeInteger(part)||part<0||!tags||roles[key]||!Array.isArray(road.p)||road.p.length<4||road.p.length%2||!road.p.every(Number.isFinite))fail('source way identity '+key);
  const access=tags.motorcar??tags.motor_vehicle??tags.vehicle??tags.access,restricted=access!=null&&!['yes','permissive','designated'].includes(access)||Object.keys(tags).some(k=>k.endsWith(':conditional'));
  roles[key]=Object.freeze({oneway:!!road.oneway,flags:restricted?8:0});
 }
 const contract=Object.freeze({manifest:freeze(structuredClone(manifest)),manifestHash:expectedManifestHash,roles:Object.freeze(roles)});contracts.add(contract);return contract;
}
/** Copy the encoded payload intact, changing only the four bytes of approved
 * Uint32 edge surface words. ASR2 is deliberately unsupported, never transcoded. */
export function patchEncodedGraphSurfaceWords(raw,edits,newRevision,provenance){
 if(!HEX.test(newRevision)||!raw?.byteLength||raw.byteLength>MAX_RAW)fail('revision/raw budget');
 const input=bytes(raw),view=new DataView(input.buffer,input.byteOffset,input.byteLength);
 if(input.length<12||view.getUint32(0,true)!==0x31525341)fail('unsupported codec');
 const size=view.getUint32(4,true),start=view.getUint32(8,true);
 if(size>input.length-12||start<12+size||start>input.length||start%4)fail('packet header');
 const metadata=JSON.parse(input.subarray(12,12+size)),v=metadata.views?.[metadata.tables?.edges];
 if(metadata.version!==1||v?.type!=='Uint32Array'||!Number.isSafeInteger(v.offset)||v.offset<0||!Number.isSafeInteger(v.length)||v.length%10||start+v.offset+v.length*4>input.length)fail('edge view');
 const spans=metadata.views.map(a=>{if(a.codec!=null)fail('unsupported view codec');const width=globalThis[a.type]?.BYTES_PER_ELEMENT;if(!width||!Number.isSafeInteger(a.offset)||a.offset<0||!Number.isSafeInteger(a.length)||a.length<0||start+a.offset+a.length*width>input.length)fail('view bounds');return[a.offset,a.offset+a.length*width];}).filter(([a,b])=>a!==b).sort((a,b)=>a[0]-b[0]);
 for(let i=1;i<spans.length;i++)if(spans[i][0]<spans[i-1][1])fail('overlapping views');
 const payload=Buffer.from(input.subarray(start)),seen=new Set();
 for(const {word,from,to}of edits){
  if(!Number.isSafeInteger(word)||word<0||word>=v.length||word%10!==9||seen.has(word)||!Number.isSafeInteger(from)||from<0||from>0xffffffff||!Number.isSafeInteger(to)||to<0||to>0xffffffff)fail('surface edit');seen.add(word);
  const at=b=>v.offset+(v.shuffled||metadata.shuffled?b*v.length+word:word*4+b);let old=0;for(let b=0;b<4;b++)old+=(payload[at(b)]??0)*2**(8*b);if(old!==from)fail('stale edge word');
  for(let b=0;b<4;b++)payload[at(b)]=(to>>>(8*b))&255;
 }
 metadata.revision=newRevision;if(metadata.provenance){metadata.provenance={...metadata.provenance,revision:newRevision};}metadata.graphSurfaceRepair=provenance;
 const json=Buffer.from(JSON.stringify(metadata)),alignment=metadata.views.some(v=>v.type==='Float64Array')?8:4,newStart=Math.ceil((12+json.length)/alignment)*alignment,out=Buffer.alloc(newStart+payload.length);
 out.writeUInt32LE(0x31525341,0);out.writeUInt32LE(json.length,4);out.writeUInt32LE(newStart,8);json.copy(out,12);payload.copy(out,newStart);return out;
}
export function repairMegaraGraphCell(compressed,contract,{cell,newRevision}){
 if(!contracts.has(contract))fail('unverified source contract');if(!HEX.test(newRevision)||newRevision===contract.manifest.revision)fail('derived revision required');
 const entry=contract.manifest.tiles[cell];if(!entry||hash(compressed)!==entry.sha256||compressed.byteLength!==entry.bytes)fail('original cell hash/bytes');
 const raw=gunzipSync(compressed,{maxOutputLength:MAX_RAW});if(raw.length!==entry.decodedBytes)fail('original decoded bytes');
 const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
 if(new DataView(ab).getUint32(0,true)!==0x31525341)fail('unsupported codec');
 const old=decodeGeometryPack(ab),m=old.metadata,t=tileTables(old);
 if(m.world!=='megara'||m.revision!==contract.manifest.revision||m.cell?.join(',')!==cell)fail('original packet identity');
 const edits=[],target=m.ids.indexOf('surface:megaraNetwork');
 for(let i=0;i<t.edges.length;i+=10){
  const id=m.ids[t.edges[i]];if(!id?.startsWith('megara:e:way-'))continue;
  const match=/^megara:e:way-(\d+)-(\d+):([1-9]\d*):([fr])$/.exec(id),role=match&&contract.roles[`${match[1]}-${match[2]}`];
  if(!role||role.oneway&&match[4]==='r'||t.edges[i+8]!==role.flags||t.edgeLayers[i/10]!==0)fail('source edge identity/permissions '+id);
  if(m.ids[t.edges[i+9]]!=='surface:roads')fail('unexpected original graph surface '+id);
  let physical=false;for(let c=0;c<t.contactTriangles.length;c+=5)if(t.contactTriangles[c+3]===target&&(t.contactTriangles[c+4]&1)&&t.contactLayers[c/5]===t.edgeLayers[i/10]){physical=true;break;}
  if(target<0||!physical)fail('missing same-layer physical surface '+id);
  edits.push({word:i+9,from:t.edges[i+9],to:target});
 }
 if(!edits.length)return {changed:false,body:compressed,hash:entry.sha256,edges:0};
 const provenance={schemaVersion:1,contract:'megara-access-physical-surface-v1',originalManifestHash:contract.manifestHash,originalCellHash:entry.sha256,originalRevision:contract.manifest.revision},patched=patchEncodedGraphSurfaceWords(raw,edits,newRevision,provenance),next=decodeGeometryPack(patched.buffer.slice(patched.byteOffset,patched.byteOffset+patched.byteLength)),approved=new Map(edits.map(e=>[e.word,e.to])),edgeIndex=m.tables.edges;
 for(let i=0;i<old.arrays.length;i++){
  const a=old.arrays[i],b=next.arrays[i];if(i===edgeIndex){for(let word=0;word<a.length;word++)if(b[word]!== (approved.get(word)??a[word]))fail('edge preservation audit');}
  else if(!Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength)))fail('geometry preservation audit '+i);
 }
 const body=gzipSync(patched,{level:9});return {changed:true,body,hash:hash(body),edges:edits.length,decodedBytes:patched.length,provenance};
}
