// Public motor-road coverage and junction half-edges, directly from frozen OSM.
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
export function sideStreetExits(elements,course){
 const raced=new Set(course.sourceNodeIds),edges=new Set(course.sourceNodeIds.slice(1).map((b,i)=>[course.sourceNodeIds[i],b].sort((a,b)=>a-b).join(':'))),seen=new Set(),out=[];
 for(const w of elements.filter(publicRoad))for(let i=0;i<w.nodes.length;i++){
  const a=w.nodes[i];if(!raced.has(a))continue;
  for(const j of [i-1,i+1]){const b=w.nodes[j];if(!b)continue;const key=[a,b].sort((a,b)=>a-b).join(':');const exitKey=`${a}:${b}`;if(edges.has(key)||seen.has(exitKey))continue;seen.add(exitKey);
   const direction=Math.sign(j-i),path=[];for(let k=j;k>=0&&k<w.nodes.length;k+=direction)path.push(w.nodes[k]);
   out.push({id:`${a}:${b}`,node:a,neighbour:b,way:w.id,path,width:Math.max(3,Math.min(14,parseFloat(w.tags.width)||ROAD_WIDTHS[w.tags.highway]))});
  }
 }
 return out;
}
