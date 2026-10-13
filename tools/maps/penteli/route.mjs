// Route follows existing paved EP29 to Agios Petros, then EP5 toward Karakanta.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const elements=JSON.parse(fs.existsSync(path.join(dir,'raw/osm.json'))?fs.readFileSync(path.join(dir,'raw/osm.json')):gunzipSync(fs.readFileSync(path.join(dir,'raw/osm.json.gz')))).elements;
const lat0=38.08,lon0=23.9,phi=lat0*Math.PI/180;
const mlat=111132.92-559.82*Math.cos(2*phi)+1.175*Math.cos(4*phi),mlon=111412.84*Math.cos(phi)-93.5*Math.cos(3*phi);
const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
const ways=elements.filter(e=>e.type==='way'&&e.tags?.highway==='secondary'&&/ΕΠ(29|5)$/.test(e.tags.reg_ref||''));
const adj=new Map(),pos=id=>{const n=nodes.get(id);return [(n.lon-lon0)*mlon,-(n.lat-lat0)*mlat]};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
for(const w of ways){for(let i=1;i<w.nodes.length;i++){const a=w.nodes[i-1],b=w.nodes[i];if(!nodes.has(a)||!nodes.has(b))continue;const d=dist(pos(a),pos(b));for(const[u,v]of[[a,b],[b,a]]){if(!adj.has(u))adj.set(u,[]);adj.get(u).push([v,d,w.id]);}}}
const nearest=ll=>[...adj.keys()].reduce((a,b)=>dist(pos(a),[(ll[1]-lon0)*mlon,-(ll[0]-lat0)*mlat])<dist(pos(b),[(ll[1]-lon0)*mlon,-(ll[0]-lat0)*mlat])?a:b);
function pathTo(a,b){const d=new Map([[a,0]]),prev=new Map(),pending=new Set([a]);while(pending.size){let u=null;for(const id of pending)if(u===null||d.get(id)<d.get(u))u=id;pending.delete(u);if(u===b)break;for(const[v,l,w]of adj.get(u)||[])if(d.get(u)+l<(d.get(v)??Infinity)){d.set(v,d.get(u)+l);prev.set(v,[u,w]);pending.add(v);}}const chain=[b],ids=[];while(chain.at(-1)!==a){const e=prev.get(chain.at(-1));if(!e)throw Error('Disconnected OSM route');chain.push(e[0]);ids.push(e[1]);}return{nodes:chain.reverse(),ways:ids.reverse()};}
const pre=[38.09618,23.89133],start=[38.0944623,23.8940002],fork=[38.0719843,23.9345426],finish=[38.06705,23.90085],end=[38.0643984,23.9000311];
const chain=pathTo(nearest(pre),nearest(end));
// Small Gaussian filter smooths OSM polyline corners without cutting across hairpins.
function sample(points,step){let out=[points[0]],s=0,next=step;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=dist(a,b);while(next<=s+l){const t=(next-s)/l;out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);next+=step;}s+=l;}return out;}
function smooth(points,sigma){const radius=Math.ceil(sigma*3);return points.map((p,i)=>{let x=0,z=0,sum=0;for(let k=-radius;k<=radius;k++){const w=Math.exp(-k*k/(2*sigma*sigma)),q=points[Math.max(0,Math.min(points.length-1,i+k))];x+=q[0]*w;z+=q[1]*w;sum+=w;}return[x/sum,z/sum];});}
const pts=sample(smooth(sample(chain.nodes.map(pos),1),3),2);
const locate=ll=>{const p=[(ll[1]-lon0)*mlon,-(ll[0]-lat0)*mlat];let bi=0;pts.forEach((q,i)=>{if(dist(p,q)<dist(p,pts[bi]))bi=i;});return bi*2;};
const result={proj:{lat0,lon0,mlat,mlon},step:2,start:locate(start),finish:locate(finish),fork:locate(fork),length:(pts.length-1)*2,x:pts.map(p=>+p[0].toFixed(2)),z:pts.map(p=>+p[1].toFixed(2)),sourceWayIds:[...new Set(chain.ways)],sourceNodeIds:chain.nodes};
fs.writeFileSync(path.join(dir,'raw/route.json'),JSON.stringify(result));
const elevationPoints=[];for(let s=0;s<=result.length;s+=24){const i=s/2;elevationPoints.push({s,lat:lat0-result.z[i]/mlat,lon:lon0+result.x[i]/mlon});}if(elevationPoints.at(-1).s!==result.length)elevationPoints.push({s:result.length,lat:lat0-result.z.at(-1)/mlat,lon:lon0+result.x.at(-1)/mlon});
fs.writeFileSync(path.join(dir,'raw/route-points.json'),JSON.stringify(elevationPoints));
console.log({start:result.start,finish:result.finish,length:result.finish-result.start,fork:result.fork,ways:result.sourceWayIds});
