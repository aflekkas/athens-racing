// Entirely synthetic AWT cells; no downloaded or third-party geometry.
import {createHash} from 'node:crypto';
import {TILE_TABLES} from '../../../src/world-tile-format.js';
import {encodeTile} from '../pack.mjs';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export function wallRecord(points=[[510,10],[514,10]]){
 const geometryBytes=Buffer.alloc(9+points.length*16);geometryBytes[0]=1;geometryBytes.writeUInt32LE(2,1);geometryBytes.writeUInt32LE(points.length,5);points.forEach((p,i)=>{geometryBytes.writeDoubleLE(p[0],9+i*16);geometryBytes.writeDoubleLE(p[1],17+i*16);});
 const record={id:'w900',kind:'retaining_wall',version:3,timestamp:'2026-01-01T00:00:00Z',sourceSha256:'e'.repeat(64),tags:{barrier:'retaining_wall'},refs:[9001,9002],geometrySha256:hash(geometryBytes)};
 record.recordSha256=hash(JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a],[b])=>a.localeCompare(b)))));return{record,geometryBytes};
}
export function source({cell=[0,0],top=6,intrusion=false,ambiguous=false,upper=false,upperHeight=12,sliver=null,roadTriangles=[]}={}){
 const tables=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));tables.coarseHeights=Array(1089).fill(0);
 tables.finePositions=[0,0,0,512,0,0,512,0,512,0,0,512];tables.fineTriangles=[0,2,1,0,3,2];
 const square=(y,owner,layer,flags)=>{const first=tables.contactPositions.length/3;tables.contactPositions.push(0,y,0,512,y,0,512,y,512,0,y,512);tables.contactTriangles.push(first,first+2,first+1,owner,flags,first,first+3,first+2,owner,flags);tables.contactLayers.push(layer,layer);};
 square(top,1,1,0);if(intrusion)square(3,2,0,1);if(ambiguous)square(top+1,1,1,0);if(upper)square(upperHeight,3,2,0);if(sliver){const first=tables.contactPositions.length/3;tables.contactPositions.push(511.2,sliver==='ambiguity'?7:3,9,511.4,sliver==='ambiguity'?7:3,10,511.2,sliver==='ambiguity'?7:3,11);tables.contactTriangles.push(first,first+2,first+1,sliver==='ambiguity'?1:2,sliver==='ambiguity'?0:1);tables.contactLayers.push(sliver==='ambiguity'?1:0);}
 for(const road of roadTriangles){const first=tables.contactPositions.length/3;tables.contactPositions.push(...road.points.flat());tables.contactTriangles.push(first,first+1,first+2,road.owner??2,1);tables.contactLayers.push(road.layer??0);}
 const metadata={tileVersion:1,world:'fixture-context',revision:'fixture-original',cell,origin:[cell[0]*512,0,cell[1]*512],ids:['','surface:top','surface:intruder','surface:upper'],strings:[''],palette:[[1,1,1]],meshes:[],terrain:{coarseSize:33,spacing:16},budgets:{triangles:0,buildingTriangles:0}};
 const {bytes}=encodeTile({metadata,arrays:[],tables}),entry={bytes:bytes.length,decodedBytes:1024*1024,sha256:hash(bytes),source:{world:metadata.world,revision:metadata.revision}};
 return{compressedBytes:bytes,entry,world:metadata.world,revision:metadata.revision,cell};
}
export const ref=(s,table,triangle,owner,layer)=>({sourceSha256:s.entry.sha256,table,triangle,owner,layer});
