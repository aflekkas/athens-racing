// Source-only, one ORIGINAL cell at a time. No fetch, writes, manifest or readiness.
// Stage inputs are reviewed bytes/paths + SHA pins, never executable callbacks.
import {createHash} from 'node:crypto';
import {open,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {relative} from 'node:path';
import {types as nativeTypes} from 'node:util';
import {decodePinnedSourceCell,repairBuildingTables,repairPlanSha256,packFingerprint,repairedSpool,auditRepairedPacket} from './repair-infill.mjs';
import {readBridgeGuardRecipe,prepareBridgeGuardRepair,rebuildBridgeGuards} from './bridge-guards.mjs';
import {conformMarkingSurfaces} from './marking-surface.mjs';
import {TERRAIN_FIELDS,requireTerrainAcceptance} from './terrain-acceptance.mjs';
import {terrainReliefField,refineTerrainRelief} from './terrain-relief.mjs';
import {encodeTile} from './pack.mjs';
import {applySceneryVegetation} from '../scenery-cell.mjs';
import {assertVegetationClearance} from '../audit-world-vegetation.mjs';
import {tileTables,validateWorldTile} from '../../src/world-tile-format.js';
import {prepareTilePacket} from '../../src/world-tile-worker.js';
import {parsePlazas,plazaDistance} from '../../src/athens-plazas.js';
import {forecourtPlazas,insideLandmark} from '../../src/athens-landmarks.js';

const MAX=64*1024*1024,WIRE_MAX=25*1024*1024;
const modules={assembler:'./mutate-cell.mjs',infill:'./repair-infill.mjs',terrain:'./terrain-relief.mjs',paint:'./marking-surface.mjs',guards:'./bridge-guards.mjs',scenery:'../scenery-cell.mjs'};
const dependencyFiles=['./pack.mjs','./infill.py','./model.py','./buildings.py','./terrain-acceptance.mjs','./areas/authored-guard-preservation.json','../audit-world-vegetation.mjs','../world-surface-audit.mjs','../world-bridge-audit.mjs','../world-roads-audit.mjs','../world-bore-audit.mjs','../../src/baked-geometry.js','../../src/world-tile-format.js','../../src/world-tile-worker.js','../../src/world-tile-buildings.js','../../src/world-tile-trees.js','../../src/world-tile-ground.js','../../src/world-tile-parking.js','../../src/world-tile-obstacles.js','../../src/vegetation-clearance.js','../../src/world-tile-psychiko.js','../../src/psychiko-building-data.js','../../src/world-tile-coast.js','../../src/coastal-dressing-data.js','../../src/athens-plazas.js','../../src/athens-landmarks.js','../../assets/athens/plazas.json'];
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const nativeSlots=Object.fromEntries(['buffer','byteOffset','byteLength','length'].map(k=>[k,Object.getOwnPropertyDescriptor(typedPrototype,k).get]));
const backingLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const resizableSlot=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const typedKinds=new Map([[Buffer.prototype,'Uint8Array'],...[Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array].map(T=>[T.prototype,T.name])]);
const reservedViewKeys=new Set(['buffer','byteOffset','byteLength','length','constructor','maxByteLength','resizable','detached','growable',Symbol.toPrimitive,Symbol.species]);
for(const root of [Buffer.prototype,Uint8Array.prototype,ArrayBuffer.prototype])for(let proto=root;proto;proto=Object.getPrototypeOf(proto))for(const key of Reflect.ownKeys(proto))reservedViewKeys.add(key);
function viewSlots(value,bytesOnly=false){
 if(!nativeTypes.isTypedArray(value)||bytesOnly&&!nativeTypes.isUint8Array(value))fail('native byte/typed array required');
 const type=typedKinds.get(Object.getPrototypeOf(value));if(!type)fail('custom typed-array prototype forbidden');
 for(const key of reservedViewKeys)if(Object.hasOwn(value,key))fail('typed-array layout/method shadow forbidden');
 const buffer=Reflect.apply(nativeSlots.buffer,value,[]);
 if(!nativeTypes.isArrayBuffer(buffer)||Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype)fail('shared/custom backing store forbidden');
 for(const key of reservedViewKeys)if(Object.hasOwn(buffer,key))fail('backing-store layout/method shadow forbidden');
 if(resizableSlot&&Reflect.apply(resizableSlot,buffer,[]))fail('resizable backing store forbidden');
 const backingBytes=Reflect.apply(backingLength,buffer,[]),byteOffset=Reflect.apply(nativeSlots.byteOffset,value,[]),byteLength=Reflect.apply(nativeSlots.byteLength,value,[]),length=Reflect.apply(nativeSlots.length,value,[]);
 if(backingBytes>MAX)fail('true backing-store workspace budget before clone');
 return {buffer,backingBytes,byteOffset,byteLength,length,type};
}
const byteView=value=>{const v=viewSlots(value);return new Uint8Array(v.buffer,v.byteOffset,v.byteLength);};
const byteWindow=(value,start,end)=>{const v=viewSlots(value,true);if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(end)||end<start||end>v.byteLength)fail('byte window bounds');return new Uint8Array(v.buffer,v.byteOffset+start,end-start);};
const utf8Text=value=>new TextDecoder().decode(byteView(value));
const copyBytes=value=>{const v=viewSlots(value,true),copy=Buffer.alloc(v.byteLength);Uint8Array.prototype.set.call(copy,new Uint8Array(v.buffer,v.byteOffset,v.byteLength));return copy;};
const sha=b=>createHash('sha256').update(typeof b==='string'?b:byteView(b)).digest('hex');
const fail=s=>{throw Error('Cell mutation: '+s);};
const canonical=v=>JSON.stringify(order(v));
function denseArray(value){
 if(nativeTypes.isProxy(value)||!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('array must be plain dense data');
 const length=Object.getOwnPropertyDescriptor(value,'length');
 if(!length||!Object.hasOwn(length,'value')||length.enumerable||!Number.isSafeInteger(length.value)||length.value<0)fail('array length descriptor');
 // Admit the dense index/key scan before materializing its own-key list. This
 // is validation scratch, never a copy of the caller's element values.
 if(128+length.value*256>MAX)fail('declarative array descriptor workspace budget before copy');
 const names=Reflect.ownKeys(value);
 if(names.length!==length.value+1||names[length.value]!=='length')fail('unexpected array own property/accessor/symbol/hidden field');
 for(let i=0;i<length.value;i++){
  if(names[i]!==String(i))fail('array must have only dense indices and length');
  const d=Object.getOwnPropertyDescriptor(value,names[i]);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('array indexed accessor/hidden field');
 }
 return length.value;
}
function order(v){
 if(nativeTypes.isProxy(v))fail('proxy stage input forbidden');
 if(ArrayBuffer.isView(v)){const slots=viewSlots(v,true);return {bytes:slots.byteLength,sha256:sha(v)};}
 if(Array.isArray(v)){denseArray(v);return v.map(order);}
 if(v&&typeof v==='object'){
  if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)fail('stage input must be plain data');
  const out=Object.create(null);for(const k of Object.keys(v).sort()){if(!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))fail('accessor stage input');out[k]=order(v[k]);}return out;
 }
 if(typeof v==='function'||typeof v==='symbol'||typeof v==='bigint'||v===undefined||typeof v==='number'&&!Number.isFinite(v))fail('stage input must be finite data, not callbacks');
 return v;
}
const same=(a,b,label)=>{if(canonical(a)!==canonical(b))fail(label);};
const digest=v=>sha(canonical(v));
const arrayDigest=a=>{const v=viewSlots(a);return digest([v.type,v.length,sha(byteView(a))]);};
const validHash=(h,label)=>{if(!/^[a-f0-9]{64}$/.test(h||''))fail(label+' SHA required');};
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){if(Array.isArray(v)){for(let i=0;i<v.length;i++)freeze(v[i]);}else for(const k in v)if(Object.hasOwn(v,k))freeze(v[k]);Object.freeze(v);}return v;};
function keys(v,allowed,label){
 if(!v||typeof v!=='object'||nativeTypes.isProxy(v)||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('unsupported '+label+' (callbacks forbidden)');
 for(const k of allowed){const d=Object.getOwnPropertyDescriptor(v,k);if(d&&!Object.hasOwn(d,'value'))fail('accessor '+label);}
 for(const k in v)if(Object.hasOwn(v,k)){
  const d=Object.getOwnPropertyDescriptor(v,k);if(!Object.hasOwn(d,'value'))fail('accessor '+label);
  if(!allowed.includes(k))fail('unsupported '+label+' (callbacks and undeclared fields forbidden)');
 }
}
// Scan authenticated UTF-8 bytes without a Buffer copy, string or parsed tree.
// Token bounds deliberately overcount keys as both strings and properties;
// decoded UTF-16 length cannot exceed the source byte count (including escapes).
function pinnedJSONHeap(bytes,label='pinned JSON'){
 bytes=byteView(bytes);let heap=128;
 for(let i=0;i<bytes.length;){const c=bytes[i++];
  if(c===34){const start=i;let closed=false;while(i<bytes.length){const b=bytes[i++];if(b===92){i++;continue;}if(b===34){closed=true;break;}}if(!closed)fail('invalid pinned JSON string');heap+=328+4*(i-start);}
  else if(c===91||c===123)heap+=136;
  else if(c===93||c===125||c===44||c===58||c===32||c===9||c===10||c===13)continue;
  else {heap+=72;while(i<bytes.length&&bytes[i]!==44&&bytes[i]!==93&&bytes[i]!==125&&bytes[i]!==32&&bytes[i]!==9&&bytes[i]!==10&&bytes[i]!==13&&bytes[i]!==58)i++;}
  if(heap>MAX)fail(label+' workspace budget before input copy/UTF8/parse');
 }return heap;
}
function reservePinnedInputs(value){
 if(nativeTypes.isUint8Array(value)){const slots=viewSlots(value,true);
  // Four complete parse/conversion histories cover assembler + helper rereads,
  // including guard recipes and preservation registries; no GC release credit.
  return 4*(pinnedJSONHeap(byteView(value))+7*slots.byteLength);
 }
 let n=0;if(value&&typeof value==='object')for(const k in value)if(Object.hasOwn(value,k)){
  if(nativeTypes.isUint8Array(value[k])){
   const pin={bytes:'sha256',planBytes:'planFileSha256',compiledBytes:'compiledSha256',sourcePlanBytes:'sourcePlanSha256',atlasBytes:'atlasSha256',reportBytes:'reportSha256'}[k];
   if(!pin)fail('unrecognized pinned JSON input');validHash(value[pin],k);if(sha(value[k])!==value[pin])fail(k+' byte hash mismatch');
  }
  n+=reservePinnedInputs(value[k]);if(n>MAX)fail('pinned JSON workspace budget before input copy/UTF8/parse');
 }return n;
}
function admitPinned(memory){if(!memory||memory.inputCopies+memory.inputObjects+memory.parsedInputs+(memory.sourceRetained||0)+(memory.proofRetained||0)+(memory.files||0)+(memory.prepared||0)>MAX)fail('pinned JSON live workspace budget before input copy/UTF8/parse');}
function pinnedJSON(bytes,hash,label,memory){
 validHash(hash,label);const slots=viewSlots(bytes,true);if(sha(bytes)!==hash)fail(label+' byte hash mismatch');
 const heap=pinnedJSONHeap(bytes);admitPinned(memory);if(4*(heap+7*slots.byteLength)>memory.parsedInputs)fail('pinned JSON missing preparse reservation');
 // Zero-copy byte view; its shared storage was charged before the input snapshot.
 const text=utf8Text(bytes);
 const value=JSON.parse(text);if(jsonMemory(value).heap>heap)fail('pinned JSON heap bound');return value;
}

async function boundedFileBytes(path,expectedSize){
 const handle=await open(path,'r');try{
  const before=await handle.stat();if(!before.isFile()||before.size!==expectedSize)fail('file changed before bounded read');
  const bytes=Buffer.alloc(expectedSize+1);let offset=0;
  while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  const after=await handle.stat();if(offset!==expectedSize||after.size!==expectedSize||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('file changed during bounded read');
  return byteWindow(bytes,0,expectedSize);
 }finally{await handle.close();}
}
/** Pin .assembler and canonical digest(result) in derived.codeProofSha256; pin stage hashes too. */
export async function mutationCodeProof({retainedBytes=0}={}){
 if(!Number.isSafeInteger(retainedBytes)||retainedBytes<0||retainedBytes>MAX)fail('code proof retained budget');
 let codeReadBytes=0;async function readCode(url){const info=await stat(url);if(!info.isFile()||retainedBytes+4*(codeReadBytes+Math.max(info.size,8192))+1024*1024>MAX)fail('code proof workspace budget');codeReadBytes+=Math.max(info.size,8192);const b=await boundedFileBytes(url,info.size);if(b.byteLength!==info.size)fail('code proof changed while reading');return b;}
 const code=Object.fromEntries(await Promise.all(Object.entries(modules).map(async([name,path])=>[name,sha(await readCode(new URL(path,import.meta.url)))])));
 const pending=[...Object.values(modules),...dependencyFiles,'../../package-lock.json'].map(p=>new URL(p,import.meta.url)),seen=new Set(),dependencies={},root=fileURLToPath(new URL('../../',import.meta.url));
 while(pending.length){const url=pending.pop();if(seen.has(url.href))continue;seen.add(url.href);const label=relative(root,fileURLToPath(url));if(label.startsWith('..'))fail('code dependency outside repository');const b=await readCode(url);dependencies[label]=sha(b);
  if(/\.m?js$/.test(url.pathname))for(const match of utf8Text(b).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g))pending.push(new URL(match[1],url));
 }
 code.dependencies=dependencies;code.readReservationBytes=codeReadBytes*4;return code;
}
/** Recipe digest excludes itself; includes complete scope/registry and exact stage bytes. */
export function mutationRecipeSha256({source,derived,stages={},protectedSources=null,releaseScope}){
 return digest({schema:1,source,derived:{world:derived.world,revision:derived.revision,assemblerSha256:derived.assemblerSha256,codeProofSha256:derived.codeProofSha256},stages,protectedSources,releaseScope});
}
function authenticate(bytes,entry,source,memory){
 if(!entry||viewSlots(bytes,true).byteLength!==entry.bytes||sha(bytes)!==entry.sha256)fail('original compressed hash/size mismatch');
 if(!Number.isSafeInteger(entry.decodedBytes)||entry.decodedBytes<12||entry.decodedBytes>MAX||entry.bytes>WIRE_MAX)fail('original decode budget');
 if(!source||typeof source.world!=='string'||!source.world||typeof source.revision!=='string'||!source.revision||!Array.isArray(source.cell)||source.cell.length!==2||!source.cell.every(Number.isSafeInteger))fail('original source identity');
 if(!entry.source||typeof entry.source.regionId!=='string'||!entry.source.regionId)fail('pinned entry.source required');
 same([entry.source.world,entry.source.revision],[source.world,source.revision],'entry source identity mismatch');
 // decodePinnedSourceCell is intentionally used only AFTER this bounded envelope check.
 // Reserve inflater chunks + flattened output before the bounded inflate.
 memory.sourceRetained=3*Math.max(entry.decodedBytes,65536);admitPinned(memory);
 const raw=gunzipSync(bytes,{maxOutputLength:entry.decodedBytes});
 if(raw.length<12||raw.readUInt32LE(0)!==0x31525341)fail('original ASR1 header');
 const size=raw.readUInt32LE(4),start=raw.readUInt32LE(8);
 if(size>raw.length-12||start<12+size||start>raw.length||start%4)fail('original codec header');
 const segment=byteWindow(raw,12,12+size),metadataHeap=pinnedJSONHeap(segment,'original metadata');
 // Authentication, direct decoder, guard header, guarded codec envelope and
 // geometry decoder: at most five parses. Reserve six complete histories,
 // including canonical proof copies, strings and inflater/array-copy scratch.
 const retainedBytes=15*Math.max(viewSlots(raw).backingBytes,viewSlots(raw).length,65536)+6*(metadataHeap+6*size);
 memory.sourceRetained=retainedBytes;admitPinned(memory);
 const m=JSON.parse(utf8Text(segment));if(jsonMemory(m).heap>metadataHeap)fail('original metadata heap bound');if(m.version!==1||!Array.isArray(m.views))fail('original codec format');
 const types={Int8Array:1,Uint8Array:1,Uint8ClampedArray:1,Int16Array:2,Uint16Array:2,Int32Array:4,Uint32Array:4,Float32Array:4,Float64Array:8};let allocation=0;
 for(const v of m.views){const width=types[v.type],length=v.length*width;if(!width||!Number.isSafeInteger(v.length)||v.length<0||!Number.isSafeInteger(v.offset)||v.offset<0||v.offset%width||start+v.offset+length>raw.length||!Number.isSafeInteger(length)||(allocation+=length)>entry.decodedBytes)fail('original codec decoded budget/views');}
 same([m.world,m.revision,m.cell],[source.world,source.revision,source.cell],'original header source identity');
 return {retainedBytes,metadataHeap,inflatedBytes:raw.length,inflatedBackingBytes:Math.max(viewSlots(raw).backingBytes,65536),arrayBytes:allocation,metadataBytes:size,guardDecode:!!m.rails?.length};
}
function scopeOf(input,entry,source,memory){
 const scope=pinnedJSON(input?.bytes,input?.sha256,'release scope',memory);
 if(scope.schema!=='cell-mutation-scope-1'||!Array.isArray(scope.cells)||!scope.cells.length)fail('complete release scope required');
 validHash(scope.sourceManifestSha256,'scope original manifest');
 const seen=new Set();for(const pin of scope.cells){if(!Array.isArray(pin.cell)||pin.cell.length!==2||!pin.cell.every(Number.isSafeInteger))fail('scope cell');const k=pin.cell.join(',');if(seen.has(k))fail('duplicate release scope cell');seen.add(k);validHash(pin.sha256,'scope cell');}
 const pin=scope.cells.find(p=>canonical(p.cell)===canonical(source.cell));
 if(!pin||pin.sha256!==entry.sha256)fail('scope source cell SHA mismatch');same(pin.source,entry.source,'scope source family mismatch');return scope;
}
function protectedBinding(registry,entry,source,scope,memory){
 const native=entry.source.regionId==='penteli'||entry.source.regionId==='megara'||source.world==='penteli'||source.world==='megara';
 if(!registry){if(native)fail('native source requires pinned original manifest registry');return false;}
 keys(registry,['manifests'],'preservation registry');if(!Array.isArray(registry.manifests))fail('preservation manifests');
 let found=false;const seenFamilies=new Set();
 for(const family of registry.manifests){
  keys(family,['regionId','bytes','sha256'],'preservation family');if(seenFamilies.has(family.regionId))fail('duplicate native manifest family');seenFamilies.add(family.regionId);
  const manifest=pinnedJSON(family.bytes,family.sha256,'preservation original manifest',memory);
  if(!['penteli','megara'].includes(family.regionId)||manifest.world!==family.regionId||!manifest.revision||!manifest.tiles)fail('unknown native manifest family');
  const expectedCount=family.regionId==='penteli'?225:72;
  if(Object.keys(manifest.tiles).length!==expectedCount)fail('native manifest family coverage');
  if(family.regionId!==entry.source.regionId)continue;
  if(source.world!==manifest.world||source.revision!==manifest.revision)fail('native original family identity');
  if(scope.sourceManifestSha256!==family.sha256&&!scope.protectedManifestSha256s?.includes(family.sha256))fail('native manifest not bound to release scope');
  const original=manifest.tiles[source.cell.join(',')];if(!original)fail('native cell absent from original manifest');
  same(original,entry,'native original entry binding');found=true;
 }
 if(native&&!found)fail('native source absent from pinned registry');return found;
}
export function snapshotSceneryInvariants(pack){return {metadata:structuredClone(pack.metadata),arrays:pack.arrays.map(arrayDigest),tables:digest(Object.fromEntries(Object.entries(tileTables(pack)).map(([k,a])=>[k,arrayDigest(a)])))};}
const overlap=(a,b)=>{const x=viewSlots(a),y=viewSlots(b);return x.buffer===y.buffer&&x.byteOffset<y.byteOffset+y.byteLength&&y.byteOffset<x.byteOffset+x.byteLength;};
/** Only three private vegetation arrays may append; every prior byte/other field is immutable. */
export function assertSceneryInvariance(before,pack,{added=0}={}){
 const v=pack.metadata.extensions?.worldDetail?.vegetation,old=before.metadata.extensions?.worldDetail?.vegetation;
 if(!v||!old)fail('scenery vegetation schema');
 if(pack.arrays.length!==before.arrays.length+(added?3:0))fail('scenery undeclared arrays');
 for(let i=0;i<before.arrays.length;i++)if(before.arrays[i]!==arrayDigest(pack.arrays[i]))fail('scenery changed pre-existing array '+i);
 const m=structuredClone(pack.metadata);m.extensions.worldDetail.vegetation=structuredClone(old);same(m,before.metadata,'scenery changed physical/other metadata');
 if(before.tables!==digest(Object.fromEntries(Object.entries(tileTables(pack)).map(([k,a])=>[k,arrayDigest(a)]))))fail('scenery changed logical physical tables');
 for(const [i,key]of ['positionHeight','kind','seed'].entries()){
  if(v[key]!== (added?before.arrays.length+i:old[key]))fail('scenery vegetation array alias/index');
  if(added&&pack.arrays.slice(0,before.arrays.length).some(a=>overlap(a,pack.arrays[v[key]])))fail('scenery appended alias into original array');
 }
 // No extra vegetation metadata keys can hide ownership changes.
 const scrub=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!['positionHeight','kind','seed'].includes(k)));
 same(scrub(v),scrub(old),'scenery vegetation metadata drift');return {allOriginalArraysByteExact:true,allLogicalTablesByteExact:true,allOtherMetadataExact:true,privateAppendedArrays:added?3:0};
}
async function sceneryExclusions(pack,entry,memory,code){
 const prepared=prepareTilePacket(structuredClone(pack),{...pack.metadata,entry:{...entry,triangles:pack.metadata.budgets.triangles,decodedBytes:MAX,residentBytes:MAX}}),d=prepared.metadata.extensions?.worldDetail,occupied=[];
 for(const [index,stride,pad]of [[d?.parking,5,3],[d?.props?.rows,5,2],[d?.signals?.rows,6,2]])if(index!=null){const a=prepared.arrays[index];for(let i=0;i<a.length;i+=stride)occupied.push([a[i],a[i+2],pad]);}
 const path=new URL('../../assets/athens/plazas.json',import.meta.url),info=await stat(path);if(!info.isFile()||info.size>MAX)fail('plaza source byte budget');
 memory.files+=2*(info.size+1);admitPinned(memory);const bytes=await boundedFileBytes(path,info.size);if(sha(bytes)!==code.dependencies['assets/athens/plazas.json'])fail('plaza source proof changed');
 const heap=pinnedJSONHeap(bytes);memory.parsedInputs+=4*(heap+7*bytes.length);admitPinned(memory);
 const parsed=JSON.parse(utf8Text(bytes));if(jsonMemory(parsed).heap>heap)fail('plaza source heap bound');
 const plazas=[...parsePlazas(parsed),...forecourtPlazas()];
 const blocked=(x,z,r)=>plazas.some(q=>x>=q.x0-r&&x<=q.x1+r&&z>=q.z0-r&&z<=q.z1+r&&plazaDistance(q.p,x,z)<=r)||[-r,0,r].some(dx=>[-r,0,r].some(dz=>insideLandmark(x+dx,z+dz)));
 return {blocked,occupied,retainedBytes:prepared.bytes};
}
const STAGE_FIELDS={infill:['codeSha256','planBytes','planFileSha256','reviewedPlanSha256','sourcePath'],terrain:['codeSha256','fieldId','atlasBytes','atlasSha256','reportBytes','reportSha256'],paint:['codeSha256'],guards:['codeSha256','recipes'],scenery:['codeSha256','bytes','sha256']};
function validateStageInputs(stages){
 keys(stages,['infill','terrain','paint','guards','scenery'],'stages');
 for(const name in stages)if(Object.hasOwn(stages,name)){
  const stage=stages[name];keys(stage,STAGE_FIELDS[name],name+' stage');
  for(const key in stage)if(Object.hasOwn(stage,key)){
   const value=stage[key];if(key==='recipes'){
    if(!Array.isArray(value))fail('guard recipes must be declarative array');
    const count=denseArray(value);for(let i=0;i<count;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))fail('accessor/sparse guard recipes');const recipe=d.value;keys(recipe,['compiledBytes','sourcePlanBytes','compiledSha256','sourcePlanSha256'],'guard recipe');for(const field in recipe)if(Object.hasOwn(recipe,field)&&!(field.endsWith('Bytes')?nativeTypes.isUint8Array(recipe[field]):typeof recipe[field]==='string'))fail('declarative guard recipe field');}
   }else if(!(key.endsWith('Bytes')||key==='bytes'?nativeTypes.isUint8Array(value):typeof value==='string'))fail('declarative '+name+' stage field (callbacks forbidden)');
  }
 }
}
function verifyStage(name,stage,code){keys(stage,STAGE_FIELDS[name],name+' stage');if(stage.codeSha256!==code[name])fail(name+' code hash mismatch');}
function actualIdentity(pack,expected){same([pack.metadata.world,pack.metadata.revision,pack.metadata.cell],[expected.world,expected.revision,expected.cell],'actual packet identity');}
function binaryInputBytes(value,seen=new Set()){
 if(ArrayBuffer.isView(value)){const v=viewSlots(value,true);if(seen.has(v.buffer))return 0;seen.add(v.buffer);return v.backingBytes;}
 let n=0;if(value&&typeof value==='object')for(const k in value)if(Object.hasOwn(value,k))n+=binaryInputBytes(value[k],seen);return n;
}
function inputBackingReservation(input){
 const originalBytes=binaryInputBytes(input);let cloneBytes=0;
 // Each structuredClone call preserves aliases inside its group, but copies a
 // shared backing again across separate calls. The compressed copy is a window.
 for(const key of ['entry','source','derived','stages','protectedSources','releaseScope'])cloneBytes+=binaryInputBytes(input[key]);
 const compressedCopyBytes=viewSlots(input.compressedBytes,true).byteLength;
 return {originalBytes,cloneBytes,compressedCopyBytes,totalBytes:originalBytes+cloneBytes+compressedCopyBytes};
}
// V8 workspace reservation, not a claim about measured RSS or immediate GC.
// Numeric JS storage reserves 64 B/value: element slots, boxed doubles, growth
// buffers and iterator/parser scratch. Plain object/string headers reserve 128 B
// with 64 B/property storage plus a 128 B key header and 4 B/UTF-16 unit.
// Array descriptors reserve 1024 B and logical-table wrappers 512 B each.
function jsonMemory(value,active=new Set(),inputBytes=false){
 if(value===null)return {chars:4,heap:16};
 if(typeof value==='number')return {chars:32,heap:64};
 if(typeof value==='boolean')return {chars:5,heap:16};
 if(typeof value==='string')return {chars:2+value.length*6,heap:128+value.length*4};
 if(ArrayBuffer.isView(value)){if(inputBytes){viewSlots(value,true);return {chars:0,heap:128};}fail('encoding metadata must be JSON data');}
 if(!value||typeof value!=='object'||nativeTypes.isProxy(value)||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('encoding metadata must be plain JSON data');
 if(active.has(value))fail('cyclic encoding metadata');active.add(value);
 let chars=2,heap=128;
 if(Array.isArray(value)){const count=denseArray(value);for(let i=0;i<count;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))fail('encoding metadata array accessor/sparse data');const part=jsonMemory(d.value,active,inputBytes);chars+=part.chars+1;heap+=part.heap+8;if(heap>MAX)fail('input snapshot workspace budget');}}
 else for(const key in value)if(Object.hasOwn(value,key)){const d=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(d,'value'))fail('encoding metadata accessor');const part=jsonMemory(d.value,active,inputBytes);chars+=key.length*6+4+part.chars;heap+=192+key.length*4+part.heap;}
 active.delete(value);return {chars,heap};
}
function numericJSONChars(a){
 const slots=viewSlots(a);let chars=2;for(let i=0;i<slots.length;i++){
  const n=a[i],absolute=Math.abs(n);
  // Reserve 32 characters for signed fixed/exponential IEEE doubles, including
  // leading decimal zeros. Integers below 1e21
  // have a smaller bound; ceil+one extra digit avoids log10 rounding underflow.
  chars+=1+(n===0?1:Number.isInteger(n)&&absolute<1e21?Math.ceil(Math.log10(absolute)+1e-12)+1+(n<0?1:0):32);
 }return chars;
}
/** Allocation-free with respect to cell-sized arrays/JSON/codec buffers. */
export function mutationEncodingReservation(pack,{dependencies=[],retainedBytes=0}={}){
 if(!Number.isSafeInteger(retainedBytes)||retainedBytes<0)fail('retained encoding bytes');
 const metadata=jsonMemory(pack.metadata),deps=jsonMemory(dependencies);let elements=0,rawArrayBytes=0,tableBytes=0,jsonChars=256+metadata.chars+deps.chars,arrays=0,tables=0;
 for(const a of pack.arrays){const slots=viewSlots(a);rawArrayBytes+=slots.byteLength;elements+=slots.length;jsonChars+=128+numericJSONChars(a);arrays++;}
 const logical=tileTables(pack);for(const key in logical){const a=logical[key],slots=viewSlots(a);tableBytes+=slots.byteLength;elements+=slots.length;jsonChars+=key.length*6+8+numericJSONChars(a);tables++;}
 const structuralJS=metadata.heap+deps.heap+1024+arrays*1024+tables*512;
 const spoolJSBytes=structuralJS+elements*64,parsedJSBytes=spoolJSBytes;
 // Keep the final UTF-16 string AND two complete construction/flattening copies
 // reserved through parsing and encoding. Nulling a reference earns no credit.
 const serializedUTF16Bytes=jsonChars*2,stringWorkingBytes=serializedUTF16Bytes*3;
 const codecMetadataChars=metadata.chars+arrays*256+1024;
 const containerBytes=rawArrayBytes+arrays*8+64+codecMetadataChars*3;
 const compressedBound=containerBytes+Math.ceil(containerBytes/8)+65536;
 // typed input + duplicate temporary table arrays; ASR output; inflater chunks
 // and flattened buffer; decoded arrays/shuffle scratch; compressor chunks and
 // flattened output; metadata JSON/UTF-8/parse objects; zlib workspaces/slack.
 const codecBytes=rawArrayBytes+tableBytes+containerBytes*3+rawArrayBytes*2+compressedBound*2+codecMetadataChars*10+metadata.heap*2+1024*1024;
 const rawBytes=retainedBytes+rawArrayBytes+metadata.heap*3;
 const phases=[{phase:'spool',bytes:rawBytes+spoolJSBytes},{phase:'stringify',bytes:rawBytes+spoolJSBytes+stringWorkingBytes},{phase:'parse',bytes:rawBytes+spoolJSBytes+stringWorkingBytes+parsedJSBytes},{phase:'encode',bytes:rawBytes+spoolJSBytes+stringWorkingBytes+parsedJSBytes+codecBytes}];
 // The caller's ordinary packer repeats the same JSON/codec path. Reserve both
 // passes together too; no assumption that the first pass's garbage was freed.
 phases.push({phase:'ordinary-packer',bytes:rawBytes+spoolJSBytes+2*(stringWorkingBytes+parsedJSBytes+codecBytes)});
 for(const p of phases)if(!Number.isSafeInteger(p.bytes)||p.bytes<0)fail('encoding reservation overflow');
 return freeze({limitBytes:MAX,peakBytes:Math.max(...phases.map(p=>p.bytes)),jsonChars,elements,rawArrayBytes,tableBytes,rawBytes,spoolJSBytes,serializedUTF16Bytes,stringWorkingBytes,parsedJSBytes,codecBytes,compressedBound,phases,noGarbageCollectionCredit:true});
}
function admitEncoding(reservation,attempts,phase){
 const over=reservation.phases.find(p=>p.bytes>MAX);
 if(over)throw Object.assign(new Error('Cell mutation: encoding workspace budget before '+phase+' ('+over.phase+' '+over.bytes+' > '+MAX+')'),{memoryReservation:reservation,allocationAttempts:{...attempts}});
}
/** Internal pure encoding boundary, exported for allocation-order regressions.
 * It grants no source/provenance/physical acceptance; mutateOriginalCell owns
 * those checks. Every cell-sized allocation below has prior phase admission.
 */
