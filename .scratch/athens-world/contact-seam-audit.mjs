import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../../src/baked-geometry.js';
import {tileEdgeSignatures} from '../../src/world-tile-format.js';
const root='/tmp/athens-world-cache/contact-pair-packed';
const packs=readdirSync(root).filter(f=>f.endsWith('.bin.gz')).sort().map(f=>{const b=gunzipSync(readFileSync(root+'/'+f));return decodeGeometryPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));});
const [a,b]=packs.map((p,i)=>JSON.parse(tileEdgeSignatures(p)[i?0:1]));
const result={coarseDifferences:a[0].flatMap((v,i)=>v===b[0][i]?[]:[{i,a:v,b:b[0][i]}]),onlyLeft:a[1].filter(v=>!b[1].includes(v)),onlyRight:b[1].filter(v=>!a[1].includes(v))};
writeFileSync('.scratch/athens-world/contact-seam-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
