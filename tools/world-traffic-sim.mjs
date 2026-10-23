// Real WorldTraffic decisions and emitted contacts, without rendering. Run directly with Node.
// node tools/world-traffic-sim.mjs INPUT_DIR OUTPUT.json [--fetch] [--check]
// INPUT_DIR contains world.json, cells/<sha>.bin.gz and the six compiled routes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {WorldTraffic} from '../src/world-traffic.js';
import {Traffic} from '../src/traffic.js';
import {RNG} from '../src/util.js';
import {RouteRuntime} from '../src/route-runtime.js';
import {cellKey,edgePoint,edgeLength} from '../src/route-geometry.js';
import {loadWorldDefinition} from '../src/world-manifest.js';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';
import {signalState,STOP_OFF} from '../src/signal-plan.js';

export function trafficPool(traffic,seed=42){
 const rng=new RNG(seed),cars=Array.from({length:24},(_,id)=>({id,type:{},len:4.4,wid:1.8,mass:1400,active:false,m:{root:{visible:false,traverse:fn=>fn({isMesh:true})}}}));
 traffic.cars=cars;traffic.pool={rng,idm:Traffic.prototype.idm,pickFree:()=>cars.find(c=>!c.active),initDrive:c=>{c.drv={a:1.6,b:3,T:1.25,s0:2.4,vf:.9+rng.next()*.2};}};
 return traffic;
}

// Excludes a whole queue held by a red signal, rather than only the first vehicle.
export function flowSample(traffic,dt,records=new Map()){
 const active=traffic.cars.filter(c=>c.active&&!c.police),red=new Set(active.filter(c=>traffic.session.props.hold(c.point,traffic.session.roads.graph.edges.get(c.point.edge)?.value.points||[])));
 for(let pass=0;pass<active.length;pass++)for(const c of active)if(!red.has(c)&&active.some(o=>red.has(o)&&Math.abs(o.vehicle.y-c.vehicle.y)<2.5&&Math.hypot(o.x-c.x,o.z-c.z)<15&&Math.cos(o.vehicle.yaw-c.vehicle.yaw)>.5))red.add(c);
 const stopped=[];
 for(const c of active){let r=records.get(c.id);if(!r||r.vehicle!==c.vehicle){r={vehicle:c.vehicle,t:0};records.set(c.id,r);}r.t=Math.abs(c.v)<.5&&!red.has(c)?r.t+dt:0;if(r.t>5)stopped.push(c);}
 const seen=new Set(),clusters=[];
 for(const c of stopped){if(seen.has(c))continue;const group=[c];seen.add(c);for(let i=0;i<group.length;i++)for(const o of stopped)if(!seen.has(o)&&Math.abs(o.y-group[i].y)<2.5&&Math.hypot(o.x-group[i].x,o.z-group[i].z)<16){seen.add(o);group.push(o);}if(group.length>=3)clusters.push(group);}
 const facing=stopped.filter((c,i)=>stopped.slice(i+1).some(o=>{const dx=o.x-c.x,dz=o.z-c.z;return Math.abs(o.y-c.y)<2.5&&Math.hypot(dx,dz)<12&&Math.cos(o.vehicle.yaw-c.vehicle.yaw)<-.7&&Math.abs(dx*Math.cos(c.vehicle.yaw)-dz*Math.sin(c.vehicle.yaw))<(o.wid+c.wid)/2&&dx*-Math.sin(c.vehicle.yaw)+dz*-Math.cos(c.vehicle.yaw)>0&&-dx*-Math.sin(o.vehicle.yaw)-dz*-Math.cos(o.vehicle.yaw)>0;})).length;
 return {stopped:stopped.length,clusters:clusters.length,facing,maxStop:Math.max(0,...[...records.values()].map(r=>r.t)),cars:stopped.map(c=>({id:c.id,edge:c.point.edge,offset:c.offset,x:c.x,z:c.z,blocked:traffic.t-c.blockedAt,v:c.v}))};
}

