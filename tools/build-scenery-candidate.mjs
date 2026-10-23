// Local unpublished scenery reducer; ordinary packTiles owns every new descriptor.
// Usage: node tools/build-scenery-candidate.mjs SCENERY_JSON WORLD_JSON CELLS_DIR OUTPUT_DIR
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {packTiles} from './world-gen/pack.mjs';
import {tileTables} from '../src/world-tile-format.js';
import {prepareTilePacket} from '../src/world-tile-worker.js';
import {parsePlazas,plazaDistance} from '../src/athens-plazas.js';
import {forecourtPlazas,insideLandmark} from '../src/athens-landmarks.js';
import {applySceneryVegetation} from './scenery-cell.mjs';
import {assertVegetationClearance} from './audit-world-vegetation.mjs';
const [sceneryFile,worldFile,cellsDir,outDir]=process.argv.slice(2);
if(!outDir)throw Error('Usage: SCENERY_JSON WORLD_JSON CELLS_DIR OUTPUT_DIR');
const hash=a=>createHash('sha256').update(a).digest('hex'),jsonHash=a=>hash(JSON.stringify(a??null));
const source=JSON.parse(await readFile(sceneryFile)),world=JSON.parse(await readFile(worldFile));
const plazas=[...parsePlazas(JSON.parse(await readFile(new URL('../assets/athens/plazas.json',import.meta.url)))),...forecourtPlazas()];
const blocked=(x,z,r)=>plazas.some(q=>x>=q.x0-r&&x<=q.x1+r&&z>=q.z0-r&&z<=q.z1+r&&plazaDistance(q.p,x,z)<=r)||[-r,0,r].some(dx=>[-r,0,r].some(dz=>insideLandmark(x+dx,z+dz)));
await mkdir(outDir);await mkdir(resolve(outDir,'cells'));
const decode=body=>{const b=gunzipSync(body);return decodeGeometryPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const physical=p=>({tables:jsonHash(tileTables(p)),obstacles:jsonHash(p.obstacleIndex),detailObstacles:jsonHash(p.detailObstacleIndex),parking:jsonHash(p.arrays[p.metadata.extensions?.worldDetail?.parking])});
const rows=[],changed=new Map();
async function* inputs(){
 for(const [key,e]of Object.entries(world.tiles)){
  let body;try{body=await readFile(resolve(cellsDir,e.sha256+'.bin.gz'));}catch(err){if(err.code==='ENOENT')continue;throw err;}
  if(body.length!==e.bytes||hash(body)!==e.sha256)throw Error('Source cell integrity '+key);
  const raw=decode(body),before=prepareTilePacket(decode(body),{world:raw.metadata.world,revision:raw.metadata.revision,cell:raw.metadata.cell,entry:e}),detail=before.metadata.extensions?.worldDetail,occupied=[];
  for(const [index,stride,pad]of [[detail?.parking,5,3],[detail?.props?.rows,5,2],[detail?.signals?.rows,6,2]])if(index!=null){const a=before.arrays[index];for(let i=0;i<a.length;i+=stride)occupied.push([a[i],a[i+2],pad]);}
  const change=applySceneryVegetation(raw,source,{blocked,occupied}),signature=physical(before);
  const row={cell:key,...change,beforeBytes:before.bytes,afterBytes:before.bytes,reservation:e.residentBytes??e.decodedBytes,sourceSha256:e.sha256,clearance:assertVegetationClearance(before,tileTables(before)),checks:{before:signature,after:signature}};rows.push(row);
  if(change.added){
   changed.set(key,{row,entry:e});const {views,shuffled,tables,...metadata}=raw.metadata;
   yield JSON.stringify({metadata,arrays:raw.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(raw)).map(([k,a])=>[k,Array.from(a)])),dependencies:e.dependencies})+'\n';
  }
 }
}
await packTiles(Readable.from(inputs()),resolve(outDir,'cells'),{onTile:async({key,entry,packet})=>{
 const {row,entry:old}=changed.get(key);row.checks.after=physical(packet);
 if(jsonHash(row.checks.before)!==jsonHash(row.checks.after))throw Error('Physics/parking changed '+key);
 row.clearance=assertVegetationClearance(packet,tileTables(packet));row.afterBytes=packet.bytes;
 if(packet.bytes>row.reservation)throw Error('Original resident reservation exceeded '+key);
 row.candidateSha256=entry.sha256;row.accounting={before:{wire:old.bytes,decoded:old.decodedBytes,transient:old.transientBytes,resident:old.residentBytes},after:{wire:entry.bytes,decoded:entry.decodedBytes,transient:entry.transientBytes,resident:entry.residentBytes}};
 row.accounting.delta=Object.fromEntries(Object.keys(row.accounting.after).map(k=>[k,row.accounting.after[k]-row.accounting.before[k]]));
 await symlink(basename(entry.url),resolve(outDir,'cells',entry.sha256+'.bin.gz'));
 world.tiles[key]={...old,...entry,url:'/world/cells/'+entry.sha256+'.bin.gz'};
}});
const cap=64*1024*1024;let worst2x2={bytes:0,cells:[]};
for(const key of Object.keys(world.tiles)){const [x,z]=key.split(',').map(Number),cells=[[x,z],[x+1,z],[x,z+1],[x+1,z+1]].map(p=>p.join(',')),bytes=cells.reduce((n,k)=>n+(world.tiles[k]?.residentBytes??world.tiles[k]?.decodedBytes??0),0);if(bytes>worst2x2.bytes)worst2x2={bytes,cells};}
const transients=Object.values(world.tiles).map(e=>e.transientBytes??2*e.decodedBytes+e.bytes).sort((a,b)=>b-a);let largestAdmittedPair=0;
for(let i=0;i<transients.length;i++)for(let j=i+1;j<transients.length;j++){const sum=transients[i]+transients[j];if(sum<=cap&&sum>largestAdmittedPair)largestAdmittedPair=sum;}
if(worst2x2.bytes>cap||transients[0]>cap)throw Error('Combined 64MiB budget exceeded '+JSON.stringify({worst2x2,largestTransient:transients[0]}));
const report={passed:true,scenerySha256:hash(await readFile(sceneryFile)),sourceRevision:world.revision,cells:rows.length,changedCells:changed.size,added:rows.reduce((n,r)=>n+r.added,0),maxAdditionalResidentBytes:Math.max(...rows.map(r=>r.afterBytes-r.beforeBytes)),published:false,budgets:{cap,worst2x2,largestTransient:transients[0],unconstrainedLargestPair:transients[0]+transients[1],largestAdmittedPair,admission:'Existing WorldTileStream rejects any pair exceeding its unchanged64MiB transient cap.'},rows};
await writeFile(resolve(outDir,'world.json'),JSON.stringify(world));await writeFile(resolve(outDir,'audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
