import {readFileSync,readdirSync} from 'node:fs';import {gunzipSync,gzipSync} from 'node:zlib';
import {decodeGeometryPack} from '/home/dev/data/athens-world-cache/w4/app/src/baked-geometry.js';
const dir=process.argv[2];const files=readdirSync(dir).filter(f=>f.endsWith('.bin.gz'));
const total={};let rawAll=0,gzAll=0,fileAll=0;
for(const f of files){
  const gz=readFileSync(dir+'/'+f);fileAll+=gz.length;const raw=gunzipSync(gz);const {metadata:m,arrays}=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  const role=new Map();
  m.meshes.forEach((mesh,i)=>{const mat=mesh.material;const kind=mesh.userData?.tileSurface||(mat===0?'ground':(mat>=2&&mat<=7)?'building':mat===8?'paving/underside/rail':mat===9?'kerb':mat===11?'marking':mat===16?'water':'mat'+mat);
    for(const [name,a] of Object.entries(mesh.attributes))role.set(a.array,`mesh:${kind}:${name}`);role.set(mesh.index,`mesh:${kind}:index`);});
  for(const [name,idx] of Object.entries(m.tables))role.set(idx,`table:${name}`);
  for(const [name,ex] of Object.entries(m.extensions||{}))for(const [g,v] of Object.entries(ex))if(typeof v==='object')for(const [k,x] of Object.entries(v))if(typeof x==='number')role.set(x,`ext:${name}.${g}.${k}`);
  const jsonBytes=JSON.stringify({version:1,...m}).length;
  const per=new Map();
  arrays.forEach((a,i)=>{const r=(role.get(i)||'?:array'+i).replace(/^(mesh:[^:]+):(position|color|normal|index).*/,'$1:$2');const w=a.BYTES_PER_ELEMENT,b=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
    const sh=new Uint8Array(a.byteLength);for(let k=0;k<w;k++)for(let n=0;n<a.length;n++)sh[k*a.length+n]=b[n*w+k];
    const g=gzipSync(sh,{level:9}).length;const e=per.get(r)||{raw:0,gz:0,n:0};e.raw+=a.byteLength;e.gz+=g;e.n+=a.length;per.set(r,e);});
  for(const [r,e] of per){const t=total[r]||(total[r]={raw:0,gz:0,n:0});t.raw+=e.raw;t.gz+=e.gz;t.n+=e.n;}
  total['json metadata']??={raw:0,gz:0,n:0};total['json metadata'].raw+=jsonBytes;total['json metadata'].gz+=gzipSync(Buffer.from(JSON.stringify({version:1,...m})),{level:9}).length;
  rawAll+=raw.length;
}
const rows=Object.entries(total).sort((a,b)=>b[1].gz-a[1].gz);
console.log('cells',files.length,'file bytes',fileAll,'decoded raw',rawAll);
for(const [r,e] of rows.slice(0,34))console.log(r.padEnd(40),String(e.raw).padStart(10),'raw',String(e.gz).padStart(9),'gz',(100*e.gz/fileAll).toFixed(1)+'%',String(e.n).padStart(9),'elts');
