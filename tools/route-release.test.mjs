import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rebindRouteShard, checkBuiltRouteRelease} from './route-release.mjs';
import {fixture} from './fixtures/routes/fixture.mjs';
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
    const key=`manifests/${old}.json`, entry={id:'syntagma-pilot',routeHash:cellHash,geometryHash:old,worldSetRevision:next};
    for(const path of ['assets/athens','.deploy/assets/data/routes','.deploy/assets'])await mkdir(join(root,path),{recursive:true});
    const put=(path,value)=>writeFile(join(root,path),JSON.stringify(value));
    await put('wrangler.jsonc',{env:{staging:{vars:{ATHENS_WORLD_MANIFEST:key}}}});
    await put('assets/athens/streets.json',{manifest:key,revision:next});
    await put('.deploy/assets/data/routes/index.json',{routes:[entry]});
    await put('.deploy/assets/route-config.json',{routes:[entry]});
    await put('.deploy/catalogue.json',{routes:[entry]});
    await put(`.deploy/assets/data/routes/${entry.id}.${entry.routeHash}.json`,entry);
    assert.deepEqual(await checkBuiltRouteRelease(root),{checked:1,revision:next});
    await put(`.deploy/assets/data/routes/${entry.id}.${entry.routeHash}.json`,{...entry,worldSetRevision:old});
    await assert.rejects(checkBuiltRouteRelease(root),/artifact\/world release mismatch/);
    await put('wrangler.jsonc',{env:{staging:{vars:{ATHENS_WORLD_MANIFEST:`manifests/${next}.json`}}}});
    await assert.rejects(checkBuiltRouteRelease(root),/Picker streets and deployed world manifest differ/);
  } finally {await rm(root,{recursive:true,force:true});}
});
