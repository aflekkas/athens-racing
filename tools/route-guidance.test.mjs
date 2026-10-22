import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {decisionPoints,routeMetrics,sampleRoute,projectRoute,GuidanceChunks,decisionOpacity} from '../src/route-guidance/route.js';
import {RoutePaint} from '../src/route-guidance/paint.js';
import {RouteGuidance} from '../src/route-guidance.js';
import {drawRouteOverlay} from '../src/route-guidance/minimap.js';
import {WorldRoadGraph} from '../src/world-tile-graph.js';
const route=[[0,0,0],[100,0,0],[100,0,100]];
function graph(){const g=new WorldRoadGraph();for(const [id,x,z]of[['a',0,0],['b',100,0],['c',100,100],['d',200,0]])g.nodes.set(id,{value:{id,x,y:0,z}});
 for(const [id,from,to]of[['ab','a','b'],['bc','b','c'],['bd','b','d'],['ba','b','a'],['db','d','b']]){const a=g.nodes.get(from).value,b=g.nodes.get(to).value;g.edges.set(id,{value:{id,from,to,points:[[a.x,0,a.z],[b.x,0,b.z]],flags:0,layer:0}});}return g;}
test('heading fallback handles empty, duplicate, straight, reverse and left/right routes',()=>{
 assert.deepEqual(decisionPoints([]),[]);assert.deepEqual(decisionPoints([[0,0],[0,0],[10,0],[20,0]]),[]);
 const d=decisionPoints(route);assert.equal(d.length,1);assert.equal(d[0].s,100);assert.equal(d[0].source,'heading');assert.ok(d[0].angle>0);
 assert.ok(decisionPoints([...route].reverse())[0].angle<0);assert.throws(()=>decisionPoints([[NaN,0],[0,0]]),/Nonfinite/);
});
test('directed junction identifies wrong branch, excludes incoming-only and U-turn edges, obeys turn restrictions',()=>{
 const g=graph(),d=decisionPoints(route,g);assert.equal(d.length,1);assert.equal(d[0].source,'graph');assert.deepEqual(d[0].wrong.map(e=>e.edge),['bd']);
 g.turns.set('no',{value:{from:'ab',via:'b',to:'bd',rule:1}});assert.deepEqual(decisionPoints(route,g)[0].wrong,[]);
 g.turns.clear();g.turns.set('only',{value:{from:'ab',via:'b',to:'bc',rule:2}});assert.deepEqual(decisionPoints(route,g)[0].wrong,[]);
});
test('graph finds a choice on a straight sparse polyline and ignores grade-separated nodes',()=>{
 const g=graph(),straight=[[0,0,0],[200,0,0],[300,0,0]],d=decisionPoints(straight,g);
 assert.equal(d.length,1);assert.equal(d[0].s,100);assert.deepEqual(d[0].wrong.map(e=>e.edge),['bc']);
 for(const {value:n}of g.nodes.values())n.y=20;assert.deepEqual(decisionPoints(straight,g),[]);
});
test('plain array graph and legacy graph Map nodes with point-free directed edges work',()=>{
 const g=graph(),plain={nodes:[...g.nodes.values()].map(v=>v.value),edges:[...g.edges.values()].map(v=>v.value)};
 assert.equal(decisionPoints(route,plain)[0].wrong.length,1);
 plain.nodes=new Map(plain.nodes.map(n=>[n.id,n]));plain.edges=plain.edges.map(({points,...e})=>e);
 assert.equal(decisionPoints(route,plain)[0].wrong.length,1);
});
test('height interpolation, route projection and fade envelope',()=>{
 const r=routeMetrics([[0,2,0],[100,12,0]]);assert.equal(sampleRoute(r,50).y,7);assert.equal(projectRoute(r,{x:35,z:3}).s,35);
 assert.equal(decisionOpacity(81),0);assert.equal(decisionOpacity(80),0);assert.equal(decisionOpacity(56),1);assert.equal(decisionOpacity(0),1);assert.equal(decisionOpacity(-4),.5);assert.equal(decisionOpacity(-8),0);
});
test('stream admission/eviction is bounded, repeatable and leaves no stale instances',()=>{
 const c=new GuidanceChunks(route,{maxInstances:8});c.setDecisions(decisionPoints(route,graph()));assert.equal(c.visible(90).length,0);
 c.addCell('0,0');assert.equal(c.visible(90).filter(r=>r.kind===0).length,4);assert.equal(c.visible(90).filter(r=>r.kind===1).length,0);
 assert.ok(c.visible(90).length<=8);c.removeCell('0,0');assert.deepEqual(c.visible(90),[]);c.addCell('0,0');assert.ok(c.visible(90).length);c.dispose();assert.deepEqual(c.visible(90),[]);
 const cap=new GuidanceChunks(route,{maxInstances:3});cap.setDecisions(decisionPoints(route));cap.addCell('0,0');assert.equal(cap.visible(100).length,3);
});
test('one InstancedMesh drapes corners, rebases, survives detail-off and releases GPU resources',()=>{
 const scene=new THREE.Scene(),paint=new RoutePaint(scene,route,{contact:(x,z)=>({y:x*.1+z*.02})});paint.setDecisions(decisionPoints(route,graph()));paint.addCell('0,0');paint.update(90);
 assert.equal(scene.children.length,1);assert.ok(paint.mesh.isInstancedMesh);assert.equal(paint.mesh.geometry.groups.length,0);assert.equal(paint.mesh.count,5);assert.ok(paint.material.isMeshBasicMaterial);assert.equal(paint.material.opacity,.36);
 assert.equal(paint.mesh.material.depthWrite,false);assert.equal(paint.mesh.material.transparent,true);assert.equal(paint.mesh.castShadow,false);
 assert.ok(paint.heights.array[0]!==paint.heights.array[1]||paint.heights.array[0]!==paint.heights.array[2]);
 const rebuilds=paint.stats.rebuilds;paint.update(91,{x:512,z:-512});assert.equal(paint.stats.rebuilds,rebuilds);assert.equal(paint.mesh.position.x,-512);assert.equal(paint.mesh.position.z,512);
 paint.removeCell('0,0');paint.update(91);assert.equal(paint.mesh.count,0);assert.equal(paint.mesh.visible,false);
 let disposed=0;paint.mesh.geometry.addEventListener('dispose',()=>disposed++);paint.material.addEventListener('dispose',()=>disposed++);paint.dispose();assert.equal(disposed,2);assert.equal(scene.children.length,0);
});
test('unloaded or non-road contact cannot receive paint, including corners across a cell seam',()=>{
 const p=new RoutePaint(new THREE.Scene(),route,{contact:()=>null});p.setDecisions(decisionPoints(route));p.addCell('0,0');p.update(90);assert.equal(p.mesh.count,0);p.dispose();
});
test('minimap splits at precise progress, highlights next turn, dims passed part',()=>{
 const strokes=[],g={beginPath(){this.path=[];},moveTo(x,z){this.path.push([x,z]);},lineTo(x,z){this.path.push([x,z]);},stroke(){strokes.push({colour:this.strokeStyle,path:this.path});}};
 drawRouteOverlay(g,routeMetrics(route),85,decisionPoints(route),1);assert.equal(strokes.length,3);assert.deepEqual(strokes[0].path.at(-1),[85,0]);assert.deepEqual(strokes[1].path[0],[85,0]);assert.equal(strokes[2].colour,'#f1dca3');
});
test('closed circuit wraps guidance across the seam with one timing stripe',()=>{
 const loop=[[0,0,0],[100,0,0],[100,0,100],[0,0,100],[0,0,0]],c=new GuidanceChunks(loop,{closed:true});
 c.setDecisions([{s:10,wrong:[]}]);c.addCell('0,0');const rows=c.visible(390);assert.equal(c.records.filter(r=>r.kind===2).length,1);
 assert.equal(rows.filter(r=>r.kind===0).length,4);assert.ok(rows.filter(r=>r.kind===0).every(r=>r.decisionS===410));assert.ok(rows.filter(r=>r.kind===0).some(r=>r.z>0&&r.x===0));
 c.removeCell('0,0');assert.equal(c.visible(390).length,0);
});
test('sparse two-point route still detects graph decisions; portal splits do not make decisions',()=>{
 const g=graph();assert.equal(decisionPoints([[0,0,0],[200,0,0]],g).length,1);
 g.edges.delete('bc');assert.equal(decisionPoints([[0,0,0],[200,0,0]],g).length,0);
});
const supplied=()=>({version:1,routeId:'fixture',geometryHash:'fixture',worldId:'athens',regionId:'basin',closed:false,lengthM:240,
 polyline:[{x:0,y:0,z:0,s:0,leftM:2,rightM:3,edgeId:'a',occurrence:0,layer:0,cell:'0,0'},{x:100,y:0,z:0,s:120,leftM:2,rightM:3,edgeId:'b',occurrence:1,layer:0,cell:'0,0'},{x:100,y:0,z:100,s:240,leftM:2,rightM:3,edgeId:'b',occurrence:1,layer:0,cell:'0,0'}],
 decisions:[{id:'turn',s:120,x:100,y:0,z:0,layer:0,fromEdge:'a',viaNode:'b',toEdge:'c',occurrence:1,incoming:[1,0],outgoing:[0,1],turn:'right',rejectedEdges:['side-road'],cell:'0,0'}],
 start:{x:0,y:0,z:0,yaw:-Math.PI/2,s:0,leftM:2,rightM:3,layer:0},finish:{x:100,y:0,z:100,yaw:-Math.PI,s:240,leftM:2,rightM:3,layer:0}});
