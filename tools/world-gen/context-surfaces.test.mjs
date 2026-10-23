import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {source,wallRecord,ref} from './fixtures/context-synthetic.mjs';
import {prepareContextCell,compileMappedWallProfile,compileStructureBoundaries} from './context-surfaces.mjs';
async function setup(options={}){
 const a=source(options),b=source({...options,cell:[1,0]}),proofs=await Promise.all([a,b].map(prepareContextCell)),wall=wallRecord();
 const spans=[{from:0,to:2,top:ref(a,'contactTriangles',0,'surface:top',1),bottom:ref(a,'fineTriangles',0,'terrain:0,0',0)},
  {from:2,to:4,top:ref(b,'contactTriangles',1,'surface:top',1),bottom:ref(b,'fineTriangles',1,'terrain:1,0',0)}];
 return{a,b,proofs,input:{...wall,retainedSide:'left',spans}};
}
test('wall profiles bind exact original compressed identities and actual triangle owners across a seam',async()=>{
 const {proofs,input}=await setup(),result=compileMappedWallProfile(input,proofs),fixture=JSON.parse(readFileSync(new URL('./fixtures/structure-context.json',import.meta.url)));
 assert.equal(result.sha256,fixture.wall.certificateSha256);assert.equal(result.bytes.toString(),fixture.wall.certificate);
 const p=JSON.parse(result.bytes);assert.equal(p.releaseEligible,false);assert.deepEqual(p.spans.map(s=>[s.a.top,s.a.bottom,s.b.top,s.b.bottom]),[[6,0,6,0],[6,0,6,0]]);assert.equal(p.sources.length,2);assert.equal(result.triangles,4);
});
test('source SHA, byte budget and packet/entry identity failures reject before certification',async()=>{
 for(const mutate of [s=>s.entry.sha256='0'.repeat(64),s=>s.entry.bytes++,s=>s.entry.source.world='wrong',s=>s.revision='wrong']){const s=source();mutate(s);await assert.rejects(prepareContextCell(s),/source|mismatch/);}
});
test('wall source geometry and source-record provenance cannot be swapped',async()=>{
 const{proofs,input}=await setup();const bad=structuredClone(input);bad.record.geometrySha256='0'.repeat(64);assert.throws(()=>compileMappedWallProfile(bad,proofs),/geometry hash/);
 const version=structuredClone(input);version.record.version++;assert.throws(()=>compileMappedWallProfile(version,proofs),/record hash/);
});
test('missing, wrong-cell, wrong-owner, wrong-layer and ambiguous support references fail closed',async()=>{
 for(const change of [s=>delete s.top,s=>s.top.owner='surface:unrelated',s=>s.top.layer=0,s=>s.top.sourceSha256='0'.repeat(64),s=>s.top=[s.top]]){
  const{proofs,input}=await setup();change(input.spans[0]);assert.throws(()=>compileMappedWallProfile(input,proofs),/support|source cell/);
 }
 const{proofs,input}=await setup({ambiguous:true});assert.throws(()=>compileMappedWallProfile(input,proofs),/ambiguous owner elevation/);
});
test('profile gaps, source bends, omitted cells and inverted height spans are rejected',async()=>{
 const{proofs,input}=await setup();const gap=structuredClone(input);gap.spans.shift();assert.throws(()=>compileMappedWallProfile(gap,proofs),/gap/);
 const short=structuredClone(input);short.spans.pop();assert.throws(()=>compileMappedWallProfile(short,proofs),/end coverage gap/);
 assert.throws(()=>compileMappedWallProfile(input,proofs.slice(0,1)),/source cell/);
 const inverted=await setup({top:-1});assert.throws(()=>compileMappedWallProfile(inverted.input,inverted.proofs),/inverted/);
 const bend=wallRecord([[510,10],[511,11],[512,10]]),bent={...input,...bend};assert.throws(()=>compileMappedWallProfile(bent,proofs),/bend/);
});
test('actual road carriageway clearance intrusion is rejected, without closest-road height selection',async()=>{
 const{proofs,input}=await setup({intrusion:true});assert.throws(()=>compileMappedWallProfile(input,proofs),/road clearance intrusion/);
});
test('sealed source tokens, retained side and explicit boundary graph hash are mandatory',async()=>{
 const{proofs,input}=await setup();assert.throws(()=>compileMappedWallProfile(input,[{}]),/unsealed/);
 assert.throws(()=>compileMappedWallProfile({...input,retainedSide:'guess'},proofs),/retained side/);
 assert.throws(()=>compileStructureBoundaries({sourceGraphSha256:'',nodes:{}},proofs),/source graph/);
});

test('interior-only sliver ambiguity and road intrusion cannot evade endpoint/midpoint checks',async()=>{
 for(const sliver of ['ambiguity','intrusion']){const{proofs,input}=await setup({sliver});assert.throws(()=>compileMappedWallProfile(input,proofs),sliver==='ambiguity'?/ambiguous owner elevation/:/road clearance intrusion/);}
});
