import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {gzipSync,gunzipSync} from 'node:zlib';
import {TILE_TABLES,tileTables} from '../../src/world-tile-format.js';
import {encodeTile,packTiles} from './pack.mjs';
import {repairCodeProof,repairPlanSha256,packFingerprint,buildingRowSha256,repairedSpool} from './repair-infill.mjs';
import {mutateOriginalCell,mutationCodeProof,mutationRecipeSha256,snapshotSceneryInvariants,assertSceneryInvariance} from './mutate-cell.mjs';
const code=await mutationCodeProof(),infillCode=await repairCodeProof();
const hash=b=>createHash('sha256').update(b).digest('hex'),bytes=j=>Buffer.from(JSON.stringify(j));
const bridge=JSON.parse(await readFile(new URL('./fixtures/bridge-guards.json',import.meta.url)));
function fixture({world='athens-east-development',guards=false,road=false,cell=[0,0]}={}){
 const tables=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));
 tables.coarseHeights=Array(1089).fill(30);tables.finePositions=[0,30,0,512,30,0,0,30,512,512,30,512];tables.fineTriangles=[0,2,1,1,2,3];tables.contactPositions=[...tables.finePositions];tables.fineSurface=[1,1];tables.fineFlags=[road?1:0,road?1:0];
 tables.buildings=[2,0,4,0,3,4,4,0];tables.buildingCorners=[100,100,100,110,110,110,110,100,300,300,300,310,310,310,310,300];tables.buildingHeights=[30,19.2,30,9.6];
 const arrays=[{type:'Uint8Array',data:[1,2]},{type:'Uint32Array',data:[10,20]},{type:'Uint8Array',data:[1,2]},{type:'Float32Array',data:[]},{type:'Uint8Array',data:[]},{type:'Uint32Array',data:[]}],meshes=[];
 if(guards)for(const [i,part]of [bridge.fascia,bridge.guard].entries()){const p=arrays.push({type:'Float32Array',data:part[0]})-1,index=arrays.push({type:'Uint16Array',data:part[1]})-1;meshes.push({name:'guard',material:i?15:12,attributes:{position:{array:p,itemSize:3,normalized:false}},index,layers:1,userData:{bridgeGuard:true,worldSurface:false},drawRange:{start:0,count:part[1].length}});}
 const metadata={tileVersion:1,world,revision:'original',cell,origin:[cell[0]*512,0,cell[1]*512],ids:['','terrain:fixture','building:gen:1:2:3:4:5:0','building:w123:0'],strings:[''],palette:Array.from({length:16},()=>[1,1,1]),meshes,terrain:{coarseSize:33,spacing:16},budgets:{triangles:20+meshes.reduce((n,m)=>n+m.drawRange.count/3,0),buildingTriangles:10},structures:guards?[{id:'w1:0',kind:'osm-bridge-guarded',layer:1,shoulderMetres:.25,bridgeSources:['w1:0'],roads:['w1:0']}]:[],rails:guards?bridge.rails:[],extensions:{derivedBuildings:{version:1},worldDetail:{version:1,buildings:{facadeStyle:0,detailSeed:1,roofShape:2},vegetation:{positionHeight:3,kind:4,seed:5}}}};
 const encoded=encodeTile({metadata,arrays,tables}),entry={url:'./original.gz',sha256:hash(encoded.bytes),bytes:encoded.bytes.length,decodedBytes:4*1024**2,residentBytes:4*1024**2,transientBytes:8*1024**2,triangles:metadata.budgets.triangles,dependencies:['7,7'],source:{regionId:world==='penteli'?'penteli':'basin',world,revision:metadata.revision}};
 return {encoded,compressedBytes:encoded.bytes,entry,source:{world,revision:metadata.revision,cell}};
}
function scope(s,count=1){const cells=Array.from({length:count},(_,i)=>({cell:[s.source.cell[0]+i,s.source.cell[1]],source:s.entry.source,sha256:s.entry.sha256})),b=bytes({schema:'cell-mutation-scope-1',sourceManifestSha256:'a'.repeat(64),cells});return {bytes:b,sha256:hash(b)};}
function args(s=fixture(),stages={guards:{codeSha256:code.guards,recipes:[]},paint:{codeSha256:code.paint}}){const a={compressedBytes:s.compressedBytes,entry:s.entry,source:s.source,derived:{world:'assembled',revision:'new',assemblerSha256:code.assembler,codeProofSha256:repairPlanSha256(code)},stages,releaseScope:scope(s)};return pin(a);}
function pin(a){a.derived.recipeSha256=mutationRecipeSha256(a);return a;}
function guardStage(){const compiled=bytes({...bridge.recipe,sourceWorld:'athens-east-development'}),source=Buffer.from(bridge.sourcePlanBytes);return {codeSha256:code.guards,recipes:[{compiledBytes:compiled,compiledSha256:hash(compiled),sourcePlanBytes:source,sourcePlanSha256:hash(source)}]};}
function sceneryStage(){const b=bytes({clearanceEvidenceReady:true,exclusionErrors:{},exclusions:[],areas:[],points:[{id:'n1',source:'n1',inference:'mapped-tree-node',x:40,z:40,kind:0,seed:999,tags:{}}]});return {codeSha256:code.scenery,bytes:b,sha256:hash(b)};}
async function withTemp(fn){const dir=await mkdtemp(join(tmpdir(),'mutate-cell-'));try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
async function packed(m,dir,edit=null){let seen;await packTiles(Readable.from([JSON.stringify(m.spool)+'\n']),dir,{onTile:r=>{seen=r;if(edit)edit(r);m.assertPacked(r);}});return seen;}
async function infillStage(s,dir){const sourcePath=join(dir,'source.osm'),source=Buffer.from('<osm version="0.6"></osm>'),record=bytes({sha256:hash(source),bounds:[23.72,37.97,23.74,37.99],missingWayNodes:[]});await writeFile(sourcePath,source);await writeFile(join(dir,'source.source.json'),record);const p=s.encoded.decoded,plan={schema:1,operation:'remove-unsupported-generated-buildings',...s.source,packSha256:packFingerprint(p),sourceCellSha256:s.entry.sha256,sourceSha256:hash(source),sourceRecordSha256:hash(record),code:infillCode,remove:[{row:0,id:p.metadata.ids[2],rowSha256:buildingRowSha256(p,0),decision:{eligible:false,inferred:true,reason:'source-sparse'}}]},b=bytes(plan);return {codeSha256:code.infill,planBytes:b,planFileSha256:hash(b),reviewedPlanSha256:repairPlanSha256(plan),sourcePath};}

test('preserves unchanged original source byte/entry identity without derived stamp or spool',async()=>{const s=fixture(),a=args(s,{}),r=await mutateOriginalCell(a);assert.equal(r.kind,'preserved');assert.deepEqual(r.compressedBytes,s.compressedBytes);assert.deepEqual(r.entry,s.entry);assert.equal(r.spool,undefined);assert.equal(r.assertPacked,undefined);});

test('authenticates compressed size/SHA, entry source and original packet identity before mutation',async()=>{
 for(const change of [a=>a.entry={...a.entry,sha256:'0'.repeat(64)},a=>a.entry={...a.entry,bytes:a.entry.bytes+1},a=>a.entry={...a.entry,source:{...a.entry.source,world:'other'}},a=>a.entry={...a.entry,source:null},a=>a.source={...a.source,cell:[1,0]},a=>a.source={...a.source,revision:'already-derived'},a=>a.entry={...a.entry,triangles:a.entry.triangles+1}]){const a=args();change(a);await assert.rejects(mutateOriginalCell(a),/original|source|scope|triangle/);}
});

test('bounded original envelope rejects malformed format, offsets, views and decompression budget',async()=>{
 for(const corrupt of [b=>b.writeUInt32LE(0,0),b=>b.writeUInt32LE(b.length+1,4),b=>b.writeUInt32LE(0,8)]){const s=fixture(),raw=Buffer.from(gunzipSync(s.compressedBytes));corrupt(raw);s.compressedBytes=gzipSync(raw);s.entry={...s.entry,sha256:hash(s.compressedBytes),bytes:s.compressedBytes.length};await assert.rejects(mutateOriginalCell(args(s)),/header|format/);}
 const a=args();a.entry={...a.entry,decodedBytes:13};await assert.rejects(mutateOriginalCell(a),/larger|output|length|buffer|size|decode/i);
 const b=args();b.entry={...b.entry,decodedBytes:64*1024**2+1};await assert.rejects(mutateOriginalCell(b),/decode budget/);
});

test('ordinary single-cell packing binds expected encoded bytes despite prepareTilePacket mutating decoded',async()=>withTemp(async dir=>{
 const a=args(),r=await mutateOriginalCell(a);assert.equal(r.kind,'mutated');assert.ok(Object.isFrozen(r.spool.metadata.cellMutation));assert.deepEqual(r.spool.dependencies,['7,7']);
 const wire=r.spool.metadata.meshes.length,packedResult=await packed(r,join(dir,'out'));assert.ok(packedResult.decoded.metadata.meshes.length>wire,'actual packer has dressed decoded in place');assert.equal(packedResult.decoded.metadata,packedResult.packet.metadata);assert.equal(packedResult.entry.sha256,r.audit.encodedBinding.sha256);assert.equal(r.audit.extraEncodingLifetime.retainedCompressedBytes,0);assert.throws(()=>r.assertPacked(packedResult),/consumed/);
}));

test('infill uses fresh original before paint/guards/scenery, and exact immediate scenery invariance',async()=>withTemp(async dir=>{
 const s=fixture(),infill=await infillStage(s,dir),a=args(s,{infill,paint:{codeSha256:code.paint},guards:{codeSha256:code.guards,recipes:[]},scenery:sceneryStage()}),r=await mutateOriginalCell(a);
 assert.deepEqual(r.audit.stages.map(s=>s.name),['infill','paint','guards','scenery']);assert.equal(r.audit.stages[0].report.removed.length,1);assert.equal(r.audit.stages.at(-1).report.added,1);assert.equal(r.audit.stages.at(-1).report.invariance.allOriginalArraysByteExact,true);
 const p=await packed(r,join(dir,'out'));assert.equal(tileTables(p.packet).buildings.length/4,1);assert.equal(p.packet.metadata.cellMutation.original.sha256,s.entry.sha256);assert.equal(p.entry.dependencies[0],'7,7');assert.equal(r.audit.globalSeamsAndBudgetsAccepted,false);
}));

test('stale canonical/raw infill plans, wrong helper code and modified source file fail closed',async()=>withTemp(async dir=>{
 for(const alter of [s=>s.reviewedPlanSha256='0'.repeat(64),s=>s.planFileSha256='0'.repeat(64),s=>s.codeSha256='0'.repeat(64),s=>{const p=JSON.parse(s.planBytes);p.packSha256='0'.repeat(64);s.planBytes=bytes(p);s.planFileSha256=hash(s.planBytes);s.reviewedPlanSha256=repairPlanSha256(p);}]){const s=fixture(),stage=await infillStage(s,dir);alter(stage);const a=args(s,{infill:stage,guards:{codeSha256:code.guards,recipes:[]}});await assert.rejects(mutateOriginalCell(a),/digest|hash|identity/);}
 const s=fixture(),stage=await infillStage(s,dir),a=args(s,{infill:stage,guards:{codeSha256:code.guards,recipes:[]}});await writeFile(stage.sourcePath,'changed');await assert.rejects(mutateOriginalCell(a),/source identity/);
}));

test('rejects arbitrary callbacks, unknown stages, recipe drift and substituted complete scope',async()=>{
 const a=args();a.stages.mutate=()=>{};await assert.rejects(mutateOriginalCell(a),/callbacks|stages/);
 const b=args();b.stages.scenery={...sceneryStage(),blocked:()=>false};await assert.rejects(mutateOriginalCell(b),/callbacks/);
 const c=args();c.derived.recipeSha256='f'.repeat(64);await assert.rejects(mutateOriginalCell(c),/recipe/);
 const d=args();d.releaseScope=scope(fixture(),2);await assert.rejects(mutateOriginalCell(d),/recipe/);
});

test('original-only guard sealing survives paint, applies triangle delta once and ordinary gates',async()=>withTemp(async dir=>{
 const s=fixture({guards:true}),r=await mutateOriginalCell(args(s,{paint:{codeSha256:code.paint},guards:guardStage()})),g=r.audit.stages.find(s=>s.name==='guards').report;assert.ok(g.triangleDelta<0);assert.equal(r.spool.metadata.budgets.triangles,s.entry.triangles+g.triangleDelta);await packed(r,join(dir,'out'));
}));

test('sealed guard physical-table change from prior infill aborts rather than resealing',async()=>withTemp(async dir=>{
 const s=fixture({guards:true}),infill=await infillStage(s,dir);await assert.rejects(mutateOriginalCell(args(s,{infill,guards:guardStage()})),/physical support\/rail\/beam\/guard changed/);
 const a=args(fixture({guards:true}),{guards:guardStage()});a.stages.guards.recipes[0].sourcePlanBytes=Buffer.from('{}');pin(a);await assert.rejects(mutateOriginalCell(a),/hash mismatch/);
}));

test('current terrain prototypes reject even tiny scopes, fake acceptance and complete large scope',async()=>{
 for(const count of [1,28]){const s=fixture(),atlas=bytes({revision:'original',spacing:8,grids:{}}),report=bytes({schema:'terrain-geographic-acceptance-1',passed:true}),stage={codeSha256:code.terrain,fieldId:'binomial-9x32m-prototype',atlasBytes:atlas,atlasSha256:hash(atlas),reportBytes:report,reportSha256:hash(report)},a=args(s,{terrain:stage,paint:{codeSha256:code.paint},guards:{codeSha256:code.guards,recipes:[]}});a.releaseScope=scope(s,count);pin(a);await assert.rejects(mutateOriginalCell(a),/terrain|hill profiles/i);}
});

function protectedArgs(){const s=fixture({world:'penteli'}),tiles=Object.fromEntries(Array.from({length:225},(_,i)=>[[i,0].join(','),s.entry])),manifest=bytes({world:'penteli',revision:s.source.revision,tiles}),a=args(s,{});a.protectedSources={manifests:[{regionId:'penteli',bytes:manifest,sha256:hash(manifest)}]};const scope=JSON.parse(a.releaseScope.bytes);scope.sourceManifestSha256=hash(manifest);a.releaseScope={bytes:bytes(scope),sha256:hash(bytes(scope))};return pin(a);}

test('exact original native manifest family returns untouched bytes; any requested mutation rejects',async()=>{
 const a=protectedArgs(),r=await mutateOriginalCell(a);assert.equal(r.kind,'preserved');assert.deepEqual(r.entry,a.entry);assert.deepEqual(r.compressedBytes,a.compressedBytes);assert.equal(r.spool,undefined);
 for(const name of ['infill','terrain','paint','guards','scenery']){const b=protectedArgs();b.stages={[name]:{}};pin(b);await assert.rejects(mutateOriginalCell(b),/protected native mutation/);}
});

test('world names, fake family, missing manifest, altered original entry and registry SHA cannot spoof native preservation',async()=>{
 for(const change of [a=>a.protectedSources=null,a=>a.protectedSources.manifests[0].sha256='0'.repeat(64),a=>a.entry={...a.entry,bytes:a.entry.bytes+1},a=>{const m=JSON.parse(a.protectedSources.manifests[0].bytes);m.world='fixture';const b=bytes(m);a.protectedSources.manifests[0]={regionId:'penteli',bytes:b,sha256:hash(b)};},a=>a.entry={...a.entry,source:{...a.entry.source,regionId:'basin'}}]){const a=protectedArgs();change(a);pin(a);await assert.rejects(mutateOriginalCell(a),/registry|hash|size|family|source|scope/);}
});

test('raw scenery comparison rejects physical bytes, parking, building IDs and metadata drift',()=>{
 for(const change of [p=>tileTables(p).finePositions[1]++,p=>p.metadata.ids.push('building:drift'),p=>p.metadata.extensions.worldDetail.parking=1,p=>p.metadata.palette[0][0]=.5,p=>p.metadata.tables.buildingCorners=p.metadata.tables.finePositions]){const p=fixture().encoded.decoded,s=snapshotSceneryInvariants(p);change(p);assert.throws(()=>assertSceneryInvariance(s,p),/scenery changed/);}
 const p=fixture().encoded.decoded,s=snapshotSceneryInvariants(p),v=p.metadata.extensions.worldDetail.vegetation;v.positionHeight=p.arrays.push(tileTables(p).finePositions)-1;v.kind=p.arrays.push(new Uint8Array())-1;v.seed=p.arrays.push(new Uint32Array())-1;assert.throws(()=>assertSceneryInvariance(s,p,{added:1}),/alias/);
});

test('private append index aliases, undeclared fields and wrong array count fail raw invariance',()=>{
 for(const change of [p=>{p.arrays.push(new Float32Array(),new Uint8Array(),new Uint32Array());p.metadata.extensions.worldDetail.vegetation.positionHeight=p.metadata.tables.finePositions;},p=>p.arrays.push(new Float32Array()),p=>p.metadata.extensions.worldDetail.vegetation.hiddenCollision=true]){const p=fixture().encoded.decoded,s=snapshotSceneryInvariants(p);change(p);assert.throws(()=>assertSceneryInvariance(s,p,{added:1}),/alias|array|metadata/);}
});

test('actual ordinary packer rejects triangle tampering and assertPacked rejects wrong encoded entry/budgets/gates/identity/physical rows',async()=>withTemp(async dir=>{
 const changes=[r=>r.entry.sha256='0'.repeat(64),r=>r.entry.bytes++,r=>r.entry.residentBytes=1,r=>r.entry.transientBytes=64*1024**2+1,r=>r.physical.passed=false,r=>r.packet.metadata.revision='wrong',r=>r.packet.metadata.cellMutation={...r.packet.metadata.cellMutation,recipeSha256:'0'.repeat(64)},r=>tileTables(r.packet).buildingHeights[1]++,r=>r.packet.metadata.ids[2]='building:wrong',r=>r.entry.source={world:'wrong',revision:'wrong'}];
 for(const [i,change]of changes.entries()){const r=await mutateOriginalCell(args());await assert.rejects(packed(r,join(dir,'bad-'+i),change),/binding|budget|gate|identity|lineage|table|reservation|array|metadata/);}
 const r=await mutateOriginalCell(args()),wrong=structuredClone(r.spool);wrong.metadata.budgets.triangles+=10;await assert.rejects(packTiles(Readable.from([JSON.stringify(wrong)+'\n']),join(dir,'bad-triangles'),{onTile:r.assertPacked}),/triangle accounting/);
 const x=await mutateOriginalCell(args()),other=structuredClone(x.spool);other.metadata.revision='mixed';await assert.rejects(packTiles(Readable.from([JSON.stringify(x.spool)+'\n',JSON.stringify(other)+'\n']),join(dir,'mixed')),/Mixed world\/revision/);
}));

test('actual packed vegetation clearance failure cannot hide behind prepared CSR or encoded byte binding',async()=>withTemp(async dir=>{
 const r=await mutateOriginalCell(args(fixture({road:true})));await assert.rejects(packed(r,join(dir,'out'),result=>{const p=result.packet;p.metadata.extensions.worldDetail.streetTrees=p.arrays.push(new Float32Array([40,30,40,0,0]))-1;}),/Vegetation intersects/);
}));

test('bounded async source advances only after ordinary packing/assertion releases the current cell',async()=>withTemp(async dir=>{
 let live=0,maximum=0;async function* originals(){for(let i=0;i<3;i++){assert.equal(live,0);live++;maximum=Math.max(maximum,live);yield args(fixture({cell:[i,0]}));}}
 let i=0;for await(const a of originals()){const r=await mutateOriginalCell(a);await packed(r,join(dir,'cell-'+i++));live--;}
 assert.equal(i,3);assert.equal(maximum,1);assert.equal(live,0);
}));


test('source header view allocations are bounded before the original-only decoder',async()=>{
 const s=fixture(),raw=gunzipSync(s.compressedBytes),start=raw.readUInt32LE(8),m=JSON.parse(raw.subarray(12,12+raw.readUInt32LE(4)));m.views[0].length=2**30;const text=bytes(m),offset=Math.ceil((12+text.length)/4)*4,out=Buffer.alloc(offset+raw.length-start);out.writeUInt32LE(0x31525341,0);out.writeUInt32LE(text.length,4);out.writeUInt32LE(offset,8);text.copy(out,12);raw.copy(out,offset,start);s.compressedBytes=gzipSync(out);s.entry={...s.entry,sha256:hash(s.compressedBytes),bytes:s.compressedBytes.length};await assert.rejects(mutateOriginalCell(args(s)),/decoded budget\/views/);
});

test('an actual wire vegetation alias into nonempty contact positions is rejected before scenery',async()=>{
 const s=fixture(),p=s.encoded.decoded;delete p.metadata.tables.fineSurface;delete p.metadata.tables.fineFlags;
 const positions=p.arrays.push(new Float32Array([40,30,40,5,80,30,80,5,120,30,120,5]))-1;p.metadata.tables.contactPositions=positions;p.metadata.extensions.worldDetail.vegetation={positionHeight:positions,kind:p.arrays.push(new Uint8Array(3))-1,seed:p.arrays.push(new Uint32Array([1,2,3]))-1};
 const e=encodeTile(repairedSpool(p));s.compressedBytes=e.bytes;s.entry={...s.entry,sha256:hash(e.bytes),bytes:e.bytes.length};await assert.rejects(mutateOriginalCell(args(s,{guards:{codeSha256:code.guards,recipes:[]},scenery:sceneryStage()})),/input aliases a physical/);
});

test('caller input changes after invocation cannot rewrite authenticated identity or recipe',async()=>{
 const a=args(),expected=a.entry.sha256,pending=mutateOriginalCell(a);a.compressedBytes.fill(0);a.entry.sha256='0'.repeat(64);a.derived.revision='caller-changed';a.stages.guards.codeSha256='0'.repeat(64);const r=await pending;assert.equal(r.audit.sourceSha256,expected);assert.equal(r.spool.metadata.revision,'new');
});


test('the ordinary packer physical gate actually rejects a steep emitted source, without any gate replacement',async()=>withTemp(async dir=>{
 const s=fixture({road:true}),p=s.encoded.decoded;tileTables(p).finePositions[1]=542;const e=encodeTile(repairedSpool(p));s.compressedBytes=e.bytes;s.entry={...s.entry,sha256:hash(e.bytes),bytes:e.bytes.length};const r=await mutateOriginalCell(args(s));await assert.rejects(packed(r,join(dir,'steep')),/Physical surface acceptance/);
}));

test('full code/data proof binding rejects a separately substituted dependency digest',async()=>{
 const a=args();a.derived.codeProofSha256='0'.repeat(64);pin(a);await assert.rejects(mutateOriginalCell(a),/dependency code hash/);
});


test('a genuinely different ordinary encoded body cannot reuse the expected binding',async()=>withTemp(async dir=>{
 const r=await mutateOriginalCell(args()),other=structuredClone(r.spool);other.metadata.cellMutation.original.sha256='0'.repeat(64);await assert.rejects(packTiles(Readable.from([JSON.stringify(other)+'\n']),join(dir,'other'),{onTile:r.assertPacked}),/encoded entry SHA/);
}));


test('exact ordinary JSON encode path rejects signed-zero physical bit loss, while preservation stays exact',async()=>{
 const s=fixture(),p=s.encoded.decoded;tileTables(p).finePositions[0]=-0;const e=encodeTile(repairedSpool(p));s.compressedBytes=e.bytes;s.entry={...s.entry,sha256:hash(e.bytes),bytes:e.bytes.length};assert.ok(Object.is(tileTables(e.decoded).finePositions[0],-0));await assert.rejects(mutateOriginalCell(args(s)),/JSON spool changes authoritative array bytes/);const kept=await mutateOriginalCell(args(s,{}));assert.deepEqual(kept.compressedBytes,e.bytes);
});
