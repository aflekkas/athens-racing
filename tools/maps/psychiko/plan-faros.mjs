// Reviewed street-by-street Faros course. Restrict each leg to its real named OSM ways, then freeze every edge.
import fs from 'node:fs';
import {loadPsychikoOsm} from './corrections.mjs';
import {publicRoad} from './neighbourhood.mjs';
const elements=loadPsychikoOsm(),nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e])),ways=elements.filter(publicRoad);
const legs=[
 ['Faros → A square / 25is Martiou',1285491927,272554605,[465224134,661584002,62331516,25053095]],
 ['Diamantidou → B square',272554605,2410035768,[661583999,25048553,661583995,978004329,25053533,978004332]],
 ['Diamantidou → Nikiforou Lytra',2410035768,351946933,[661542255,717372565,717372563,246198210]],
 ['Left Achillea Paraschou',351946933,351946928,[97722998]],
 ['Dryadon / Pavlou Mela → Davaki',351946928,351947552,[97723002,31486851]],
 ['Davaki; left then right Venizelou',351947552,351949741,[193169557,545649903,723515844,661213890,723515845,661214619]],
 ['CCW Venizelou square → 25is Martiou',351949741,351951840,[31486843,31486918,723515852]],
 ['25is Martiou; CCW Georgiou Stavrou square',351951840,347780192,[661217862,470144907,31270163,661217864]],
 ['Sharp right Bizaniou → Benaki',347780192,6193531310,[97723004,31270138,545646475]],
 ['Right Areaki → Michalakopoulou square',6193531310,272554977,[25053494,634346640,978004314]],
 ['Malakasi → left Stratigou Kallari',272554977,272554942,[25048567,545646476,545646479,468238645,25053123]],
 ['Left Elikonos → Kifisias light',272554942,7229011616,[469423418,465205391]],
 ['Right Kifisias southbound → surface Faros',7229011616,1285491927,[662139350,216905683,664440151,465205389,476108293,113339579,371561413]],
];
const chain=[],edgeWays=[],stations=[];
for(const [name,from,to,ids] of legs){const graph=new Map();for(const w of ways.filter(w=>ids.includes(w.id))){if(w.tags.tunnel==='yes'||w.tags.bridge==='yes'||Number(w.tags.layer))throw Error('Grade-separated course');for(let k=1;k<w.nodes.length;k++){const a=w.nodes[k-1],b=w.nodes[k],A=nodes.get(a),B=nodes.get(b),d=Math.hypot((B.lat-A.lat)*111132,(B.lon-A.lon)*87700);const add=(a,b)=>{if(!graph.has(a))graph.set(a,[]);graph.get(a).push({b,w:w.id,d});};if(w.tags.oneway!=='-1')add(a,b);if(!['yes','1','true'].includes(w.tags.oneway)&&w.tags.junction!=='roundabout')add(b,a);}}
 const best=new Map([[from,0]]),prev=new Map(),queue=[from];while(queue.length){queue.sort((a,b)=>best.get(a)-best.get(b));const a=queue.shift();if(a===to)break;for(const e of graph.get(a)||[]){const d=best.get(a)+e.d;if(d<(best.get(e.b)??Infinity)){best.set(e.b,d);prev.set(e.b,{a,w:e.w});if(!queue.includes(e.b))queue.push(e.b);}}}if(!prev.has(to))throw Error('No legal path: '+name);
 const ns=[to],ws=[];for(let b=to;b!==from;){const p=prev.get(b);ns.push(p.a);ws.push(p.w);b=p.a;}ns.reverse();ws.reverse();chain.push(...(chain.length?ns.slice(1):ns));edgeWays.push(...ws);stations.push(from);console.log(name,[...new Set(ws)],Math.round(best.get(to))+' m');
}
if(new Set(chain.slice(0,-1)).size!==chain.length-1)throw Error('Course repeats a node');
const result={description:'Faros Circuit v3 (2026-10-19). Reviewed OSM surface course; legal forward edges only. See SOURCES.md for naming and Faros surface-junction decisions.',startOffset:-16,nodes:chain,edgeWays,stations,legs:legs.map(([name,from,to])=>({name,from,to}))};
fs.writeFileSync(new URL('./raw/drawn-course.json',import.meta.url),JSON.stringify(result));
