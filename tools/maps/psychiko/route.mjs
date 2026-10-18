// Frozen OSM motor-road loop matched to the user drawing (Palaio Psychiko / Filothei).
import fs from 'node:fs';
import {roundaboutLoops,legalRoundaboutCourse,repairRoundaboutArms} from '../../roundabouts.mjs';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('./',import.meta.url));
const elements=JSON.parse(gunzipSync(fs.readFileSync(dir+'raw/osm.json.gz'))).elements;
const lat0=38.009,lon0=23.775,phi=lat0*Math.PI/180;
const mlat=111132.92-559.82*Math.cos(2*phi)+1.175*Math.cos(4*phi),mlon=111412.84*Math.cos(phi)-93.5*Math.cos(3*phi);
const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
const ways=new Map(elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
const pos=id=>{const n=nodes.get(id);return[(n.lon-lon0)*mlon,-(n.lat-lat0)*mlat];},dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// Reviewed exact node/way list: no runtime shortest-path or georeference heuristics.
const course=JSON.parse(fs.readFileSync(dir+'raw/drawn-course.json'));
const P=n=>[(n.lon-lon0)*mlon,-(n.lat-lat0)*mlat],loops=roundaboutLoops(elements,P);
const legal=repairRoundaboutArms(legalRoundaboutCourse(course.nodes,course.edgeWays,loops),loops,elements,P);
const chain=legal.nodes,edgeWays=legal.edgeWays,vias=[...course.stations,course.stations[0]];
if(chain[0]!==chain.at(-1))throw Error('Course must be a simple closed loop');
if(edgeWays.length!==chain.length-1)throw Error('Missing edge provenance');
for(let i=0;i<edgeWays.length;i++){
 const w=ways.get(edgeWays[i]),t=w?.tags||{},a=chain[i],b=chain[i+1];
 if(!w||!w.nodes.some((n,k)=>n===a&&(w.nodes[k-1]===b||w.nodes[k+1]===b)))throw Error('Course edge missing from source');
 if(['private','no'].includes(t.access)||['private','no'].includes(t.motor_vehicle)||(t.surface&&!['asphalt','paved','sett','paving_stones'].includes(t.surface)))throw Error('Non-public paved course edge');
}
function sample(points,step){const out=[points[0]];let s=0,next=step;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=dist(a,b);while(next<s+l){const t=(next-s)/l;out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);next+=step;}s+=l;}return out;}
// Real junctions turn through a short fillet instead of a knife-edge corner. The arc stays within
// FILLET_RADIUS*(sec(turn/2)-1) of the OSM node, so the whole raced line still lies on the street surface.
const FILLET_RADIUS=10;
function fillet(points,radius){const n=points.length-1,out=[];// closed ring: points[0]===points[n]
 for(let i=0;i<n;i++){const a=points[(i-1+n)%n],b=points[i],c=points[(i+1)%n],ab=dist(a,b),bc=dist(b,c);
  const u=[(b[0]-a[0])/ab,(b[1]-a[1])/ab],v=[(c[0]-b[0])/bc,(c[1]-b[1])/bc],turn=Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1])));
  if(turn<.2||turn>2.9){out.push(b);continue;}
  const t=Math.min(radius*Math.tan(turn/2),ab*.45,bc*.45),r=t/Math.tan(turn/2),p0=[b[0]-u[0]*t,b[1]-u[1]*t],p1=[b[0]+v[0]*t,b[1]+v[1]*t];
  // The arc centre lies on the inside bisector, r/cos(turn/2) from the corner.
  const bis=[v[0]-u[0],v[1]-u[1]],bl=Math.hypot(...bis),ic=[b[0]+bis[0]/bl*r/Math.cos(turn/2),b[1]+bis[1]/bl*r/Math.cos(turn/2)];
  const a0=Math.atan2(p0[1]-ic[1],p0[0]-ic[0]);let da=Math.atan2(p1[1]-ic[1],p1[0]-ic[0])-a0;while(da>Math.PI)da-=2*Math.PI;while(da<-Math.PI)da+=2*Math.PI;
  const steps=Math.max(2,Math.ceil(Math.abs(da)*r/1.5));for(let k=0;k<=steps;k++){const q=a0+da*k/steps;out.push([ic[0]+Math.cos(q)*r,ic[1]+Math.sin(q)*r]);}
 }
 out.push(out[0]);return out;}
