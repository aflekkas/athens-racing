import fs from 'node:fs';import assert from 'node:assert/strict';import {Group} from 'three';
import {Route} from '../../src/map.js';import {Vehicle} from '../../src/physics.js';import {PenteliGround} from '../../src/maps/penteli-ground.js';
const root=new URL('../../',import.meta.url),data=JSON.parse(fs.readFileSync(new URL('data/maps/penteli/map.json',root))),r=new Route(data.route);r.urban=()=>0;r.district=()=> 'mountain';r.seaR=r.seaL=()=>1e6;
const source=fs.readFileSync(new URL('src/cars.js',root),'utf8'),cars=Function('return '+source.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const placement=JSON.parse(fs.readFileSync(new URL('placement.json',import.meta.url)));
const rails=placement.rails.map(run=>({side:run.side,pts:run.pts.map(p=>({s:p[2],u:p[3]}))}));
const height=(x,z)=>{const q=r.project(x,z);return r.surfaceY(q.s,q.u);};
const g=new PenteliGround({id:'penteli',route:r,data:{buildings:[]}},height,{rails},{group:new Group()});
const rows=[];
for(const run of rails.filter(r=>r.pts.length>20)){
 const q=run.pts[Math.floor(run.pts.length/2)],v=new Vehicle(cars.find(c=>c.id==='mini'),r);v.reset(q.s,run.side*(q.u-v.halfW-.25+.3),20);const f=r.frame(q.s,{});
 // Set lateral world velocity toward the rail; Vehicle yaw uses the opposite sign to route.heading.
 const rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);v.vLat=3*run.side*(rx*f.rx+rz*f.rz);
 const before=v.vLong;g.resolve(v,1/60);const pr=r.project(v.x,v.z,q.s);assert.ok(run.side*pr.u<=q.u-v.halfW-.24);assert.ok(v.vLong>before*.85);
 rows.push({s:q.s,side:run.side,before,after:v.vLong,u:pr.u,limit:q.u-v.halfW-.25,wallHit:v.wallHit});
}
assert.ok(rows.length>8);fs.writeFileSync(new URL('contact-report.json',import.meta.url),JSON.stringify(rows,null,2));console.log('PASS',rows.length,'production Vehicle + PenteliGround sliding contacts');
