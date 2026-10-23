// Strict offline building-table repair primitive. Never fetches, publishes, or writes cells.
// A caller must pin an independently reviewed plan, then feed spool to ordinary packTiles.
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../../src/baked-geometry.js';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tileTables,validateWorldTile} from '../../src/world-tile-format.js';
import {parkedBoxes} from '../../src/world-tile-parking.js';
import {buildTileObstacleIndex} from '../../src/world-tile-obstacles.js';
import {coastalRecipe} from '../../src/world-tile-coast.js';
import {psychikoInfillBlocked} from '../../src/world-tile-psychiko.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export const repairPlanSha256 = plan => hash(JSON.stringify(canonical(plan)));
const arrayHash = a => hash(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
export const packFingerprint = pack => repairPlanSha256({metadata:pack.metadata,arrays:pack.arrays.map(a=>[a.constructor.name,a.length,arrayHash(a)])});
const fail = text => { throw Error('Infill repair: '+text); };
const same = (a,b,label) => { if(JSON.stringify(canonical(a))!==JSON.stringify(canonical(b)))fail(label); };
const gen = /^building:gen:-?\d+:-?\d+:-?\d+:\d+:\d+:0$/;
function rowOf(pack,row){
 const t=tileTables(pack),[id,first,n,material]=t.buildings.slice(row*4,row*4+4);
 return {id:pack.metadata.ids[id],row,material,base:t.buildingHeights[row*2],height:t.buildingHeights[row*2+1],corners:Array.from(t.buildingCorners.slice(first*2,(first+n)*2))};
}
export function decodePinnedSourceCell(bytes,entry,identity){
 if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)fail('compressed source cell hash/size mismatch');
 const raw=gunzipSync(bytes),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
 validateWorldTile(pack,identity);
 return pack;
}
export const buildingRowSha256 = (pack,row) => repairPlanSha256(rowOf(pack,row));
export async function repairCodeProof(){
 const files=['infill.py','model.py','buildings.py','repair-infill.mjs','../../src/psychiko-building-data.js','../../src/coastal-dressing-data.js'];
 return Object.fromEntries(await Promise.all(files.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
}
function validateScope(pack){
 validateWorldTile(pack);
 const m=pack.metadata,flag=m.extensions?.derivedBuildings;
 if(flag?.version!==1||flag.derived)fail('requires unprepared derived-building wire tables');
 if(m.meshes.some(mesh=>mesh.userData?.tileSurface==='building'))fail('stored building mesh ownership is unsupported');
 if(m.authoredObstacles||m.psychikoShells||m.extensions?.worldDetail?.penteli||coastalRecipe(m.cell))fail('authored/coastal recipe cell is protected');
 const wd=m.extensions?.worldDetail;
 // Runtime-generated objects must be regenerated, never supplied as stale wire rows.
 for(const key of ['parking','streetTrees','rooftops','streetPlates','shopSites','wallSites','roadMarks'])if(wd?.[key]!=null)fail('prepared dressing rows are unsupported: '+key);
 const n=tileTables(pack).buildings.length/4;
 for(const [key,index] of Object.entries(wd?.buildings||{})){
  if(!['facadeStyle','detailSeed','roofShape'].includes(key)||!Number.isInteger(index)||pack.arrays[index]?.length!==n)fail('unknown/misaligned building extension '+key);
 }
}
const projectedBounds = ([w,s,e,n]) => [(w-23.73)*87745.27512677578,-(n-37.98)*111320,(e-23.73)*87745.27512677578,-(s-37.98)*111320];
/** Build a plan from an exact source extract. This is read-only; the plan remains subject to review. */
export async function makeInfillRepairPlan(pack,{sourcePath,expectedSourceSha256,sourceCellSha256,ids,python=process.env.WORLD_GEN_PYTHON||'python3'}){
 validateScope(pack);
 if(!/^[a-f0-9]{64}$/.test(sourceCellSha256))fail('compressed source cell identity required');
 const source=await readFile(sourcePath),recordPath=sourcePath.replace(/\.(osm|pbf)$/i,'.source.json');
 if(recordPath===sourcePath)fail('expected bounded .osm/.pbf source');
 const recordBytes=await readFile(recordPath),record=JSON.parse(recordBytes);
 if(hash(source)!==expectedSourceSha256||record.sha256!==expectedSourceSha256)fail('snapshot/source record hash mismatch');
 if(!Array.isArray(record.bounds)||record.bounds.length!==4||!record.bounds.every(Number.isFinite)||!Array.isArray(record.missingWayNodes)||record.missingWayNodes.length||record.bounds[0]>=record.bounds[2]||record.bounds[1]>=record.bounds[3])fail('source bounds/way closure');
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('unique explicit generated IDs required');
 const t=tileTables(pack),rows=[];
 for(const id of ids){
  if(!gen.test(id))fail('only whole generated lot IDs are supported: '+id);
  const hits=Array.from({length:t.buildings.length/4},(_,i)=>i).filter(i=>pack.metadata.ids[t.buildings[i*4]]===id);
  if(hits.length!==1)fail('generated ID missing/duplicated: '+id);
  const v=rowOf(pack,hits[0]),o=pack.metadata.origin;
  const ring=Array.from({length:v.corners.length/2},(_,i)=>[v.corners[i*2]+o[0],v.corners[i*2+1]+o[2]]);
  if(psychikoInfillBlocked(ring))fail('authored Psychiko footprint/garden is protected');
  rows.push({...v,ring,rowSha256:buildingRowSha256(pack,v.row)});
 }
 // The Python side independently evaluates source evidence using the exact current policy.
 const script=`import sys,json,osmium
from shapely.geometry import Polygon,box
sys.path.insert(0,sys.argv[1])
from infill import SourceContext,CONTEXT_M,green_tags
request=json.load(sys.stdin)
unresolved=set(request['unresolvedRelations']);expected=set()
def relevant(tags):
 return tags.get('building') not in (None,'no') or green_tags(tags)
class SourceAudit(osmium.SimpleHandler):
 def way(self,way):
  if relevant(dict(way.tags)):
   if not way.is_closed():raise ValueError('Unclosed source area '+str(way.id))
   expected.add('w'+str(way.id))
 def relation(self,relation):
  if relevant(dict(relation.tags)):
   # Every relevant relation must yield geometry, even when the provenance
   # record omits unresolved-member hints or all members exist but are empty.
   expected.add('r'+str(relation.id))
   if str(relation.id) in unresolved:
    raise ValueError('Incomplete relevant source relation '+str(relation.id))
SourceAudit().apply_file(sys.argv[2])
class StrictContext(SourceContext):
 def __init__(self,rows):
  rows=list(rows)
  if any(g.is_empty or not g.is_valid or g.geom_type not in ('Polygon','MultiPolygon') for _,g,_ in rows):
   raise ValueError('Invalid source context geometry')
  if expected.difference(i for i,_,_ in rows):raise ValueError('Unassembled relevant source areas')
  super().__init__(rows)
c=StrictContext.from_osm(sys.argv[2]);bounds=box(*request['bounds']);result=[]
for row in request['rows']:
 p=Polygon(row['ring'])
 if not bounds.covers(p.centroid.buffer(CONTEXT_M)):raise ValueError('Source does not cover full candidate context')
 decision=c.decision(p)
 if decision['eligible']:raise ValueError('Source supports keeping generated lot '+row['id'])
 result.append(dict(id=row['id'],row=row['row'],rowSha256=row['rowSha256'],decision=decision))
print(json.dumps(result))`;
 const result=spawnSync(python,['-c',script,fileURLToPath(new URL('.',import.meta.url)),sourcePath],{input:JSON.stringify({rows,bounds:projectedBounds(record.bounds),unresolvedRelations:[...new Set((record.unresolvedRelationMembers||[]).map(r=>String(r.relation)))]}),encoding:'utf8',maxBuffer:2*1024*1024,timeout:30000,env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 if(result.status!==0)fail('source policy evaluation failed: '+(result.error?.message||result.stderr));
 const remove=JSON.parse(result.stdout);
 return {schema:1,operation:'remove-unsupported-generated-buildings',world:pack.metadata.world,revision:pack.metadata.revision,cell:pack.metadata.cell,packSha256:packFingerprint(pack),sourceCellSha256,sourceSha256:expectedSourceSha256,sourceRecordSha256:hash(recordBytes),code:await repairCodeProof(),remove};
}
/** Pure mutation: callers must pin the reviewed plan digest AND source/code proof. */
export function repairBuildingTables(pack,plan,expected){
 validateScope(pack);
 if(!expected?.planSha256||repairPlanSha256(plan)!==expected.planSha256)fail('reviewed plan digest mismatch');
 if(plan.schema!==1||plan.operation!=='remove-unsupported-generated-buildings')fail('unsupported plan');
 same(plan.code,expected.code,'policy/recipe code identity mismatch');
 if(!/^[a-f0-9]{64}$/.test(plan.sourceCellSha256)||plan.sourceCellSha256!==expected.sourceCellSha256)fail('compressed cell identity mismatch');
 if(!/^[a-f0-9]{64}$/.test(plan.sourceRecordSha256))fail('source record identity required');
 if(!/^[a-f0-9]{64}$/.test(plan.sourceSha256)||plan.sourceSha256!==expected.sourceSha256||plan.sourceRecordSha256!==expected.sourceRecordSha256)fail('source identity mismatch');
 if(plan.packSha256!==packFingerprint(pack))fail('full input cell identity mismatch');
 same([plan.world,plan.revision,plan.cell],[pack.metadata.world,pack.metadata.revision,pack.metadata.cell],'world/revision/cell mismatch');
 if(!Array.isArray(plan.remove)||!plan.remove.length)fail('empty removal plan');
 const removed=new Set(),t=tileTables(pack),oldRows=t.buildings.length/4;
 for(const change of plan.remove){
  if(!gen.test(change.id)||!Number.isInteger(change.row)||change.row<0||change.row>=oldRows||removed.has(change.row))fail('unsupported/duplicate generated row');
  const row=rowOf(pack,change.row),o=pack.metadata.origin,ring=Array.from({length:row.corners.length/2},(_,i)=>[row.corners[i*2]+o[0],row.corners[i*2+1]+o[2]]);
  if(row.id!==change.id||buildingRowSha256(pack,change.row)!==change.rowSha256)fail('building row identity mismatch');
  if(psychikoInfillBlocked(ring))fail('authored Psychiko footprint/garden is protected');
  if(change.decision?.eligible!==false||change.decision.inferred!==true||!['source-sparse','source-low-rise','mapped-green'].includes(change.decision.reason))fail('unsupported source decision');
  removed.add(change.row);
 }
 const output={metadata:structuredClone(pack.metadata),arrays:pack.arrays.slice()},m=output.metadata;
 const append=a=>{output.arrays.push(a);return output.arrays.length-1;};
 const buildings=[],corners=[],heights=[],retained=[],rowMap=[];
 for(let row=0;row<oldRows;row++){
  if(removed.has(row)){rowMap.push(-1);continue;}
  rowMap.push(retained.length);retained.push(row);
  const first=t.buildings[row*4+1],n=t.buildings[row*4+2];
  buildings.push(t.buildings[row*4],corners.length/2,n,t.buildings[row*4+3]);
  corners.push(...t.buildingCorners.slice(first*2,(first+n)*2));heights.push(...t.buildingHeights.slice(row*2,row*2+2));
 }
 for(const [key,array] of Object.entries({buildings:new Uint32Array(buildings),buildingCorners:new Float32Array(corners),buildingHeights:new Float32Array(heights)}))m.tables[key]=append(array);
 for(const [key,index] of Object.entries(m.extensions?.worldDetail?.buildings||{})){
  const original=pack.arrays[index];m.extensions.worldDetail.buildings[key]=append(original.constructor.from(retained.map(row=>original[row])));
 }
 m.budgets.triangles-=plan.remove.reduce((sum,c)=>sum+3*t.buildings[c.row*4+2]-2,0);
 m.budgets.buildingTriangles=retained.reduce((max,row)=>Math.max(max,3*t.buildings[row*4+2]-2),0);
 validateWorldTile(output);
 const after=tileTables(output);
 // Every unrelated table and original array remains byte-exact (new buffers append,
 // protecting aliases used by road meshes and contact positions). The packer counts
 // retained old wire buffers as well as new ones; no hand-written size estimates.
 for(const [key,array]of Object.entries(t))if(!['buildings','buildingCorners','buildingHeights'].includes(key)&&arrayHash(array)!==arrayHash(after[key]))fail('unrelated table changed '+key);
 for(let i=0;i<pack.arrays.length;i++)if(arrayHash(pack.arrays[i])!==arrayHash(output.arrays[i]))fail('original array changed');
 for(let row=0;row<retained.length;row++){
  const old=rowOf(pack,retained[row]),next=rowOf(output,row);delete old.row;delete next.row;same(old,next,'retained mapped/building wall changed');
 }
 const index=buildTileObstacleIndex(after),expectedSegments=retained.reduce((sum,row)=>sum+t.buildings[row*4+2],0);
 if(index.segments.length!==expectedSegments*6||index.refs.some(ref=>ref>=expectedSegments)||index.offsets.at(-1)!==index.refs.length)fail('physical collider CSR mismatch');
 return {pack:output,audit:{sourceSha256:plan.sourceSha256,planSha256:expected.planSha256,sourcePackSha256:plan.packSha256,outputPackSha256:packFingerprint(output),removed:plan.remove.map(c=>c.id),rowMap,retained:retained.length,buildingWallSegments:expectedSegments,protectedTablesByteExact:true,retainedWallsByteExact:true,physicalIndexRebuilt:true,gameProof:false,packed:false}};
}
export function repairedSpool(pack){
 return {metadata:pack.metadata,arrays:pack.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(pack)).map(([key,a])=>[key,Array.from(a)])),dependencies:[]};
}

/** Disk-source wrapper for the pure primitive. Review must supply the plan digest explicitly. */
export async function applyReviewedInfillRepair(pack,plan,{reviewedPlanSha256,sourcePath,sourceCellSha256}){
 const source=await readFile(sourcePath),record=await readFile(sourcePath.replace(/\.(osm|pbf)$/i,'.source.json'));
 return repairBuildingTables(pack,plan,{planSha256:reviewedPlanSha256,sourceSha256:hash(source),sourceRecordSha256:hash(record),sourceCellSha256,code:await repairCodeProof()});
}

/** Run in ordinary packTiles.onTile, after real dressing/parking and byte accounting.
 * This verifies visibility/collision identity, not traffic-driving or game proof.
 */
export function auditRepairedPacket(repaired,packet,removedIds){
 const wire=tileTables(repaired),active=tileTables(packet);
 for(const [key,array]of Object.entries(wire))if(arrayHash(array)!==arrayHash(active[key]))fail('packet authoritative table changed '+key);
 const activeIds=new Set(Array.from({length:active.buildings.length/4},(_,row)=>packet.metadata.ids[active.buildings[row*4]]));
 if(removedIds.some(id=>activeIds.has(id)))fail('removed generated body reappeared');
 if(packet.detailObstacleIndex?.segments?.length)fail('unsupported extra detail collision ownership');
 const parkingIndex=packet.metadata.extensions?.worldDetail?.parking;
 const parking=parkingIndex==null?new Float32Array():packet.arrays[parkingIndex];
 if(parking.length%5||!parking.every(Number.isFinite))fail('parking row shape');
 const boxes=parkedBoxes(parking),expected=buildTileObstacleIndex(active,boxes);
 for(const[key,array]of Object.entries(expected))if(!packet.obstacleIndex?.[key]||arrayHash(array)!==arrayHash(packet.obstacleIndex[key]))fail('packet collider/visible parking identity '+key);
 return {removedIdsAbsent:true,authoritativeTablesByteExact:true,colliderMatchesVisibleBuildingsAndParking:true,parkedBodies:boxes.length/7,wallSegments:expected.segments.length/6,trafficClearanceTested:false,gameProof:false};
}
