import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as THREE from 'three';
import './vehicle-budget-support.mjs';
import {WorldDetail} from '../src/world-detail.js';
import {DETAIL_LIMITS,detailSeed} from '../src/world-detail-policy.js';
import {worldDetailSeed} from '../src/world-tile-format.js';
import {loadMap} from '../src/map.js';
import {RoadNetwork} from '../src/road-network-surface.js';
import {setSetting,settings} from '../src/settings.js';
import {facadeMaterial} from '../src/buildings.js';
import {createFacadeAtlas} from '../src/facade-atlas.js';
import {sampleH} from '../src/terrain.js';

// Timing is measured as the best of several independent passes after one warm-up pass, so a
// preempted or cold step on a loaded host cannot decide the result. Each timed pass is normalised by a
// fixed calibration workload timed right beside it, so a uniformly slower machine scales the budget too.
const WARMUP_PASSES=1,TIMING_PASSES=5;
const ABSOLUTE_MEAN_MS=.45;// 3x the original 0.15 ms ceiling: generous under load, still far below per-frame rebuilds
const NORMALISED_BUDGET=.03;// worst map measured ~0.010 on a loaded 8-core host; 3x headroom
let calibrationSink=0;
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
function calibrationMs(){
 const buffer=new Float64Array(2048);let best=Infinity;
 for(let run=0;run<3;run++){const start=performance.now();let acc=0;for(let round=0;round<200;round++)for(let i=0;i<buffer.length;i++){buffer[i]=buffer[i]*.5+Math.sqrt(i+round);acc+=buffer[i];}best=Math.min(best,performance.now()-start);calibrationSink+=acc;}
 return best;
}

test('detail source convention is unsigned FNV-1a and stable across tile boundaries',()=>{
 for(const id of ['way/123','relation/123','node/42','way/42:row/7','Αθήνα/123'])assert.equal(detailSeed(id),worldDetailSeed(id),'renderer and AWT producer seed agreement');
 assert.equal(detailSeed('hello'),0x4f9f2cab);assert.equal(detailSeed('way/123'),detailSeed('way/123'));assert.notEqual(detailSeed('way/123'),detailSeed('node/123'));
});
test('all maps use bounded rings, reusable instance buffers, live texture-free Off and safe tile eviction',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=async p=>new Response(readFileSync(resolve(import.meta.dirname,'..',String(p))));globalThis.location={search:''};
 try{for(const id of ['riviera','penteli','megara','psychiko']){
  const map=await loadMap(undefined,'./',id,{preload:false});map.roadNetwork=new RoadNetwork(map);
  const parent=new THREE.Group(),material=facadeMaterial(createFacadeAtlas()),facade=new THREE.Mesh(new THREE.BoxGeometry(),material);parent.add(facade);
  const detail=new WorldDetail(map,parent,(x,z)=>sampleH(map.terrain,map.terrain.H,x,z)),camera=new THREE.PerspectiveCamera(),boxBuffer=detail.boxes.instanceMatrix.array,cardBuffer=detail.cards.instanceMatrix.array;
  assert.equal(detail.boxes.geometry.index.count/3,12);assert.equal(detail.cards.geometry.index.count/3,2);
  let populated=false;const passes=[];
  for(let pass=0;pass<WARMUP_PASSES+TIMING_PASSES;pass++){
   const before=calibrationMs(),samples=[];
   for(let s=map.route.start;s<Math.min(map.route.length,map.route.start+2000);s+=.5){const p=map.route.point(s,0);camera.position.set(p.x,p.y+2,p.z);const start=performance.now();detail.update(camera);samples.push(performance.now()-start);assert.ok(detail.boxes.count<=DETAIL_LIMITS.boxes);assert.ok(detail.cards.count<=DETAIL_LIMITS.impostors);populated ||= detail.boxes.count>0||detail.cards.count>0;}
   if(pass>=WARMUP_PASSES)passes.push({samples,mean:mean(samples),calibrationMs:Math.min(before,calibrationMs())});
  }
  assert.ok(populated,id+' adds nearby records');assert.equal(detail.boxes.instanceMatrix.array,boxBuffer);assert.equal(detail.cards.instanceMatrix.array,cardBuffer);
  for(let i=0;i<3;i++){setSetting('worldDetail',false);assert.equal(detail.group.visible,false);assert.equal(material.map,null);assert.equal(detail.cards.material.map,null);setSetting('worldDetail',true);assert.equal(detail.group.visible,true);assert.ok(material.map);assert.ok(detail.cards.material.map);}
  const p=camera.position;detail.addRecords('tile-test',[{kind:'tree',x:p.x+3,z:p.z,y:p.y,height:5,seed:7}]);assert.ok(detail.tiles.has('tile-test'));detail.removeTile('tile-test');assert.equal(detail.tiles.has('tile-test'),false);
  const best=passes.reduce((a,b)=>b.mean<a.mean?b:a),normalised=Math.min(...passes.map(p=>p.mean/p.calibrationMs));
  assert.ok(best.mean<ABSOLUTE_MEAN_MS,id+' amortized detail CPU (best of '+TIMING_PASSES+' passes) must remain below '+ABSOLUTE_MEAN_MS+' ms: '+best.mean);
  assert.ok(normalised<NORMALISED_BUDGET,id+' amortized detail CPU per calibration ms must remain below '+NORMALISED_BUDGET+': '+normalised);
  const samples=best.samples.sort((a,b)=>a-b);console.log(JSON.stringify({map:id,detailUpdateMeanMs:best.mean,passMeansMs:passes.map(p=>p.mean),calibrationMs:best.calibrationMs,normalised,p95Ms:samples[Math.floor(samples.length*.95)],steps:samples.length,records:detail.tiles.get('base').length,maxTriangles:DETAIL_LIMITS.boxes*12+DETAIL_LIMITS.impostors*2}));
  detail.dispose();
 }}finally{globalThis.fetch=prior;setSetting('worldDetail',true);}
});
test('shared graphics control persists strict boolean values without changing the render look',()=>{
 setSetting('worldDetail',false);assert.equal(settings.worldDetail,false);setSetting('worldDetail',true);assert.equal(settings.worldDetail,true);
});

test('added world layers cannot introduce real-time light/shadow or post-processing passes',()=>{
 const source=['src/world-detail.js','src/facade-atlas.js','src/world-detail-state.js'].map(p=>readFileSync(resolve(import.meta.dirname,'..',p),'utf8')).join('\n');
 assert.doesNotMatch(source,/new THREE\.(?:PointLight|SpotLight|DirectionalLight|HemisphereLight)|castShadow\s*=\s*true|shadowMap\.enabled\s*=\s*true|(?:SSAO|GTAO|Bloom|Bokeh|Render|Shader)Pass|EffectComposer|WebGLRenderTarget|CubeCamera/);
});

test('decoration placement never invokes the collision-height sampler when unpinned support is available',()=>{
 const route={length:0,point:()=>new THREE.Vector3(),edge:()=>3,localCorridors:[]};
 const map={id:'fixture',route,terrain:{sceneryHeight:()=>10},data:{buildings:[{id:1,p:[0,0,10,0,10,10,0,10],h:6}],vegetation:[]}};
 const detail=new WorldDetail(map,new THREE.Group(),()=>{throw Error('decoration pinned collision terrain');});
 assert.equal(detail.tiles.get('base')[0][1].y,16);detail.dispose();
});
