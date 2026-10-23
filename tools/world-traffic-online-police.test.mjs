import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldTraffic} from '../src/world-traffic.js';
import {encodePursuit,decodePursuit} from '../src/police.js';
import {trafficPool} from './world-traffic-sim.mjs';

const vehicle=(x=0,z=50,vLong=0)=>({x,y:0,z,yaw:0,vLong,vLat:0,halfL:2.2,halfW:.9});
function fixture(){
 const edge={id:'road',from:'a',to:'b',layer:0,flags:0,speedKph:35,points:[[0,0,200],[0,0,0]]};
 const session={roads:{graph:{edges:new Map([['road',{value:edge}]]),nearest:()=>({edge:'road'})}},props:{hold:()=>false},obstacles:{contact:()=>null},stream:{origin:{x:0,z:0}}};
 let rows=[];const t=trafficPool(new WorldTraffic(session,{}, {project:(x,z)=>({s:z,u:x})},{poolSize:66,policePoolSize:8,focusProvider:()=>rows}));
 t.configure({traffic:1,rules:{police:true}},{deferFleet:true});
 for(const c of t.cars.slice(0,8))Object.assign(c,{police:true,cop:{},active:true,vehicle:vehicle(0,45),point:{edge:'road'},v:0});
 const host=vehicle(),a=vehicle(100,50,20),b=vehicle(-100,50,10),members=[{id:'host',gridSlot:0},{id:'a',gridSlot:1},{id:'b',gridSlot:2}].map(p=>({...p,loaded:true,connected:true}));
 const lobby={host:'host',players:members},peers=new Map([['a',{state:{pursuit:encodePursuit('pursuit',2,12)}}],['b',{state:{pursuit:encodePursuit('warning')}}]]);
 const context={lobby,id:'host',player:host,actors:[host],peers};
 const setRows=()=>{rows=members.map(p=>({id:p.id,gridSlot:p.gridSlot,vehicle:p.id==='host'?host:p.id==='a'?a:b,accepted:true}));};setRows();
 let advances=0,lastActors;const update=t.update.bind(t);t.update=(_dt,_player,actors)=>{advances++;lastActors=actors;};
 return {t,session,lobby,members,peers,context,host,a,b,setRows,set rows(value){rows=value;},get rows(){return rows;},get advances(){return advances;},get actors(){return lastActors;},update};
}

test('authority dispatch uses every accepted driver pursuit and preserves separate targets',()=>{
 const f=fixture(),{t}=f;t.updateOnlineDriver(0,{id:'host',player:f.host,gridSlot:0});t.hm.begin(1);
 assert.equal(t.updateOnlineAuthority(.1,f.context),true);assert.equal(f.advances,1);
 assert.deepEqual([...t.onlineTargets.keys()],['host','a','b']);assert.equal(t.onlineTargets.get('a').level,2);assert.equal(t.onlineTargets.get('a').time,12);
 const cops=t.cars.filter(c=>c.active&&c.police);assert.ok(cops.some(c=>c.targetId==='a'&&c.cop.target===1&&c.cop.chase&&c.cop.siren));assert.ok(cops.some(c=>c.targetId==='b'&&c.cop.target===2));assert.ok(cops.some(c=>c.targetId==='host'&&c.cop.target===0));
 assert.ok(f.actors.includes(f.a)&&f.actors.includes(f.b));assert.equal(t.hm.level,1,'remote stars cannot overwrite the local heat machine');assert.ok(cops.every(c=>c.active),'dispatch does not hide existing units');
});

test('replica judgment changes only its own heat and never advances shared NPCs',()=>{
 const f=fixture(),g=fixture();f.a.x=0;const before=f.t.cars.map(c=>({active:c.active,vehicle:{...c.vehicle}}));
 assert.equal(f.t.updateOnlineAuthority(.1,{...f.context,id:'a',player:f.a}),false);assert.equal(f.advances,0);
 for(let i=0;i<50;i++){f.t.updateOnlineDriver(.1,{id:'a',player:f.a,gridSlot:1});g.t.updateOnlineDriver(.1,{id:'host',player:g.host,gridSlot:0});}
 assert.equal(f.advances,0);assert.ok(f.t.hm.level>=1,'witnessed sustained speeding creates this driver pursuit');assert.equal(g.t.hm.heat,0,'a lawful other driver remains clear');assert.equal(decodePursuit(f.t.pursuitCode()).state,'pursuit');
 assert.deepEqual(f.t.cars.map(c=>({active:c.active,vehicle:{...c.vehicle}})),before);
});

test('another driver chasing units cannot arrest this driver; own units can',()=>{
 const f=fixture(),t=f.t;for(const c of t.cars.filter(c=>c.police))c.cop={chase:true,target:1};
 t.updateOnlineDriver(0,{id:'host',player:f.host,gridSlot:0});t.hm.begin(2);t.hm.time=9;
 t.updateOnlineDriver(5,{id:'host',player:f.host,gridSlot:0});assert.equal(t.hm.bust,0);assert.equal(t.hm.state,'pursuit');
 let transitions=[];t.onVoice=(_state,events)=>transitions.push(...events);t.cars[0].cop.target=0;
 t.updateOnlineDriver(4.1,{id:'host',player:f.host,gridSlot:0});assert.ok(transitions.some(e=>e.phase==='busted'));assert.equal(t.hm.state,'idle');
});

