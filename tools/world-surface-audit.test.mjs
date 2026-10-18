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

test('AWT physical audit preserves the solved twenty-percent profile grade bound',()=>{
  const t=fixture({roadGrade:.3});t.edgePoints=[0,0,10,256,76.8,10];t.edges=[1,1,2,0,2,0,1,50,0,1];
  const r=auditWorldSurface(t);assert.equal(r.asphaltAbove30,0);assert.ok(r.maxProfileGrade>.2);assert.equal(r.passed,false);
});
