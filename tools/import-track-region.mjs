// Offline authored geometry -> globally indexed AWT. No runtime offsets, no race code.
import {readFile,writeFile,mkdir,statfs} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {loadMap} from '../src/map.js';
import {buildTerrain} from '../src/terrain.js';
import {RoadNetwork} from '../src/road-network-surface.js';
import {buildRoadNetwork} from '../src/road-network.js';
import {bakeExistingTiles} from './tile-existing-worlds.mjs';
import {penteliJunctions} from '../src/maps/penteli-roadside.js';
import {WorldDetail} from '../src/world-detail.js';
import {conformImportedRoads} from './world-gen/conform-imported-roads.mjs';
import {buildScenery} from '../src/maps/penteli.js';
import {regionTransform,REGION_PROJECTION,addAuthoredMeshes,decorateAuthored,addRails,addRoadGraph,addBuildingColliders,proveAnchors} from './world-gen/track-region-geometry.mjs';
import {WorldTileBarriers} from '../src/world-tile-barriers.js';
import {WorldTileObstacles,buildTileObstacleIndex} from '../src/world-tile-obstacles.js';
import {WorldRoadGraph} from '../src/world-tile-graph.js';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {tileTables} from '../src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
import {validateDirectory} from './validate-world-tiles.mjs';
import {validateDirectoryContacts} from './validate-world-tile-contacts.mjs';
import {auditWorldSurface} from './world-surface-audit.mjs';
// Legacy AWT stores its actual fine ground faces separately from road faces.
// Expose those emitted triangles as terrain contact rows to the common audit;
// the coarse height fallback remains disabled by auditWorldSurface itself.
export function regionAuditTables(t){
 const offset=t.contactPositions.length/3,positions=new Float32Array(t.contactPositions.length+t.finePositions.length);positions.set(t.contactPositions);positions.set(t.finePositions,t.contactPositions.length);
 const triangles=new Uint32Array(t.contactTriangles.length+t.fineTriangles.length/3*5),layers=new Int8Array(t.contactLayers.length+t.fineTriangles.length/3);triangles.set(t.contactTriangles);layers.set(t.contactLayers);
 for(let i=0;i<t.fineTriangles.length;i+=3){const j=t.contactTriangles.length+i/3*5;triangles.set([t.fineTriangles[i]+offset,t.fineTriangles[i+1]+offset,t.fineTriangles[i+2]+offset,1,2],j);}
 return {...t,contactPositions:positions,contactTriangles:triangles,contactLayers:layers};
}
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function regionSourceFiles(root){
 const found=new Set(['data/maps/penteli/map.json','data/maps/penteli/terrain.bin','tools/maps/penteli/SOURCES.md','tools/world-gen/steep-exclusions.json','tools/world-gen/regions/penteli-access.json']);
 async function visit(path){if(found.has(path))return;found.add(path);const text=await readFile(resolve(root,path),'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const full=resolve(root,dirname(path),match[1]),relative=full.slice(resolve(root).length+1);await visit(relative);}
 }
 for(const path of ['tools/import-track-region.mjs','tools/tile-existing-worlds.mjs'])await visit(path);
 return [...found].sort();
}
export async function checkSourceHashes(root,config){
 if(config.schemaVersion!==1||config.id!=='penteli'||config.tileMetres!==512||config.access!=='public')throw Error('Unsupported region selection');
 if(config.elevation.datum!=='EVRS2000'||config.elevation.source!=='EU-DEM v1.1'||config.elevation.verticalOffset!==0)throw Error('Unapproved vertical datum/conversion');
 if(!config.sourceHashes||!Object.keys(config.sourceHashes).length)throw Error('Source hashes required');
 for(const [path,expected]of Object.entries(config.sourceHashes)){
  if(path.startsWith('/')||path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid source hash lock');
  if(hash(await readFile(resolve(root,path)))!==expected)throw Error('Stale region source hash: '+path);
 }
 for(const required of ['data/maps/penteli/map.json','data/maps/penteli/terrain.bin'])if(!config.sourceHashes[required])throw Error('Missing source hash: '+required);
 for(const path of await regionSourceFiles(root))if(!config.sourceHashes[path])throw Error('Unhashed importer dependency: '+path);
 return hash(JSON.stringify(config));
}
export function rejectDuplicateCells(region,baseline){for(const key of Object.keys(region.tiles))if(Object.hasOwn(baseline.tiles,key))throw Error('Duplicate region cell: '+key);}
export async function checkDisk(){const s=await statfs('/'),used=s.blocks-s.bfree,pct=Math.ceil(100*used/(used+s.bavail));if(pct>=83)throw Error('Shared disk hard stop: '+pct+'%');return pct;}
async function generateRegionSource(root){
 const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
 globalThis.fetch=async url=>new Response(await readFile(resolve(root,String(url))));globalThis.location={search:''};
 try{const map=await loadMap(undefined,'./','penteli',{preload:false}),network=new RoadNetwork(map),group=new THREE.Group();map.roadNetwork=network;
  const terrain=buildTerrain(map.terrain,map.route,[],group,{coastal:false,network}),roads=buildRoadNetwork(network,group);
  return {map,network,terrainGroup:terrain.group,roadsGroup:roads};
 }finally{globalThis.fetch=previousFetch;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;}
}
export async function importTrackRegion({root=resolve(import.meta.dirname,'..'),out,configPath=resolve(root,'tools/world-gen/regions/penteli.json'),baselinePath}={}){
 if(!out)throw Error('An explicit output directory is required');await checkDisk();
 const config=JSON.parse(await readFile(configPath)),revision=await checkSourceHashes(root,config),baseline=baselinePath?JSON.parse(await readFile(baselinePath)):null;
 console.log('Generating source Penteli terrain and roads');const bake=await generateRegionSource(root);
 const transform=regionTransform(bake.map.data.proj),height=(x,z)=>bake.map.terrain.refinedHeight?.(x,z)??bake.map.terrain.height(x,z),scene=new THREE.Group(),scenery=buildScenery(scene,bake.map,{heightC:height,assets:{network:bake.network}});
 const report={schemaVersion:1,region:'penteli',revision,sourceHashes:config.sourceHashes,projection:REGION_PROJECTION,elevation:config.elevation};
 const conformed=conformImportedRoads(bake);report.roadConformance=conformed.report;bake.roadsGroup=conformed.group;
 const points=[];for(let s=0;s<=bake.map.route.length;s+=2)points.push(bake.map.route.point(s,0).toArray());
 const access=JSON.parse(await readFile(resolve(root,'tools/world-gen/regions/penteli-access.json'))),ways=new Map(access.ways.map(w=>[w.id,w])),mainNodes=new Set(bake.map.data.penteli.sourceWayIds.flatMap(id=>ways.get(id)?.nodes||[]));
 const lines=[{id:'main',points,width:6.8}],sideLines=new Map();
 for(const road of bake.map.data.roadNetwork.roads){const points=[];for(let i=0;i<road.p.length;i+=2){const x=road.p[i],z=road.p[i+1];points.push([x,bake.network.height(x,z),z]);}const tags=ways.get(road.id)?.tags;if(!tags)throw Error('Missing source access evidence: '+road.id);const accessTag=tags.motorcar??tags.motor_vehicle??tags.vehicle??tags.access;const line={id:`way-${road.id}-${road.part||0}`,points,name:road.n,oneway:!!road.oneway,restricted:accessTag!=null&&!['yes','permissive','designated'].includes(accessTag)||Object.keys(tags).some(k=>k.endsWith(':conditional')),speed:road.v,width:road.w};lines.push(line);sideLines.set(road,line);}
 report.junctions=[];
 for(const junction of penteliJunctions(bake.map)){
  const side=sideLines.get(junction.road);if(!side||side.restricted||!ways.get(junction.roadId)?.nodes.some(n=>mainNodes.has(n)))continue;
  const station=Math.max(0,Math.min(points.length-1,Math.round(junction.s/2))),a=points[station],b=side.points.reduce((best,p)=>Math.hypot(p[0]-a[0],p[2]-a[2])<Math.hypot(best[0]-a[0],best[2]-a[2])?p:best),length=Math.hypot(b[0]-a[0],b[2]-a[2]);
  if(length>20)throw Error('Source junction exceeds existing paved mouth: '+junction.roadId);
  lines.push({id:'junction-'+junction.roadId,points:[a,b],oneway:side.oneway,width:Math.min(6.8,side.width),speed:30});report.junctions.push({roadId:junction.roadId,station:station*2,length});
 }
 try{
  await bakeExistingTiles(bake,out,{transform,revision,projection:REGION_PROJECTION,elevation:config.elevation,authoredContacts:true,renderRoads:false,terrainSurface:'penteliTerrain',beforeWrite:checkDisk,
   manifest:{developmentOnly:true,releaseReady:false,regionId:'penteli',sourceHashes:config.sourceHashes,access:config.access,migration:{partial:false,source:'penteli',reprojected:true}},
   populate({get,tiles}){
    report.graph=addRoadGraph(lines,get,transform);
    report.networkTriangles=addAuthoredMeshes(bake.roadsGroup,get,transform,{surface:'penteliNetwork'});
    report.roadTriangles=addAuthoredMeshes(scenery.road.group,get,transform,{surface:'penteliRoad',contacts:true});
    report.sceneryTriangles=addAuthoredMeshes(scenery.group,get,transform);
    report.rails=addRails(scenery.assets.rails,get,transform);
    report.buildingColliders=addBuildingColliders(bake.map.data.buildings,get,transform,height);
    const details=WorldDetail.prototype.records.call({heightC:height},bake.map);report.detailRecords=details.length;
    for(const record of details){const [x,y,z]=transform.position([record.x,record.y,record.z]),tile=get(Math.floor(x/512),Math.floor(z/512));tile.authoredDetail??=[];tile.authoredDetail.push({...record,x,y,z,...(record.yaw==null?{}:{yaw:transform.yaw(record.yaw)})});}
    report.anchors=proveAnchors(tiles,{buildIndex:buildTileContactIndex,sample:sampleTileContact,Barriers:WorldTileBarriers,buildObstacles:buildTileObstacleIndex,Obstacles:WorldTileObstacles});
    for(const tile of tiles.values())tile.provenance={region:'penteli',revision};
    if(baseline)rejectDuplicateCells({tiles:Object.fromEntries(tiles)},baseline);
   },decorate:decorateAuthored});
 }finally{scenery.dispose();bake.terrainGroup.traverse(o=>o.geometry?.dispose());bake.roadsGroup.traverse(o=>o.geometry?.dispose());}
 const manifestPath=resolve(out,'data/tiles/penteli/world.json'),manifest=JSON.parse(await readFile(manifestPath));
 report.budgets=regionBudgets(manifest);report.coverage={samples:points.length,covered:0,missing:[],maximumHeightError:0};
 const samples=new Map();points.forEach((p,i)=>{const q=transform.position(p),key=`${Math.floor(q[0]/512)},${Math.floor(q[2]/512)}`;if(!samples.has(key))samples.set(key,[]);samples.get(key).push({s:i*2,p:q});});
 const shoulderRows=[],shoulderSamples=new Map();
 for(let s=0;s<=bake.map.route.length;s+=2)for(const side of[-1,1]){const heights=new Float64Array(25).fill(NaN),row={s,side,heights};shoulderRows.push(row);for(let j=0;j<=24;j++){const q=transform.position(bake.map.route.point(s,side*(bake.map.route.edge(s)-.01+j*.25)).toArray()),key=`${Math.floor(q[0]/512)},${Math.floor(q[2]/512)}`;if(!shoulderSamples.has(key))shoulderSamples.set(key,[]);shoulderSamples.get(key).push({row,j,p:q});}}
 report.surface=[];const graph=new WorldRoadGraph();
 for(const [key,entry]of Object.entries(manifest.tiles)){
  const bytes=await readFile(resolve(dirname(manifestPath),entry.url)),raw=gunzipSync(bytes),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),tables=tileTables(pack),index=buildTileContactIndex(tables);
  const physical={...tables,coarseHeights:new Float32Array(1089).fill(NaN)};
  for(const {row,j,p}of shoulderSamples.get(key)||[]){const c=sampleTileContact(physical,index,p[0]-pack.metadata.origin[0],p[2]-pack.metadata.origin[2],{referenceY:p[1]});if(c)row.heights[j]=c.y;}
  graph.install(key,pack);
  report.surface.push({cell:key,...auditWorldSurface(regionAuditTables(tables),pack.metadata)});
  for(const {s,p}of samples.get(key)||[]){const hit=sampleTileContact(tables,index,p[0]-pack.metadata.origin[0],p[2]-pack.metadata.origin[2],{referenceY:p[1],requiredFlags:1});if(!hit||Math.abs(hit.y-p[1])>.15)report.coverage.missing.push({s,p,hit});else report.coverage.covered++;if(hit)report.coverage.maximumHeightError=Math.max(report.coverage.maximumHeightError,Math.abs(hit.y-p[1]));}
 }
 report.shoulders={samples:shoulderRows.length*25,missing:0,maxStep:0,worst:null};for(const row of shoulderRows)for(let j=0;j<row.heights.length;j++){if(!Number.isFinite(row.heights[j])){report.shoulders.missing++;continue;}if(j&&Number.isFinite(row.heights[j-1])){const step=Math.abs(row.heights[j]-row.heights[j-1]);if(step>report.shoulders.maxStep){report.shoulders.maxStep=step;report.shoulders.worst={s:row.s,side:row.side,offset:j*.25,from:row.heights[j-1],to:row.heights[j]};}}}report.shoulders.passed=!report.shoulders.missing&&report.shoulders.maxStep<=.15;
 const start=transform.position(points[0]),finish=transform.position(points.at(-1)),first=graph.nearest(start[0],start[2],{referenceY:start[1],maxDistance:1}),last=graph.nearest(finish[0],finish[2],{referenceY:finish[1],maxDistance:1});
 const startNode=first&&graph.edges.get(first.edge).value.from,endNode=last&&graph.edges.get(last.edge).value.to;report.graph.climbConnected=!!(startNode&&endNode&&graph.route(startNode,endNode));report.graph.descentConnected=!!(startNode&&endNode&&graph.route(endNode,startNode));graph.dispose();
 report.coverage.cells=[...samples.keys()];report.coverage.route=points.map(p=>transform.position(p));
 try{report.structural=await validateDirectory(manifestPath);}catch(error){report.structural={error:error.message};}
 try{report.contacts=await validateDirectoryContacts(manifestPath);}catch(error){report.contacts={error:error.message};}
 report.geometryPassed=report.shoulders.passed&&report.graph.climbConnected&&report.graph.descentConnected&&report.anchors.accepted>0&&report.coverage.covered===points.length&&report.surface.every(s=>s.passed)&&!report.structural.error&&!report.contacts.error&&!report.contacts.failures.length&&!report.contacts.missing&&report.budgets.passed;
 report.attachment={baselineWorld:baseline?.world||null,baselineRevision:baseline?.revision||null,baselineDatum:baseline?.elevation?.datum||null,sourceDatum:config.elevation.datum,duplicateCells:baseline?Object.keys(manifest.tiles).filter(k=>baseline.tiles[k]).length:null,passed:!!baseline&&baseline.elevation?.datum===config.elevation.datum};
 // Imported bridge parapets are preserved, but the legacy bundle has no layered
 // deck/underpass clearance proof. Do not let a datum-only repair publish it.
 report.releaseProofs={bridgeClearance:{passed:false,reason:'Legacy Penteli bridges need emitted deck/underpass clearance proof',sourceBridges:bake.map.data.penteli.bridges},towGameplay:{passed:false,reason:'Proven anchors still need streamed vehicle recovery acceptance'}};
 report.passed=report.geometryPassed&&report.attachment.passed&&Object.values(report.releaseProofs).every(p=>p.passed);manifest.acceptance={geometryPassed:report.geometryPassed,attachmentPassed:report.attachment.passed,passed:report.passed};await writeFile(manifestPath,JSON.stringify(manifest));
 await writeFile(resolve(out,'penteli-equivalence.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,geometryPassed:report.geometryPassed,attachment:report.attachment,shoulders:report.shoulders,coverage:{...report.coverage,route:undefined},budgets:report.budgets,surfaceFailures:report.surface.filter(s=>!s.passed),structural:report.structural,contacts:report.contacts},null,2));
 if(!report.passed)throw Error('Penteli region acceptance failed; see penteli-equivalence.json');return {manifestPath,report};
}
export function regionBudgets(manifest){let worst=0,worstCell;for(const key of Object.keys(manifest.tiles)){const[x,z]=key.split(',').map(Number);for(const dx of[-1,0])for(const dz of[-1,0]){let sum=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const e=manifest.tiles[`${x+dx+a},${z+dz+b}`];sum+=e?.residentBytes??e?.decodedBytes??0;}if(sum>worst){worst=sum;worstCell=[x+dx,z+dz];}}}const bytes=Object.values(manifest.tiles).reduce((n,e)=>n+e.bytes,0);return{cells:Object.keys(manifest.tiles).length,bytes,worst2x2Bytes:worst,worstCell,passed:worst<=64*1024**2&&bytes<=2*1024**3};}
if(process.argv[1]===import.meta.filename){const [out,baselinePath]=process.argv.slice(2);
 if(out==='--lock-sources'){const root=resolve(import.meta.dirname,'..'),path=resolve(root,'tools/world-gen/regions/penteli.json'),config=JSON.parse(await readFile(path));config.sourceHashes={};for(const file of await regionSourceFiles(root))config.sourceHashes[file]=hash(await readFile(resolve(root,file)));await writeFile(path,JSON.stringify(config,null,2)+'\n');console.log('Locked '+Object.keys(config.sourceHashes).length+' importer sources; review the lock diff before baking.');}
 else await importTrackRegion({out,baselinePath});
}
