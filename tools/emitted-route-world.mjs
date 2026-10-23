// Bounded, offline reader for already emitted AWT cells. Never changes their identity.
import {readFile} from 'node:fs/promises';
import {resolve,dirname,delimiter,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeTilePack} from '../src/world-tile-codec.js';
import {validateWorldTile} from '../src/world-tile-format.js';
import {sampleTileContact,buildTileContactIndex} from '../src/world-tile-contact.js';
import {WorldTileRoads} from '../src/world-tile-roads.js';
import {WorldTileBarriers} from '../src/world-tile-barriers.js';
import {WorldTileObstacles,buildTileObstacleIndex} from '../src/world-tile-obstacles.js';
import {parkedBoxes} from '../src/world-tile-parking.js';
import {cellKey} from '../src/route-geometry.js';
import {routeSurfaceAllowed} from '../src/route-surface.js';

export async function readEmittedCellBytes(entry,{world,cells,key='unknown'}){
  let bytes;const directories=Array.isArray(cells)?cells:String(cells||dirname(world)).split(delimiter);
  // Layered immutable caches share unchanged source cells without copying.
  // A corrupt higher-priority hash never falls back to a different cache.
  for(const directory of directories){const base=resolve(directory),names=[entry.sha256+'.bin.gz'];if(!/^(?:https?:|\/)/.test(entry.url)&&resolve(base,entry.url).startsWith(base+sep))names.push(entry.url);
    for(const name of new Set(names)){try{bytes=await readFile(resolve(base,name));break;}catch(error){if(error.code!=='ENOENT')throw error;}}if(bytes)break;
  }
  if(!bytes)return null;
  if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Cell hash mismatch: '+key);
  return bytes;
}

export async function readEmittedRouteWorld({world,cells,keys}) {
  if(keys.size>128)throw Error('Route audit exceeds 128 cells');
  const manifest=JSON.parse(await readFile(world,'utf8')),tiles=new Map(),barriers=new WorldTileBarriers(),obstacles=new WorldTileObstacles();
  const stream={tiles,readyAt:(x,z)=>tiles.has(cellKey(x,z)),contact(x,z,options){const key=cellKey(x,z),p=tiles.get(key)?.packet;if(!p)return null;const c=sampleTileContact(p.tables,p.contactIndex,x-p.metadata.origin[0],z-p.metadata.origin[2],options);return c?{...c,surfaceId:p.metadata.ids[c.surface],tile:key}:null;}};
  const roads=new WorldTileRoads(stream);
  for(const key of [...keys].sort()) {
    const e=manifest.tiles[key];if(!e)continue;
    const bytes=await readEmittedCellBytes(e,{world,cells,key});if(!bytes)continue;
    const raw=gunzipSync(bytes,{maxOutputLength:e.decodedBytes}),packet=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),e.decodedBytes);
    packet.tables=validateWorldTile(packet,{world:e.source?.world||manifest.world,revision:e.source?.revision||manifest.revision,cell:key.split(',').map(Number)}).tables;
    packet.contactIndex=buildTileContactIndex(packet.tables);const parking=packet.metadata.extensions?.worldDetail?.parking;
    packet.obstacleIndex=buildTileObstacleIndex(packet.tables,parking==null?null:parkedBoxes(packet.arrays[parking]));
    tiles.set(key,{state:'active',packet});roads.graph.install(key,packet);barriers.install(key,packet);obstacles.install(key,packet);
  }
  const safe=(p,o)=>roads.safe(p,o)&&barriers.safe(p,o)&&![-o.halfLength+o.halfWidth,0,o.halfLength-o.halfWidth].some(a=>obstacles.contact(p.x-Math.sin(p.yaw)*a,p.y,p.z-Math.cos(p.yaw)*a,o.halfWidth+.1));
  const contacts={worldSetRevision:manifest.revision,eligible:k=>manifest.tiles[k]?.contactEligible!==false&&tiles.has(k),surfaceAllowed:(e,c)=>routeSurfaceAllowed(e,c,roads.graph),contact:stream.contact.bind(stream),width:(p,o)=>roads.width(p,{radius:32,bounded:true,...o}),safe,sourceHashes:keys=>keys.map(k=>[k,manifest.tiles[k].sha256])};
  return {manifest,tiles,stream,roads,barriers,obstacles,contacts};
}
