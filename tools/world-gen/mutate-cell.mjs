// Source-only, one ORIGINAL cell at a time. No fetch, writes, manifest or readiness.
// Stage inputs are reviewed bytes/paths + SHA pins, never executable callbacks.
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {relative} from 'node:path';
import {decodePinnedSourceCell,applyReviewedInfillRepair,repairPlanSha256,packFingerprint,repairedSpool,auditRepairedPacket} from './repair-infill.mjs';
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
const dependencyFiles=['./pack.mjs','./terrain-acceptance.mjs','./areas/authored-guard-preservation.json','../audit-world-vegetation.mjs','../world-surface-audit.mjs','../world-bridge-audit.mjs','../world-roads-audit.mjs','../world-bore-audit.mjs','../../src/baked-geometry.js','../../src/world-tile-format.js','../../src/world-tile-worker.js','../../src/world-tile-buildings.js','../../src/world-tile-trees.js','../../src/world-tile-ground.js','../../src/world-tile-parking.js','../../src/world-tile-obstacles.js','../../src/vegetation-clearance.js','../../src/world-tile-psychiko.js','../../src/psychiko-building-data.js','../../src/world-tile-coast.js','../../src/coastal-dressing-data.js','../../src/athens-plazas.js','../../src/athens-landmarks.js','../../assets/athens/plazas.json'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('Cell mutation: '+s);};
const canonical=v=>JSON.stringify(order(v));
function order(v){
 if(ArrayBuffer.isView(v)){if(!(v instanceof Uint8Array))fail('only byte stage inputs are supported');if(v.byteLength>MAX)fail('stage byte budget');return {bytes:v.byteLength,sha256:sha(v)};}
 if(Array.isArray(v))return v.map(order);
 if(v&&typeof v==='object'){
  if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)fail('stage input must be plain data');
  const out=Object.create(null);for(const k of Object.keys(v).sort()){if(!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))fail('accessor stage input');out[k]=order(v[k]);}return out;
 }
 if(typeof v==='function'||typeof v==='symbol'||typeof v==='bigint'||v===undefined||typeof v==='number'&&!Number.isFinite(v))fail('stage input must be finite data, not callbacks');
 return v;
}
const same=(a,b,label)=>{if(canonical(a)!==canonical(b))fail(label);};
const digest=v=>sha(canonical(v));
const arrayDigest=a=>digest([a.constructor.name,a.length,sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength))]);
const validHash=(h,label)=>{if(!/^[a-f0-9]{64}$/.test(h||''))fail(label+' SHA required');};
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
function keys(v,allowed,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('unsupported '+label);}
function pinnedJSON(bytes,hash,label){validHash(hash,label);if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX||sha(bytes)!==hash)fail(label+' byte hash mismatch');return JSON.parse(Buffer.from(bytes).toString('utf8'));}
/** Pin .assembler and canonical digest(result) in derived.codeProofSha256; pin stage hashes too. */
export async function mutationCodeProof(){
 const code=Object.fromEntries(await Promise.all(Object.entries(modules).map(async([name,path])=>[name,sha(await readFile(new URL(path,import.meta.url)))])));
 const pending=[...Object.values(modules),...dependencyFiles,'../../package-lock.json'].map(p=>new URL(p,import.meta.url)),seen=new Set(),dependencies={},root=fileURLToPath(new URL('../../',import.meta.url));
 while(pending.length){const url=pending.pop();if(seen.has(url.href))continue;seen.add(url.href);const label=relative(root,fileURLToPath(url));if(label.startsWith('..'))fail('code dependency outside repository');const b=await readFile(url);dependencies[label]=sha(b);
  if(/\.m?js$/.test(url.pathname))for(const match of b.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g))pending.push(new URL(match[1],url));
 }
 code.dependencies=dependencies;return code;
}
/** Recipe digest excludes itself; includes complete scope/registry and exact stage bytes. */
export function mutationRecipeSha256({source,derived,stages={},protectedSources=null,releaseScope}){
 return digest({schema:1,source,derived:{world:derived.world,revision:derived.revision,assemblerSha256:derived.assemblerSha256,codeProofSha256:derived.codeProofSha256},stages,protectedSources,releaseScope});
}
function authenticate(bytes,entry,source){
 if(!(bytes instanceof Uint8Array)||!entry||bytes.byteLength!==entry.bytes||sha(bytes)!==entry.sha256)fail('original compressed hash/size mismatch');
 if(!Number.isSafeInteger(entry.decodedBytes)||entry.decodedBytes<12||entry.decodedBytes>MAX||entry.bytes>WIRE_MAX)fail('original decode budget');
 if(!source||typeof source.world!=='string'||!source.world||typeof source.revision!=='string'||!source.revision||!Array.isArray(source.cell)||source.cell.length!==2||!source.cell.every(Number.isSafeInteger))fail('original source identity');
 if(!entry.source||typeof entry.source.regionId!=='string'||!entry.source.regionId)fail('pinned entry.source required');
 same([entry.source.world,entry.source.revision],[source.world,source.revision],'entry source identity mismatch');
 // decodePinnedSourceCell is intentionally used only AFTER this bounded envelope check.
 const raw=gunzipSync(bytes,{maxOutputLength:entry.decodedBytes});
 if(raw.length<12||raw.readUInt32LE(0)!==0x31525341)fail('original ASR1 header');
 const size=raw.readUInt32LE(4),start=raw.readUInt32LE(8);
 if(size>raw.length-12||start<12+size||start>raw.length||start%4)fail('original codec header');
 const m=JSON.parse(raw.subarray(12,12+size));if(m.version!==1||!Array.isArray(m.views))fail('original codec format');
 const types={Int8Array:1,Uint8Array:1,Uint8ClampedArray:1,Int16Array:2,Uint16Array:2,Int32Array:4,Uint32Array:4,Float32Array:4,Float64Array:8};let allocation=0;
 for(const v of m.views){const width=types[v.type],length=v.length*width;if(!width||!Number.isSafeInteger(v.length)||v.length<0||!Number.isSafeInteger(v.offset)||v.offset<0||v.offset%width||start+v.offset+length>raw.length||!Number.isSafeInteger(length)||(allocation+=length)>entry.decodedBytes)fail('original codec decoded budget/views');}
 same([m.world,m.revision,m.cell],[source.world,source.revision,source.cell],'original header source identity');
}
function scopeOf(input,entry,source){
 const scope=pinnedJSON(input?.bytes,input?.sha256,'release scope');
 if(scope.schema!=='cell-mutation-scope-1'||!Array.isArray(scope.cells)||!scope.cells.length)fail('complete release scope required');
 validHash(scope.sourceManifestSha256,'scope original manifest');
 const seen=new Set();for(const pin of scope.cells){if(!Array.isArray(pin.cell)||pin.cell.length!==2||!pin.cell.every(Number.isSafeInteger))fail('scope cell');const k=pin.cell.join(',');if(seen.has(k))fail('duplicate release scope cell');seen.add(k);validHash(pin.sha256,'scope cell');}
 const pin=scope.cells.find(p=>canonical(p.cell)===canonical(source.cell));
 if(!pin||pin.sha256!==entry.sha256)fail('scope source cell SHA mismatch');same(pin.source,entry.source,'scope source family mismatch');return scope;
}
function protectedBinding(registry,entry,source,scope){
 const native=entry.source.regionId==='penteli'||entry.source.regionId==='megara'||source.world==='penteli'||source.world==='megara';
 if(!registry){if(native)fail('native source requires pinned original manifest registry');return false;}
 keys(registry,['manifests'],'preservation registry');if(!Array.isArray(registry.manifests))fail('preservation manifests');
 let found=false;const seenFamilies=new Set();
 for(const family of registry.manifests){
  keys(family,['regionId','bytes','sha256'],'preservation family');if(seenFamilies.has(family.regionId))fail('duplicate native manifest family');seenFamilies.add(family.regionId);
  const manifest=pinnedJSON(family.bytes,family.sha256,'preservation original manifest');
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
const overlap=(a,b)=>a.buffer===b.buffer&&a.byteOffset<b.byteOffset+b.byteLength&&b.byteOffset<a.byteOffset+a.byteLength;
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
async function sceneryExclusions(pack,entry){
 const prepared=prepareTilePacket(structuredClone(pack),{...pack.metadata,entry:{...entry,triangles:pack.metadata.budgets.triangles,decodedBytes:MAX,residentBytes:MAX}}),d=prepared.metadata.extensions?.worldDetail,occupied=[];
 for(const [index,stride,pad]of [[d?.parking,5,3],[d?.props?.rows,5,2],[d?.signals?.rows,6,2]])if(index!=null){const a=prepared.arrays[index];for(let i=0;i<a.length;i+=stride)occupied.push([a[i],a[i+2],pad]);}
 const plazas=[...parsePlazas(JSON.parse(await readFile(new URL('../../assets/athens/plazas.json',import.meta.url)))),...forecourtPlazas()];
 const blocked=(x,z,r)=>plazas.some(q=>x>=q.x0-r&&x<=q.x1+r&&z>=q.z0-r&&z<=q.z1+r&&plazaDistance(q.p,x,z)<=r)||[-r,0,r].some(dx=>[-r,0,r].some(dz=>insideLandmark(x+dx,z+dz)));
 return {blocked,occupied};
}
function verifyStage(name,stage,code){
 const allowed={infill:['codeSha256','planBytes','planFileSha256','reviewedPlanSha256','sourcePath'],terrain:['codeSha256','fieldId','atlasBytes','atlasSha256','reportBytes','reportSha256'],paint:['codeSha256'],guards:['codeSha256','recipes'],scenery:['codeSha256','bytes','sha256']};
 keys(stage,allowed[name],name+' stage');if(stage.codeSha256!==code[name])fail(name+' code hash mismatch');
}
function actualIdentity(pack,expected){same([pack.metadata.world,pack.metadata.revision,pack.metadata.cell],[expected.world,expected.revision,expected.cell],'actual packet identity');}
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
export async function mutateOriginalCell({compressedBytes,entry,source,derived,stages={},protectedSources=null,releaseScope}){
 if(!(compressedBytes instanceof Uint8Array)||compressedBytes.byteLength>WIRE_MAX)fail('original compressed byte budget');
 order(stages);
 // Snapshot inputs before the first await: later caller writes cannot alter a seal.
 compressedBytes=Buffer.from(compressedBytes);entry=structuredClone(entry);source=structuredClone(source);derived=structuredClone(derived);stages=structuredClone(stages);protectedSources=structuredClone(protectedSources);releaseScope=structuredClone(releaseScope);
 authenticate(compressedBytes,entry,source);keys(stages,['infill','terrain','paint','guards','scenery'],'stages');
 const scope=scopeOf(releaseScope,entry,source),pack0=decodePinnedSourceCell(compressedBytes,entry,source),inputFingerprint=packFingerprint(pack0),requested=Object.keys(stages).length>0;if(entry.triangles!==pack0.metadata.budgets.triangles)fail('original entry triangle mismatch');
 if(protectedBinding(protectedSources,entry,source,scope)){
  if(requested)fail('protected native mutation requested');
  return {kind:'preserved',compressedBytes,entry,audit:freeze({kind:'preserved',sourceSha256:entry.sha256,inputFingerprint,native:true,identityUnchanged:true})};
 }
 // The original proof is sealed before ANY infill, terrain, paint or scenery.
 const recipes=[];if(stages.guards?.recipes)for(const r of stages.guards.recipes){keys(r,['compiledBytes','sourcePlanBytes','compiledSha256','sourcePlanSha256'],'guard recipe');pinnedJSON(r.compiledBytes,r.compiledSha256,'compiled guard recipe');pinnedJSON(r.sourcePlanBytes,r.sourcePlanSha256,'guard source plan');recipes.push(readBridgeGuardRecipe(r));}
 const proof=await prepareBridgeGuardRepair({compressedBytes,entry,...source},recipes);
 if(proof.mode==='preserve-authored'){
  if(requested)fail('protected authored mutation requested');
  const report=rebuildBridgeGuards(pack0,proof);if(!report.preserveOriginal)fail('authored preservation proof');
  return {kind:'preserved',compressedBytes,entry,audit:freeze({kind:'preserved',sourceSha256:entry.sha256,inputFingerprint,guard:report,identityUnchanged:true})};
 }
 if(!requested)return {kind:'preserved',compressedBytes,entry,audit:freeze({kind:'preserved',sourceSha256:entry.sha256,inputFingerprint,identityUnchanged:true})};
 const code=await mutationCodeProof();if(!derived||derived.assemblerSha256!==code.assembler||derived.codeProofSha256!==digest(code))fail('assembler/dependency code hash mismatch');
 if(typeof derived.world!=='string'||!derived.world||typeof derived.revision!=='string'||!derived.revision||derived.world===source.world&&derived.revision===source.revision)fail('new actual derived identity required');
 if(derived.recipeSha256!==mutationRecipeSha256({source,derived,stages,protectedSources,releaseScope}))fail('predeclared assembly recipe hash mismatch');
 if(!stages.guards)fail('original guard stage/code pin required');
 for(const [name,s]of Object.entries(stages))verifyStage(name,s,code);
 let pack=pack0;const reports=[];const run=(name,input,report,dataHashes={})=>reports.push({name,inputFingerprint:input,codeSha256:code[name],dataHashes,report});
 if(stages.infill){const s=stages.infill,plan=pinnedJSON(s.planBytes,s.planFileSha256,'infill plan');if(repairPlanSha256(plan)!==s.reviewedPlanSha256)fail('reviewed canonical infill plan digest mismatch');if(typeof s.sourcePath!=='string'||!/[.](osm|pbf)$/i.test(s.sourcePath))fail('reviewed local source path required');for(const path of [s.sourcePath,s.sourcePath.replace(/[.](osm|pbf)$/i,'.source.json')]){const info=await stat(path);if(!info.isFile()||info.size>MAX)fail('infill source file byte budget');}const input=packFingerprint(pack),r=await applyReviewedInfillRepair(pack,plan,{reviewedPlanSha256:s.reviewedPlanSha256,sourcePath:s.sourcePath,sourceCellSha256:entry.sha256});pack=r.pack;run('infill',input,r.audit,{planFile:s.planFileSha256,canonicalPlan:s.reviewedPlanSha256,source:plan.sourceSha256,sourceRecord:plan.sourceRecordSha256});}
 if(stages.terrain){const s=stages.terrain,field=TERRAIN_FIELDS[s.fieldId];if(!field)fail('unknown terrain field');const atlas=pinnedJSON(s.atlasBytes,s.atlasSha256,'terrain atlas'),report=pinnedJSON(s.reportBytes,s.reportSha256,'terrain acceptance');const accepted=requireTerrainAcceptance(scope.cells.length,{field,sourceRevision:source.revision,fieldSHA256:code.terrain,report});if(!field.geographyVerified||accepted.prototype)fail('terrain field lacks geographic/profile/protected/comfort release acceptance');if(atlas.revision!==source.revision)fail('terrain atlas source binding');const input=packFingerprint(pack),r=refineTerrainRelief(pack,terrainReliefField(atlas,{filter:field.id}));if(r.protected)fail('structurally protected terrain cell');run('terrain',input,r,{atlas:s.atlasSha256,acceptance:s.reportSha256});}
 if(stages.paint||stages.terrain){if(!stages.paint)fail('accepted terrain requires pinned paint stage');const input=packFingerprint(pack);run('paint',input,conformMarkingSurfaces(pack));}
 {const input=packFingerprint(pack),r=rebuildBridgeGuards(pack,proof);pack.metadata.budgets.triangles+=r.triangleDelta;validateWorldTile(pack,source);run('guards',input,r,{originalCompressed:entry.sha256,recipes:recipes.map(r=>r.recipeHash)});}
 if(stages.scenery){const s=stages.scenery,scenery=pinnedJSON(s.bytes,s.sha256,'scenery'),old=pack.metadata.extensions?.worldDetail?.vegetation;if(!old)fail('scenery vegetation schema');for(const index of Object.values(old))if(Number.isInteger(index)&&pack.arrays[index]?.byteLength&&Object.values(pack.metadata.tables).some(i=>overlap(pack.arrays[i],pack.arrays[index])))fail('scenery input aliases a physical array');const before=snapshotSceneryInvariants(pack),input=packFingerprint(pack),r=applySceneryVegetation(pack,scenery,await sceneryExclusions(pack,entry)),invariance=assertSceneryInvariance(before,pack,r);validateWorldTile(pack,source);run('scenery',input,{...r,invariance},{scenery:s.sha256});}
 const finalPhysicalFingerprint=packFingerprint(pack),lineage=freeze({schema:'cell-mutation-lineage-1',original:{...structuredClone(source),sha256:entry.sha256,entrySource:structuredClone(entry.source)},derived:{world:derived.world,revision:derived.revision},recipeSha256:derived.recipeSha256,assemblerSha256:code.assembler,codeProofSha256:digest(code),releaseScopeSha256:releaseScope.sha256,stages:structuredClone(reports)});
 pack.metadata.world=derived.world;pack.metadata.revision=derived.revision;pack.metadata.cellMutation=lineage;
 const spool=repairedSpool(pack);spool.dependencies=structuredClone(entry.dependencies||[]);freeze(spool);
 // EXACT encodeTile path/options used by packTiles, before its in-place prepare.
 // Hash then release this temporary compressed buffer and its decoded copy.
 let serialized=JSON.stringify(spool);const serializedInputBytes=Buffer.byteLength(serialized),jsonCopyBytesEstimate=serialized.length*16;
 let encoderInput=JSON.parse(serialized);serialized=null;let encoded=encodeTile(encoderInput);encoderInput=null;
 for(let i=0;i<pack.arrays.length;i++)if(arrayDigest(pack.arrays[i])!==arrayDigest(encoded.decoded.arrays[i]))fail('ordinary JSON spool changes authoritative array bytes '+i);
 const expected={sha256:sha(encoded.bytes),bytes:encoded.bytes.length,triangles:encoded.checked.triangles};if(expected.bytes>WIRE_MAX||encoded.checked.bytes>MAX)fail('expected encoding byte budget');const bindingPeak={serializedInputBytes,jsonCopyBytesEstimate,jsonCopiesReleasedBeforeCallerPack:true,compressedBytes:encoded.bytes.length,decodedArrayBytes:encoded.checked.bytes,conservativeAdditionalTransientBytes:encoded.bytes.length+encoded.checked.bytes*5+JSON.stringify(encoded.decoded.metadata).length*4+65536,retainedCompressedBytes:0,inputCompressedCopyBytes:compressedBytes.length};if(bindingPeak.conservativeAdditionalTransientBytes>MAX)fail('expected encoding transient budget');encoded=null;
 const audit=freeze({kind:'mutated',sourceSha256:entry.sha256,inputFingerprint,finalPhysicalFingerprint,lineage,stages:reports,encodedBinding:expected,extraEncodingLifetime:bindingPeak,globalSeamsAndBudgetsAccepted:false,gameProof:false});
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
