import test from 'node:test';import assert from 'node:assert/strict';
import {auditBridgeGuards} from './world-bridge-audit.mjs';
function fixture(){
 const t={contactPositions:[0,0,0,0,0,100,100,0,0,100,0,100,40,6,20,40,6,80,50,6,20,50,6,80],contactTriangles:[0,1,2,1,1,2,1,3,1,1,4,5,6,2,1,6,5,7,2,1],contactLayers:[0,0,1,1],edges:[],anchors:[]};
 const m={ids:['','ground','surface:bridge'],structures:[{roads:['bridge']}],meshes:[{userData:{bridgeGuard:true}}],rails:[[40,6,20,40,6,80,.65],[40,6,80,50,6,80,.65],[50,6,80,50,6,20,.65],[50,6,20,40,6,20,.65]]};return {t,m};
}
test('guarded OSM bridge exception retains full-width underpass clearance, visible collision rails and safe anchors',()=>{
 const {t,m}=fixture(),r=auditBridgeGuards(t,m);assert.equal(r.passed,true);assert.ok(r.edgeSamples>100);assert.ok(r.clearanceSamples>100);assert.ok(Math.abs(r.minClearance-5.5)<1e-10);
 m.rails.pop();assert.equal(auditBridgeGuards(t,m).passed,false,'exposed deck edge must have a collider');
});
test('bridge guard gate rejects invisible rails and low headroom',()=>{
 const {t,m}=fixture();m.meshes=[];assert.equal(auditBridgeGuards(t,m).passed,false);m.meshes=[{userData:{bridgeGuard:true}}];
 for(let i=13;i<t.contactPositions.length;i+=3)t.contactPositions[i]=4;
 const r=auditBridgeGuards(t,m);assert.equal(r.passed,false);assert.ok(r.blocked>0);
});
test('tow/respawn anchors on guarded bridge ways or their approaches are rejected',()=>{
 const {t,m}=fixture();t.edges=[3,0,0,0,2,0,1,50,0,2];t.edgeLayers=[1];t.anchors=[4,0,3,1,0];assert.equal(auditBridgeGuards(t,m).unsafeAnchors,1);
});
