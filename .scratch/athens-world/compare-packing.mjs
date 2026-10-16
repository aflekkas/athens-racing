import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {decodeGeometryPack} from '/tmp/athens-world-generator/src/baked-geometry.js';
import {encodeTile as before} from '/tmp/athens-world-gates/tools/world-gen/pack.mjs';
import {encodeTile as after,packTiles} from '/tmp/athens-world-generator/tools/world-gen/pack.mjs';
const cache='/tmp/athens-world-cache/',root=cache+'ground-probe/';
const oldEntry=Object.values(JSON.parse(readFileSync(root+'entries.json','utf8')).tiles)[0],original=readFileSync(root+oldEntry.url),raw=gunzipSync(original),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const firstTable=Math.min(...Object.values(pack.metadata.tables));
const input={metadata:pack.metadata,tables:Object.fromEntries(Object.entries(pack.metadata.tables).map(([n,i])=>[n,Array.from(pack.arrays[i])])),arrays:pack.arrays.slice(0,firstTable).map(a=>({type:a.constructor.name,data:Array.from(a)})),dependencies:oldEntry.dependencies};
const base=before(input);assert.deepEqual(base.bytes,original,'baseline must reproduce exact captured wire bytes');
const next=after(input);
function bytes(a){return Buffer.from(a.buffer,a.byteOffset,a.byteLength);}
for(const [name,index]of Object.entries(pack.metadata.tables))assert.deepEqual(bytes(pack.arrays[index]),bytes(next.decoded.arrays[next.decoded.metadata.tables[name]]));
for(let i=0;i<firstTable;i++)assert.deepEqual(bytes(pack.arrays[i]),bytes(next.decoded.arrays[i]));
const cpu={};for(const [name,fn]of [['before',before],['after',after]]){const start=process.cpuUsage();for(let i=0;i<3;i++)fn(input);const used=process.cpuUsage(start);cpu[name]=(used.user+used.system)/3e6;}
const spool=cache+'probe-packing.ndjson';writeFileSync(spool,JSON.stringify(input)+'\n');
const entries=await packTiles(spool,cache+'ground-probe-packed');
const result={baselineCandidate:'b80ff73522c1e149a9ae881413f4d6d6493bc231',afterCandidate:'pending',before:{compressedBytes:base.bytes.length,cpuArrayBackingBytes:base.checked.bytes,cpuSecondsPerEncode:cpu.before},after:{compressedBytes:next.bytes.length,cpuArrayBackingBytes:next.checked.bytes,cpuSecondsPerEncode:cpu.after},allTableAndMeshArrayBytesIdentical:true,baselineWireBytesReproducedExactly:true,triangles:oldEntry.triangles,meshes:pack.metadata.meshes.length,note:'Same real Glyfada input; changes only interning and shared codec byte planes. Browser comparison follows. Not a full-stage hosting estimate.'};
writeFileSync('/tmp/athens-world-generator/.scratch/athens-world/packing-comparison.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
