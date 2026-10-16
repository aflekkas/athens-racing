import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../../src/baked-geometry.js';
import {validateWorldTile,validateTileSeam} from '../../src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '../../src/world-tile-contact.js';
const root=process.env.WORLD_PROBE_PACK||'/tmp/athens-world-cache/contact-pair-packed';
import {TerrainPosition} from '../../src/terrain-layout.js';
function positions(pack,m){const raw=pack.arrays[m.attributes.position.array],d=m.userData?.terrainDecode;if(!d)return raw;const p=new TerrainPosition(raw,d,pack.arrays[m.attributes.aHeightResidual.array]),out=new Float32Array(raw.length);for(let i=0;i<p.count;i++){out[i*3]=p.getX(i);out[i*3+1]=p.getY(i);out[i*3+2]=p.getZ(i);}return out;}
const entries=JSON.parse(readFileSync(root+'/entries.json')).tiles;
function triangles(p,ix,stride=3){const out=[];for(let i=0;i<ix.length;i+=stride)out.push([0,1,2].map(j=>[...p.slice(ix[i+j]*3,ix[i+j]*3+3)].join(',')).sort().join('|'));return out.sort();}
const tiles=[];let points=0,missing=0,maxGraphError=0,boundaryPending=0;const missingPoints=[];
for(const [key,entry]of Object.entries(entries)){
 const raw=gunzipSync(readFileSync(root+'/'+entry.url.slice(2))),pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
 const {tables:t}=validateWorldTile(pack),index=buildTileContactIndex(t),render=[];
 for(const m of pack.metadata.meshes)if([0,1,8,9].includes(m.material))render.push(...triangles(positions(pack,m),pack.arrays[m.index]));
 render.sort();const contact=triangles(t.contactPositions,t.contactTriangles,5),fine=triangles(t.finePositions,t.fineTriangles);
 if(JSON.stringify(render)!==JSON.stringify(contact)||JSON.stringify(fine)!==JSON.stringify(contact))throw Error('Top equivalence '+key);
 for(let i=0;i<t.edgePoints.length;i+=3){const [x,y,z]=t.edgePoints.slice(i,i+3);if(x===512||z===512){boundaryPending++;continue;}
  points++;const hit=sampleTileContact(t,index,x,z,{referenceY:y,layer:0,requiredFlags:1});if(!hit){missing++;missingPoints.push({key,index:i/3,x,y,z});continue;}maxGraphError=Math.max(maxGraphError,Math.abs(hit.y-y));
 }
 tiles.push({pack,t,index,key,bytes:entry.bytes,triangles:entry.triangles,surfaceTriangles:contact.length,graphEdges:t.edges.length/10});
}
validateTileSeam(tiles[0].pack,tiles[1].pack);
let maxSeamError=0;
for(let z=0;z<512;z+=.25){const a=sampleTileContact(tiles[0].t,tiles[0].index,512-1e-7,z),b=sampleTileContact(tiles[1].t,tiles[1].index,1e-7,z);if(!a||!b)throw Error('Missing seam contact');maxSeamError=Math.max(maxSeamError,Math.abs(a.y-b.y));}
const result={tiles:tiles.map(({key,bytes,triangles,surfaceTriangles,graphEdges})=>({key,bytes,triangles,surfaceTriangles,graphEdges})),topEquivalence:'pass',seamIdentity:'pass',seamSamples:2048,maxSeamError,graphPoints:points,missingGraphContacts:missing,missingPoints,maxGraphError,boundaryPointsRequiringNeighbours:boundaryPending,releaseReady:false};
writeFileSync('.scratch/athens-world/'+(process.env.WORLD_PROBE_PREFIX||'')+'contact-pair-validation.json',JSON.stringify(result,null,2)+'\n');console.log(result);
if(missing||maxGraphError>.005||maxSeamError>.005)throw Error('Contact acceptance failed');
