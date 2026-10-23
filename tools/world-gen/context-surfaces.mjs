// Offline source proof only. No import from a runtime entry or ordinary policy.
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeTilePack} from '../../src/world-tile-codec.js';
import {tileTables,validateWorldTile} from '../../src/world-tile-format.js';
const proofs=new WeakMap(),EPS=1e-8;
const hash=b=>createHash('sha256').update(b).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const canonical=v=>JSON.stringify(sorted(v));
const fail=s=>{throw Error('Mapped context: '+s);};

export async function prepareContextCell({compressedBytes,entry,world,revision,cell}){
 if(!entry||compressedBytes.byteLength!==entry.bytes||hash(compressedBytes)!==entry.sha256||!Number.isSafeInteger(entry.decodedBytes)||entry.decodedBytes<12)fail('source SHA/byte budget mismatch');
 if(entry.source&&(entry.source.world!==world||entry.source.revision!==revision))fail('source entry identity mismatch');
 const raw=gunzipSync(compressedBytes,{maxOutputLength:entry.decodedBytes});
 const pack=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),entry.decodedBytes);
 validateWorldTile(pack,{world,revision,cell});
 const m=pack.metadata,t=tileTables(pack),triangles=[];
 const append=(table,vertices,index,stride)=>{
  for(let offset=0;offset<index.length;offset+=stride){const n=offset/stride;
   const owner=table==='contactTriangles'?m.ids[index[offset+3]]:t.fineSurface?m.ids[t.fineSurface[n]]||'terrain:'+cell.join(','):'terrain:'+cell.join(',');
   const flags=table==='contactTriangles'?index[offset+4]:t.fineFlags?.[n]||0;
   const layer=table==='contactTriangles'?t.contactLayers[n]:0;
   const points=[0,1,2].map(k=>[vertices[index[offset+k]*3]+m.origin[0],vertices[index[offset+k]*3+1],vertices[index[offset+k]*3+2]+m.origin[2]]);
   triangles.push({table,triangle:n,owner,layer,drivable:!!(flags&1),points});
  }
 };
 append('fineTriangles',t.finePositions,t.fineTriangles,3);
 append('contactTriangles',t.contactPositions,t.contactTriangles,5);
 const token=Object.freeze({kind:'sealed-context-cell',sourceSha256:entry.sha256});
 proofs.set(token,{world,revision,cell:[...cell],sourceSha256:entry.sha256,triangles});return token;
}

function lineFromWKB(value){
 const b=Buffer.from(value),little=b[0]===1;if(![0,1].includes(b[0])||b.length<9)fail('source line WKB');
 const u=at=>little?b.readUInt32LE(at):b.readUInt32BE(at),d=at=>little?b.readDoubleLE(at):b.readDoubleBE(at);
 const n=u(5);if(u(1)!==2||n<2||b.length!==9+n*16)fail('source must be exact 2D LineString WKB');
 const points=Array.from({length:n},(_,i)=>[d(9+i*16),d(17+i*16)]);
 if(points.flat().some(v=>!Number.isFinite(v)))fail('nonfinite source line');
 const stations=[0];for(let i=1;i<n;i++){const length=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);if(length<=EPS)fail('degenerate source segment');stations.push(stations.at(-1)+length);}
 return {points,stations,length:stations.at(-1)};
}
function requiredCells(line){
 const result=new Set();for(let i=1;i<line.points.length;i++){const a=line.points[i-1],b=line.points[i],cuts=[0,1];
  for(let axis=0;axis<2;axis++)if(Math.abs(b[axis]-a[axis])>EPS)for(let grid=Math.floor(Math.min(a[axis],b[axis])/512)+1;grid*512<Math.max(a[axis],b[axis]);grid++)cuts.push((grid*512-a[axis])/(b[axis]-a[axis]));
  cuts.sort((a,b)=>a-b);for(let k=1;k<cuts.length;k++){const f=(cuts[k-1]+cuts[k])/2;result.add(Math.floor((a[0]+(b[0]-a[0])*f)/512)+','+Math.floor((a[1]+(b[1]-a[1])*f)/512));}
 }return result;
}
function at(line,station){
 let i=0;while(i<line.points.length-2&&station>line.stations[i+1]+EPS)i++;
 const f=(station-line.stations[i])/(line.stations[i+1]-line.stations[i]),a=line.points[i],b=line.points[i+1];
 return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
function weights(points,p){
 const [a,b,c]=points,d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(d)<1e-12)fail('vertical/degenerate support triangle');
 const u=((b[2]-c[2])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[2]))/d,v=((c[2]-a[2])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[2]))/d;return[u,v,1-u-v];
}
const height=(tri,p)=>weights(tri.points,p).reduce((n,w,i)=>n+w*tri.points[i][1],0);
function support(ref,tokens,a,b){
 if(!ref||Array.isArray(ref))fail('missing/ambiguous support owner');
 const candidates=tokens.filter(s=>s.sourceSha256===ref.sourceSha256);if(candidates.length!==1)fail('missing/ambiguous source cell');
 const found=candidates[0].triangles.filter(t=>t.table===ref.table&&t.triangle===ref.triangle&&t.owner===ref.owner&&t.layer===ref.layer);
 if(found.length!==1)fail('support triangle owner mismatch');const triangle=found[0];
 if([a,b].some(p=>weights(triangle.points,p).some(w=>w< -EPS)))fail('support coverage gap');
 // An overlapping triangle of the SAME explicit owner at another height is
 // ambiguous even if the caller supplies a single triangle number.
 for(const other of candidates[0].triangles){if(other===triangle||other.owner!==ref.owner||other.layer!==ref.layer)continue;
  const wa=weights(other.points,a),wb=weights(other.points,b);let range=[0,1];
  for(let k=0;k<3;k++)range=positive(range,wa[k],wb[k],-EPS);
  if(range)for(const f of range){const p=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];if(Math.abs(height(other,p)-height(triangle,p))>1e-6)fail('ambiguous owner elevation');}
 }
 return triangle;
}
function positive(interval,f0,f1,threshold=EPS){
 if(!interval)return null;let[lo,hi]=interval;const d=f1-f0;
 if(Math.abs(d)<1e-14)return f0>threshold?interval:null;
 const cross=(threshold-f0)/d;if(d>0)lo=Math.max(lo,cross);else hi=Math.min(hi,cross);return hi-lo>EPS?[lo,hi]:null;
}
function rejectsRoadIntrusion(sources,a,b){
 const p=[a.x,a.z],q=[b.x,b.z];
 for(const source of sources)for(const tri of source.triangles){if(!tri.drivable)continue;
  const wa=weights(tri.points,p),wb=weights(tri.points,q);let range=[0,1];
  // Strict road interior: a wall on the existing road edge may touch its boundary.
  for(let k=0;k<3;k++)range=positive(range,wa[k],wb[k]);if(!range)continue;
  const ya=height(tri,p),yb=height(tri,q);
  range=positive(range,a.top-ya,b.top-yb);
  range=positive(range,ya+4.5-a.bottom,yb+4.5-b.bottom);
  if(range)fail('road clearance intrusion: '+tri.owner+' triangle '+tri.triangle);
 }
}

