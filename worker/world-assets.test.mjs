import test from 'node:test';import assert from 'node:assert/strict';import {worldAssets} from './world-assets.mjs';
const hash='a'.repeat(64),key='cells/'+hash+'.bin.gz',manifest='manifests/'+hash+'.json';
function fixture(){let reads=0;const saved=new Map(),wait=[],env={ATHENS_WORLD_MANIFEST:manifest,ATHENS_WORLD:{async get(k){reads++;return k===key?{body:new Uint8Array([31,139,8,0]),size:4,httpEtag:'"test"'}:null}}},ctx={waitUntil(p){wait.push(p)}},cache={async match(r){return saved.get(r.url)?.clone()},async put(r,s){saved.set(r.url,s)}};return{env,ctx,cache,wait,get reads(){return reads}};}
test('immutable bytes cached at edge without HTTP decompression or per-request bucket writes',async()=>{const f=fixture(),req=new Request('https://staging.athensracing.com/world/'+key+'?noise=1');const a=await worldAssets(req,f.env,f.ctx,f.cache);assert.deepEqual([...new Uint8Array(await a.arrayBuffer())],[31,139,8,0]);assert.equal(a.headers.get('Content-Encoding'),null);assert.match(a.headers.get('Cache-Control'),/31536000, immutable/);await Promise.all(f.wait);const b=await worldAssets(new Request(req.url.replace('?noise=1','?noise=2')),f.env,f.ctx,f.cache);assert.equal(b.status,200);assert.equal(f.reads,1);const c=await worldAssets(new Request(req.url,{headers:{'If-None-Match':'"test"'}}),f.env,f.ctx,f.cache);assert.equal(c.status,304);assert.equal(f.reads,1);});
test('production stays unavailable without owner-selected manifest; alias never cached',async()=>{const f=fixture(),req=new Request('https://athensracing.com/data/athens/manifest.json');assert.equal((await worldAssets(req,{ATHENS_WORLD:f.env.ATHENS_WORLD},f.ctx,f.cache)).status,404);const r=await worldAssets(req,f.env,f.ctx,f.cache);assert.equal(r.status,307);assert.equal(r.headers.get('Location'),'/world/'+manifest);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(f.reads,0);});
test('world routing rejects unknown keys and writes, leaves existing tracks untouched',async()=>{const f=fixture();for(const [path,method,status]of [['/world/raw.sqlite','GET',404],['/world/'+key,'PUT',405],['/world/'+hash,'GET',404]])assert.equal((await worldAssets(new Request('https://x'+path,{method}),f.env,f.ctx,f.cache)).status,status);assert.equal(await worldAssets(new Request('https://x/data/riviera.bin.gz'),f.env,f.ctx,f.cache),null);assert.equal(f.reads,0);});

test('recovery JSON has immutable bounded hash-verified bytes and the correct content type',async()=>{
 const {sha256,canonicalJSON}=await import('../src/route-definition.js');
 const body={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:'c'.repeat(64),sourceHashes:[],edges:[],anchors:[]},hash=await sha256(body),text=canonicalJSON(body),bytes=new TextEncoder().encode(text),key=`recovery/-1,2.${hash}.json`;
 let reads=0;const env={ATHENS_WORLD_MANIFEST:manifest,ATHENS_WORLD:{async get(k){reads++;return k===key?{body:bytes,size:bytes.byteLength,httpEtag:'"recovery"'}:null;}}};
 const response=await worldAssets(new Request('https://x/world/'+key),env,null,null);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/json');assert.match(response.headers.get('Cache-Control'),/immutable/);assert.deepEqual(await response.json(),body);
 assert.equal((await worldAssets(new Request('https://x/world/recovery/-1,2.short.json'),env,null,null)).status,404);assert.equal(reads,1);
 const rootKey=`recovery/manifest.${hash}.json`,rootEnv={...env,ATHENS_WORLD:{async get(k){return k===rootKey?{body:bytes,size:bytes.byteLength,httpEtag:'"root"'}:null;}}};assert.equal((await worldAssets(new Request('https://x/world/'+rootKey),rootEnv,null,null)).status,200);
 const tampered={...env,ATHENS_WORLD:{async get(){const b=new TextEncoder().encode(text.replace('athens-v1','athens-v2'));return{body:b,size:b.length,httpEtag:'"bad"'};}}};
 const rejected=await worldAssets(new Request('https://x/world/'+key),tampered,null,null);assert.equal(rejected.status,502);assert.equal(rejected.headers.get('Cache-Control'),'no-store');
 const oversized={...env,ATHENS_WORLD:{async get(){return{body:bytes,size:2*1024*1024+1};}}};assert.equal((await worldAssets(new Request('https://x/world/'+key),oversized,null,null)).status,413);
});

