// Offline authoring from immutable emitted cells. No bake, upload or source-road snap.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ATHENS_PROJECTION as projection} from '../src/world-manifest.js';
import {projectEdge,edgePoint} from '../src/route-geometry.js';
import {compileRoute} from '../src/route-compile.js';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';
import {captureRouteInputs} from './capture-route-inputs.mjs';

export async function authorPenteliRoutes({world,cells,out}) {
  const source=JSON.parse(await readFile(new URL('../data/maps/penteli/map.json',import.meta.url)));
  const position=s=>{const i=s/source.route.step;return {x:(source.proj.lon0+source.route.x[i]/source.proj.mlon-projection.lon0)*projection.metresPerLon,z:(projection.lat0-source.proj.lat0+source.route.z[i]/source.proj.mlat)*projection.metresPerLat};};
  const keys=new Set();for(let s=0;s<=source.route.length;s+=source.route.step){const p=position(s);for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)keys.add(`${Math.floor(p.x/512)+x},${Math.floor(p.z/512)+z}`);}
  const input=await readEmittedRouteWorld({world,cells,keys});
  const edges=[...input.roads.graph.edges.values()].map(v=>v.value).filter(e=>/^penteli:e:main:\d+:f$/.test(e.id)).sort((a,b)=>Number(a.id.split(':')[3])-Number(b.id.split(':')[3]));
  const endpoint=s=>{const p=position(s);const q=edges.map(e=>projectEdge(e,p.x,p.z)).sort((a,b)=>a.distance-b.distance)[0];if(!q||q.distance>.03)throw Error('Original Penteli endpoint is not on emitted main road');return {edgeId:q.edge,offsetM:q.offsetM,lateralM:0,yawRad:q.yaw};};
  const start=endpoint(source.route.start),finish=endpoint(source.route.finish),path=edges.slice(edges.findIndex(e=>e.id===start.edgeId),edges.findIndex(e=>e.id===finish.edgeId)+1);
  const hill={$schema:'../../schemas/route.v1.schema.json',schemaVersion:1,id:'penteli-hill',revision:1,worldId:'athens',regionId:'penteli',name:'PENTELI HILL CLIMB',description:'Attached mountain destination · Dionysos to Karakanta Pass. No road link to the Athens basin.',kind:'sprint',lengthM:9896,laps:1,allowReverse:false,timeOfDay:'afternoon',weather:'clear',trafficLevel:0,rivals:2,police:false,signals:false,path:{edges:path.map(e=>e.id)},start,finish,turns:{allowed:[],disallowed:[]},events:[{id:'penteli-race',type:'sprint',rivals:2,trafficLevel:0},{id:'penteli-tt',type:'timetrial',rivals:0,trafficLevel:0}]};
  // Descent is its own forward-oriented runtime: never drive backward along uphill edges.
  const reverse=path.toReversed().map(e=>{const candidates=[...input.roads.graph.edges.values()].map(v=>v.value).filter(q=>q.from===e.to&&q.to===e.from&&q.layer===e.layer&&q.surface===e.surface&&!(q.flags&8));if(candidates.length!==1)throw Error('Legal Penteli descent edge unavailable: '+e.id);return candidates[0];});
  const reversedPose=(old,e)=>{const offsetM=e.length-old.offsetM;return {edgeId:e.id,offsetM,lateralM:0,yawRad:edgePoint(e,offsetM).yaw};};
  const descent={...hill,id:'penteli-descent',name:'PENTELI DESCENT TT',description:'Attached mountain destination · Karakanta Pass to Dionysos on legal downhill directed edges.',rivals:0,path:{edges:reverse.map(e=>e.id)},start:reversedPose(finish,reverse[0]),finish:reversedPose(start,reverse.at(-1)),events:[{id:'penteli-descent-tt',type:'timetrial',rivals:0,trafficLevel:0}]};
  await mkdir(out,{recursive:true});const report=[];
  for(const def of [hill,descent]){const c=await compileRoute(def,input.roads.graph,input.contacts);def.lengthM=c.lengthM;await writeFile(resolve(out,def.id+'.route.json'),JSON.stringify(def,null,2)+'\n');report.push({id:c.id,lengthM:c.lengthM,start:c.startPose,finish:c.finishPose,edges:def.path.edges.length});}
  const capture=await captureRouteInputs({world,cells,routes:out,keys,out:resolve(out,'penteli.inputs.json')});return {report,capture:capture.report};
}
if(process.argv[1]===import.meta.filename){const [world,cells,out]=process.argv.slice(2);console.log(JSON.stringify(await authorPenteliRoutes({world,cells,out}),null,2));}
