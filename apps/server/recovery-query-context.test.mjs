import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryQueryBuilder} from '../../server/recovery-query-context.mjs';
const anchor=i=>({halfLength:2,halfWidth:1,layer:0,leftM:3,offsetM:i,rightM:3,x:i,y:1,yaw:.12,z:-i,edgeId:'edge:'+i%7,roadId:'road:'+i%3,surfaceId:'surface',footprints:[{halfLength:2,halfWidth:1}],safe:i%4!==0,extension:{exact:'metadata'}});
test('packed query retains every exact ordered record, deduplicates only old identity and survives caller mutation',()=>{
 const builder=createRecoveryQueryBuilder({maxBytes:2*1024*1024}),source=Array.from({length:1500},(_,i)=>anchor(i));
 for(const a of source)builder.add(a);builder.add({...source[0],safe:true});
 const edges=Array.from({length:1000},(_,i)=>({id:'edge:'+i,layer:i%3,surface:'surface:'+i%4,flags:i%9}));for(const e of edges){builder.addEdge(e);builder.addEdge(e);}
 const context=builder.finish();assert.equal(context.candidates.length,1500);assert.deepEqual([...context.candidates],source);assert.deepEqual([...context.edges],edges);
 for(const e of edges){assert.deepEqual(context.edgeFor(e.id),e);assert.equal(context.hasSurface(e.layer,e.surface),true);}assert.equal(context.edgeFor('absent'),null);assert.equal(context.hasSurface(4,'absent'),false);
 source[0].extension.exact='changed';source[0].footprints[0].halfWidth=900;assert.equal([...context.candidates][0].extension.exact,'metadata');assert.equal([...context.candidates][0].footprints[0].halfWidth,1);
 assert.throws(()=>builder.add(anchor(2000)),/finalized/);assert.ok(context.peakBytes<=2*1024*1024);
});
test('packed context fails closed before overbudget allocation and refuses unchecked materialization',()=>{
 assert.throws(()=>createRecoveryQueryBuilder({maxBytes:1}),/candidate memory/);
 const b=createRecoveryQueryBuilder({maxBytes:60000});let rejected=false;try{for(let i=0;i<10000;i++)b.add(anchor(i));}catch(error){rejected=true;assert.match(error.message,/candidate memory/);assert.ok(error.memory.peak>60000);}assert.ok(rejected);
 const c=createRecoveryQueryBuilder({maxBytes:60000});for(let i=0;i<5;i++)c.add(anchor(i));const context=c.finish();assert.equal([...context.candidates].length,5);assert.throws(()=>context.candidates.map(a=>({...a,huge:'x'.repeat(100000)})),/candidate memory/);
});

test('unknown own JSON __proto__ metadata remains inert and exact',()=>{const a=JSON.parse(JSON.stringify(anchor(0)).slice(0,-1)+',"__proto__":{"proof":true}}');const b=createRecoveryQueryBuilder({maxBytes:100000});b.add(a);const c=b.finish();assert.deepEqual([...c.candidates][0],a);assert.equal(Object.getPrototypeOf([...c.candidates][0]),Object.prototype);assert.throws(()=>b.addEdge({id:'later',layer:0,surface:'road',flags:1}),/finalized/);assert.throws(()=>b.finish(),/finalized/);});