test('v2 recovery cells serve original packed bytes through GET cache HEAD and conditional requests', async () => {
 const { encodeRecoverySidecar } = await import('../server/route-road-wire.mjs');
 const { sha256 } = await import('../src/route-definition.js');
 const packed = encodeRecoverySidecar({ schemaVersion:1, worldId:'athens', projectionId:'athens-v1', worldSetRevision:'c'.repeat(64), sourceHashes:[['0,0','d'.repeat(64)]], edges:[{id:'road',from:'a',to:'b',flags:1,layer:0,surface:'road',points:[[0,0,0],[0,0,10]]}], anchors:[{edgeId:'road',offsetM:5,x:0,y:0,z:5,yaw:-Math.PI,layer:0,surfaceId:'road',leftM:4,rightM:4,halfWidth:1,halfLength:2,footprints:[{halfWidth:1,halfLength:2}]}] });
 const key = `recovery/0,0.${await sha256(packed)}.json`, bytes = new TextEncoder().encode(JSON.stringify(packed,null,1));
 let reads = 0; const saved = new Map(), wait = [], cache = {async match(r){return saved.get(r.url)?.clone()},async put(r,s){saved.set(r.url,s)}}, ctx = {waitUntil(p){wait.push(p)}}, env = {ATHENS_WORLD_MANIFEST:manifest,ATHENS_WORLD:{async get(k){reads++;assert.equal(k,key);return{body:bytes,size:bytes.length,httpEtag:'"packed"'}}}};
 const request = method => new Request('https://x/world/'+key+'?noise='+method,{method});
 const response = await worldAssets(request('GET'),env,ctx,cache);
 assert.equal(response.status,200); assert.equal(response.headers.get('Content-Type'),'application/json'); assert.equal(response.headers.get('Content-Length'),String(bytes.length));
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes,'no tuple expansion or canonical reserialization'); await Promise.all(wait);
 const cached = await worldAssets(request('GET'),env,ctx,cache); assert.deepEqual(new Uint8Array(await cached.arrayBuffer()),bytes); assert.equal(reads,1);
 const head = await worldAssets(request('HEAD'),env,ctx,cache); assert.equal(head.status,200); assert.equal(await head.text(),''); assert.equal(head.headers.get('Content-Length'),String(bytes.length));
 assert.equal((await worldAssets(new Request('https://x/world/'+key,{headers:{'If-None-Match':'"packed"'}}),env,ctx,cache)).status,304); assert.equal(reads,1);
});