export async function simulateFlow({session,route,position,mode='parked',level=1,seconds=180,seed=42,TrafficClass=WorldTraffic}){
 const traffic=trafficPool(new TrafficClass(session,{},route),seed);traffic.level=level;traffic.disabled=level===0;
 const records=new Map(),summary={mode,level,seconds,seed,maxStopped:0,maxClusters:0,maxFacing:0,maxStop:0,stoppedCarSeconds:0,clusterSeconds:0,peak:[],reasons:{},spawned:0,maxActive:0,minActiveAfterWarmup:null,activeCarSeconds:0,maxMoving:0,movingCarSeconds:0,trafficMetres:0};
 const original=traffic.stopBlocked;traffic.stopBlocked=function(c){const e=session.roads.graph.edges.get(c.point.edge)?.value;const reason=!e?'missing-edge':c.offset>=(e.length||0)-2?'junction/end':'geometry/contact';summary.reasons[reason]=(summary.reasons[reason]||0)+1;original.call(this,c);};
 let previous=new Set(),lastPositions=new Map();
 for(let step=0;step<seconds*20;step++){
  const t=step/20,player=position(t,mode);session.props.time=t;traffic.update(.05,player,[player]);
  // A conservative forward cone approximates the main view; this does not grant permission to retire visible cars.
  for(const c of traffic.cars)if(c.active){const dx=c.x-player.x,dz=c.z-player.z,d=Math.hypot(dx,dz);if(d<25||d<250&&(dx*-Math.sin(player.yaw)+dz*-Math.cos(player.yaw))>d*.35)c.lastSeenAt=traffic.t;}
  const current=new Set(traffic.cars.filter(c=>c.active).map(c=>c.vehicle));summary.spawned+=[...current].filter(c=>!previous.has(c)).length;previous=current;
  const active=traffic.cars.filter(c=>c.active),moving=active.filter(c=>Math.abs(c.v)>.5);summary.maxActive=Math.max(summary.maxActive,active.length);summary.maxMoving=Math.max(summary.maxMoving,moving.length);summary.activeCarSeconds+=active.length*.05;summary.movingCarSeconds+=moving.length*.05;
  if(t>=30)summary.minActiveAfterWarmup=Math.min(summary.minActiveAfterWarmup??Infinity,active.length);
  for(const c of active){const p=lastPositions.get(c.vehicle);if(p)summary.trafficMetres+=Math.hypot(c.x-p.x,c.z-p.z);}lastPositions=new Map(active.map(c=>[c.vehicle,{x:c.x,z:c.z}]));
  const s=flowSample(traffic,.05,records);summary.maxStopped=Math.max(summary.maxStopped,s.stopped);summary.maxClusters=Math.max(summary.maxClusters,s.clusters);summary.maxFacing=Math.max(summary.maxFacing,s.facing);summary.maxStop=Math.max(summary.maxStop,s.maxStop);summary.stoppedCarSeconds+=s.stopped*.05;summary.clusterSeconds+=s.clusters*.05;if(s.stopped>summary.peak.length)summary.peak=s.cars;
 }
 for(const k of ['maxStop','stoppedCarSeconds','clusterSeconds','activeCarSeconds','movingCarSeconds','trafficMetres'])summary[k]=+summary[k].toFixed(2);
 return summary;
}

