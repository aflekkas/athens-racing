import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {TILE_TABLES} from '../../src/world-tile-format.js';import {encodeTile} from './pack.mjs';import {readBridgeGuardRecipe,prepareBridgeGuardRepair,rebuildBridgeGuards,planBridgeGuardRepair} from './bridge-guards.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/bridge-guards.json',import.meta.url),'utf8')),digest=b=>createHash('sha256').update(b).digest('hex');
function recipe(data=fixture.recipe,plan=fixture.sourcePlanBytes){return readBridgeGuardRecipe({compiledBytes:Buffer.from(JSON.stringify(data)),sourcePlanBytes:Buffer.from(plan)});}
function source({guards=true,chunks=false,world='fixture'}={}){
 const tables=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));tables.coarseHeights=Array(1089).fill(0);tables.finePositions=[0,0,0,512,0,0,0,0,512,512,0,512];tables.fineTriangles=[0,2,1,1,2,3];
 const arrays=[],meshes=[];if(guards)for(const [i,part]of [fixture.fascia,fixture.guard].entries()){const p=arrays.push({type:'Float32Array',data:part[0]})-1,index=arrays.push({type:'Uint16Array',data:part[1]})-1;meshes.push({name:'probe',material:i===0?12:15,attributes:{position:{array:p,itemSize:3,normalized:false}},index,layers:1,userData:{bridgeGuard:true,worldSurface:false},drawRange:{start:0,count:part[1].length}});}
 if(chunks){const last=meshes.pop(),half=last.drawRange.count/2;meshes.push({...last,drawRange:{start:0,count:half}},{...last,drawRange:{start:half,count:half}});}
 const metadata={tileVersion:1,world,revision:'fixture-original',cell:[0,0],origin:[0,0,0],ids:[''],strings:[''],palette:Array.from({length:16},()=>[1,1,1]),meshes,terrain:{coarseSize:33,spacing:16},budgets:{triangles:meshes.reduce((n,m)=>n+m.drawRange.count/3,0),buildingTriangles:0},structures:guards?[{id:'w1:0',kind:'osm-bridge-guarded',layer:1,bridgeSources:['w1:0'],roads:['w1:0']}]:[],rails:guards?fixture.rails:[]};
 const {bytes,decoded}=encodeTile({metadata,arrays,tables}),entry={bytes:bytes.length,sha256:digest(bytes),decodedBytes:4*1024**2,source:{world,revision:metadata.revision}};
 return {pack:decoded,args:{compressedBytes:bytes,entry,world,revision:metadata.revision,cell:[0,0]}};
}
const prove=async s=>prepareBridgeGuardRepair(s.args,[recipe()]);
test('authenticated guard repair agrees byte-for-byte with Python source posts and preserves pack-stage ownership',async()=>{
 const s=source(),proof=await prove(s),before=structuredClone(s.pack),report=rebuildBridgeGuards(s.pack,proof),mesh=s.pack.metadata.meshes.find(m=>m.material===15),P=s.pack.arrays[mesh.attributes.position.array],I=s.pack.arrays[mesh.index],n=fixture.rails.length;
 assert.ok(Object.isFrozen(proof));assert.equal(report.postsAfter,fixture.expectedPosts[0].length/24);assert.deepEqual(P.slice(n*24),Float32Array.from(fixture.expectedPosts[0]));assert.deepEqual(I.slice(n*18),Uint16Array.from(fixture.expectedPosts[1].map(i=>i+n*8)));
 for(let r=0;r<n;r++)assert.deepEqual(P.slice(r*24,r*24+24),before.arrays[2].slice(r*48,r*48+24));
 assert.deepEqual(s.pack.metadata.rails,before.metadata.rails);assert.deepEqual(s.pack.metadata.budgets,before.metadata.budgets);assert.equal(s.pack.metadata.world,before.metadata.world);assert.equal(s.pack.metadata.revision,before.metadata.revision);
 for(const name of Object.keys(TILE_TABLES))assert.deepEqual(s.pack.arrays[s.pack.metadata.tables[name]],before.arrays[before.metadata.tables[name]]);
 assert.ok(report.triangleDelta<0);assert.ok(report.arrayBytesDelta<0);assert.throws(()=>rebuildBridgeGuards(s.pack,proof),/consumed/);
});
test('material draw chunks share one complete guard buffer domain',async()=>{const s=source({chunks:true}),r=rebuildBridgeGuards(s.pack,await prove(s));assert.equal(r.guardMeshesBefore,2);assert.equal(r.guardMeshesAfter,1);});
test('an immutable no-guards proof is a true no-op',async()=>{const s=source({guards:false}),before=structuredClone(s.pack),p=await prove(s);assert.equal(p.mode,'no-guards');assert.equal(rebuildBridgeGuards(s.pack,p).changed,false);assert.deepEqual(s.pack,before);});
test('source compressed SHA, length, source revision and entry identity fail closed',async()=>{
 for(const mutate of [a=>a.entry.sha256='0'.repeat(64),a=>a.entry.bytes++,a=>a.revision='wrong',a=>a.entry.source.world='wrong',a=>a.cell=[1,0]]){const s=source();mutate(s.args);await assert.rejects(prove(s),/authentication|identity/);}
});
test('source plan bytes are authenticated against the compiled recipe',()=>{assert.throws(()=>recipe(fixture.recipe,fixture.sourcePlanBytes+' '),/provenance/);});
test('missing and different full-component plan matches fail closed',async()=>{
 const missing=source({world:'athens-east-development'});await assert.rejects(prepareBridgeGuardRepair(missing.args,[]),/matches 0/);
 const s=source(),data=structuredClone(fixture.recipe);for(const component of data.components)for(const ring of component)for(const p of ring)p[0]+=.1;await assert.rejects(prepareBridgeGuardRepair(s.args,[recipe(data)]),/matches 0/);
});
test('two matching local outlines with different complete source rings are ambiguous',async()=>{
 const s=source(),data=structuredClone(fixture.recipe),plan=JSON.parse(fixture.sourcePlanBytes);for(const component of data.components)for(const ring of component)for(const p of ring)if(p[0]===540)p[0]=560;for(const ring of plan.groups[0].platform.coordinates)for(const p of ring)if(p[0]===540)p[0]=560;const raw=JSON.stringify(plan);data.sourcePlanSha256=digest(raw);await assert.rejects(prepareBridgeGuardRepair(s.args,[recipe(),recipe(data,raw)]),/matches 2/);
});
test('identical complete source geometry may have explicit plan aliases',async()=>{const s=source(),data=structuredClone(fixture.recipe),plan=JSON.parse(fixture.sourcePlanBytes);plan.area='alias';data.area='alias';const raw=JSON.stringify(plan);data.sourcePlanSha256=digest(raw);const p=await prepareBridgeGuardRepair(s.args,[recipe(),recipe(data,raw)]);assert.equal(rebuildBridgeGuards(s.pack,p).sourcePlans.length,2);});
test('changed support, rails, beam vertices, guard metadata or source identity require reproof',async()=>{
 for(const mutate of [p=>p.arrays[p.metadata.tables.finePositions][1]+=.01,p=>p.metadata.rails[0][1]+=.01,p=>p.arrays[2][0]+=.01,p=>p.metadata.meshes[1].userData.extra=true,p=>p.metadata.palette[15][0]=.5,p=>p.metadata.revision='new']){const s=source(),proof=await prove(s);mutate(s.pack);assert.throws(()=>rebuildBridgeGuards(s.pack,proof),/changed|identity/);}
});
test('unsealed and metadata-only reports cannot authorize a repair',()=>{const s=source();assert.throws(()=>rebuildBridgeGuards(s.pack,{}),/sealed/);const r=planBridgeGuardRepair(s.pack.metadata,[recipe()]);assert.ok(r.required);assert.throws(()=>rebuildBridgeGuards(s.pack,r),/sealed/);});
test('unknown source worlds do not silently become no-ops',async()=>{const s=source({guards:false,world:'unknown'});await assert.rejects(prepareBridgeGuardRepair(s.args,[]),/unknown source world/);});
const python=process.env.WORLD_GEN_PYTHON||'python3',shapely=spawnSync(python,['-c','import shapely']).status===0;
test('plan compiler reproduces the committed synthetic canonical rings and provenance',{skip:!shapely&&'shapely not installed'},()=>{const r=spawnSync(python,[fileURLToPath(new URL('./compile-bridge-guards.py',import.meta.url)),'-','fixture'],{input:fixture.sourcePlanBytes,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),fixture.recipe);});

