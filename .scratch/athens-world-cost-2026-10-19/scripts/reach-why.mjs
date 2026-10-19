// Why part of a district cannot be entered: classify edges unreachable from the start by the nearest cause.
// node reach-why.mjs APP CELLS/manifest.json [startEdge]
const [app,manifest,startId='osm:way:23182990:2-0:f:0:1']=process.argv.slice(2);
const {loadWorld}=await import(app+'/tools/world-connectivity-audit.mjs');
const {graph}=await loadWorld(manifest);
const edges=[...graph.edges.values()].map(v=>v.value).filter(e=>!(e.flags&8));
const index=new Map(edges.map((e,i)=>[e.id,i]));
for(const e of edges)e.length=e.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-e.points[i][0],p[2]-e.points[i][2]),0);
const next=edges.map(e=>{const o=[];for(const id of graph.outgoing.get(e.to)||[]){const n=graph.edges.get(id)?.value;if(!n||!index.has(id)||!graph.legal(e.id,n)||Math.abs(n.points[0][1]-e.points.at(-1)[1])>=.025)continue;o.push(index.get(id));}return o;});
const prev=edges.map(()=>[]);next.forEach((o,i)=>o.forEach(j=>prev[j].push(i)));
const bfs=s=>{const seen=new Uint8Array(edges.length),q=[s];seen[s]=1;for(let i=0;i<q.length;i++)for(const w of next[q[i]])if(!seen[w]){seen[w]=1;q.push(w);}return seen;};
const from=bfs(index.get(startId));
const cellOf=e=>{const m=e.id.match(/:(-?\d+):(-?\d+)$/);return [Number(m[1]),Number(m[2])];};
// Connected sets of unreachable Piraeus edges (undirected over shared edges), each with its entrances.
const piraeus=i=>{const [x,z]=cellOf(edges[i]);return x<=-13&&z<=11;};
const unreachable=edges.map((e,i)=>i).filter(i=>piraeus(i)&&!from[i]);
const seen=new Set(),comps=[];
for(const s of unreachable){if(seen.has(s))continue;const comp=[],q=[s];seen.add(s);for(let k=0;k<q.length;k++){const i=q[k];comp.push(i);for(const j of [...next[i],...prev[i]])if(!seen.has(j)&&piraeus(j)&&!from[j]){seen.add(j);q.push(j);}}comps.push(comp);}
comps.sort((a,b)=>b.reduce((n,i)=>n+edges[i].length,0)-a.reduce((n,i)=>n+edges[i].length,0));
let shown=0;
for(const comp of comps){const set=new Set(comp),km=comp.reduce((n,i)=>n+edges[i].length,0)/1000;if(shown++>=12)break;
 // entrances: edges outside the set that lead into it; "sources": edges in the set with no predecessor at all (the world's edge)
 const entrances=comp.filter(i=>prev[i].some(p=>!set.has(p))).length,sources=comp.filter(i=>prev[i].length===0);
 const outside=comp.filter(i=>prev[i].some(p=>!set.has(p)&&!from[p]));
 const cells=new Map();for(const i of comp){const c=cellOf(edges[i]).join(',');cells.set(c,(cells.get(c)||0)+1);}
 console.log(km.toFixed(1)+' km',comp.length,'edges','entered from unreachable outside:',outside.length,'dead sources (no predecessor):',sources.length,'sample',edges[comp[0]].id,[...cells.entries()].slice(0,4).map(x=>x.join(':')).join(' '));
 if(sources.length)console.log('   dead source sample',sources.slice(0,3).map(i=>edges[i].id+' '+edges[i].name).join(' | '));
}
console.log('components',comps.length,'unreachable Piraeus km',(unreachable.reduce((n,i)=>n+edges[i].length,0)/1000).toFixed(1));
// Dead sources: is the start of the edge on the boundary of the baked extent (a feeder outside the world) or inside it (a left-out road)?
const baked=new Set(Object.keys((await import('node:fs')).default.existsSync(manifest)?JSON.parse((await import('node:fs')).default.readFileSync(manifest,'utf8')).tiles:{}));
let edge=0,inside=0,edgeKm=0,insideKm=0;const insideSamples=[];
for(const comp of comps){const set=new Set(comp);for(const i of comp.filter(i=>prev[i].length===0)){
 const e=edges[i],[x,y,z]=e.points[0],cx=Math.floor(x/512),cz=Math.floor(z/512);
 const border=[[cx-1,cz,x-cx*512<4],[cx+1,cz,(cx+1)*512-x<4],[cx,cz-1,z-cz*512<4],[cx,cz+1,(cz+1)*512-z<4]].some(([a,b,near])=>near&&!baked.has(a+','+b));
 if(border){edge++;edgeKm+=e.length/1000;}else{inside++;insideKm+=e.length/1000;if(insideSamples.length<12)insideSamples.push(e.id+' '+e.name+' ('+x.toFixed(0)+','+z.toFixed(0)+')');}}}
console.log('dead-source edges on the baked-extent boundary',edge,'; inside the world (a left-out road feeds them)',inside);console.log(insideSamples.join('\n'));
// Of the dead sources inside the world, how many are fed by a restricted (non-public) edge?
const all=[...graph.edges.values()].map(v=>v.value);const intoNode=new Map();for(const e of all){(intoNode.get(e.to)||intoNode.set(e.to,[]).get(e.to)).push(e);}
let fedRestricted=0,fedOther=0,noFeed=0;const other=[];
for(const comp of comps)for(const i of comp.filter(i=>prev[i].length===0)){const e=edges[i];const feeders=intoNode.get(e.from)||[];
 if(feeders.some(f=>f.flags&8))fedRestricted++;else if(feeders.length){fedOther++;other.push(e.id+' <- '+feeders.map(f=>f.id).join(','));}else noFeed++;}
console.log('dead sources: fed by a restricted (non-public) edge',fedRestricted,'| by another edge that cannot be reached/entered',fedOther,'| no edge ends at their start node (road ends there, or a left-out road, or the world edge)',noFeed);console.log(other.slice(0,5).join('\n'));