test('§7 GuidanceDataV1 preserves supplied stations, exact stripe widths and lifecycle',()=>{
 const scene=new THREE.Scene(),v=new RouteGuidance(scene,{contact:()=>({y:0})});v.onTileActivated('0,0');v.setRoute(supplied());
 assert.equal(v.paint.chunks.route.length,240);assert.equal(sampleRoute(v.paint.chunks.route,120).x,100);
 v.update({cursorS:100,occurrence:0,lap:0,position:{x:80,z:0},heading:0,origin:{x:512,z:512},activeCells:new Set(['0,0']),isRace:true});
 assert.ok(v.stats.instances>0);assert.equal(v.paint.mesh.position.x,-512);assert.deepEqual(v.paint.chunks.records.filter(r=>r.kind===0).map(r=>r.s),[85,100,112,128]);
 const stripes=v.paint.chunks.records.filter(r=>r.kind===2);assert.ok(stripes.every(r=>r.length===.3&&r.width===5));
 assert.equal(v.paint.chunks.records.filter(r=>r.kind!==0&&r.kind!==2).length,0,'no disallowed-branch instance');
 v.update({cursorS:100,activeCells:new Set(),isRace:true});assert.equal(v.stats.instances,0);v.dispose();assert.equal(scene.children.length,0);
});
test('§7 isRace:false removes every visual, decision and minimap stroke and can resume',()=>{
 const v=new RouteGuidance(new THREE.Scene(),{contact:()=>({y:0})});v.setRoute(supplied());v.onTileActivated('0,0');v.update({cursorS:100,isRace:true});assert.ok(v.stats.instances);
 v.update({cursorS:100,isRace:false});assert.equal(v.paint.mesh.visible,false);assert.equal(v.paint.mesh.count,0);assert.deepEqual(v.decisions,[]);
 v.drawMinimap({beginPath(){throw Error('free roam must not draw');}});
 v.update({cursorS:100,isRace:true});assert.ok(v.paint.mesh.visible);v.setRoute(null);assert.equal(v.paint,null);v.dispose();
});