test('a witnessed warning can be complied with beside an assigned shared officer',()=>{
 const f=fixture(),t=f.t;t.cars[0].cop={chase:true,target:0};t.updateOnlineDriver(0,{id:'host',player:f.host,gridSlot:0});t.hm.offence('red',.3,true);
 t.updateOnlineDriver(2.1,{id:'host',player:f.host,gridSlot:0});assert.equal(t.hm.state,'idle');assert.equal(t.hm.heat,0);
});

test('disconnect and reconnect release stale targets without removing visible police',()=>{
 const f=fixture(),t=f.t;t.updateOnlineAuthority(.1,f.context);const visible=t.cars.filter(c=>c.active&&c.police);
 f.members[1].connected=false;t.updateOnlineAuthority(.1,f.context);assert.equal(t.onlineTargets.has('a'),false);assert.ok(visible.every(c=>c.active&&c.targetId!=='a'&&c.cop.target!==1));
 f.members[1]={id:'reconnected',gridSlot:1,loaded:true,connected:true};f.peers.set('reconnected',{state:{pursuit:0}});f.setRows();
 // The replacement has its own pose; an old pursuit code must not follow a slot.
 f.rows=f.rows.map(r=>r.id==='reconnected'?{...r,vehicle:f.a}:r);t.updateOnlineAuthority(.1,f.context);
 assert.equal(t.onlineTargets.get('reconnected').state,'idle');assert.ok(visible.every(c=>c.active));
 t.configure({traffic:1,rules:{police:true}},{deferFleet:true});assert.equal(t.onlineTargets.size,0);assert.equal(t.onlineDriver,null);assert.equal(t.onlineAuthority,false);assert.ok(t.cars.every(c=>!c.targetId&&!c.cop?.chase));
});

test('unloaded, disconnected, DNF, absent-state and wrong-slot foci never enter dispatch',()=>{
 const f=fixture(),t=f.t;f.members.push({id:'loading',gridSlot:3,loaded:false},{id:'gone',gridSlot:4,loaded:true,connected:false},{id:'dnf',gridSlot:5,loaded:true,dnf:true},{id:'absent',gridSlot:6,loaded:true});
 f.rows=[...f.rows,{id:'loading',gridSlot:3,accepted:true,vehicle:vehicle()},{id:'gone',gridSlot:4,accepted:true,vehicle:vehicle()},{id:'dnf',gridSlot:5,accepted:true,vehicle:vehicle()},{id:'absent',gridSlot:6,accepted:true,vehicle:vehicle()},{id:'outsider',gridSlot:7,accepted:true,vehicle:vehicle()}];f.rows[1].gridSlot=7;f.rows[2].accepted=false;
 t.updateOnlineAuthority(.1,f.context);assert.deepEqual([...t.onlineTargets.keys()],['host']);
 f.members[0].connected=false;const at=f.advances;assert.equal(t.updateOnlineAuthority(.1,f.context),false);assert.equal(f.advances,at,'former authority cannot keep running private AI');
});

test('driver identity changes and explicit departure reset only local law judgment',()=>{
 const f=fixture(),t=f.t;t.updateOnlineDriver(0,{id:'host',player:f.host,gridSlot:0});t.hm.begin(3);const before=f.advances;
 t.updateOnlineDriver(0,{id:'new-driver',player:f.host,gridSlot:0});assert.equal(t.hm.heat,0);assert.equal(t.hm.state,'idle');
 t.hm.begin(2);t.updateOnlineDriver(0,{});assert.equal(t.hm.heat,0);assert.equal(t.onlineDriver,null);assert.equal(f.advances,before);
});

test('a shared officer follows its assigned remote driver rather than the authority driver',()=>{
 const f=fixture(),t=f.t;f.a.x=1000;f.host.x=-1000;t.updateOnlineAuthority(.1,f.context);
 const c=t.cars.find(c=>c.targetId==='a'),a={id:'approach',from:'n0',to:'junction',layer:0,points:[[0,0,0],[0,0,100]]},east={id:'east',from:'junction',to:'e',layer:0,points:[[0,0,100],[100,0,100]]},west={...east,id:'west',to:'w',points:[[0,0,100],[-100,0,100]]};
 for(const e of [a,east,west])t.session.roads.graph.edges.set(e.id,{value:e});t.session.stream.contact=()=>({y:0,layer:0});
 const path=e=>({next:e.id,from:a.id,via:a.to,entry:92,exit:8,length:16,points:[{x:0,y:0,z:92,yaw:0,edge:a.id,edgeId:a.id,layer:0,s:0},{x:e.id==='east'?8:-8,y:0,z:100,yaw:0,edge:a.id,edgeId:e.id,layer:0,s:16}]});
 t.throughPaths=()=>[path(west),path(east)];Object.assign(c,{offset:91.9,point:{edge:a.id},turn:null});t.cars=[c];
 assert.equal(t.hm.state,'idle');assert.equal(t.advanceLane(c,a,.2,f.host).turn.next,'east');
});

test('authority handover retains accepted snapshot target slots and protects cars near remote cameras',()=>{
 const f=fixture(),t=f.t;for(const c of t.cars.filter(c=>c.police))c.cop={target:1,chase:true,siren:true};t.updateOnlineAuthority(.1,f.context);
 assert.ok(t.cars.some(c=>c.targetId==='a'&&c.cop.target===1));
 const c=t.cars[0];Object.assign(c,{visibilityTracked:true,lastSeenAt:0,blockedAt:0});t.t=30;f.host.x=1000;f.a.x=c.vehicle.x;f.a.z=c.vehicle.z;
 assert.equal(t.retireUnseen(c,[f.host]),false,'the host cannot remove a car in a remote driver camera range');assert.equal(c.active,true);
});
