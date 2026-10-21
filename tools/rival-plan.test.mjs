import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {buildRoutes} from './build-routes.mjs';
import {rivalBuildInputs,checkRivalPlan} from './build-rival-plans.mjs';
import {readRouteInputs} from './route-input.mjs';
import {RouteRuntime} from '../src/route-runtime.js';
import {RacingLine,RivalAI} from '../src/rival-ai.js';
import {unpackRivalArray} from '../src/rival-plan.js';
import {Vehicle} from '../src/physics.js';
const root=resolve(import.meta.dirname,'..');
test('every shipped route line and speed profile exactly equals the runtime planner; reset never invokes either solve',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'athens-rival-plan-'));
 try{
  const shard=JSON.parse(await readFile(join(root,'data/routes/validation/athens.inputs.json'),'utf8')),cells={...shard.cells};for(const name of shard.shards||[])Object.assign(cells,JSON.parse(await readFile(join(root,'data/routes/validation',name),'utf8')).cells);
  const world=join(dir,'world.json');await writeFile(world,JSON.stringify({revision:shard.worldSetRevision,tiles:cells}));
  const input=await readRouteInputs({world,graph:join(root,'data/routes/validation/athens.inputs.json')}),build=await buildRoutes({routes:join(root,'data/routes'),graph:input.graph,world:{contacts:input.contacts},out:dir}),inputs=await rivalBuildInputs();
  assert.deepEqual(build.compiled.map(c=>c.id).sort(),(await readdir(join(root,'data/routes'))).filter(f=>f.endsWith('.route.json')).map(f=>f.slice(0,-11)).sort());
  for(const compiled of build.compiled){
   await checkRivalPlan(compiled);const route=new RouteRuntime(compiled);route.requireRivalPlan=true;
   for(const [id,p]of Object.entries(compiled.rivalPlan.profiles)){
    const veh=new Vehicle(inputs.cars.find(c=>c.id===id),route),line=new RacingLine(route,{halfWidth:veh.halfW}),profile=line.speedProfile(veh),actual=new RivalAI(route,veh);
    for(const name of ['u','k','grade','vertical'])assert.deepEqual(actual.line[name],line[name],`${compiled.id}/${id}/${name}`);
    assert.deepEqual(unpackRivalArray(p.v,line.n),profile,`${compiled.id}/${id}/profile`);assert.deepEqual(actual.profile,profile);
    for(let i=0;i<line.n;i++){const point=route.point(i*line.step,actual.line.u[i]);assert.equal(point.x,line.x[i]);assert.equal(point.z,line.z[i]);}
    const original=RacingLine.prototype.speedProfile;RacingLine.prototype.speedProfile=()=>{throw Error('Runtime solve on reset');};
    try{assert.deepEqual(new RivalAI(route,veh).profile,profile);}finally{RacingLine.prototype.speedProfile=original;}
   }
   await assert.rejects(checkRivalPlan(compiled,{sourceHash:'0'.repeat(64)}),/Stale/);
   const stale=structuredClone(compiled);stale.rivalPlan.worldSetRevision='0'.repeat(64);await assert.rejects(checkRivalPlan(stale),/Stale/);
   const corrupt=structuredClone(compiled);corrupt.rivalPlan.lines[Object.keys(corrupt.rivalPlan.lines)[0]].u='';await assert.rejects(checkRivalPlan(corrupt),/Stale/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
