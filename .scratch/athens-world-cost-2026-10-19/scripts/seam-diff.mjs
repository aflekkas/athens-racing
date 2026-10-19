import {readFileSync} from 'node:fs';
const rows=readFileSync(process.argv[2],'utf8').trim().split('\n').map(l=>JSON.parse(l));
const A=rows.find(r=>r.metadata.cell.join()===process.argv[3]),B=rows.find(r=>r.metadata.cell.join()===process.argv[4]);
const axis=Number(process.argv[5]),va=Number(process.argv[6]),vb=Number(process.argv[7]);
const number=v=>Object.is(v,-0)?'-0':String(v);
function samples(tile,value){const m=tile.metadata,t=tile.tables,out=new Set();const compact=t.fineSurface?.length;
 const sources=[['finePositions',t.fineTriangles,3],...(compact?[['contactPositions',t.fineTriangles,3]]:[]),['contactPositions',t.contactTriangles,5]];
 for(const[name,tr,stride]of sources){const p=t[name]==='x'?null:t[name];const pos=name==='finePositions'?t.finePositions:t.contactPositions;const vertices=new Set(),segments=new Set(),point=id=>`${number(pos[id*3]+m.origin[0])},${number(pos[id*3+2]+m.origin[2])},${number(pos[id*3+1])}`;
  for(let i=0;i<tr.length;i+=stride)for(let e=0;e<3;e++){const a=tr[i+e],b=tr[i+(e+1)%3];if(pos[a*3+axis]===value&&pos[b*3+axis]===value&&(pos[a*3]!==pos[b*3]||pos[a*3+2]!==pos[b*3+2])){vertices.add(a);vertices.add(b);segments.add([point(a),point(b)].sort().join('|'));}}
  for(const s of segments)out.add(`${name}:segment:${s}`);for(const v of vertices){const i=v*3;out.add(`${name}:${number(pos[i]+m.origin[0])},${number(pos[i+2]+m.origin[2])},${number(pos[i+1])}`);}}
 return out;}
const sa=samples(A,va),sb=samples(B,vb);
console.log('A',sa.size,'B',sb.size);
for(const x of sa)if(!sb.has(x))console.log('only A',x);
for(const x of sb)if(!sa.has(x))console.log('only B',x);
console.log('heights equal',JSON.stringify(A.tables.coarseHeights.slice(32*33,33*33))===JSON.stringify(B.tables.coarseHeights.slice(0,33)));
