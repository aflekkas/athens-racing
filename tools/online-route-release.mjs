// Small, reproducible release trust package. Offline export proves the world;
// routine builds authenticate that package against the active world registry.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {canonicalJSON} from '../src/route-definition.js';
import {validateOnlineGrid} from '../src/online-grid.js';
import {validateRecoveryManifest} from '../server/route-road-stream.mjs';
import {recoveryWorldRegistry,assertRecoveryCoverage} from './build-world-recovery.mjs';
export async function validateOnlineRouteRelease(proof,{compiled,manifest}){
 if(proof?.schemaVersion!==1||!Array.isArray(proof.routes)||proof.routes.length!==compiled.length||!Array.isArray(proof.routeGrids)||proof.routeGrids.length!==compiled.length||!Array.isArray(proof.routeRoads)||proof.routeRoads.length!==1)throw Error('Incomplete online release proof package');
 const registry=recoveryWorldRegistry(manifest);if(canonicalJSON(proof.recoveryWorld)!==canonicalJSON(registry))throw Error('Online release active world mismatch');
 const roads=proof.routeRoads[0];await validateRecoveryManifest(roads.body,{expectedHash:roads.hash,worldSetRevision:manifest.revision,sourceHashes:registry.sourceHashes});assertRecoveryCoverage(roads.body,registry);
 const ids=new Set(),gridHashes=new Set(),entries=[];
 for(const c of compiled){
  if(c.worldSetRevision!==manifest.revision)throw Error('Online routes use different world releases');
  const entry=proof.routes.find(e=>e.id===c.id),grid=proof.routeGrids.find(g=>g.hash===entry?.onlineGrid?.hash),descriptor=entry?.onlineGrid,recovery=entry?.recovery;
  if(!entry||ids.has(entry.id)||entry.routeHash!==c.routeHash||descriptor?.schemaVersion!==1||descriptor.capacity!==8||descriptor.url!==`/data/routes/${c.id}.online-grid.${descriptor.hash}.json`||!grid||gridHashes.has(grid.hash))throw Error('Online grid release descriptor mismatch: '+c.id);
  if(recovery?.schemaVersion!==1||recovery.streamed!==true||recovery.hash!==roads.hash||recovery.url!==`/world/recovery/manifest.${roads.hash}.json`)throw Error('Online recovery release descriptor mismatch');
  const body=await validateOnlineGrid(grid.body,c,{expectedHash:grid.hash});for(const [key,hash]of body.sourceHashes||[])if(manifest.tiles[key]?.sha256!==hash)throw Error('Online grid source cell changed: '+key);
  ids.add(c.id);gridHashes.add(grid.hash);entries.push(entry);
 }
 return {routes:entries,routeGrids:proof.routeGrids,routeRoads:proof.routeRoads,recoveryWorld:registry};
}
export async function readOnlineRouteRelease(root,{compiled,manifest,out,required=false}={}){
 let proof;try{proof=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(resolve(root,'data/routes/online-release.json'))));}catch(error){if(error.code==='ENOENT'&&!required)return null;throw error;}
 // Stale optional proofs cannot enable multiplayer. An explicitly requested
 // online build fails visibly rather than publishing a partially usable fleet.
 let release;try{release=await validateOnlineRouteRelease(proof,{compiled,manifest});}catch(error){if(required)throw error;console.warn('Online release disabled: '+error.message);return null;}
 await mkdir(out,{recursive:true});for(const {hash,body}of release.routeGrids)await writeFile(resolve(out,`${body.routeId}.online-grid.${hash}.json`),canonicalJSON(body));return release;
}
export function bindOnlineRouteRelease(config,release,{enable=false}={}){
 if(enable&&!release)throw Error('Online release proof package unavailable');
 return {...config,online:enable===true&&!!release,routes:config.routes.map(entry=>{const proof=release?.routes.find(r=>r.id===entry.id);return proof?{...entry,onlineGrid:proof.onlineGrid,recovery:proof.recovery}:entry;})};
}
