import {admitRecoverySidecar} from '../server/route-road-stream.mjs';
import {recoveryRoadGroup,recoveryRoadTwins} from '../src/world-road-group.js';
// Offline recovery authority. Every active cell is read and hash verified; only
// actual contact/obstacle proven discrete poses become server recovery anchors.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJSON,sha256} from '../src/route-definition.js';
import {edgeValue,edgeLength,edgePoint,projectEdge,cellKey} from '../src/route-geometry.js';
import {routeSurfaceAllowed} from '../src/route-surface.js';
import {readGraphShard} from '../src/world-tile-graph.js';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';
import {garageFootprints,legalLanePoint} from './build-online-grids.mjs';
const HASH=/^[a-f0-9]{64}$/,CELL=/^-?\d+,-?\d+$/;
export const MAX_RECOVERY_BYTES=2*1024*1024;
// Keep actual certificates, never synthesize a wider+longer rectangle from two.
export function paretoFootprints(profiles){
 return profiles.filter((p,i,a)=>!a.some((q,j)=>j!==i&&q.halfWidth>=p.halfWidth&&q.halfLength>=p.halfLength&&(q.halfWidth>p.halfWidth||q.halfLength>p.halfLength||j<i))).map(p=>({halfWidth:p.halfWidth,halfLength:p.halfLength})).sort((a,b)=>b.halfLength-a.halfLength||b.halfWidth-a.halfWidth);
}
export function recoveryWorldRegistry(manifest){
 if(!HASH.test(manifest.revision||'')||!manifest.tiles||!Object.keys(manifest.tiles).length)throw Error('Missing authenticated recovery world');
 const sourceHashes=Object.entries(manifest.tiles).sort(([a],[b])=>a.localeCompare(b)).map(([key,e])=>{if(!CELL.test(key)||!HASH.test(e.sha256||''))throw Error('Invalid recovery source cell: '+key);return[key,e.sha256];});
 return {worldSetRevision:manifest.revision,sourceHashes};
}
export function assertRecoveryCoverage(manifest,registry){
 const expected=registry.sourceHashes,actual=Object.entries(manifest.cells).sort(([a],[b])=>a.localeCompare(b));
 if(manifest.worldSetRevision!==registry.worldSetRevision||actual.length!==expected.length||actual.some(([k,e],i)=>k!==expected[i][0]||e.sourceHash!==expected[i][1]))throw Error('Recovery manifest does not cover the complete active world');
}
export function recoveryNeighborhood(key,manifest){
 const [x,z]=key.split(',').map(Number),keys=new Set();for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const k=`${x+dx},${z+dz}`;if(manifest.tiles[k])keys.add(k);}return keys;
}
export function proveRecoveryCell(key,world,profiles,{spacingM=4,onEdge=()=>{}}={}){
 if(!(spacingM>0&&spacingM<=4))throw Error('Recovery sampling must be at most four metres');
 const packet=world.tiles.get(key)?.packet;if(!packet)throw Error('Missing recovery owner: '+key);
 const ids=new Set((packet.roadGraph||readGraphShard(packet)).edges.filter(e=>!(e.flags&8)).map(e=>e.id));
 const anchors=[],edges=new Map(),seen=new Set();let roadSamples=0;
 for(const id of [...ids].sort()){
  const edge=edgeValue(world.roads.graph,id),group=recoveryRoadGroup(world.roads.graph,edge),length=edgeLength(edge),count=Math.max(1,Math.ceil(length/spacingM));let used=false;
  for(let i=0;i<=count;i++){
   const point={...edgePoint(edge,length*i/count),offsetM:length*i/count};if(cellKey(point.x,point.z)!==key)continue;roadSamples++;
   const contact=world.contacts.contact(point.x,point.z,{referenceY:point.y,layer:edge.layer,requiredFlags:1});
   if(!contact||!routeSurfaceAllowed(edge,contact,world.roads.graph))continue;
   Object.assign(point,{y:contact.y,surfaceId:contact.surfaceId});const width=world.contacts.width(point,{connected:true});if(!width)continue;
   Object.assign(point,{leftM:width.left,rightM:width.right});
   // Each profile may need a different legal lane centre. Certify all profiles
   // at each distinct candidate, then retain a Pareto set of successful proofs.
   const candidates=new Map();for(const profile of profiles){const p=legalLanePoint(world,point,profile,{validate:false});if(p)candidates.set(`${p.x.toFixed(6)},${p.z.toFixed(6)}`,p);}
   for(const p of candidates.values()){
    const certified=[];for(const profile of [...profiles].sort((a,b)=>b.halfLength-a.halfLength||b.halfWidth-a.halfWidth)){if(certified.some(q=>q.halfWidth>=profile.halfWidth&&q.halfLength>=profile.halfLength))continue;if(p.leftM>=profile.halfWidth+.15&&p.rightM>=profile.halfWidth+.15&&world.contacts.safe(p,{...profile,connected:true}))certified.push(profile);}const compatible=paretoFootprints(certified);
    if(!compatible.length)continue;
    const projected=projectEdge(edge,p.x,p.z),identity=canonicalJSON([id,projected.offsetM]);if(seen.has(identity))continue;
    if(Math.abs(projected.y-p.y)>.75||Math.cos(projected.yaw-p.yaw)<Math.cos(5*Math.PI/180))continue;
    seen.add(identity);const first=compatible[0];anchors.push({edgeId:id,...(group?{roadId:group.roadId}:{}),offsetM:projected.offsetM,x:p.x,y:p.y,z:p.z,yaw:p.yaw,layer:p.layer,surfaceId:p.surfaceId,leftM:p.leftM,rightM:p.rightM,halfWidth:first.halfWidth,halfLength:first.halfLength,footprints:compatible});used=true;
   }
  }
  if(used){const pending=[edge];for(let j=0;j<pending.length;j++){const e=pending[j];if(edges.has(e.id))continue;edges.set(e.id,e);for(const twin of recoveryRoadTwins(world.roads.graph,e))if(!edges.has(twin.id))pending.push(twin);}}onEdge({edge:id,anchors:anchors.length});
 }
 // A graph edge crossing a cell without any samples is still a road-bearing
 // cell. Never disguise failed/missing certification as no-drivable content.
 if(ids.size&&!anchors.length)throw Error(`Recovery cell has roads but no certified anchors: ${key} (${roadSamples} samples)`);
 if(!ids.size)return null;
 const body={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:world.manifest.revision,sourceHashes:[...world.tiles.keys()].sort().map(k=>[k,world.manifest.tiles[k].sha256]),edges:[...edges.values()].sort((a,b)=>a.id.localeCompare(b.id)),anchors};
 if(Buffer.byteLength(canonicalJSON(body))>MAX_RECOVERY_BYTES)throw Error('Recovery sidecar exceeds 2 MiB: '+key);
 return body;
}
// Use the exact request-time admission on the original immutable wire artifact.
// Compact query data must never replace the published contact/edge proof.
export async function admitRecoveryCell(raw,{key,manifest,hash}){
 const admitted=await admitRecoverySidecar(raw,{expectedHash:hash,worldSetRevision:manifest.revision});
 const expected=[...recoveryNeighborhood(key,manifest)].sort().map(k=>[k,manifest.tiles[k].sha256]);
 if(canonicalJSON(admitted.body.sourceHashes)!==canonicalJSON(expected))throw Error('Recovery sidecar does not bind its exact active neighborhood: '+key);
 return admitted.metrics;
}
export async function buildWorldRecovery({world,cells,out,profiles,readWorld=readEmittedRouteWorld,onCell=()=>{}}){
 const manifest=JSON.parse(await readFile(world,'utf8')),recoveryWorld=recoveryWorldRegistry(manifest),root={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:manifest.revision,footprints:[],cells:{}},certificates=[];
 profiles||=await garageFootprints();await mkdir(out,{recursive:true});let totalBytes=0,anchorCount=0,maxSidecarBytes=0,maxDecodedBytes=0,admittedCells=0;
 for(const [key,sourceHash]of recoveryWorld.sourceHashes){
  const keys=recoveryNeighborhood(key,manifest),sample=await readWorld({world,cells,keys});
  for(const k of keys)if(!sample.tiles.has(k))throw Error('Incomplete recovery neighborhood: '+key+' missing '+k);
  const body=proveRecoveryCell(key,sample,profiles);
  if(!body)root.cells[key]={sourceHash,empty:true};
  else {const text=canonicalJSON(body),hash=await sha256(body),name=`${key}.${hash}.json`;const metrics=await admitRecoveryCell(text,{key,manifest,hash});maxSidecarBytes=Math.max(maxSidecarBytes,metrics.bytes);maxDecodedBytes=Math.max(maxDecodedBytes,metrics.decodedBytes);admittedCells++;await writeFile(resolve(out,name),text);root.cells[key]={sourceHash,hash,url:'/world/recovery/'+name};totalBytes+=Buffer.byteLength(text);anchorCount+=body.anchors.length;for(const a of body.anchors)certificates.push(...a.footprints);}
  sample.roads.graph.dispose();sample.tiles.clear();onCell({key,cells:Object.keys(root.cells).length,totalBytes,anchorCount});
 }
 root.footprints=paretoFootprints(certificates);if(!root.footprints.length)throw Error('World has no certified recovery vehicle');assertRecoveryCoverage(root,recoveryWorld);
 const hash=await sha256(root),text=canonicalJSON(root);if(Buffer.byteLength(text)>MAX_RECOVERY_BYTES)throw Error('Recovery root exceeds 2 MiB');await writeFile(resolve(out,`manifest.${hash}.json`),text);totalBytes+=Buffer.byteLength(text);
 return {hash,body:root,recoveryWorld,totalBytes,anchorCount,admission:{cells:admittedCells,maxSidecarBytes,maxDecodedBytes},descriptor:{schemaVersion:1,url:`/world/recovery/manifest.${hash}.json`,hash,streamed:true}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].slice(2)]=process.argv[i+1];
 try{const result=await buildWorldRecovery({...options,onCell:p=>console.log(JSON.stringify(p))});console.log(JSON.stringify({...result,body:undefined}));}catch(error){console.error(error.stack);process.exitCode=1;}
}
