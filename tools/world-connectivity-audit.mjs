// Turn-aware drivability audit of a baked world: strongly connected components of
// the directed edge-state graph (a car on edge A may enter edge B only when the
// same legality rule used by routing, GPS and traffic allows it).
// Usage: node tools/world-connectivity-audit.mjs <cells/manifest.json> [report.json]
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {validateWorldTile,validateWorldManifest} from '../src/world-tile-format.js';
import {WorldRoadGraph} from '../src/world-tile-graph.js';

// Same vertical continuity as WorldTileRoads.advance: a bridge never feeds a ground road.
const CONTINUITY=.025;
export function auditConnectivity(graph,{minorIslandMetres=500}={}){
  const edges=[...graph.edges.values()].map(v=>v.value).filter(e=>!(e.flags&8)).sort((a,b)=>a.id<b.id?-1:1);
  const index=new Map(edges.map((e,i)=>[e.id,i]));
  const next=edges.map(e=>{
    const out=[];
    for(const id of graph.outgoing.get(e.to)||[]){
      const n=graph.edges.get(id)?.value;
      if(!n||!index.has(id)||!graph.legal(e.id,n)||Math.abs(n.points[0][1]-e.points.at(-1)[1])>=CONTINUITY)continue;
      out.push(index.get(id));
    }
    return out;
  });
  // Iterative Tarjan: city-scale graphs would overflow the call stack.
  const order=new Int32Array(edges.length).fill(-1),low=new Int32Array(edges.length),onStack=new Uint8Array(edges.length),component=new Int32Array(edges.length).fill(-1),stack=[];
  let counter=0,components=0;
  for(let root=0;root<edges.length;root++){
    if(order[root]>=0)continue;
    const work=[[root,0]];order[root]=low[root]=counter++;stack.push(root);onStack[root]=1;
    while(work.length){
      const frame=work.at(-1),v=frame[0];
      if(frame[1]<next[v].length){
        const w=next[v][frame[1]++];
        if(order[w]<0){order[w]=low[w]=counter++;stack.push(w);onStack[w]=1;work.push([w,0]);}
        else if(onStack[w])low[v]=Math.min(low[v],order[w]);
      }else{
        work.pop();
        if(work.length)low[work.at(-1)[0]]=Math.min(low[work.at(-1)[0]],low[v]);
        if(low[v]===order[v]){let w;do{w=stack.pop();onStack[w]=0;component[w]=components;}while(w!==v);components++;}
      }
    }
  }
  const groups=Array.from({length:components},()=>({edges:0,metres:0,names:new Set(),sample:null,bridges:0}));
  edges.forEach((e,i)=>{const g=groups[component[i]];g.edges++;g.metres+=e.length;if(e.name)g.names.add(e.name);g.sample??=e.id;if(e.layer>0)g.bridges++;});
  groups.sort((a,b)=>b.metres-a.metres);
  const total=edges.reduce((n,e)=>n+e.length,0),main=groups[0]||{edges:0,metres:0};
  const rest=groups.slice(1);
  // Edges that are not in the main component but can reach it (or be reached from it)
  // are one-way spurs, cul-de-sacs and restricted turns; everything else is an island.
  return {
    directedEdges:edges.length,directedKm:total/1000,
    mainComponent:{edges:main.edges,km:main.metres/1000,share:total?main.metres/total:1},
    otherComponents:rest.length,
    minorKm:rest.filter(g=>g.metres<minorIslandMetres).reduce((n,g)=>n+g.metres,0)/1000,
    significant:rest.filter(g=>g.metres>=minorIslandMetres).slice(0,25).map(g=>({edges:g.edges,metres:Math.round(g.metres),sample:g.sample,names:[...g.names].slice(0,4),bridgeEdges:g.bridges})),
    inMain:id=>index.has(id)&&component[index.get(id)]===component[index.get(groups[0]?.sample)]
  };
}
export async function loadWorld(manifestPath,{eligible=true}={}){
  const dir=dirname(resolve(manifestPath)),manifest=validateWorldManifest(JSON.parse(await readFile(manifestPath,'utf8'))),graph=new WorldRoadGraph();
  for(const [key,e] of Object.entries(manifest.tiles)){
    if(eligible&&e.contactEligible===false)continue;
    const raw=gunzipSync(await readFile(resolve(dir,e.url))),pack=validateWorldTile(decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)));
    graph.install(key,pack);
  }
  return {graph,manifest};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {graph}=await loadWorld(process.argv[2]),r=auditConnectivity(graph);delete r.inMain;
  const text=JSON.stringify(r,null,2);if(process.argv[3])await writeFile(process.argv[3],text+'\n');console.log(text);
}
