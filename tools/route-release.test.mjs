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
