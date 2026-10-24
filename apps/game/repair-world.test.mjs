import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../../tools/fixtures/routes/fixture.mjs';
import { compileRoute, routeGeometryHash } from '../../src/route-compile.js';
import { sha256 } from '../../src/route-definition.js';
import { rebindCompiledWorld, routeGraphDigest, routeReferencedEdges, repairedCellDescriptor } from './repair-world.mjs';

async function compiled() { const input = fixture(); return { ...input, compiled: await compileRoute(input.definition, input.graph, input.contacts) }; }

test('derived route graph digest reproduces the compiler exact referenced edges and contact source recipe', async () => {
  const f = await compiled(), manifest = { tiles: Object.fromEntries(f.compiled.cells.map(key => [key, { sha256: 'b'.repeat(64) }])) };
  assert.equal(await routeGraphDigest(f.compiled, f.graph, manifest), f.compiled.graphDigest);
  assert.deepEqual([...routeReferencedEdges(f.compiled, f.graph).keys()].sort(), ['a', 'b', 'c']);
  manifest.tiles[f.compiled.cells[0]].sha256 = 'c'.repeat(64);
  assert.notEqual(await routeGraphDigest(f.compiled, f.graph, manifest), f.compiled.graphDigest);
});

test('world rebinding changes only world/graph/route identities and keeps every geometry number exact', async () => {
  const f = await compiled(), before = structuredClone(f.compiled), next = await rebindCompiledWorld(f.compiled, 'c'.repeat(64), 'd'.repeat(64));
  assert.equal(next.worldSetRevision, 'c'.repeat(64)); assert.equal(next.graphDigest, 'd'.repeat(64));
  assert.notEqual(next.routeHash, before.routeHash); assert.equal(await routeGeometryHash(next), before.geometryHash);
  for (const key of ['points', 'grid', 'startPose', 'finishPose', 'runIn', 'runOut', 'occurrences', 'decisions', 'towAnchors']) assert.deepEqual(next[key], before[key]);
  assert.deepEqual(f.compiled, before, 'original compiled artifact remains untouched');
});

test('rival plans preserve exact sample bytes and get a new authenticated world identity', async () => {
  const f = await compiled(), plan = { version: 1, geometryHash: f.compiled.geometryHash, worldSetRevision: f.compiled.worldSetRevision, sampleBytes: 'exact-base64-float64-data', sourceHash: 'e'.repeat(64) };
  f.compiled.rivalPlan = { ...plan, hash: await sha256(plan) };
  const next = await rebindCompiledWorld(f.compiled, 'c'.repeat(64), f.compiled.graphDigest);
  assert.equal(next.rivalPlan.sampleBytes, f.compiled.rivalPlan.sampleBytes);
  assert.equal(next.rivalPlan.sourceHash, f.compiled.rivalPlan.sourceHash);
  const { hash, ...body } = next.rivalPlan; assert.equal(hash, await sha256(body));
  assert.equal(next.routeHash, await sha256({ definition: next.definition, geometryHash: next.geometryHash, worldSetRevision: next.worldSetRevision, rivalPlanHash: hash }));
});

test('tampered original route geometry and rival plan hashes fail before rebinding', async () => {
  const f = await compiled(); f.compiled.points[0][0] += 1;
  await assert.rejects(rebindCompiledWorld(f.compiled, 'c'.repeat(64), 'd'.repeat(64)), /Original route geometry/);
  const g = await compiled(); g.compiled.rivalPlan = { hash: 'e'.repeat(64), changed: true };
  await assert.rejects(rebindCompiledWorld(g.compiled, 'c'.repeat(64), 'd'.repeat(64)), /Original rival plan/);
});

test('repair preserves the original effective resident limit while raw inflation and packet identity stay independent',()=>{
 const entry={sha256:'a'.repeat(64),url:'/world/cells/original.bin.gz',bytes:150,decodedBytes:20000,triangles:42,transientBytes:41000,dependencies:[]},result={changed:true,hash:'b'.repeat(64),body:Buffer.alloc(140),rawBytes:10000},identity={regionId:'megara',world:'megara',originalRevision:'original',packetRevision:'stable-packet'};
 const next=repairedCellDescriptor(entry,result,identity);
 assert.equal(next.decodedBytes,10000);assert.equal(next.residentBytes,20000);assert.equal(next.source.revision,'stable-packet');assert.equal(next.sha256,result.hash);assert.equal(next.triangles,entry.triangles);assert.equal(next.transientBytes,41000);assert.equal(entry.residentBytes,undefined);
 assert.equal(repairedCellDescriptor({...entry,residentBytes:25000},result,identity).residentBytes,25000);
 assert.deepEqual(repairedCellDescriptor(entry,{changed:false},identity),{...entry,source:{regionId:'megara',world:'megara',revision:'original'}});
 assert.throws(()=>repairedCellDescriptor({...entry,decodedBytes:undefined},result,identity),/resident budget/);
});

test('all actual repaired Megara packets fit unchanged source resident limits with identical GPU and triangle counts',async t=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib');let original,derived;
 try{original=JSON.parse(await readFile(new URL('../../.desktop/world-release/world-flat.json',import.meta.url)));derived=JSON.parse(await readFile(new URL('../../.desktop/world-release-repaired/world-flat.json',import.meta.url)));}catch(error){if(error.code==='ENOENT')return t.skip('optional full-world fixture absent');throw error;}
 const {decodeTilePack}=await import('../../src/world-tile-codec.js'),{prepareTilePacket}=await import('../../src/world-tile-worker.js');const receipt=[];
 for(const key of ['-64,-2','-63,-2','-64,-1','-63,-1','-65,-1']){
  const source=original.tiles[key],entry=derived.tiles[key],raw=gunzipSync(await readFile(new URL('../../.desktop/world-release-repaired'+entry.url,import.meta.url)));
  const result={changed:true,hash:entry.sha256,body:Buffer.alloc(entry.bytes),rawBytes:raw.length},fixed=repairedCellDescriptor(source,result,{regionId:'megara',world:'megara',originalRevision:source.source.revision,packetRevision:entry.source.revision});
  const packet=prepareTilePacket(await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),fixed.decodedBytes),{entry:fixed,...fixed.source,cell:key.split(',').map(Number)});
  assert.ok(packet.bytes<fixed.residentBytes);assert.equal(fixed.residentBytes,source.residentBytes??source.decodedBytes);assert.equal(fixed.sha256,entry.sha256);assert.equal(entry.triangles,source.triangles);
  const sourceRaw=gunzipSync(await readFile(new URL('../../.desktop/world-release'+source.url,import.meta.url))),sourcePacket=prepareTilePacket(await decodeTilePack(sourceRaw.buffer.slice(sourceRaw.byteOffset,sourceRaw.byteOffset+sourceRaw.byteLength),source.decodedBytes),{entry:source,...source.source,cell:key.split(',').map(Number)});
  assert.equal(packet.gpuBytes,sourcePacket.gpuBytes);receipt.push({key,residentBudget:fixed.residentBytes,actualResident:packet.bytes,gpuBytes:packet.gpuBytes,triangles:entry.triangles});
 }
 t.diagnostic(JSON.stringify(receipt));
});
