// What can be driven INTO from the Syntagma start, per district bucket (turn-aware directed reachability).
// node reach-buckets.mjs APP CELLS/manifest.json OUT.json [startEdge]
import {writeFileSync} from 'node:fs';
const [app,manifest,out,startId='osm:way:23182990:2-0:f:0:1']=process.argv.slice(2);
const {loadWorld}=await import(app+'/tools/world-connectivity-audit.mjs');
const {graph}=await loadWorld(manifest);
const edges=[...graph.edges.values()].map(v=>v.value).filter(e=>!(e.flags&8));
const index=new Map(edges.map((e,i)=>[e.id,i]));
for(const e of edges)e.length=e.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-e.points[i][0],p[2]-e.points[i][2]),0);
const next=edges.map(e=>{const o=[];for(const id of graph.outgoing.get(e.to)||[]){const n=graph.edges.get(id)?.value;if(!n||!index.has(id)||!graph.legal(e.id,n)||Math.abs(n.points[0][1]-e.points.at(-1)[1])>=.025)continue;o.push(index.get(id));}return o;});
const bfs=s=>{const seen=new Uint8Array(edges.length),q=[s];seen[s]=1;for(let i=0;i<q.length;i++)for(const w of next[q[i]])if(!seen[w]){seen[w]=1;q.push(w);}return seen;};
const start=index.get(startId);if(start===undefined)throw Error('start edge missing '+startId);
const from=bfs(start);
const cellOf=e=>{const m=e.id.match(/:(-?\d+):(-?\d+)$/);return [Number(m[1]),Number(m[2])];};
const buckets={
 'Piraeus (x<=-13, z<=11)':([x,z])=>x<=-13&&z<=11,
 'Neo Faliro / Tavros / Moschato (-12..-7, z<=10)':([x,z])=>x>=-12&&x<=-7&&z<=10,
 'Faliro / Kallithea coast (-6..-1, z 9..16)':([x,z])=>x>=-6&&x<=-1&&z>=9&&z<=16,
 'Centre: historic (-4..4, z -4..3)':([x,z])=>x>=-4&&x<=4&&z>=-4&&z<=3,
 'Kallithea / Nea Smyrni / Koukaki (z 2..10, x -8..1)':([x,z])=>x>=-8&&x<=1&&z>=2&&z<=10,
 'Kypseli / Patisia (z<=-5)':([x,z])=>z<=-5,
 'Alimos / Elliniko / Glyfada / Riviera (z>=17)':([x,z])=>z>=17,
 'whole world':()=>true};
const rows={};
for(const [name,f] of Object.entries(buckets)){let tot=0,reach=0;edges.forEach((e,i)=>{if(!f(cellOf(e)))return;tot+=e.length;if(from[i])reach+=e.length;});rows[name]={km:Math.round(tot/100)/10,enterableKm:Math.round(reach/100)/10,enterablePercent:Math.round(1000*reach/tot)/10};}
// Of the edges that cannot be entered, how many lie in a strongly connected pocket that is entered only from outside the world?
writeFileSync(out,JSON.stringify({startEdge:startId,edges:edges.length,reachableKm:Math.round(edges.reduce((n,e,i)=>n+(from[i]?e.length:0),0)/100)/10,buckets:rows},null,1)+'\n');
console.log(JSON.stringify(rows,null,1));
