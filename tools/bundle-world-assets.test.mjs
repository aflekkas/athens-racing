import test from 'node:test';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describeBundleWorldSource, bundleWorldSourceFromCatalogue, prepareBundleWorldAssets, serveBundleWorldRequest, BUNDLE_WORLD_ORIGIN as origin, BUNDLE_WORLD_LIMITS as L} from './bundle-world-assets.mjs';
import {canonicalWorldJSON, ATHENS_PROJECTION} from '../src/world-manifest.js';
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const cell=Uint8Array.of(31,139,8,0,255,42), cellSHA=hash(cell), cellKey='cells/'+cellSHA+'.bin.gz';
const revision='a'.repeat(64);
function fixture({composed=true, tweak, rootTweak}={}) {
  const projection={lat0:ATHENS_PROJECTION.lat0,lon0:ATHENS_PROJECTION.lon0,mlat:ATHENS_PROJECTION.metresPerLat,mlon:ATHENS_PROJECTION.metresPerLon};
  const m={tileVersion:1,world:composed?'source':'athens',revision,projection,tileMetres:512,elevation:{datum:'EVRS2000'},externalPortals:[],spawn:{cell:[0,0],anchor:'start'},tiles:{'0,0':{url:'/world/'+cellKey,sha256:cellSHA,bytes:cell.length,decodedBytes:64,triangles:0,dependencies:[]}}};
  tweak?.(m);
  const body=bytes(m), regionalKey='manifests/'+hash(body)+'.json';
  const content={schemaVersion:1,id:'athens',projection,tileMetres:512,regions:[{id:'basin',manifestUrl:'/world/'+regionalKey,manifestSha256:hash(body),sourceWorld:'source',sourceRevision:revision,access:'public',elevation:m.elevation,externalPortals:[]}]};
  let root=composed?{...content,revision:hash(bytes(canonicalWorldJSON(content)))}:m;
  rootTweak?.(root);
  const rootBytes=bytes(root), key='manifests/'+hash(rootBytes)+'.json';
  const source=describeBundleWorldSource({key,revision:root.revision},{world:'athens',revision:root.revision});
  const documents=new Map([[key,rootBytes],[regionalKey,body],[cellKey,cell]]);
  return {source,documents,key,regionalKey,root,m,rootBytes};
}
function fake(f, alter) {
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});const key=url.slice((origin+'/world/').length), body=f.documents.get(key);
    const result=alter?.({url,key,body,options,calls});
    if(result!==undefined)return result;
    return new Response(body??null,{status:body?200:404,headers:body?{'content-length':String(body.length)}:{}});
  };
  return {calls,fetcher};
}
const req=(path,options={})=>new Request('http://localhost'+path,options);
async function opened(f=fixture(),options={}) {const io=fake(f,options.alter),app=await prepareBundleWorldAssets(f.source,{fetcher:io.fetcher,...options});return {f,io,app};}
const scoped=async(fn,f=fixture(),options={})=>{const v=await opened(f,options);try{await fn(v);}finally{await v.app.close();}};
test('build descriptor carries exact immutable root SHA and semantic revision separately',()=>{
 const f=fixture();assert.notEqual(f.key.slice(10,-5),f.source.worldSetRevision);assert.deepEqual(f.source,{schemaVersion:1,origin,manifestKey:f.key,worldSetRevision:f.root.revision});
 for(const change of [b=>b.key='../bad',b=>b.revision='wrong',b=>b.extra=true]){const b={key:f.key,revision:f.root.revision};change(b);assert.throws(()=>describeBundleWorldSource(b,{world:'athens',revision:f.root.revision}));}
 assert.throws(()=>describeBundleWorldSource({key:f.key,revision:f.root.revision},{world:'other',revision:f.root.revision}),/binding/);
});
test('catalogue binding is private, exact installed config, offline only and common world',()=>{
 const f=fixture(),config={online:false,routes:[{worldSetRevision:f.source.worldSetRevision}]},catalogue={routeConfig:config,worldAssetSource:f.source};
 assert.deepEqual(bundleWorldSourceFromCatalogue(catalogue,config),f.source);
 for(const changed of [{...config,online:true},{...config,routes:[{worldSetRevision:'b'.repeat(64)}]}])assert.throws(()=>bundleWorldSourceFromCatalogue({...catalogue,routeConfig:changed},changed));
 assert.throws(()=>bundleWorldSourceFromCatalogue(catalogue,{...config,routes:[]}),/changed/);
 assert.throws(()=>bundleWorldSourceFromCatalogue({routeConfig:config},config),/descriptor/);
 const empty={online:false,routes:[]};assert.equal(bundleWorldSourceFromCatalogue({routeConfig:empty},empty),null);
 assert.throws(()=>bundleWorldSourceFromCatalogue({routeConfig:empty,worldAssetSource:f.source},empty),/unexpected/);
});
test('source descriptor and raised/unknown limits refuse with zero fake fetches',async()=>{
 const f=fixture();for(const source of [null,{...f.source,origin:'https://evil.test'},{...f.source,manifestKey:'manifests/no.json'},{...f.source,extra:true}]){const io=fake(f);await assert.rejects(prepareBundleWorldAssets(source,{fetcher:io.fetcher}));assert.equal(io.calls.length,0);}
 for(const limits of [{objectBytes:L.objectBytes+1},{unexpected:1},{objectBytes:0}]){const io=fake(f);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher,limits}));assert.equal(io.calls.length,0);}
});
test('preparation fetches only pinned root/region metadata, then alias wins over static JSON',async()=>scoped(async({app,io,f})=>{
 assert.equal(io.calls.length,2);assert.equal(app.status().objects,3);
 const response=await app.handle(req('/data/athens/manifest.json'));assert.equal(response.status,307);assert.equal(response.headers.get('location'),'/world/'+f.key);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal(io.calls.length,2);assert.equal(await app.handle(req('/src/main.js')),null);
 const served=await app.handle(req('/world/'+f.key));assert.deepEqual(new Uint8Array(await served.arrayBuffer()),f.rootBytes);assert.equal(io.calls.length,2);
}));
test('GET raw compressed bytes, HEAD and If-None-Match retain Worker response semantics',async()=>scoped(async({app,io})=>{
 const response=await app.handle(req('/world/'+cellKey));assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),cell);assert.equal(response.headers.get('content-encoding'),null);assert.equal(response.headers.get('content-length'),String(cell.length));assert.match(response.headers.get('cache-control'),/immutable/);
 const head=await app.handle(req('/world/'+cellKey,{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('etag'),'"'+cellSHA+'"');
 const same=await app.handle(req('/world/'+cellKey,{headers:{'if-none-match':'"'+cellSHA+'"'}}));assert.equal(same.status,304);assert.equal(await same.text(),'');
 assert.equal(io.calls.length,5); // no cell-body cache or cross-run fallback
}));
test('unknown immutable keys and invalid methods never fetch',async()=>scoped(async({app,io})=>{
 const n=io.calls.length;assert.equal((await app.handle(req('/world/cells/'+'0'.repeat(64)+'.bin.gz'))).status,404);
 assert.equal((await app.handle(req('/world/../not-world'))),null);
 assert.equal((await app.handle(req('/world/nope'))).status,404);
 assert.equal((await app.handle(req('/world/'+cellKey,{method:'POST'}))).status,405);
 assert.equal(io.calls.length,n);
}));
test('query and browser credentials never reach upstream',async()=>scoped(async({app,io})=>{
 await app.handle(req('/world/'+cellKey+'?x=secret',{headers:{cookie:'private=secret',authorization:'secret'}}));
 const call=io.calls.at(-1);assert.equal(call.url,origin+'/world/'+cellKey);assert.equal(call.options.redirect,'error');assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.deepEqual(call.options.headers,{'Accept-Encoding':'identity'});
}));
test('flat authenticated manifest is supported without inventing a region or rewriting bytes',async()=>scoped(async({app,io,f})=>{
 assert.equal(io.calls.length,1);const r=await app.handle(req('/world/'+f.key));assert.deepEqual(new Uint8Array(await r.arrayBuffer()),f.rootBytes);
},fixture({composed:false})));
test('raw root mismatch is rejected before JSON/region fetch',async()=>{
 const f=fixture(),io=fake(f,({key,body})=>key===f.key?new Response(bytes('{}')):undefined);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher}),/SHA mismatch/);assert.equal(io.calls.length,1);
});
test('root semantic revision, regional raw SHA and source identity remain mandatory',async()=>{
 const wrong=fixture({rootTweak:r=>r.revision='b'.repeat(64)});await assert.rejects(prepareBundleWorldAssets(wrong.source,{fetcher:fake(wrong).fetcher}),/semantic revision/);
 const f=fixture(),io=fake(f,({key})=>key===f.regionalKey?new Response(bytes('{}')):undefined);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher}),/SHA mismatch/);
 const bad=fixture({rootTweak:r=>{r.regions[0].sourceWorld='wrong';const {revision,...content}=r;r.revision=hash(bytes(canonicalWorldJSON(content)));}});await assert.rejects(prepareBundleWorldAssets(bad.source,{fetcher:fake(bad).fetcher}),/source revision/);
});
test('missing region, malformed UTF8 or JSON and mismatched expected world reject preparation',async()=>{
 const f=fixture(),io=fake(f,({key})=>key===f.regionalKey?new Response(null,{status:404}):undefined);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher}),/upstream status/);
 for(const b of [Uint8Array.of(255),bytes('{')]){const key='manifests/'+hash(b)+'.json',source={...f.source,manifestKey:key};await assert.rejects(prepareBundleWorldAssets(source,{fetcher:async()=>new Response(b)}));}
 await assert.rejects(prepareBundleWorldAssets({...f.source,worldSetRevision:'f'.repeat(64)},{fetcher:fake(f).fetcher}),/world revision/);
});
for(const [label,alter,pattern]of [
 ['non200',()=>new Response(null,{status:403}),/status/],
 ['redirect response',()=>new Response(null,{status:307,headers:{location:'https://evil.test'}}),/status/],
 ['HTTP gzip',({body})=>new Response(body,{headers:{'content-encoding':'gzip'}}),/encoding/],
 ['wrong length',({body})=>new Response(body,{headers:{'content-length':String(body.length+1)}}),/length/],
 ['invalid length',({body})=>new Response(body,{headers:{'content-length':'01'}}),/length/],
 ['unexpected URL',({body})=>{const r=new Response(body);Object.defineProperty(r,'url',{value:'https://evil.test/body'});return r;},/response URL/],
])test('preparation rejects '+label,async()=>{const f=fixture(),io=fake(f,alter);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher}),pattern);assert.equal(io.calls.length,1);});
test('metadata and inventory caps reject before fetching bodies; bounds cannot rise',async()=>{
 const f=fixture();await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher,limits:{metadataBytes:10}}),/length|byte/);
 await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher,limits:{objects:1}}),/inventory cap/);
 const bad=fixture({tweak:m=>m.tiles['0,0'].bytes=L.objectBytes+1});await assert.rejects(prepareBundleWorldAssets(bad.source,{fetcher:fake(bad).fetcher}),/identity\/size/);
});
test('absolute, traversing, encoded, queried or external manifest/cell URLs never fetch externally',async()=>{
 for(const url of ['https://staging.athensracing.com/world/'+cellKey,'//evil.test/x','/world/./'+cellKey,'/world/%63ells/x','/world/'+cellKey+'?q=x','/world/'+cellKey+'#x']){const f=fixture({tweak:m=>m.tiles['0,0'].url=url}),io=fake(f);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher}),/URL/);assert(io.calls.every(c=>c.url.startsWith(origin+'/world/manifests/')));}
 const f=fixture({rootTweak:r=>{r.regions[0].manifestUrl='https://evil.test/world/x';const {revision,...content}=r;r.revision=hash(bytes(canonicalWorldJSON(content)));}});const io=fake(f);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher}),/URL/);assert.equal(io.calls.length,1);
});
test('regional assets share exact immutable allowlist; local enrichment data is outside transport',async()=>{
 const f=fixture({tweak:m=>{m.regionalAssets=[{url:'/world/'+cellKey,sha256:cellSHA,bytes:cell.length,residentBytes:64}];m.enrichments=[{url:'/data/psychiko-streetscape.json'}];}});
 await scoped(async({app})=>assert.equal(app.status().objects,3),f);
 for(const tweak of [m=>m.regionalAssets=[{url:'/world/'+cellKey,sha256:cellSHA,bytes:cell.length+1}],m=>m.enrichments=[{url:'https://evil.test/private'}],m=>m.tiles['0,0'].range={offset:0,length:cell.length}]){const bad=fixture({tweak});await assert.rejects(prepareBundleWorldAssets(bad.source,{fetcher:fake(bad).fetcher}));}
});
test('corrupt first body latches failure; no retry, fallback or later successful request',async()=>scoped(async({app,io})=>{
 const first=app.handle(req('/world/'+cellKey));await assert.rejects(first,/SHA mismatch/);const reason=await app.failure;
 const before=io.calls.length;await assert.rejects(app.handle(req('/world/'+cellKey)),e=>e===reason);assert.equal(io.calls.length,before);assert.match(app.status().firstFailure,/SHA mismatch/);
},fixture(),{alter:({key})=>key===cellKey?new Response(Uint8Array.of(0,0,0,0,0,0)):undefined}));
test('actual streamed truncation/overrun and read error reject without accepting bytes',async()=>{
 for(const make of [()=>new Response(cell.subarray(0,5)),()=>new Response(Uint8Array.of(...cell,1))]){
  await scoped(async({app})=>assert.rejects(app.handle(req('/world/'+cellKey))),fixture(),{alter:({key})=>key===cellKey?make():undefined});
 }
});
test('errored reader preserves read first cause and records failed cleanup separately',async()=>{
 const v=await opened(fixture(),{alter:({key})=>key===cellKey?new Response(new ReadableStream({start(c){c.error(Error('synthetic read'));}})):undefined});
 await assert.rejects(v.app.handle(req('/world/'+cellKey)),/synthetic read/);const first=await v.app.failure;assert.match(first.message,/synthetic read/);await assert.rejects(v.app.close(),/synthetic read/);assert.equal(v.app.status().cleanupFailed,true);
});
test('upstream, downstream and request cumulative caps latch before further acceptance',async()=>{
 const f=fixture();await scoped(async({app})=>assert.rejects(app.handle(req('/world/'+cellKey)),/byte limit/),f,{limits:{upstreamBytes:f.rootBytes.length+f.documents.get(f.regionalKey).length+cell.length-1}});
 await scoped(async({app})=>assert.rejects(app.handle(req('/world/'+cellKey)),/downstream byte cap/),fixture(),{limits:{downstreamBytes:cell.length-1}});
 await scoped(async({app})=>{await app.handle(req('/data/athens/manifest.json'));await assert.rejects(app.handle(req('/data/athens/manifest.json')),/request cap/);},fixture(),{limits:{requests:1}});
});
test('one upstream operation and bounded FIFO; body reads do not overlap',async()=>{
 let inflight=0,peak=0;
 await scoped(async({app})=>{
  const responses=await Promise.all(Array.from({length:5},()=>app.handle(req('/world/'+cellKey))));assert(responses.every(r=>r.status===200));assert.equal(peak,1);
 },fixture(),{alter:({key})=>{if(key!==cellKey)return;return new Response(new ReadableStream({async start(c){inflight++;peak=Math.max(peak,inflight);await new Promise(resolve=>setTimeout(resolve,2));c.enqueue(cell);inflight--;c.close();}}));}});
});
test('pending cap remains failure and all queued operations settle',async()=>{
 const {app}=await opened(fixture(),{limits:{pending:1},alter:({key})=>key===cellKey?new Response(new ReadableStream({async start(c){await new Promise(r=>setTimeout(r,2));c.enqueue(cell);c.close();}})):undefined});
 try{const a=app.handle(req('/world/'+cellKey)),b=app.handle(req('/world/'+cellKey));const result=await Promise.allSettled([a,b]);assert(result.some(r=>r.status==='rejected'));assert.match(app.status().firstFailure,/pending/);}finally{await app.close();}
});
test('preparation deadline, object deadline and closed adapter reject with first cause',async()=>{
 const f=fixture();await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),limits:{prepareMs:5,objectMs:5}}),/deadline/);
 const {app,io}=await opened(fixture(),{limits:{objectMs:5},alter:({key,options})=>key===cellKey?new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})):undefined});
 try{await assert.rejects(app.handle(req('/world/'+cellKey)),/deadline/);const first=await app.failure;await assert.rejects(app.handle(req('/data/athens/manifest.json')),e=>e===first);}finally{await app.close();}
 assert.equal(io.calls.length,3);
});
test('external abort rejects before fetch and cancels an active reader',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort(Error('synthetic external'));const io=fake(f);await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher,signal:controller.signal}),/synthetic external/);assert.equal(io.calls.length,0);
 let cancelled=0;const live=new AbortController(),v=await opened(fixture(),{signal:live.signal,alter:({key})=>key===cellKey?new Response(new ReadableStream({pull(){},cancel(){cancelled++;}})):undefined});
 const work=v.app.handle(req('/world/'+cellKey));await new Promise(r=>setImmediate(r));live.abort(Error('synthetic active abort'));await assert.rejects(work,/active abort/);await v.app.close();assert.equal(cancelled,1);
});
test('close cancels hung reads and closes only this adapter; repeated close is safe',async()=>{
 let cancelled=0;const v=await opened(fixture(),{alter:({key})=>key===cellKey?new Response(new ReadableStream({pull(){},cancel(){cancelled++;}})):undefined});
 const work=v.app.handle(req('/world/'+cellKey));work.catch(()=>{});await new Promise(r=>setImmediate(r));await v.app.close();await assert.rejects(work,/closed/);assert.equal(cancelled,1);assert.equal(v.app.status().closed,true);await v.app.close();await assert.rejects(v.app.handle(req('/world/'+cellKey)),/closed/);
});
test('cleanup cancellation failure is not reported as clean',async()=>{
 const v=await opened(fixture(),{alter:({key})=>key===cellKey?new Response(new ReadableStream({pull(){},cancel(){throw Error('synthetic cancellation failure');}})):undefined});
 const work=v.app.handle(req('/world/'+cellKey));work.catch(()=>{});await new Promise(r=>setImmediate(r));await assert.rejects(v.app.close(),/cancellation failure/);await assert.rejects(work);
});
test('bridge serves alias/status/raw bytes before a generic static fallback and hides transport errors',async()=>scoped(async({app})=>{
 const result=()=>Object.assign(new EventEmitter(),{status:null,headers:null,body:null,writeHead(s,h){this.status=s;this.headers=h;},end(body,done){this.body=body;done?.();},destroy(){this.destroyed=true;this.closed=true;this.emit('close');}});
 let res=result();assert.equal(await serveBundleWorldRequest(app,{url:'/data/athens/manifest.json',method:'GET',headers:{}},res),true);assert.equal(res.status,307);
 res=result();await serveBundleWorldRequest(app,{url:'/world/'+cellKey,method:'GET',headers:{cookie:'private'}},res);assert.equal(res.status,200);assert.deepEqual(res.body,cell);assert.equal(res.headers['content-encoding'],undefined);
 res=result();assert.equal(await serveBundleWorldRequest(app,{url:'/src/main.js',method:'GET',headers:{}},res),false);assert.equal(res.status,null);
 res=result();await serveBundleWorldRequest({handle:async()=>{throw Error('secret path/token');}},{url:'/world/'+cellKey,method:'GET',headers:{}},res);assert.equal(res.status,null);assert.equal(res.body,null);assert.equal(res.destroyed,true);assert.equal(res.closed,true);
}));
const hostSource=readFileSync(new URL('./serve-bundle.mjs',import.meta.url),'utf8');
const gateSource=readFileSync(new URL('./check-bundle.mjs',import.meta.url),'utf8');
const buildSource=readFileSync(new URL('./prepare-deploy.mjs',import.meta.url),'utf8');
test('actual host orders world dispatch before JSON static code and preparation before listen',()=>{
 assert(hostSource.indexOf('await serveBundleWorldRequest(')<hostSource.indexOf("const path = new URL(req.url"));
 assert(hostSource.indexOf('await prepareBundleWorldAssets(source)')<hostSource.indexOf('app.server.listen('));
 assert.match(hostSource,/cache|worldAssets/);assert.match(hostSource,/readBuiltCatalogue\(root,options\.builtCataloguePath/);
 assert.match(buildSource,/\{manifest,binding\}=await activeRouteWorld/);
 assert.match(buildSource,/worldAssetSource=describeBundleWorldSource\(binding,manifest\)/);
 assert.match(buildSource,/\.deploy\/catalogue\.json.*worldAssetSource/);
 assert.equal(buildSource.match(/writeFile\(resolve\(out[^;\n]*worldAssetSource/g),null);
});
test('actual host failure closes app; successful close tries adapter and app independently',async()=>{
 const begin=hostSource.indexOf('export async function serveBundle'),end=hostSource.indexOf('\nif (process.argv[1]',begin),body=hostSource.slice(begin,end).replace('export ','');
 const calls=[],boom=Error('synthetic prep');
 const createGameServer=async()=>({routeConfig:{online:false,routes:[{worldSetRevision:revision}]},close:async()=>{calls.push('app close');},server:{listeners(){throw Error('must not reach listening');}}});
 const host=new Function('resolve','createGameServer','readBuiltCatalogue','bundleWorldSourceFromCatalogue','prepareBundleWorldAssets',body+'\nreturn serveBundle;')(resolve,createGameServer,async()=>({}),()=>({}),async()=>{calls.push('prepare');throw boom;});
 await assert.rejects(host('/build/assets'),e=>e===boom);assert.deepEqual(calls,['prepare','app close']);
});
test('all existing race checks stay intact and adapter failure races readiness',()=>{
 assert.match(gateSource,/\['riviera', 'megara', 'penteli'\]/);assert.match(gateSource,/worldSetRevision/);assert.match(gateSource,/__sim\.step\(90, 1 \/ 60\)/);assert.match(gateSource,/app\.worldAssets\.failure\.then/);assert.match(gateSource,/app\.worldAssets\.check\(\)/);assert.match(gateSource,/worldTransport:app\.worldAssets\?\.status\(\)/);
});

test('real installRouteMaps public normalization keeps all configured immutable tuples',async()=>{
 const source=readFileSync(new URL('../server/route-maps.mjs',import.meta.url),'utf8');
 const begin=source.indexOf('const sameRelease'),end=source.indexOf('export function routePacketMatches');
 const install=new Function('ROUTE_HASH',source.slice(begin,end).replace('export async function','async function')+'\nreturn installRouteMaps;')(/^[a-f0-9]{64}$/);
 const f=fixture(),entry={id:'riviera-coast',url:'/data/routes/riviera-coast.'+revision+'.json',routeHash:revision,geometryHash:revision,worldSetRevision:f.source.worldSetRevision};
 const catalogue={routeConfig:{environment:'staging',world:false,online:false,routes:[entry]},routes:[{...entry,worldId:'athens'}],worldAssetSource:f.source};
 const config=await install(new Map(),catalogue);
 assert.equal(config.onlineAvailable,false);assert.notDeepEqual(config,catalogue.routeConfig);
 assert.deepEqual(bundleWorldSourceFromCatalogue(catalogue,config),f.source);
 for(const field of ['id','url','routeHash','geometryHash','worldSetRevision']){const changed=structuredClone(config);changed.routes[0][field]+='x';assert.throws(()=>bundleWorldSourceFromCatalogue(catalogue,changed),/changed/);}
});
test('non200 response bodies are cancelled without reading their payload',async()=>{
 const f=fixture();let cancelled=0,read=0;
 await assert.rejects(prepareBundleWorldAssets(f.source,{fetcher:async()=>new Response(new ReadableStream({pull(){read++;},cancel(){cancelled++;}}),{status:403})}),/status/);
 assert.equal(cancelled,1);assert(read<=1); // native stream can pre-pull once, adapter never reads it
});
test('late response after timeout is cancelled when it arrives, no fallback',async()=>{
 const f=fixture();let finish,cancelled=0;
 const fetching=prepareBundleWorldAssets(f.source,{fetcher:()=>new Promise(resolve=>{finish=resolve;}),limits:{objectMs:5,prepareMs:5,closeMs:5}});
 await assert.rejects(fetching,/deadline/);
 finish(new Response(new ReadableStream({pull(){},cancel(){cancelled++;}})));await new Promise(r=>setImmediate(r));assert.equal(cancelled,1);
});
test('per-request abort cancels the sole body reader and stays fatal',async()=>{
 let cancelled=0;const v=await opened(fixture(),{alter:({key})=>key===cellKey?new Response(new ReadableStream({pull(){},cancel(){cancelled++;}})):undefined});
 const c=new AbortController(),work=v.app.handle(req('/world/'+cellKey,{signal:c.signal}));await new Promise(r=>setImmediate(r));c.abort(Error('synthetic request cancelled'));await assert.rejects(work,/request cancelled/);await v.app.close();assert.equal(cancelled,1);
});
test('body chunk count, run lifetime and bounded failure status are explicit',async()=>{
 const v=await opened(fixture(),{alter:({key})=>key===cellKey?Promise.reject(Error('x'.repeat(5000))):undefined});await assert.rejects(v.app.handle(req('/world/'+cellKey)));assert.equal(v.app.status().firstFailure.length,256);await v.app.close();
 let clock=0;await scoped(async({app,io})=>{clock=L.lifetimeMs;const n=io.calls.length;await assert.rejects(app.handle(req('/data/athens/manifest.json')),/deadline/);assert.equal(io.calls.length,n);},fixture(),{now:()=>clock});
});
test('executed host dispatches alias to adapter instead of static file read',async()=>scoped(async({app:adapter,f})=>{
 const begin=hostSource.indexOf('export async function serveBundle'),end=hostSource.indexOf('\nif (process.argv[1]',begin),body=hostSource.slice(begin,end).replace('export ','');
 const calls=[],listeners=new Map();
 const server={listeners(){return [()=>calls.push('fallback')];},removeAllListeners(){},on(type,fn){listeners.set(type,fn);},listen(_port,_host,done){calls.push('fake listen callback');done();},address(){return {port:1234};}};
 const real={routeConfig:{online:false,routes:[{worldSetRevision:f.source.worldSetRevision}]},server,close:async()=>calls.push('app close')};
 const host=new Function('resolve','createGameServer','readBuiltCatalogue','bundleWorldSourceFromCatalogue','prepareBundleWorldAssets','serveBundleWorldRequest','stat','readFile','createReadStream','extname',body+'\nreturn serveBundle;')(
 resolve,async()=>real,async()=>({}),()=>f.source,async()=>adapter,serveBundleWorldRequest,
 async()=>{calls.push('STATIC stat');return {size:1};},async()=>{calls.push('STATIC read');return new Uint8Array([1]);},()=>({pipe(res){calls.push('STATIC stream');res.end(new Uint8Array([1]));}}),()=>'.json');
 const hosted=await host('/build/assets');
 const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body,done){this.body=body;this.writableEnded=true;done?.();}};
 await listeners.get('request')({url:'/data/athens/manifest.json',method:'GET',headers:{}},res);
 assert.equal(res.status,307);assert.equal(res.headers.location,'/world/'+f.key);assert.equal(calls.some(s=>s.startsWith('STATIC')),false);
 await hosted.close();assert(calls.includes('app close'));
}));
test('actual close wrapper tries app even when adapter cleanup throws',async()=>{
 const begin=hostSource.indexOf('export async function serveBundle'),end=hostSource.indexOf('\nif (process.argv[1]',begin),body=hostSource.slice(begin,end).replace('export ','');
 const calls=[],boom=Error('synthetic adapter cleanup');
 const server={listeners:()=>[],removeAllListeners(){},on(){},listen(_p,_h,done){done();},address:()=>({port:1})};
 const host=new Function('resolve','createGameServer','readBuiltCatalogue','bundleWorldSourceFromCatalogue','prepareBundleWorldAssets',body+'\nreturn serveBundle;')(resolve,async()=>({server,routeConfig:{},close:async()=>calls.push('app close')}),async()=>({}),()=>({}),async()=>({close:async()=>{calls.push('adapter close');throw boom;}}));
 const result=await host('/build/assets');await assert.rejects(result.close(),e=>e===boom);assert.deepEqual(calls,['adapter close','app close']);
});
test('closed browser response cancels only its active transport reader',async()=>{
 const {EventEmitter}=await import('node:events');let cancelled=0;
 const v=await opened(fixture(),{alter:({key})=>key===cellKey?new Response(new ReadableStream({pull(){},cancel(){cancelled++;}})):undefined});
 const request=Object.assign(new EventEmitter(),{url:'/world/'+cellKey,method:'GET',headers:{}});
 const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,writeHead(){throw Error('closed response written');},end(){throw Error('closed response written');}});
 const serving=serveBundleWorldRequest(v.app,request,response);await new Promise(r=>setImmediate(r));response.destroyed=true;response.closed=true;response.emit('close');
 assert.equal(await serving,true);assert.equal(cancelled,1);assert.match((await v.app.failure).message,/client disconnected/);await v.app.close();assert.equal(response.listenerCount('close'),0);assert.equal(request.listenerCount('aborted'),0);
});
test('more than 4096 body chunks rejects even when total wire bytes remain small',async()=>{
 const large=Uint8Array.from({length:5000},(_,i)=>i%256),sha=hash(large),key='cells/'+sha+'.bin.gz';
 const f=fixture({tweak:m=>Object.assign(m.tiles['0,0'],{url:'/world/'+key,sha256:sha,bytes:large.length})});f.documents.set(key,large);
 const v=await opened(f,{alter:({key:k})=>k===key?new Response(new ReadableStream({start(c){for(let i=0;i<large.length;i++)c.enqueue(large.subarray(i,i+1));c.close();}})):undefined});
 try{await assert.rejects(v.app.handle(req('/world/'+key)),/chunk cap/);}finally{await v.app.close();}
});
test('status output has a fixed small bound without raw object listings or source values',async()=>scoped(async({app})=>{
 const status=app.status();assert(Buffer.byteLength(JSON.stringify(status))<=2048);assert.equal(Object.hasOwn(status,'body'),false);assert.equal(Object.hasOwn(status,'keys'),false);
}));

