import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {PSYCHIKO_BUILDINGS as recipe} from '../src/psychiko-building-data.js';
import {psychikoBuildingData} from './export-psychiko-buildings.mjs';
import {psychikoMappedBuildings,psychikoInfillBlocked} from '../src/world-tile-psychiko.js';
import {deriveBuildingMeshes} from '../src/world-tile-buildings.js';
import {buildTileObstacleIndex,WorldTileObstacles} from '../src/world-tile-obstacles.js';
import {WorldPsychikoDetail} from '../src/world-psychiko-detail.js';
const data=JSON.parse(await readFile(new URL('../data/maps/psychiko/map.json',import.meta.url)));
const ground=()=>({buildings:new Uint32Array(),buildingCorners:new Float32Array(),buildingHeights:new Float32Array(),finePositions:Float32Array.of(0,190,0,512,192,0,512,194,512,0,192,512),fineTriangles:Uint32Array.of(0,2,1,0,3,2)});
const metadata=cell=>({cell,origin:[cell[0]*512,0,cell[1]*512],ids:[]});
const owner=b=>{const x=b.p.filter((_,i)=>i%2===0),z=b.p.filter((_,i)=>i%2);return [Math.floor((Math.min(...x)+Math.max(...x))/1024),Math.floor((Math.min(...z)+Math.max(...z))/1024)];};
test('worker recipe reproduces the reviewed map, including multipart courtyards and gardens',async()=>{
 assert.deepEqual(recipe,await psychikoBuildingData());assert.equal(recipe.buildings.length,3647);
 assert(recipe.buildings.some(b=>b.source.startsWith('r')));assert(recipe.gardens.length>20);
});
test('infill exclusions catch containment, crossing edges and authored gardens; distant gaps stay available',()=>{
 const b=recipe.buildings.find(b=>b.source==='w425080449'),p=Array.from({length:b.p.length/2},(_,i)=>b.p.slice(i*2,i*2+2));
 assert(psychikoInfillBlocked(p));const x=p[0][0],z=p[0][1];
 assert(psychikoInfillBlocked([[x-2000,z-.5],[x+2000,z-.5],[x+2000,z+.5],[x-2000,z+.5]]));
 assert(psychikoInfillBlocked([[3750,-3700],[3760,-3700],[3760,-3690],[3750,-3690]]));
 assert.equal(psychikoInfillBlocked([[0,0],[10,0],[10,10],[0,10]]),false);
});
test('authored replacement removes both generic shells and conflicting infill from render and collision',()=>{
 const m=metadata([7,-7]),t=ground();m.ids=['building:w425080449:0','building:gen:overlap:0'];
 t.buildings=Uint32Array.of(0,0,4,2,1,4,4,2);t.buildingCorners=Float32Array.of(30,30,40,30,40,40,30,40,100,100,120,100,120,120,100,120);t.buildingHeights=Float32Array.of(190,25,190,22);
 const before=structuredClone(t),result=psychikoMappedBuildings(t,m);assert.equal(result.removed,2);assert.deepEqual(t,before,'wire tables remain immutable');
 const ids=Array.from({length:result.tables.buildings.length/4},(_,i)=>m.ids[result.tables.buildings[i*4]]);assert(ids.every(id=>id.startsWith('building:psychiko:')));
 assert.equal(deriveBuildingMeshes(result.tables,m).meshes.length,0,'authored shells have no duplicate procedural roof/facade');
 assert(m.psychikoShells.length>100);assert(buildTileObstacleIndex(result.tables).segments.length>0);
 const remote=ground(),far=metadata([0,0]);assert.equal(psychikoMappedBuildings(remote,far).tables,remote);
});
test('a footprint crossing a cell boundary has one owner and collision walls beyond that boundary',()=>{
 const b=recipe.buildings.find(b=>{const [cx,cz]=owner(b);return b.p.some((v,i)=>v<(i%2?cz:cx)*512||v>(i%2?cz:cx)*512+512);}),cell=owner(b),m=metadata(cell),result=psychikoMappedBuildings(ground(),m);
 assert.equal(m.psychikoShells.filter(r=>r[0]===b.index).length,1);
 const neighbour=metadata([cell[0]+1,cell[1]]);psychikoMappedBuildings(ground(),neighbour);assert(!neighbour.psychikoShells?.some(r=>r[0]===b.index));
 const row=Array.from({length:result.tables.buildings.length/4},(_,i)=>i).find(i=>m.ids[result.tables.buildings[i*4]]==='building:psychiko:'+b.index),first=result.tables.buildings[row*4+1],n=result.tables.buildings[row*4+2],p=result.tables.buildingCorners.slice(first*2,(first+n)*2),obstacles=new WorldTileObstacles();
 obstacles.install(cell.join(','),{metadata:m,obstacleIndex:buildTileObstacleIndex(result.tables)});
 const i=Array.from({length:n},(_,i)=>i).find(i=>p[i*2]<0||p[i*2]>512||p[i*2+1]<0||p[i*2+1]>512),y=result.tables.buildingHeights[row*2];
 assert(obstacles.contact(p[i*2]+m.origin[0],y,p[i*2+1]+m.origin[2],.1));obstacles.dispose();
});
test('authored facades, shell heights and roofs survive rebasing/detail Off, share an atlas and unload together',()=>{
 const index=data.buildings.findIndex(b=>b.id===425080449),other=data.buildings.findIndex(b=>b.pitched&&b.p.length===8&&Math.max(...b.p.filter((_,i)=>i%2===0))-Math.min(...b.p.filter((_,i)=>i%2===0))<25),scene=new THREE.Group(),tiles=new Map([['7,-7',{packet:{metadata:{psychikoShells:[[index,190,192],[other,191,193]]}}}],['7,-8',{packet:{metadata:{psychikoShells:[[index,194,195]]}}}]]),listeners=new Set();
 const session={stream:{tiles,origin:{x:3584,z:-3584},contact:()=>({y:190}),readyAt:()=>true},subscribeTiles:l=>{listeners.add(l);return()=>listeners.delete(l);}},detail=new WorldPsychikoDetail(session,scene,data),player={x:3800,z:-3500};
 try{detail.changed('7,-7',true);detail.update(player);const b=detail.buildings.get('7,-7'),shell=b.roofs.find(b=>b.id===425080449);assert.equal(shell.gmin,190);assert.equal(shell.top,199.3);assert.equal(shell.facadeStyle,5);assert.equal(shell.color,'#eee8d8');assert(detail.roofs.get('7,-7').geometry.attributes.position.count>0);
  detail.street.setEnabled(false);assert.equal(b.group.visible,true,'plain buildings remain when World detail is Off');
  detail.changed('7,-8',true);detail.update(player);assert.equal(detail.buildings.get('7,-8').group.children[0].material,b.group.children[0].material);
  session.stream.origin={x:4096,z:-4096};detail.update(player);assert.equal(b.group.position.x,detail.ox-4096);assert.equal(b.group.scale.x,detail.sx);
  const geometries=b.group.children.map(m=>m.geometry),disposed=new Set();for(const g of geometries)g.addEventListener('dispose',()=>disposed.add(g));detail.changed('7,-7',false);assert.equal(disposed.size,geometries.length);assert(!scene.getObjectByName('psychiko-authored-buildings:7,-7'));assert(!detail.roofs.has('7,-7'));
 }finally{detail.dispose();}assert.equal(listeners.size,0);assert(!scene.getObjectByName('psychiko-authored-buildings:7,-8'));
});
