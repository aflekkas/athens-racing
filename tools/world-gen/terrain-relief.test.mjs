import {composeExtension} from './compose-extension.mjs';
import {requireTerrainAcceptance} from './terrain-acceptance.mjs';
import {readTerrainSource} from './refine-terrain.mjs';
import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';
import {terrainReliefField,refineTerrainRelief,terrainAtlasCell} from './terrain-relief.mjs';
import {auditTerrainSmoothness} from '../world-terrain-smoothness.mjs';
import {TILE_TABLES,tileTables,validateTileSeam} from '../../src/world-tile-format.js';
const heights=(cx,cz,h)=>Array.from({length:1089},(_,i)=>Math.fround(h(cx*512+i%33*16,cz*512+Math.floor(i/33)*16)));
function atlas(h){const a={grids:{},protected:[]};for(let z=-2;z<=2;z++)for(let x=-2;x<=2;x++)a.grids[[x,z]]=heights(x,z,h);return a;}
function fixture(cell=[0,0]){const arrays=[],tables={};for(const[k,[type]]of Object.entries(TILE_TABLES)){tables[k]=arrays.length;arrays.push(new globalThis[type](k==='coarseHeights'?1089:0));}tables.fineSurface=arrays.length;arrays.push(new Uint32Array([1,1]));tables.fineFlags=arrays.length;arrays.push(new Uint8Array([1,1]));
 const set=(name,data)=>arrays[tables[name]]=new arrays[tables[name]].constructor(data);
 set('finePositions',[0,10,0,512,10,0,0,10,512,512,10,512]);set('fineTriangles',[0,2,1,1,2,3]);tables.contactPositions=tables.finePositions;set('coarseHeights',Array(1089).fill(10));
 return {arrays,metadata:{tileVersion:1,world:'athens',revision:'test',cell,origin:[cell[0]*512,0,cell[1]*512],tables,extensions:{derivedBuildings:{version:1}},ids:['','road'],strings:[''],meshes:[{attributes:{position:{array:tables.finePositions,itemSize:3}},index:tables.fineTriangles,material:0}],palette:[[.5,.5,.5]],terrain:{coarseSize:33,spacing:16},budgets:{triangles:2,buildingTriangles:0}}};
}
test('global relief preserves affine slopes rather than flattening real hills',()=>{const h=(x,z)=>50+x*.1-z*.125,f=terrainReliefField(atlas(h));for(const x of [-512,0,13,511.7,512,700])for(const z of [-200,0,123])assert.ok(Math.abs(f.delta(x,z))<1e-5);});
test('DSM-scale lumps are removed while a broad real hill retains its relief',()=>{const ripple=(x,z)=>50+4*Math.cos(x*Math.PI/48),hill=(x,z)=>80*Math.cos(x*Math.PI/1200);const f=terrainReliefField(atlas(ripple)),g=terrainReliefField(atlas(hill));assert.ok(Math.abs(4+f.delta(0,0))<.1);assert.ok(80+g.delta(0,0)>79);});
test('global field is independent of cell iteration order and has no border jump',()=>{const a=atlas((x,z)=>30+3*Math.cos(x/20)+2*Math.sin(z/21)),b={...a,grids:Object.fromEntries(Object.entries(a.grids).reverse())},f=terrainReliefField(a),g=terrainReliefField(b);for(let z=0;z<=512;z+=2){assert.equal(f.delta(512,z),g.delta(512,z));assert.ok(Math.abs(f.delta(512-1e-6,z)-f.delta(512+1e-6,z))<1e-5);}});
test('water, bridge and missing-world boundaries are fixed with a continuous global transition',()=>{const a=atlas((x,z)=>20+4*Math.cos(x/20));a.protected=['1,0'];const f=terrainReliefField(a);assert.equal(f.delta(512,100),0);assert.equal(f.delta(600,100),0);assert.ok(Math.abs(f.delta(512-1e-5,100))<1e-6);const p=fixture();p.metadata.structures=[{}];assert.equal(terrainAtlasCell(p).protected,true);const before=Array.from(tileTables(p).finePositions);refineTerrainRelief(p,{delta:()=>10});assert.deepEqual(Array.from(tileTables(p).finePositions),before);});
test('one correction moves shared render/contact arrays once and keeps dressing and graph attached',()=>{const p=fixture(),t=tileTables(p),add=a=>{p.arrays.push(a);return p.arrays.length-1;};p.arrays[p.metadata.tables.edgePoints]=new Float32Array([20,10,30,100,10,30]);p.arrays[p.metadata.tables.anchorTransforms]=new Float32Array([20,10,30,0]);p.metadata.extensions.worldDetail={props:{rows:add(new Float32Array([20,10,30,0,1]))},signals:{rows:add(new Float32Array([20,10,30,0,0,0]))},vegetation:{positionHeight:add(new Float32Array([20,10,30,4]))}};
 const report=refineTerrainRelief(p,{delta:()=>2});assert.equal(report.maxAdjustment,2);assert.equal(t.finePositions[1],12);assert.equal(t.contactPositions[1],12);assert.equal(tileTables(p).edgePoints[1],12);assert.equal(tileTables(p).anchorTransforms[1],12);for(const v of Object.values(p.metadata.extensions.worldDetail)){const ref=v.rows??v.positionHeight;assert.equal(p.arrays[ref][1],12);}assert.throws(()=>refineTerrainRelief(p,{delta:()=>2}),/already applied/);});
