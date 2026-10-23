import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldTraffic} from '../src/world-traffic.js';
import {PERFORMANCE} from '../src/graphics.js';
import {edgePoint} from '../src/route-geometry.js';

const vehicle=(x=0,z=0)=>({x,y:0,z,yaw:0,vLong:0,vLat:0,halfL:2.2,halfW:.9});
function fixture({scale=1,level=2,police=false}={}){
 const edges=[{id:'a',from:'A',to:'B',points:[[200,0,-50],[200,0,50]]},{id:'b',from:'B',to:'C',points:[[200,0,50],[300,0,50]]},{id:'c',from:'C',to:'A',points:[[300,0,50],[200,0,-50]]}].map(e=>({...e,flags:1,layer:0}));
 const graph={edges:new Map(edges.map(e=>[e.id,{value:e}])),outgoing:new Map(edges.map(e=>[e.from,[e.id]])),legal:()=>true};
 const t=new WorldTraffic({roads:{graph}}, {}, {project:()=>({s:0,u:0})},{poolSize:66,policePoolSize:8,offlineDensityScale:scale});
 t.configure({traffic:level,rules:{police}},{deferFleet:true});
 t.cars=Array.from({length:74},(_,id)=>({id,police:id>=66,type:{},len:4.4,wid:1.8,mass:1400,active:false,m:{root:{visible:false}},cop:id>=66?{}:undefined}));
 t.pool={rng:{next:()=>0},pickFree:fn=>t.cars.find(c=>!c.police&&!c.active&&fn(c)),initDrive(){}};
 // Road support is controlled here; exercise the real spawn admission and activation.
 t.candidate=(e,s)=>edgePoint(e,s);t.laneClear=()=>true;t.throughPaths=()=>[{}];
 return t;
}
function populate(t,n){for(const c of t.cars){c.active=c.id<n;c.m.root.visible=c.active;c.vehicle=vehicle(10000+c.id*30);c.point={edge:'existing-'+c.id};c.v=7;c.stoppedT=0;}}
const civilians=t=>t.cars.filter(c=>c.active&&!c.police).length;
function admitAtBoundary(t,want){populate(t,Math.max(0,want-1));t.spawn(vehicle(),[]);assert.equal(civilians(t),want,'real spawn replenishes to the graphics budget');t.spawn(vehicle(),[]);assert.equal(civilians(t),want,'real spawn stops at that budget');assert.equal(t.cars.length,74);assert.equal(t.poolSize,66);assert.equal(t.policePoolSize,8);}
function online(t,n){
 const players=Array.from({length:n},(_,gridSlot)=>({id:'p'+gridSlot,gridSlot,loaded:true,connected:true}));
 const rows=players.map(p=>({...p,vehicle:vehicle(0,p.gridSlot*10),accepted:true})),peers=new Map(players.slice(1).map(p=>[p.id,{state:{pursuit:0}}]));
 rows.push({id:'unaccepted',vehicle:vehicle(),accepted:false,gridSlot:7});t.focusProvider=()=>rows;
 let relayed;const extra=vehicle(500,500);t.update=(_dt,_player,actors)=>{relayed=actors;};
 assert.equal(t.updateOnlineAuthority(0,{lobby:{host:'p0',players},id:'p0',player:rows[0].vehicle,peers,actors:[extra]}),true);
 assert.equal(t.onlineTargets.size,n);assert.ok(relayed.includes(extra));for(const row of rows.slice(0,n))assert.ok(relayed.includes(row.vehicle),'all accepted peer actors reach authority physics');return {rows,relayed};
}

test('offline civilian replenishment consumes the existing graphics-class density budget',()=>{
 const expected={potato:[3,6],low:[5,10],med:[7,14],high:[8,16]};
 for(const [name,counts]of Object.entries(expected))for(const level of [1,2])admitAtBoundary(fixture({scale:PERFORMANCE[name].traffic,level}),counts[level-1]);
 admitAtBoundary(fixture({scale:0}),0);
});

test('lowering the offline budget never hides active cars or resizes the fleet',()=>{
 const t=fixture();populate(t,16);const active=t.cars.slice(0,16),poses=active.map(c=>c.vehicle);t.setOfflineDensityScale(.4);t.spawn(vehicle(),[]);
 assert.equal(civilians(t),16);assert.ok(active.every((c,i)=>c.active&&c.m.root.visible&&c.vehicle===poses[i]));assert.equal(t.cars.length,74);
 populate(t,5);t.spawn(vehicle(),[]);assert.equal(civilians(t),6);populate(t,6);t.setOfflineDensityScale(1);t.spawn(vehicle(),[]);assert.equal(civilians(t),7,'raising the budget permits replenishment again');
});

test('density preference survives event configuration; defaults and invalid input retain full budget',()=>{
 const t=fixture({scale:.4});t.configure({traffic:2,rules:{police:false}},{deferFleet:true});admitAtBoundary(t,6);
 for(const value of [undefined,NaN,Infinity,-Infinity,null,'0.4']){const full=fixture();full.setOfflineDensityScale(value);admitAtBoundary(full,16);}
 const low=fixture({scale:-2}),high=fixture({scale:2});admitAtBoundary(low,0);admitAtBoundary(high,16);
 const standard=fixture();admitAtBoundary(standard,16);
});

test('online accepted-focus targets ignore every local density scale and keep full actor relay',()=>{
 for(const scale of [0,.4,.6,1])for(const peers of [1,2,8]){const t=fixture({scale});online(t,peers);admitAtBoundary(t,{1:16,2:32,8:66}[peers]);t.setOfflineDensityScale(0);assert.equal(t.onlineTargets.size,peers);}
});

test('an offline zero civilian budget does not reduce police patrol dispatch',()=>{
 const t=fixture({scale:0,police:true});populate(t,0);t.spawn(vehicle(),[]);const first=t.cars.find(c=>c.police&&c.active);Object.assign(first.vehicle,vehicle(10000));first.point={edge:'existing-police'};t.spawn(vehicle(),[]);assert.equal(civilians(t),0);assert.equal(t.cars.filter(c=>c.police&&c.active).length,2);t.spawn(vehicle(),[]);assert.equal(t.cars.filter(c=>c.police&&c.active).length,2);
});

test('online zero civilian scale still admits the eighth reserved police actor',()=>{
 const t=fixture({scale:0,police:true});online(t,8);populate(t,66);for(const c of t.cars.slice(66,73)){c.active=true;c.m.root.visible=true;}t.pendingCopFocus=t.onlineTargets.get('p0');t.spawn(vehicle(),[]);
 assert.equal(civilians(t),66);assert.equal(t.cars.filter(c=>c.police&&c.active).length,8);assert.equal(t.cars.length,74);
});
