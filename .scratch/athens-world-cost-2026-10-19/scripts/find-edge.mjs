import {readFileSync,readdirSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '/home/dev/data/athens-world-cache/w4/app/src/baked-geometry.js';
import {tileTables} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-format.js';
const [dir,needle]=process.argv.slice(2);
for(const f of readdirSync(dir).filter(n=>n.endsWith('.gz'))){
 const raw=gunzipSync(readFileSync(dir+'/'+f));const pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));const t=tileTables(pack),m=pack.metadata;
 for(let i=0;i<t.edges.length;i+=10){const id=m.ids[t.edges[i]];if(id.includes(needle))console.log(f.slice(0,8),id,'layer',t.edgeLayers[i/10],'flags',t.edges[i+8],'surface',m.ids[t.edges[i+9]]);}
 for(let i=0;i<t.anchors.length;i+=5){const id=m.ids[t.anchors[i]];if(id.includes(needle))console.log(f.slice(0,8),'anchor',id);}
}