test('matched border vertices and coarse samples remain bit-identical after correction',()=>{const a=fixture(),b=fixture([1,0]),f=terrainReliefField(atlas((x,z)=>10+4*Math.cos(x/20)));refineTerrainRelief(a,f);refineTerrainRelief(b,f);assert.equal(validateTileSeam(a,b),true);});
test('smoothness audit rejects a legal-grade roller coaster and accepts a steady hill',()=>{for(const bad of [false,true]){const p=fixture(),t=tileTables(p);p.arrays[p.metadata.tables.coarseHeights]=Float32Array.from({length:1089},(_,i)=>10+(bad?3*Math.cos((i%33)*Math.PI/2):i%33*.5));p.arrays[p.metadata.tables.finePositions]=new Float32Array();p.arrays[p.metadata.tables.fineTriangles]=new Uint32Array();p.arrays[p.metadata.tables.contactPositions]=new Float32Array();p.arrays[p.metadata.tables.edges]=new Uint32Array([0,0,0,0,33,0,0,0,0,0]);p.arrays[p.metadata.tables.edgeLayers]=new Int8Array([0]);p.arrays[p.metadata.tables.edgePoints]=Float32Array.from({length:99},(_,i)=>i%3===0?Math.floor(i/3)*16:i%3===1?10:100);
 // Coarse-only fixtures have ground flags, so test the chord through explicit road faces.
 const P=[],T=[];for(let x=0;x<=512;x+=16)P.push(x,10+(bad?3*Math.cos(x/16*Math.PI/2):x/32),0,x,10+(bad?3*Math.cos(x/16*Math.PI/2):x/32),512);for(let i=0;i<32;i++)T.push(i*2,i*2+1,i*2+2,0,1,i*2+2,i*2+1,i*2+3,0,1);p.arrays[p.metadata.tables.contactPositions]=new Float32Array(P);p.arrays[p.metadata.tables.contactTriangles]=new Uint32Array(T);p.arrays[p.metadata.tables.contactLayers]=new Int8Array(64);const r=auditTerrainSmoothness(tileTables(p));assert.ok(r.samples>100);assert.equal(r.passed,!bad);}});
