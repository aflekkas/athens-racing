import {readFileSync} from 'node:fs';
import {loadWorld} from '/home/dev/data/athens-world-cache/wt-centre/tools/world-connectivity-audit.mjs';
const {graph}=await loadWorld(process.argv[2]);const blocked=JSON.parse(readFileSync('/tmp/blocked.json','utf8'));
const all=[...graph.edges.values()].map(v=>v.value);
const cellOf=e=>{const m=e.id.match(/:(-?\d+):(-?\d+)$/);return [Number(m[1]),Number(m[2])];};
const isPir=e=>{const [x,z]=cellOf(e);return x<=-13&&z<=11;};
function run(allowRelations){ // edges usable: not flagged 8, OR flagged 8 only because of a relation in allowRelations
  const usable=all.filter(e=>!(e.flags&8)||(blocked[e.id]!==undefined&&allowRelations.has(blocked[e.id])));
  const index=new Map(usable.map((e,i)=>[e.id,i]));
  const next=usable.map(e=>{const out=[];for(const id of graph.outgoing.get(e.to)||[]){const n=graph.edges.get(id)?.value;if(!n||!index.has(id))continue;if((process.env.IGNORE_TURNS?false:!graph.legal(e.id,n))||(process.env.IGNORE_Y?false:Math.abs(n.points[0][1]-e.points.at(-1)[1])>=.025))continue;out.push(index.get(id));}return out;});
  const s=index.get('osm:way:23182990:2-0:f:0:1');const seen=new Uint8Array(usable.length);const q=[s];seen[s]=1;for(let i=0;i<q.length;i++)for(const w of next[q[i]])if(!seen[w]){seen[w]=1;q.push(w);}
  let tot=0,reach=0;usable.forEach((e,i)=>{if(isPir(e)){tot+=e.length;if(seen[i])reach+=e.length;}});return {pir:Math.round(100*reach/tot),km:Math.round(usable.reduce((n,e,i)=>n+(seen[i]?e.length:0),0)/1000)};
}
const rels=[...new Set(Object.values(blocked))];
console.log('baseline (as baked):',JSON.stringify(run(new Set())),' all relations allowed:',JSON.stringify(run(new Set(rels))));
const gains=[];for(const r of rels){const x=run(new Set([r]));gains.push([r,x,Object.values(blocked).filter(v=>v===r).length]);}
gains.sort((a,b)=>b[1].pir-a[1].pir||b[1].km-a[1].km);
for(const g of gains.slice(0,8))console.log(JSON.stringify(g));
