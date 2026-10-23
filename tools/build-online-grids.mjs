import {recoveryRoadGroup} from '../src/world-road-group.js';
// Offline physical proof for eight online slots. Does not change the competitive
// compiled route, geometryHash, edition or its original 80 m run-in.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJSON} from '../src/route-definition.js';
import {edgeValue,edgeLength,edgePoint,allowedTurn,cellKey} from '../src/route-geometry.js';
import {routeSurfaceAllowed} from '../src/route-surface.js';
import {carOverlap} from '../src/crash-contact.js';
import {inGarage} from '../src/car-catalog.js';
import {onlineGridHash,validateOnlineGrid} from '../src/online-grid.js';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';

export async function garageFootprints(root=resolve(import.meta.dirname,'..')){
 const source=await readFile(resolve(root,'src/cars.js'),'utf8'),literal=source.match(/export const CARS = (\[[\s\S]*?^\]);/m)?.[1];
 if(!literal)throw Error('Garage capability source unavailable');
 const cars=Function('return '+literal)().filter(inGarage),profiles=[];
 for(const car of cars){if(!(car.width>0&&car.length>0))throw Error('Vehicle footprint unavailable: '+car.id);const p={halfWidth:car.width/2,halfLength:car.length/2};if(!profiles.some(q=>q.halfWidth===p.halfWidth&&q.halfLength===p.halfLength))profiles.push(p);}
 return profiles.sort((a,b)=>b.halfLength-a.halfLength||b.halfWidth-a.halfWidth);
}
export const maximumFootprint=profiles=>({halfWidth:Math.max(...profiles.map(p=>p.halfWidth)),halfLength:Math.max(...profiles.map(p=>p.halfLength)),clearanceM:.25});
// Keep exact legal predecessors. For circuits the authored clockwise path owns
// the predecessor; public roads use the same straightest legal rule as compileRoute.
export function approachPieces(compiled,graph,metres=256){
 const def=compiled.definition,ids=compiled.occurrences.map(o=>o.edgeId).filter((id,i,a)=>!i||id!==a[i-1]),period=ids[0]===ids.at(-1)?ids.length-1:ids.length;
 let edge=edgeValue(graph,def.start.edgeId),at=def.start.offsetM,remaining=metres,index=0;const pieces=[];
 if(!edge)throw Error('Online approach graph unavailable');
 for(let count=0;remaining>1e-6&&count<128;count++){
  const take=Math.min(remaining,at);if(take>1e-6)pieces.unshift({edge,from:at-take,to:at});remaining-=take;if(remaining<=1e-6)break;
  const current=edge,heading=edgePoint(current,0),candidates=[...graph.edges.keys()].map(id=>edgeValue(graph,id)).filter(e=>e.to===current.from&&allowedTurn(def,graph,e,current,[]));
  if(def.kind==='circuit'){index=(index-1+period)%period;edge=candidates.find(e=>e.id===ids[index]);}
  else {candidates.sort((a,b)=>{const x=edgePoint(a,edgeLength(a)),y=edgePoint(b,edgeLength(b));return y.tx*heading.tx+y.tz*heading.tz-x.tx*heading.tx-x.tz*heading.tz||a.id.localeCompare(b.id);});edge=candidates[0];}
  if(!edge||Math.hypot(...edge.points.at(-1).map((v,i)=>v-current.points[0][i]))>.025)throw Error('Eight-slot online approach is disconnected');at=edgeLength(edge);
 }
 if(remaining>1e-6)throw Error('Eight-slot online approach exceeds graph limit');return pieces;
}
function checkedPoint(world,edge,offsetM){
 const p=edgePoint(edge,offsetM),contact=world.contacts.contact(p.x,p.z,{referenceY:p.y,layer:edge.layer,requiredFlags:1});
 if(!contact||!routeSurfaceAllowed(edge,contact,world.roads.graph))throw Error('Online approach has no authenticated road contact');
 Object.assign(p,{y:contact.y,surfaceId:contact.surfaceId,offsetM});
 const width=world.contacts.width(p,{connected:true});if(!width)throw Error('Online approach width unavailable');return {...p,leftM:width.left,rightM:width.right};
}
export function proveApproach(compiled,world,{metres=256}={}){
 const rows=[];for(const piece of approachPieces(compiled,world.roads.graph,metres)){
  const count=Math.max(1,Math.ceil((piece.to-piece.from)/2));for(let i=0;i<=count;i++){
   const row=checkedPoint(world,piece.edge,piece.from+(piece.to-piece.from)*i/count);
   if(rows.length&&Math.hypot(row.x-rows.at(-1).x,row.y-rows.at(-1).y,row.z-rows.at(-1).z)<.025)rows[rows.length-1]=row;else rows.push(row);
  }
 }
 let distance=0;for(const [i,p]of rows.entries()){if(i)distance+=Math.hypot(p.x-rows[i-1].x,p.y-rows[i-1].y,p.z-rows[i-1].z);p.s=distance;}
 for(const p of rows)p.s-=distance;return rows;
}
function atStation(rows,s,world){
 let i=rows.findIndex(p=>p.s>=s);if(i<1)i=1;const a=rows[i-1],b=rows[i],fraction=(s-a.s)/(b.s-a.s),edgeId=fraction>.999999?b.edgeId:a.edgeId;
 const edge=edgeValue(world.roads.graph,edgeId);let offset;
 if(a.edgeId===b.edgeId)offset=a.offsetM+(b.offsetM-a.offsetM)*fraction;
 else offset=edgeId===a.edgeId?a.offsetM+(edgeLength(edge)-a.offsetM)*fraction:b.offsetM;
 return {...checkedPoint(world,edge,offset),s};
}
// One legal lane centre, adjusted inward only within that lane's valid interval.
// The contact/footprint proof below remains authoritative at junction fans.
export function legalLanePoint(world,point,footprint,{validate=true,onReject=null}={}){
 const edge=edgeValue(world.roads.graph,point.edgeId),width=point.leftM+point.rightM,mid=(point.rightM-point.leftM)/2;
 const twin=!!recoveryRoadGroup(world.roads.graph,edge);
 let u=mid;
 if(twin){const min=mid+footprint.halfWidth+.05,max=point.rightM-footprint.halfWidth-.15;if(max<min){onReject?.('noLegalLane',{point,footprint});return null;}u=Math.max(min,Math.min(mid+width/4,max));}
 const p={...point,x:point.x+point.rx*u,z:point.z+point.rz*u},contact=world.contacts.contact(p.x,p.z,{referenceY:p.y,layer:p.layer,requiredFlags:1});
 if(!contact){onReject?.('laneNoContact',{point:p,footprint});return null;}if(!routeSurfaceAllowed(edge,contact,world.roads.graph)){onReject?.('laneSurfaceMismatch',{point:p,footprint,contact});return null;}Object.assign(p,{y:contact.y,surfaceId:contact.surfaceId});
 if(!world.contacts.safe(p,{halfWidth:footprint.halfWidth,halfLength:footprint.halfLength,connected:true})){onReject?.('laneFootprintUnsafe',{point:p,footprint});return null;}
 return p;
}
export async function buildOnlineGrid(compiled,world,{footprint,maxApproachM=256}={}){
 footprint||=maximumFootprint(await garageFootprints());
 const rows=proveApproach(compiled,world,{metres:maxApproachM}),poses=[];let s=-Math.max(8,footprint.halfLength+1);
 for(let tries=0;poses.length<8&&s>=rows[0].s+footprint.halfLength+.5&&tries<1024;tries++,s-=.5){
  const point=atStation(rows,s,world),p=legalLanePoint(world,point,footprint);if(!p)continue;
  const expanded={...p,halfW:footprint.halfWidth+footprint.clearanceM,halfL:footprint.halfLength+footprint.clearanceM};
  if(poses.some(q=>Math.abs(q.y-p.y)<2&&carOverlap(expanded,{...q,halfW:expanded.halfW,halfL:expanded.halfL})))continue;
  poses.push({slot:poses.length,s,x:p.x,y:p.y,z:p.z,yaw:p.yaw,edgeId:p.edgeId,layer:p.layer,surfaceId:p.surfaceId});
 }
 if(poses.length!==8)throw Error('Unsupported online capacity: cannot prove eight safe slots for the complete garage envelope');
 // Retain only the approach needed by the final car's entire body, plus one sample.
 const floor=poses.at(-1).s-footprint.halfLength-2,start=Math.max(0,rows.findIndex(p=>p.s>=floor)-1),needed=rows.slice(start),occurrences=[];
 for(let i=0;i<needed.length-1;i++){const p=needed[i],next=needed[i+1],last=occurrences.at(-1);if(last&&last.edgeId===p.edgeId&&last.surfaceId===p.surfaceId&&last.layer===p.layer)last.s1=next.s;else occurrences.push({edgeId:p.edgeId,layer:p.layer,surfaceId:p.surfaceId,s0:p.s,s1:next.s});}
 const cells=new Set();for(const p of needed)for(const dx of [-footprint.halfLength-2,0,footprint.halfLength+2])for(const dz of [-footprint.halfLength-2,0,footprint.halfLength+2])cells.add(cellKey(p.x+dx,p.z+dz));
 const body={schemaVersion:1,projectionId:'athens-v1',routeId:compiled.id,routeHash:compiled.routeHash,geometryHash:compiled.geometryHash,worldSetRevision:compiled.worldSetRevision,capacity:8,footprint,poses,approach:{points:needed.map(p=>[p.x,p.y,p.z,p.s,p.leftM,p.rightM]),occurrences},sourceHashes:[...cells].sort().map(k=>{const entry=world.manifest.tiles[k];if(!entry||!world.tiles.has(k))throw Error('Online grid proof owner unavailable: '+k);return[k,entry.sha256];})};
 const hash=await onlineGridHash(body);await validateOnlineGrid(body,compiled,{expectedHash:hash});return{hash,body};
}
export async function writeOnlineGrid(compiled,options){
 const x=Math.floor(compiled.startPose.x/512),z=Math.floor(compiled.startPose.z/512),keys=new Set();for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)keys.add(`${x+dx},${z+dz}`);
 const world=await readEmittedRouteWorld({...options,keys});if(world.manifest.revision!==compiled.worldSetRevision)throw Error('Online grid/world release mismatch');
 const result=await buildOnlineGrid(compiled,world,options),name=`${compiled.id}.online-grid.${result.hash}.json`;await mkdir(options.out,{recursive:true});await writeFile(resolve(options.out,name),canonicalJSON(result.body));
 return {...result,descriptor:{schemaVersion:1,url:'/data/routes/'+name,hash:result.hash,capacity:8}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].slice(2)]=process.argv[i+1];
 try{const compiled=JSON.parse(await readFile(options.compiled,'utf8')),result=await writeOnlineGrid(compiled,options);console.log(JSON.stringify({routeId:compiled.id,...result.descriptor,footprint:result.body.footprint,poses:result.body.poses}));}catch(error){console.error(error.message);process.exitCode=1;}
}
