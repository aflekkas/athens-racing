import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WorldTraffic,trafficSuccessors} from '../src/world-traffic.js';
import {WorldTileRoads} from '../src/world-tile-roads.js';
import {WorldRoadGraph} from '../src/world-tile-graph.js';
import {edgePoint,projectEdge,edgeLength} from '../src/route-geometry.js';
import {simulateFlow,trafficPool,flowSample} from './world-traffic-sim.mjs';

function ribbonWorld(edges,{widen=false}={}){
 const graph=new WorldRoadGraph(),segments=new Map();
 for(const e of edges){graph.edges.set(e.id,{value:e});if(!graph.outgoing.has(e.from))graph.outgoing.set(e.from,new Set());graph.outgoing.get(e.from).add(e.id);
  const width=e.flags&1?Math.max(3,e.lanes*1.7):Math.max(3,e.lanes*3.3);
  for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i];for(let x=Math.floor((Math.min(a[0],b[0])-width)/32);x<=Math.floor((Math.max(a[0],b[0])+width)/32);x++)for(let z=Math.floor((Math.min(a[2],b[2])-width)/32);z<=Math.floor((Math.max(a[2],b[2])+width)/32);z++){const key=x+','+z;if(!segments.has(key))segments.set(key,[]);segments.get(key).push({e,a,b,width});}}
 }
 const contact=(x,z,{referenceY=0}={})=>{for(const {e,a,b,width}of segments.get(Math.floor(x/32)+','+Math.floor(z/32))||[]){const dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1))),y=a[1]+(b[1]-a[1])*t;if(Math.hypot(x-a[0]-dx*t,z-a[2]-dz*t)<=width&&Math.abs(y-referenceY)<2)return {y,layer:e.layer,surfaceId:e.surface};}return null;};
 const roads={graph,width(p){const e=graph.edges.get(p.edge)?.value;if(!e)return null;const half=e.flags&1?Math.max(3,e.lanes*1.7):Math.max(3,e.lanes*3.3),extra=widen&&projectEdge(e,p.x,p.z).offsetM>30?8:0;return {left:half,right:half+extra,width:half*2+extra};}};
 return {roads,stream:{contact},props:{time:0,hold:()=>false},safePose(p,o){for(const a of [-o.halfLength,0,o.halfLength])for(const b of [-o.halfWidth,0,o.halfWidth])if(!contact(p.x-Math.sin(p.yaw)*a+Math.cos(p.yaw)*b,p.z-Math.cos(p.yaw)*a-Math.sin(p.yaw)*b,{referenceY:p.y}))return false;return true;}};
}

test('a junction widening does not move a lane sideways, and two-way traffic needs passing width',()=>{
 const e={id:'road',from:'a',to:'b',points:[[0,0,0],[0,0,100]],flags:0,lanes:0,layer:0},w=ribbonWorld([e],{widen:true}),t=new WorldTraffic(w,{},{}),c={len:4.4,wid:1.8};
 const a=t.candidate(e,29,c),b=t.candidate(e,33,c);assert.ok(a&&b);assert.ok(Math.abs(a.x-b.x)<.01,'junction mouth must not change lane offset');
 t.laneCache.clear();w.roads.width=()=>({left:1.8,right:1.8,width:3.6});assert.equal(t.candidate(e,30,c),null,'do not put opposing cars into one narrow lane');
});
test('a failed pose is retried after streaming finishes even when graph revision stays the same',()=>{
 const e={id:'road',from:'a',to:'b',points:[[0,0,0],[0,0,100]],flags:1,lanes:1,layer:0},w=ribbonWorld([e]),t=new WorldTraffic(w,{},{}),c={len:4.4,wid:1.8},contact=w.stream.contact;w.stream.contact=()=>null;
 assert.equal(t.candidate(e,50,c),null);w.stream.contact=contact;t.t=1.1;assert.ok(t.candidate(e,50,c));
});
// Use runtime's real surface/layer footprint admission, not ribbonWorld's
// permissive contact-only safePose, at both ends of a structure transition.
function transitionWorld({reverse=false,fromLayer=0,toLayer=1,boundary=100}={}) {
 const z=s=>reverse?300-s:s;
 const incoming={id:'incoming',from:'a',to:'b',layer:fromLayer,flags:3,lanes:1,surface:'incoming-asphalt',points:[[0,6,z(0)],[0,6,z(100)]]};
 const outgoing={...incoming,id:'outgoing',from:'b',to:'c',layer:toLayer,surface:'outgoing-asphalt',points:[[0,6,z(100)],[0,6,z(200)]]};
 const after={...outgoing,id:'after',from:'c',to:'d',points:[[0,6,z(200)],[0,6,z(300)]]};
 const stream={tiles:new Map(),contact(x,position,{layer=null}={}) {
  const s=reverse?300-position:position,actual=s<boundary?fromLayer:toLayer;
  if(Math.abs(x)>3||s<0||s>300||layer!==null&&layer!==actual)return null;
  return {y:6,layer:actual,surfaceId:s<boundary?incoming.surface:outgoing.surface};
 }};
 const roads=new WorldTileRoads(stream);
 for(const e of [incoming,outgoing,after]){roads.graph.edges.set(e.id,{value:e});roads.graph.outgoing.set(e.from,new Set([e.id]));}
 roads.width=()=>({left:3,right:3,width:6});
 const checked=[],session={roads,stream,safePose(p,o){checked.push({...p});return roads.safe({...p,edge:p.edgeId||p.edge},{...o,connected:true});}};
 const traffic=trafficPool(new WorldTraffic(session,{}, {project:(x,z)=>({s:z,u:x})}));
 return {incoming,outgoing,after,roads,stream,session,traffic,checked};
}

