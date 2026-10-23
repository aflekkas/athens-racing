// Replay reviewed whole-way OSM topology against authenticated emitted cells.
// This tool never invents links, rebakes terrain, uploads or enables a route.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';
import {allowedTurn,edgeLength,edgePoint} from '../src/route-geometry.js';
import {compileRoute} from '../src/route-compile.js';
import {canonicalJSON} from '../src/route-definition.js';
import {captureRouteInputs} from './capture-route-inputs.mjs';

const fail=(code,detail)=>{const error=new Error('ekali-source-'+code);error.detail=detail;throw error;};
const value=(graph,id)=>graph.edges.get(id)?.value;
export function resolveEkaliSourcePath(graph,review){
 if(!review.traversals?.length)fail('empty');
 const groups=[];
 for(let i=0;i<review.traversals.length;i++){
  const t=review.traversals[i],next=review.traversals[(i+1)%review.traversals.length];
  if(!t.public||![1,-1].includes(t.direction)||t.to!==next.from)fail('invalid-review',{index:i});
  const previous=groups.at(-1);
  if(previous?.partId===t.partId&&previous.direction===t.direction)previous.to=t.to;
  else groups.push({...t});
 }
 const result=[],definition={turns:{allowed:[],disallowed:[]}};
 for(const group of groups){
  const queue=[{node:'osm:node:'+group.from,path:[]}],found=[];let visits=0;
  while(queue.length){
   if(++visits>300)fail('search-budget',{partId:group.partId});
   const q=queue.shift();if(q.node==='osm:node:'+group.to){found.push(q.path);continue;}
   for(const id of graph.outgoing.get(q.node)||[]){
    const e=value(graph,id);
    if(!id.startsWith('osm:way:'+group.partId.slice(1)+'-')||!id.includes(group.direction===1?':f:':':b:')||e.flags&8||q.path.includes(id))continue;
    const previous=value(graph,q.path.at(-1)||result.at(-1));
    if(previous&&!allowedTurn(definition,graph,previous,e,[...result,...q.path]))continue;
    queue.push({node:e.to,path:[...q.path,id]});
   }
  }
  if(found.length!==1)fail(found.length?'ambiguous':'disconnected',{group,candidates:found.length});
  result.push(...found[0]);
 }
 const last=value(graph,result.at(-1)),first=value(graph,result[0]);
 if(last.to!==first.from||!allowedTurn(definition,graph,last,first,result))fail('closure');
 return result;
}

export function describeEkaliRoute(graph,review,{startEdge='osm:way:44130952:0-0:b:18:-29',offsetM=120}={}){
 const sourcePath=resolveEkaliSourcePath(graph,review),index=sourcePath.indexOf(startEdge);
 if(index<0||sourcePath.lastIndexOf(startEdge)!==index)fail('start-edge');
 const path=[...sourcePath.slice(index),...sourcePath.slice(0,index),startEdge],edge=value(graph,startEdge);
 if(offsetM<=0||offsetM>=edgeLength(edge))fail('start-offset');
 const pose={edgeId:startEdge,offsetM,lateralM:0,yawRad:edgePoint(edge,offsetM).yaw};
 const lengthM=sourcePath.reduce((sum,id)=>sum+edgeLength(value(graph,id)),0);
 return {$schema:'../../schemas/route.v1.schema.json',schemaVersion:1,id:'ekali-circuit',revision:1,worldId:'athens',regionId:'basin',name:'EKALI',description:'Ekali public-street circuit.',kind:'circuit',lengthM,laps:2,allowReverse:false,timeOfDay:'afternoon',weather:'clear',trafficLevel:0,rivals:2,police:false,signals:false,path:{edges:path},start:pose,finish:{...pose},turns:{allowed:[],disallowed:[]},sectorsM:[lengthM/3,2*lengthM/3],closureIds:[],events:[{id:'ekali-race',type:'sprint',laps:2,rivals:2,trafficLevel:0},{id:'ekali-tt',type:'timetrial',laps:2,rivals:0,trafficLevel:0}]};
}

export async function inspectEkaliRoute({world,cells,reviewPath=new URL('./maps/ekali/source-review.json',import.meta.url),startEdge,offsetM}){
 if(!world||!cells)throw Error('Explicit authenticated world and cell directory required');
 const review=JSON.parse(await readFile(reviewPath));
 const input=await readEmittedRouteWorld({world,cells,keys:new Set(review.haloCells.map(c=>c.join(',')))});
 const definition=describeEkaliRoute(input.roads.graph,review,{startEdge,offsetM});
 return {input,definition};
}
export async function authorEkaliRoute({world,cells,out}){
 if(!out)throw Error('Explicit output directory required');
 const production=resolve(import.meta.dirname,'../data/routes'),target=resolve(out);
 if(target===production||target.startsWith(production+sep))throw Error('Ekali development output must stay outside production route discovery');
 const {input,definition}=await inspectEkaliRoute({world,cells});
 const compiled=await compileRoute(definition,input.roads.graph,input.contacts);
 await mkdir(out,{recursive:true});
 await writeFile(resolve(out,'ekali-circuit.route.json'),JSON.stringify(definition,null,2)+'\n');
 const review=JSON.parse(await readFile(new URL('./maps/ekali/source-review.json',import.meta.url)));
 const {shard}=await captureRouteInputs({world,cells,routes:out,keys:new Set(review.haloCells.map(c=>c.join(',')))});
 const proof=canonicalJSON(shard)+'\n';if(Buffer.byteLength(proof)>8*1024**2)throw Error('Ekali validation proof exceeds unchanged 8 MiB cap');
 await writeFile(resolve(out,'ekali.inputs.json'),proof);
 return {proofBytes:Buffer.byteLength(proof),id:compiled.id,worldSetRevision:compiled.worldSetRevision,geometryHash:compiled.geometryHash,routeHash:compiled.routeHash,lengthM:compiled.lengthM,cells:compiled.cells,grid:compiled.grid};
}
if(process.argv[1]===import.meta.filename){const [world,cells,out]=process.argv.slice(2);console.log(JSON.stringify(await authorEkaliRoute({world,cells,out}),null,2));}
