import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivableCorridor, roadEdgeDistance, corridorThresholds, corridorRecovery } from '../src/drivable-corridor.js';
test('capsule distance handles road edges, finite ends, degeneracy and connected roads',()=>{
  assert.equal(roadEdgeDistance(5,10,{x:0,z:0},{x:10,z:0},4),6);
  assert.equal(roadEdgeDistance(13,4,{x:0,z:0},{x:10,z:0},2),3);
  assert.equal(roadEdgeDistance(3,4,{x:0,z:0},{x:0,z:0},1),4);
  const r={length:100,edge:()=>4,point:s=>({x:s,z:0})};
  const c=new DrivableCorridor(r,{segments:[{ax:50,az:0,bx:50,bz:150,hw:3}]},{minX:-100,minZ:-100,maxX:200,maxZ:200});
  assert.equal(c.distance(50,100),0);assert.equal(c.distance(60,100),7);
  assert.equal(c.distance(-14,0),10);assert.equal(c.distance(NaN,0),Infinity);
  assert.equal(c.outsideBounds(201,0),true);assert.equal(c.outsideBounds(0,0),false);
});
test('map/mode budgets and continuous countdown reset on return',()=>{
  for(const id of ['riviera','penteli','megara'])for(const freeRoam of [true,false]){
    const t=corridorThresholds(id,freeRoam),state={};
    const query=(distance,dt=0)=>corridorRecovery({distance,mapId:id,freeRoam},dt,state);
    assert.equal(query(t.soft).tow,false);
    assert.equal(query(t.hard+.01).tow,true);
    state.corridorT=0;
    if(!freeRoam){assert.equal(query(t.soft+1,2.49).tow,false);assert.equal(query(t.soft+1,.02).tow,true);query(0);assert.equal(state.corridorT,0);assert.equal(query(t.soft+1,.1).tow,false);}
    assert.equal(corridorRecovery({distance:0,bounds:true,mapId:id,freeRoam},0,{}).tow,true);
  }
  assert.deepEqual(corridorThresholds('riviera'),{soft:12,hard:30,seconds:2.5});
  assert.deepEqual(corridorThresholds('megara'),{soft:25,hard:60,seconds:2.5});
  assert.equal(corridorThresholds('penteli',true).hard,40);
});
test('Penteli valley drops recover quickly in both modes, connected roads remain valid',()=>{
  for(const freeRoam of [false,true]){
    const state={},q={distance:4,drop:5,mapId:'penteli',freeRoam};
    assert.equal(corridorRecovery(q,.7,state).tow,false);assert.equal(corridorRecovery(q,.06,state).tow,true);
    assert.equal(corridorRecovery({...q,distance:0},2,{}).tow,false);
    assert.equal(corridorRecovery({...q,mapId:'riviera'},1,{}).tow,false);
  }
});