const ring=fillet(chain.map(pos),FILLET_RADIUS);
const dense=sample(ring,1),smooth=dense.map((_,i)=>{let x=0,z=0,sum=0;for(let k=-9;k<=9;k++){const w=Math.exp(-k*k/18),p=dense[(i+k+dense.length)%dense.length];x+=p[0]*w;z+=p[1]*w;sum+=w;}return[x/sum,z/sum];});
smooth.push(smooth[0]);const total=smooth.slice(1).reduce((s,p,i)=>s+dist(p,smooth[i]),0),count=Math.round(total/2),step=total/count;
const pts=sample(smooth,step).slice(0,count);
// Put the timing line where the course says (a metres offset along the loop from its first node; negative
// counts back from it).
const shift=(((Math.round((course.startOffset||0)/step))%count)+count)%count;if(shift){const body=pts.slice(0);pts.splice(0,pts.length,...body.slice(shift),...body.slice(0,shift));}
pts.push(pts[0]);
const locate=id=>{const p=pos(id);let j=0;pts.forEach((q,i)=>{if(dist(p,q)<dist(p,pts[j]))j=i;});return +(j*step).toFixed(2);};
const ordered=[];edgeWays.forEach((id,i)=>{if(i===0||id!==edgeWays[i-1])ordered.push({id,name:ways.get(id).tags['name:en']||ways.get(id).tags.int_name||ways.get(id).tags.name||'Unnamed paved junction',from:chain[i],to:chain[i+1]});else ordered.at(-1).to=chain[i+1];});
// Oncoming (reverse) traffic needs a street-legal way round each roundabout. Plan every roundabout the course
// uses on its own; an arm that is one-way against the reverse direction simply gets no reverse plan.
const reversedCourse=legalRoundaboutCourse([...chain].reverse(),[...edgeWays].reverse(),loops);
const reverse={repairs:[]};
for(const loop of loops){if(!reversedCourse.edgeWays.some(id=>loop.ways.includes(id)))continue;
 try{reverse.repairs.push(...repairRoundaboutArms(reversedCourse,[loop],elements,P,{allowClosedRoad:false}).repairs);}catch(error){if(!/No legal roundabout/.test(error.message))throw error;}}
const trafficRoundabouts=reverse.repairs.map(q=>{let distance=0,entryDistance=null,exitDistance=null;const loop=loops.find(l=>l.id===q.id);for(let i=0;i<q.ways.length;i++){const a=q.p[i],b=q.p[i+1],length=dist(a,b);if(loop.ways.includes(q.ways[i])){entryDistance??=distance;exitDistance=distance+length;}distance+=length;}return{id:q.id,s0:locate(q.to),s1:locate(q.from),path:q.p,sourceNodeIds:q.nodes,sourceWayIds:q.ways,length:distance,entryDistance,exitDistance};});
const names=ordered.map(w=>({s:locate(w.from),name:w.name})).sort((a,b)=>a.s-b.s);if(names[0].s>0)names.unshift({s:0,name:names.at(-1).name});// the street the timing line sits on
const result={proj:{lat0,lon0,mlat,mlon},step,start:0,finish:count*step,length:count*step,x:pts.map(p=>+p[0].toFixed(2)),z:pts.map(p=>+p[1].toFixed(2)),names,sourceWayIds:[...new Set(edgeWays)],orderedWays:ordered,sourceNodeIds:chain,trafficRoundabouts,stations:vias.slice(0,-1).map(id=>({id,s:locate(id),lat:nodes.get(id).lat,lon:nodes.get(id).lon}))};
fs.writeFileSync(dir+'raw/route.json',JSON.stringify(result));
const elevationPoints=[];for(let i=0;i<pts.length;i+=12)elevationPoints.push({s:i*step,lat:lat0-result.z[i]/mlat,lon:lon0+result.x[i]/mlon});elevationPoints.push({s:total,lat:lat0-result.z[0]/mlat,lon:lon0+result.x[0]/mlon});
fs.writeFileSync(dir+'raw/route-points.json',JSON.stringify(elevationPoints));
console.log({length:total,ways:ordered.map(w=>w.id),stations:result.stations});