test('structure turns retain their legal validation edge across real road-safety layer and owner changes',()=>{
 for(const reverse of [false,true])for(const [fromLayer,toLayer]of [[0,1],[1,0],[0,0]]){
  const w=transitionWorld({reverse,fromLayer,toLayer}),{traffic:t,incoming:a,outgoing:b}=w,c=t.cars[0];
  const paths=t.turnPaths(a,c);assert.equal(paths.length,1,JSON.stringify({reverse,fromLayer,toLayer}));
  for(const p of paths[0].points){assert.equal(w.roads.graph.edges.get(p.edgeId).value.layer,p.layer);assert.equal(p.edge,a.id,'navigation stays on the incoming edge until the curve exits');}
  assert.ok(w.checked.some(p=>p.surfaceId===b.surface&&p.edgeId===b.id),'outgoing centre owner is validated against the outgoing edge');
  Object.assign(c,{active:true,offset:91.9,point:{edge:a.id},v:1});c.vehicle=t.candidate(a,c.offset,c);
  for(let i=0;i<300&&c.point.edge!==b.id;i++){const n=t.advanceLane(c,a,.1);assert.ok(n?.p,JSON.stringify({reverse,fromLayer,toLayer,offset:c.offset,turn:c.turn&&{progress:c.turn.progress,length:c.turn.length},point:c.point}));assert.ok(w.session.safePose(n.p,{halfWidth:c.wid/2,halfLength:c.len/2}));Object.assign(c,{offset:n.offset,turn:n.turn,point:n.p,vehicle:n.p});}
  assert.equal(c.point.edge,b.id,'forward movement completes the legal layer transition');
  const point=paths[0].points[15],turn={...paths[0],progress:point.s};Object.assign(c,{offset:turn.entry+point.s,point,vehicle:{...point,halfL:c.len/2,halfW:c.wid/2},turn,stoppedT:7,v:0});
  for(let i=0;i<300&&(c.turn||c.yielding);i++)t.yieldBack(c,a,.1,[]);
  assert.equal(c.turn,null);assert.equal(c.yielding,null,'a trapped car can reverse over the same checked transition');
 }
});

test('live structure contact chooses the legal road owner before or after the curve midpoint',()=>{
 for(const reverse of [false,true])for(const boundary of [98,102])for(const [fromLayer,toLayer]of [[0,1],[1,0]]){
  const w=transitionWorld({reverse,boundary,fromLayer,toLayer}),t=w.traffic,c=t.cars[0],a=w.incoming,b=w.outgoing;
  const paths=t.turnPaths(a,c);assert.equal(paths.length,1,JSON.stringify({reverse,boundary,fromLayer,toLayer}));
  Object.assign(c,{active:true,offset:91.9,point:{edge:a.id},v:1});c.vehicle=t.candidate(a,c.offset,c);
  for(let i=0;i<300&&c.point.edge!==b.id;i++){const n=t.advanceLane(c,a,.1);assert.ok(n?.p);assert.ok(w.session.safePose(n.p,{halfWidth:c.wid/2,halfLength:c.len/2}));assert.equal(w.roads.graph.edges.get(n.p.edgeId).value.layer,n.p.layer);Object.assign(c,{offset:n.offset,turn:n.turn,point:n.p,vehicle:n.p});}
  assert.equal(c.point.edge,b.id);
  const point=paths[0].points[15],turn={...paths[0],progress:point.s};Object.assign(c,{offset:turn.entry+point.s,point,vehicle:{...point,halfL:c.len/2,halfW:c.wid/2},turn,stoppedT:7,v:0});
  for(let i=0;i<300&&(c.turn||c.yielding);i++)t.yieldBack(c,a,.1,[]);
  assert.equal(c.yielding,null);assert.equal(c.turn,null);
 }
});