test('fetch implementation that ignores abort cannot claim cleanup confirmed',async()=>{
 const f=fixture();let finish;
 const failed=prepareBundleWorldAssets(f.source,{fetcher:()=>new Promise(resolve=>{finish=resolve;}),limits:{objectMs:5,prepareMs:5,closeMs:5}});
 await assert.rejects(failed,error=>/deadline/.test(error.message)&&/cleanup deadline/.test(error.cleanupError?.message));
 finish(new Response(f.rootBytes));await new Promise(r=>setImmediate(r));
 let release;const v=await opened(fixture(),{limits:{closeMs:5},alter:({key})=>key===cellKey?new Promise(resolve=>{release=resolve;}):undefined});
 const work=v.app.handle(req('/world/'+cellKey));work.catch(()=>{});await new Promise(r=>setImmediate(r));await assert.rejects(v.app.close(),/cleanup deadline/);await assert.rejects(work,/closed/);
 assert.equal(v.app.status().cleanupConfirmed,false);assert.equal(v.app.status().fetches,1);
 release(new Response(cell));await new Promise(r=>setImmediate(r));assert.equal(v.app.status().fetches,0);assert.equal(v.app.status().cleanupConfirmed,false);
});

test('response arriving at the preparation deadline is cancelled before any body read',async()=>{
 const f=fixture();let clock=0,cancelled=0;
 await assert.rejects(prepareBundleWorldAssets(f.source,{now:()=>clock,limits:{prepareMs:5},fetcher:async()=>{clock=5;return new Response(new ReadableStream({pull(){},cancel(){cancelled++;}}));}}),/deadline/);
 assert.equal(cancelled,1);
});

