import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../../src/baked-geometry.js';
import {validateWorldTile} from '../../src/world-tile-format.js';
const root='/tmp/athens-world-cache/contact-probe-packed';
const entry=Object.values(JSON.parse(readFileSync(root+'/entries.json')).tiles)[0];
const raw=gunzipSync(readFileSync(root+'/'+entry.url.slice(2)));
const pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const {tables:t}=validateWorldTile(pack);
function triangles(positions,indices,stride=3){
 const out=[];
 for(let i=0;i<indices.length;i+=stride){
  out.push([0,1,2].map(j=>Array.from(positions.slice(indices[i+j]*3,indices[i+j]*3+3)).join(',')).sort().join('|'));
 }
 return out.sort();
}
const contact=triangles(t.contactPositions,t.contactTriangles,5),fine=triangles(t.finePositions,t.fineTriangles),render=[];
for(const m of pack.metadata.meshes){
 if(![0,1,8,9].includes(m.material))continue;
 render.push(...triangles(pack.arrays[m.attributes.position.array],pack.arrays[m.index]));
}
render.sort();
if(JSON.stringify(contact)!==JSON.stringify(fine)||JSON.stringify(contact)!==JSON.stringify(render))throw Error('Rendered/contact/fine top mismatch');
const result={cell:pack.metadata.cell,surfaceTriangles:contact.length,renderContactFineExact:true,compressedBytes:entry.bytes,scope:'Top surfaces only. Vertical kerbs, structures, seam/grade coverage and graph contacts require separate validation.'};
writeFileSync('.scratch/athens-world/contact-equivalence.json',JSON.stringify(result,null,2)+'\n');console.log(result);
