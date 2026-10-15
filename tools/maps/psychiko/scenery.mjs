// Deterministic scenery inferred from the frozen OSM streets and the 25-station research.
// No downloaded imagery is shipped. Dimensions/weights are estimates, not a botanical census.
import { Route, Terrain } from '../../../src/map.js';
import { RoadNetwork } from '../../../src/road-network-surface.js';
import { RNG, pointInPoly, polyBounds } from '../../../src/util.js';
import { psychikoStreet, psychikoSection } from '../../../src/maps/psychiko-streets.js';
const round = n => +n.toFixed(2);
export function buildPsychikoScenery(data, bytes) {
 const route=new Route(data.route), terrain=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const network=new RoadNetwork({id:'psychiko',data,route,terrain}),rng=new RNG(381023);
 const proj=(lat,lon)=>[(lon-data.proj.lon0)*data.proj.mlon,-(lat-data.proj.lat0)*data.proj.mlat];
 const squares=[{id:'a-square',center:proj(38.0077369,23.7743090),radius:23,pink:true},{id:'b-square',center:proj(38.0131198,23.7721502),radius:23,pink:false}];
 const trees=[],frontages=[],parking=[],furniture=[],used=new Set(),buildingCells=new Map();
 for(const b of data.buildings){const bb=polyBounds(b.p);for(let x=Math.floor(bb.x0/32);x<=Math.floor(bb.x1/32);x++)for(let z=Math.floor(bb.z0/32);z<=Math.floor(bb.z1/32);z++){const k=x+','+z;if(!buildingCells.has(k))buildingCells.set(k,[]);buildingCells.get(k).push(b);}}
 const inBuilding=(x,z)=>buildingCells.get(Math.floor(x/32)+','+Math.floor(z/32))?.some(b=>pointInPoly(x,z,b.p));
 function clear(x,z,pad=.5){if(inBuilding(x,z))return false;if(network.nearMain(x,z)){const q=network.project(x,z);if(Math.abs(q.u)<route.edge(q.s)+.55+pad)return false;}
  return !network.candidates(x,z).some(seg=>network.distance(seg,x,z)<seg.hw+pad);
 }
 function tree(x,z,type,h){if(!clear(x,z,.8))return;const key=Math.round(x/3)+','+Math.round(z/3);if(used.has(key))return;used.add(key);trees.push([round(x),round(z),type,round(h),round(rng.next()*6.28)]);}
 function species(kind,garden=false){const n=rng.next();if(kind==='cypress'&&garden)return n<.65?2:0;if(kind==='olive'&&!garden)return n<.75?3:1;if(kind==='school'||kind==='frontage')return n<.6?0:n<.85?2:1;return n<.35?0:n<.65?1:n<.8?2:n<.95?3:4;}
 const height=t=>t===0?rng.range(11,17):t===2?rng.range(12,20):t===1?rng.range(5,8):t===3?rng.range(3.5,5):rng.range(4,7);
 function dress(point,length,section,seed){
  // Disjoint six-metre frontage pieces follow curved streets and step with terrain.
  for(let s=3;s<length-2;s+=6){const p=point(s);for(const side of [-1,1]){
   const u=section.w/2+.55+section.sw+.4,x=p.x-p.tz*u*side,z=p.z+p.tx*u*side;
   const tx=p.tx,tz=p.tz;const good=!squares.some(q=>Math.hypot(x-q.center[0],z-q.center[1])<q.radius+3)&&[-3,0,3].every(d=>clear(x+tx*d,z+tz*d,.55));
   if(good){const plot=Math.floor((s+seed%22)/22),r=new RNG((seed+plot*733)^side),n=r.next(),type=section.kind==='school'&&side===1?4:section.kind==='olive'&&side===-1?1:n<.35?0:n<.70?1:n<.90?2:3;
    frontages.push([round(x),round(z),round(Math.atan2(tx,tz)),5.95,type,round(type===4?2.55:type===1?r.range(1.8,2.7):r.range(1.6,2.2))]);
   }
   if(Math.floor(s/6)%5===0&&good)furniture.push([round(x-p.tz*side*.8),round(z+p.tx*side*.8),round(Math.atan2(-p.tx,-p.tz)),section.paint?'lamp':'pole',section.kind]);
  }}
  for(let s=4;s<length-5;s+=7.2+rng.range(-1,1)){const p=point(s);for(const side of [-1,1]){
   const u=section.w/2+.55+.8,x=p.x-p.tz*u*side,z=p.z+p.tx*u*side;
   if(clear(x,z,.75)){const t=species(section.kind);tree(x,z,t,height(t));}
   const gu=section.w/2+section.sw+rng.range(4,10),gx=p.x-p.tz*gu*side,gz=p.z+p.tx*gu*side;
   if(rng.next()<.82){const t=species(section.kind,true);tree(gx,gz,t,height(t));}
   // Park beyond the entire asphalt ribbon, including the full race width. Decorative/non-colliding.
   if(rng.next()<section.parking){const pu=section.w/2+1.5,px=p.x-p.tz*pu*side,pz=p.z+p.tx*pu*side;
    if(!squares.some(q=>Math.hypot(px-q.center[0],pz-q.center[1])<q.radius+3)&&[-2.5,0,2.5].every(d=>clear(px+p.tx*d,pz+p.tz*d,.55)))parking.push([round(px),round(pz),round(Math.atan2(-p.tx,-p.tz)),rng.int(0,7)]);
   }
  }}
 }
 // Split at names to use station-specific cross sections; route frame remains the driving spline.
 for(let i=0;i<route.names.length;i++){const start=route.names[i].s,end=route.names[i+1]?.s??route.length,section=psychikoSection(route,start+.1);dress(s=>route.frame(start+s,{}),end-start,section,10000+i);}
 for(const road of network.roads){if(!road.urban||['primary','primary_link'].includes(road.h))continue;const section=psychikoStreet(road.n,road.p[1]<-900);section.w=road.w;let segments=[],length=0;
  for(let i=0;i+3<road.p.length;i+=2){const [x,z,bx,bz]=road.p.slice(i,i+4),L=Math.hypot(bx-x,bz-z);if(L>0)segments.push({s:length,x,z,tx:(bx-x)/L,tz:(bz-z)/L,L});length+=L;}
  const point=s=>{const q=segments.findLast(q=>q.s<=s)||segments[0];return {x:q.x+q.tx*(s-q.s),z:q.z+q.tz*(s-q.s),tx:q.tx,tz:q.tz};};if(segments.length)dress(point,length,section,road.id);
 }
 for(const q of squares)for(let i=0;i<22;i++){const a=rng.next()*Math.PI*2,r=Math.sqrt(rng.next())*(q.radius-2),t=i%5===0?3:i%4===0?2:0;tree(q.center[0]+Math.sin(a)*r,q.center[1]+Math.cos(a)*r,t,t===3?5:height(t));}
 return {version:1,seed:381023,source:'25-station Street View study, 2026-10-15; frozen OSM',trees,frontages,parking,furniture,squares};
}
