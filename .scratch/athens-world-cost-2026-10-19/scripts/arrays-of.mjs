import {readFileSync,readdirSync} from 'node:fs';import {gunzipSync,gzipSync} from 'node:zlib';
import {decodeGeometryPack} from '/home/dev/data/athens-world-cache/w4/app/src/baked-geometry.js';
const dir=process.argv[2],pre=process.argv[3];const f=readdirSync(dir).find(n=>n.startsWith(pre+'-')&&n.endsWith('.gz'));
const raw=gunzipSync(readFileSync(dir+'/'+f));const {metadata:m,arrays}=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const use=new Map();const add=(i,l)=>{if(!use.has(i))use.set(i,[]);use.get(i).push(l);};
m.meshes.forEach((me,k)=>{const nm=`m${k}(mat${me.material},${me.userData?.tileSurface||''}${me.drawRange?' win'+me.drawRange.start/3+'+'+me.drawRange.count/3:''})`;for(const [n,a] of Object.entries(me.attributes))add(a.array,nm+'.'+n);if(me.index!=null)add(me.index,nm+'.idx');});
for(const [n,i] of Object.entries(m.tables))add(i,'T:'+n);
for(const [i,a] of arrays.entries()){const g=gzipSync(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).length;console.log(String(i).padStart(3),a.constructor.name.padEnd(12),String(a.length).padStart(8),String(a.byteLength).padStart(8),'gz~'+String(g).padStart(7),(use.get(i)||[]).slice(0,4).join(' '),(use.get(i)||[]).length>4?'+'+((use.get(i)).length-4):'');}
