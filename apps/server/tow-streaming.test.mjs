import test from 'node:test';
import assert from 'node:assert/strict';
import { planWorldTow, OWN_LEG_RANGE, ROUTE_PREFERENCE } from '../../src/tow-placement.js';
import { towHeading } from '../../src/tow-heading.js';

// Frozen full-array/sort implementation, used only as the semantic reference.
function referencePlanWorldTow({pose,course,route,roadCandidates,footprint,obstacles}){
 const ref=course?.lastRoad?.s??pose.s??0,floor=course?Math.max((course.s0||0)+(course.validProgress||0),course.lastRoad?.s??-Infinity):-Infinity;const here=route?.project(pose.x,pose.z,{hint:ref,referenceY:pose.y,maxTravel:OWN_LEG_RANGE}),routeDistance=here?Math.max(0,-(here.leftM||0)-here.u,here.u-(here.rightM||0)):Infinity;
 const candidates=roadCandidates.filter(p=>p.safe!==false&&(!obstacles||!obstacles(p,footprint))).map(p=>{const q=route?.project(p.x,p.z,{hint:ref,referenceY:p.y,layer:p.layer,maxTravel:OWN_LEG_RANGE}),onRoute=!!q&&q.distance<=Math.max(q.leftM||0,q.rightM||0)+1&&p.layer===q.layer&&(route.contactAllowed?route.contactAllowed(q,p):p.surfaceId===q.surfaceId);const f=q&&route.frame(q.s),aligned=f&&(-Math.sin(p.yaw)*f.tx-Math.cos(p.yaw)*f.tz)>=.5,preferred=onRoute&&q.edgeId===p.edgeId&&aligned;return{...p,kind:preferred?'route':'road',s:q?.s??pose.s,u:q?.u??0,distance:Math.hypot(p.x-pose.x,p.z-pose.z),onRoute:preferred,onRouteGeometry:onRoute,routeAligned:!!aligned};}).filter(p=>(!course||!p.onRouteGeometry||p.routeAligned)&&(!p.onRouteGeometry||p.s>=floor-.01));
 const preferred=course?candidates.filter(p=>p.onRoute&&routeDistance<=ROUTE_PREFERENCE&&Math.abs(p.s-ref)<=OWN_LEG_RANGE):[];
 // On two-way streets the graph contains both directed edges. Choose the travel direction
 // within that same carriageway before comparing lane-centre distances. Separate one-way
 // carriageways have no twin, so their legal direction is never reversed.
 const heading=towHeading(pose),alignment=p=>Math.cos(p.yaw-heading);
 const directions=new Map();
 const seenEdges=new Set();
 for(const p of candidates)if(p.roadId&&!seenEdges.has(p.edgeId)){seenEdges.add(p.edgeId);const best=directions.get(p.roadId);if(!best||alignment(p)>alignment(best))directions.set(p.roadId,p);}
 const legal=candidates.filter(p=>!p.roadId||alignment(p)>=-1e-6&&p.edgeId===directions.get(p.roadId).edgeId);
 const pool=preferred.length?preferred:legal;pool.sort((a,b)=>a.distance-b.distance||alignment(b)-alignment(a)||String(a.edgeId).localeCompare(String(b.edgeId)));
 return pool[0]||null;
}


const base = (extra={}) => ({x:0,y:0,z:0,yaw:0,layer:0,surfaceId:'surface',safe:true,edgeId:'e',...extra});
const pose={x:0,y:0,z:0,yaw:0,s:0,towHeading:0};
function equivalent(options){
 const expected=referencePlanWorldTow(options);
 assert.deepEqual(planWorldTow(options),expected);
 let passes=0;const iterable={[Symbol.iterator](){assert.ok(passes++<2,'two ordered passes');return options.roadCandidates[Symbol.iterator]();}};
 assert.deepEqual(planWorldTow({...options,roadCandidates:iterable}),expected);
}

test('streaming tow preserves first-edge direction, lane choice and stable cross-group ties',()=>{
 for(const candidates of [
  [base({roadId:'a',edgeId:'forward',x:20,yaw:0}),base({roadId:'a',edgeId:'reverse',x:1,yaw:Math.PI}),base({roadId:'a',edgeId:'forward',x:5,yaw:0})],
  [base({roadId:'a',edgeId:'reverse',x:1,yaw:Math.PI}),base({roadId:'a',edgeId:'forward',x:10,yaw:0}),base({roadId:'a',edgeId:'forward',x:2,yaw:0})],
  [base({roadId:'a',x:2,tag:1}),base({x:2,tag:2})],
  [base({x:2,tag:1}),base({roadId:'a',x:2,tag:2})],
  [base({safe:false,x:0}),base({x:4}),base({x:1,blocked:true})],
  [],
 ])equivalent({pose,roadCandidates:candidates,obstacles:p=>p.blocked});
});

