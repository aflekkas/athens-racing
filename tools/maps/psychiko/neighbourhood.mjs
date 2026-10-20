// Public motor-road coverage and junction half-edges, directly from frozen OSM.
import {roundaboutLoops} from '../../roundabouts.mjs';
import {ROAD_WIDTHS} from '../../build-road-network.mjs';
export function publicRoad(w) {
 const t=w.tags||{};
 return w.type==='way'&&!!ROAD_WIDTHS[t.highway]&&t.area!=='yes'&&!['private','no'].includes(t.access)&&!['private','no'].includes(t.vehicle)&&!['private','no'].includes(t.motor_vehicle)&&!['private','no'].includes(t.motorcar)&&!['driveway','parking_aisle','drive-through'].includes(t.service)&&!['construction','proposed'].includes(t.highway);
}
export function boundaryRing(boundaries,project){
 const parts=boundaries.elements.find(r=>r.id===1403235).members.filter(m=>m.role==='outer'&&m.geometry).map(m=>m.geometry.map(project));
 const ring=parts.shift(),same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.1;
 while(parts.length){const i=parts.findIndex(p=>same(p[0],ring.at(-1))||same(p.at(-1),ring.at(-1)));if(i<0)throw Error('Disconnected Psychiko boundary');const p=parts.splice(i,1)[0];if(!same(p[0],ring.at(-1)))p.reverse();ring.push(...p.slice(1));}
 return ring;
}
export function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
// Length of a polyline lying in the municipality, counting stretches that run exactly along the administrative
// edge (within `tol` m). Boundary streets such as 25is Martiou have every vertex on the edge, so a strict
// vertex-in-polygon test misses them; a way touching the edge at a single node adds no length.
export function municipalLength(points,ring,tol=1){
 const edge=(x,z)=>{let d=Infinity;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));d=Math.min(d,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));}return d;};
 let length=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(L));
  for(let k=0;k<n;k++){const x=a[0]+(b[0]-a[0])*(k+.5)/n,z=a[1]+(b[1]-a[1])*(k+.5)/n;if(inside([x,z],ring)||edge(x,z)<=tol)length+=L/n;}}
 return length;
}
export function sideStreetExits(elements,course){
 const chain=[...course.sourceNodeIds];
 // Keep every raced ring open, including its unused arc; close the outgoing arms of the WHOLE square.
 const rings=roundaboutLoops(elements,n=>[n.lon,n.lat]).filter(l=>l.ways.some(id=>course.sourceWayIds.includes(id)));
 const raced=new Set([...chain,...rings.flatMap(l=>l.nodes)]),edges=new Set(course.sourceNodeIds.slice(1).map((b,i)=>[course.sourceNodeIds[i],b].sort((a,b)=>a-b).join(':'))),seen=new Set(),out=[];
 for(const l of rings)for(let i=1;i<l.nodes.length;i++)edges.add([l.nodes[i-1],l.nodes[i]].sort((a,b)=>a-b).join(':'));
 for(const id of course.openJunctionWayIds||[]){const w=elements.find(e=>e.type==='way'&&e.id===id);if(!w)throw Error('Missing reviewed junction way '+id);w.nodes.forEach(n=>raced.add(n));for(let i=1;i<w.nodes.length;i++)edges.add([w.nodes[i-1],w.nodes[i]].sort((a,b)=>a-b).join(':'));}
 for(const w of elements.filter(publicRoad))for(let i=0;i<w.nodes.length;i++){
  const a=w.nodes[i];if(!raced.has(a))continue;
  for(const j of [i-1,i+1]){const b=w.nodes[j];if(!b)continue;const key=[a,b].sort((a,b)=>a-b).join(':');const exitKey=`${a}:${b}`;if(edges.has(key)||seen.has(exitKey))continue;seen.add(exitKey);
   const direction=Math.sign(j-i),path=[];for(let k=j;k>=0&&k<w.nodes.length;k+=direction)path.push(w.nodes[k]);
   out.push({id:`${a}:${b}`,node:a,neighbour:b,way:w.id,path,width:Math.max(3,Math.min(14,parseFloat(w.tags.width)||ROAD_WIDTHS[w.tags.highway]))});
  }
 }
 return out;
}
