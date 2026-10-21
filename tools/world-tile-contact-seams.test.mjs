import{test}from'node:test';import assert from'node:assert/strict';import{fixture}from'./world-tile-format.test.mjs';import{sampleContactSeam}from'./validate-world-tile-contacts.mjs';
function ground(cell){const p=fixture(cell);p.arrays[p.metadata.tables.finePositions]=new Float32Array([0,0,0,512,0,0,0,0,512,512,0,512]);p.arrays[p.metadata.tables.fineTriangles]=new Uint32Array([0,2,1,1,2,3]);return p;}
test('contact seam samples every metre, vertices and midpoints across actual indexed surfaces',()=>{
 const a=ground([0,0]),b=ground([1,0]),result=sampleContactSeam(a,b);assert.ok(result.samples>2000);assert.equal(result.missing,0);assert.equal(result.maxDelta,0);assert.deepEqual(result.failures,[]);
 const right=b.arrays[b.metadata.tables.finePositions];right[4]=right[10]=8;const sloped=sampleContactSeam(a,b);assert.ok(sloped.maxDelta<.00001);assert.deepEqual(sloped.failures,[]);
});
test('sampling rejects a terrain coverage hole even when its edge vertices are retained',()=>{
 const a=ground([0,0]),b=ground([1,0]);b.arrays[b.metadata.tables.fineTriangles]=new Uint32Array([0,1,3]);assert.throws(()=>sampleContactSeam(a,b),/cracked seam/);
});
test('real road-ending curb transitions are reported, and oversized steps fail',()=>{
 for(const height of [.1,.3]){const a=ground([0,0]),b=ground([1,0]);a.arrays[a.metadata.tables.contactPositions]=new Float32Array([512,height,256,510,height,255,510,height,257]);a.arrays[a.metadata.tables.contactTriangles]=new Uint32Array([0,1,2,0,1]);a.arrays[a.metadata.tables.contactLayers]=new Int8Array(1);const result=sampleContactSeam(a,b);assert.equal(result.missing,0);assert.ok(result.transitionSamples>0);assert.ok(result.maxTransitionDelta>=height-.00001);assert.equal(result.failures.length>0,height>.15);}
});

test('lower overlapping road fans cannot steal contact from the shared top road within one layer',()=>{
 const a=ground([0,0]),b=ground([1,0]);for(const p of[a,b]){p.arrays[p.metadata.tables.contactPositions]=new Float32Array([0,1,0,512,1,0,0,1,512,512,1,512]);p.arrays[p.metadata.tables.contactTriangles]=new Uint32Array([0,2,1,0,1,1,2,3,0,1]);p.arrays[p.metadata.tables.contactLayers]=new Int8Array(2);}
 b.arrays[b.metadata.tables.contactPositions]=new Float32Array([...b.arrays[b.metadata.tables.contactPositions],0,.96,256,1,.96,255,1,.96,257]);b.arrays[b.metadata.tables.contactTriangles]=new Uint32Array([...b.arrays[b.metadata.tables.contactTriangles],4,5,6,0,1]);b.arrays[b.metadata.tables.contactLayers]=new Int8Array(3);
 const result=sampleContactSeam(a,b);assert.equal(result.missing,0);assert.ok(result.maxDelta<.00001);assert.deepEqual(result.failures,[]);
});

test('a diagonal bridge corner compares each physical layer at the boundary and rejects missing or shifted floors',()=>{
 const a=ground([0,0]),b=ground([1,0]);
 for(const [p,positions]of [[a,[512,6,256,510,6,255,510,6,257]],[b,[0,6,256,1,6,257,2,6,259]]]){
  p.arrays[p.metadata.tables.contactPositions]=new Float32Array(positions);
  p.arrays[p.metadata.tables.contactTriangles]=new Uint32Array([0,1,2,0,2]);
  p.arrays[p.metadata.tables.contactLayers]=new Int8Array([1]);
 }
 const result=sampleContactSeam(a,b);assert.ok(result.layerTransitions>0);assert.ok(result.maxLayerTransitionDelta>5.9);assert.equal(result.maxLayerBoundaryDelta,0);assert.deepEqual(result.failures,[]);
 b.arrays[b.metadata.tables.contactLayers][0]=2;
 assert.ok(sampleContactSeam(a,b).failures.some(f=>f.missingLayerBoundary),'a different layer cannot stand in for the bridge floor');
 b.arrays[b.metadata.tables.contactLayers][0]=1;b.arrays[b.metadata.tables.contactPositions][1]=6.1;
 assert.ok(sampleContactSeam(a,b).failures.some(f=>f.layerBoundary),'the same 2 cm height gate applies at the corner');
});
