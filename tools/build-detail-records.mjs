// Deterministic additions to cached OSM bundles; never invent point-tree provenance.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {detailSeed,buildingStyle} from '../src/world-detail-policy.js';
import {pointInPoly,polyBounds} from '../src/util.js';
const root=resolve(import.meta.dirname,'..');
const sources={riviera:'data/raw/features.json',psychiko:'tools/maps/psychiko/raw/osm.json.gz'};
for(const id of ['riviera','penteli','megara','psychiko']){
 const path=resolve(root,id==='riviera'?'data/map.json':`data/maps/${id}/map.json`),data=JSON.parse(fs.readFileSync(path)),proj=data.proj;
 const vegetation=[],used=new Set(),roadCells=new Set();
 const mark=(x,z)=>{for(let a=-4;a<=4;a++)for(let b=-4;b<=4;b++)roadCells.add((Math.floor(x/80)+a)+','+(Math.floor(z/80)+b));};
 for(let i=0;i<data.route.x.length;i+=10)mark(data.route.x[i],data.route.z[i]);
 for(const road of data.sideRoads||[])for(let i=0;i<road.p.length;i+=2)mark(road.p[i],road.p[i+1]);
 const add=(x,z,source,kind='broadleaf',height)=>{if(!roadCells.has(Math.floor(x/80)+','+Math.floor(z/80)))return;const key=Math.round(x/3)+','+Math.round(z/3);if(used.has(key))return;used.add(key);vegetation.push({x:+x.toFixed(2),z:+z.toFixed(2),seed:detailSeed(source),kind,...(height?{height}:{}),source});};
 const P=n=>[(n.lon-proj.lon0)*proj.mlon,-(n.lat-proj.lat0)*proj.mlat];
 const area=(poly,source,kind='broadleaf')=>{const bb=polyBounds(poly),seed=detailSeed(source),step=18;
  for(let x=Math.ceil(bb.x0/step)*step;x<bb.x1;x+=step)for(let z=Math.ceil(bb.z0/step)*step;z<bb.z1;z+=step){if(!roadCells.has(Math.floor(x/80)+','+Math.floor(z/80)))continue;const s=detailSeed(seed+':'+x+':'+z),px=x+(s%100)/100*7,pz=z+((s>>>8)%100)/100*7;if(pointInPoly(px,pz,poly))add(px,pz,source+':fill:'+x+':'+z,kind);}
 };
 if(sources[id]){
  let bytes=fs.readFileSync(resolve(root,sources[id]));if(sources[id].endsWith('.gz'))bytes=gunzipSync(bytes);const elements=JSON.parse(bytes).elements,nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
  for(const e of elements){const t=e.tags||{},source=e.type+'/'+e.id,kind=t['leaf_type']==='needleleaved'?'conifer':/palm/i.test(t.genus||t.species||'')?'palm':'broadleaf';
   if(e.type==='node'&&t.natural==='tree')add(...P(e),source,kind,parseFloat(t.height)||undefined);
   if(e.type!=='way')continue;const points=(e.geometry||e.nodes?.map(n=>nodes.get(n))||[]).filter(Boolean).map(P);
   if(t.natural==='tree_row'){for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let d=0;d<len;d+=9)add(a[0]+(b[0]-a[0])*d/len,a[1]+(b[1]-a[1])*d/len,source+':row:'+i+':'+d,kind);}}
   if(points.length>2&&(t.leisure==='garden'||t.leisure==='park'||t.natural==='wood'||t.landuse==='forest'))area(points.flat(),source,kind);
  }
 }
 for(const type of ['park','garden','wood'])for(const a of data.areas?.[type]||[])if(a.c)area(a.p,(a.id?'way/'+a.id:'osm-area/'+id+'/'+type+'/'+detailSeed(a.p.join(','))),type==='wood'?'conifer':'broadleaf');
 for(const b of data.buildings||[]){b.detailSeed=detailSeed('way/'+b.id);b.facadeStyle=buildingStyle(b);}
 data.vegetation=vegetation;fs.writeFileSync(path,JSON.stringify(data));console.log(id,vegetation.length,'OSM-based vegetation records');
}
