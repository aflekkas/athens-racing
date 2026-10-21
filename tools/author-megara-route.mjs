// Author from authenticated emitted raceway cells; no road snap, bake or upload.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ATHENS_PROJECTION as projection} from '../src/world-manifest.js';
import {edgeLength,projectEdge} from '../src/route-geometry.js';
import {compileRoute} from '../src/route-compile.js';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';
import {captureRouteInputs} from './capture-route-inputs.mjs';

export async function authorMegaraRoute({world,cells,out}) {
 const source=JSON.parse(await readFile(new URL('../data/maps/megara/map.json',import.meta.url)));
 const position=i=>({x:(source.proj.lon0+source.route.x[i]/source.proj.mlon-projection.lon0)*projection.metresPerLon,z:(projection.lat0-source.proj.lat0+source.route.z[i]/source.proj.mlat)*projection.metresPerLat});
 const keys=new Set();for(let i=0;i<source.route.x.length;i++){const p=position(i);for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)keys.add(`${Math.floor(p.x/512)+x},${Math.floor(p.z/512)+z}`);}
 const input=await readEmittedRouteWorld({world,cells,keys});
 const edges=[...input.roads.graph.edges.values()].map(v=>v.value).filter(e=>/^megara:e:raceway-70043234:\d+:f$/.test(e.id)).sort((a,b)=>Number(a.id.split(':')[3])-Number(b.id.split(':')[3]));
 if(edges.length!==51||edges.some((e,i)=>e.id!==`megara:e:raceway-70043234:${i+1}:f`||e.flags&8||e.to!==edges[(i+1)%edges.length].from))throw Error('Emitted permitted raceway loop changed');
 const p=position(0),q=projectEdge(edges[0],p.x,p.z);if(q.distance>.03||q.offsetM>.03)throw Error('Original Megara timing start no longer matches emitted edge');
 const start={edgeId:edges[0].id,offsetM:0,lateralM:0,yawRad:q.yaw},finish={edgeId:edges.at(-1).id,offsetM:edgeLength(edges.at(-1)),lateralM:0,yawRad:q.yaw};
 const def={$schema:'../../schemas/route.v1.schema.json',schemaVersion:1,id:'megara-club',revision:1,worldId:'athens',regionId:'megara',name:'MEGARA CIRCUIT',description:'Attached circuit destination · original clockwise raceway in West Attica.',kind:'circuit',lengthM:source.route.length,laps:3,allowReverse:false,timeOfDay:'afternoon',weather:'clear',trafficLevel:0,rivals:2,police:false,signals:false,path:{edges:edges.map(e=>e.id)},start,finish,turns:{allowed:[],disallowed:[]},events:[{id:'megara-race',type:'sprint',laps:3,rivals:2,trafficLevel:0},{id:'megara-tt',type:'timetrial',laps:3,rivals:0,trafficLevel:0}]};
 const compiled=await compileRoute(def,input.roads.graph,input.contacts);def.lengthM=compiled.lengthM;
 await mkdir(out,{recursive:true});await writeFile(resolve(out,def.id+'.route.json'),JSON.stringify(def,null,2)+'\n');
 const capture=await captureRouteInputs({world,cells,routes:out,keys,out:resolve(out,'megara.inputs.json')});
 return {id:def.id,oldLengthM:source.route.length,lengthM:compiled.lengthM,edges:edges.length,grid:compiled.grid.length,cells:compiled.cells.length,capture:capture.report};
}
if(process.argv[1]===import.meta.filename){const [world,cells,out]=process.argv.slice(2);console.log(JSON.stringify(await authorMegaraRoute({world,cells,out}),null,2));}
