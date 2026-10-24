import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {encodeTile} from './pack.mjs';
import {TILE_TABLES} from '../../src/world-tile-format.js';
import {applySceneryVegetation} from '../scenery-cell.mjs';
import {SCENERY_PROJECTION_VERSION,sceneryProjectionCodeProof,openVerifiedSceneryCatalog,projectScenerySupport,verifyScenerySupport,consumeVerifiedScenerySupport,assertProjectedBytes} from './scenery-projection.mjs';
const SHA=b=>createHash('sha256').update(b).digest('hex');
const code=sceneryProjectionCodeProof();
const selection={cell:[0,0],originXZ:[0,0],tileMetres:512,selectorVersion:SCENERY_PROJECTION_VERSION,haloMetres:17};
const polygon=(x,z,w=60)=>({type:'Polygon',coordinates:[[[x,z],[x+w,z],[x+w,z+w],[x,z+w],[x,z]]]});
const area=(source,geometry)=>({source,geometry,tags:{leisure:'garden'}});
const point=(x,z,seed=1,extra={})=>({id:'node:'+seed,source:'node:'+seed,inference:'mapped-tree-node',kind:0,seed,tags:{},x,z,...extra});
const full=(extra={})=>({areas:[],attribution:'OpenStreetMap contributors ODbL',cacheSha256:'a'.repeat(64),clearanceEvidenceReady:true,counts:{tree:1},errors:{},exclusionErrors:{},exclusions:[],extractor:'b'.repeat(64),limits:'Synthetic source; no survey claim',placementValidated:false,points:[point(40,40)],projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87745.27512677578},source:{sha256:'c'.repeat(64),bounds:[23,37,24,39],unresolvedRelationMembers:3},version:1,...extra});
function fixture(){
 const tables=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));tables.coarseHeights=Array(1089).fill(30);tables.finePositions=[0,30,0,512,30,0,0,30,512,512,30,512];tables.fineTriangles=[0,2,1,1,2,3];tables.contactPositions=[...tables.finePositions];tables.fineSurface=[1,1];tables.fineFlags=[0,0];
 const metadata={tileVersion:1,world:'synthetic',revision:'original',cell:[0,0],origin:[0,0,0],ids:['','terrain:fixture'],strings:[''],palette:[[1,1,1]],meshes:[],terrain:{coarseSize:33,spacing:16},budgets:{triangles:0,buildingTriangles:0},extensions:{worldDetail:{version:1,buildings:{facadeStyle:3,detailSeed:4},vegetation:{positionHeight:0,kind:1,seed:2}}}};
 return encodeTile({metadata,tables,arrays:[{type:'Float32Array',data:[]},{type:'Uint8Array',data:[]},{type:'Uint32Array',data:[]},{type:'Uint8Array',data:[]},{type:'Uint32Array',data:[]}]}).decoded;
}
function withSource(value,fn){const dir=fs.mkdtempSync(join(tmpdir(),'athens-projection-test-'));try{const data=typeof value==='string'?Buffer.from(value):Buffer.from(JSON.stringify(value)),path=join(dir,'source.json');fs.writeFileSync(path,data);return fn({sourcePath:path,sourceBytes:data.length,sourceSha256:SHA(data),codeProof:code},path);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function projected(source,sel=selection){const {catalog,report}=openVerifiedSceneryCatalog(source);const p=projectScenerySupport(catalog,sel);const v=verifyScenerySupport({source,selection:sel,projectedSha256:p.projectedSha256});const consumed=consumeVerifiedScenerySupport(v.token,{cell:sel.cell,originXZ:sel.originXZ});return {p,report,consumed};}
function equivalent(s,options={}){return withSource(s,source=>{const {p,consumed,report}=projected(source),a=fixture(),b=fixture(),before=structuredClone(a),ra=applySceneryVegetation(a,s,options),rb=applySceneryVegetation(b,consumed.scenery,options);assert.deepEqual(rb,ra);assert.deepEqual(b,a);for(let i=0;i<before.arrays.length;i++)assert.deepEqual(b.arrays[i],before.arrays[i]);assert.equal(consumed.scenery.source.unresolvedRelationMembers,3);assert.equal(consumed.scenery.counts.tree,s.counts.tree);return {p,report,ra,scenery:consumed.scenery};});}

test('actual helper equivalence, original arrays and global provenance exact',()=>{const r=equivalent(full({points:[point(40,40),point(9000,9000,2)],areas:[area('far',polygon(9000,9000))],exclusions:[area('far',polygon(10000,10000))]}));assert.equal(r.ra.added,1);assert.deepEqual(r.p.supportProof.selectedCounts,[0,1,0]);assert.equal(r.report.rows,4);assert.equal(r.p.projectedBytes.length,r.p.supportProof.projectedBytes);});
test('Float32 half-open boundaries, signed zero, close rounding and duplicate source order',()=>{equivalent(full({points:[point(-0,40),point(-Number.MIN_VALUE,40,2),point(511.9999999,40,3),point(512,40,4),point(512.00001,40,5),point(40,40,6),point(40,40,6),point(45,40,7)]}));});
test('closed halo touches, enclosing polygons, holes and distant MultiPolygon components',()=>{
 const hole=polygon(-1000,-1000,3000);hole.coordinates.push(polygon(20,20,80).coordinates[0]);
 equivalent(full({points:[point(40,40),point(200,200,2),point(300,300,8,{kind:2,source:'garden',tags:{height:'10'}})],areas:[area('garden',polygon(-1000,-1000,3000))],exclusions:[area('hole',hole),area('touch',polygon(529,40,20)),area('multi',{type:'MultiPolygon',coordinates:[polygon(9000,9000).coordinates,polygon(190,190,20).coordinates]})]}));
});
test('all last-wins area records kept even when later duplicate is distant',()=>{
 const s=full({points:[point(40,40,8,{kind:2,source:'garden'})],areas:[area('garden',polygon(0,0,200)),area('garden',polygon(9000,9000,100))]});const r=equivalent(s);assert.equal(r.scenery.areas.length,2);assert.equal(r.ra.reject.greenAreaBoundary,1);
 const incorrect={...s,areas:s.areas.slice(0,1)},a=fixture(),b=fixture();assert.notDeepEqual(applySceneryVegetation(a,s),applySceneryVegetation(b,incorrect));
});
test('deliberately missing touching exclusion or a hole changes actual helper result',()=>{
 const s=full({exclusions:[area('paving',polygon(30,30,20))]}),a=fixture(),b=fixture();assert.notDeepEqual(applySceneryVegetation(a,s),applySceneryVegetation(b,{...s,exclusions:[]}));
 const geometry=polygon(0,0,100);geometry.coordinates.push(polygon(20,20,60).coordinates[0]);const x=full({exclusions:[area('with-hole',geometry)]});assert.notDeepEqual(applySceneryVegetation(fixture(),x),applySceneryVegetation(fixture(),{...x,exclusions:[area('no-hole',polygon(0,0,100))]}));equivalent(x);
});
test('maximum bush crown, spacing, cap and duplicate seeds preserve decisions',()=>{const points=Array.from({length:105},(_,i)=>point(30+(i%10)*45,30+Math.floor(i/10)*40,i+100,{kind:2,source:'garden',tags:{height:'10'}}));points.push(points[0]);const r=equivalent(full({points,areas:[area('garden',polygon(0,0,512))]}));assert.equal(r.ra.total,96);assert.ok(r.ra.reject.cellCap>0);assert.equal(r.p.supportProof.maxRadius,16.205882352941178);});
test('physical road, missing ground, parking and blocked-site policy remains actual helper authority',()=>{
 for(const options of [{occupied:[[40,40,20]]},{blocked:()=>true}])equivalent(full(),options);
 withSource(full(),source=>{const {consumed}=projected(source);for(const change of [p=>{p.arrays[p.metadata.tables.coarseHeights].fill(0);p.arrays[p.metadata.tables.finePositions].fill(0);},p=>p.arrays[p.metadata.tables.fineFlags].fill(1)]){const a=fixture(),b=fixture();change(a);change(b);assert.deepEqual(applySceneryVegetation(a,full()),applySceneryVegetation(b,consumed.scenery));assert.deepEqual(a,b);}});
});
test('global exclusion errors survive selection and still reject in the actual helper',()=>withSource(full({exclusionErrors:{farMissingRelation:1}}),source=>{const {consumed}=projected(source);assert.throws(()=>applySceneryVegetation(fixture(),consumed.scenery),/complete explicit/);}));
test('opaque catalog and verified tokens reject forged manifests, reuse and origin substitutions',()=>{
 assert.throws(()=>projectScenerySupport(Object.freeze({}),selection),/opaque/);assert.throws(()=>consumeVerifiedScenerySupport({},{cell:[0,0],originXZ:[0,0]}),/opaque/);
 withSource(full(),source=>{const p=projectScenerySupport(openVerifiedSceneryCatalog(source).catalog,selection);const v=verifyScenerySupport({source,selection,projectedSha256:p.projectedSha256});assert.throws(()=>consumeVerifiedScenerySupport(v.token,{cell:[1,0],originXZ:[512,0]}),/substitution/);consumeVerifiedScenerySupport(v.token,{cell:[0,0],originXZ:[0,0]});assert.throws(()=>consumeVerifiedScenerySupport(v.token,{cell:[0,0],originXZ:[0,0]}),/single-use/);});
});
test('exposed bytes/proof cannot mutate private catalog, verification or consumed snapshot',()=>withSource(full(),source=>{
 const {catalog,report}=openVerifiedSceneryCatalog(source),p=projectScenerySupport(catalog,selection),expected=p.projectedSha256;assert.throws(()=>{report.rows=999;},TypeError);assert.throws(()=>{p.supportProof.selectedCounts[0]=999;},TypeError);p.projectedBytes.fill(0);
 const v=verifyScenerySupport({source,selection,projectedSha256:expected});p.supportProof={sourceSha256:'0'.repeat(64)};assert.equal(consumeVerifiedScenerySupport(v.token,{cell:[0,0],originXZ:[0,0]}).scenery.points[0].seed,1);
 assert.throws(()=>verifyScenerySupport({source,selection,projectedSha256:SHA(p.projectedBytes)}),/reconstruction/);
}));
test('full source SHA/size, selector, halo, code, cell-origin and datum pins fail closed',()=>withSource(full(),source=>{
 for(const bad of [{...source,sourceSha256:'0'.repeat(64)},{...source,sourceBytes:source.sourceBytes+1},{...source,codeProof:{...code,scenery:'0'.repeat(64)}}])assert.throws(()=>openVerifiedSceneryCatalog(bad),/hash|size|code/);
 const {catalog}=openVerifiedSceneryCatalog(source);for(const bad of [{...selection,haloMetres:16},{...selection,originXZ:[1,0]},{...selection,originXZ:[2**21,0],cell:[4096,0]},{...selection,selectorVersion:'caller-complete'}])assert.throws(()=>projectScenerySupport(catalog,bad),/binding/);
}));
test('nonJSON, duplicate keys, UTF8, root schema and malformed omitted features are rejected',()=>{
 const cases=['null','{}','{"areas":[],"areas":[]}',JSON.stringify(full())+'x',JSON.stringify(full()).replace('"version":1','"version":NaN'),JSON.stringify(full()).replace('"tree":1','"tree":01'),JSON.stringify(full()).replace('"tree":1','"tree":1.'),JSON.stringify(full({projection:{...full().projection,lat0:38}})),JSON.stringify(full({areas:[area('far',{type:'Point',coordinates:[9000,9000]})]})),JSON.stringify(full({exclusions:[area('far',{type:'Polygon',coordinates:[[[9000,9000],[9001,9000],[9001,9001],[9000,9001]]]})]})),JSON.stringify(full({points:[point(9000,9000,1,{tags:{height:10}})]}))];
 for(const s of cases)withSource(s,source=>assert.throws(()=>openVerifiedSceneryCatalog(source),/Scenery projection/));
 withSource(full(),(source,path)=>{const b=fs.readFileSync(path),at=b.indexOf('OpenStreetMap');b[at]=255;fs.writeFileSync(path,b);assert.throws(()=>openVerifiedSceneryCatalog({...source,sourceSha256:SHA(b)}),/UTF8/);});
});
test('budgets admit before source/catalog/projection/parser allocations; no cap increase',()=>withSource(full(),source=>{
 let allocs=0;const alloc=Buffer.alloc;Buffer.alloc=function(...a){allocs++;return alloc(...a);};try{assert.throws(()=>openVerifiedSceneryCatalog(source,{retainedBytes:64*1024**2}),/BEFORE allocation/);assert.equal(allocs,0);}finally{Buffer.alloc=alloc;}
 const {catalog}=openVerifiedSceneryCatalog(source);let parses=0;const parse=JSON.parse;JSON.parse=(...a)=>{parses++;return parse(...a);};try{assert.throws(()=>projectScenerySupport(catalog,selection,{retainedBytes:64*1024**2}),/BEFORE allocation/);assert.equal(parses,0);}finally{JSON.parse=parse;}
}));
test('changed selected chunks, file growth and truncation reject authenticated rereads',()=>withSource(full(),(source,path)=>{
 const {catalog}=openVerifiedSceneryCatalog(source);const original=fs.readFileSync(path);const changed=Buffer.from(original);changed[changed.indexOf('Synthetic')]=88;fs.writeFileSync(path,changed);assert.throws(()=>projectScenerySupport(catalog,selection),/chunk changed|TOCTOU/);fs.writeFileSync(path,Buffer.concat([original,Buffer.from(' ')]));assert.throws(()=>projectScenerySupport(catalog,selection),/size changed/);fs.writeFileSync(path,original.subarray(0,original.length-1));assert.throws(()=>projectScenerySupport(catalog,selection),/size changed/);
}));
test('source growth during the catalog stream is rejected before seal',()=>withSource(full(),(source,path)=>{
 const original=fs.readSync;let grew=false;fs.readSync=function(...args){const n=original(...args);if(!grew&&args[4]===0){grew=true;fs.appendFileSync(path,' ');}return n;};syncBuiltinESMExports();try{assert.throws(()=>openVerifiedSceneryCatalog(source),/size|TOCTOU|growth/);}finally{fs.readSync=original;syncBuiltinESMExports();}
}));
test('expected byte snapshots use true backing slots and never invoke shadows',()=>{
 const b=Buffer.from('{}');assert.equal(assertProjectedBytes(b,SHA(b)).bytes,2);assert.throws(()=>assertProjectedBytes(b,'0'.repeat(64)),/changed/);
 let calls=0;Object.defineProperty(b,'byteLength',{get(){calls++;return 2;}});assert.throws(()=>assertProjectedBytes(b,SHA('{}')),/shadow/);assert.equal(calls,0);
 const v=new Uint8Array(new ArrayBuffer(1024),0,2);Object.defineProperty(v,'buffer',{value:new ArrayBuffer(2)});assert.throws(()=>assertProjectedBytes(v,SHA('{}')),/shadow/);
});


test('callbacks/accessors, array extras and opaque-token proxies reject without invocation',()=>withSource(full(),source=>{
 let calls=0;const bad={...source};Object.defineProperty(bad,'sourcePath',{enumerable:true,get(){calls++;throw Error('callback');}});assert.throws(()=>openVerifiedSceneryCatalog(bad),/accessor/);
 const options={};Object.defineProperty(options,'retainedBytes',{enumerable:true,get(){calls++;return 0;}});assert.throws(()=>openVerifiedSceneryCatalog(source,options),/accessor/);
 const {catalog}=openVerifiedSceneryCatalog(source),cell=[0,0];Object.defineProperty(cell,'extra',{get(){calls++;return 0;}});assert.throws(()=>projectScenerySupport(catalog,{...selection,cell}),/own fields/);assert.throws(()=>projectScenerySupport(new Proxy(catalog,{}),selection),/opaque/);assert.equal(calls,0);
}));
test('changed policy source ABI rejects even a newly computed matching code pin',()=>withSource(full(),source=>{
 const original=fs.readSync;fs.readSync=function(...args){const n=original(...args);const out=args[1];if(out.subarray(0,n).includes(Buffer.from('Scenery-only reducer')))out[0]=32;return n;};syncBuiltinESMExports();try{const changed=sceneryProjectionCodeProof();assert.notEqual(changed.scenery,code.scenery);assert.throws(()=>openVerifiedSceneryCatalog({...source,codeProof:changed}),/maximum crown ABI/);}finally{fs.readSync=original;syncBuiltinESMExports();}
}));
test('consumption uses the immutable authenticated support snapshot after source/exposed bytes change',()=>withSource(full(),(source,path)=>{
 const p=projectScenerySupport(openVerifiedSceneryCatalog(source).catalog,selection),v=verifyScenerySupport({source,selection,projectedSha256:p.projectedSha256});fs.writeFileSync(path,'{}');p.projectedBytes.fill(0);const read=consumeVerifiedScenerySupport(v.token,{cell:[0,0],originXZ:[0,0]});assert.equal(read.scenery.points.length,1);assert.equal(read.binding.sourceSha256,source.sourceSha256);
}));
test('point selection covers native number parsing near every tile edge and origin precision bound',()=>{
 let seed=12345;const points=[];for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const delta=(seed/2**32-0.5)*0.0001;points.push(point(i%2?512+delta:delta,40+i*0.5,i+1));}equivalent(full({points}));
 const shifted=full({points:[point(1048576+40,-1048576+40)]});withSource(shifted,source=>{const sel={...selection,cell:[2048,-2048],originXZ:[1048576,-1048576]},r=projected(source,sel);assert.equal(r.consumed.scenery.points.length,1);});
});

test('whole touching/hole geometry is retained byte-for-byte and far duplicates preserve all lookup records',()=>{
 const g=polygon(-1000,-1000,3000);g.coordinates.push(polygon(20,20,80).coordinates[0]);const s=full({exclusions:[area('enclosing-hole',g),area('corner',polygon(529,529,5)),area('distant',polygon(9000,9000))]});
 withSource(s,source=>{const {consumed}=projected(source);assert.deepEqual(consumed.scenery.exclusions,s.exclusions.slice(0,2));for(const k of Object.keys(s))if(!['areas','points','exclusions'].includes(k))assert.deepEqual(consumed.scenery[k],s[k]);});
});
test('actual building crown, upper deck, explicit surface and steep ground decisions stay equivalent',()=>withSource(full(),source=>{
 const {consumed}=projected(source);const changes=[
  p=>{const t=p.metadata.tables;p.arrays[t.buildings]=new Uint32Array([1,0,4,0]);p.arrays[t.buildingCorners]=new Float32Array([30,30,50,30,50,50,30,50]);},
  p=>{const t=p.metadata.tables;p.arrays[t.contactPositions]=new Float32Array([0,200,0,512,200,0,0,200,512]);p.arrays[t.contactTriangles]=new Uint32Array([0,1,2,0,1]);},
  p=>p.arrays[p.metadata.tables.fineSurface].fill(0),
  p=>{const a=p.arrays[p.metadata.tables.finePositions];a[4]=300;a[7]=300;a[10]=300;},
 ];
 for(const change of changes){const a=fixture(),b=fixture();change(a);change(b);const x=applySceneryVegetation(a,full()),y=applySceneryVegetation(b,consumed.scenery);assert.deepEqual(x,y);assert.equal(x.added,0);assert.deepEqual(a,b);}
}));
test('duplicate escaped keys and invalid far feature schemas are never omitted to gain admission',()=>{
 withSource(JSON.stringify(full()).replace('"tree":1','"tree":1,"\\u0074ree":2'),source=>assert.throws(()=>openVerifiedSceneryCatalog(source),/duplicate/));
 for(const change of [p=>delete p.seed,p=>p.kind=3,p=>p.seed=1.5,p=>p.x='9000',p=>p.extra=1]){const p=point(9000,9000);change(p);withSource(full({points:[p]}),source=>assert.throws(()=>openVerifiedSceneryCatalog(source),/missing|schema|JSON/));}
});

test('compact full-support roundtrip keeps original byte SHA and order exactly',()=>withSource(full({areas:[area('garden',polygon(0,0,512))],exclusions:[area('inside',polygon(200,200,10))]}),source=>{
 const {catalog}=openVerifiedSceneryCatalog(source),p=projectScenerySupport(catalog,selection);assert.equal(p.projectedSha256,source.sourceSha256);assert.equal(p.projectedBytes.length,source.sourceBytes);
}));

test('source-ID UTF16 equality preserves escaped/Unicode duplicate last-wins semantics',()=>{
 const id='garden:δ:🌳',s=full({points:[point(40,40,8,{kind:2,source:id})],areas:[area(id,polygon(0,0,200)),area(id,polygon(9000,9000,100))]});equivalent(s);
 const raw=JSON.stringify(s),at=raw.lastIndexOf(id),escaped=raw.slice(0,at)+raw.slice(at).replace(id,'garden:\\u03b4:\\ud83c\\udf33');withSource(escaped,source=>{const r=projected(source);assert.equal(r.consumed.scenery.areas.length,2);assert.equal(applySceneryVegetation(fixture(),r.consumed.scenery).reject.greenAreaBoundary,1);});
 withSource(raw.replace('garden:δ:🌳','garden:\\ud800'),source=>assert.throws(()=>openVerifiedSceneryCatalog(source),/unpaired/));
});

test('consume reserves all overlapping histories before any projected JSON parse',()=>withSource(full(),source=>{
 const p=projectScenerySupport(openVerifiedSceneryCatalog(source).catalog,selection),v=verifyScenerySupport({source,selection,projectedSha256:p.projectedSha256});let calls=0;const parse=JSON.parse;JSON.parse=(...args)=>{calls++;return parse(...args);};try{assert.throws(()=>consumeVerifiedScenerySupport(v.token,{cell:[0,0],originXZ:[0,0],retainedBytes:64*1024**2}),/BEFORE allocation/);assert.equal(calls,0);}finally{JSON.parse=parse;}assert.equal(consumeVerifiedScenerySupport(v.token,{cell:[0,0],originXZ:[0,0]}).scenery.points.length,1);
}));