test('transition identity never grants an unconnected or neighboring road layer',()=>{
 const w=transitionWorld(),c=w.traffic.cars[0];
 w.incoming.flags=w.outgoing.flags=1;
 assert.equal(w.traffic.turnPaths(w.incoming,c).length,0,'a different layer without a legal structure connection stays rejected');
 w.incoming.flags=w.outgoing.flags=3;w.roads.graph.revision++;
 const contact=w.stream.contact;w.stream.contact=(x,z,o)=>{const p=contact(x,z,o);return p&&z>=100?{...p,layer:2,surfaceId:'neighbor-deck'}:p;};
 assert.equal(w.traffic.turnPaths(w.incoming,c).length,0,'the true footprint check rejects a neighboring layer and owner');
 w.roads.graph.revision++;w.stream.contact=(x,z,o)=>{const p=contact(x,z,o);return p&&z>=100?{...p,surfaceId:'unconnected-deck'}:p;};
 assert.equal(w.traffic.turnPaths(w.incoming,c).length,0,'matching layer alone cannot authorize an unrelated deck owner');
});

test('a legal same-direction lane survives turn lookahead, movement and retreat with real road safety',()=>{
 for(const reverse of [false,true]){
  const w=transitionWorld({reverse}),{traffic:t,incoming:a,outgoing:b}=w,c=t.cars[0];
  for(const e of [a,b,w.after])e.lanes=2;
  w.roads.width=()=>({left:3.2,right:3.2,width:6.4});
  const contact=w.stream.contact;
  // A blocked right-hand exit does not block the supported left-hand lane.
  w.stream.contact=(x,z,o)=>{const station=reverse?300-z:z;return station>100&&(reverse?x>0:x<0)?null:contact(x,z,o);};
  c.laneShift=-3.2;const paths=t.throughPaths(a,c);assert.equal(paths.length,1,JSON.stringify({reverse,turn:t.turnPaths(a,c).map(p=>({next:p.next,shift:p.exitShift})),next:t.turnPaths(b,c).length,clear:t.laneClear(b,c),candidate:t.candidate(a,92,c)}));const turn=paths[0];
  assert.equal(turn.exitShift,-3.2,'prefer the current declared directional lane');
  for(let i=0;i<=1000;i++){
   const progress=turn.length*i/1000,n=t.advanceLane({...c,turn:{...turn,progress:0},offset:turn.entry},a,progress);
   assert.ok(n?.p);assert.ok(w.session.safePose(n.p,{halfWidth:c.wid/2,halfLength:c.len/2}));
   if(i===1000)assert.equal(n.laneShift,-3.2,'edge exit preserves the chosen lane');
  }
  const point=turn.points[15];Object.assign(c,{active:true,turn:{...turn,progress:point.s},offset:turn.entry+point.s,point,vehicle:{...point,halfL:c.len/2,halfW:c.wid/2},stoppedT:7,v:0});
  for(let i=0;i<1000&&(c.turn||c.yielding);i++)t.yieldBack(c,a,.05,[]);
  assert.equal(c.turn,null);assert.equal(c.yielding,null);assert.equal(c.laneShift,-3.2,'retreat returns to the original lane');
  // An unknown tag cannot authorize another lane even on wide asphalt.
  b.lanes=0;w.roads.graph.revision++;assert.equal(t.turnPaths(a,c).length,0);
 }
});

test('turn admission rejects an unsupported footprint between its cubic knots',()=>{
 const w=transitionWorld(),contact=w.stream.contact;
 w.stream.contact=(x,z,o)=>z>99.75&&z<99.95?null:contact(x,z,o);
 assert.equal(w.traffic.turnPaths(w.incoming,w.traffic.cars[0]).length,0,'the actual interpolated runtime path must be supported between stored knots');
});

