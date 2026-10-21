// Offline evidence: cell membership and emitted asphalt are separate claims.
// node tools/riviera-world-coverage.mjs [local cells/manifest.json] [report.json] [baseline-manifest.json]
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {decodeTilePack} from '../src/world-tile-codec.js';
import {tileTables} from '../src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
export function projectRoute(data){
 const p=data.proj;
 return data.route.x.map((x,i)=>({s:i*data.route.step,x:(p.lon0+x/p.mlon-23.73)*87745.27512677578,z:(37.98-p.lat0+data.route.z[i]/p.mlat)*111320}));
}
export function coverage(points,cells,contacts=null){
 const perKm=[],gaps=[],missing=new Set();let inside=0,asphalt=0,gap=null;
 for(const p of points){
  const key=`${Math.floor(p.x/512)},${Math.floor(p.z/512)}`,has=cells.has(key),hit=contacts?.get(key)?.(p);
  const km=Math.floor(p.s/1000);perKm[km]??={fromMetres:km*1000,toMetres:Math.min(points.at(-1).s,(km+1)*1000),samples:0,cellSamples:0,...(contacts?{asphaltSamples:0}:{})};
  const row=perKm[km];row.samples++;if(has){inside++;row.cellSamples++;}else missing.add(key);
  if(hit){asphalt++;row.asphaltSamples++;}
  if(!(contacts?hit:has)){if(!gap)gap={fromMetres:p.s,toMetres:p.s,cells:new Set()};gap.toMetres=p.s;gap.cells.add(key);}
  else if(gap){gaps.push({...gap,cells:[...gap.cells]});gap=null;}
 }
 if(gap)gaps.push({...gap,cells:[...gap.cells]});
 for(const row of perKm){row.cellPercent=100*row.cellSamples/row.samples;if(contacts)row.asphaltPercent=100*row.asphaltSamples/row.samples;}
 return {samples:points.length,cellSamples:inside,cellPercent:100*inside/points.length,...(contacts?{asphaltSamples:asphalt,asphaltPercent:100*asphalt/points.length}:{}),missingCells:[...missing].sort(),perKm,gaps};
}
if(process.argv[1]===import.meta.filename){
 const data=JSON.parse(await readFile(new URL('../data/map.json',import.meta.url))),points=projectRoute(data),streets=JSON.parse(await readFile(process.argv[4]||new URL('../assets/athens/streets.json',import.meta.url)));
 const baseline=new Set(streets.tiles?Object.entries(streets.tiles).filter(([,e])=>e.contactEligible!==false).map(([key])=>key):streets.cells.map(c=>Array.isArray(c)?c.join(','):c));
 const report={referenceLengthMetres:points.at(-1).s,raceStartMetres:data.route.start,raceFinishMetres:data.route.finish,spacingMetres:data.route.step,baseline:{world:streets.world,revision:streets.revision,reference:coverage(points,baseline),race:coverage(points.filter(p=>p.s>=data.route.start&&p.s<=data.route.finish),baseline)},notes:['Cell coverage alone does not certify road contacts, direction, legal turns or race equivalence.','Raw legacy polyline crosses the Loumbarda rock pier; native gameplay uses src/maps/riviera-tunnels.js carriageway corridors. Asphalt gaps here are reported, never filled by a pasted road.']};
 if(process.argv[2]){
  const path=resolve(process.argv[2]),m=JSON.parse(await readFile(path)),cells=new Set(Object.entries(m.tiles).filter(([,e])=>e.contactEligible!==false).map(([key])=>key)),contacts=new Map(),routeCells=[];
  for(const key of new Set(points.map(p=>`${Math.floor(p.x/512)},${Math.floor(p.z/512)}`))){
   if(!m.tiles[key])continue;const bytes=gunzipSync(await readFile(resolve(dirname(path),m.tiles[key].url))),pack=await decodeTilePack(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),m.tiles[key].decodedBytes),t=tileTables(pack),index=buildTileContactIndex(t),[cx,cz]=key.split(',').map(Number);
   const asphaltTriangles=Array.from(t.fineFlags||[]).filter(flags=>flags&1).length+Array.from(t.contactTriangles||[]).filter((flags,i)=>i%5===4&&(flags&1)).length;
   routeCells.push({cell:key,contactEligible:m.tiles[key].contactEligible!==false,asphaltTriangles});if(!asphaltTriangles)cells.delete(key);
   contacts.set(key,p=>sampleTileContact(t,index,p.x-cx*512,p.z-cz*512,{requiredFlags:1}));
  }
  const race=points.filter(p=>p.s>=data.route.start&&p.s<=data.route.finish);
  report.candidate={world:m.world,revision:m.revision,routeCells,reference:{...coverage(points,cells,contacts),cellGaps:coverage(points,cells).gaps},race:{...coverage(race,cells,contacts),cellGaps:coverage(race,cells).gaps}};
 }
 const json=JSON.stringify(report,null,2)+'\n';if(process.argv[3])await writeFile(process.argv[3],json);else process.stdout.write(json);
}