// Review133: actual module bridge controls, using only inert native-shaped sinks.
async function bridgeCase({path,method='GET',headers={},responseHook,sinkHook,limits={},afterConstruct}={}) {
 const {EventEmitter}=await import('node:events');let clock=0;
 const f=fixture(),io=fake(f),app=await prepareBundleWorldAssets(f.source,{fetcher:io.fetcher,limits,now:()=>clock});
 const setClock=value=>{clock=value;},request=Object.assign(new EventEmitter(),{url:path??('/world/'+f.key),method,headers});
 const calls=[],sink=Object.assign(new EventEmitter(),{
  headersSent:false,writableEnded:false,writableFinished:false,destroyed:false,
  writeHead(status,headers){calls.push({op:'headers',status,headers});this.headersSent=true;},
  end(body,done){calls.push({op:'body',bytes:body?.byteLength??String(body??'').length});this.writableEnded=true;this.writableFinished=true;done?.();},
  destroy(){calls.push({op:'destroy'});this.destroyed=true;this.closed=true;this.emit('close');},
 });
 sinkHook?.({sink,request,setClock,app,calls});
 const adapter={...app,async handle(...args){const response=await app.handle(...args);responseHook?.({response,setClock,request,sink,app,calls});return response;}};
 afterConstruct?.({request,setClock,app,sink});
 await serveBundleWorldRequest(adapter,request,sink);
 let closeError,closeErrorPresent=false;try{await app.close();}catch(error){closeErrorPresent=true;closeError=error;}
 return {calls,app,status:app.status(),io,f,closeError,closeErrorPresent,sink,request};
}
const successWrites=v=>v.calls.filter(call=>call.op==='headers'&&[200,304,307].includes(call.status));
test('Review133 actual module stops deadline during arrayBuffer and latches first failure',async()=>{
 const v=await bridgeCase({responseHook:({response,setClock})=>{const copy=response.arrayBuffer.bind(response);response.arrayBuffer=async()=>{const b=await copy();setClock(L.lifetimeMs);return b;};}});
 assert.equal(successWrites(v).length,0);assert.equal(v.calls.some(c=>c.op==='headers'),false);assert(v.calls.some(c=>c.op==='destroy'));
 const first=await v.app.failure;assert.match(first.message,/deadline/);assert.match(v.status.firstFailure,/deadline/);
 assert.throws(()=>v.app.check(),e=>e===first);assert.equal(v.closeError,undefined);
});
test('original request object deadline includes queued read plus body/header work',async()=>{
 const v=await bridgeCase({responseHook:({response,setClock})=>{const copy=response.arrayBuffer.bind(response);response.arrayBuffer=async()=>{const b=await copy();setClock(L.objectMs);return b;};}});
 assert.equal(successWrites(v).length,0);assert.match((await v.app.failure).message,/deadline/);
});
for(const stage of ['body','headers','status','writer-getter'])test('post-read '+stage+' deadline cannot send success',async()=>{
 const v=await bridgeCase({
  responseHook:({response,setClock})=>{
   if(stage==='body'){const copy=response.arrayBuffer.bind(response);response.arrayBuffer=async()=>{const value=await copy();setClock(L.lifetimeMs);return value;};}
   if(stage==='headers')Object.defineProperty(response,'headers',{value:{*[Symbol.iterator](){setClock(L.lifetimeMs);yield ['content-length','1'];}}});
   if(stage==='status')Object.defineProperty(response,'status',{get(){setClock(L.lifetimeMs);return 200;}});
  },
  sinkHook:({sink,setClock})=>{if(stage==='writer-getter'){const write=sink.writeHead;Object.defineProperty(sink,'writeHead',{get(){setClock(L.lifetimeMs);return write;}});}},
 });
 assert.equal(successWrites(v).length,0);assert.match((await v.app.failure).message,/deadline/);
});
for(const stage of ['body','headers','writer-getter'])test('request abort during '+stage+' cannot send success',async()=>{
 const v=await bridgeCase({
  responseHook:({response,request})=>{
   if(stage==='body'){const copy=response.arrayBuffer.bind(response);response.arrayBuffer=async()=>{const value=await copy();request.emit('aborted');return value;};}
   if(stage==='headers')Object.defineProperty(response,'headers',{value:{*[Symbol.iterator](){request.emit('aborted');yield ['content-length','1'];}}});
  },
  sinkHook:({sink,request})=>{if(stage==='writer-getter'){const write=sink.writeHead;Object.defineProperty(sink,'writeHead',{get(){request.emit('aborted');return write;}});}},
 });
 assert.equal(successWrites(v).length,0);assert.match((await v.app.failure).message,/disconnected/);
});
for(const [label,path,method,headers]of [
 ['GET',null,'GET',{}],['HEAD',null,'HEAD',{}],['304',null,'GET',{'if-none-match':'*'}],['alias','/data/athens/manifest.json','GET',{}],
])test(label+' retains same phase through header serialization',async()=>{
 const healthy=await bridgeCase({path,method,headers});assert.equal(successWrites(healthy).length,1);assert.equal(healthy.status.firstFailure,null);assert.equal(healthy.status.cleanupConfirmed,true);
 const expired=await bridgeCase({path,method,headers,responseHook:({response,setClock})=>{const h=response.headers;Object.defineProperty(response,'headers',{value:{*[Symbol.iterator](){for(const row of h)yield row;setClock(L.objectMs);}}});}});
 assert.equal(successWrites(expired).length,0);assert.match((await expired.app.failure).message,/deadline/);
});
test('Request header construction is charged to the same phase before handle',async()=>{
 const v=await bridgeCase({afterConstruct:({request,setClock})=>Object.defineProperty(request,'headers',{get(){setClock(L.objectMs);return {};}})});
 assert.equal(successWrites(v).length,0);assert.match((await v.app.failure).message,/deadline/);assert.equal(v.io.calls.length,2);
});
test('header write reaching deadline prevents body and destroys only owned response',async()=>{
 const v=await bridgeCase({sinkHook:({sink,setClock,calls})=>{sink.writeHead=function(status,headers){calls.push({op:'headers',status,headers});this.headersSent=true;setClock(L.objectMs);};}});
 assert.equal(successWrites(v).length,1);assert.equal(v.calls.some(c=>c.op==='body'),false);assert.equal(v.calls.at(-1).op,'destroy');assert.match(v.status.firstFailure,/deadline/);
});
test('end callback/flush costs reaching deadline remain fatal after irreversible output',async()=>{
 const v=await bridgeCase({sinkHook:({sink,setClock,calls})=>{sink.end=function(body,done){calls.push({op:'body',bytes:body?.byteLength});this.writableEnded=true;this.writableFinished=true;setClock(L.objectMs);done?.();};}});
 assert.match(v.status.firstFailure,/deadline/);assert.equal(v.calls.at(-1).op,'destroy');assert.equal(v.closeError,undefined);
});
test('deferred end completion is bounded and tracked until callback settles',async()=>{
 let done;
 const v=await bridgeCase({limits:{objectMs:5,closeMs:5},sinkHook:({sink,calls})=>{sink.end=function(body,callback){calls.push({op:'body',bytes:body?.byteLength});done=callback;this.writableEnded=true;};sink.destroy=function(){calls.push({op:'destroy'});this.destroyed=true;done?.(Error('synthetic destroyed'));this.closed=true;this.emit('close');};}});
 assert.match(v.status.firstFailure,/response deadline/);assert.equal(v.status.forwarding,0);assert.equal(v.closeError,undefined);assert(v.calls.some(c=>c.op==='destroy'));
});
test('uncooperative end callback cannot claim confirmed cleanup',async()=>{
 const v=await bridgeCase({limits:{objectMs:5,closeMs:5},sinkHook:({sink,calls})=>{sink.end=function(body){calls.push({op:'body',bytes:body?.byteLength});this.writableEnded=true;};sink.destroy=function(){calls.push({op:'destroy'});this.destroyed=true;};}});
 assert.match(v.status.firstFailure,/response deadline/);assert.match(v.closeError?.message,/response close deadline|cleanup deadline/);assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.forwarding,1);
});
test('content length and body-copy errors latch before successful headers',async()=>{
 for(const responseHook of [
  ({response})=>Object.defineProperty(response,'headers',{value:new Headers({'content-length':'1'})}),
  ({response})=>{response.arrayBuffer=async()=>{throw Error('synthetic copy failure');};},
  ({response})=>Object.defineProperty(response,'headers',{value:{[Symbol.iterator](){throw Error('synthetic header failure');}}}),
 ]){const v=await bridgeCase({responseHook});assert.equal(successWrites(v).length,0);assert(v.status.firstFailure);}
});
test('existing first failure survives later body/header/cleanup errors',async()=>{
 const first=Error('immutable first'),later=Error('later copy');
 const v=await bridgeCase({responseHook:({response,app})=>{response.arrayBuffer=async()=>{app.recordFailure(first);throw later;};}});
 assert.equal(await v.app.failure,first);assert.equal(v.status.firstFailure,'immutable first');assert(v.status.secondaryFailures.some(e=>e.message==='later copy'));assert.equal(successWrites(v).length,0);
});
test('header/end exceptions preserve primary; cleanup failures remain secondary and unconfirmed',async()=>{
 const first=Error('first write'),second=Error('destroy failure');
 const v=await bridgeCase({sinkHook:({sink,calls})=>{sink.writeHead=function(status){calls.push({op:'headers',status});this.headersSent=true;throw first;};sink.destroy=function(){calls.push({op:'destroy'});throw second;};}});
 assert.equal(await v.app.failure,first);assert.equal(v.status.firstFailure,'first write');assert(v.status.secondaryFailures.some(e=>e.message==='destroy failure'));assert.equal(v.closeError,second);assert.equal(v.status.cleanupConfirmed,false);
});
test('public deadline check itself latches instead of remaining an invisible failure',async()=>{
 let clock=0;const f=fixture(),app=await prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher,now:()=>clock});clock=L.lifetimeMs;
 assert.throws(()=>app.check(),/deadline/);assert.match(app.status().firstFailure,/deadline/);assert.equal(await app.failure,await app.failure);await app.close();
});

