// A drivable start point about D metres upstream (by turn-aware predecessor search) of a given edge.
const [app,manifest,target,dist=1200]=process.argv.slice(2);
const {loadWorld}=await import(app+'/tools/world-connectivity-audit.mjs');const {graph}=await loadWorld(manifest);
const edges=[...graph.edges.values()].map(v=>v.value).filter(e=>!(e.flags&8));const byId=new Map(edges.map(e=>[e.id,e]));
for(const e of edges)e.length=e.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-e.points[i][0],p[2]-e.points[i][2]),0);
const pred=new Map();for(const e of edges)for(const id of graph.outgoing.get(e.to)||[]){const n=byId.get(id);if(n&&graph.legal(e.id,n)&&Math.abs(n.points[0][1]-e.points.at(-1)[1])<.025){(pred.get(id)||pred.set(id,[]).get(id)).push(e);}}
const t=edges.find(e=>e.id.includes(target));let frontier=[[t,0]];const seen=new Set([t.id]);let best=null;
while(frontier.length){const next=[];for(const [e,d] of frontier)for(const p of pred.get(e.id)||[]){if(seen.has(p.id))continue;seen.add(p.id);const dd=d+p.length;if(dd>=dist){if(!best||dd<best[1])best=[p,dd];}else next.push([p,dd]);}frontier=next;if(best&&frontier.length===0)break;}
console.log(best?JSON.stringify({edge:best[0].id,name:best[0].name,x:best[0].points[0][0],z:best[0].points[0][2],distance:Math.round(best[1])}):'none');