test('random graph choices never select the immediate reverse edge',()=>{
 const e={id:'a',from:'n0',to:'n1',layer:0,points:[[0,0,0],[0,0,100]],flags:0},reverse={...e,id:'reverse',from:'n1',to:'n0',points:[...e.points].reverse()},next={...e,id:'next',from:'n1',to:'n2',points:[[0,0,100],[30,0,130]]},w=ribbonWorld([e,reverse,next]);
 assert.deepEqual(trafficSuccessors(w.roads.graph,e).map(e=>e.id),['next']);
});
test('spawn and driving use the same complete successor admission check',()=>{
 const a={id:'a',from:'n0',to:'n1',flags:1,lanes:1,layer:0,points:[[0,0,200],[0,0,240]]},b={...a,id:'b',from:'n1',to:'n2',points:[[0,0,240],[0,0,280]]},w=ribbonWorld([a,b]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})}));t.level=1;t.pool.rng.next=()=>0;
 t.turnPaths=e=>e.id==='a'?[{next:'b'}]:[];t.spawn({x:0,y:0,z:0},[]);assert.ok(t.cars.every(c=>!c.active),'an immediate turn with no usable continuation is not a spawn route');
 t.turnPaths=()=>[{next:'b'}];t.spawn({x:0,y:0,z:0},[]);assert.ok(t.cars.some(c=>c.active));
});
test('junction curves remain continuous and a second approach yields to the admitted car',()=>{
 const e={id:'in',from:'a',to:'b',layer:0,flags:1,lanes:1,points:[[0,0,0],[0,0,60]]},next={...e,id:'out',from:'b',to:'c',points:[[0,0,60],[60,0,60]]},out={...next,id:'after',from:'c',to:'d',points:[[60,0,60],[120,0,60]]},w=ribbonWorld([e,next,out]),t=trafficPool(new WorldTraffic(w,{},{}));
 const c=t.cars[0];Object.assign(c,{active:true,offset:51.9,point:{edge:e.id}});c.vehicle=t.candidate(e,c.offset,c);
 let prior=c.vehicle,total=0;
 for(let i=0;i<300&&c.point.edge!=='out';i++){const n=t.advanceLane(c,e,.1);assert.ok(n?.p);const moved=Math.hypot(n.p.x-prior.x,n.p.z-prior.z);assert.ok(moved<.15,`no edge-switch jump: ${moved}`);total+=moved;Object.assign(c,{offset:n.offset,turn:n.turn,point:n.p,vehicle:n.p});prior=n.p;if(c.turn){const other={...t.cars[1],active:true,offset:52,point:{edge:e.id}};assert.equal(t.advanceLane(other,e,.1),null);}}
 assert.equal(c.point.edge,'out');assert.ok(total>8);
});
test('a standing queue arms cleanup even without a footprint failure; rendering still protects it',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:1,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0];t.spawnT=1e6;
 Object.assign(c,{active:true,offset:100,point:{edge:e.id},v:0,drv:{a:1.6,b:3,T:1.2,s0:2.4,vf:1},vehicle:{...edgePoint(e,100),vLong:0,halfL:2.2,halfW:.9},x:0,y:0,z:100});
 const leader={...edgePoint(e,106.8),vLong:0,halfL:2.2,halfW:.9},player={x:100,y:0,z:100,yaw:0};
 for(let i=0;i<240;i++){t.update(.05,player,[leader]);c.lastSeenAt=t.t;}assert.ok(c.active);assert.ok(c.stoppedT>8);
 t.t+=2.5;assert.equal(t.retireUnseen(c,[player]),true);assert.equal(c.active,false);
});
test('active police choose the safe successor nearest the player instead of a random civilian turn',()=>{
 const a={id:'a',from:'a0',to:'junction',flags:1,layer:0,lanes:1,points:[[0,0,0],[0,0,100]]},near={...a,id:'near',from:'junction',to:'n',points:[[0,0,100],[100,0,100]]},far={...near,id:'far',to:'f',points:[[0,0,100],[-100,0,100]]},w=ribbonWorld([a,near,far]),t=trafficPool(new WorldTraffic(w,{},{})),c={...t.cars[0],active:true,police:true,offset:92,point:{edge:'a'}};
 const path=e=>({from:'a',via:'junction',next:e.id,entry:92,exit:8,length:16,progress:0,points:[{...edgePoint(a,92),s:0},{...edgePoint(e,8),s:16}]});
 t.cars=[c];t.hm={active:true};t.pool.rng.next=()=>.99;t.turnPaths=e=>e.id==='a'?[path(near),path(far)]:[path(near)];t.laneClear=()=>true;
 assert.equal(t.advanceLane(c,a,.1,{x:150,z:100}).turn.next,'near');
 t.hm.active=false;assert.equal(t.advanceLane(c,a,.1,{x:150,z:100}).turn.next,'far');
});
test('lane admission caches shifted lanes separately and checks the exact unshifted turn exit',()=>{
 const a={id:'a',from:'a0',to:'junction',flags:1,layer:0,lanes:1,points:[[0,0,0],[0,0,100]]},b={...a,id:'b',from:'junction',to:'n',points:[[0,0,100],[0,0,200]]},w=ribbonWorld([a,b]),t=trafficPool(new WorldTraffic(w,{},{})),c={...t.cars[0],laneShift:2.25,active:true,offset:92,point:{edge:'a'}};
 const candidate=t.candidate.bind(t);t.candidate=(e,s,car)=>car.laneShift?null:candidate(e,s,car);
 assert.equal(t.laneClear(a,c),false);assert.equal(t.laneClear(a,{...c,laneShift:0}),true);
 const lanes=[];t.laneClear=(_e,car)=>{lanes.push(car.laneShift);return car.laneShift===0;};
 t.turnPaths=(e,car)=>{if(e.id!=='a'){lanes.push(car.laneShift);return [{}];}return [{from:'a',via:'junction',next:'b',entry:92,exit:8,length:16,progress:0,points:[{...edgePoint(a,92),s:0},{...edgePoint(b,8),s:16}]}];};t.cars=[c];
 assert.ok(t.advanceLane(c,a,.1)?.p);assert.deepEqual(lanes,[0,0]);
});
test('a visible car passes a parked vehicle using a spare lane without crossing into oncoming traffic',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0];t.spawnT=1e6;
 const pose=t.candidate(e,100,c);Object.assign(c,{active:true,offset:100,point:pose,v:0,drv:{a:1.6,b:3,T:1.2,s0:2.4,vf:1},vehicle:{...pose,vLong:0,halfL:2.2,halfW:.9},x:pose.x,y:0,z:100});
 const player={...t.candidate(e,107,c),vLong:0,halfL:2.2,halfW:.9};
 for(let i=0;i<400;i++){t.update(.05,player,[player]);c.lastSeenAt=t.t;}
 assert.ok(c.vehicle.z>130,JSON.stringify(c.vehicle));assert.ok(c.laneShift< -3);assert.ok(c.active);
});
test('a normal two-lane one-way road has distinct lane centres and room to pass in the other lane',()=>{
 for(const reverse of [false,true])for(const police of [false,true]){
  const z=s=>reverse?1000-s:s,e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,z(0)],[0,0,z(1000)]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:reverse?1000-z:z,u:x})})),c=t.cars[0];
  // Canonical 3.2 m lanes, not the old test ribbon's unusually generous 3.4 m.
  const contact=w.stream.contact;w.stream.contact=(x,z,o)=>Math.abs(x)<=3.2?contact(x,z,o):null;w.roads.width=()=>({left:3.2,right:3.2,width:6.4});
  assert.equal(t.laneOffset(e,c),1.6,'one-way traffic belongs in a lane, not on its centre divider');
  t.spawnT=1e6;const pose=t.candidate(e,100,c),parked={...t.candidate(e,107,c),vLong:0,halfL:2.2,halfW:.9};
  Object.assign(c,{police,active:true,offset:100,point:pose,v:0,drv:{a:1.6,b:3,T:1.2,s0:2.4,vf:1},vehicle:{...pose,vLong:0,halfL:2.2,halfW:.9},x:pose.x,y:0,z:pose.z});if(police)t.hm={active:true,state:'chase'};
  for(let i=0;i<400;i++){t.update(.05,parked,[parked]);c.lastSeenAt=t.t;}
  assert.ok((reverse?1000-c.vehicle.z:c.vehicle.z)>130,'the NPC actually passes the parked car');assert.ok(c.active);assert.ok(c.laneShift< -3,'the pass uses the other marked lane');assert.ok(Math.abs(c.vehicle.x)+c.wid/2<=3.2,'the whole passing car stays on asphalt');
 }
});