for(const kind of ['header-value','status-value'])test(kind+' serialization is charged before success',async()=>{
 const v=await bridgeCase({responseHook:({response,setClock})=>{
  if(kind==='header-value'){const h=response.headers;Object.defineProperty(response,'headers',{value:{*[Symbol.iterator](){for(const [key,value]of h)yield [key,{toString(){setClock(L.objectMs);return value;}}];}}});}
  else Object.defineProperty(response,'status',{value:{valueOf(){setClock(L.objectMs);return 200;}}});
 }});
 assert.equal(successWrites(v).length,0);assert.match(v.status.firstFailure,/deadline/);
});

test('final listener cleanup costs cannot leave an invisible late success',async()=>{
 const v=await bridgeCase({sinkHook:({sink,setClock})=>{const remove=sink.removeListener;sink.removeListener=function(...args){const result=remove.apply(this,args);setClock(L.objectMs);return result;};}});
 assert.match(v.status.firstFailure,/deadline/);assert.equal(v.calls.at(-1).op,'destroy');assert.throws(()=>v.app.check(),/deadline/);
});

// Review146: no second HTTP error body; independently observed owned closure.
const failCopy=({response})=>{response.arrayBuffer=async()=>{throw Error('primary body-copy failure');};};
test('copy failure starts no502/body write and confirms only observed owned close',async()=>{
 const v=await bridgeCase({responseHook:failCopy});
 assert.equal(v.calls.some(c=>c.op==='headers'||c.op==='body'),false);assert.equal(v.calls.filter(c=>c.op==='destroy').length,1);
 assert.equal(v.status.firstFailure,'primary body-copy failure');assert.equal(v.status.responseCleanupPending,0);assert.equal(v.status.responseCleanupUncertain,0);assert.equal(v.status.cleanupConfirmed,true);
});
test('destroyed flag without close is explicit uncertainty, never cleanup confirmation',async()=>{
 const v=await bridgeCase({limits:{closeMs:5},responseHook:failCopy,sinkHook:({sink,calls})=>{sink.destroy=function(){calls.push({op:'destroy'});this.destroyed=true;};}});
 assert.equal(v.calls.some(c=>c.op==='headers'||c.op==='body'),false);assert.equal(v.sink.destroyed,true);assert.equal(v.sink.writableFinished,false);
 assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupPending,0);assert.equal(v.status.responseCleanupUncertain,1);assert.equal(v.status.forwarding,0);assert.match(v.closeError?.message,/close deadline|cleanup deadline/);
});
test('failure close record stays pending until actual observed completion',async()=>{
 const f=fixture(),app=await prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher});
 const first=Error('immutable body error');app.recordFailure(first);
 const sink=new EventEmitter();let destroyCalls=0;sink.destroy=()=>{destroyCalls++;};
 const closing=app.closeFailedResponse(sink);await new Promise(r=>setImmediate(r));
 assert.equal(app.status().responseCleanupPending,1);assert.equal(app.status().forwarding,1);assert.equal(app.status().cleanupConfirmed,false);
 sink.closed=true;sink.emit('close');await closing;assert.equal(app.status().responseCleanupPending,0);assert.equal(app.status().forwarding,0);
 await app.close();assert.equal(app.status().cleanupConfirmed,true);assert.equal(await app.failure,first);assert.equal(destroyCalls,1);
});
test('late close cannot upgrade timed-out cleanup and does not reset budget',async()=>{
 const v=await bridgeCase({limits:{closeMs:5},responseHook:failCopy,sinkHook:({sink,calls})=>{sink.destroy=function(){calls.push({op:'destroy'});this.destroyed=true;};}});
 const first=await v.app.failure;v.sink.closed=true;v.sink.emit('close');await new Promise(r=>setImmediate(r));
 assert.equal(v.app.status().cleanupConfirmed,false);assert.equal(v.app.status().responseCleanupUncertain,1);assert.equal(await v.app.failure,first);
 await assert.rejects(v.app.closeFailedResponse(v.sink),/close deadline|cleanup deadline/);assert.equal(v.calls.filter(c=>c.op==='destroy').length,1);
 await assert.rejects(v.app.close());assert.equal(v.app.status().cleanupConfirmed,false);
});
test('destroy throw is secondary and cannot be called confirmed even if it emitted close',async()=>{
 const secondary=Error('destroy threw after close');
 const v=await bridgeCase({responseHook:failCopy,sinkHook:({sink,calls})=>{sink.destroy=function(){calls.push({op:'destroy'});this.closed=true;this.emit('close');throw secondary;};}});
 assert.equal(v.status.firstFailure,'primary body-copy failure');assert.equal(v.closeError,secondary);assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupUncertain,1);assert(v.status.secondaryFailures.some(e=>e.message==='destroy threw after close'));
});
test('cleanup observer failure still attempts destruction and remains unconfirmed',async()=>{
 const v=await bridgeCase({responseHook:failCopy,sinkHook:({sink,calls})=>{const once=sink.once;sink.once=function(event,...args){if(event==='close'&&args[0]?.name==='onClose')throw Error('close observer failure');return once.call(this,event,...args);};sink.destroy=function(){calls.push({op:'destroy'});this.closed=true;};}});
 assert.equal(v.calls.filter(c=>c.op==='destroy').length,1);assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupUncertain,1);assert.equal(v.status.firstFailure,'primary body-copy failure');
});
test('close observed at cleanup deadline remains failure after all sink costs',async()=>{
 const v=await bridgeCase({responseHook:failCopy,sinkHook:({sink,setClock,calls})=>{sink.destroy=function(){calls.push({op:'destroy'});this.closed=true;this.emit('close');setClock(L.closeMs);};}});
 assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupUncertain,1);assert.equal(v.status.firstFailure,'primary body-copy failure');assert.match(v.closeError?.message,/close late|cleanup deadline/);
});
test('already failed/aborted work phase cannot skip its independent cleanup',async()=>{
 const v=await bridgeCase({responseHook:({response,request,setClock})=>{const copy=response.arrayBuffer.bind(response);response.arrayBuffer=async()=>{const b=await copy();setClock(L.lifetimeMs);request.emit('aborted');return b;};}});
 assert.equal(v.calls.some(c=>c.op==='headers'||c.op==='body'),false);assert.equal(v.calls.filter(c=>c.op==='destroy').length,1);assert.equal(v.status.cleanupConfirmed,true);assert.equal(v.status.responseCleanupUncertain,0);assert(v.status.firstFailure);
});
test('late normal-end callback after explicit close uncertainty cannot upgrade outcome',async()=>{
 let callback;
 const v=await bridgeCase({limits:{objectMs:5,closeMs:5},sinkHook:({sink,calls})=>{sink.end=function(body,done){calls.push({op:'body',bytes:body?.byteLength});callback=done;this.writableEnded=true;};sink.destroy=function(){calls.push({op:'destroy'});this.destroyed=true;};}});
 const first=await v.app.failure;assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupUncertain,1);assert.equal(v.status.forwarding,1);
 callback();await new Promise(r=>setImmediate(r));assert.equal(v.app.status().forwarding,0);assert.equal(v.app.status().cleanupConfirmed,false);assert.equal(v.app.status().responseCleanupUncertain,1);assert.equal(await v.app.failure,first);
});
test('final adapter close shares failed-response cleanup deadline instead of resetting it',async()=>{
 let clock=0;const f=fixture(),app=await prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher,now:()=>clock});
 const first=Error('first before cleanup');app.recordFailure(first);
 const sink=new EventEmitter();sink.destroy=()=>{sink.closed=true;sink.emit('close');};
 await app.closeFailedResponse(sink);clock=L.closeMs;
 await assert.rejects(app.close(),/cleanup confirmation late|cleanup deadline/);assert.equal(app.status().cleanupConfirmed,false);assert.equal(await app.failure,first);
});
test('normal405 response is still forwarded with no failure-close or second write',async()=>{
 const v=await bridgeCase({method:'POST'});assert.equal(v.calls.find(c=>c.op==='headers').status,405);assert.equal(v.calls.filter(c=>c.op==='body').length,1);assert.equal(v.calls.some(c=>c.op==='destroy'),false);
 assert.equal(v.status.firstFailure,null);assert.equal(v.status.responseCleanupUncertain,0);assert.equal(v.status.cleanupConfirmed,true);
});