async function main(){
 const [dir,out]=process.argv.slice(2);if(!dir||!out)throw Error('Usage: INPUT_DIR OUTPUT.json [--fetch] [--check]');
 if(process.argv.includes('--fetch'))await fetchInputs(dir);
 const manifest=JSON.parse(await readFile(resolve(dir,'world.json'))),result=[];
 let TrafficClass=WorldTraffic;if(process.env.WORLD_TRAFFIC_JS){const source=(await readFile(process.env.WORLD_TRAFFIC_JS,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL('../src/'+p.slice(2),import.meta.url).href}'`);TrafficClass=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).WorldTraffic;}
 for(const id of ['riviera-coast','syntagma-pilot','psychiko-faros','penteli-hill','penteli-descent','megara-club','glyfada']){
  if(process.env.FLOW_AREAS&&!process.env.FLOW_AREAS.split(',').includes(id))continue;
  const compiled=JSON.parse(await readFile(resolve(dir,(id==='glyfada'?'syntagma-pilot':id)+'.json'))),route=new RouteRuntime(compiled),gly={x:(23.753-23.73)*87745.27512677578,z:(37.863-37.98)*-111320},points=id==='glyfada'?[gly]:compiled.points.filter(p=>p[3]<2200).map(p=>({x:p[0],z:p[2]})),keys=new Set();
  for(const p of points){const [x,z]=cellKey(p.x,p.z).split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)keys.add(`${x+dx},${z+dz}`);}
  const world=await readEmittedRouteWorld({world:resolve(dir,'world.json'),cells:resolve(dir,'cells'),keys}),byEdge=new Map();
  for(const {packet:p}of world.tiles.values()){const ext=p.metadata.extensions?.worldDetail?.signals;if(!ext)continue;const rows=p.arrays[ext.rows],edges=p.arrays[ext.edge];for(let i=0;i<edges.length;i++)byEdge.set(p.metadata.ids[edges[i]],{offset:rows[i*6+4],group:rows[i*6+5]});}
  const props={time:0,byEdge,hold(p,ps){const r=byEdge.get(p.edge);if(!r||signalState(r.group,r.offset,this.time)==='G'||!ps.length)return false;const e=ps.at(-1),d=Math.hypot(e[0]-p.x,e[2]-p.z);return d<=STOP_OFF+.9&&d>STOP_OFF-3.5;}};
  // Match createWorldSession.safePose: a complete car may straddle legally
  // connected surface owners at a junction or tile portal.
  const session={...world,props,safePose:(p,o)=>world.contacts.safe({...p,edge:p.edgeId||p.edge},{...o,connected:true})};
  const glyStart=id==='glyfada'?world.roads.graph.nearest(gly.x,gly.z,{maxDistance:100}):null,glyPath=[];let glyLength=0;
  if(glyStart){let e=world.roads.graph.edges.get(glyStart.edge).value;for(let i=0;i<200&&glyLength<2000;i++){glyPath.push({e,start:glyLength});glyLength+=edgeLength(e);const last=edgePoint(e,edgeLength(e)),choices=[...(world.roads.graph.outgoing.get(e.to)||[])].map(id=>world.roads.graph.edges.get(id)?.value).filter(n=>n&&n.to!==e.from&&world.roads.graph.legal(e.id,n));choices.sort((a,b)=>{const score=n=>{const f=edgePoint(n,0);return f.tx*last.tx+f.tz*last.tz-(Math.hypot(f.x-gly.x,f.z-gly.z)>650?5:0);};return score(b)-score(a);});if(!choices.length)break;e=choices[0];}}
  for(const mode of ['parked','drive','quick']){
   const level=id==='megara-club'||mode==='quick'&&id!=='riviera-coast'?0:1;
   const position=(t,m)=>{if(id==='glyfada'){if(m==='parked')return {...glyStart,vLong:0,halfL:2.2,halfW:.9};const s=Math.min(glyLength-3,t*8),seg=[...glyPath].reverse().find(e=>e.start<=s)||glyPath[0],f=edgePoint(seg.e,s-seg.start),u=seg.e.flags&1?0:1.5;return {...f,x:f.x+f.rx*u,z:f.z+f.rz*u,vLong:8,halfL:2.2,halfW:.9};}const s=m==='parked'?80:Math.min(route.length-15,80+t*8),f=route.frame(s),p=route.point(s,Math.min(1.7,f.rightM*.45));return {...f,...p,vLong:m==='parked'?0:8,halfL:2.2,halfW:.9};};
   const row={id,...await simulateFlow({session,route,position,mode,level,TrafficClass})};result.push(row);console.log(JSON.stringify({...row,peak:row.peak.slice(0,3)}));
  }
 }
 await writeFile(out,JSON.stringify(result,null,2));
 if(process.argv.includes('--check'))for(const row of result){assert.equal(row.maxClusters,0,JSON.stringify(row));assert.equal(row.maxFacing,0,JSON.stringify(row));assert.ok(row.maxStopped<=6,JSON.stringify(row));if(row.level){assert.ok(row.spawned>0&&row.maxActive>=2,'empty traffic scenario '+row.id);assert.ok(row.movingCarSeconds>row.seconds*.5,'traffic must actually move: '+JSON.stringify(row));}}
}

// Public immutable assets only. Bounded to ~45 MB at the current release;
// the caller owns INPUT_DIR and must remove it when the audit is complete.
async function fetchInputs(dir){
 const base='https://staging.athensracing.com',{manifest}=await loadWorldDefinition(base+'/data/athens/manifest.json'),config=await fetch(base+'/api/routes').then(r=>r.json()),keys=new Set();await mkdir(resolve(dir,'cells'),{recursive:true});
 const around=p=>{const [x,z]=cellKey(p.x,p.z).split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)keys.add(`${x+dx},${z+dz}`);};
 for(const e of config.routes){const r=await fetch(base+e.url);assert.ok(r.ok);const c=await r.json();assert.equal(c.worldSetRevision,manifest.revision);await writeFile(resolve(dir,e.id+'.json'),JSON.stringify(c));for(const p of c.points.filter((_,i)=>i%12===0)){if(p[3]>2200)break;around({x:p[0],z:p[2]});}}
 around({x:(23.753-23.73)*87745.27512677578,z:(37.863-37.98)*-111320});
 const entries=[...keys].map(k=>manifest.tiles[k]).filter(Boolean);assert.ok(entries.length<=160,'audit cell budget');
 for(let i=0;i<entries.length;i+=4)await Promise.all(entries.slice(i,i+4).map(async e=>{const file=resolve(dir,'cells',e.sha256+'.bin.gz');try{await readFile(file);return;}catch{}const r=await fetch(new URL(e.url,base));assert.ok(r.ok);await writeFile(file,new Uint8Array(await r.arrayBuffer()));}));
 for(const e of Object.values(manifest.tiles))e.url=new URL(e.url,base).pathname;await writeFile(resolve(dir,'world.json'),JSON.stringify(manifest));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