export function prepareMutationEncoding(pack,{dependencies=[],retainedBytes=0}={}){
 const reservation=mutationEncodingReservation(pack,{dependencies,retainedBytes}),attempts={spool:0,stringify:0,parse:0,encode:0};
 admitEncoding(reservation,attempts,'spool');attempts.spool++;
 const spool=repairedSpool(pack);spool.dependencies=structuredClone(dependencies);freeze(spool);
 admitEncoding(reservation,attempts,'stringify');attempts.stringify++;
 let serialized=JSON.stringify(spool);const serializedInputBytes=Buffer.byteLength(serialized);
 if(serialized.length>reservation.jsonChars)fail('encoding JSON reservation underestimated');
 admitEncoding(reservation,attempts,'parse');attempts.parse++;
 let encoderInput=JSON.parse(serialized);serialized=null;
 admitEncoding(reservation,attempts,'encode');attempts.encode++;
 let encoded=encodeTile(encoderInput);encoderInput=null;
 for(let i=0;i<pack.arrays.length;i++)if(arrayDigest(pack.arrays[i])!==arrayDigest(encoded.decoded.arrays[i]))fail('ordinary JSON spool changes authoritative array bytes '+i);
 const expected={sha256:sha(encoded.bytes),bytes:encoded.bytes.length,triangles:encoded.checked.triangles};
 if(expected.bytes>WIRE_MAX||encoded.checked.bytes>MAX||expected.bytes>reservation.compressedBound)fail('expected encoding byte budget');
 // Reference counts below do not reduce the reservation: GC has earned no credit.
 const bindingPeak=freeze({serializedInputBytes,jsonCopyBytesEstimate:reservation.parsedJSBytes,reservation,compressedBytes:encoded.bytes.length,decodedArrayBytes:encoded.checked.bytes,conservativeAdditionalTransientBytes:reservation.peakBytes,allocationAttempts:{...attempts},referencesClearedBeforeCallerPack:true,retainedCompressedBytes:0});encoded=null;
 return {spool,expected,bindingPeak};
}