for(const closes of [false,true])test('native-shaped cleanup error '+(closes?'with close':'without close')+' stays secondary',async()=>{
 const error=Error('native-shaped close error');
 const v=await bridgeCase({limits:{closeMs:5},responseHook:failCopy,sinkHook:({sink,calls})=>{sink.destroy=function(){calls.push({op:'destroy'});this.destroyed=true;this.emit('error',error);if(closes){this.closed=true;this.emit('close');}};}});
 assert.equal(v.status.firstFailure,'primary body-copy failure');assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupUncertain,1);assert.equal(v.closeError,error);assert(v.status.secondaryFailures.some(e=>e.message==='native-shaped close error'));
});

// Review155: rejection/catch presence is independent of JavaScript truthiness.
const falsyCases=[['zero',0],['false',false],['empty',''],['null',null],['undefined',undefined]];
async function rejection(work) {
 let present=false,value;try{await work;}catch(error){present=true;value=error;}
 assert.equal(present,true,'expected rejection presence');return value;
}
for(const [label,value]of falsyCases)for(const where of ['destroy-after-close','destroy-without-close','observe','remove','closed-getter','error-event'])test('falsy '+label+' '+where+' remains cleanup failure',async()=>{
 const primary=Error('immutable original work Error');
 const v=await bridgeCase({
  responseHook:({response})=>{response.arrayBuffer=async()=>{throw primary;};},
  sinkHook:({sink,calls})=>{
   if(where==='observe'){const once=sink.once;sink.once=function(event,...args){if(event==='close'&&args[0]?.name==='onClose')throw value;return once.call(this,event,...args);};}
   if(where==='remove'){const remove=sink.removeListener;sink.removeListener=function(event,listener){const result=remove.call(this,event,listener);if(event==='close'&&listener?.name==='onClose')throw value;return result;};}
   if(where==='closed-getter')Object.defineProperty(sink,'closed',{get(){throw value;}});
   sink.destroy=function(){
    calls.push({op:'destroy'});this.destroyed=true;
    if(where==='destroy-without-close')throw value;
    if(where==='error-event')this.emit('error',value);
    if(where!=='closed-getter')this.closed=true;this.emit('close');
    if(where==='destroy-after-close')throw value;
   };
  },
 });
 assert.equal(await v.app.failure,primary);assert.equal(v.status.firstFailurePresent,true);
 assert.equal(v.status.cleanupFailed,true);assert.equal(v.status.cleanupConfirmed,false);assert.equal(v.status.responseCleanupUncertain,1);
 assert.equal(v.closeErrorPresent,true);assert.equal(Object.is(v.closeError,value),true);assert.equal(v.calls.filter(c=>c.op==='destroy').length,1);
 assert(v.status.secondaryFailures.length>0);assert(Buffer.byteLength(JSON.stringify(v.status))<=2048);
});
for(const [label,value]of falsyCases)test('reader cancel rejection '+label+' remains failure',async()=>{
 const primary=Error('original abort Error'),controller=new AbortController();
 const v=await opened(fixture(),{signal:controller.signal,alter:({key})=>key===cellKey?new Response(new ReadableStream({pull(){},cancel(){throw value;}})):undefined});
 const work=v.app.handle(req('/world/'+cellKey));await new Promise(r=>setImmediate(r));controller.abort(primary);
 assert.equal(await rejection(work),primary);assert.equal(await rejection(v.app.close()),value);
 assert.equal(v.app.status().cleanupFailed,true);assert.equal(v.app.status().cleanupConfirmed,false);assert.equal(await v.app.failure,primary);
});
for(const [label,value]of falsyCases)for(const where of ['release-lock','remove-abort-listener'])test('fetch finalizer '+where+' '+label+' is captured before preparation acceptance',async()=>{
 const f=fixture(),controller=new AbortController();
 if(where==='remove-abort-listener')Object.defineProperty(controller.signal,'removeEventListener',{value(){throw value;}});
 const io=fake(f,({key,body})=>{
  if(where!=='release-lock'||key!==f.key)return;
  const response=new Response(body),reader=response.body.getReader.bind(response.body);
  response.body.getReader=()=>{const r=reader();r.releaseLock=()=>{throw value;};return r;};return response;
 });
 const error=await rejection(prepareBundleWorldAssets(f.source,{fetcher:io.fetcher,signal:controller.signal}));
 assert.equal(error instanceof Error,true);assert.equal(Object.is(error.cause,value),true);
 assert.equal(Object.hasOwn(error,'cleanupError'),true);assert.equal(Object.is(Object.getOwnPropertyDescriptor(error,'cleanupError').value,value),true);
});
for(const [label,value]of falsyCases)test('late-fetch cleanup acquisition '+label+' remains failure',async()=>{
 let finish;const v=await opened(fixture(),{limits:{objectMs:5},alter:({key})=>key===cellKey?new Promise(resolve=>{finish=resolve;}):undefined});
 await rejection(v.app.handle(req('/world/'+cellKey)));const first=await v.app.failure;
 const response=new Response(cell);response.body.getReader=()=>{throw value;};finish(response);await new Promise(r=>setImmediate(r));
 assert.equal(await rejection(v.app.close()),value);assert.equal(v.app.status().cleanupFailed,true);assert.equal(v.app.status().cleanupConfirmed,false);assert.equal(await v.app.failure,first);
});
for(const [label,value]of falsyCases)test('non-Error work throw '+label+' has explicit first failure and exact raw cause',async()=>{
 const v=await bridgeCase({responseHook:({response})=>{response.arrayBuffer=async()=>{throw value;};}});
 const first=await v.app.failure;assert.equal(first instanceof Error,true);assert.equal(Object.is(first.cause,value),true);assert.equal(v.status.firstFailurePresent,true);assert.equal(v.status.prepared,false);assert.equal(v.status.cleanupConfirmed,true);
});
for(const [label,args]of [['noarg',[]],['undefined',[undefined]],['null',[null]]])test('Node end callback '+label+' is success, not a thrown-value event',async()=>{
 const v=await bridgeCase({sinkHook:({sink,calls})=>{sink.end=function(body,done){calls.push({op:'body',bytes:body?.byteLength});this.writableEnded=true;this.writableFinished=true;done(...args);};}});
 assert.equal(v.status.firstFailurePresent,false);assert.equal(v.status.firstFailure,null);assert.equal(v.status.cleanupConfirmed,true);assert.equal(v.calls.some(c=>c.op==='destroy'),false);
});
for(const [label,value]of falsyCases.filter(([,v])=>v!==null&&v!==undefined))test('non-nullish malformed end callback '+label+' is failure',async()=>{
 const v=await bridgeCase({sinkHook:({sink,calls})=>{sink.end=function(body,done){calls.push({op:'body',bytes:body?.byteLength});this.writableEnded=true;done(value);};}});
 const first=await v.app.failure;assert.equal(first instanceof Error,true);assert.equal(Object.is(first.cause,value),true);assert.equal(v.status.prepared,false);assert.equal(v.calls.some(c=>c.op==='destroy'),true);
});
test('installed inert Writable end follows nullish success contract with no HTTP or native I/O',async()=>{
 const {Writable}=await import('node:stream');const received=[];
 const sink=new Writable({write(_chunk,_encoding,done){done();}});
 await new Promise((resolve,reject)=>sink.end('inert',function(...args){received.push(args);if(args[0]!==null&&args[0]!==undefined)reject(args[0]);else resolve();}));
 assert.equal(received.length,1);assert(received[0].length===0||received[0][0]===null||received[0][0]===undefined);assert.equal(sink.writableFinished,true);
});
test('diagnostics do not invoke Error accessors, coercion or Proxy traps',async()=>{
 let calls=0;const getter=Error();Object.defineProperty(getter,'message',{get(){calls++;throw Error('getter invoked');}});
 const coercion={get message(){calls++;throw Error('getter invoked');},toString(){calls++;throw Error('coercion invoked');}};
 const proxy=new Proxy(Error('hidden'),{get(){calls++;throw Error('proxy get');},getOwnPropertyDescriptor(){calls++;throw Error('proxy descriptor');},getPrototypeOf(){calls++;throw Error('proxy prototype');}});
 for(const value of [getter,coercion,proxy]){
  const primary=Error('original');const v=await bridgeCase({responseHook:({response})=>{response.arrayBuffer=async()=>{throw primary;};},sinkHook:({sink})=>{sink.destroy=function(){this.closed=true;this.emit('close');throw value;};}});
  assert.equal(await v.app.failure,primary);assert.equal(v.closeError,value);assert.equal(v.status.cleanupFailed,true);assert.equal(v.status.cleanupConfirmed,false);
 }
 assert.equal(calls,0);
});
test('bounded display does not affect raw Error identity or overflow visibility',async()=>{
 const f=fixture(),app=await prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher}),first=Error('"'.repeat(256));
 app.recordFailure(first);for(let i=0;i<10;i++)app.recordFailure(Error('"'.repeat(500)),'bridge-cleanup');
 assert.equal(await app.failure,first);const status=app.status();assert.equal(status.secondaryFailures.length,8);assert.equal(status.secondaryOverflow,true);assert(Buffer.byteLength(JSON.stringify(status))<=2048);
 await rejection(app.close());assert.equal(app.status().cleanupConfirmed,false);
});

