// Reconstruct complete rings before route clipping: OSM often splits a roundabout at junctions.
export function roundaboutLoops(elements, project) {
 const nodes=new Map(elements.filter(e=>e.type==='node').map(n=>[n.id,n]));
 const ways=elements.filter(w=>w.type==='way'&&w.tags?.junction==='roundabout').map(w=>{const ids=w.nodes||w.geometry?.map(n=>`${n.lon},${n.lat}`)||[];w.geometry?.forEach((n,i)=>nodes.set(ids[i],n));return {...w,nodes:ids};}).filter(w=>w.nodes.length>1&&w.nodes.every(id=>nodes.has(id))),remaining=new Set(ways),loops=[];
 for(const first of ways){if(!remaining.has(first))continue;remaining.delete(first);const chain=[...first.nodes],parts=[first];
  while(chain[0]!==chain.at(-1)){const next=[...remaining].find(w=>w.nodes[0]===chain.at(-1)||w.nodes.at(-1)===chain.at(-1));if(!next)break;remaining.delete(next);parts.push(next);const ns=next.nodes[0]===chain.at(-1)?next.nodes:[...next.nodes].reverse();chain.push(...ns.slice(1));}
  if(chain[0]!==chain.at(-1)||chain.length<4)continue;
  let points=chain.slice(0,-1).map(id=>project(nodes.get(id))),area=points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-q[0]*p[1];},0);
  // z points south: negative x/z signed area is counter-clockwise on the map.
  if(area>0){chain.reverse();points.reverse();}
  const width=Math.max(3,Math.min(7,...parts.map(w=>parseFloat(w.tags.width)||5.5)));
  loops.push({id:Math.min(...parts.map(w=>w.id)),ways:parts.map(w=>w.id),nodes:chain,p:chain.slice(0,-1).map(id=>project(nodes.get(id))),w:width,edgeWays:chain.slice(1).map((b,i)=>parts.find(w=>w.nodes.some((a,j)=>a===chain[i]&&(w.nodes[j-1]===b||w.nodes[j+1]===b))).id)});
 }
 return loops;
}
export function legalRoundaboutCourse(chain,edgeWays,loops){
 const lookup=new Map(loops.flatMap(loop=>loop.ways.map(id=>[id,loop]))),nodes=[chain[0]],ways=[];
 for(let i=0;i<edgeWays.length;){const loop=lookup.get(edgeWays[i]);if(!loop){ways.push(edgeWays[i]);nodes.push(chain[++i]);continue;}
  let end=i+1;while(end<edgeWays.length&&lookup.get(edgeWays[end])===loop)end++;
  const ring=loop.nodes.slice(0,-1),from=ring.indexOf(chain[i]),to=ring.indexOf(chain[end]);if(from<0||to<0)throw Error('Roundabout course arm missing');
  let k=from;while(k!==to){const next=(k+1)%ring.length;const a=ring[k],b=ring[next];const original=loop.edgeWays[k];ways.push(original);nodes.push(b);k=next;}
  i=end;
 }
 return {nodes,edgeWays:ways};
}
export function routeRoundabouts(route,loops){const out=[];
 for(const loop of loops){let start=null;for(let i=0;i<route.x.length;i++){const x=route.x[i],z=route.z[i];let d=Infinity;for(let j=0;j<loop.p.length;j++){const a=loop.p[j],b=loop.p[(j+1)%loop.p.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));d=Math.min(d,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));}
   if(d<2&&start===null)start=i;
   if((d>=2||i===route.x.length-1)&&start!==null){if((i-start)*route.step>6)out.push({id:loop.id,s0:start*route.step,s1:(i-1)*route.step,p:loop.p,w:loop.w});start=null;}
  }
 }return out.sort((a,b)=>a.s0-b.s0);
}
// A closed race may reverse an ordinary street, but a split one-way entry arm
// still has to feed the correct side of a roundabout. Replan only its junction apron.
export function repairRoundaboutArms(course,loops,elements,project,{allowClosedRoad=true}={}){
 const nodes=new Map(elements.filter(e=>e.type==='node').map(n=>[n.id,n])),ways=elements.filter(w=>w.type==='way'&&/^(tertiary|secondary|primary|unclassified|residential|living_street|service)(_link)?$/.test(w.tags?.highway||'')&&!['no','private'].includes(w.tags?.access));
 let chain=course.nodes,edgeWays=course.edgeWays;const repairs=[];
 for(const loop of loops){const ids=new Set(loop.ways);let begin=edgeWays.findIndex(id=>ids.has(id));if(begin<0)continue;let end=begin+1;while(end<edgeWays.length&&ids.has(edgeWays[end]))end++;
  const dist=id=>{const p=project(nodes.get(id));return Math.min(...loop.p.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])));};
  while(begin>0&&dist(chain[begin])<45)begin--;while(end<chain.length-1&&dist(chain[end])<45)end++;
  const reach=Math.max(140,dist(chain[begin])+1,dist(chain[end])+1),graph=new Map(),add=(a,b,w)=>{if(!nodes.has(a)||!nodes.has(b)||dist(a)>reach||dist(b)>reach)return;const p=project(nodes.get(a)),q=project(nodes.get(b)),edge={to:b,way:w.id,cost:Math.hypot(q[0]-p[0],q[1]-p[1]),ring:ids.has(w.id)};if(!graph.has(a))graph.set(a,[]);graph.get(a).push(edge);};
  for(const w of ways){let ns=w.nodes||[];const ring=loops.find(l=>l.ways.includes(w.id));if(ring){const i=ring.nodes.indexOf(ns[0]);if(ring.nodes[(i+1)%(ring.nodes.length-1)]!==ns[1])ns=[...ns].reverse();}else if(w.tags.oneway==='-1')ns=[...ns].reverse();const wayLength=ns.slice(1).reduce((sum,id,i)=>{const a=project(nodes.get(ns[i])),b=project(nodes.get(id));return sum+Math.hypot(a[0]-b[0],a[1]-b[1]);},0);for(let i=1;i<ns.length;i++){add(ns[i-1],ns[i],w);if(!ring&&(!['yes','1','true','-1'].includes(w.tags.oneway)||allowClosedRoad&&wayLength>60))add(ns[i],ns[i-1],w);}}
  const key=(n,phase)=>`${n}:${phase}`,start=key(chain[begin],0),goal=chain[end],best=new Map([[start,0]]),previous=new Map(),queue=[{node:chain[begin],phase:0,key:start,cost:0}];let found;
  while(queue.length){queue.sort((a,b)=>b.cost-a.cost);const current=queue.pop();if(current.cost!==best.get(current.key))continue;if(current.node===goal&&current.phase===2){found=current.key;break;}
   for(const edge of graph.get(current.node)||[]){if(current.phase===2&&edge.ring)continue;const phase=edge.ring?1:current.phase===1?2:current.phase,next=key(edge.to,phase),cost=current.cost+edge.cost;if(cost<(best.get(next)??Infinity)){best.set(next,cost);previous.set(next,{key:current.key,node:current.node,way:edge.way});queue.push({node:edge.to,phase,key:next,cost});}}
  }
  if(!found)throw Error('No legal roundabout entry/exit '+loop.id+' '+chain[begin]+' -> '+goal+' '+edgeWays.slice(begin,end).join(','));const ns=[goal],ws=[];while(found!==start){const p=previous.get(found);ns.push(p.node);ws.push(p.way);found=p.key;}ns.reverse();ws.reverse();repairs.push({id:loop.id,from:chain[begin],to:chain[end],p:ns.map(id=>project(nodes.get(id))),nodes:ns,ways:ws});chain=[...chain.slice(0,begin),...ns,...chain.slice(end+1)];edgeWays=[...edgeWays.slice(0,begin),...ws,...edgeWays.slice(end)];
 }
 return{nodes:chain,edgeWays,repairs};
}
