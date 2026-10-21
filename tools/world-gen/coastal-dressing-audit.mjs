// Audit the optional coastal dressing against the exact immutable source cells.
// Usage: node tools/world-gen/coastal-dressing-audit.mjs MANIFEST CELL_DIR REPORT
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeTilePack} from '../../src/world-tile-codec.js';
import {prepareTilePacket} from '../../src/world-tile-worker.js';
import {tileTables} from '../../src/world-tile-format.js';
import {auditRockBores} from '../world-bore-audit.mjs';
import {COASTAL_DRESSING} from '../../src/coastal-dressing-data.js';
const [manifestPath,cellDir,reportPath]=process.argv.slice(2);
if(!reportPath)throw Error('Expected MANIFEST CELL_DIR REPORT');
const manifest=JSON.parse(await fs.readFile(manifestPath)),rows=[];
for(const key of Object.keys(COASTAL_DRESSING.cells).sort()){
 const entry=manifest.tiles[key];if(!entry)throw Error('Scenery outside physical world: '+key);
 const compressed=await fs.readFile(resolve(cellDir,entry.sha256+'.bin.gz'));
 if(createHash('sha256').update(compressed).digest('hex')!==entry.sha256)throw Error('Cell hash mismatch: '+key);
 const raw=gunzipSync(compressed),pack=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),entry.decodedBytes),tables=tileTables(pack);
 const digest=()=>createHash('sha256').update(Buffer.concat(Object.values(tables).map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength)))).digest('hex'),before=digest(),started=performance.now();
 const packet=prepareTilePacket(pack,{entry,world:manifest.world,revision:manifest.revision,cell:key.split(',').map(Number)}),wd=packet.metadata.extensions.worldDetail;
 if(before!==digest())throw Error('Physical tables changed: '+key);
 const boreCheck=auditRockBores({...packet,metadata:{...packet.metadata,meshes:packet.metadata.meshes.filter(m=>!m.userData?.landmarkBox)}});if(!boreCheck.passed)throw Error('Dressed bore clearance failed: '+JSON.stringify(boreCheck));
 const count=k=>wd[k]==null?0:packet.arrays[wd[k]].length/5;
 rows.push({key,boreCheck,physicalSha256:before,buildings:tables.buildings.length/4,replacedBasinInfill:wd.replacedBasinInfill||0,mappedBuildings:tables.buildings.length/4-(wd.replacedBasinInfill||0),inferredHouses:wd.inferredHouses||0,coastalTrees:wd.coastalTreeCount||0,trees:count('streetTrees'),boats:count('coastalBoats'),parking:count('parking'),props:wd.props?packet.arrays[wd.props.kind].length:0,bytes:packet.bytes,baselineBytes:entry.residentBytes,decodeMs:performance.now()-started,surfaces:packet.metadata.meshes.filter(m=>m.userData?.tileSurface==='coastalDetail').length});
}
// Use the greater of published admission and measured residency for affected cells.
const measured=new Map(rows.map(r=>[r.key,r.bytes]));let worst2x2=0;
for(const key of Object.keys(manifest.tiles)){const [x,z]=key.split(',').map(Number),bytes=[[x,z],[x+1,z],[x,z+1],[x+1,z+1]].reduce((n,c)=>{const k=c.join(',');return n+Math.max(measured.get(k)||0,manifest.tiles[k]?.residentBytes||0);},0);worst2x2=Math.max(worst2x2,bytes);}
const totalCompressed=Object.values(manifest.tiles).reduce((n,e)=>n+e.bytes,0);
if(worst2x2>64*1024**2||totalCompressed>2*1024**3)throw Error('World budget exceeded');
const report={revision:manifest.revision,rows,worst2x2,totalCompressed,physicalTablesUnchanged:true};
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cells:rows.length,worst2x2,totalCompressed,inferredHouses:rows.reduce((n,r)=>n+r.inferredHouses,0),coastalTrees:rows.reduce((n,r)=>n+r.coastalTrees,0)}));
