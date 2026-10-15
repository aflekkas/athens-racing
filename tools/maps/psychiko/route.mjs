// Directed OSM asphalt graph: a simple public-road loop through Palaio Psychiko.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('./',import.meta.url));
const elements=JSON.parse(gunzipSync(fs.readFileSync(dir+'raw/osm.json.gz'))).elements;
const lat0=38.009,lon0=23.775,phi=lat0*Math.PI/180;
const mlat=111132.92-559.82*Math.cos(2*phi)+1.175*Math.cos(4*phi),mlon=111412.84*Math.cos(phi)-93.5*Math.cos(3*phi);
const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
const ways=new Map(elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
const pos=id=>{const n=nodes.get(id);return[(n.lon-lon0)*mlon,-(n.lat-lat0)*mlat];},dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const adj=new Map();
for(const w of ways.values()){
 const t=w.tags||{};
 if(!['tertiary','residential','unclassified','living_street'].includes(t.highway)||!['asphalt','paved','paving_stones','sett'].includes(t.surface)||['private','no'].includes(t.access)||['private','no'].includes(t.motor_vehicle))continue;
 for(let i=1;i<w.nodes.length;i++){
  const a=w.nodes[i-1],b=w.nodes[i];if(!nodes.has(a)||!nodes.has(b))continue;
  for(const[u,v]of [...(t.oneway==='-1'?[]:[[a,b]]),...(['yes','1'].includes(t.oneway)?[]:[[b,a]])]){
   if(!adj.has(u))adj.set(u,[]);adj.get(u).push([v,dist(pos(a),pos(b)),w.id]);
  }
 }
}
function pathTo(a,b){const d=new Map([[a,0]]),prev=new Map(),pending=new Set([a]);while(pending.size){let u=null;for(const id of pending)if(u===null||d.get(id)<d.get(u))u=id;pending.delete(u);if(u===b)break;for(const[v,l,w]of adj.get(u)||[])if(d.get(u)+l<(d.get(v)??Infinity)){d.set(v,d.get(u)+l);prev.set(v,[u,w]);pending.add(v);}}const chain=[b],ids=[];while(chain.at(-1)!==a){const e=prev.get(chain.at(-1));if(!e)throw Error('Disconnected paved OSM route');chain.push(e[0]);ids.push(e[1]);}return{nodes:chain.reverse(),ways:ids.reverse()};}
// All via points are actual road junctions, not approximate place-name coordinates.
const vias=[272499400,272560814,272554949,347783946,1285491847,272499400];
const chain=[],edgeWays=[];
for(let i=1;i<vias.length;i++){const q=pathTo(vias[i-1],vias[i]);chain.push(...q.nodes.slice(0,-1));edgeWays.push(...q.ways);}
if(new Set(chain).size!==chain.length)throw Error('Circuit repeats an OSM road node');chain.push(chain[0]);
function sample(points,step){const out=[points[0]];let s=0,next=step;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=dist(a,b);while(next<s+l){const t=(next-s)/l;out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);next+=step;}s+=l;}return out;}
const dense=sample(chain.map(pos),1),smooth=dense.map((_,i)=>{let x=0,z=0,sum=0;for(let k=-9;k<=9;k++){const w=Math.exp(-k*k/18),p=dense[(i+k+dense.length)%dense.length];x+=p[0]*w;z+=p[1]*w;sum+=w;}return[x/sum,z/sum];});
smooth.push(smooth[0]);const total=smooth.slice(1).reduce((s,p,i)=>s+dist(p,smooth[i]),0),count=Math.round(total/2),step=total/count;
const pts=sample(smooth,step).slice(0,count);pts.push(pts[0]);
const locate=id=>{const p=pos(id);let j=0;pts.forEach((q,i)=>{if(dist(p,q)<dist(p,pts[j]))j=i;});return +(j*step).toFixed(2);};
const ordered=[];edgeWays.forEach((id,i)=>{if(i===0||id!==edgeWays[i-1])ordered.push({id,name:ways.get(id).tags.int_name||ways.get(id).tags.name||'Unnamed paved junction',from:chain[i],to:chain[i+1]});else ordered.at(-1).to=chain[i+1];});
const names=ordered.map(w=>({s:locate(w.from),name:w.name})).sort((a,b)=>a.s-b.s);
const result={proj:{lat0,lon0,mlat,mlon},step,start:0,finish:total,length:total,x:pts.map(p=>+p[0].toFixed(2)),z:pts.map(p=>+p[1].toFixed(2)),names,sourceWayIds:[...new Set(edgeWays)],orderedWays:ordered,sourceNodeIds:chain,stations:vias.slice(0,-1).map(id=>({id,s:locate(id),lat:nodes.get(id).lat,lon:nodes.get(id).lon}))};
fs.writeFileSync(dir+'raw/route.json',JSON.stringify(result));
const elevationPoints=[];for(let i=0;i<pts.length;i+=12)elevationPoints.push({s:i*step,lat:lat0-result.z[i]/mlat,lon:lon0+result.x[i]/mlon});elevationPoints.push({s:total,lat:lat0-result.z[0]/mlat,lon:lon0+result.x[0]/mlon});
fs.writeFileSync(dir+'raw/route-points.json',JSON.stringify(elevationPoints));
console.log({length:total,ways:ordered.map(w=>w.id),stations:result.stations});
