// Audit decoded placement rows against emitted fine terrain, never DEM/coarse fallback.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {tileTables} from '../src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
export async function auditPenteliScenery(out){
 const dir=resolve(out,'data/tiles/penteli'),manifest=JSON.parse(await readFile(resolve(dir,'world.json'))),equivalence=JSON.parse(await readFile(resolve(out,'penteli-equivalence.json')));
 const report={revision:manifest.revision,plants:0,missingGround:0,maxRootDepth:0,architecture:0,missingFoundations:0,worst2x2Bytes:equivalence.budgets.worst2x2Bytes,headroomBytes:64*1024**2-equivalence.budgets.worst2x2Bytes};
 for(const entry of Object.values(manifest.tiles)){
  const raw=gunzipSync(await readFile(resolve(dir,entry.url))),packet=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),tables={...tileTables(packet),coarseHeights:new Float32Array(1089).fill(NaN)},index=buildTileContactIndex(tables),detail=packet.metadata.extensions.worldDetail;
  const ground=(x,z,y)=>sampleTileContact(tables,index,x,z,{requiredFlags:2,referenceY:y});
  const trees=packet.arrays[detail.streetTrees];for(let i=0;i<trees.length;i+=5){report.plants++;const g=ground(trees[i],trees[i+2],trees[i+1]);if(!g||!Number.isFinite(g.y))report.missingGround++;else report.maxRootDepth=Math.max(report.maxRootDepth,Math.abs(g.y-trees[i+1]));}
  const houses=packet.arrays[detail.penteliHouses];for(let i=0;i<houses.length;i+=7){report.architecture++;const c=Math.cos(houses[i+3]),s=Math.sin(houses[i+3]);for(const[a,b]of[[-1,-1],[1,-1],[1,1],[-1,1]]){const u=a*houses[i+4]/2,v=b*houses[i+6]/2,g=ground(houses[i]+u*c+v*s,houses[i+2]-u*s+v*c,houses[i+1]);if(!g||!Number.isFinite(g.y)||g.y<houses[i+1]-.01)report.missingFoundations++;}}
 }
 report.passed=report.plants>0&&!report.missingGround&&!report.missingFoundations&&report.maxRootDepth<=.121&&report.headroomBytes>=4*1024**2;
 await writeFile(resolve(out,'penteli-scenery-audit.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]===import.meta.filename){const report=await auditPenteliScenery(process.argv[2]);console.log(report);if(!report.passed)process.exitCode=1;}
