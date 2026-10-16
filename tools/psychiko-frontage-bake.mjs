// Local review buffers: lossless standard packs, without deployment codec heuristics.
import {worldFixture} from './world-test-fixture.mjs';
import {packGroup} from '../src/baked-world-pack.js';
import {gzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
const out=new URL('../.scratch/psychiko-followups/bake/',import.meta.url);await mkdir(out,{recursive:true});
const w=await worldFixture('psychiko'),metadata={map:'psychiko',grid:w.map.terrain.GX*w.map.terrain.GZ};
for(const [kind,pack] of [['terrain',packGroup(w.terrainGroup,{...metadata,height:0,source:1},[w.map.terrain.Hc,w.network.source])],['roads',packGroup(w.roadsGroup,{...metadata,stats:w.network.stats})]]){
 const bytes=gzipSync(new Uint8Array(pack));await writeFile(new URL(kind+'.bin.gz',out),bytes);console.log(kind,bytes.length);
}