test('recovery asset schema gate permits v1 manifests and supported cells only and never caches rejection', async () => {
 const {sha256,canonicalJSON} = await import('../src/route-definition.js');
 const base = {schemaVersion:2,worldId:'athens',projectionId:'athens-v1',worldSetRevision:'c'.repeat(64),anchorFields:[],footprintSets:[],anchors:[]};
 const cases = [
  ['manifest', base, 502], ['0,0', {...base,schemaVersion:3},502], ['0,0',{...base,schemaVersion:'2'},502],
  ['0,0',{...base,schemaVersion:0},502], ['0,0',{...base,worldId:'other'},502], ['0,0',{...base,projectionId:'other'},502],
  ['0,0',{...base,worldSetRevision:'short'},502], ['manifest',{...base,schemaVersion:1},200]
 ];
 for (const [cell,body,status] of cases) {
  const bytes = new TextEncoder().encode(canonicalJSON(body)), key = `recovery/${cell}.${await sha256(body)}.json`; let puts = 0;
  const env={ATHENS_WORLD_MANIFEST:manifest,ATHENS_WORLD:{async get(){return{body:bytes,size:bytes.length,httpEtag:'"schema"'}}}};
  const response = await worldAssets(new Request('https://x/world/'+key),env,{waitUntil(p){return p}},{async match(){},async put(){puts++}});
  assert.equal(response.status,status);
  if(status===502){assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(puts,0);}
 }
 const hash = await sha256(base), tampered = new TextEncoder().encode(canonicalJSON({...base,anchors:[[99]]})), path = `https://x/world/recovery/0,0.${hash}.json`;
 let puts=0; const cache={async match(){},async put(){puts++}}, ctx={waitUntil(p){return p}}, env={ATHENS_WORLD_MANIFEST:manifest,ATHENS_WORLD:{async get(){return{body:tampered,size:tampered.length}}}};
 assert.equal((await worldAssets(new Request(path),env,ctx,cache)).status,502);assert.equal(puts,0);
 const tooBig = new Uint8Array(2*1024*1024+1), oversized={...env,ATHENS_WORLD:{async get(){return{body:tooBig,size:tooBig.length}}}};
 assert.equal((await worldAssets(new Request(path),oversized,ctx,cache)).status,413);
 const lying={...env,ATHENS_WORLD:{async get(){return{body:tooBig,size:1}}}};
 assert.equal((await worldAssets(new Request(path),lying,ctx,cache)).status,413);assert.equal(puts,0);
});

test('recovery asset bytes reject malformed UTF-8 before cache while correctly encoded U+FFFD remains valid', async () => {
 const {sha256,canonicalJSON} = await import('../src/route-definition.js');
 const sequences = [[0xff,0xff,0xff],[0xe2,0x82],[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0x80]];
 for(const [cell,version] of [['0,0',1],['0,0',2],['manifest',1]]) for(const sequence of sequences){
  const body = {schemaVersion:version,worldId:'athens',projectionId:'athens-v1',worldSetRevision:'c'.repeat(64),edges:[{name:'UTF8_MARKER'}]};
  const [prefix,suffix] = canonicalJSON(body).split('UTF8_MARKER'), replacement = new TextDecoder().decode(new Uint8Array(sequence));
  const validBytes = Buffer.from(prefix+replacement+suffix), valid = JSON.parse(validBytes.toString()), key = `recovery/${cell}.${await sha256(valid)}.json`;
  const malformed = Buffer.concat([Buffer.from(prefix),Buffer.from(sequence),Buffer.from(suffix)]);
  assert.throws(()=>new TextDecoder('utf-8',{fatal:true}).decode(malformed),TypeError);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(malformed)),valid,'old replacement decoder passes canonical hash');
  let puts=0;const cache={async match(){},async put(){puts++}},wait=[],ctx={waitUntil(p){wait.push(p)}},envFor=bytes=>({ATHENS_WORLD_MANIFEST:manifest,ATHENS_WORLD:{async get(){return{body:bytes,size:bytes.length,httpEtag:'"utf8"'}}}});
  const request=()=>new Request('https://x/world/'+key);
  const good=await worldAssets(request(),envFor(validBytes),ctx,cache); assert.equal(good.status,200); assert.deepEqual(new Uint8Array(await good.arrayBuffer()),new Uint8Array(validBytes)); await Promise.all(wait); assert.equal(puts,1);
  const bad=await worldAssets(request(),envFor(malformed),ctx,cache); assert.equal(bad.status,502); assert.equal(bad.headers.get('Cache-Control'),'no-store'); assert.equal(puts,1,'bad bytes never cached');
 }
});
