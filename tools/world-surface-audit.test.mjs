import test from 'node:test';
import assert from 'node:assert/strict';
import {auditWorldSurface} from './world-surface-audit.mjs';
function fixture({roadGrade=0,shoulderGrade=0}={}) {
  // Flat asphalt left of x=256; shared vertices make a continuous shoulder.
  const positions=[0,0,0,0,0,512,256,roadGrade*256,0,256,roadGrade*256,512,512,(roadGrade+shoulderGrade)*256,0,512,(roadGrade+shoulderGrade)*256,512];
  return {finePositions:new Float32Array(),fineTriangles:new Uint32Array(),contactPositions:new Float32Array(positions),contactTriangles:new Uint32Array([0,1,2,1,1,2,1,3,1,1,2,3,4,2,2,4,3,5,2,2]),contactLayers:new Int8Array(4)};
}
test('AWT physical audit accepts drivable asphalt and six-metre shoulders',()=>{
  const r=auditWorldSurface(fixture({roadGrade:.1,shoulderGrade:.3}));
  assert.equal(r.passed,true);assert.ok(r.shoulderSamples>1000);assert.equal(r.missingContacts,0);assert.ok(r.maxShoulderStep<=.15);
});
test('AWT physical audit rejects steep asphalt, not just cracks',()=>{
  const r=auditWorldSurface(fixture({roadGrade:.6}));assert.equal(r.passed,false);assert.equal(r.asphaltAbove30,2);
});
test('AWT physical audit rejects a continuous but wall-like shoulder',()=>{
  const r=auditWorldSurface(fixture({shoulderGrade:.7}));assert.equal(r.asphaltAbove30,0);assert.equal(r.passed,false);assert.ok(r.maxShoulderStep>.15);
});

test('AWT physical audit does not hide missing faces behind coarse terrain',()=>{
  const t=fixture();t.contactTriangles=t.contactTriangles.slice(0,15);
  t.coarseHeights=new Float32Array(1089);
  const r=auditWorldSurface(t);assert.equal(r.passed,false);assert.ok(r.missingContacts>0);
});

test('AWT physical audit bounds emitted graph profile grade at forty-five percent',()=>{
  const t=fixture({roadGrade:.3});t.edgePoints=[0,0,10,256,128,10];t.edges=[1,1,2,0,2,0,1,50,0,1];
  const r=auditWorldSurface(t);assert.equal(r.asphaltAbove30,0);assert.ok(r.maxProfileGrade>.45);assert.equal(r.passed,false);
});

test('a graph edge past the profile grade names its road, so the steep-street planner can leave it out',()=>{
  const t=fixture({roadGrade:.3});t.edgePoints=[0,0,10,256,128,10];t.edges=[1,1,2,0,2,0,1,50,0,1];
  const r=auditWorldSurface(t,{ids:['','surface:w7:0']});assert.equal(r.passed,false);assert.deepEqual(r.offenders,['w7:0']);
  t.edgePoints=[0,0,10,256,100,10];assert.deepEqual(auditWorldSurface(t,{ids:['','surface:w7:0']}).offenders,[],'45% or less names nobody');
});

// Owner exception (2026-10-18): literal OSM bridge=yes and connected
// approaches may use a 0.25 m shoulder protected by solid visible guardrails.
// Every ground road and every undeclared elevated road still sweeps six metres.
test('guarded OSM bridge exception is explicit, surface-specific and never weakens ground gates',()=>{
  const t=fixture();t.contactPositions[12]=t.contactPositions[15]=256.75;t.contactLayers.fill(1);
  const options={ids:['','surface:w1:0','ground'],structures:[{kind:'osm-bridge-guarded',layer:1,shoulderMetres:.25,bridgeSources:['w1:0'],roads:['w1:0']}]};
  assert.equal(auditWorldSurface(t).passed,false,'layer alone grants no exception');
  const r=auditWorldSurface(t,options);assert.equal(r.passed,true);assert.ok(r.guardedShoulderSamples>0);
  assert.equal(auditWorldSurface(t,{...options,ids:['','surface:unrelated','ground']}).passed,false);
  t.contactLayers.fill(0);assert.equal(auditWorldSurface(t,options).passed,false,'six metres on ground even with matching source ID');
  assert.throws(()=>auditWorldSurface(t,{...options,structures:[{...options.structures[0],bridgeSources:[]}]}),/Invalid guarded/);
  t.contactLayers.fill(1);for(let i=1;i<t.contactPositions.length;i+=3)t.contactPositions[i]=t.contactPositions[i-1]*.7;
  assert.equal(auditWorldSurface(t,options).passed,false,'bridge asphalt still obeys thirty degrees');
});

// A long raised approach reaches cells that hold none of its bridge ways: the record names the bridge elsewhere (approachOnly) and
// guards the approach roads this cell does hold; without the flag a bridge source absent from `roads` is still invalid.
test('an approach-only structure record guards the loaded approach roads but never a record that names none',()=>{
  const t=fixture();t.contactPositions[12]=t.contactPositions[15]=256.75;t.contactLayers.fill(1);
  const record={kind:'osm-bridge-guarded',layer:1,shoulderMetres:.25,bridgeSources:['w9:0'],roads:['w1:0']},ids=['','surface:w1:0','ground'];
  assert.throws(()=>auditWorldSurface(t,{ids,structures:[record]}),/Invalid guarded/);
  const r=auditWorldSurface(t,{ids,structures:[{...record,approachOnly:true}]});assert.equal(r.passed,true);assert.ok(r.guardedShoulderSamples>0);
  assert.throws(()=>auditWorldSurface(t,{ids,structures:[{...record,approachOnly:true,roads:[]}]}),/Invalid guarded/);
});

test('six-metre shoulder sweep crosses only an explicitly supported bore floor layer',()=>{
 const p=[],tri=[],layers=[];for(const x of[0,256,258,260,512])p.push(x,0,0,x,0,512);
 for(let k=0;k<4;k++){const a=k*2,b=a+1,c=a+2,d=a+3,surface=k===2?3:k===0?1:2,flags=k===0||k===2?1:2;tri.push(a,b,c,surface,flags,b,d,c,surface,flags);layers.push(k===2?-1:0,k===2?-1:0);}
 const t={finePositions:[],fineTriangles:[],contactPositions:p,contactTriangles:tri,contactLayers:layers};
 const options={ids:['','surface:approach','ground','surface:w172988026:0'],tunnelBores:[{id:'w172988026:0',layer:-1}]};
 assert.equal(auditWorldSurface(t).passed,false);
 const r=auditWorldSurface(t,options);assert.equal(r.passed,true);assert.ok(r.shoulderSamples>1000);assert.equal(r.missingContacts,0);
 assert.equal(auditWorldSurface(t,{...options,ids:['','surface:approach','ground','surface:unrelated']}).passed,false);
 for(let i=0;i<p.length;i+=3)if(p[i]>=258)p[i+1]=(p[i]-258)*.7;
 assert.equal(auditWorldSurface(t,options).passed,false,'the same step/grade limit still applies at a portal');
});