test('a horizontal bend on one affine hillside is not a vertical terrain lump',()=>{
 const p=fixture(),t=p.metadata.tables,P=[],T=[];for(let x=0;x<=512;x+=16)P.push(x,30+x*.12,0,x,30+x*.12,512);for(let i=0;i<32;i++)T.push(i*2,i*2+1,i*2+2,0,1,i*2+2,i*2+1,i*2+3,0,1);
 p.arrays[t.finePositions]=new Float32Array();p.arrays[t.fineTriangles]=new Uint32Array();p.arrays[t.contactPositions]=new Float32Array(P);p.arrays[t.contactTriangles]=new Uint32Array(T);p.arrays[t.contactLayers]=new Int8Array(64);
 const rows=[];for(let i=0;i<=32;i++){const x=256+180*Math.cos(i*Math.PI/16),z=i*16;rows.push(x,30+x*.12,z);}
 p.arrays[t.edgePoints]=new Float32Array(rows);p.arrays[t.edges]=new Uint32Array([0,0,0,0,33,0,0,0,0,0]);p.arrays[t.edgeLayers]=new Int8Array([0]);const result=auditTerrainSmoothness(tileTables(p));assert.ok(result.samples>100);assert.equal(result.passed,true);assert.ok(result.maxSag<.00002);
});
test('steeper refined terrain gets the existing kerb fade instead of exceeding shoulder gates',()=>{
 const h=(x,z)=>200+x*.25-x*.25*Math.exp(-((x/20)**2)),f=terrainReliefField(atlas(h));const base=f.original(0,0),next=f.transform(0,base,0),kerb=f.transform(0,base+.12,0);assert.ok(kerb-next<.01);
 const g=terrainReliefField(atlas((x,z)=>200+x*.05));assert.ok(Math.abs(g.transform(0,200.12,0)-200.12)<1e-6);
});
test('a comfort report with no eligible road chords does not claim a pass',()=>{const r=auditTerrainSmoothness(tileTables(fixture()));assert.equal(r.passed,null);assert.equal(r.samples,0);});

test('bounded lattice memoization gives identical terrain after eviction',()=>{const a=atlas((x,z)=>80+3*Math.cos(x/21)+2*Math.sin(z/24)),f=terrainReliefField({...a,cacheLimit:7}),g=terrainReliefField(a);for(let j=0;j<2;j++)for(let x=0;x<512;x+=13)assert.equal(f.delta(x,110+j),g.delta(x,110+j));});
test('protected coverage records every independent reason without hiding topology',()=>{const p=fixture();p.metadata.structures=[{}];p.metadata.tunnelBores=[{}];p.metadata.coastalLakes=[{}];assert.deepEqual(terrainAtlasCell(p).protectedReasons,['structure-layer','bore','lake']);});

