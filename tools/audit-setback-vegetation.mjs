// Compare real authenticated cached cells through both exact worker builds.
// Usage: node tools/audit-setback-vegetation.mjs BASELINE_ROOT WORLD_JSON CELLS_DIR OUT_JSON
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {prepareTilePacket} from '../src/world-tile-worker.js';
import {tileTables} from '../src/world-tile-format.js';
import {assertVegetationClearance} from './audit-world-vegetation.mjs';
const [baselineRoot,worldFile,cellsDir,outFile]=process.argv.slice(2);
if(!outFile)throw Error('Usage: BASELINE_ROOT WORLD_JSON CELLS_DIR OUT_JSON');
const {prepareTilePacket:prepareBefore}=await import(pathToFileURL(resolve(baselineRoot,'src/world-tile-worker.js')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value??null));
const decode=body=>{const b=gunzipSync(body);return decodeGeometryPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const parking=p=>{const i=p.metadata.extensions?.worldDetail?.parking;return i==null?new Uint8Array():new Uint8Array(p.arrays[i].buffer,p.arrays[i].byteOffset,p.arrays[i].byteLength);};
const trees=p=>{const i=p.metadata.extensions?.worldDetail?.streetTrees;return i==null?0:p.arrays[i].length/5;};
const world=JSON.parse(await readFile(worldFile)),rows=[];
for(const [cell,entry]of Object.entries(world.tiles)){
 let body;try{body=await readFile(resolve(cellsDir,entry.sha256+'.bin.gz'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
 if(body.byteLength!==entry.bytes||hash(body)!==entry.sha256)throw Error('Source authentication failed: '+cell);
 const build=prepare=>{const p=decode(body);return prepare(p,{world:p.metadata.world,revision:p.metadata.revision,cell:p.metadata.cell,entry:{...entry,decodedBytes:Number.MAX_SAFE_INTEGER}});};
 const before=build(prepareBefore),after=build(prepareTilePacket),checks={
  parking:[hash(parking(before)),hash(parking(after))],
  obstacles:[jsonHash(before.obstacleIndex),jsonHash(after.obstacleIndex)],
  detailObstacles:[jsonHash(before.detailObstacleIndex),jsonHash(after.detailObstacleIndex)],
  physical:[jsonHash(tileTables(before)),jsonHash(tileTables(after))],
 };
 for(const [kind,[a,b]]of Object.entries(checks))if(a!==b)throw Error(kind+' changed: '+cell);
 const clearance=assertVegetationClearance(after,tileTables(after));
 const reservation=entry.residentBytes??entry.decodedBytes;if(after.bytes>reservation)throw Error('Cell reservation exceeded: '+cell);
 rows.push({cell,sourceSha256:entry.sha256,beforeTrees:trees(before),afterTrees:trees(after),beforeBytes:before.bytes,afterBytes:after.bytes,reservation,clearance,checks});
}
if(!rows.length)throw Error('No cached cells audited');
const report={passed:true,sourceRevision:world.revision,cells:rows.length,beforeTrees:rows.reduce((n,r)=>n+r.beforeTrees,0),afterTrees:rows.reduce((n,r)=>n+r.afterTrees,0),maxCellTrees:Math.max(...rows.map(r=>r.afterTrees)),maxAddedBytes:Math.max(...rows.map(r=>r.afterBytes-r.beforeBytes)),rows};
await writeFile(outFile,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