for(const [label,value]of falsyCases)test('cleanup initialization '+label+' cannot skip destruction or confirm cleanup',async()=>{
 let throwNext=false;const f=fixture(),app=await prepareBundleWorldAssets(f.source,{fetcher:fake(f).fetcher,now:()=>{if(throwNext){throwNext=false;throw value;}return 0;}});
 const primary=Error('original before cleanup');app.recordFailure(primary);let destroyed=0;
 const sink=new EventEmitter();sink.destroy=()=>{destroyed++;sink.closed=true;sink.emit('close');};
 throwNext=true;assert.equal(await rejection(app.closeFailedResponse(sink)),value);assert.equal(await rejection(app.close()),value);
 assert.equal(destroyed,1);assert.equal(app.status().cleanupFailed,true);assert.equal(app.status().cleanupConfirmed,false);assert.equal(app.status().responseCleanupUncertain,1);assert.equal(await app.failure,primary);
});

for(const [label,value]of falsyCases)test('write error event '+label+' records presence before AbortController normalizes reason',async()=>{
 const v=await bridgeCase({sinkHook:({sink,calls})=>{sink.writeHead=function(status,headers){calls.push({op:'headers',status,headers});this.headersSent=true;this.emit('error',value);};}});
 const first=await v.app.failure;assert.equal(first instanceof Error,true);assert.equal(Object.is(first.cause,value),true);assert.equal(v.status.firstFailurePresent,true);assert.equal(v.calls.some(c=>c.op==='body'),false);assert.equal(v.status.prepared,false);
});