test('Quick Race adapts only the selected event, reverses arrows and keeps its existing timing marks',async()=>{
 const {legacyGuidanceData,createLegacyGuidance}=await import('../src/route-guidance/legacy.js');
 const road={closed:false,length:300,point:(s,u)=>({x:s,y:0,z:u}),laneU:()=>2,edge:()=>6,project:(x,z)=>({s:x,u:z})};
 const map={id:'test',route:road,data:{sideRoads:[{p:[180,0,180,20]},{f:true,p:[210,0,210,20]}]}};
 const forward={s0:50,s1:250,dir:1,closed:false},data=legacyGuidanceData(map,forward,[{s:100},{s:280}]);
 assert.deepEqual(data.decisions.map(d=>d.s),[50,130]);assert.equal(data.polyline[0].x,50);assert.equal(data.polyline.at(-1).x,250);
 const back=legacyGuidanceData(map,{s0:250,s1:50,dir:-1,closed:false},[{s:100}]);
 assert.deepEqual(back.decisions.map(d=>d.s),[70,150]);assert.equal(back.polyline[0].z,-2);assert.equal(back.polyline.at(-1).x,50);
 const scene=new THREE.Scene(),v=createLegacyGuidance(scene,map,forward,[{s:100}],{at:()=>({y:0,surf:'asphalt'})});
 v.update({cursorS:30,isRace:true});assert.ok(v.stats.instances>0);assert.ok(v.stats.instances<=128);
 assert.equal(v.paint.chunks.records.some(r=>r.kind===2),false);
 v.update({cursorS:30,isRace:false});assert.equal(v.paint.mesh.visible,false);v.dispose();assert.equal(scene.children.length,0);
});

test('paint remains within asymmetric road bounds while clearing the car silhouette',()=>{
 const v=new RouteGuidance(new THREE.Scene(),{contact:()=>({y:0})});const d=supplied();d.paintTiming=false;v.setRoute(d);v.onTileActivated('0,0');v.update({cursorS:100,isRace:true});
 const paint=v.paint,rows=paint.chunks.visible(100);assert.equal(paint.mesh.count,4);
 for(let i=0;i<paint.mesh.count;i++){
  const r=rows[i],m=new THREE.Matrix4();paint.mesh.getMatrixAt(i,m);
  for(const side of [-.5,.5]){const p=new THREE.Vector3(side,0,0).applyMatrix4(m),u=(p.x-r.x)*-r.tz+(p.z-r.z)*r.tx;assert.ok(u>=-r.leftM-1e-5&&u<=r.rightM+1e-5);}
 }
 assert.ok(paint.mesh.instanceMatrix.array[14]>0,'forward chevrons sit beside the centre line');v.dispose();
});
