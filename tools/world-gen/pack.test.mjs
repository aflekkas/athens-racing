import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TILE_TABLES } from '../../src/world-tile-format.js';
import { encodeTile, packTiles, WORLD_CEILING_BYTES } from './pack.mjs';
import { readFileSync } from 'node:fs';
import { LIMIT } from '../world-r2.mjs';
function fixture(x=0) {
  const tables=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));
  tables.coarseHeights=Array(1089).fill(0);
  tables.finePositions=[0,0,0,512,0,0,0,0,512,512,0,512];
  tables.fineTriangles=[0,2,1,1,2,3];
  return {metadata:{tileVersion:1,world:'fixture',revision:'test',cell:[x,0],origin:[512*x,0,0],
    ids:[''],strings:[''],palette:[[1,1,1]],meshes:[],terrain:{coarseSize:33,spacing:16},budgets:{triangles:0,buildingTriangles:0}},tables};
}
test('AWT spool uses shared codec deterministically and rejects wrapped integers',()=>{
  assert.deepEqual(encodeTile(fixture()).bytes,encodeTile(fixture()).bytes);
  const bad=fixture();bad.tables.nodes=[2**32,0];
  assert.throws(()=>encodeTile(bad),/overflow/);
  const huge=fixture();huge.arrays=[{type:'Float32Array',data:[1e100]}];
  assert.throws(()=>encodeTile(huge),/overflow/);
});
test('Shared tables alias losslessly and every decoded view releases the raw container',()=>{
  const input=fixture();input.tables.contactPositions=[...input.tables.finePositions];
  const {decoded}=encodeTile(input),{tables,views}=decoded.metadata;
  assert.equal(tables.contactPositions,tables.finePositions);
  assert.deepEqual([...decoded.arrays[tables.finePositions]],input.tables.finePositions);
  assert.ok(views.every(v=>v.shuffled===true));
  assert.equal(new Set(decoded.arrays.map(a=>a.buffer)).size,decoded.arrays.length);
});
test('Spool validates every tile and neighbour seam before publishing entries',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awt-packer-test-'));
  try {
    const input=join(root,'input.ndjson'),output=join(root,'out');
    await writeFile(input,[fixture(0),fixture(1)].map(JSON.stringify).join('\n'));
    const entries=await packTiles(input,output);assert.equal(Object.keys(entries).length,2);
    const published=await readFile(join(output,'entries.json'),'utf8');
    assert.equal(JSON.parse(published).identity,'fixture:test');
    const cracked=fixture(1);cracked.tables.finePositions[1]=1;
    await writeFile(input,[fixture(0),cracked].map(JSON.stringify).join('\n'));
    await assert.rejects(packTiles(input,join(root,'cracked')),/Cracked seam/);
    await assert.rejects(readFile(join(root,'cracked','entries.json')),/ENOENT/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('Python terrain layout reconstructs exact contacts through the shared runtime decoder',async()=>{
  const {TerrainPosition}=await import('../../src/terrain-layout.js');
  const {readFile}=await import('node:fs/promises');
  const fixture=JSON.parse(await readFile(new URL('./fixtures/terrain-layout.json',import.meta.url),'utf8'));
  const attribute=new TerrainPosition(new Uint16Array(fixture.quantized),fixture.decode,new Float32Array(fixture.residual));
  for(let i=0;i<attribute.count;i++)assert.deepEqual([attribute.getX(i),attribute.getY(i),attribute.getZ(i)],fixture.positions.slice(i*3,i*3+3));
});

test('Spool refuses physically steep asphalt even when the tile is structurally valid',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awt-physical-test-'));
  try{
    const input=fixture();input.metadata.ids.push('road');
    input.tables.finePositions=[0,0,0,512,512,0,0,0,512,512,512,512];
    input.tables.contactPositions=[...input.tables.finePositions];
    input.tables.contactTriangles=[0,2,1,1,1,1,2,3,1,1];input.tables.contactLayers=[0,0];
    // Encoding proves this failure is physical, not the structural codec gate.
    encodeTile(input);
    const path=join(root,'input.ndjson');await writeFile(path,JSON.stringify(input)+'\n');
    await assert.rejects(packTiles(path,join(root,'out')),/Physical surface acceptance failed/);
    await assert.rejects(readFile(join(root,'out','entries.json')),/ENOENT/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('the packer\'s world ceiling is the owner\'s 2 GiB (2026-10-19), still inside the R2 staging limit, and is the only ceiling the supervisor passes',()=>{
  assert.equal(WORLD_CEILING_BYTES,2*1024**3);assert.ok(WORLD_CEILING_BYTES<LIMIT,'the staging bucket limit (5 GB) is separate and unchanged');
  const supervisor=readFileSync(new URL('./build-coast.mjs',import.meta.url),'utf8');
  assert.match(supervisor,/maxBytes:WORLD_CEILING_BYTES/);assert.doesNotMatch(supervisor,/192\*1024/);
  assert.match(readFileSync(new URL('../../docs/OWNER-DECISIONS.md',import.meta.url),'utf8'),/ceiling raised to 2 GB/);
});