test('measured asymmetric road edges place each direction inside its own actual lane',()=>{
 for(const reverse of [false,true])for(const flags of [0,1]){
  const e={id:'road',from:'a',to:'b',layer:0,flags,lanes:flags?2:1,points:reverse?[[0,0,1000],[0,0,0]]:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=new WorldTraffic(w,{},{}),c={len:4.4,wid:1.8};
  const width=reverse?{left:3.6,right:2.8,width:6.4}:{left:2.8,right:3.6,width:6.4};w.roads.width=()=>width;
  const u=t.laneOffset(e,c);assert.ok(Math.abs(u-(width.right-1.6))<1e-12);assert.ok(u-c.wid/2>=-width.left+.2);assert.ok(u+c.wid/2<=width.right-.2);
  if(!flags)assert.ok(u-c.wid/2>(width.right-width.left)/2,'two-way traffic stays entirely on its own side');
 }
});

test('explicit unequal directional lane counts retain their divider and never borrow the opposing lane',()=>{
 const forward={id:'forward',from:'a',to:'b',layer:0,flags:0,lanes:2,surface:'asphalt',points:[[0,0,0],[0,0,1000]]},reverse={...forward,id:'reverse',from:'b',to:'a',lanes:1,points:[...forward.points].reverse()},w=ribbonWorld([forward,reverse]),t=trafficPool(new WorldTraffic(w,{},{}));
 w.roads.width=()=>({left:4.8,right:4.8,width:9.6});
 for(const e of [forward,reverse]){const c={...t.cars[0],offset:100,stoppedT:3,laneShift:0};assert.ok(Math.abs(t.laneOffset(e,c)-3.2)<1e-12,'both directions use the actual 3.2 m outer lane');c.vehicle=t.candidate(e,100,c);t.bypass(c,e,.1,[]);if(e===forward)assert.ok(Math.abs(c.bypassTarget+3.2)<1e-12,'two-lane direction can use its inner lane');else assert.equal(c.bypassTarget,undefined,'the single-lane direction cannot cross the off-centre divider');}
 w.roads.width=()=>({left:3.2,right:3.2,width:6.4});w.roads.graph.revision++;assert.equal(t.laneOffset(reverse,t.cars[0]),null,'an undersized directional share cannot borrow opposing asphalt');
});

test('an occupied adjacent lane blocks passing even when its asphalt width is sufficient',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0];
 w.roads.width=()=>({left:3.2,right:3.2,width:6.4});t.spawnT=1e6;
 const pose=t.candidate(e,100,c),parked={...t.candidate(e,107,c),vLong:0,halfL:2.2,halfW:.9},blocker={...t.candidate(e,103,{...c,laneShift:-3.2}),vLong:0,halfL:2.2,halfW:.9};
 Object.assign(c,{active:true,offset:100,point:pose,v:0,drv:{a:1.6,b:3,T:1.2,s0:2.4,vf:1},vehicle:{...pose,vLong:0,halfL:2.2,halfW:.9},x:pose.x,y:0,z:pose.z});
 for(let i=0;i<240;i++){t.update(.05,parked,[parked,blocker]);c.lastSeenAt=t.t;assert.equal(t.poseBlocked(c,c.vehicle,[parked,blocker]),false);}
 assert.equal(c.laneShift||0,0);assert.ok(c.vehicle.z<parked.z-c.len/2-parked.halfL);assert.ok(c.active);
});