test('shared source cache verifies bytes and hash without writes or network fallback',async()=>{
 const bytes=Buffer.from('authenticated tile'),entry={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://example.invalid/tile'};
 let reads=0;const options={cache:'/shared',readOnly:true,readFile:async path=>{reads++;assert.equal(path,'/shared/'+entry.sha256+'.bin.gz');return bytes;},writeFile:()=>{throw Error('must not write');},fetcher:()=>{throw Error('must not fetch');}};
 assert.equal(await readTerrainSource(entry,options),bytes);assert.equal(reads,1);
 await assert.rejects(readTerrainSource(entry,{...options,readFile:async()=>{throw Error('ENOENT');}}),/Read-only source cache missing/);
 await assert.rejects(readTerrainSource(entry,{...options,readFile:async()=>Buffer.from('corrupted tile')}),/Source integrity/);
});

test('prototype terrain cannot start a global bake even with a claimed acceptance report',()=>{
 assert.deepEqual(requireTerrainAcceptance(27),{prototype:true});
 assert.throws(()=>requireTerrainAcceptance(1748,{report:{passed:true}}),/Global terrain bake blocked/);
 const field={schema:2,id:'future-verified-field',geographyVerified:true,maxPrototypeCells:27};
 assert.throws(()=>requireTerrainAcceptance(1748,{field,sourceRevision:'source',fieldSHA256:'field',report:{passed:true}}),/exact-source\/exact-field/);
 const report={schema:'terrain-geographic-acceptance-1',sourceRevision:'source',fieldSHA256:'field',fieldId:field.id,passed:true,hillProfiles:{passed:true,samples:1,locations:['lycabettus','penteli','valley','world-edge']},cityComfort:{passed:true,samples:1,maxSagLimit:.5},negativeControls:{passed:true,samples:1,rollerCoasterRejected:true},protectedRegions:{passed:true,samples:1,changedCells:0}};
 assert.equal(requireTerrainAcceptance(1748,{field,sourceRevision:'source',fieldSHA256:'field',report}).prototype,false);
 assert.throws(()=>requireTerrainAcceptance(1748,{field,sourceRevision:'source',fieldSHA256:'field',report:{...report,cityComfort:{...report.cityComfort,maxSagLimit:.6}}}),/cannot relax/);
 assert.throws(()=>requireTerrainAcceptance(1748,{field,sourceRevision:'different',fieldSHA256:'field',report}),/exact-source/);
});

test('experimental quartic field preserves quadratic broad terrain without enabling global publication',()=>{
 const h=(x,z)=>300+.0001*x*x-.0002*z*z+.03*x,f=terrainReliefField(atlas(h),{filter:'quartic-9x32m-experimental'});
 for(const[x,z]of[[0,0],[128,64],[500,100]])assert.ok(Math.abs(f.delta(x,z))<.0001);
 assert.equal(f.descriptor.schema,2);assert.equal(f.descriptor.geographyVerified,false);
 assert.throws(()=>requireTerrainAcceptance(1353,{field:f.descriptor,report:{passed:true}}),/Global terrain bake blocked/);
 assert.throws(()=>terrainReliefField(atlas(h),{filter:'unknown'}),/Unknown terrain field/);
});

test('experimental negative taps cannot create a new valley or summit beyond the source range',()=>{
 for(const sign of [-1,1]){const h=(x,z)=>100+sign*40*Math.exp(-(x*x+z*z)/6400),f=terrainReliefField(atlas(h),{filter:'quartic-9x32m-experimental'});for(let x=-400;x<=400;x+=8){const y=f.original(x,0)+f.delta(x,0);assert.ok(y>=60-.0001&&y<=140+.0001);}}
 const a=atlas((x,z)=>100+4*Math.cos(x/20));a.protected=['1,0'];const f=terrainReliefField(a,{filter:'quartic-9x32m-experimental'});assert.equal(f.delta(512,100),0);assert.equal(f.delta(520,100),0);
});

test('provisional extension composition preserves old packets and records basin source identity',()=>{
 const projection={lat0:37.98,lon0:23.73,mlat:111320,mlon:87745.27512677578},tile={url:'https://example.invalid/old',sha256:'a'.repeat(64),bytes:1,decodedBytes:1,triangles:1,dependencies:[],source:{regionId:'basin',world:'old',revision:'old'}};
 const base={tileVersion:1,tileMetres:512,world:'athens',revision:'old',projection,spawn:{cell:[0,0],anchor:'old-anchor'},tiles:{'0,0':tile},sourceIdentities:[tile.source]},extension={tileVersion:1,tileMetres:512,world:'ekali',revision:'new',projection,spawn:{cell:[1,0],anchor:'actual-new-anchor'},tiles:{'1,0':{...tile,url:'./cells/new',source:undefined,sha256:'b'.repeat(64)}}};
 const original=JSON.stringify(base),r=composeExtension(base,extension);
 assert.equal(JSON.stringify(base),original);assert.deepEqual(r.manifest.tiles['0,0'],tile);assert.deepEqual(r.manifest.spawn,base.spawn);assert.deepEqual(r.manifest.tiles['1,0'].source,{regionId:'basin',world:'ekali',revision:'new'});assert.equal(r.manifest.sourceIdentities.length,2);assert.equal(r.manifest.acceptance.passed,false);assert.equal(r.manifest.releaseReady,false);
 assert.throws(()=>composeExtension(base,{...extension,projection:{...projection,lat0:38}}),/projection mismatch/);
 assert.throws(()=>composeExtension(base,{...extension,tiles:{'1,0':{...extension.tiles['1,0'],source:{regionId:'basin',world:'spoof',revision:'new'}}}}),/packet identity mismatch/);
});
