import {loadWorld} from '/home/dev/data/athens-world-cache/wt-centre/tools/world-connectivity-audit.mjs';
const {graph}=await loadWorld(process.argv[2]);
const edges=[...graph.edges.values()].map(v=>v.value).filter(e=>!(e.flags&8));
const index=new Map(edges.map((e,i)=>[e.id,i]));
const next=edges.map(e=>{const out=[];for(const id of graph.outgoing.get(e.to)||[]){const n=graph.edges.get(id)?.value;if(!n||!index.has(id)||!graph.legal(e.id,n)||Math.abs(n.points[0][1]-e.points.at(-1)[1])>=.025)continue;out.push(index.get(id));}return out;});
const bfs=(s)=>{const seen=new Uint8Array(edges.length);const q=[s];seen[s]=1;for(let i=0;i<q.length;i++)for(const w of next[q[i]])if(!seen[w]){seen[w]=1;q.push(w);}return seen;};
const main=index.get(process.argv[3]),pir=index.get(process.argv[4]);
const fromMain=bfs(main),fromPir=bfs(pir);
const km=(seen)=>edges.reduce((n,e,i)=>n+(seen[i]?e.length:0),0)/1000;
console.log(JSON.stringify({mainReachesPiraeus:!!fromMain[pir],piraeusReachesMain:!!fromPir[main],reachableFromMainKm:Math.round(km(fromMain)),reachableFromPiraeusKm:Math.round(km(fromPir)),totalKm:Math.round(km(new Uint8Array(edges.length).fill(1)))}));
// connectors: edges leaving the not-reachable-from-main set into the reachable one
const all=[...graph.edges.values()].map(v=>v.value);
const byId=new Map(all.map(e=>[e.id,e]));
const rev=id=>id.replace(/:([fb]):(-?\d+):(-?\d+)$/,(m,d,x,z)=>':'+(d==='f'?'b':'f')+':'+x+':'+z);
const out=[];
edges.forEach((e,i)=>{if(fromMain[i])return;for(const w of next[i])if(fromMain[w]){const r=byId.get(rev(e.id));out.push({id:e.id,name:e.name,to:edges[w].id,toName:edges[w].name,reverseExists:!!r,reverseBlocked:r?!!(r.flags&8):null,layer:e.layer});}});
console.log('exit connectors (not reachable from main -> reachable):',out.length);
for(const c of out.slice(0,25))console.log(JSON.stringify(c));
// also: edges leaving R into P-side nodes would be none. Print edges in R adjacent to P nodes (shared node, both directions) 
const nodeIn=new Map();edges.forEach((e,i)=>{if(!fromMain[i]){nodeIn.set(e.from,1);}});
const adj=[];edges.forEach((e,i)=>{if(fromMain[i]&&nodeIn.has(e.to))adj.push(e.id)});console.log('edges in main-reachable set ending at a node where non-reachable edges start:',adj.length);
const cellOf=e=>{const m=e.id.match(/:(-?\d+):(-?\d+)$/);return [Number(m[1]),Number(m[2])];};
const buckets={'Piraeus (x<=-13, z<=11)':e=>{const [x,z]=cellOf(e);return x<=-13&&z<=11;},'Neo Faliro/Tavros/Moschato (-12..-7, z<=10)':e=>{const [x,z]=cellOf(e);return x>=-12&&x<=-7&&z<=10;},'Faliro/Kallithea coast (-6..-1, z 9..16)':e=>{const [x,z]=cellOf(e);return x>=-6&&x<=-1&&z>=9&&z<=16;},'Centre (x -4..4, z -3..8)':e=>{const [x,z]=cellOf(e);return x>=-4&&x<=4&&z>=-3&&z<=8;},'Alimos/Elliniko (z 17..24)':e=>{const [x,z]=cellOf(e);return z>=17&&z<=24;},'Glyfada..Riviera (z>=25)':e=>{const [x,z]=cellOf(e);return z>=25;}};
for(const [name,f] of Object.entries(buckets)){let tot=0,reach=0,fromP=0;edges.forEach((e,i)=>{if(!f(e))return;tot+=e.length;if(fromMain[i])reach+=e.length;if(fromPir[i])fromP+=e.length;});console.log(name,'km',Math.round(tot/1000),'enterable from Syntagma',Math.round(100*reach/tot)+'%','from Piraeus',Math.round(100*fromP/tot)+'%');}
console.log('--- why edges of the main-reachable set cannot continue into unreachable ones');
const reasons={};const samples=[];
edges.forEach((e,i)=>{if(!fromMain[i])return;for(const id of graph.outgoing.get(e.to)||[]){const n=graph.edges.get(id)?.value;if(!n)continue;const j=index.get(id);if(j===undefined){ // blocked flag edge
 if(n.flags&8){reasons['target edge blocked (flag 8)']=(reasons['target edge blocked (flag 8)']||0)+1;}continue;}
 if(fromMain[j])continue;
 const legal=graph.legal(e.id,n),dy=Math.abs(n.points[0][1]-e.points.at(-1)[1]);
 const why=!legal?'turn prohibited':dy>=.025?'height step '+(dy>=1?'>=1 m':'>=2.5 cm'):'??';reasons[why]=(reasons[why]||0)+1;if(samples.length<14)samples.push([why,e.id,e.name,n.id,n.name,Math.round(dy*100)/100]);}});
console.log(JSON.stringify(reasons));for(const s of samples)console.log(JSON.stringify(s));
