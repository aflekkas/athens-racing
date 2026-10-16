import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encodeGeometryPack, decodeGeometryPack } from '../src/baked-geometry.js';
import { TILE_TABLES, residentArrayBytes } from '../src/world-tile-format.js';
import { packWorldTiles, readTileBytes } from './pack-world-tiles.mjs';
import { validateDirectory } from './validate-world-tiles.mjs';
import { fetchTilePacket } from '../src/world-tile-worker.js';

test('regional bundles preserve tile hashes, obey byte limits and validate via bounded range reads', async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'awt-storage-'));
  try{
    const source=resolve(dir,'source'),packed=resolve(dir,'packed'),repacked=resolve(dir,'repacked');await mkdir(source);
    const manifest={tileVersion:1,world:'test',revision:'v1',tileMetres:512,projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'a'},tiles:{}};
    const bodies=[];
    for(let x=0;x<4;x++){
      const arrays=[],tables={};for(const [name,[type]] of Object.entries(TILE_TABLES)){tables[name]=arrays.length;arrays.push(new globalThis[type](name==='coarseHeights'?1089:0));}
      const metadata={tileVersion:1,world:'test',revision:'v1',cell:[x,0],origin:[x*512,0,0],tables,ids:[''],strings:[''],meshes:[],palette:[[1,1,1]],terrain:{coarseSize:33,spacing:16},budgets:{triangles:0,buildingTriangles:0}};
      const body=gzipSync(new Uint8Array(encodeGeometryPack(metadata,arrays)));bodies.push(body);
      const name=`${x}.bin.gz`;await writeFile(resolve(source,name),body);manifest.tiles[`${x},0`]={url:`./${name}`,sha256:createHash('sha256').update(body).digest('hex'),bytes:body.length,decodedBytes:100000,dependencies:[],triangles:0};
    }
    const path=resolve(source,'world.json');await writeFile(path,JSON.stringify(manifest));
    const limit=Math.max(...bodies.map(b=>b.length))*2;
    const result=await packWorldTiles(path,packed,{bundleBytes:limit});assert.equal(result.tiles,4);assert(result.largest<=limit);assert(result.files<=4);
    const mp=resolve(packed,'world.json'),m=JSON.parse(await readFile(mp,'utf8'));
    for(let x=0;x<4;x++)assert.deepEqual(await readTileBytes(mp,m.tiles[`${x},0`]),bodies[x]);
    assert.equal((await validateDirectory(mp)).tiles,4);
    const originalFetch=globalThis.fetch;
    try {
      globalThis.fetch=async(url,options)=>{
        const entry=m.tiles['1,0'];assert.equal(options.headers.Range,`bytes=${entry.range.offset}-${entry.range.offset+entry.bytes-1}`);
        const source=await readFile(new URL(url));return new Response(source.subarray(entry.range.offset,entry.range.offset+entry.bytes),{status:206,headers:{'Content-Range':`bytes ${entry.range.offset}-${entry.range.offset+entry.bytes-1}/${source.length}`}});
      };
      const entry=m.tiles['1,0'],packet=await fetchTilePacket({url:new URL(entry.url,pathToFileURL(mp)).href,entry,world:m.world,revision:m.revision,cell:[1,0]});assert(packet.bytes<entry.decodedBytes);assert.equal(packet.metadata.cell[0],1);
    }finally{globalThis.fetch=originalFetch;}

    assert.equal((await readdir(packed)).filter(p=>p.endsWith('.gz')).length,0,'do not deploy duplicate individual tiles');
    await packWorldTiles(mp,repacked,{bundleBytes:limit});assert.deepEqual(await readFile(resolve(repacked,'world.json')),await readFile(mp),'packing already ranged sources is deterministic');
    await assert.rejects(packWorldTiles(path,packed,{bundleBytes:10}),/exceeds/);
    await assert.rejects(packWorldTiles(path,source),/separate/);
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('shared codec byte-plane hints do not retain a second raw container through Uint8 views',()=>{
  const arrays=[new Float32Array(4096),new Uint8Array(4096)];
  const raw=encodeGeometryPack({},arrays,arrays.map(()=>true)),decoded=decodeGeometryPack(raw);
  assert.equal(residentArrayBytes(decoded.arrays),arrays.reduce((n,a)=>n+a.byteLength,0));
  assert(decoded.arrays.every(a=>a.buffer!==raw),'all-plane packs release the decompression container after decode');
});
