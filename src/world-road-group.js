import {edgeValue} from './route-geometry.js';
// The same physical two-way street may have several imported reverse shards.
// A stable choice keeps native recovery, offline proof and server validation in
// agreement independent of cell activation/insertion order.
export function recoveryRoadGroup(graph,edge){
 if(!edge||edge.flags&8)return null;
 const twin=[...(graph.outgoing?.get(edge.to)||graph.edges.keys())].map(id=>edgeValue(graph,id)).filter(e=>e&&!(e.flags&8)&&e.from===edge.to&&e.to===edge.from&&e.layer===edge.layer&&e.surface===edge.surface).sort((a,b)=>a.id.localeCompare(b.id))[0];
 return twin?{roadId:[edge.id,twin.id].sort().join('|'),twinId:twin.id}:null;
}
