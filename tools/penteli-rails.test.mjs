import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Route} from '../src/map.js';
import {Ground} from '../src/ground.js';
import {DrivableCorridor} from '../src/drivable-corridor.js';
import {buildPenteliRails,penteliRailHazard} from '../src/maps/penteli-roadside.js';
import {carriagewayWidth} from './maps/penteli/widths.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../data/maps/penteli/map.json',import.meta.url))),route=new Route(data.route);
route.urban=()=>0;route.district=()=> 'mountain';
test('OSM widths override class defaults; lanes respected',()=>{
 assert.equal(carriagewayWidth({highway:'secondary',width:'6.9 m',lanes:'2'}),6.9);
 assert.equal(carriagewayWidth({highway:'secondary',lanes:'2'}),7.2);
 assert.equal(carriagewayWidth({highway:'service'}),4.5);
 assert.equal(carriagewayWidth({highway:'tertiary',lanes:'1'}),3.4);
});
test('widened route keeps grid, two cars, progress and corridor on tarmac',()=>{
 const corridor=new DrivableCorridor(route);
 assert.equal(route.start,data.route.start);assert.equal(route.finish,data.route.finish);
 for(let s=0;s<route.length;s+=17){
  assert.ok(route.edge(s)>=3.6-1e-5&&route.edge(s)<=3.9+1e-5);
  for(const u of [-1.8,1.8]){assert.ok(Math.abs(u)+1<route.edge(s));const p=route.point(s,u),q=route.project(p.x,p.z,s);assert.ok(Math.abs(q.s-s)<.3);assert.equal(corridor.distance(p.x,p.z),0);}
  const edge=route.point(s,route.edge(s)-.05);assert.ok(corridor.distance(edge.x,edge.z)<.15);
  assert.ok(Math.abs(route.racingU(s))+1<route.edge(s));
 }
});
test('drop rules leave flat and uphill verges open, protect valley, outer hairpin and bridge',()=>{
 const flat={drop8:0,drop16:0,drop24:0,curvature:0,side:1};
 assert.equal(penteliRailHazard(flat),null);
 assert.equal(penteliRailHazard({...flat,drop8:-3,drop16:-8,drop24:-12}),null);
 assert.equal(penteliRailHazard({...flat,drop8:2,drop16:6,drop24:10}),'drop');
 assert.equal(penteliRailHazard({...flat,drop8:1,drop16:3,drop24:4,curvature:-.04}),'hairpin');
 assert.equal(penteliRailHazard({...flat,drop8:1,drop16:3,drop24:4,curvature:.04}),null);
 assert.equal(penteliRailHazard({...flat,bridge:true}),'bridge');
});
test('placement preserves junction gaps, grounded posts, turned ends and mapped bridge parapets',()=>{
 const r={length:800,edge:()=>3.6,curv:()=>0,point:(s,u)=>({x:s,y:0,z:u})};
 const h=(x,z)=>-Math.max(0,Math.abs(z)-4)*.5;
 const map={route:r,data:{penteli:{fork:600,bridges:[{from:300,to:330}]}},roadNetwork:{mouth:s=>s>400&&s<430,sample:()=>null}};
 const runs=buildPenteliRails(map,h);assert.ok(runs.some(r=>r.kind==='concrete'));
 for(const run of runs){for(const q of run.pts){assert.ok(!(q.s>400&&q.s<430));assert.ok(Math.abs(q.s-600)>=42);assert.equal(q.p.y,h(q.p.x,q.p.z));assert.ok(q.u>3.6);}
  if(run.kind==='steel'){assert.equal(run.pts[0].terminal,0);assert.equal(run.pts.at(-1).terminal,0);assert.ok(run.pts.some(q=>q.terminal===1));}
 }
});
test('solid rail limits and glancing collision retain forward motion',()=>{
 const rails=[{side:1,pts:[{s:100,u:4.5}]}];
 const ground=new Ground({id:'penteli',route,data:{buildings:[]},terrain:{height:()=>0}},()=>0,{rails});
 const limits=ground.limits(100,1,{});assert.equal(limits.max,3.25);
 const v={x:0,z:0,yaw:0,vLong:20,vLat:3,w:.1,halfW:1,halfL:2,m:1500,Iz:2200,wallHit:0,pose:{rollV:0,heaveV:0},wheel:[]};
 ground._hit(v,-1,0,.3);assert.equal(v.x,-.3);console.log('rail result',v.vLong,v.vLat,v.w,v.wallHit);assert.ok(v.vLong>16&&v.vLong<20);assert.ok(v.vLat<=0);assert.ok(Math.abs(v.wallHit-3)<.4,'closing speed at the contact point, about the 3 m/s the car was moving into the rail');
 // Tangential or departing contact neither brakes nor sticks.
 v.vLong=20;v.vLat=-1;ground._hit(v,-1,0,0);assert.equal(v.vLong,20);assert.equal(v.vLat,-1);
});
