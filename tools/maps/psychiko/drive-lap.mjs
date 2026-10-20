// Headless regression using the production vehicle, AI, road surface, islands and race closures.
// node tools/maps/psychiko/drive-lap.mjs [output.json]
import fs from 'node:fs';
import {Group} from 'three';
import {PsychikoStreetscape} from '../../../src/maps/psychiko-streetscape.js';
import assert from 'node:assert/strict';
import {Route,Terrain} from '../../../src/map.js';
import {Vehicle} from '../../../src/physics.js';
import {RivalAI} from '../../../src/rival-ai.js';
import {RoadNetwork} from '../../../src/road-network-surface.js';
import {Ground} from '../../../src/ground.js';
import {ringStation} from '../../../src/roundabouts.js';
const data=JSON.parse(fs.readFileSync(new URL('../../../data/maps/psychiko/map.json',import.meta.url))),route=new Route(data.route),bytes=fs.readFileSync(new URL('../../../data/maps/psychiko/terrain.bin',import.meta.url)),terrain=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
route.urban=()=>.85;route.seaR=route.seaL=()=>999;
const map={id:'psychiko',data,route,terrain},network=map.roadNetwork=new RoadNetwork(map),ground=new Ground(map,(x,z)=>terrain.height(x,z),{network});const street=new PsychikoStreetscape(map,new Group(),(x,z)=>terrain.height(x,z));ground.parked=[...data.roadworks,...street.obstacles];
const src=fs.readFileSync(new URL('../../../src/cars.js',import.meta.url),'utf8'),cars=Function('return '+src.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const veh=new Vehicle(cars.find(c=>c.id==='mini'),route);veh.ground=ground;veh.reset(-4,0,0);
const ai=new RivalAI(route,veh,{dir:1,closedRoad:true,perfect:true,roadEdges:(s)=>({min:-route.edge(s),max:route.edge(s)})}),dt=1/120,last=new Map(),report={method:'Production RivalAI and Mini Vehicle, 120 Hz, physical Ground + RoadNetwork + race roadworks + surveyed parked-car colliders, no teleports or resets',length:route.length,parkedCars:street.obstacles.length,samples:[],offRoadFrames:0,clockwiseSteps:0,islandFrames:0,wallFrames:0,visited:[],finish:null};
for(let k=0;k<120*1200;k++){
 veh.wallHit=0;veh.update(dt,ai.update(dt,{racers:[],traffic:[],pace:.72}));
 if(Math.abs(veh.u)>route.edge(veh.s)+.3&&!network.sample(veh.x,veh.z))report.offRoadFrames++;
 if(network.islandAt(veh.x,veh.z))report.islandFrames++;
 if(veh.wallHit>1)report.wallFrames++;
 for(const q of route.roundabouts){const s=route.wrap(veh.s);if(s<q.s0||s>q.s1){last.delete(q.id);continue;}const at=ringStation(veh.x,veh.z,q.p),prev=last.get(q.id);if(prev!==undefined){const ds=((at.s-prev+at.length/2)%at.length+at.length)%at.length-at.length/2;if(ds<-.025)report.clockwiseSteps++;}last.set(q.id,at.s);if(!report.visited.includes(q.id))report.visited.push(q.id);}
 if(k%120===0)report.samples.push({t:k*dt,s:veh.s,x:veh.x,z:veh.z,u:veh.u,kmh:veh.vLong*3.6});
 if(veh.s>=route.length){report.finish=(k+1)*dt;break;}
}
console.log(JSON.stringify({...report,samples:report.samples.length,finalS:veh.s},null,2));if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report));
assert(report.finish,'AI completes a full lap');assert.equal(report.offRoadFrames,0);assert.equal(report.islandFrames,0);assert.equal(report.wallFrames,0);assert.equal(report.clockwiseSteps,0);assert.equal(report.visited.length,route.roundabouts.length);

street.dispose();