/** Compile exact source stations + explicit triangle references; never accepts y guesses. */
export function compileMappedWallProfile({record,geometryBytes,retainedSide,spans},cellProofs){
 if(record.kind!=='retaining_wall'||record.tags?.barrier!=='retaining_wall'||hash(geometryBytes)!==record.geometrySha256)fail('mapped source geometry hash mismatch');
 const {recordSha256,...content}=record;if(hash(canonical(content))!==recordSha256)fail('source record hash mismatch');
 if(!['left','right'].includes(retainedSide))fail('missing retained side');
 const sources=cellProofs.map(p=>{const s=proofs.get(p);if(!s)fail('unsealed source cell');return s;});
 const cells=new Set();for(const s of sources){const key=s.cell.join(',');if(cells.has(key))fail('ambiguous cell identity');cells.add(key);}
 const line=lineFromWKB(geometryBytes);for(const key of requiredCells(line))if(!cells.has(key))fail('uncertified source cell along wall: '+key);if(!Array.isArray(spans)||!spans.length)fail('profile coverage gap');
 const output=[];let end=0;
 for(const span of spans){
  if(!Number.isFinite(span.from+span.to)||Math.abs(span.from-end)>EPS||span.to<=span.from||span.to>line.length+EPS||span.to-span.from>2+EPS)fail('profile coverage gap or >2m span');
  if(line.stations.some(s=>s>span.from+EPS&&s<span.to-EPS))fail('profile skips source bend');
  const a=at(line,span.from),b=at(line,span.to),top=support(span.top,sources,a,b),bottom=support(span.bottom,sources,a,b);
  const endpoint=p=>({x:p[0],z:p[1],top:height(top,p),bottom:height(bottom,p)}),aa=endpoint(a),bb=endpoint(b);
  if([aa,bb].some(p=>!Number.isFinite(p.top+p.bottom)||p.top-p.bottom<=EPS))fail('inverted/zero wall profile');
  const cx=Math.floor((a[0]+b[0])/2/512),cz=Math.floor((a[1]+b[1])/2/512);
  if(!cells.has(cx+','+cz))fail('uncertified source cell along wall');
  rejectsRoadIntrusion(sources,aa,bb);
  output.push({from:span.from,to:span.to,a:aa,b:bb,top:{...span.top},bottom:{...span.bottom}});end=span.to;
 }
 if(Math.abs(end-line.length)>EPS)fail('profile end coverage gap');
 const certificate={schemaVersion:1,kind:'certified-mapped-wall-profile',releaseEligible:false,recordSha256,geometrySha256:record.geometrySha256,retainedSide,
  sources:sources.map(({world,revision,cell,sourceSha256})=>({world,revision,cell,sourceSha256})),spans:output};
 const bytes=Buffer.from(canonical(certificate));return{bytes,sha256:hash(bytes),triangles:output.length*2,arrayBytes:output.length*60};
}

export function compileStructureBoundaries({sourceGraphSha256,nodes},cellProofs){
 if(!/^[a-f0-9]{64}$/.test(sourceGraphSha256)||!nodes||!Object.keys(nodes).length)fail('missing source graph/boundary nodes');
 const sources=cellProofs.map(p=>{const s=proofs.get(p);if(!s)fail('unsealed source cell');return s;}),result={};
 for(const[id,node]of Object.entries(nodes)){
  if(!id||!Number.isFinite(node.x+node.z))fail('nonfinite boundary coordinate');
  const p=[node.x,node.z],triangle=support(node.support,sources,p,p);
  result[id]={x:node.x,z:node.z,y:height(triangle,p),support:{...node.support}};
 }
 const value={schemaVersion:1,kind:'certified-structure-boundaries',releaseEligible:false,sourceGraphSha256,
  sources:sources.map(({world,revision,cell,sourceSha256})=>({world,revision,cell,sourceSha256})),nodes:result};
 const bytes=Buffer.from(canonical(value));return{bytes,sha256:hash(bytes)};
}
