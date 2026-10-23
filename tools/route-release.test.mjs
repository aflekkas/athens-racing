import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rebindRouteShard, checkBuiltRouteRelease} from './route-release.mjs';
import {fixture} from './fixtures/routes/fixture.mjs';
import {attachRivalPlans} from './build-rival-plans.mjs';
import {compileRoute} from '../src/route-compile.js';

const old = 'a'.repeat(64), next = 'b'.repeat(64), cellHash = 'c'.repeat(64);
test('a route proof rebinds only when every emitted contact cell is identical', () => {
  const cell = {sha256:cellHash,bytes:10,decodedBytes:20,residentBytes:30,transientBytes:40,triangles:2,contactEligible:true,dependencies:[],source:{regionId:'basin',world:'source',revision:old}};
  const shard = {schemaVersion:1,worldSetRevision:old,cells:{'0,0':cell},sourceHashes:[['0,0',cellHash]],edges:[],proofs:{}};
  const bound = rebindRouteShard(shard,{revision:next,tiles:{'0,0':{...cell}}});
  assert.equal(bound.world.revision,next);assert.equal(bound.shard.worldSetRevision,next);assert.equal(shard.worldSetRevision,old);
  assert.throws(()=>rebindRouteShard(shard,{revision:next,tiles:{'0,0':{...cell,sha256:'d'.repeat(64)}}}),/Route proof cell changed/);
  assert.throws(()=>rebindRouteShard({...shard,sourceHashes:[]},{revision:next,tiles:{'0,0':cell}}),/Incomplete emitted route source identities/);
});

test('route asset URL changes with its world binding while geometry identity stays stable', async () => {
  const f=fixture(), first=await compileRoute(f.definition,f.graph,f.contacts),second=await compileRoute(f.definition,f.graph,{...f.contacts,worldSetRevision:next});
  assert.equal(first.geometryHash,second.geometryHash);assert.equal(first.graphDigest,second.graphDigest);assert.notEqual(first.routeHash,second.routeHash);
});

