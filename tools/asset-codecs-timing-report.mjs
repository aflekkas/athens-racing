// Summarize interleaved cold-context runs; retain every sample and its order.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir=resolve(process.argv[2]||'.scratch/perf-2026-10-15/textures-data/penteli-five-pairs');
const data=JSON.parse(await readFile(resolve(dir,'browser.json'),'utf8'));
assert.deepEqual(data.errors,[]);assert.equal(data.runs.length,10);
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],mad=values=>median(values.map(v=>Math.abs(v-median(values))));
const bytes=r=>r.metrics.requests.reduce((n,x)=>n+x.bodyBytes,0);
const before=data.runs.filter(r=>r.side==='before'),after=data.runs.filter(r=>r.side==='after');assert.equal(before.length,5);assert.equal(after.length,5);
const pairs=before.map(b=>{const a=after.find(r=>r.round===b.round);assert.ok(a);assert.equal(a.metrics.geometryBytes,b.metrics.geometryBytes);assert.equal(a.metrics.assets.maps.penteli.codec,'meshopt');assert.equal(a.metrics.assets.maps.penteli.error,undefined);assert.ok(bytes(a)<=bytes(b),'Codec must not increase total startup bytes');return {round:b.round,beforeMs:b.loadToRaceMs,afterMs:a.loadToRaceMs,deltaMs:a.loadToRaceMs-b.loadToRaceMs,beforeBytes:bytes(b),afterBytes:bytes(a),textureWaitMs:a.metrics.assets.textureWaitMs,textureReadyMs:a.metrics.assets.textureLibraryReadyMs,compileSceneMs:a.metrics.assets.compileSceneMs,inflateFetchWallMs:a.metrics.assets.maps.penteli.inflateFetchWallMs,bufferDecodeWallMs:a.metrics.assets.maps.penteli.bufferDecodeWallMs};});
const summary={baselineSha:data.baselineSha,implementationSha:data.implementationSha,order:data.runs.map(r=>({round:r.round,side:r.side})),beforeMedianMs:median(before.map(r=>r.loadToRaceMs)),afterMedianMs:median(after.map(r=>r.loadToRaceMs)),beforeMadMs:mad(before.map(r=>r.loadToRaceMs)),afterMadMs:mad(after.map(r=>r.loadToRaceMs)),pairedDeltaMedianMs:median(pairs.map(r=>r.deltaMs)),beforeMedianHeap:median(before.map(r=>r.peakHeapBytes)),afterMedianHeap:median(after.map(r=>r.peakHeapBytes)),pairs};summary.medianChangePercent=(summary.afterMedianMs/summary.beforeMedianMs-1)*100;
await writeFile(resolve(dir,'summary.json'),JSON.stringify(summary,null,2));console.log(summary);
