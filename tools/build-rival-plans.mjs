import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {sha256,canonicalJSON} from '../src/route-definition.js';
import {packRivalArray,validateRivalPlan,rivalLineKey,RIVAL_PLAN_VERSION} from '../src/rival-plan.js';
import {RouteRuntime} from '../src/route-runtime.js';
import {RacingLine} from '../src/rival-ai.js';
import {DRIVERS,driverCar} from '../src/events.js';
import {inGarage,isRivalCar} from '../src/car-catalog.js';
const root=resolve(import.meta.dirname,'..');
// Bind to every transitive browser source, including capability/route/catalogue
// helpers. A new dependency cannot silently escape this release gate.
export async function rivalSourceHash(directory=root){const files=(await readdir(resolve(directory,'src'),{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>'src/'+f);files.push('tools/build-rival-plans.mjs','tools/build-routes.mjs');return sha256(await Promise.all(files.sort().map(async f=>[f,await readFile(resolve(directory,f),'utf8')])));}
export async function rivalBuildInputs(){
 const source=await readFile(resolve(root,'src/cars.js'),'utf8'),cars=Function('return '+source.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
 const defaults=source.match(/export function defaultTrafficWeight\(car\) \{[\s\S]*?^\}/m)?.[0];if(!defaults)throw Error('Missing car defaults');
 const weight=Function(defaults.replace('export ','')+';return defaultTrafficWeight')();for(const c of cars)c.trafficWeight??=weight(c);
 return {cars,sourceHash:await rivalSourceHash()};
}
export async function buildRivalPlan(compiled,Vehicle,inputs) {
 const {cars,sourceHash}=inputs||await rivalBuildInputs();
 const runtime=new RouteRuntime({...compiled}),eligible=cars.filter(c=>inGarage(c)&&isRivalCar(c)),ids=new Set(DRIVERS.flatMap(d=>[null,...eligible.map(c=>c.id)].map(avoid=>driverCar(d,eligible.map(c=>c.id),avoid))));
 for(const e of compiled.definition.events)if(e.car)ids.add(e.car);
 const specs=eligible.filter(c=>ids.has(c.id)),lines={},profiles={};let base;
 for(const spec of specs){const veh=new Vehicle(spec,runtime),key=rivalLineKey(1,veh.halfW);let line=lines[key]?.runtime;
  if(!line){line=new RacingLine(runtime,{halfWidth:veh.halfW,dir:1});base??=line;lines[key]={runtime:line,u:packRivalArray(line.u),k:packRivalArray(line.k)};}
  profiles[spec.id]={lineKey:key,stateKey:veh.planningStateKey(),v:packRivalArray(line.speedProfile(veh))};
 }
 const plan={version:RIVAL_PLAN_VERSION,geometryHash:compiled.geometryHash,worldSetRevision:compiled.worldSetRevision,sourceHash,n:base.n,step:base.step,grade:packRivalArray(base.grade),vertical:packRivalArray(base.vertical),lines:Object.fromEntries(Object.entries(lines).map(([key,{runtime,...samples}])=>[key,samples])),profiles};
 plan.hash=await sha256(plan);return plan;
}
export async function attachRivalPlans(compiled){
 // Keep headless physics hooks isolated from the deployment/server process.
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker'],{stdio:['pipe','pipe','inherit']});let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code?reject(Error('Rival plan build failed')):resolve());});child.stdin.end(JSON.stringify(compiled));await done;return JSON.parse(output);
}
export async function checkRivalPlan(compiled,options={}) {
 const sourceHash=options.sourceHash||await rivalSourceHash();
 const p=validateRivalPlan(compiled),{hash,...body}=p;
 if(p.sourceHash!==sourceHash||hash!==await sha256(body))throw Error('Stale rival racing plan');
 if(compiled.routeHash!==await sha256({definition:compiled.definition,geometryHash:compiled.geometryHash,worldSetRevision:compiled.worldSetRevision,rivalPlanHash:hash}))throw Error('Rival plan route identity mismatch');
 // Decode every shipped sample at the gate, catching truncated/corrupt arrays.
 const {unpackRivalArray}=await import('../src/rival-plan.js');
 const closed=compiled.definition.kind==='circuit',n=Math.ceil(compiled.lengthM/2)+(closed?0:1);if(p.n!==n||p.step!==compiled.lengthM/(closed?n:n-1)||!Object.keys(p.profiles).length)throw Error('Stale rival racing plan');
 for(const profile of Object.values(p.profiles))if(!p.lines[profile.lineKey]||typeof profile.stateKey!=='string')throw Error('Stale rival racing plan');
 for(const a of [p.grade,p.vertical,...Object.values(p.lines).flatMap(l=>[l.u,l.k]),...Object.values(p.profiles).map(v=>v.v)])unpackRivalArray(a,p.n);
 return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--worker'){
 const {register}=await import('node:module');register('./physics-test/hooks.mjs',import.meta.url);const {Vehicle}=await import('../src/physics.js');let input='';for await(const chunk of process.stdin)input+=chunk;
 const inputs=await rivalBuildInputs(),out=[];for(const c of JSON.parse(input)){const rivalPlan=await buildRivalPlan(c,Vehicle,inputs),routeHash=await sha256({definition:c.definition,geometryHash:c.geometryHash,worldSetRevision:c.worldSetRevision,rivalPlanHash:rivalPlan.hash}),artifact={...c,rivalPlan,routeHash};if(Buffer.byteLength(canonicalJSON(artifact))>2*1024**2)throw Error('Compiled route with rival plan exceeds 2 MiB');out.push(artifact);}process.stdout.write(JSON.stringify(out));
}
