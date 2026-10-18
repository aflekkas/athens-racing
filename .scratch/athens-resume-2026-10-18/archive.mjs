// Stage 1 finite regression fixtures; deliberately not connected or player-visible.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {packTiles} from '../../tools/world-gen/pack.mjs';
import {decodeGeometryPack} from '../../src/baked-geometry.js';
import {validateWorldTile,validateWorldManifest,validateTileSeam,residentArrayBytes} from '../../src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '../../src/world-tile-contact.js';
import {prepareTilePacket} from '../../src/world-tile-worker.js';
import {WorldRoadGraph} from '../../src/world-tile-graph.js';
import {auditWorldSurface} from '../../tools/world-surface-audit.mjs';
const spool=process.argv[2],out=resolve('.scratch/athens-resume-2026-10-18/development-world');
const entries=await packTiles(spool,out),keys=new Set(Object.keys(entries));
const original=JSON.parse(readFileSync('.scratch/athens-world/development-world/glyfada/manifest.json'));
const packs=new Map(),graph=new WorldRoadGraph(),reports=[],omitted=new Set(),uniqueRoads=new Map();let spawn,palette,world,revision,spawnWorld;
const triangles=(p,ix,stride)=>{const result=[];for(let i=0;i<ix.length;i+=stride)result.push([0,1,2].map(j=>Array.from(p.slice(ix[i+j]*3,ix[i+j]*3+3)).join(',')).sort().join('|'));return result.sort();};
for(const [key,entry]of Object.entries(entries)){
  for(const d of entry.dependencies)if(!keys.has(d))omitted.add(d);
  entry.dependencies=entry.dependencies.filter(d=>keys.has(d));
  const raw=gunzipSync(readFileSync(resolve(out,entry.url))),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  const {tables:t}=validateWorldTile(pack),m=pack.metadata,index=buildTileContactIndex(t),render=[];
  for(const mesh of m.meshes)if([0,1,8,9].includes(mesh.material))render.push(...triangles(pack.arrays[mesh.attributes.position.array],pack.arrays[mesh.index],3));
  const contact=triangles(t.contactPositions,t.contactTriangles,5);
  if(JSON.stringify(render.sort())!==JSON.stringify(contact)||JSON.stringify(triangles(t.finePositions,t.fineTriangles,3))!==JSON.stringify(contact))throw Error('Render/contact/fine mismatch '+key);
  let graphError=0;
  for(let i=0;i<t.edgePoints.length;i+=3){const [x,y,z]=t.edgePoints.slice(i,i+3),hit=sampleTileContact(t,index,x,z,{referenceY:y,layer:0,requiredFlags:1,includeBoundary:true});if(!hit)throw Error('Missing graph asphalt '+key+':'+i);graphError=Math.max(graphError,Math.abs(y-hit.y));}
  if(graphError>.005)throw Error('Graph height mismatch '+key);
  for(let i=0;i<t.edges.length;i+=10){let length=0;const start=t.edges[i+3],count=t.edges[i+4];for(let j=start+1;j<start+count;j++)length+=Math.hypot(t.edgePoints[j*3]-t.edgePoints[(j-1)*3],t.edgePoints[j*3+2]-t.edgePoints[(j-1)*3+2]);uniqueRoads.set(m.ids[t.edges[i]].replace(/:[fb]:(-?\d+):(-?\d+)$/,':both:$1:$2'),length);}
  if(!spawn&&key==='4,25'){
    let row=0;for(let i=0;i<t.anchors.length;i+=5)if(m.ids[t.anchors[i+2]].startsWith('osm:way:24826358:')){row=i;break;}
    if(!t.anchors.length)throw Error('Missing generated spawn');spawn={cell:m.cell,anchor:m.ids[t.anchors[row]]};const at=t.anchors[row+1]*4;spawnWorld=[t.anchorTransforms[at]+m.origin[0],t.anchorTransforms[at+1],t.anchorTransforms[at+2]+m.origin[2],t.anchorTransforms[at+3]];
  }
  const packet=prepareTilePacket(pack,{entry,world:m.world,revision:m.revision,cell:m.cell});
  reports.push({cell:m.cell,compressedBytes:entry.bytes,reservationBytes:entry.decodedBytes,transientReservationBytes:entry.decodedBytes*2+entry.bytes,packetBytes:packet.bytes,arrayBackingBytes:residentArrayBytes(pack.arrays),gpuGeometryBytes:packet.gpuBytes,contactIndexBytes:packet.contactIndex.offsets.byteLength+packet.contactIndex.refs.byteLength,triangles:entry.triangles,graphPoints:t.edgePoints.length/3,maxGraphContactError:graphError,anchors:t.anchors.length/5,physical:auditWorldSurface(t)});
  packs.set(key,{pack,t,index});graph.install(key,pack);palette=m.palette;world=m.world;revision=m.revision;
}
let seamSamples=0,maxSeamError=0;
for(const [key,a]of packs){const [x,z]=key.split(',').map(Number);for(const [other,axis]of [[`${x+1},${z}`,0],[`${x},${z+1}`,1]])if(packs.has(other)){
  const b=packs.get(other);validateTileSeam(a.pack,b.pack);
  for(let d=0;d<512;d+=.25){const left=sampleTileContact(a.t,a.index,axis?d:512-1e-7,axis?512-1e-7:d,{layer:0}),right=sampleTileContact(b.t,b.index,axis?d:1e-7,axis?1e-7:d,{layer:0});if(!left||!right)throw Error('Missing neighbour contact');maxSeamError=Math.max(maxSeamError,Math.abs(left.y-right.y));seamSamples++;}
}}
if(maxSeamError>.005)throw Error('Seam contact mismatch');
const manifest={...original,world,revision,palette,spawn,tiles:entries,developmentOnly:true,releaseReady:false,coverage:{cells:[...keys],connected:false,excludedBuildingOwnerCells:[...omitted].sort()},notes:['Stage 1 physical regression fixtures only: adjacent Glyfada pair plus separate Riviera cell.','Not a connected world or a player-visible map. Coast/sea, vegetation, structures and actual game driving are stage 2 work.','Spawn and graph elevations come from the exact emitted contact surface.']};
validateWorldManifest(manifest);mkdirSync(out,{recursive:true});writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const result={stage:1,connected:false,releaseReady:false,world,revision,cells:reports,extentSquareKm:keys.size*512*512/1e6,roadKm:[...uniqueRoads.values()].reduce((a,b)=>a+b,0)/1000,compressedBytes:reports.reduce((n,r)=>n+r.compressedBytes,0),graphNodes:graph.nodes.size,graphEdges:graph.edges.size,turnRules:graph.turns.size,spawn,spawnWorld,seamSamples,maxSeamError,renderContactFineIdentity:true};
writeFileSync('.scratch/athens-resume-2026-10-18/stage1-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));graph.dispose();
