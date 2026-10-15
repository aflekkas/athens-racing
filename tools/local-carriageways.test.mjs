import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Route} from '../src/map.js';
import {RIVIERA_TUNNELS} from '../src/maps/riviera-tunnels.js';
const saved=JSON.parse(fs.readFileSync('data/map.json'));
const base=new Route(saved.route),route=new Route(saved.route,{corridors:RIVIERA_TUNNELS});
test('both real bore axes pass through every OSM knot and preserve source route arrays',()=>{const before=JSON.stringify(saved.route);for(const b of route.localCorridors)for(let i=0;i<b.stations.length;i++){const p=b.point(b.stations[i],0,{});assert.ok(Math.hypot(p.x-b.axis3D[i][0],p.z-b.axis3D[i][2])<1e-5);assert.equal(p.y,b.axis3D[i][1]);}assert.equal(JSON.stringify(saved.route),before);assert.deepEqual(route.X,base.X);// Runtime heights conform to the physical bore shoulders; source Y remains unchanged.
assert.deepEqual(route.Z,base.Z);});
test('lane positions round-trip through the physical twin bores and approach transitions',()=>{for(let s=9272;s<=9668;s+=1)for(const side of[-1,1])for(const lane of[0,1]){const u=side*route.laneU(s,lane),p=route.point(s,u),q=route.project(p.x,p.z,s-2,12);assert.ok(Math.abs(q.s-s)<.003&&Math.abs(q.u-u)<.003,`s=${s} u=${u} inverse=${JSON.stringify(q)}`);}});
test('transitions preserve legacy points and have no position/tangent jumps at the joins',()=>{for(const c of route.localCorridors)for(const s of c.transitionS){const u=c.direction*route.laneU(s,0),p=route.point(s,u),q=base.point(s,u);assert.ok(Math.hypot(p.x-q.x,p.z-q.z)<1e-6);const a=route.contactFrame(s-.01,u,{}),b=route.contactFrame(s+.01,u,{});assert.ok(a.tx*b.tx+a.tz*b.tz>.9999);}});
test('mapped contact frame exposes finite true grade/bank and a clear eight metre roadway',()=>{for(const c of route.localCorridors)for(let s=c.portalS[0];s<=c.portalS[1];s+=.5){const u=route.localLayout.centreU(s,c.direction),f=route.contactFrame(s,u,{}),l=c.point(s,-c.width/2,{}),r=c.point(s,c.width/2,{});assert.equal(f.mapped,true);assert.ok(Math.abs(Math.hypot(f.tx,f.tz)-1)<1e-7);assert.ok(Number.isFinite(f.grade)&&Number.isFinite(f.bank));assert.ok(Math.abs(Math.hypot(l.x-r.x,l.z-r.z)-8)<1e-7);}});

test('global recovery projection identifies both bores without a progress hint',()=>{for(let s=9280;s<9660;s+=2)for(const side of[-1,1]){const u=side*route.laneU(s,1),p=route.point(s,u),q=route.project(p.x,p.z);assert.ok(Math.abs(q.s-s)<.003&&Math.abs(q.u-u)<.003);}});