test('narrow asphalt cannot become a passing lane from a lane-count tag alone',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0];
 const contact=w.stream.contact;w.stream.contact=(x,z,o)=>Math.abs(x)<=1.6?contact(x,z,o):null;w.roads.width=()=>({left:1.6,right:1.6,width:3.2});t.spawnT=1e6;
 assert.equal(t.laneOffset(e,c),0,'the measured carriageway fits only one safe lane');
 const pose=t.candidate(e,100,c),parked={...t.candidate(e,107,c),vLong:0,halfL:2.2,halfW:.9};
 Object.assign(c,{active:true,offset:100,point:pose,v:0,drv:{a:1.6,b:3,T:1.2,s0:2.4,vf:1},vehicle:{...pose,vLong:0,halfL:2.2,halfW:.9},x:pose.x,y:0,z:pose.z});
 for(let i=0;i<240;i++){t.update(.05,parked,[parked]);c.lastSeenAt=t.t;}
 assert.equal(c.laneShift||0,0);assert.ok(c.vehicle.z<parked.z-c.len/2-parked.halfL);assert.ok(c.active);
});

test('a stopped car on a single-lane two-way street cannot pass through the oncoming lane',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:0,lanes:1,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0];
 w.roads.width=()=>({left:3.2,right:3.2,width:6.4});t.spawnT=1e6;
 const pose=t.candidate(e,100,c),parked={...t.candidate(e,107,c),vLong:0,halfL:2.2,halfW:.9},oncoming={...edgePoint(e,115),x:1.6,yaw:0,vLong:8,halfL:2.2,halfW:.9};
 Object.assign(c,{active:true,offset:100,point:pose,v:0,drv:{a:1.6,b:3,T:1.2,s0:2.4,vf:1},vehicle:{...pose,vLong:0,halfL:2.2,halfW:.9},x:pose.x,y:0,z:100});
 for(let i=0;i<240;i++){t.update(.05,parked,[parked,oncoming]);c.lastSeenAt=t.t;assert.ok(c.vehicle.x<0,'the NPC stays on its own side');}
 assert.equal(c.laneShift||0,0);assert.ok(c.vehicle.z<parked.z-c.len/2-parked.halfL);assert.ok(c.active);
});