/**
 * releaseScope={bytes,sha256}: reviewed cell-mutation-scope-1 JSON with original
 * manifest SHA and COMPLETE cells:[{cell,source:entry.source,sha256}].
 * protectedSources={manifests:[{regionId,bytes,sha256}]}: original 225/72-cell
 * native manifests. Any requested mutation on an exact protected source rejects.
 * derived={world,revision,assemblerSha256,codeProofSha256,recipeSha256}.
 * codeProofSha256 is the canonical digest of mutationCodeProof(); recipe is
 * mutationRecipeSha256(args), computed before invocation.
 * guards recipes carry compiledBytes/sourcePlanBytes and both SHA pins.
 */
export async function mutateOriginalCell(input){
 keys(input,['compressedBytes','entry','source','derived','stages','protectedSources','releaseScope'],'mutation inputs');
 let {compressedBytes,entry,source,derived,stages={},protectedSources=null,releaseScope}=input;
 validateStageInputs(stages);
 // Validate descriptors and measure before any recursive byte walk, map, clone
 // or canonical ordering. In particular, array getters must never be invoked.
 const inputShape={entry,source,derived:derived??null,stages,protectedSources,releaseScope},inputObjects=2*jsonMemory(inputShape,new Set(),true).heap;
 if(viewSlots(compressedBytes,true).byteLength>WIRE_MAX)fail('original compressed byte budget');
 for(const key of ['bytes','sha256']){const d=entry&&Object.getOwnPropertyDescriptor(entry,key);if(d&&!Object.hasOwn(d,'value'))fail('accessor original entry');}
 if(!entry||viewSlots(compressedBytes,true).byteLength!==entry.bytes||sha(compressedBytes)!==entry.sha256)fail('original compressed hash/size mismatch');
 const backingReservation=inputBackingReservation({compressedBytes,entry,source,derived,stages,protectedSources,releaseScope});
 const memory={parsedInputs:reservePinnedInputs({stages,protectedSources,releaseScope}),files:0,prepared:0,inputCopies:backingReservation.totalBytes,inputObjects};admitPinned(memory);
 // Snapshot inputs before the first await: later caller writes cannot alter a seal.
 compressedBytes=copyBytes(compressedBytes);entry=structuredClone(entry);source=structuredClone(source);derived=structuredClone(derived);stages=structuredClone(stages);protectedSources=structuredClone(protectedSources);releaseScope=structuredClone(releaseScope);
 const sourceMemory=authenticate(compressedBytes,entry,source,memory);memory.sourceRetained=sourceMemory.retainedBytes;admitPinned(memory);keys(stages,['infill','terrain','paint','guards','scenery'],'stages');
 const scope=scopeOf(releaseScope,entry,source,memory),pack0=decodePinnedSourceCell(compressedBytes,entry,source),inputFingerprint=packFingerprint(pack0),requested=Object.keys(stages).length>0;if(entry.triangles!==pack0.metadata.budgets.triangles)fail('original entry triangle mismatch');
 if(protectedBinding(protectedSources,entry,source,scope,memory)){
  if(requested)fail('protected native mutation requested');
  return {kind:'preserved',compressedBytes,entry,audit:freeze({kind:'preserved',sourceSha256:entry.sha256,inputFingerprint,inputBackingReservation:backingReservation,native:true,identityUnchanged:true})};
 }
 // The original proof is sealed before ANY infill, terrain, paint or scenery.
 const recipes=[];if(stages.guards?.recipes)for(const r of stages.guards.recipes){keys(r,['compiledBytes','sourcePlanBytes','compiledSha256','sourcePlanSha256'],'guard recipe');pinnedJSON(r.compiledBytes,r.compiledSha256,'compiled guard recipe',memory);pinnedJSON(r.sourcePlanBytes,r.sourcePlanSha256,'guard source plan',memory);recipes.push(readBridgeGuardRecipe(r));}
 const proof=await prepareBridgeGuardRepair({compressedBytes,entry,...source},recipes);
 if(proof.mode==='preserve-authored'){
  if(requested)fail('protected authored mutation requested');
  const report=rebuildBridgeGuards(pack0,proof);if(!report.preserveOriginal)fail('authored preservation proof');
  return {kind:'preserved',compressedBytes,entry,audit:freeze({kind:'preserved',sourceSha256:entry.sha256,inputFingerprint,inputBackingReservation:backingReservation,guard:report,identityUnchanged:true})};
 }
 if(!requested)return {kind:'preserved',compressedBytes,entry,audit:freeze({kind:'preserved',sourceSha256:entry.sha256,inputFingerprint,inputBackingReservation:backingReservation,identityUnchanged:true})};
 const code=await mutationCodeProof({retainedBytes:memory.sourceRetained+memory.inputCopies+memory.inputObjects+memory.parsedInputs+memory.files+memory.prepared});memory.proofRetained=code.readReservationBytes+jsonMemory(code).heap;admitPinned(memory);if(!derived||derived.assemblerSha256!==code.assembler||derived.codeProofSha256!==digest(code))fail('assembler/dependency code hash mismatch');
 if(typeof derived.world!=='string'||!derived.world||typeof derived.revision!=='string'||!derived.revision||derived.world===source.world&&derived.revision===source.revision)fail('new actual derived identity required');
 if(derived.recipeSha256!==mutationRecipeSha256({source,derived,stages,protectedSources,releaseScope}))fail('predeclared assembly recipe hash mismatch');
 if(!stages.guards)fail('original guard stage/code pin required');
 for(const [name,s]of Object.entries(stages))verifyStage(name,s,code);
 let pack=pack0;const reports=[];const run=(name,input,report,dataHashes={})=>reports.push({name,inputFingerprint:input,codeSha256:code[name],dataHashes,report});
 if(stages.infill){const s=stages.infill,plan=pinnedJSON(s.planBytes,s.planFileSha256,'infill plan',memory);if(repairPlanSha256(plan)!==s.reviewedPlanSha256)fail('reviewed canonical infill plan digest mismatch');if(typeof s.sourcePath!=='string'||!/[.](osm|pbf)$/i.test(s.sourcePath))fail('reviewed local source path required');const paths=[s.sourcePath,s.sourcePath.replace(/[.](osm|pbf)$/i,'.source.json')],sizes=[];for(const path of paths){const info=await stat(path);if(!info.isFile()||info.size>MAX)fail('infill source file byte budget');sizes.push(info.size);}
  // The infill apply contract hashes these files; it does not parse OSM/JSON or
  // invoke Python. Keep both exact raw buffers and read scratch reserved, plus
  // code/provenance histories, BEFORE opening either source file.
  memory.files+=2*(sizes[0]+sizes[1]+2);if(memory.inputCopies+memory.inputObjects+memory.parsedInputs+memory.sourceRetained+memory.proofRetained+memory.files>MAX)fail('infill paired source workspace budget before file read');
  const sourceBytes=await boundedFileBytes(paths[0],sizes[0]),recordBytes=await boundedFileBytes(paths[1],sizes[1]);
  const infillFiles=['infill.py','model.py','buildings.py','repair-infill.mjs','../../src/psychiko-building-data.js','../../src/coastal-dressing-data.js'];
  const infillCode=Object.fromEntries(infillFiles.map(name=>{const label=relative(fileURLToPath(new URL('../../',import.meta.url)),fileURLToPath(new URL(name,import.meta.url)));const hash=code.dependencies[label];validHash(hash,'infill code proof');return [name,hash];}));
  const input=packFingerprint(pack),r=repairBuildingTables(pack,plan,{planSha256:s.reviewedPlanSha256,sourceSha256:sha(sourceBytes),sourceRecordSha256:sha(recordBytes),sourceCellSha256:entry.sha256,code:infillCode});pack=r.pack;run('infill',input,r.audit,{planFile:s.planFileSha256,canonicalPlan:s.reviewedPlanSha256,source:plan.sourceSha256,sourceRecord:plan.sourceRecordSha256});}
 if(stages.terrain){const s=stages.terrain,field=TERRAIN_FIELDS[s.fieldId];if(!field)fail('unknown terrain field');const atlas=pinnedJSON(s.atlasBytes,s.atlasSha256,'terrain atlas',memory),report=pinnedJSON(s.reportBytes,s.reportSha256,'terrain acceptance',memory);const accepted=requireTerrainAcceptance(scope.cells.length,{field,sourceRevision:source.revision,fieldSHA256:code.terrain,report});if(!field.geographyVerified||accepted.prototype)fail('terrain field lacks geographic/profile/protected/comfort release acceptance');if(atlas.revision!==source.revision)fail('terrain atlas source binding');const input=packFingerprint(pack),r=refineTerrainRelief(pack,terrainReliefField(atlas,{filter:field.id}));if(r.protected)fail('structurally protected terrain cell');run('terrain',input,r,{atlas:s.atlasSha256,acceptance:s.reportSha256});}
 if(stages.paint||stages.terrain){if(!stages.paint)fail('accepted terrain requires pinned paint stage');const input=packFingerprint(pack);run('paint',input,conformMarkingSurfaces(pack));}
 {const input=packFingerprint(pack),r=rebuildBridgeGuards(pack,proof);pack.metadata.budgets.triangles+=r.triangleDelta;validateWorldTile(pack,source);run('guards',input,r,{originalCompressed:entry.sha256,recipes:recipes.map(r=>r.recipeHash)});}
 if(stages.scenery){const s=stages.scenery,scenery=pinnedJSON(s.bytes,s.sha256,'scenery',memory),old=pack.metadata.extensions?.worldDetail?.vegetation;if(!old)fail('scenery vegetation schema');for(const index of Object.values(old))if(Number.isInteger(index)&&pack.arrays[index]?.byteLength&&Object.values(pack.metadata.tables).some(i=>overlap(pack.arrays[i],pack.arrays[index])))fail('scenery input aliases a physical array');const before=snapshotSceneryInvariants(pack),input=packFingerprint(pack),exclusions=await sceneryExclusions(pack,entry,memory,code);memory.prepared+=exclusions.retainedBytes;admitPinned(memory);const r=applySceneryVegetation(pack,scenery,exclusions),invariance=assertSceneryInvariance(before,pack,r);validateWorldTile(pack,source);run('scenery',input,{...r,invariance},{scenery:s.sha256});}
 const finalPhysicalFingerprint=packFingerprint(pack),lineage=freeze({schema:'cell-mutation-lineage-1',original:{...structuredClone(source),sha256:entry.sha256,entrySource:structuredClone(entry.source)},derived:{world:derived.world,revision:derived.revision},recipeSha256:derived.recipeSha256,assemblerSha256:code.assembler,codeProofSha256:digest(code),releaseScopeSha256:releaseScope.sha256,stages:structuredClone(reports)});
 pack.metadata.world=derived.world;pack.metadata.revision=derived.revision;pack.metadata.cellMutation=lineage;
 const encoding=prepareMutationEncoding(pack,{dependencies:entry.dependencies||[],retainedBytes:sourceMemory.retainedBytes+memory.inputCopies+memory.inputObjects+memory.parsedInputs+memory.files+memory.prepared+code.readReservationBytes+jsonMemory(code).heap});
 const {spool,expected,bindingPeak}=encoding;
 const audit=freeze({kind:'mutated',sourceSha256:entry.sha256,inputFingerprint,inputBackingReservation:backingReservation,finalPhysicalFingerprint,lineage,stages:reports,encodedBinding:expected,extraEncodingLifetime:bindingPeak,globalSeamsAndBudgetsAccepted:false,gameProof:false});
 let used=false;return {kind:'mutated',spool,audit,assertPacked(result){
  if(used)fail('packed assertion already consumed');used=true;
  try{
   const {entry:out,packet,decoded,physical,bridges,bores,roads}=result||{};
   if(!out||out.sha256!==expected.sha256||out.bytes!==expected.bytes||out.triangles!==expected.triangles)fail('ordinary encoded entry SHA/bytes/triangle binding');
   same(out.dependencies,spool.dependencies,'packed dependencies changed');
   for(const [name,n,cap]of [['wire',out.bytes,WIRE_MAX],['decoded',out.decodedBytes,MAX],['resident',out.residentBytes,MAX],['transient',out.transientBytes,MAX]])if(!Number.isSafeInteger(n)||n<1||n>cap)fail('packed '+name+' budget');
   if(!packet||!decoded)fail('ordinary prepared packet required');actualIdentity(decoded,{...derived,cell:source.cell});actualIdentity(packet,{...derived,cell:source.cell});
   if(out.source)same([out.source.world,out.source.revision],[derived.world,derived.revision],'packed descriptor source identity');
   same(packet.metadata.cellMutation,lineage,'actual packet lineage');same(decoded.metadata.cellMutation,lineage,'actual decoded lineage');
   for(const [name,gate]of Object.entries({physical,bridges,bores,...(pack.metadata.roadSections?{roads}:{})}))if(gate?.passed!==true)fail('ordinary '+name+' gate missing/failed');
   if(packet.bytes>out.residentBytes)fail('actual packet exceeds authoritative resident reservation');
   for(const field of ['ids','strings','origin','terrain','structures','rails','palette'])same(packet.metadata[field]??null,pack.metadata[field]??null,'prepared physical metadata changed '+field);
   for(let i=0;i<pack.arrays.length;i++)if(!packet.arrays[i]||arrayDigest(packet.arrays[i])!==arrayDigest(pack.arrays[i]))fail('prepared changed original array '+i);
   const repaired=auditRepairedPacket(pack,packet,reports.find(r=>r.name==='infill')?.report.removed||[]),clearance=assertVegetationClearance(packet,tileTables(packet));
   return freeze({encodedEntryExact:true,actualIdentity:true,lineageExact:true,physical:repaired,clearance,globalSeamsAndBudgetsAccepted:false,gameProof:false});
  }finally{pack=null;}
 }};
}
