#!/usr/bin/env node
// Offline, repeatable extraction of the surrounding OSM highway network. Route arrays are never rewritten.
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { psychikoStreet } from '../src/maps/psychiko-streets.js';
import { limitForWay } from './speed-signs.mjs';
export const ROAD_WIDTHS = Object.freeze({primary:9,secondary:7.5,tertiary:7,unclassified:6,residential:5.6,living_street:4.5,service:4,primary_link:6,secondary_link:6,tertiary_link:5});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),round=v=>Math.round(v*100)/100;
export function extractRoadNetwork(data, elements, {radius=550,excludeWays=[],bounds=null}={}) {
 // Optional [minX,minZ,maxX,maxZ] clip keeps roads (and their shoulders) on the terrain grid.
 const inBounds=p=>!bounds||p[0]>=bounds[0]&&p[1]>=bounds[1]&&p[0]<=bounds[2]&&p[1]<=bounds[3];
 const r=data.route,proj=data.proj,nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
 const project=n=>[(n.lon-proj.lon0)*proj.mlon,-(n.lat-proj.lat0)*proj.mlat];
 // Coarse route samples have a bounded spacing; exact distance is then evaluated on their adjoining segments.
 const cells=new Map(),C=80;
 for(let i=0;i<r.x.length-1;i+=Math.max(1,Math.floor(8/r.step))){const k=`${Math.floor(r.x[i]/C)},${Math.floor(r.z[i]/C)}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}
 function nearest(x,z){let best=Infinity,index=0;const cx=Math.floor(x/C),cz=Math.floor(z/C),rad=Math.ceil((radius+30)/C);
  for(let a=-rad;a<=rad;a++)for(let b=-rad;b<=rad;b++)for(const i of cells.get(`${cx+a},${cz+b}`)||[]){const d=(r.x[i]-x)**2+(r.z[i]-z)**2;if(d<best){best=d;index=i;}}
  const i=index,j=Math.min(i+Math.max(1,Math.floor(8/r.step)),r.x.length-1),dx=r.x[j]-r.x[i],dz=r.z[j]-r.z[i],L=Math.hypot(dx,dz)||1,t=clamp(((x-r.x[i])*dx+(z-r.z[i])*dz)/(L*L),0,1);
  return {d:Math.hypot(x-r.x[i]-t*dx,z-r.z[i]-t*dz),dx:dx/L,dz:dz/L,edge:r.width?r.width[i]/2:(r.lanes[i]*3.3+r.div[i]*2),s:(i+(j-i)*t)*r.step};
 }
 const roads=[],excluded=new Set(excludeWays),seen=new Set();
 for(const way of elements){const t=way.tags||{},width=ROAD_WIDTHS[t.highway];if(!width||seen.has(way.id))continue;seen.add(way.id);
  if(t.tunnel==='yes'||t.bridge==='yes'||Number(t.layer)||t.access==='no'||t.service==='drive-through')continue;
  // A route way can include an unused arm. Geometric suppression below keeps that arm while removing the raced portion.
  const ps=(way.geometry||way.nodes?.map(id=>nodes.get(id))||[]).filter(Boolean).map(project);if(ps.length<2)continue;
  let run=[],part=0;const sf=/^(unpaved|dirt|ground|gravel|compacted|fine_gravel|sand|grass|earth)$/.test(t.surface||'')?'gravel':'asphalt';
  const finish=()=>{if(run.length>1){const p=run.flat().map(round);const length=run.slice(1).reduce((s,v,i)=>s+Math.hypot(v[0]-run[i][0],v[1]-run[i][1]),0);if(length>2){const section=data.psychiko?psychikoStreet(t['name:en']||t.int_name||t.name,(run[0]?.[1]||0)<-900):null;const urban=section?1:['residential','living_street'].includes(t.highway)||t.sidewalk&&t.sidewalk!=='no'?1:0,{v,src}=limitForWay(t,urban);roads.push({id:way.id,part:part++,h:t.highway,p,w:clamp((section&&!['primary','primary_link'].includes(t.highway)?section.w:parseFloat(t.width))||(t.service==='parking_aisle'?3.5:width),3,14),sf,urban,v,vs:src,oneway:t.oneway==='yes'?1:0,n:t['name:en']||t.int_name||t.name||undefined});}}run=[];};
  for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),count=Math.max(1,Math.ceil(L/16));
   for(let j=0;j<count;j++){const A=[a[0]+dx*j/count,a[1]+dz*j/count],B=[a[0]+dx*(j+1)/count,a[1]+dz*(j+1)/count],q=nearest((A[0]+B[0])/2,(A[1]+B[1])/2);
    const parallel=Math.abs((dx*q.dx+dz*q.dz)/(L||1))>.8;
    if(!inBounds(A)||!inBounds(B)||q.d>radius||q.d<q.edge+1.2&&parallel&&(excluded.has(way.id)||q.d<q.edge)){finish();continue;}
    if(!run.length)run.push(A);run.push(B);
   }
  }finish();
 }
 const length=roads.reduce((sum,r)=>sum+r.p.slice(2).filter((_,i)=>i%2===0).reduce((s,_,i)=>s+Math.hypot(r.p[2*i+2]-r.p[2*i],r.p[2*i+3]-r.p[2*i+1]),0),0);
 return {version:2,radius,source:'OpenStreetMap highway ways · © OpenStreetMap contributors (ODbL)',length:round(length),roads};
}
export function readNetworkSource(root,id){
 const read=p=>JSON.parse(fs.readFileSync(resolve(root,p)));
 if(id==='riviera')return read('data/raw/roads.json').elements;
 if(id==='megara')return read('tools/maps/megara/raw/context.json').map(w=>({type:'way',...w}));
 const full=resolve(root,`tools/maps/${id}/raw/osm.json.gz`),fixture=resolve(root,'tools/maps/penteli/road-network-source.json.gz');
 const elements=JSON.parse(gunzipSync(fs.readFileSync(fs.existsSync(full)?full:fixture))).elements;
 if(id!=='psychiko')return elements;
 // The neighbourhood pipeline freezes its public municipal/route-corridor selection.
 // Rebuilding the generic network must use that exact set rather than the whole regional bbox.
 const ids=read('data/maps/psychiko/map.json').psychiko?.networkWayIds;
 if(!ids)return elements;
 const selected=new Set(ids);return elements.filter(e=>e.type==='node'||e.type==='way'&&selected.has(e.id));
}
export function rebuildNetwork(root,id){const path=resolve(root,id==='riviera'?'data/map.json':`data/maps/${id}/map.json`),data=JSON.parse(fs.readFileSync(path));data.roadNetwork=extractRoadNetwork(data,readNetworkSource(root,id),data.psychiko?{radius:data.roadNetwork?.radius||300,excludeWays:data.psychiko.sourceWayIds,bounds:data.psychiko.networkBounds}:{});fs.writeFileSync(path,JSON.stringify(data));console.log(`${id}: ${data.roadNetwork.roads.length} surrounding OSM ways / ${(data.roadNetwork.length/1000).toFixed(2)} km`);return data.roadNetwork;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const root=fileURLToPath(new URL('../',import.meta.url));for(const id of process.argv.slice(2).length?process.argv.slice(2):['riviera','megara','penteli','psychiko'])rebuildNetwork(root,id);}