test('streaming tow matches the frozen full-array reference across 6000 seeded races and free-roam inputs',()=>{
 let seed=0x51a7;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 const route={project(x,z){return{s:x,u:z,distance:Math.abs(z),leftM:4,rightM:4,layer:0,surfaceId:'surface',edgeId:x<0?'edge:0:0':'edge:1:0'};},frame(){return{tx:0,tz:-1};},contactAllowed(q,p){return q.surfaceId===p.surfaceId;}};
 for(let trial=0;trial<6000;trial++){
  const candidates=Array.from({length:Math.floor(random()*80)},(_,i)=>{const road=Math.floor(random()*6),edge=Math.floor(random()*2);return base({x:Math.round(random()*260-130),z:Math.round(random()*50-25),yaw:random()<.35?0:random()<.5?Math.PI:random()*Math.PI*2,roadId:random()<.2?undefined:'road:'+road,edgeId:'edge:'+road+':'+edge,safe:random()>.1,blocked:random()<.1,layer:random()<.1?1:0,surfaceId:random()<.1?'other':'surface',tag:i});});
  // An emitted directed edge has one authenticated road identity.
  for(const candidate of candidates)if(candidate.roadId)candidate.roadId='road:'+candidate.edgeId.split(':')[1];
  equivalent({pose:{...pose,x:Math.round(random()*20),s:10,towHeading:random()*Math.PI*2},route:trial%3?route:null,course:trial%2?{s0:-100,validProgress:trial%80,lastRoad:{s:trial%40}}:null,roadCandidates:candidates,obstacles:p=>p.blocked});
 }
});

test('streaming tow precharges bounded working and retained state without truncating candidates',()=>{
 const candidates=Array.from({length:10000},(_,i)=>base({x:10000-i,roadId:'one-road',edgeId:'one-edge',proof:{footprints:[{halfWidth:1,halfLength:2}]}})),memory={};
 const result=planWorldTow({pose,roadCandidates:candidates,maxBytes:64*1024,memory});
 assert.equal(result.x,1);assert.ok(memory.peakBytes<64*1024);assert.ok(memory.retainedBytes<memory.peakBytes);
 assert.throws(()=>planWorldTow({pose,roadCandidates:candidates,maxBytes:100}),/memory budget/);
 const unique=candidates.slice(0,1000).map((p,i)=>({...p,roadId:'road'+i,edgeId:'edge'+i}));
 assert.throws(()=>planWorldTow({pose,roadCandidates:unique,maxBytes:64*1024}),/memory budget/);
 assert.deepEqual(result,referencePlanWorldTow({pose,roadCandidates:candidates}));
});

test('actual certified dense sidecar anchors choose exactly the reference pose',async t=>{
 const {readFile}=await import('node:fs/promises');let catalogue;
 try{catalogue=JSON.parse(await readFile(new URL('../../.desktop/game/catalogue.json',import.meta.url)));}catch(error){if(error.code==='ENOENT')return t.skip('optional prepared full-world fixture absent');throw error;}
 const {recoveryCellDescriptor}=await import('../../server/recovery-manifest-wire.mjs');const {decodeRecoverySidecar}=await import('../../server/route-road-wire.mjs');
 const root=catalogue.routeRoads.find(x=>x.body.cells).body,key='-1,-16',descriptor=recoveryCellDescriptor(root,key),anchors=[];
 for(const hash of descriptor.parts){const packed=JSON.parse(await readFile(new URL(`../../.desktop/game/world/recovery/${key}.${hash}.json`,import.meta.url)));anchors.push(...decodeRecoverySidecar(packed).body.anchors);}
 assert.ok(anchors.length>4000);
 const memory={};const bounded=planWorldTow({pose:anchors[0],roadCandidates:anchors,maxBytes:2*1024*1024,memory});
 assert.deepEqual(bounded,referencePlanWorldTow({pose:anchors[0],roadCandidates:anchors}));assert.ok(memory.peakBytes<2*1024*1024);t.diagnostic(JSON.stringify({anchors:anchors.length,memory}));
 for(let i=0;i<20;i++){const sample=anchors[Math.floor(i*anchors.length/20)];equivalent({pose:{...sample,x:sample.x+7,z:sample.z-11,towHeading:i*Math.PI/10},roadCandidates:anchors});}
});

test('streaming tow rejects a one-shot or truncated replay instead of selecting from partial candidates',()=>{
 function* once(){yield base({x:3});yield base({x:1});}
 assert.throws(()=>planWorldTow({pose,roadCandidates:once()}),/replayable/);
 for(const maxBytes of [NaN,-1,'64000'])assert.throws(()=>planWorldTow({pose,roadCandidates:[],maxBytes}),/Invalid.*budget/);
});
