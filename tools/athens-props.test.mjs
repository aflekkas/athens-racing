// Working signals and street furniture of the streamed Athens world: one plan, one draw call, AI stops at red, Off removes it.
import test from 'node:test';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import * as THREE from 'three';
import {CYCLE,GREEN,AMBER,RED0,STOP_OFF,signalState} from '../src/signal-plan.js';

import {AthensProps,KINDS,PROP_LIMITS,PROP_NEAR,propParts,propGeometry,signalMaterial} from '../src/athens-props.js';
const row=(...v)=>Float32Array.from(v);
function packet(origin,{props=[],signals=[]}={}){
  const ids=['','osm:edge:a','osm:edge:b'],arrays=[],add=a=>arrays.push(a)-1;
  const wd={version:1};
  if(props.length)wd.props={rows:add(row(...props.flatMap(p=>[p.x,p.y||0,p.z,p.yaw||0,p.variant||0]))),kind:add(Uint8Array.from(props.map(p=>p.kind)))};
  if(signals.length)wd.signals={rows:add(row(...signals.flatMap(s=>[s.x,0,s.z,s.yaw||0,s.offset||0,s.group||0]))),edge:add(Uint32Array.from(signals.map(s=>s.edge)))};
  return {metadata:{origin,ids,extensions:{worldDetail:wd}},arrays};
}
const parent=()=>new THREE.Group();
test('the Riviera and Athens signals share one plan (28 s: green 16, amber 3, red 9)',()=>{
  assert.deepEqual([CYCLE,GREEN,AMBER,RED0],[28,16,3,19]);
  const riviera=readFileSync(new URL('../src/signals.js',import.meta.url),'utf8');
  assert.match(riviera,/from '\.\/signal-plan\.js'/,'src/signals.js takes its plan from the shared module');assert.ok(!/const CYCLE\s*=|CYCLE\s*=\s*28/.test(riviera),'and defines none of its own');
});
test('main and cross never show green together, every phase appears, and offsets move the wave',()=>{
  const seen={0:new Set(),1:new Set()};
  for(let t=0;t<CYCLE;t+=.25){const a=signalState(0,0,t),b=signalState(1,0,t);seen[0].add(a);seen[1].add(b);assert.ok(!(a==='G'&&b==='G'),`both green at ${t}`);}
  assert.deepEqual([...seen[0]].sort(),['A','G','R']);assert.deepEqual([...seen[1]].sort(),['A','G','R']);
  assert.equal(signalState(0,0,0),'G');assert.equal(signalState(0,0,GREEN+.1),'A');assert.equal(signalState(0,0,RED0+.1),'R');
  assert.equal(signalState(0,5,GREEN-5+.1),'A','a +5 s offset shifts the junction 5 s ahead');assert.equal(signalState(0,-1,.5),'R','a negative offset wraps round the cycle');
  assert.equal(signalState(1,0,RED0+3),'G','cross traffic goes during the main red');
});
test('every model fits the owner budgets (street props <= 150 triangles, signs <= 60)',()=>{
  const tris={};for(const g of propParts()){const k=g.attributes.aKind.array[0];tris[k]=(tris[k]||0)+g.index.count/3;}
  for(const [name,k] of Object.entries(KINDS))assert.ok(tris[k]>0&&tris[k]<=150,`${name}: ${tris[k]}`);
  for(const name of ['stop','give_way','oneway','bus_stop'])assert.ok(tris[KINDS[name]]<=60,name);
  const g=propGeometry();assert.ok(g.attributes.aLamp&&g.attributes.color);assert.equal(g.index.count/3,Object.values(tris).reduce((a,b)=>a+b,0));
});
const count=(p,kind)=>p.meshes.get(KINDS[kind]).mesh.count;
test('tile rows become instances, one mesh per model; the nearest come first; removing a tile removes its rows',()=>{
  const p=new AthensProps(parent());
  p.addTile('0,0',packet([0,0,0],{props:[{kind:KINDS.lamp,x:10,z:10},{kind:KINDS.bench,x:300,z:0}],signals:[{x:20,z:0,edge:1,group:0}]}));
  p.addTile('1,0',packet([512,0,0],{props:[{kind:KINDS.kiosk,x:5,z:5}]}));
  p.update({position:{x:0,z:0}},0);assert.equal(p.stats.instances,2,'the bench 300 m away is beyond the near range');
  assert.equal(count(p,'lamp'),1);assert.equal(count(p,'signal'),1);assert.equal(count(p,'bench'),0);assert.equal(p.stats.drawCalls,2,'only the models in view cost a draw call');
  assert.equal(p.meshes.get(KINDS.lamp).mesh.visible,true);assert.equal(p.meshes.get(KINDS.bench).mesh.visible,false);
  p.update({position:{x:512,z:0}},0);assert.equal(count(p,'kiosk'),1,'positions are absolute: the second tile\'s origin is added');
  const m=new THREE.Matrix4();p.meshes.get(KINDS.kiosk).mesh.getMatrixAt(0,m);assert.equal(m.elements[12],517);
  p.removeTile('0,0');p.removeTile('1,0');p.update({position:{x:5000,z:0}},0);assert.equal(p.stats.instances,0);assert.equal(p.stats.drawCalls,0,'nothing in range costs no draw call');
});
test('small models stop earlier than lamps and signals, so few models are in view at once',()=>{
  assert.deepEqual(Object.keys(PROP_NEAR).sort(),Object.keys(KINDS).sort());assert.ok(PROP_NEAR.bench<PROP_NEAR.lamp&&PROP_NEAR.crossing<PROP_NEAR.signal&&Math.max(...Object.values(PROP_NEAR))<=PROP_LIMITS.near);
  const p=new AthensProps(parent());p.addTile('0,0',packet([0,0,0],{props:[{kind:KINDS.bench,x:90,z:0},{kind:KINDS.lamp,x:90,z:5},{kind:KINDS.crossing,x:105,z:0},{kind:KINDS.stop,x:105,z:5}]}));
  p.update({position:{x:0,z:0}},0);assert.equal(count(p,'bench'),0,'a bench 90 m away is not drawn');assert.equal(count(p,'lamp'),1);assert.equal(count(p,'crossing'),0);assert.equal(count(p,'stop'),1,'a stop sign 105 m away is');
});
test('a signal head lights the lamp of its phase, rewriting state only when the phase changes',()=>{
  const p=new AthensProps(parent());p.addTile('0,0',packet([0,0,0],{signals:[{x:5,z:5,edge:1,group:0,offset:0},{x:6,z:6,edge:2,group:1,offset:0}]}));
  const st=()=>[...p.signalState.array.slice(0,2)];
  p.update({position:{x:0,z:0}},1);assert.deepEqual(st(),[3,1],'main green, cross red');
  const v=p.signalState.version;p.update({position:{x:0,z:0}},2);assert.equal(p.signalState.version,v,'same phase: nothing re-uploaded');
  p.update({position:{x:0,z:0}},GREEN+1);assert.deepEqual(st(),[2,1],'main amber');
  p.update({position:{x:0,z:0}},RED0+3);assert.deepEqual(st(),[1,3],'main red, cross green');
});
test('AI holds at the stop line on red or amber, goes on green, and never holds once past the line',()=>{
  const p=new AthensProps(parent());p.addTile('0,0',packet([0,0,0],{signals:[{x:5,z:5,edge:1,group:0,offset:0}]}));
  const edge=[[0,0,-100],[0,0,0]],car=d=>({edge:'osm:edge:a',x:0,z:-d});
  p.time=1;assert.equal(p.hold(car(STOP_OFF),edge),false,'green');
  p.time=RED0+2;assert.equal(p.hold(car(STOP_OFF),edge),true,'red, at the line');assert.equal(p.hold(car(STOP_OFF+.5),edge),true);
  assert.equal(p.hold(car(STOP_OFF+30),edge),false,'far from the line the car is still rolling up');assert.equal(p.hold(car(STOP_OFF-5),edge),false,'already through the line');
  p.time=GREEN+1;assert.equal(p.hold(car(STOP_OFF),edge),true,'amber stops cars that can');
  assert.equal(p.hold({edge:'osm:edge:zzz',x:0,z:-STOP_OFF},edge),false,'an edge without a signal is never held');
  p.setEnabled(false);p.time=RED0+2;assert.equal(p.hold(car(STOP_OFF),edge),false,'World detail Off: traffic ignores the (hidden) signals');
});
test('World detail Off hides the layer; On brings it back',()=>{
  const p=new AthensProps(parent(),{enabled:false});assert.equal(p.group.visible,false);p.setEnabled(true);assert.equal(p.group.visible,true);p.setEnabled(false);assert.equal(p.group.visible,false);
  p.addTile('0,0',packet([0,0,0],{props:[{kind:KINDS.lamp,x:1,z:1}]}));p.update({position:{x:0,z:0}},0);assert.equal(p.stats.instances,0,'no instances are built while Off');
});
test('the signal material lights lamps from the instance state; other models carry no lamp logic',()=>{
  const m=signalMaterial(),sh={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'};m.onBeforeCompile(sh);
  assert.match(sh.vertexShader,/attribute float iState/);assert.match(sh.vertexShader,/aLamp-iState/);assert.match(sh.fragmentShader,/varying float vLit/);
  assert.equal(PROP_LIMITS.capacity>=600,true);
});
