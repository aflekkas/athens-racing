import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compareNativeManifestMetadata,MANIFEST_COMPARISON_LIMITS as L} from './protected-world-manifest.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=v=>{const bytes=new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v));return {bytes,sha256:hash(bytes)};};
const revision='a'.repeat(64),projection={lat0:37.98,lon0:23.73,mlat:111320,mlon:87800};
function fixture(){const make=(world,n,start)=>({tileVersion:1,tileMetres:512,world,revision,projection,elevation:{datum:'EVRS2000',source:'EU-DEM v1.1',verticalOffset:0},tiles:Object.fromEntries(Array.from({length:n},(_,i)=>[`${i+start},0`,{sha256:hash(String(i+start)),bytes:100+i,triangles:2,decodedBytes:4096,url:'/old/'+i}]))});const penteli=make('penteli',225,0),megara=make('megara',72,1000);return {penteli,megara,finalPenteli:structuredClone(penteli),finalMegara:structuredClone(megara),composed:{schemaVersion:1,id:'athens',revision:'b'.repeat(64),projection,tileMetres:512,regions:[]}};}
function inputs(f){const result=Object.fromEntries(['penteli','megara','finalPenteli','finalMegara'].map(k=>[k,pin(f[k])]));if(!f.composed.regions.length)for(const name of ['penteli','megara'])f.composed.regions.push({id:name,manifestUrl:`/world/${name}.json`,manifestSha256:result[name==='penteli'?'finalPenteli':'finalMegara'].sha256,sourceWorld:f[name].world,sourceRevision:revision,elevation:structuredClone(f[name].elevation)});result.composed=pin(f.composed);return result;}
const reject=(change,pattern)=>{const f=fixture();change(f);assert.throws(()=>compareNativeManifestMetadata(inputs(f)),pattern);};
test('all 297 exact raw entries, absent source preserved, no acceptance authority',()=>{const f=fixture(),before=JSON.stringify(f),result=compareNativeManifestMetadata(inputs(f));assert.equal(result.comparedCells,297);assert.equal(result.scope,'metadata-comparison-only');for(const k of ['actualObjectBytesVerified','physicalAcceptance','releaseCertificate','onlineEnableAuthority'])assert.equal(result[k],false);assert.deepEqual(result.families.map(f=>f.originalEntriesWithoutSource),[225,72]);assert.equal(Object.hasOwn(f.finalPenteli.tiles['0,0'],'source'),false);assert.equal(JSON.stringify(f.penteli),JSON.stringify(JSON.parse(before).penteli));assert(Object.isFrozen(result));});
test('explicit original source presence preserved',()=>{const f=fixture();for(const m of [f.penteli,f.finalPenteli])m.tiles['0,0'].source={regionId:'penteli',world:'penteli',revision};assert.equal(compareNativeManifestMetadata(inputs(f)).families[0].originalEntriesWithoutSource,224);});
for(const [name,change,pattern]of [
 ['delete',(f)=>delete f.finalPenteli.tiles['0,0'],/coverage/],
 ['extra',(f)=>f.finalMegara.tiles['9999,0']=structuredClone(f.finalMegara.tiles['1000,0']),/coverage/],
 ['hash',(f)=>f.finalPenteli.tiles['0,0'].sha256='c'.repeat(64),/raw entry/],
 ['size',(f)=>f.finalMegara.tiles['1000,0'].bytes++,/raw entry/],
 ['dependency',(f)=>f.finalPenteli.tiles['0,0'].dependencies=['changed'],/raw entry/],
 ['absent becomes explicit',(f)=>f.finalPenteli.tiles['0,0'].source={regionId:'penteli',world:'penteli',revision},/raw entry/],
 ['world',(f)=>f.finalMegara.world='elsewhere',/identity/],
 ['revision',(f)=>f.finalPenteli.revision='c'.repeat(64),/identity/],
 ['datum',(f)=>f.finalPenteli.elevation.datum='EGM2008',/datum/],
 ['vertical offset',(f)=>f.finalMegara.elevation.verticalOffset=10,/datum/],
 ['projection',(f)=>f.finalMegara.projection={...projection,lat0:0},/projection/],
 ['original count',(f)=>delete f.megara.tiles['1000,0'],/family\/count/],
 ['unknown native version',(f)=>f.finalPenteli.tileVersion=2,/schema/],
 ['unknown composed version',(f)=>f.composed.schemaVersion=2,/schema/],
 ['noncanonical XY',(f)=>{f.finalPenteli.tiles['00,0']=f.finalPenteli.tiles['0,0'];delete f.finalPenteli.tiles['0,0'];},/cell/],
 ['null source',(f)=>f.finalPenteli.tiles['0,0'].source=null,/plain data/],
 ['unsafe bytes',(f)=>f.finalPenteli.tiles['0,0'].bytes=Number.MAX_SAFE_INTEGER+1,/size/],
 ['unknown source field',(f)=>f.finalPenteli.tiles['0,0'].source={regionId:'penteli',world:'penteli',revision,extra:1},/field/],
])test('reject '+name,()=>reject(change,pattern));
test('overlapping original family coordinates reject even when each raw final matches',()=>reject(f=>{const e=f.megara.tiles['1000,0'];delete f.megara.tiles['1000,0'];f.megara.tiles['0,0']=e;f.finalMegara=structuredClone(f.megara);},/conflicting native XY/));
test('URL relocation allowed without source rewrite',()=>{const f=fixture();f.finalPenteli.tiles['0,0'].url='/new/object';assert.equal(compareNativeManifestMetadata(inputs(f)).comparedCells,297);});
for(const [label,mutate,pattern]of [
 ['stale raw SHA',(f)=>f.composed.regions[0].manifestSha256='c'.repeat(64),/binding/],
 ['descriptor source',(f)=>f.composed.regions[0].sourceWorld='other',/binding/],
 ['descriptor revision',(f)=>f.composed.regions[0].sourceRevision='c'.repeat(64),/binding/],
 ['descriptor datum',(f)=>f.composed.regions[0].elevation.datum='other',/datum/],
 ['duplicate family',(f)=>f.composed.regions.push(structuredClone(f.composed.regions[0])),/duplicate/],
 ['unknown descriptor schema',(f)=>f.composed.schema='invented',/field/],
])test('reject '+label,()=>{const f=fixture();inputs(f);mutate(f);assert.throws(()=>compareNativeManifestMetadata(inputs(f)),pattern);});
test('hash pin authenticated before parse',()=>{const i=inputs(fixture());i.penteli.sha256='0'.repeat(64);assert.throws(()=>compareNativeManifestMetadata(i),/SHA mismatch/);});
test('duplicate JSON keys rejected before document parse',()=>{const i=inputs(fixture());const text=new TextDecoder().decode(i.penteli.bytes).replace('"tileVersion":1','"tileVersion":1,"tileVersion":1');i.penteli=pin(text);assert.throws(()=>compareNativeManifestMetadata(i),/duplicate JSON key/);});
test('malformed UTF-8 rejected',()=>{const i=inputs(fixture());i.penteli=pin('x');i.penteli.bytes=Uint8Array.of(255,255);i.penteli.sha256=hash(i.penteli.bytes);assert.throws(()=>compareNativeManifestMetadata(i),/UTF-8/);});
test('depth budget',()=>{const i=inputs(fixture());i.penteli=pin('['.repeat(L.depth+2)+'0'+']'.repeat(L.depth+2));assert.throws(()=>compareNativeManifestMetadata(i),/parse budget/);});
test('byte budget before parse',()=>{const i=inputs(fixture());i.penteli=pin(' '.repeat(L.originalBytes+1));assert.throws(()=>compareNativeManifestMetadata(i),/byte budget/);});
test('string and array budgets',()=>{for(const text of [JSON.stringify('a'.repeat(L.stringLength+1)),JSON.stringify(Array(L.arrayItems+1).fill(0))]){const i=inputs(fixture());i.penteli=pin(text);assert.throws(()=>compareNativeManifestMetadata(i),/budget/);}});
test('input accessors rejected without invocation',()=>{let called=false;const i=inputs(fixture());Object.defineProperty(i,'penteli',{get(){called=true;throw Error('called');}});assert.throws(()=>compareNativeManifestMetadata(i),/accessor/);assert.equal(called,false);});
test('proxy and shared-memory input rejected',()=>{const i=inputs(fixture());assert.throws(()=>compareNativeManifestMetadata(new Proxy(i,{})),/plain data/);i.penteli.bytes=new Uint8Array(new SharedArrayBuffer(2));assert.throws(()=>compareNativeManifestMetadata(i),/byte budget\/type/);});
test('explicit source removed or modified rejects',()=>{for(const mutate of [e=>delete e.source,e=>e.source.world='other',e=>e.source.revision='f'.repeat(64)]){const f=fixture();for(const m of [f.penteli,f.finalPenteli])m.tiles['0,0'].source={regionId:'penteli',world:'penteli',revision};mutate(f.finalPenteli.tiles['0,0']);assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/raw entry/);}});
test('another region cannot alias a native source world',()=>{const f=fixture();inputs(f);f.composed.regions.push({...f.composed.regions[0],id:'basin'});assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/ambiguous descriptor/);});
test('missing and mixed projection aliases rejected',()=>{for(const mutate of [f=>{for(const n of ['penteli','megara','finalPenteli','finalMegara','composed'])delete f[n].projection;},f=>{f.finalPenteli.projection={...projection,metresPerLat:111320,metresPerLon:87800};}])reject(mutate,/projection schema/);});
test('escaped duplicate entry key rejected',()=>{const i=inputs(fixture());i.penteli=pin(new TextDecoder().decode(i.penteli.bytes).replace('"0,0":','"\\u0030,0":{},"0,0":'));assert.throws(()=>compareNativeManifestMetadata(i),/duplicate JSON key/);});
test('duplicate per-region source key rejected',()=>{const i=inputs(fixture());i.composed=pin(new TextDecoder().decode(i.composed.bytes).replace('"sourceWorld":"penteli"','"sourceWorld":"penteli","sourceWorld":"penteli"'));assert.throws(()=>compareNativeManifestMetadata(i),/duplicate JSON key/);});
test('typed byte input own accessors do not execute',()=>{const i=inputs(fixture());let called=false;Object.defineProperty(i.penteli.bytes,'buffer',{get(){called=true;throw Error('called');}});assert.equal(compareNativeManifestMetadata(i).comparedCells,297);assert.equal(called,false);});
test('native region role differs from source world: megara/accesscircuit',()=>{const f=fixture();for(const m of [f.megara,f.finalMegara])m.world='megara/accesscircuit';const result=compareNativeManifestMetadata(inputs(f));assert.equal(result.comparedCells,297);assert.equal(result.families[1].regionId,'megara');assert.equal(Object.hasOwn(f.finalMegara.tiles['1000,0'],'source'),false);});
test('explicit per-entry slash world matches pinned native source, not region role',()=>{const f=fixture();for(const m of [f.megara,f.finalMegara]){m.world='megara/accesscircuit';m.tiles['1000,0'].source={regionId:'megara',world:m.world,revision};}assert.equal(compareNativeManifestMetadata(inputs(f)).families[1].originalEntriesWithoutSource,71);});
test('Penteli explicit world and region identity remain separate fields',()=>{const f=fixture();for(const m of [f.penteli,f.finalPenteli])m.tiles['0,0'].source={regionId:'penteli',world:'penteli',revision};assert.equal(compareNativeManifestMetadata(inputs(f)).comparedCells,297);});
test('extra alias of slash-native world rejected',()=>{const f=fixture();for(const m of [f.megara,f.finalMegara])m.world='megara/accesscircuit';inputs(f);f.composed.regions.push({...f.composed.regions[1],id:'other-megara'});assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/ambiguous descriptor mapping/);});
test('cross-role alias of actual native world rejected',()=>{const f=fixture();for(const m of [f.megara,f.finalMegara])m.world='megara/accesscircuit';inputs(f);f.composed.regions[0].sourceWorld='megara/accesscircuit';assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/binding|ambiguous descriptor mapping/);});
test('explicit native source cannot use role name instead of actual slash world',()=>{const f=fixture();for(const m of [f.megara,f.finalMegara]){m.world='megara/accesscircuit';m.tiles['1000,0'].source={regionId:'megara',world:'megara',revision};}assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/ambiguous original native source/);});
test('composed projection aliases accepted at identical numbers',()=>{const f=fixture();f.composed.projection={lat0:projection.lat0,lon0:projection.lon0,metresPerLat:projection.mlat,metresPerLon:projection.mlon};assert.equal(compareNativeManifestMetadata(inputs(f)).comparedCells,297);});
test('composed projection alias number changes rejected',()=>{const f=fixture();f.composed.projection={lat0:projection.lat0,lon0:projection.lon0,metresPerLat:projection.mlat,metresPerLon:projection.mlon+1};assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/composed projection changed/);});
test('regional raw projection spelling change still rejected',()=>{const f=fixture();f.finalMegara.projection={lat0:projection.lat0,lon0:projection.lon0,metresPerLat:projection.mlat,metresPerLon:projection.mlon};assert.throws(()=>compareNativeManifestMetadata(inputs(f)),/final identity\/projection\/datum changed/);});