test('a spare lane near a junction needs a checked exit before cars fan out',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:3,points:[[0,0,0],[0,0,100]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{},{})),c=t.cars[0];
 Object.assign(c,{offset:85,stoppedT:3,laneShift:0,vehicle:{...edgePoint(e,85),halfL:2.2,halfW:.9}});
 t.throughPaths=()=>[];t.bypass(c,e,.1,[]);assert.equal(c.laneShift,0);assert.equal(c.bypassTarget,undefined);
 const checked=[];t.throughPaths=(_e,car)=>{checked.push(car.laneShift);return [{}];};t.bypass(c,e,.1,[]);assert.deepEqual(checked,[-3.4]);assert.ok(c.laneShift<0);
});
test('a blocked turn backs out continuously and checks cars behind before moving',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0],pose=edgePoint(e,105);
 Object.assign(c,{active:true,offset:105,point:pose,vehicle:{...pose,halfL:2.2,halfW:.9,vLong:0},stoppedT:7,v:0,turn:{entry:100,progress:5,next:'exit',points:[{...edgePoint(e,100),s:0},{...edgePoint(e,110),s:10}]}});
 const rear={...edgePoint(e,100.5),halfL:2.2,halfW:.9};assert.ok(t.yieldBack(c,e,.1,[rear]));assert.equal(c.vehicle.z,105);
 assert.ok(t.yieldBack(c,e,.1,[]));assert.ok(c.vehicle.z<105&&c.vehicle.z>=104.92);assert.equal(c.vehicle.vLong,-.7);
 for(let i=0;i<200&&c.yielding;i++)t.yieldBack(c,e,.1,[]);
 assert.equal(c.yielding,null);assert.equal(c.turn,null);assert.ok(c.vehicle.z<94);assert.equal(c.avoidNext.id,'exit');
});
test('reversing a turn samples current ground contact instead of cached curve height',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{}, {project:(x,z)=>({s:z,u:x})})),c=t.cars[0],pose=edgePoint(e,105);
 Object.assign(c,{active:true,offset:105,point:pose,vehicle:{...pose,halfL:2.2,halfW:.9,vLong:0},stoppedT:7,v:0,turn:{entry:100,progress:5,next:'exit',points:[{...edgePoint(e,100),s:0},{...edgePoint(e,110),s:10}]}});
 const contact=w.stream.contact;w.stream.contact=(x,z,o)=>{const p=contact(x,z,o);return p&&{...p,y:.7};};
 t.yieldBack(c,e,.1,[]);assert.equal(c.vehicle.y,.7);assert.equal(c.point.y,.7);
 const before={...c.vehicle};w.stream.contact=()=>null;t.yieldBack(c,e,.1,[]);assert.deepEqual([c.vehicle.x,c.vehicle.y,c.vehicle.z],[before.x,before.y,before.z]);assert.equal(c.vehicle.vLong,0);
});
test('forward curves keep their road layer and adopt the current contact owner',()=>{
 const e={id:'road',from:'a',to:'b',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,1000]]},w=ribbonWorld([e]),t=trafficPool(new WorldTraffic(w,{},{})),c=t.cars[0];
 Object.assign(c,{offset:105,point:{edge:'road'},turn:{entry:100,progress:5,next:'road',length:10,points:[{...edgePoint(e,100),surfaceId:'old-owner',s:0},{...edgePoint(e,110),surfaceId:'old-owner',s:10}]}});
 const layers=[];w.stream.contact=(_x,_z,o)=>{layers.push(o.layer);return o.layer===0?{y:.2,layer:0,surfaceId:'connected-owner'}:{y:.7,layer:1,surfaceId:'unrelated-deck'};};
 const n=t.advanceLane(c,e,.1);assert.ok(n?.p);assert.equal(n.p.y,.2);assert.equal(n.p.layer,0);assert.equal(n.p.surfaceId,'connected-owner');assert.deepEqual(layers,[0]);
});
test('curve admission checks the actual centre height and owner before the complete footprint',()=>{
 const a={id:'a',from:'n0',to:'n1',layer:0,flags:1,lanes:2,points:[[0,0,0],[0,0,100]]},b={...a,id:'b',from:'n1',to:'n2',points:[[0,0,100],[0,0,200]]},w=ribbonWorld([a,b]),t=trafficPool(new WorldTraffic(w,{},{})),c=t.cars[0],contact=w.stream.contact;
 w.stream.contact=(x,z,o)=>{const p=contact(x,z,o);return p&&{...p,y:Math.max(0,.4*Math.sin((z-92)/16*Math.PI)),surfaceId:z<100?'a-owner':'b-owner'};};
 const safe=w.safePose;w.safePose=(p,o)=>{const ground=w.stream.contact(p.x,p.z,{referenceY:p.y,layer:p.layer});return safe(p,o)&&Math.abs(p.y-ground.y)<1e-8&&p.surfaceId===ground.surfaceId;};
 const paths=t.turnPaths(a,c);assert.equal(paths.length,1);assert.ok(paths[0].points.some(p=>p.y>.3));assert.equal(paths[0].points.at(-1).surfaceId,'b-owner');
});
test('a legal bridge approach changes curve contact layer to its connected exit',()=>{
 const a={id:'approach',from:'a',to:'b',layer:0,flags:3,lanes:1,surface:'approach',points:[[0,6,0],[0,6,100]]},b={...a,id:'bridge',from:'b',to:'c',layer:1,surface:'deck',points:[[0,6,100],[0,6,200]]},out={...b,id:'after',from:'c',to:'d',points:[[0,6,200],[0,6,300]]},w=ribbonWorld([a,b,out]),t=trafficPool(new WorldTraffic(w,{},{})),c=t.cars[0];
 Object.assign(c,{active:true,offset:91.9,point:{edge:'approach'}});c.vehicle=t.candidate(a,c.offset,c);let crossed=false;
 const contact=w.stream.contact;w.stream.contact=(x,z,o)=>{const p=contact(x,z,o);if(!p)return null;return {...p,layer:o.layer,surfaceId:o.layer===1?'deck':'approach'};};
 for(let i=0;i<200&&c.point.edge!=='bridge';i++){const n=t.advanceLane(c,a,.1);assert.ok(n?.p);Object.assign(c,{offset:n.offset,turn:n.turn,point:n.p,vehicle:n.p});if(n.p.z>104&&n.turn){assert.equal(n.p.layer,1);assert.equal(n.p.surfaceId,'deck');crossed=true;}}
 assert.ok(crossed);assert.equal(c.point.edge,'bridge');
});

