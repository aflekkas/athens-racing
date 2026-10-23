import {edgeValue} from './route-geometry.js';
// The same physical two-way street may have several imported reverse shards.
// A stable choice keeps native recovery, offline proof and server validation in
// agreement independent of cell activation/insertion order.
const endpoint=v=>typeof v==='string'&&v.length>0;
export function recoveryRoadTwins(graph,edge){
 if(!edge||edge.flags&9||!endpoint(edge.id)||!endpoint(edge.from)||!endpoint(edge.to))return [];
 return [...(graph.outgoing?.get(edge.to)||graph.edges.keys())].map(id=>edgeValue(graph,id)).filter(e=>e&&endpoint(e.id)&&e.id!==edge.id&&endpoint(e.from)&&endpoint(e.to)&&!(e.flags&9)&&e.from===edge.to&&e.to===edge.from&&e.layer===edge.layer&&e.surface===edge.surface).sort((a,b)=>a.id.localeCompare(b.id));
}
export function recoveryRoadGroup(graph,edge){
 const twin=recoveryRoadTwins(graph,edge)[0];return twin?{roadId:[edge.id,twin.id].sort().join('|'),twinId:twin.id}:null;
}
