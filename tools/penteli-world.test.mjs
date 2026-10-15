import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Route,Terrain} from '../src/map.js';
import {RoadNetwork,triangleHeight} from '../src/road-network-surface.js';
import {cutMountainRoads} from '../src/road-cut.js';
import {roadSignLayout,speedSignRecords} from '../src/road-sign-layout.js';
import {penteliJunctions,PENTELI_GUARDRAILS} from '../src/maps/penteli-roadside.js';
const data=JSON.parse(readFileSync(new URL('../data/maps/penteli/map.json',import.meta.url)));
const route=new Route(data.route);route.urban=()=>0;
route.district=s=>{let zone=data.zones[0];for(const q of data.zones)if(s>=q.s)zone=q;return zone.zone;};
const bytes=readFileSync(new URL('../data/maps/penteli/terrain.bin',import.meta.url));
const terrain=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const map={id:'penteli',data,route,terrain};map.roadNetwork=new RoadNetwork(map);
test('mountain road bed clears full carriageway, shoulders and verge at 2 m, without changing the race axis',()=>{
 const heights=terrain.H.slice(),before=Array.from(route.Y);map.roadNetwork.source=terrain.H.slice();
 cutMountainRoads(terrain,route,heights,map.roadNetwork);
 for(let s=0;s<=route.length;s+=2)for(let u=-route.edge(s)-3;u<=route.edge(s)+3;u+=1){const p=route.point(s,u);assert.ok(triangleHeight(terrain,heights,p.x,p.z)<p.y-.1,`terrain intersects s=${s} u=${u}`);}
 assert.deepEqual(Array.from(route.Y),before);
});
test('OSM fork and upper hairpin connect to substantial off-course roads',()=>{
 const junctions=penteliJunctions(map);
 assert.ok(junctions.find(j=>j.roadId===224029663)?.length>800,'Nea Makri continuation');
 assert.ok(junctions.find(j=>j.roadId===101785908)?.length>500,'upper hairpin branch');
 const short=map.data.roadNetwork.roads.find(r=>r.id===926267606),long=map.data.roadNetwork.roads.find(r=>r.id===101785908);
 assert.deepEqual(short.p.slice(-2),long.p.slice(-2),'25 m arm joins the 570 m OSM road');
});
test('signs face both approaches; inferred reverse limits match the entered zone; rails stay sparse',()=>{
 const signs=roadSignLayout(map);for(const kind of ['direction','curve','yield','village','chevron-left','chevron-right'])assert.ok(signs.some(s=>s.kind===kind),kind);
 for(const s of signs){assert.ok(Number.isFinite(s.yaw));assert.ok(!map.roadNetwork.sample(s.x,s.z),`sign obstructs OSM road ${s.kind}@${s.s}`);}
 const speeds=speedSignRecords(map);assert.equal(speeds.find(s=>s.dir<0&&s.s===5750).v,50);assert.equal(speeds.find(s=>s.dir<0&&s.s===6000).v,30);
 assert.ok(PENTELI_GUARDRAILS.reduce((n,r)=>n+r.to-r.from,0)<route.length*.05);
 const riviera={id:'riviera',data:{speedSigns:[{s:10,v:50,dir:1}]}};assert.equal(speedSignRecords(riviera),riviera.data.speedSigns);
});

test('Penteli gravel contacts use rendered triangles and have no phantom sidewalk',async()=>{
 const THREE=await import('three'),{buildPenteliSurface}=await import('../src/maps/penteli-surface.js'),{PenteliGround}=await import('../src/maps/penteli-ground.js');
 const scene=new THREE.Group(),height=(x,z)=>terrain.height(x,z)-3,road=buildPenteliSurface(scene,map,height),ground=new PenteliGround(map,height,{network:map.roadNetwork},road);
 let tested=0;
 for(const mesh of road.group.children){const p=mesh.geometry.attributes.position.array,ix=mesh.geometry.index.array;for(let i=0;i<ix.length;i+=3*23){const ids=[ix[i]*3,ix[i+1]*3,ix[i+2]*3],x=ids.reduce((n,k)=>n+p[k],0)/3,z=ids.reduce((n,k)=>n+p[k+2],0)/3,y=ids.reduce((n,k)=>n+p[k+1],0)/3,q=route.project(x,z,null);if(map.roadNetwork.sample(x,z)||Math.abs(q.u)<=route.edge(q.s))continue;const hit=ground.at(x,z,q.s,q.u,{});assert.ok(hit.y>=y-1e-4);assert.equal(hit.networkStep,0);assert.notEqual(hit.surf,'pavement');tested++;}}
 assert.ok(tested>100);road.dispose();
});


test('Penteli rock decoration follows ground and leaves the six-metre re-entry shoulder clear',async()=>{
 const THREE=await import('three'),{buildScenery}=await import('../src/maps/penteli.js');
 const height=(x,z)=>terrain.height(x,z),scene=new THREE.Group(),world=buildScenery(scene,map,{heightC:height,assets:{network:map.roadNetwork}});
 const barriers=world.group.children.filter(m=>m.name.startsWith('Penteli barrier chunk'));
 assert.ok(barriers.length>0);
 for(const m of barriers){assert.ok(m.boundingSphere&&m.userData.lod&&m.userData.far);if(m.name.endsWith(':concrete'))assert.equal(m.material.side,THREE.DoubleSide,'both parapet faces remain visible on either road side');}
 const cut=world.group.children.find(m=>m.name.startsWith('EP5 layered natural rock cutting'));
 assert.ok(cut);const p=cut.geometry.attributes.position,ix=cut.geometry.index.array;let checked=0;
 for(const i of new Set(ix)){
  const x=p.getX(i),z=p.getZ(i),q=route.project(x,z,null);
  assert.ok(Math.abs(q.u)>route.edge(q.s)+5.99,'rock cut never occupies the drivable shoulder');
  assert.ok(Math.abs(p.getY(i)-height(x,z)-.015)<.002,'decorative rock cannot float above contact terrain');checked++;
 }
 assert.ok(checked>100);world.dispose();
});

// Width, barrier placement, corridor and sliding-contact regressions.
import './penteli-rails.test.mjs';