// This deterministic gate uses the real published-route graph geometry with
// ideal road ribbons. The separate CLI acceptance uses emitted contacts,
// parked-car boxes and real signal timings; it must also be run for releases.
const shards=new Map();
async function shard(name){if(!shards.has(name))shards.set(name,JSON.parse(await readFile(new URL('../data/routes/validation/'+name+'.inputs.json',import.meta.url))));return shards.get(name);}
for(const [id,name]of [['riviera-coast','athens'],['syntagma-pilot','syntagma-pilot'],['psychiko-faros','athens'],['penteli-hill','penteli'],['penteli-descent','penteli'],['megara-club','megara']]){
 test(`${id}: three-minute moving and parked traffic has no stationary cluster`,async()=>{
  const def=JSON.parse(await readFile(new URL('../data/routes/'+id+'.route.json',import.meta.url))),data=await shard(name),first=data.edges.find(e=>e.id===def.path.edges[0]);assert.ok(first);
  const w=ribbonWorld(data.edges),route={project:(x,z)=>({s:z,u:x})};
  const path=def.path.edges.map(id=>data.edges.find(e=>e.id===id)).filter(Boolean),length=path.reduce((n,e)=>n+edgeLength(e),0);
  for(const mode of ['parked','drive','quick']){const level=id==='megara-club'?0:mode==='quick'?def.trafficLevel:1,position=t=>{let station=(50+(mode==='parked'?0:t*8))%length,e=path[0];for(const edge of path){e=edge;if(station<=edgeLength(edge))break;station-=edgeLength(edge);}const p=edgePoint(e,station),u=mode==='parked'?7:e.flags&1?0:1.5;return {...p,x:p.x+p.rx*u,z:p.z+p.rz*u,vLong:mode==='parked'?0:8,halfL:2.2,halfW:.9};},s=await simulateFlow({session:w,route,position,mode,level,seconds:180});
   assert.equal(s.maxClusters,0,JSON.stringify(s));assert.equal(s.maxFacing,0,JSON.stringify(s));assert.ok(s.maxStopped<=6,JSON.stringify(s));if(level>0)assert.ok(s.spawned>0,'a zero-traffic run cannot prove flow');
  }
 });
}
