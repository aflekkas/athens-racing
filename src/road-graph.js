// Geometry and direction share the normalized source polyline, including clipped roundabout arcs.
export function buildRoadGraph(roads){const nodes=new Map(),edges=[];
 const node=(x,z)=>{const id=`${x.toFixed(2)},${z.toFixed(2)}`;if(!nodes.has(id))nodes.set(id,{id,x,z,out:[]});return nodes.get(id);};
 for(const road of roads)for(let i=2;i<road.p.length;i+=2){const a=node(road.p[i-2],road.p[i-1]),b=node(road.p[i],road.p[i+1]);if(a===b)continue;
  const add=(from,to)=>{const edge={from:from.id,to:to.id,road:road.id,roundabout:road.roundabout,length:Math.hypot(to.x-from.x,to.z-from.z)};edges.push(edge);from.out.push(edge);};add(a,b);if(!road.oneway)add(b,a);
 }return{nodes,edges};}