test('authored preservation is an exact three-cell binding, never an ID/world fallback',async()=>{
 const registry=JSON.parse(readFileSync(new URL('./areas/authored-guard-preservation.json',import.meta.url),'utf8'));
 assert.deepEqual(registry.cells.map(v=>v.cell),[[30,-23],[33,-21],[34,-21]]);
 for(const v of registry.cells){assert.equal(v.world,'penteli');assert.match(v.revision,/^[a-f0-9]{64}$/);assert.match(v.sha256,/^[a-f0-9]{64}$/);assert.match(v.guardFingerprint,/^[a-f0-9]{64}$/);assert.ok(v.bridgeSources.every(Number.isSafeInteger));}
 const unknown=source({world:'penteli'});await assert.rejects(prepareBridgeGuardRepair(unknown.args,[recipe()]),/matches 0/);
});

test('unlisted native guards without OSM structures or rails cannot become no-ops',async()=>{
 const s=source({world:'penteli'});s.pack.metadata.structures=[];s.pack.metadata.rails=[];
 const {tables,...metadata}=s.pack.metadata;const columns=Object.fromEntries(Object.entries(tables).map(([name,i])=>[name,Array.from(s.pack.arrays[i])]));
 const views=s.pack.arrays.slice(0,4).map(a=>({type:a.constructor.name,data:Array.from(a)}));const {bytes}=encodeTile({metadata,arrays:views,tables:columns});
 const entry={...s.args.entry,bytes:bytes.length,sha256:digest(bytes)};
 await assert.rejects(prepareBridgeGuardRepair({...s.args,compressedBytes:bytes,entry},[]),/unlisted guard mesh/);
 assert.throws(()=>planBridgeGuardRepair(s.pack.metadata,[],entry.sha256),/unlisted guard mesh/);
});
