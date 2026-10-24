// Metadata comparison only. No object retrieval, decoding or release authority.
// OPEN: complete 3,647-piece geometry comparison needs an authenticated producer
// of stable piece identities, full geometry, planes, widths and correction data.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
export const MANIFEST_COMPARISON_LIMITS=Object.freeze({originalBytes:524288,finalBytes:2097152,totalBytes:4194304,depth:32,nodes:200000,stringLength:8192,objectKeys:30000,arrayItems:30000,tiles:20000,regions:32});
const fail=m=>{throw Error('Native manifest metadata comparison: '+m);};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const plain=v=>!!v&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype;
function fields(v,allowed,label){if(!plain(v))fail(label+' must be plain data');for(const k of Reflect.ownKeys(v)){if(typeof k!=='string'||!allowed.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))fail(label+' unknown/accessor field');}}
const digest=b=>createHash('sha256').update(b).digest('hex');
const sorted=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(sorted):Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]))):v;
const canonical=v=>JSON.stringify(sorted(v));
const same=(a,b)=>canonical(a)===canonical(b);
// Check duplicate keys and collection/depth limits BEFORE the document parse.
function parseBounded(text){let p=0,nodes=0;const L=MANIFEST_COMPARISON_LIMITS;const ws=()=>{while(/[\x20\t\r\n]/.test(text[p]||'x'))p++;};
 function string(){const start=p++;while(p<text.length){const c=text[p++];if(c==='"'){const value=JSON.parse(text.slice(start,p));if(value.length>L.stringLength)fail('string budget');return value;}if(c==='\\')p++;if(p-start>L.stringLength*6+2)fail('string token budget');}fail('unterminated string');}
 function value(depth){if(++nodes>L.nodes||depth>L.depth)fail('parse budget');ws();const c=text[p];if(c==='{'||c==='['){p++;const object=c==='{',end=object?'}':']',seen=new Set();let count=0;ws();if(text[p]===end){p++;return;}while(true){if(++count>(object?L.objectKeys:L.arrayItems))fail('collection budget');if(object){ws();if(text[p]!== '"')fail('object key');const key=string();if(seen.has(key))fail('duplicate JSON key');seen.add(key);ws();if(text[p++]!==':')fail('colon');}value(depth+1);ws();const next=text[p++];if(next===end)return;if(next!==',')fail('separator');}}
  else if(c==='"')string();else{const start=p;while(p<text.length&&!/[\x20\t\r\n,\]}]/.test(text[p]))p++;if(p===start)fail('JSON token');const token=JSON.parse(text.slice(start,p));if(token!==null&&typeof token!=='boolean'&&(typeof token!=='number'||!Number.isFinite(token)))fail('JSON scalar');}}
 value(0);ws();if(p!==text.length)fail('trailing JSON');return JSON.parse(text);
}
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const slot=name=>Object.getOwnPropertyDescriptor(typedPrototype,name).get;
function pin(input,max,label){fields(input,['bytes','sha256'],label);if(!hex(input.sha256)||!types.isUint8Array(input.bytes)||types.isProxy(input.bytes))fail(label+' bytes/hash');const b=input.bytes,buffer=Reflect.apply(slot('buffer'),b,[]),length=Reflect.apply(slot('byteLength'),b,[]);if(!(buffer instanceof ArrayBuffer)||Object.getPrototypeOf(b)!==Uint8Array.prototype||length<2||length>max)fail(label+' byte budget/type');const view=new Uint8Array(buffer,Reflect.apply(slot('byteOffset'),b,[]),length);if(digest(view)!==input.sha256)fail(label+' SHA mismatch');let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(view);}catch{fail(label+' UTF-8');}return {value:parseBounded(text),sha256:input.sha256,bytes:length};}
function identity(v,label){fields(v,['regionId','world','revision'],label);if(!/^[a-z][a-z0-9-]*$/.test(v.regionId||'')||typeof v.world!=='string'||!v.world||!hex(v.revision))fail(label+' identity');return v;}
function cell(key){if(!/^-?(0|[1-9]\d*),-?(0|[1-9]\d*)$/.test(key))fail('noncanonical cell');const a=key.split(',').map(Number);if(!a.every(Number.isSafeInteger)||a.map(String).join(',')!==key)fail('cell coordinate');}
function projection(v){if(!plain(v)||!Number.isFinite(v.lat0)||!Number.isFinite(v.lon0))fail('projection schema');const pairs=[['mlat','mlon'],['metresPerLat','metresPerLon']];if(pairs.filter(p=>p.every(k=>Object.hasOwn(v,k))).length!==1||Object.keys(v).length!==4||!pairs.some(p=>p.every(k=>Number.isFinite(v[k])&&v[k]>0)))fail('ambiguous projection schema');}
// Composition accepts either documented projection spelling; regional raw descriptors stay exact.
const projectionValues=v=>({lat0:v.lat0,lon0:v.lon0,mlat:v.mlat??v.metresPerLat,mlon:v.mlon??v.metresPerLon});
function manifest(m,label){if(!plain(m)||m.tileVersion!==1||m.tileMetres!==512||('schemaVersion'in m&&m.schemaVersion!==1)||('schema'in m)||typeof m.world!=='string'||!m.world||!hex(m.revision)||!plain(m.tiles)||!plain(m.elevation)||Object.keys(m.tiles).length>MANIFEST_COMPARISON_LIMITS.tiles)fail(label+' unsupported manifest schema');projection(m.projection);for(const [k,e]of Object.entries(m.tiles)){cell(k);if(!plain(e)||!hex(e.sha256)||!Number.isSafeInteger(e.bytes)||e.bytes<=0)fail(label+' entry SHA/size');if(Object.hasOwn(e,'source'))identity(e.source,label+' source');}return m;}
/** Pinned original/final regional manifests and composed descriptor bytes only.
 * Raw entry.source presence is compared exactly; no implicit source is inserted.
 * Composed source resolution is a separate context, never an entry rewrite.
 */
