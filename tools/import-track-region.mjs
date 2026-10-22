import {penteliCover,populatePenteliScenery} from './world-gen/penteli-scenery.mjs';
import {bakeRegionHorizon} from './world-gen/region-horizon.mjs';
import {buildSpeedSigns} from '../src/speed-signs.js';
import {buildStreetLife} from '../src/street-life.js';
import {auditBridgeGuards} from './world-bridge-audit.mjs';
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
import {buildScenery as buildMegaraScenery} from '../src/maps/megara.js';
import {regionTransform,REGION_PROJECTION,addAuthoredMeshes,decorateAuthored,addBridgeAprons,addRails,addBarrierObstacles,addRoadGraph,addBuildingColliders,proveAnchors} from './world-gen/track-region-geometry.mjs';
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
export async function regionSourceFiles(root,id='penteli'){
 const found=new Set(id==='megara'?['data/maps/megara/map.json','data/maps/megara/terrain.bin','tools/maps/megara/SOURCES.md',...['map.osm','context.json','raceway.json','dem.json','paved-runoffs.json','signs.json'].map(n=>'tools/maps/megara/raw/'+n)]:['data/maps/penteli/map.json','data/maps/penteli/terrain.bin','tools/maps/penteli/SOURCES.md','tools/world-gen/steep-exclusions.json','tools/world-gen/regions/penteli-access.json']);
 async function visit(path){if(found.has(path))return;found.add(path);const text=await readFile(resolve(root,path),'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const full=resolve(root,dirname(path),match[1]),relative=full.slice(resolve(root).length+1);await visit(relative);}
 }
 for(const path of ['tools/import-track-region.mjs','tools/tile-existing-worlds.mjs','tools/accept-track-region.mjs','src/world-regional-scenery.js','src/world-session.js'])await visit(path);
 return [...found].sort();
}
export async function checkSourceHashes(root,config){
 if(config.schemaVersion!==1||!['penteli','megara'].includes(config.id)||config.tileMetres!==512||config.access!==(config.id==='megara'?'circuit':'public'))throw Error('Unsupported region selection');
 if(config.elevation.datum!=='EVRS2000'||config.elevation.source!=='EU-DEM v1.1'||config.elevation.verticalOffset!==0)throw Error('Unapproved vertical datum/conversion');
 if(config.id==='megara'){
  const allowed=config.inclusion?.racewayWays;if(!Array.isArray(allowed)||allowed.length!==1||allowed[0]!==70043234||config.inclusion?.evidence!=='tools/maps/megara/SOURCES.md')throw Error('Megara raceway inclusion must be source backed');
  const ways=JSON.parse(await readFile(resolve(root,'tools/maps/megara/raw/context.json')));for(const id of allowed){const way=ways.find(w=>w.id===id);if(way?.tags?.highway!=='raceway'||way.tags.sport!=='motor')throw Error('Invalid raceway inclusion '+id);}
 }
 if(!config.sourceHashes||!Object.keys(config.sourceHashes).length)throw Error('Source hashes required');
 for(const [path,expected]of Object.entries(config.sourceHashes)){
  if(path.startsWith('/')||path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid source hash lock');
  if(hash(await readFile(resolve(root,path)))!==expected)throw Error('Stale region source hash: '+path);
 }
 for(const required of [`data/maps/${config.id}/map.json`,`data/maps/${config.id}/terrain.bin`])if(!config.sourceHashes[required])throw Error('Missing source hash: '+required);
 for(const path of await regionSourceFiles(root,config.id))if(!config.sourceHashes[path])throw Error('Unhashed importer dependency: '+path);
 return hash(JSON.stringify(config));
}
export function rejectDuplicateCells(region,baseline){for(const key of Object.keys(region.tiles))if(Object.hasOwn(baseline.tiles,key))throw Error('Duplicate region cell: '+key);}
export async function checkDisk(){const s=await statfs('/'),used=s.blocks-s.bfree,pct=Math.ceil(100*used/(used+s.bavail));if(pct>=83)throw Error('Shared disk hard stop: '+pct+'%');return pct;}
async function generateRegionSource(root,id){
 const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
 globalThis.fetch=async url=>new Response(await readFile(resolve(root,String(url))));globalThis.location={search:''};
 try{const map=await loadMap(undefined,'./',id,{preload:false}),network=new RoadNetwork(map),group=new THREE.Group();map.roadNetwork=network;
  const terrain=buildTerrain(map.terrain,map.route,[],group,{coastal:false,network,...(id==='megara'?{subdivisions:4}:{})}),roads=buildRoadNetwork(network,group);
  return {map,network,terrainGroup:terrain.group,roadsGroup:roads};
 }finally{globalThis.fetch=previousFetch;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;}
}
export async function importTrackRegion({root=resolve(import.meta.dirname,'..'),out,configPath=resolve(root,'tools/world-gen/regions/penteli.json'),baselinePath}={}){
 if(!out)throw Error('An explicit output directory is required');await checkDisk();
 const config=JSON.parse(await readFile(configPath)),revision=await checkSourceHashes(root,config),baseline=baselinePath?JSON.parse(await readFile(baselinePath)):null;
 if(config.id==='megara')return importMegaraRegion({root,out,config,revision,baseline});
 console.log('Generating source Penteli terrain and roads');const bake=await generateRegionSource(root,'penteli');
 const transform=regionTransform(bake.map.data.proj),height=(x,z)=>bake.map.terrain.refinedHeight?.(x,z)??bake.map.terrain.height(x,z),scene=new THREE.Group(),scenery=buildScenery(scene,bake.map,{heightC:height,assets:{network:bake.network}});
 const report={schemaVersion:1,region:'penteli',revision,sourceHashes:config.sourceHashes,projection:REGION_PROJECTION,elevation:config.elevation};
 const cover=penteliCover(bake.map,transform),regionalTerrain={};report.regionalTerrain=regionalTerrain;
 const props=new THREE.Group();let signs,bins;const oldDocument=globalThis.document;
 // Canvas pixels are regenerated by the shared browser recipes. Offline geometry
 // needs only their immutable recipe identity, never a raster or a fake texture.
 globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};
 try{signs=buildSpeedSigns(bake.map,props,height);bins=buildStreetLife(bake.map,props,height);}finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
 report.sceneParity={mappedSpeedSigns:bake.map.data.speedSigns.length,speedSigns:signs.counts.signs,directionWarningSigns:signs.group.children[0]?.userData.signCount||0,bins:bins.stats.bins,regionalSilhouettes:11};
 const conformed=conformImportedRoads(bake);report.roadConformance=conformed.report;bake.roadsGroup=conformed.group;
 const points=[];for(let s=0;s<=bake.map.route.length;s+=2)points.push(bake.map.route.point(s,0).toArray());
 const access=JSON.parse(await readFile(resolve(root,'tools/world-gen/regions/penteli-access.json'))),ways=new Map(access.ways.map(w=>[w.id,w])),mainNodes=new Set(bake.map.data.penteli.sourceWayIds.flatMap(id=>ways.get(id)?.nodes||[]));
 const bridges=bake.map.data.penteli.bridges;const lines=[{id:'main',points,width:7.2,layerAt:(a,b)=>bridges.some(r=>a*2>=r.from&&b*2<=r.to)?1:0}],sideLines=new Map();
 for(const road of bake.map.data.roadNetwork.roads){const points=[];for(let i=0;i<road.p.length;i+=2){const x=road.p[i],z=road.p[i+1];points.push([x,bake.network.height(x,z),z]);}const tags=ways.get(road.id)?.tags;if(!tags)throw Error('Missing source access evidence: '+road.id);const accessTag=tags.motorcar??tags.motor_vehicle??tags.vehicle??tags.access;const line={id:`way-${road.id}-${road.part||0}`,points,name:road.n,oneway:!!road.oneway,restricted:accessTag!=null&&!['yes','permissive','designated'].includes(accessTag)||Object.keys(tags).some(k=>k.endsWith(':conditional')),speed:road.v,width:road.w};lines.push(line);sideLines.set(road,line);}
 report.junctions=[];
 for(const junction of penteliJunctions(bake.map)){
  const side=sideLines.get(junction.road);if(!side||side.restricted||!ways.get(junction.roadId)?.nodes.some(n=>mainNodes.has(n)))continue;
  const station=Math.max(0,Math.min(points.length-1,Math.round(junction.s/2))),a=points[station],b=side.points.reduce((best,p)=>Math.hypot(p[0]-a[0],p[2]-a[2])<Math.hypot(best[0]-a[0],best[2]-a[2])?p:best),length=Math.hypot(b[0]-a[0],b[2]-a[2]);
  if(length>20)throw Error('Source junction exceeds existing paved mouth: '+junction.roadId);
  lines.push({id:'junction-'+junction.roadId,points:[a,b],oneway:side.oneway,width:Math.min(6.8,side.width),speed:30});report.junctions.push({roadId:junction.roadId,station:station*2,length});
 }
 try{
  await bakeExistingTiles(bake,out,{transform,revision,projection:REGION_PROJECTION,elevation:config.elevation,authoredContacts:true,renderRoads:false,terrainSurface:'penteliMountain',beforeWrite:checkDisk,
   manifest:{developmentOnly:true,releaseReady:false,regionId:'penteli',regionalAssets:[regionalTerrain],get regionResidentBytes(){return regionalTerrain.residentBytes;},externalPortals:[],sourceHashes:config.sourceHashes,access:config.access,migration:{partial:false,source:'penteli',reprojected:true}},
   async populate({get,tiles}){
    report.graph=addRoadGraph(lines,get,transform);
    report.networkTriangles=addAuthoredMeshes(bake.roadsGroup,get,transform,{surface:'penteliNetwork'});
    report.roadTriangles=addAuthoredMeshes(scenery.road.group,get,transform,{surface:'penteliRoad',contacts:true,bridges});
    report.propTriangles=addAuthoredMeshes(props,get,transform,{detail:true});
    for(const obstacle of [...signs.obstacles,...bins.obstacles]){const [x,y,z]=transform.position([obstacle.x,height(obstacle.x,obstacle.z),obstacle.z]),yaw=transform.yaw(obstacle.yaw),scale=Math.max(transform.sx,transform.sz),hl=obstacle.hl*scale,hw=obstacle.hw*scale,rx=Math.abs(Math.sin(yaw)*hl)+Math.abs(Math.cos(yaw)*hw),rz=Math.abs(Math.cos(yaw)*hl)+Math.abs(Math.sin(yaw)*hw);
     // Boundary-straddling props have contact ownership on both sides, just
     // like their clipped visible faces; no dependency on a hidden owner cell.
     for(let cx=Math.floor((x-rx)/512);cx<=Math.floor((x+rx)/512);cx++)for(let cz=Math.floor((z-rz)/512);cz<=Math.floor((z+rz)/512);cz++){const tile=get(cx,cz);tile.authoredObstacles??=[];tile.authoredObstacles.push(x-cx*512,y,z-cz*512,yaw,hl,hw,obstacle.kind==='municipal-bin'?1.45:2.7);}
    }
    report.sceneryTriangles=addAuthoredMeshes(scenery.group,get,transform);
    report.bridgeApronTriangles=addBridgeAprons(bake.map,tiles,transform);
    report.rails=addRails(scenery.assets.rails,get,transform);
    report.buildingColliders=addBuildingColliders(bake.map.data.buildings,get,transform,height);
    const details=WorldDetail.prototype.records.call({heightC:height},bake.map).filter(r=>r.kind!=='tree');report.detailRecords=details.length;
    for(const record of details){const [x,y,z]=transform.position([record.x,record.y,record.z]),tile=get(Math.floor(x/512),Math.floor(z/512));tile.authoredDetail??=[];tile.authoredDetail.push({...record,x,y,z,...(record.yaw==null?{}:{yaw:transform.yaw(record.yaw)})});}
    report.mediterraneanScenery=populatePenteliScenery(bake,tiles,transform,cover);
    Object.assign(regionalTerrain,await bakeRegionHorizon(bake,transform,out,scenery.group,cover,tiles));
    report.anchors=proveAnchors(tiles,{buildIndex:buildTileContactIndex,sample:sampleTileContact,Barriers:WorldTileBarriers,buildObstacles:buildTileObstacleIndex,Obstacles:WorldTileObstacles});
    for(const tile of tiles.values()){tile.provenance={region:'penteli',revision};tile.regionalScenery={kind:'penteli',projection:bake.map.data.proj,terrain:regionalTerrain};}
    if(baseline)rejectDuplicateCells({tiles:Object.fromEntries(tiles)},baseline);
   },decorate:decorateAuthored});
 }finally{scenery.dispose();bake.terrainGroup.traverse(o=>o.geometry?.dispose());bake.roadsGroup.traverse(o=>o.geometry?.dispose());}
 const manifestPath=resolve(out,'data/tiles/penteli/world.json'),manifest=JSON.parse(await readFile(manifestPath));
 report.budgets=regionBudgets(manifest);report.coverage={samples:points.length,covered:0,missing:[],maximumHeightError:0};
 const samples=new Map();points.forEach((p,i)=>{const q=transform.position(p),key=`${Math.floor(q[0]/512)},${Math.floor(q[2]/512)}`;if(!samples.has(key))samples.set(key,[]);samples.get(key).push({s:i*2,p:q});});
 const shoulderRows=[],shoulderSamples=new Map();
 for(let s=0;s<=bake.map.route.length;s+=2)for(const side of[-1,1]){const heights=new Float64Array(25).fill(NaN),row={s,side,heights};shoulderRows.push(row);for(let j=0;j<=24;j++){const q=transform.position(bake.map.route.point(s,side*(bake.map.route.edge(s)-.01+j*.25)).toArray()),key=`${Math.floor(q[0]/512)},${Math.floor(q[2]/512)}`;if(!shoulderSamples.has(key))shoulderSamples.set(key,[]);shoulderSamples.get(key).push({row,j,p:q});}}
 report.bridgeCells=[];report.surface=[];const graph=new WorldRoadGraph();
 for(const [key,entry]of Object.entries(manifest.tiles)){
  const bytes=await readFile(resolve(dirname(manifestPath),entry.url)),raw=gunzipSync(bytes),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),tables=tileTables(pack),index=buildTileContactIndex(tables);
  const physical={...tables,coarseHeights:new Float32Array(1089).fill(NaN)};
  for(const {row,j,p}of shoulderSamples.get(key)||[]){const c=sampleTileContact(physical,index,p[0]-pack.metadata.origin[0],p[2]-pack.metadata.origin[2],{referenceY:p[1]});if(c)row.heights[j]=c.y;}
  graph.install(key,pack);
  if(pack.metadata.structures?.length)report.bridgeCells.push({cell:key,bridges:pack.metadata.structures.map(s=>s.bridgeSources).flat(),deckTriangles:tables.contactLayers.filter(l=>l===1).length,...auditBridgeGuards(regionAuditTables(tables),pack.metadata)});
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
 const adjacent=baseline?Object.keys(manifest.tiles).filter(k=>{const[x,z]=k.split(',').map(Number);return [[x-1,z],[x+1,z],[x,z-1],[x,z+1]].some(c=>baseline.tiles[c.join(',')]);}):[];
 report.attachment={baselineWorld:baseline?.world||null,baselineRevision:baseline?.revision||null,baselineDatum:baseline?.elevation?.datum||null,sourceDatum:config.elevation.datum,duplicateCells:baseline?Object.keys(manifest.tiles).filter(k=>baseline.tiles[k]).length:null,adjacentCells:adjacent,externalPortals:manifest.externalPortals,passed:!!baseline&&!!baseline.elevation?.datum&&!adjacent.length&&Array.isArray(baseline.externalPortals)&&!baseline.externalPortals.length};
 report.releaseProofs={bridgeClearance:{passed:bridges.every(b=>report.bridgeCells.some(c=>c.bridges.includes(b.id)&&c.deckTriangles>0))&&report.bridgeCells.every(c=>c.passed),sourceBridges:bridges,cells:report.bridgeCells},towGameplay:{passed:false,reason:'Awaiting streamed vehicle recovery acceptance'}};
 report.passed=report.geometryPassed&&report.attachment.passed&&Object.values(report.releaseProofs).every(p=>p.passed);manifest.acceptance={geometryPassed:report.geometryPassed,attachmentPassed:report.attachment.passed,passed:report.passed};await writeFile(manifestPath,JSON.stringify(manifest));
 await writeFile(resolve(out,'penteli-equivalence.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,geometryPassed:report.geometryPassed,attachment:report.attachment,shoulders:report.shoulders,coverage:{...report.coverage,route:undefined},budgets:report.budgets,surfaceFailures:report.surface.filter(s=>!s.passed),structural:report.structural,contacts:report.contacts},null,2));
 if(!report.passed)throw Error('Penteli region acceptance failed; see penteli-equivalence.json');return {manifestPath,report};
}
function megaraSurface(mesh){
 const key=mesh.material.customProgramCacheKey?.()||'';
 if(key.startsWith('megara-photo-surface-v2-asphalt'))return'megaraAsphalt';
 if(key.startsWith('megara-photo-surface-v2-worn-asphalt'))return'megaraWornAsphalt';
 if(key==='megara-worn-rubber-v1')return'megaraRubber';
 if(key==='circuit-tyre-tread-v1')return'megaraTyre';
 if(key==='megara-chainlink-v1')return'megaraFence';
 return'megaraSolid:'+JSON.stringify({roughness:mesh.material.roughness??.92,metalness:mesh.material.metalness??0,side:mesh.material.side,transparent:mesh.material.transparent,opacity:mesh.material.opacity,depthWrite:mesh.material.depthWrite,polygonOffset:mesh.material.polygonOffset,polygonOffsetFactor:mesh.material.polygonOffsetFactor});
}
const megaraVisible=mesh=>mesh.visible!==false&&mesh.count!==0&&!mesh.userData.near&&!mesh.name.startsWith('megara-A8-moving-traffic')&&!mesh.name.startsWith('megara-A8-traffic-glass');
async function importMegaraRegion({root,out,config,revision,baseline}){
 const bake=await generateRegionSource(root,'megara'),map=bake.map,transform=regionTransform(map.data.proj),height=(x,z)=>map.terrain.refinedHeight?.(x,z)??map.terrain.height(x,z),scene=new THREE.Group(),scenery=buildMegaraScenery(scene,map,{heightC:height,assets:{network:bake.network}});
 if(!map.route.closed||map.route.N!==2001||Math.abs(map.route.length-1999.599799)>.001||map.data.sources.osmWay!==config.inclusion.racewayWays[0])throw Error('Megara circuit source identity/length changed');
 const context=JSON.parse(await readFile(resolve(root,'tools/maps/megara/raw/context.json'))),ways=new Map(context.map(w=>[w.id,w]));
 const points=Array.from({length:map.route.N},(_,i)=>map.route.point(i*map.route.step,0).toArray());
 const lines=[{id:'raceway-70043234',name:'Megara Circuit',points,width:11.5,oneway:false,speed:80}];
 for(const road of map.data.roadNetwork?.roads||[]){const evidence=ways.get(road.id),tags=evidence?.tags;if(!tags)throw Error('Missing Megara source access evidence: '+road.id);const access=tags.motorcar??tags.motor_vehicle??tags.vehicle??tags.access;const restricted=access!=null&&!['yes','permissive','designated'].includes(access)||Object.keys(tags).some(k=>k.endsWith(':conditional'));const roadPoints=[];for(let i=0;i<road.p.length;i+=2){const x=road.p[i],z=road.p[i+1];roadPoints.push([x,bake.network.height(x,z),z]);}lines.push({id:`way-${road.id}-${road.part||0}`,name:road.n||'Megara approach',points:roadPoints,width:road.w,oneway:!!road.oneway,restricted,speed:road.v});}
 // The physical timing gantry, stripe and grid belong to the later route job.
 scenery.group.getObjectByName('timing-start')?.removeFromParent();
 const report={schemaVersion:1,region:'megara',revision,sourceHashes:config.sourceHashes,inclusion:config.inclusion,projection:REGION_PROJECTION,elevation:config.elevation,sourceLength:map.route.length,sourceSamples:map.route.N,sceneParity:{tyreStacks:scenery.group.userData.tyreWalls?.length||0,barrierObstacles:scenery.obstacles.length,kerbRuns:map.route.kerbs.length,pavedAreas:map.data.circuit.pavedAreas.length,buildings:map.data.buildings.length}};
 const regionalTerrain=await bakeRegionHorizon(bake,transform,out,scenery.group,'megara');report.regionalTerrain=regionalTerrain;
 try{
  await bakeExistingTiles(bake,out,{transform,revision,projection:REGION_PROJECTION,elevation:config.elevation,authoredContacts:true,renderRoads:false,sourceRoads:false,terrainSurface:'megaraTerrain',beforeWrite:checkDisk,
   manifest:{developmentOnly:true,releaseReady:false,regionId:'megara',regionalAssets:[regionalTerrain],regionResidentBytes:regionalTerrain.residentBytes,externalPortals:[],sourceHashes:config.sourceHashes,access:'circuit',migration:{partial:false,source:'megara',reprojected:true}},
   populate({get,tiles}){
    report.graph=addRoadGraph(lines,get,transform,'megara');
    report.networkTriangles=addAuthoredMeshes(bake.roadsGroup,get,transform,{surface:'megaraNetwork',contacts:true,contactSurface:true,maxContactGrade:Math.tan(Math.PI/6),include:megaraVisible});
    report.kerbSeamConformance={vertices:0,maxAdjustment:0};const road=scenery.road.group;report.roadTriangles=addAuthoredMeshes(road,get,transform,{surface:megaraSurface,contacts:true,contactSurface:true,maxContactGrade:Math.tan(Math.PI/6),include:megaraVisible,contactY:(v,surface)=>{if(!surface.startsWith('megaraSolid:'))return v[1];const lx=v[0]-Math.floor(v[0]/512)*512,lz=v[2]-Math.floor(v[2]/512)*512,d=Math.min(lx,512-lx,lz,512-lz);if(d>=1)return v[1];const q=transform.inverse(v),onRoad=map.route.project(q[0],q[2]),base=map.route.point(onRoad.s,onRoad.u).y+.045,y=Math.min(v[1],base+.018+.027*d);if(y<v[1]-.00001){report.kerbSeamConformance.vertices++;report.kerbSeamConformance.maxAdjustment=Math.max(report.kerbSeamConformance.maxAdjustment,v[1]-y);}return y;}});road.removeFromParent();
    const asphalt=m=>['megaraAsphalt','megaraWornAsphalt'].includes(megaraSurface(m));
    // Legacy paddock polygons are visual overlays; several lie 65 cm below
    // their terrain contact and must not become new drivable floors.
    report.apronTriangles=addAuthoredMeshes(scenery.group,get,transform,{surface:megaraSurface,include:m=>megaraVisible(m)&&asphalt(m)});
    report.sceneryTriangles=addAuthoredMeshes(scenery.group,get,transform,{surface:megaraSurface,include:m=>megaraVisible(m)&&!asphalt(m)});
    report.barriers=addBarrierObstacles(scenery.obstacles,get,transform,height);
    report.buildingColliders=addBuildingColliders(map.data.buildings,get,transform,height);
    report.anchors=proveAnchors(tiles,{buildIndex:buildTileContactIndex,sample:sampleTileContact,Barriers:WorldTileBarriers,buildObstacles:buildTileObstacleIndex,Obstacles:WorldTileObstacles});
    for(const tile of tiles.values()){tile.provenance={region:'megara',revision};tile.regionalScenery={kind:'megara',projection:map.data.proj,terrain:regionalTerrain};}
    if(baseline)rejectDuplicateCells({tiles:Object.fromEntries(tiles)},baseline);
   },decorate:decorateAuthored});
 }finally{scene.traverse(o=>o.geometry?.dispose());bake.terrainGroup.traverse(o=>o.geometry?.dispose());bake.roadsGroup.traverse(o=>o.geometry?.dispose());}
 const manifestPath=resolve(out,'data/tiles/megara/world.json'),manifest=JSON.parse(await readFile(manifestPath));report.budgets=regionBudgets(manifest);
 report.coverage={samples:points.length,covered:0,missing:[],maximumHeightError:0,cells:[],route:points.map(p=>transform.position(p))};
 const samples=new Map();report.coverage.route.forEach((p,i)=>{const key=`${Math.floor(p[0]/512)},${Math.floor(p[2]/512)}`;if(!samples.has(key))samples.set(key,[]);samples.get(key).push({station:i*map.route.step,p});});report.coverage.cells=[...samples.keys()];
 const shoulderRows=[],shoulderSamples=new Map();for(let i=0;i<map.route.N;i++){const s=i*map.route.step;for(const side of[-1,1]){const row={station:s,side,heights:new Float64Array(25).fill(NaN)};shoulderRows.push(row);for(let j=0;j<25;j++){const q=transform.position(map.route.point(s,side*(map.route.edge(s)-.01+j*.25)).toArray()),key=`${Math.floor(q[0]/512)},${Math.floor(q[2]/512)}`;if(!shoulderSamples.has(key))shoulderSamples.set(key,[]);shoulderSamples.get(key).push({row,j,p:q});}}}
 report.surface=[];for(const[key,entry]of Object.entries(manifest.tiles)){const bytes=await readFile(resolve(dirname(manifestPath),entry.url)),raw=gunzipSync(bytes),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),tables=tileTables(pack),index=buildTileContactIndex(tables);
  report.surface.push({cell:key,...auditWorldSurface(regionAuditTables(tables),pack.metadata)});
  const physical={...tables,coarseHeights:new Float32Array(1089).fill(NaN)};for(const{row,j,p}of shoulderSamples.get(key)||[]){const hit=sampleTileContact(physical,index,p[0]-pack.metadata.origin[0],p[2]-pack.metadata.origin[2],{referenceY:p[1]});if(hit)row.heights[j]=hit.y;}
  for(const{station,p}of samples.get(key)||[]){const hit=sampleTileContact(tables,index,p[0]-pack.metadata.origin[0],p[2]-pack.metadata.origin[2],{referenceY:p[1],requiredFlags:1});if(!hit||Math.abs(hit.y-p[1])>.15)report.coverage.missing.push({station,p,hit});else report.coverage.covered++;if(hit)report.coverage.maximumHeightError=Math.max(report.coverage.maximumHeightError,Math.abs(hit.y-p[1]));}
 }
 report.shoulders={samples:shoulderRows.length*25,missing:0,maxStep:0,worst:null};for(const row of shoulderRows)for(let j=0;j<25;j++){if(!Number.isFinite(row.heights[j])){report.shoulders.missing++;continue;}if(j&&Number.isFinite(row.heights[j-1])){const step=Math.abs(row.heights[j]-row.heights[j-1]);if(step>report.shoulders.maxStep){report.shoulders.maxStep=step;report.shoulders.worst={station:row.station,side:row.side,offset:j*.25,from:row.heights[j-1],to:row.heights[j]};}}}report.shoulders.passed=!report.shoulders.missing&&report.shoulders.maxStep<=.15;
 try{report.structural=await validateDirectory(manifestPath);}catch(error){report.structural={error:error.message};}
 try{report.contacts=await validateDirectoryContacts(manifestPath);}catch(error){report.contacts={error:error.message};}
 const adjacent=baseline?Object.keys(manifest.tiles).filter(k=>{const[x,z]=k.split(',').map(Number);return[[x-1,z],[x+1,z],[x,z-1],[x,z+1]].some(c=>baseline.tiles[c.join(',')]);}):[];
 report.attachment={baselineWorld:baseline?.world||null,baselineRevision:baseline?.revision||null,sourceDatum:config.elevation.datum,duplicateCells:baseline?Object.keys(manifest.tiles).filter(k=>baseline.tiles[k]).length:null,adjacentCells:adjacent,externalPortals:manifest.externalPortals,passed:!!baseline&&!!(baseline.elevation?.datum||baseline.elevation?.perRegion)&&!adjacent.length&&Array.isArray(baseline.regions)&&baseline.regions.every(r=>Array.isArray(r.externalPortals)&&!r.externalPortals.length)&&Array.isArray(manifest.externalPortals)&&!manifest.externalPortals.length};
 report.releaseProofs={bridgeClearance:{passed:true,sourceBridges:[],underpassCrossings:0,reason:'No bridge or lower-road crossing in the Megara source envelope'},towGameplay:{passed:false,reason:'Awaiting streamed vehicle recovery acceptance'}};
 report.geometryPassed=report.coverage.covered===points.length&&report.shoulders.passed&&report.surface.every(s=>s.passed)&&report.anchors.accepted>0&&report.graph.maxGrade<=.45&&report.budgets.passed&&!report.structural.error&&!report.contacts.error&&!report.contacts.failures?.length&&!report.contacts.missing;
 report.passed=report.geometryPassed&&report.attachment.passed&&Object.values(report.releaseProofs).every(p=>p.passed);manifest.acceptance={geometryPassed:report.geometryPassed,attachmentPassed:report.attachment.passed,passed:report.passed};await writeFile(manifestPath,JSON.stringify(manifest));await writeFile(resolve(out,'megara-equivalence.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({geometryPassed:report.geometryPassed,attachment:report.attachment,coverage:{...report.coverage,route:undefined},shoulders:report.shoulders,budgets:report.budgets,surfaceFailures:report.surface.filter(s=>!s.passed),structural:report.structural,contacts:report.contacts},null,2));
 if(!report.geometryPassed||!report.attachment.passed)throw Error('Megara region acceptance failed; see megara-equivalence.json');return{manifestPath,report};
}
export function regionBudgets(manifest){let worst=0,worstCell;for(const key of Object.keys(manifest.tiles)){const[x,z]=key.split(',').map(Number);for(const dx of[-1,0])for(const dz of[-1,0]){let sum=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const e=manifest.tiles[`${x+dx+a},${z+dz+b}`];sum+=e?.residentBytes??e?.decodedBytes??0;}if(sum>worst){worst=sum;worstCell=[x+dx,z+dz];}}}const bytes=Object.values(manifest.tiles).reduce((n,e)=>n+e.bytes,0)+(manifest.regionalAssets||[]).reduce((n,a)=>n+a.bytes,0);worst+=manifest.regionResidentBytes||0;return{cells:Object.keys(manifest.tiles).length,bytes,sharedRegionBytes:manifest.regionResidentBytes||0,worst2x2Bytes:worst,worstCell,headroomBytes:64*1024**2-worst,passed:worst<=60*1024**2&&bytes<=2*1024**3};}
if(process.argv[1]===import.meta.filename){const [out,baselinePath]=process.argv.slice(2);
 if(out==='--lock-sources'){const id=baselinePath||'penteli',root=resolve(import.meta.dirname,'..'),path=resolve(root,`tools/world-gen/regions/${id}.json`),config=JSON.parse(await readFile(path));config.sourceHashes={};for(const file of await regionSourceFiles(root,id))config.sourceHashes[file]=hash(await readFile(resolve(root,file)));await writeFile(path,JSON.stringify(config,null,2)+'\n');console.log('Locked '+Object.keys(config.sourceHashes).length+' importer sources; review the lock diff before baking.');}
 else{const args=process.argv.slice(2),id=args[0]==='--region'?args[1]:'penteli',offset=id==='penteli'?0:2;await importTrackRegion({out:args[offset],baselinePath:args[offset+1],configPath:resolve(import.meta.dirname,`world-gen/regions/${id}.json`)});}
}
