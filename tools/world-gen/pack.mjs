// Stream one tile at a time through the authoritative AWT validator and shared codec.
// Input is an offline NDJSON spool: {metadata, tables:{name:number[]}, arrays:[{type,data}]}.
// Mesh array indexes refer to `arrays` (tables are appended after them).
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeGeometryPack, decodeGeometryPack } from '../../src/baked-geometry.js';
import {prepareTilePacket} from '../../src/world-tile-worker.js';
import { auditBridgeGuards } from '../world-bridge-audit.mjs';
import { auditWorldSurface } from '../world-surface-audit.mjs';
import { auditRoadSections } from '../world-roads-audit.mjs';
import { TILE_TABLES, TILE_COMPACT_TABLES, validateWorldTile, tileEdgeSignatures, legacyTables } from '../../src/world-tile-format.js';
/** Total compressed size a world may reach. Owner decision 2026-10-19 (docs/OWNER-DECISIONS.md): raised from 192 MiB to 2 GiB.
 * The player-side limits are separate and unchanged: 15 MiB initial download, 64 MiB worst 2x2 set, 64 MiB stream, R2 staging <= 5 GB. */
export const WORLD_CEILING_BYTES = 2 * 1024 ** 3;
const types = { Int8Array, Uint8Array, Uint16Array, Uint32Array, Float32Array };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function typed(type, values) {
  const Type = types[type];
  if (!Type || !Array.isArray(values)) throw new Error('Unknown array type/data');
  const array = new Type(values);
  for (let i=0;i<values.length;i++) {
    if (!Number.isFinite(values[i]) || !Number.isFinite(array[i]) || (type !== 'Float32Array' && array[i] !== values[i])) throw new Error('Array value overflow');
  }
  return array;
}
export function encodeTile(input) {
  const arrays = (input.arrays ?? []).map(a => typed(a.type,a.data));
  // Keep supplied mesh indexes stable. Intern table buffers against those
  // arrays and earlier tables: fine/contact positions often share every byte.
  const key = a => a.constructor.name+':'+a.byteLength+':'+digest(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
  const intern = new Map();
  arrays.forEach((a,i)=>{const hash=key(a);if(!intern.has(hash))intern.set(hash,i);});
  const tables = {};
  for (const [name,[type]] of [...Object.entries(TILE_TABLES),...Object.entries(TILE_COMPACT_TABLES).filter(([k])=>input.tables[k]?.length)]) {
    const array=typed(type,input.tables[name]),hash=key(array);
    if(!intern.has(hash)){intern.set(hash,arrays.length);arrays.push(array);}
    tables[name]=intern.get(hash);
  }
  const metadata = {...input.metadata,tables};
  validateWorldTile({metadata,arrays});
  // Shared ASR1 byte planes are lossless. Shuffle even byte-wide arrays so
  // decoding gives them independent buffers instead of retaining the raw pack.
  const bytes = gzipSync(new Uint8Array(encodeGeometryPack(metadata,arrays,arrays.map(()=>true))),{level:9,mtime:0});
  // Validate the decoded wire representation too, including Float32 rounding.
  const raw = new Uint8Array(gunzipSync(bytes));
  const decoded = decodeGeometryPack(raw.buffer);
  const checked = validateWorldTile(decoded);
  return {bytes,checked,decoded};
}
export async function packTiles(path, output,{onTile=null,maxBytes=Infinity}={}) {
  await mkdir(output,{recursive:true});
  const entries={}, seams=new Map(),failures=[],keepGoing=!!process.env.ATHENS_KEEP_GOING;let identity,totalBytes=0;
  for await (const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})) {
    if (!line.trim()) continue;
    const input=JSON.parse(line);let encoded;
    try{encoded=encodeTile(input);}catch(e){if(!keepGoing)throw e;failures.push({cell:input.metadata?.cell,error:e.message.slice(0,300)});continue;}
    const {bytes,checked,decoded}=encoded,m=checked.metadata,key=m.cell.join(',');
    let physical,bridges,roads;
    try{
    physical=auditWorldSurface(checked.tables,checked.metadata);
    bridges=auditBridgeGuards(checked.tables,m);
    roads=m.roadSections?auditRoadSections(m):null;
    if(roads&&!roads.passed)throw new Error('Road cross-section gate failed '+key+': '+JSON.stringify(roads.problems));
    if(!bridges.passed)throw new Error('Bridge guard/headroom/anchor gate failed '+key+': '+JSON.stringify(bridges));
    if(!physical.passed)throw new Error('Physical surface acceptance failed '+key+': '+JSON.stringify(physical));
    }catch(e){if(!keepGoing)throw e;failures.push({cell:m.cell,error:e.message.slice(0,400),offenders:physical?.offenders||[]});console.error('KEEP-GOING failure',key,e.message.slice(0,200));continue;}
    const nextIdentity=m.world+':'+m.revision;
    if (identity && identity!==nextIdentity) throw new Error('Mixed world/revision');
    identity=nextIdentity;
    if (entries[key]) throw new Error('Duplicate tile '+key);
    if(bytes.length>25*1024*1024) throw new Error('Tile exceeds 25 MiB');
    totalBytes+=bytes.length;if(totalBytes>maxBytes)throw new Error('Compressed world exceeds approved asset ceiling');
    const sha256=digest(bytes),name=`${m.cell.join('-')}-${sha256}.bin.gz`;
    // A conservative startup reservation includes codec bytes, contact indexes,
    // duplicated render attributes and GPU storage; runtime reports actual residency.
    const decodedBytes=bytes.length+checked.bytes*5+JSON.stringify(m).length*4+65536;
    const packet=prepareTilePacket(decoded,{entry:{decodedBytes,triangles:checked.triangles},world:m.world,revision:m.revision,cell:m.cell});
    const residentBytes=Math.ceil(packet.bytes*1.25),transientBytes=decodedBytes*2+bytes.length;
    entries[key]={url:'./'+name,sha256,bytes:bytes.length,decodedBytes,residentBytes,transientBytes,
      dependencies:input.dependencies??[],triangles:checked.triangles};
    seams.set(key,tileEdgeSignatures(decoded).map(digest));
    const [cx,cz]=m.cell,signature=seams.get(key);
    for(const [other,side,opposite]of [[`${cx-1},${cz}`,0,1],[`${cx+1},${cz}`,1,0],[`${cx},${cz-1}`,2,3],[`${cx},${cz+1}`,3,2]])if(seams.has(other)&&signature[side]!==seams.get(other)[opposite]){if(!keepGoing)throw Error(`Cracked seam ${key}/${other}`);failures.push({cell:m.cell,error:`Cracked seam ${key}/${other}`,offenders:[]});}
    await writeFile(join(output,name+'.partial'),bytes);
    await rename(join(output,name+'.partial'),join(output,name));
    await onTile?.({key,entry:entries[key],physical,bridges,roads,decoded,packet,seams:seams.get(key)});
  }
  if(!seams.size){if(failures.length)throw Object.assign(new Error('Gate failures in '+failures.length+' cells: '+JSON.stringify(failures)),{failures});throw new Error('No tiles');}  // every cell failed: still report which, so plan-steep can read them
  for (const [key,a] of seams) {
    const [x,z]=key.split(',').map(Number);
    for (const [other,side,opposite] of [[`${x+1},${z}`,1,0],[`${x},${z+1}`,3,2]]) {
      if (seams.has(other) && a[side]!==seams.get(other)[opposite] && !keepGoing) throw new Error(`Cracked seam ${key}/${other}`);
    }
  }
  // An entries file is deliberately not a playable manifest: the caller still
  // needs conformance/contact/coverage proofs, provenance and a validated spawn.
  await writeFile(join(output,'entries.json.partial'),JSON.stringify({identity,tiles:entries},null,2)+'\n');
  await rename(join(output,'entries.json.partial'),join(output,'entries.json'));
  if(failures.length)throw Object.assign(new Error('Gate failures in '+failures.length+' cells: '+JSON.stringify(failures)),{failures});
  return entries;
}
if (process.argv[1]===import.meta.filename) {
  const entries=await packTiles(resolve(process.argv[2]),resolve(process.argv[3]));
  console.log(JSON.stringify({tiles:Object.keys(entries).length,bytes:Object.values(entries).reduce((n,e)=>n+e.bytes,0)}));
}