test('the release gate rejects a stale compiled route or a changed Wrangler pointer', async () => {
  const root=await mkdtemp(join(tmpdir(),'athens-route-release-'));
  try {
    const f=fixture(),[artifact]=await attachRivalPlans([await compileRoute(f.definition,f.graph,{...f.contacts,worldSetRevision:next})]),key=`manifests/${old}.json`,entry={id:artifact.id,routeHash:artifact.routeHash,geometryHash:artifact.geometryHash,worldSetRevision:next};
    await symlink(new URL('../src',import.meta.url).pathname,join(root,'src'));await symlink(new URL('.',import.meta.url).pathname,join(root,'tools'));
    for(const path of ['assets/athens','.deploy/assets/data/routes','.deploy/assets'])await mkdir(join(root,path),{recursive:true});
    const put=(path,value)=>writeFile(join(root,path),JSON.stringify(value));
    await put('wrangler.jsonc',{env:{staging:{vars:{ATHENS_WORLD_MANIFEST:key}},production:{vars:{ATHENS_WORLD_MANIFEST:key}} }});
    await put('assets/athens/streets.json',{manifest:key,revision:next});
    await put('.deploy/assets/data/routes/index.json',{routes:[entry]});
    await put('.deploy/assets/route-config.json',{routes:[entry]});
    await put('.deploy/catalogue.json',{routes:[entry]});
    await put(`.deploy/assets/data/routes/${entry.id}.${entry.routeHash}.json`,artifact);
    assert.deepEqual(await checkBuiltRouteRelease(root),{checked:1,revision:next});
    assert.deepEqual(await checkBuiltRouteRelease(root,'production'),{checked:1,revision:next});
    await put(`.deploy/assets/data/routes/${entry.id}.${entry.routeHash}.json`,{...artifact,worldSetRevision:old});
    await assert.rejects(checkBuiltRouteRelease(root),/artifact\/world release mismatch/);
    await assert.rejects(checkBuiltRouteRelease(root,'production'),/artifact\/world release mismatch/);
    await put(`.deploy/assets/data/routes/${entry.id}.${entry.routeHash}.json`,{...artifact,rivalPlan:{...artifact.rivalPlan,geometryHash:old}});
    await assert.rejects(checkBuiltRouteRelease(root),/Stale rival/);
    await put('wrangler.jsonc',{env:{staging:{vars:{ATHENS_WORLD_MANIFEST:`manifests/${next}.json`}}}});
    await assert.rejects(checkBuiltRouteRelease(root),/Picker streets and deployed world manifest differ/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('source object field order does not change a reviewed emitted cell identity',()=>{
 const prior={sha256:cellHash,bytes:10,decodedBytes:20,source:{revision:old,world:'source',regionId:'basin'}},active={...prior,source:{regionId:'basin',world:'source',revision:old}},shard={schemaVersion:1,worldSetRevision:old,cells:{'0,0':prior},sourceHashes:[['0,0',cellHash]],edges:[],proofs:{}};
 assert.equal(rebindRouteShard(shard,{revision:next,tiles:{'0,0':active}}).shard.worldSetRevision,next);assert.throws(()=>rebindRouteShard(shard,{revision:next,tiles:{'0,0':{...active,source:{...active.source,world:'changed'}}}}),/cell changed/);
});

test('a route-specific rollout emits only the enabled picker/server entries',async()=>{
 const {selectRouteRelease}=await import('./route-release.mjs'),routes=[{id:'penteli-hill'},{id:'penteli-descent'}],build={index:{schemaVersion:1,routes},server:{schemaVersion:1,routes}};
 assert.deepEqual(selectRouteRelease(build,['penteli-hill']).index.routes,[routes[0]]);assert.deepEqual(selectRouteRelease(build,['penteli-descent']).server.routes,[routes[1]]);assert.deepEqual(build.index.routes,routes);assert.throws(()=>selectRouteRelease(build,['unknown']),/Unknown enabled route/);
});

test('regional sibling proofs are rebound and available beside the temporary build input',async()=>{
 const {writeRouteProofs}=await import('./route-release.mjs'),{readRouteInputs}=await import('./route-input.mjs'),{readFile}=await import('node:fs/promises'),root=await mkdtemp(join(tmpdir(),'athens-bound-regional-proof-'));try{
  await mkdir(join(root,'data/routes/validation'),{recursive:true});await mkdir(join(root,'.deploy'));
  const cell={sha256:cellHash,bytes:10,decodedBytes:20,source:{revision:old,world:'source',regionId:'penteli'}},shard={schemaVersion:1,worldSetRevision:old,cells:{'0,0':cell},sourceHashes:[['0,0',cellHash]],edges:[],turns:[],proofs:{contact:{},width:{},safe:{}}},manifest={revision:next,tiles:{'0,0':cell}};
  await writeFile(join(root,'data/routes/validation/penteli.inputs.json'),JSON.stringify(shard));const prepared=await writeRouteProofs(root,{...shard,shards:['penteli.inputs.json']},manifest,join(root,'.deploy'));
  const world=join(root,'.deploy/world.json'),graph=join(root,'.deploy/input.json');await writeFile(world,JSON.stringify(prepared.bound.world));await writeFile(graph,JSON.stringify(prepared.bound.shard));assert.equal((await readRouteInputs({world,graph})).shard.worldSetRevision,next);assert.equal(JSON.parse(await readFile(join(root,'.deploy/penteli.inputs.json'))).worldSetRevision,next);await prepared.cleanup();await assert.rejects(readFile(join(root,'.deploy/penteli.inputs.json')),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('actual built-route verifier rejects malformed original bytes in root catalogue, route index/config and compiled artifact',async()=>{
 const {readFile}=await import('node:fs/promises'),{canonicalJSON,sha256}=await import('../src/route-definition.js'),root=await mkdtemp(join(tmpdir(),'athens-verifier-utf8-'));
 try{
  const f=fixture(),[artifact]=await attachRivalPlans([await compileRoute(f.definition,f.graph,{...f.contacts,worldSetRevision:next})]),key=`manifests/${old}.json`,entry={id:artifact.id,routeHash:artifact.routeHash,geometryHash:artifact.geometryHash,worldSetRevision:next},recoveryRoot={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:next,cells:{'0,0':{sourceHash:cellHash,empty:true}},footprints:[{halfWidth:1,halfLength:2}],utf8Probe:'\ufffd'};
  const {validateRecoveryManifest}=await import('../server/route-road-stream.mjs');await validateRecoveryManifest(recoveryRoot,{expectedHash:await sha256(recoveryRoot),worldSetRevision:next,sourceHashes:[['0,0',cellHash]]});
  await symlink(new URL('../src',import.meta.url).pathname,join(root,'src'));await symlink(new URL('.',import.meta.url).pathname,join(root,'tools'));for(const path of ['assets/athens','.deploy/assets/data/routes'])await mkdir(join(root,path),{recursive:true});
  const files={'wrangler.jsonc':{env:{staging:{vars:{ATHENS_WORLD_MANIFEST:key}}}},'assets/athens/streets.json':{manifest:key,revision:next},'.deploy/assets/data/routes/index.json':{routes:[entry],utf8Probe:'\ufffd'},'.deploy/assets/route-config.json':{routes:[entry],utf8Probe:'\ufffd'},'.deploy/catalogue.json':{routes:[entry],routeRoads:[{hash:await sha256(recoveryRoot),body:recoveryRoot}]},[`.deploy/assets/data/routes/${entry.id}.${entry.routeHash}.json`]:{...artifact,utf8Probe:'\ufffd'}};
  for(const [path,body]of Object.entries(files))await writeFile(join(root,path),canonicalJSON(body));assert.deepEqual(await checkBuiltRouteRelease(root),{checked:1,revision:next},'valid literal replacement characters preserve release identity');
  for(const path of Object.keys(files).filter(path=>path.startsWith('.deploy/')).sort((a,b)=>Number(b.endsWith('catalogue.json'))-Number(a.endsWith('catalogue.json')))){const full=join(root,path),raw=await readFile(full),at=raw.indexOf(Buffer.from('\ufffd'));assert.ok(at>0);const bad=Buffer.concat([raw.subarray(0,at),Buffer.from([0x80]),raw.subarray(at+3)]);assert.equal(bad.toString('utf8'),raw.toString('utf8'),'old replacement reader would authenticate the same canonical root');await writeFile(full,bad);await assert.rejects(checkBuiltRouteRelease(root),error=>error.code==='ERR_ENCODING_INVALID_ENCODED_DATA',path);await writeFile(full,raw);}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('prepare-deploy root and regional proof readers are fatal before parse and preserve existing 8MiB limits',async()=>{
 const {readFile,truncate}=await import('node:fs/promises'),{readRouteValidationRoot,writeRouteProofs}=await import('./route-release.mjs'),{readOriginalJSON}=await import('./strict-json-file.mjs'),root=await mkdtemp(join(tmpdir(),'athens-regional-utf8-'));
 try{
  const dir=join(root,'data/routes/validation'),out=join(root,'.deploy');await mkdir(dir,{recursive:true});await mkdir(out);const cell={sha256:cellHash,bytes:10,decodedBytes:20},shard={schemaVersion:1,worldSetRevision:old,cells:{'0,0':cell},sourceHashes:[['0,0',cellHash]],edges:[],turns:[],proofs:{contact:{},width:{},safe:{}},utf8Probe:'\ufffd'},manifest={revision:next,tiles:{'0,0':cell}},raw=Buffer.from(JSON.stringify(shard)),at=raw.indexOf(Buffer.from('\ufffd')),bad=Buffer.concat([raw.subarray(0,at),Buffer.from([0x80]),raw.subarray(at+3)]),path=join(dir,'athens.inputs.json');
  assert.equal(bad.toString('utf8'),raw.toString('utf8'));await writeFile(path,raw);assert.equal((await readRouteValidationRoot(root)).utf8Probe,'\ufffd');await writeFile(join(dir,'good.inputs.json'),raw);await writeFile(join(dir,'bad.inputs.json'),raw);
  let prepared=await writeRouteProofs(root,{...shard,shards:['good.inputs.json','bad.inputs.json']},manifest,out);assert.equal(JSON.parse(await readFile(join(out,'bad.inputs.json'))).utf8Probe,'\ufffd');await prepared.cleanup();
  await writeFile(path,bad);let parses=0;const parse=JSON.parse;JSON.parse=(...args)=>{parses++;return parse(...args);};try{await assert.rejects(readRouteValidationRoot(root),e=>e.code==='ERR_ENCODING_INVALID_ENCODED_DATA');assert.equal(parses,0);}finally{JSON.parse=parse;}
  await writeFile(join(dir,'bad.inputs.json'),bad);await assert.rejects(writeRouteProofs(root,{...shard,shards:['good.inputs.json','bad.inputs.json']},manifest,out),e=>e.code==='ERR_ENCODING_INVALID_ENCODED_DATA');await assert.rejects(readFile(join(out,'good.inputs.json')),/ENOENT/,'partial regional output is cleaned on rejected sibling');
  await writeFile(path,raw);await truncate(path,8*1024*1024+1);await assert.rejects(readRouteValidationRoot(root),/existing byte limit/);await writeFile(join(dir,'bad.inputs.json'),raw);await truncate(join(dir,'bad.inputs.json'),8*1024*1024+1);await assert.rejects(writeRouteProofs(root,{...shard,shards:['bad.inputs.json']},manifest,out),/existing byte limit/);
  for(const maxBytes of [2*1024*1024,8*1024*1024]){let reads=0,closed=0;await assert.rejects(readOriginalJSON('unused',{maxBytes,openFile:async()=>({stat:async()=>({size:maxBytes+1,isFile:()=>true}),read(){reads++;throw Error('must not read');},async close(){closed++;}})}),/existing byte limit/);assert.equal(reads,0);assert.equal(closed,1,'existing caps checked before reads or byte allocation');}
  const deploy=await readFile(new URL('./prepare-deploy.mjs',import.meta.url),'utf8');assert.match(deploy,/const source=await readRouteValidationRoot\(root\)/);assert.doesNotMatch(deploy,/JSON\.parse\(await readFile\(resolve\(root,'data\/routes\/validation\/athens\.inputs\.json'/,'prepare-deploy uses the exercised strict root reader');
 }finally{await rm(root,{recursive:true,force:true});}
});
