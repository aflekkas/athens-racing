import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '/home/dev/data/athens-world-cache/w4/app/src/baked-geometry.js';
import {prepareTilePacket} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-worker.js';
import {validateWorldTile,residentArrayBytes} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-format.js';
import {buildTileObstacleIndex,obstacleBytes} from '/home/dev/data/athens-world-cache/w4/app/src/world-tile-obstacles.js';
const root=process.argv[2];const m=JSON.parse(readFileSync(root+'/manifest.json'));
for(const [k,e] of Object.entries(m.tiles)){
  let raw;try{raw=gunzipSync(readFileSync(e.url.startsWith('./')?root+'/'+e.url.slice(2):root+e.url));}catch{continue;}
  const pack=decodeGeometryPack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  const cell=k.split(',').map(Number);
  const pk=prepareTilePacket(pack,{entry:e,world:m.world,revision:m.revision,cell});
  const arrays=residentArrayBytes(pack.arrays),gpu=pk.gpuBytes,ci=pk.contactIndex.offsets.byteLength+pk.contactIndex.refs.byteLength,ob=obstacleBytes(pk.obstacleIndex);
  console.log(k.padEnd(7),'resident',(e.residentBytes/1e6).toFixed(2),'MB | arrays',(arrays/1e6).toFixed(2),'gpu',(gpu/1e6).toFixed(2),'contactIndex',(ci/1e6).toFixed(2),'obstacles',(ob/1e6).toFixed(2),'json',((pk.bytes-arrays-gpu-ci-ob)/1e6).toFixed(2),'| compressed',(e.bytes/1e6).toFixed(2),'decoded',(e.decodedBytes/1e6).toFixed(1),'tri',e.triangles);
}
