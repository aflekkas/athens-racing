// Supervisor for an approved area (areas/*.json): bakes its cells as one world and gates every cell and border.
// Outputs stay outside Git until hosting is approved. No regional DB is copied.
//   node build-coast.mjs CACHE OUTPUT [AREA=coast]   (ATHENS_WORKERS=n generator processes; ATHENS_CELLS='x,z;x,z' dev subset)
import {spawn} from 'node:child_process';
import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {packTiles,WORLD_CEILING_BYTES} from './pack.mjs';
import {WorldRoadGraph} from '../../src/world-tile-graph.js';
import {validateWorldManifest,tileTables} from '../../src/world-tile-format.js';
import {tileRenderVariants} from '../../src/world-tile-gpu.js';
const cache=resolve(process.argv[2]),output=resolve(process.argv[3]),areaName=process.argv[4]||'coast',subset=process.env.ATHENS_CELLS?new Set(process.env.ATHENS_CELLS.split(';')):null;await mkdir(output,{recursive:true});
const graph=new WorldRoadGraph(),variants=new Map(),audits=[],seams={},anchorCandidates=[];
const {execFileSync:run}=await import('node:child_process');
const python=join(cache,'venv/bin/python'),area=JSON.parse(run(python,[new URL('./areas.py',import.meta.url).pathname,areaName],{encoding:'utf8',cwd:new URL('.',import.meta.url).pathname}));
const generator=spawn(python,[new URL('./build-coast.py',import.meta.url).pathname,'--cache',cache,'--area',areaName],{stdio:['ignore','pipe','pipe']});
// Generator audit lines (one JSON object per cell) are kept for the bake report; everything else is forwarded.
const pythonAudits=[];let pending='';generator.stderr.on('data',chunk=>{process.stderr.write(chunk);pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines)if(line.startsWith('{"area"'))try{pythonAudits.push(JSON.parse(line));}catch{}});
// The packer reads a stream path; a FIFO is unnecessary with /proc's descriptor.
// Feed the generator into a named FIFO only inside the task output, and remove it
// in finally. This avoids retaining the hundreds of MiB of textual intermediates.
const fifo=join(output,'input.fifo');
const {execFileSync}=await import('node:child_process');const {rm}=await import('node:fs/promises');const {createWriteStream}=await import('node:fs');
execFileSync('mkfifo',[fifo]);const writer=createWriteStream(fifo);writer.on('error',()=>{if(generator.exitCode===null)generator.kill('SIGTERM');});generator.stdout.pipe(writer);
let entries;
try{
 entries=await packTiles(fifo,join(output,'cells'),{maxBytes:WORLD_CEILING_BYTES,onTile:async({key,entry,physical,bridges,roads,decoded,packet,seams:edgeHashes})=>{
  if(!roads)throw Error('Coastal cell '+key+' has no road cross-sections');
  const m=decoded.metadata,t=tileTables(decoded),playable=true;
  // Every cell of the area is a contact cell, and buildings are clipped to cells: no ownership dependencies.
  entry.contactEligible=playable;entry.dependencies=[];
  if(playable)graph.install(key,decoded);
  for(const v of tileRenderVariants(decoded))variants.set(v.key,v);
  if(key===area.spawn.cell.join(','))for(let i=0;i<t.anchors.length;i+=5)anchorCandidates.push(m.ids[t.anchors[i]]);
  const row={cell:m.cell,bytes:entry.bytes,residentBytes:entry.residentBytes,transientBytes:entry.transientBytes,jsBytes:packet.jsBytes,gpuBytes:packet.gpuBytes,physical,bridges,roads:{roads:roads.roads,sidewalkRoads:roads.sidewalkRoads,byClass:roads.byClass},edges:t.edges.length/10,anchors:t.anchors.length/5};audits.push(row);seams[key]=edgeHashes;
  await appendFile(join(output,'audit.ndjson'),JSON.stringify(row)+'\n');console.error(JSON.stringify({packed:key,bytes:entry.bytes,residentBytes:entry.residentBytes,triangles:entry.triangles}));
 }});
 if(generator.exitCode===null)await new Promise((res,rej)=>{generator.once('exit',code=>code?rej(Error('Generator failed '+code)):res());});else if(generator.exitCode)throw Error('Generator failed '+generator.exitCode);
 if(!subset&&Object.keys(entries).length!==area.cells.length)throw Error('Incomplete approved extent: '+Object.keys(entries).length+' of '+area.cells.length+' cells');
 const requested=area.spawn.anchor,anchor=anchorCandidates.includes(requested)?requested:anchorCandidates[0];if(!anchor)throw Error('No validated Glyfada spawn');
 const identity=JSON.parse(await readFile(join(output,'cells/entries.json'),'utf8')).identity;
 const manifest=validateWorldManifest({tileVersion:1,tileMetres:512,world:area.world,revision:identity.split(':').at(-1),projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87745.27512677578},spawn:{cell:area.spawn.cell,anchor},developmentOnly:true,releaseReady:false,tiles:entries,renderVariants:[...variants.values()]});
 // Worst corner footprint: a vehicle can touch at most a 2x2 block of contact cells, each of which
 // pins its building-owner dependencies. The full 3x3 neighbourhood is reported but not a hard set.
 let maxSafetyBytes=0,worstSafetyCell=null,maxTransientBytes=0,maxNeighbourhoodBytes=0;
 const eligible=k=>entries[k]?.contactEligible;
 const reserved=keys=>{const all=new Set();for(const k of keys)if(eligible(k)){all.add(k);for(const d of entries[k].dependencies)all.add(d);}return [...all].reduce((n,k)=>n+entries[k].residentBytes,0);};
 for(const [key,e]of Object.entries(entries)){maxTransientBytes=Math.max(maxTransientBytes,e.transientBytes);if(!e.contactEligible)continue;const [x,z]=key.split(',').map(Number);
  const around=[];for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)around.push(`${x+dx},${z+dz}`);
  maxNeighbourhoodBytes=Math.max(maxNeighbourhoodBytes,reserved(around));
  for(const [ox,oz]of[[0,0],[1,0],[0,1],[1,1]]){const bytes=reserved([`${x+ox-1},${z+oz-1}`,`${x+ox},${z+oz-1}`,`${x+ox-1},${z+oz}`,`${x+ox},${z+oz}`]);if(bytes>maxSafetyBytes){maxSafetyBytes=bytes;worstSafetyCell=key;}}}
 // Publish the manifest/summary first so an over-budget result can be inspected, then fail.
 await writeFile(join(output,'cells/manifest.json'),JSON.stringify(manifest));await writeFile(join(output,'seams.json'),JSON.stringify(seams));
 await writeFile(join(output,'graph.json'),JSON.stringify({nodes:[...graph.nodes.values()].map(v=>v.value),edges:[...graph.edges.values()].map(v=>v.value),turns:[...graph.turns.values()].map(v=>v.value)}));
 if(!generator.stderr.readableEnded)await new Promise(r=>generator.stderr.once('end',r));
 const excluded=new Map(),unresolved=new Set();let clippedPieces=0,clippedDropped=0;
 for(const a of pythonAudits){for(const [id,reason] of Object.entries(a.excludedRoads||{}))excluded.set(id,reason);for(const id of a.unresolvedBridges||[])unresolved.add(id);clippedPieces+=a.clippedBuildings?.pieces||0;clippedDropped+=a.clippedBuildings?.dropped||0;}
 const excludedByReason={};for(const reason of excluded.values())excludedByReason[reason]=(excludedByReason[reason]||0)+1;
 await writeFile(join(output,'python-audit.ndjson'),pythonAudits.map(a=>JSON.stringify(a)).join('\n')+'\n');
 await writeFile(join(output,'summary.json'),JSON.stringify({area:areaName,world:area.world,atGradeUnderpasses:JSON.parse(await readFile(new URL('./tunnels.json',import.meta.url),'utf8')),excludedRoads:excluded.size,excludedByReason,excludedRoadIds:[...excluded.keys()].sort(),unresolvedBridges:[...unresolved].sort(),clippedBuildingPieces:clippedPieces,clippedBuildingPiecesDropped:clippedDropped,cells:audits.length,bytes:audits.reduce((n,r)=>n+r.bytes,0),maxSafetyBytes,worstSafetyCell,maxNeighbourhoodBytes,maxTransientBytes,graphEdges:graph.edges.size,graphNodes:graph.nodes.size,turnRules:graph.turns.size},null,2));
 if(maxSafetyBytes>64*1024*1024||maxTransientBytes>64*1024*1024)throw Error('Phone minimum safety set/reservation conflicts with unchanged cap');
 console.error('Coastal bake complete; assets remain uncommitted pending hosting agreement.');
}catch(e){if(e.failures)await writeFile(join(output,'failures.json'),JSON.stringify(e.failures,null,1));throw e;}finally{if(generator.exitCode===null)generator.kill('SIGTERM');writer.destroy();await rm(fifo,{force:true});}