export function compareNativeManifestMetadata(input){
 fields(input,['penteli','megara','finalPenteli','finalMegara','composed'],'inputs');
 const L=MANIFEST_COMPARISON_LIMITS,pins={};let total=0;
 for(const name of ['penteli','megara','finalPenteli','finalMegara','composed']){pins[name]=pin(input[name],name==='composed'?L.finalBytes:L.originalBytes,name);total+=pins[name].bytes;if(total>L.totalBytes)fail('total byte budget');}
 const composed=pins.composed.value;
 fields(composed,['schemaVersion','id','revision','projection','tileMetres','regions'],'composed descriptor');
 if(!hex(composed.revision)||composed.tileMetres!==512||composed.schemaVersion!==1||composed.id!=='athens'||!Array.isArray(composed.regions)||composed.regions.length<2||composed.regions.length>L.regions)fail('unsupported composed descriptor schema');
 projection(composed.projection);const regions=new Map();for(const r of composed.regions){fields(r,['id','manifestUrl','manifestSha256','sourceWorld','sourceRevision','access','elevation','externalPortals'],'region');if(typeof r.id!=='string'||!/^[a-z][a-z0-9-]*$/.test(r.id)||regions.has(r.id))fail('duplicate/invalid region');if(!hex(r.manifestSha256)||!hex(r.sourceRevision)||typeof r.sourceWorld!=='string'||!r.sourceWorld||typeof r.manifestUrl!=='string'||!r.manifestUrl)fail('region descriptor schema');regions.set(r.id,r);}
 const occupied=new Set(),families=[];
 for(const [name,finalName,count]of [['penteli','finalPenteli',225],['megara','finalMegara',72]]){
  const oldPin=pins[name],newPin=pins[finalName],original=manifest(oldPin.value,name),final=manifest(newPin.value,finalName),keys=Object.keys(original.tiles),region=regions.get(name);
  if(keys.length!==count||typeof original.elevation.datum!=='string'||!original.elevation.datum)fail(name+' original family/count/datum');
  if(final.world!==original.world||final.revision!==original.revision||!same(final.elevation,original.elevation)||!same(final.projection,original.projection))fail(name+' final identity/projection/datum changed');
  for(const r of regions.values())if(r.sourceWorld===original.world&&r.id!==name)fail('ambiguous descriptor mapping');
  if(!region||region.manifestSha256!==newPin.sha256||region.sourceWorld!==final.world||region.sourceRevision!==final.revision||typeof region.manifestUrl!=='string'||!region.manifestUrl)fail(name+' composed region binding');
  if(Object.hasOwn(region,'elevation')&&!same(region.elevation,final.elevation))fail(name+' descriptor datum changed');
  if(!same(projectionValues(composed.projection),projectionValues(final.projection)))fail(name+' composed projection changed');
  if(Object.keys(final.tiles).length!==count)fail(name+' final coverage changed');let absent=0;
  for(const k of keys){if(occupied.has(k))fail('conflicting native XY');occupied.add(k);const prior=original.tiles[k],actual=final.tiles[k];if(!Object.hasOwn(prior,'source'))absent++;
   if(!actual)fail(name+' missing cell '+k);
   const comparable=e=>Object.fromEntries(Object.entries(e).filter(([key])=>key!=='url'));
   if(!same(comparable(prior),comparable(actual)))fail(name+' raw entry changed '+k);
   if(prior.source&&(prior.source.regionId!==name||prior.source.world!==original.world||prior.source.revision!==original.revision))fail('ambiguous original native source');
  }
  families.push(Object.freeze({regionId:name,cells:count,originalManifestSha256:oldPin.sha256,finalManifestSha256:newPin.sha256,originalEntriesWithoutSource:absent,rawSourcePresencePreserved:true,descriptorShaBinding:'exact-raw-SHA',descriptorByteSizeBinding:'not-declared-in-schema; externally-pinned-byte-input',resolvedSourceContext:'derived-from-authenticated-region; raw-entry-unchanged'}));
 }
 return Object.freeze({scope:'metadata-comparison-only',comparedCells:297,families:Object.freeze(families),composedManifestSha256:pins.composed.sha256,actualObjectBytesVerified:false,physicalAcceptance:false,releaseCertificate:false,onlineEnableAuthority:false,psychikoFullPieceGeometryComparison:'open: authenticated source producer required'});
}
