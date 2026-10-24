// A metadata-only world budget repair may rebind existing physical certificates.
// Any source-cell or numerical change requires fresh certification instead.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,rename,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonicalJSON,sha256} from '../../src/route-definition.js';
import {verifyWorldRelease} from '../game/export-world.mjs';
import {rebindCompiledWorld} from '../game/repair-world.mjs';
import {verifyOnlineOverlay} from './prepare-online.mjs';
import {admitRecoverySidecar,validateRecoveryManifest} from '../../server/route-road-stream.mjs';
import {recoveryCellDescriptor,encodeRecoveryManifest} from '../../server/recovery-manifest-wire.mjs';
import {validateOnlineRouteRelease,bindOnlineRouteRelease} from '../../tools/online-route-release.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const same=(a,b,label)=>{if(canonicalJSON(a)!==canonicalJSON(b))throw Error('Metadata rebind changed '+label);};
export function assertMetadataOnlyWorld(oldWorld,nextWorld,originalWorld){
 const approved=new Set(['-64,-2','-63,-2','-64,-1','-63,-1','-65,-1']);
 const keys=Object.keys(oldWorld.tiles);same(keys,Object.keys(nextWorld.tiles),'cell order');
 const a=structuredClone(oldWorld),b=structuredClone(nextWorld);let changed=0;
 delete a.revision;delete b.revision;
 for(const key of keys){const old=a.tiles[key],next=b.tiles[key];
  if(canonicalJSON(old)!==canonicalJSON(next)){
   const source=originalWorld.tiles[key];if(!approved.has(key)||!source||Object.hasOwn(old,'residentBytes')||!Number.isSafeInteger(next.residentBytes)||next.residentBytes!==(source.residentBytes??source.decodedBytes))throw Error('Metadata rebind requires exact original resident budget');
   delete next.residentBytes;changed++;
  }
  same(old,next,'source packet '+key);
 }
 if(changed!==5)throw Error('Metadata rebind must preserve the five repaired resident budgets');
 if(a.regions.length!==b.regions.length)throw Error('Metadata rebind changed regions');
 for(let i=0;i<a.regions.length;i++)if(a.regions[i].id==='megara'&&b.regions[i].id==='megara')for(const field of ['manifestUrl','manifestSha256','sourceRevision']){delete a.regions[i][field];delete b.regions[i][field];}
 same(a,b,'world geometry/source metadata');return keys;
}
export const rebindRecoveryRoot=(root,cells,revision)=>encodeRecoveryManifest({...root,schemaVersion:1,worldSetRevision:revision,cells});
export async function rebindRecoveryBytes(raw,{expectedHash,oldRevision,newRevision,sourceHashes=null,cell=null}){
 const before=await admitRecoverySidecar(raw,{expectedHash,worldSetRevision:oldRevision});
 if(sourceHashes&&(before.body.sourceHashes.some(([key,hash])=>sourceHashes.get(key)!==hash)||!before.body.sourceHashes.some(([key,hash])=>key===cell&&sourceHashes.get(key)===hash)))throw Error('Metadata rebind artifact source drift');
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(body.worldSetRevision!==oldRevision)throw Error('Metadata rebind old artifact revision mismatch');
 body.worldSetRevision=newRevision;const bytes=Buffer.from(canonicalJSON(body)),nextHash=await sha256(body);
 const after=await admitRecoverySidecar(bytes,{expectedHash:nextHash,worldSetRevision:newRevision});
 same(before.body,after.body,'certified records');
 return {bytes,hash:nextHash,anchors:after.body.anchors.length};
}
export async function rebindOnlineRelease({oldRelease=resolve('.desktop/world-release-repaired'),release=resolve('.desktop/world-release-repaired-next'),originalRelease=resolve('.desktop/world-release'),oldOut=resolve('.desktop/online-release'),out=resolve('.desktop/online-release-next'),log=console.log}={}){
 for(const path of [oldRelease,release,originalRelease,oldOut,out])if((await lstat(dirname(path))).isSymbolicLink())throw Error('Rebind parent symlink rejected');
 if(out===oldOut||out===oldRelease||out===release)throw Error('Metadata rebind needs a separate destination');
 try{await lstat(out);throw Error('Metadata rebind destination already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 await verifyWorldRelease(oldRelease);await verifyWorldRelease(release);await verifyWorldRelease(originalRelease);
 const oldInventory=await verifyOnlineOverlay({release:oldRelease,out:oldOut});
 const [oldWorld,nextWorld,originalWorld,oldCatalogue,nextBase]=await Promise.all([json(resolve(oldRelease,'world-flat.json')),json(resolve(release,'world-flat.json')),json(resolve(originalRelease,'world-flat.json')),json(resolve(oldOut,'catalogue.json')),json(resolve(release,'catalogue.json'))]);
 const keys=assertMetadataOnlyWorld(oldWorld,nextWorld,originalWorld);
 if(oldWorld.revision===nextWorld.revision)throw Error('Metadata rebind requires a new world identity');
 assert.equal(oldCatalogue.routes.length,6);same(oldCatalogue.routes.map(r=>r.id),nextBase.routes.map(r=>r.id),'route order');
 for(let i=0;i<oldCatalogue.routes.length;i++){const old=oldCatalogue.routes[i],next=nextBase.routes[i];same(await rebindCompiledWorld(old,nextWorld.revision,old.graphDigest),next,'compiled geometry/rival plan '+old.id);}
 const temp=await mkdtemp(resolve(process.platform==='win32'?tmpdir():'/tmp','athens-online-rebind.')),candidate=resolve(temp,'candidate');
 let published=false;
 try{
  await mkdir(candidate);const files=[];
  const store=async(path,body)=>{const bytes=body instanceof Uint8Array?body:Buffer.from(canonicalJSON(body));await mkdir(dirname(resolve(candidate,path)),{recursive:true});await writeFile(resolve(candidate,path),bytes);files.push({path,bytes:bytes.length,sha256:hash(bytes)});};
  const oldRoad=oldCatalogue.routeRoads[0];const oldRoot=await validateRecoveryManifest(oldRoad.body,{expectedHash:oldRoad.hash,worldSetRevision:oldWorld.revision,sourceHashes:oldCatalogue.recoveryWorld.sourceHashes});
  const preflightCells=Object.fromEntries(Object.keys(oldRoot.cells).map(key=>[key,recoveryCellDescriptor(oldRoot,key)]));
  const preflightRoot=rebindRecoveryRoot(oldRoot,preflightCells,nextWorld.revision);
  await validateRecoveryManifest(preflightRoot,{expectedHash:await sha256(preflightRoot),worldSetRevision:nextWorld.revision,sourceHashes:oldCatalogue.recoveryWorld.sourceHashes});
  const sourceHashes=new Map(oldCatalogue.recoveryWorld.sourceHashes);
  const cells={};let parts=0,anchors=0;
  for(const key of Object.keys(oldRoot.cells)){
   const cell=recoveryCellDescriptor(oldRoot,key);if(cell.sourceHash!==nextWorld.tiles[key].sha256)throw Error('Metadata rebind source changed');
   if(cell.empty){cells[key]={sourceHash:cell.sourceHash,empty:true};continue;}
   const nextParts=[];for(const oldHash of cell.parts||[cell.hash]){
    const rebound=await rebindRecoveryBytes(await readFile(resolve(oldOut,`world/recovery/${key}.${oldHash}.json`)),{expectedHash:oldHash,oldRevision:oldWorld.revision,newRevision:nextWorld.revision,sourceHashes,cell:key});
    await store(`world/recovery/${key}.${rebound.hash}.json`,rebound.bytes);nextParts.push(rebound.hash);parts++;anchors+=rebound.anchors;
    if(parts%100===0)log(JSON.stringify({phase:'rebind',parts,anchors}));
   }
   cells[key]={sourceHash:cell.sourceHash,parts:nextParts};
  }
  const root=rebindRecoveryRoot(oldRoot,cells,nextWorld.revision),rootHash=await sha256(root);
  await store(`world/recovery/manifest.${rootHash}.json`,root);
  const recovery={schemaVersion:1,url:`/world/recovery/manifest.${rootHash}.json`,hash:rootHash,streamed:true};
  const routeGrids=[],entries=[];
  for(const compiled of nextBase.routes){
   const oldEntry=oldCatalogue.routeConfig.routes.find(e=>e.id===compiled.id),oldGrid=oldCatalogue.routeGrids.find(g=>g.hash===oldEntry.onlineGrid.hash);
   const body={...oldGrid.body,routeHash:compiled.routeHash,worldSetRevision:nextWorld.revision};const gridHash=await sha256(body);
   await store(`data/routes/${compiled.id}.online-grid.${gridHash}.json`,body);
   const descriptor={...oldEntry.onlineGrid,hash:gridHash,url:`/data/routes/${compiled.id}.online-grid.${gridHash}.json`};
   routeGrids.push({hash:gridHash,body});entries.push({id:compiled.id,routeHash:compiled.routeHash,onlineGrid:descriptor,recovery});
  }
  const proof={schemaVersion:1,routes:entries,routeGrids,routeRoads:[{hash:rootHash,body:root}],recoveryWorld:{...oldCatalogue.recoveryWorld,worldSetRevision:nextWorld.revision}};
  const validated=await validateOnlineRouteRelease(proof,{compiled:nextBase.routes,manifest:nextWorld});
  const config={...bindOnlineRouteRelease(nextBase.routeConfig,validated,{enable:true}),onlineAvailable:true};
  await store('catalogue.json',{...nextBase,routeConfig:config,routeGrids:validated.routeGrids,routeRoads:validated.routeRoads,recoveryWorld:validated.recoveryWorld});
  await store('route-config.json',config);await store('data/routes/online-release.json',proof);
  const index=await json(resolve(release,'data/routes/index.json'));
  await store('data/routes/index.json',{...index,routes:index.routes.map(e=>{const descriptors=config.routes.find(r=>r.id===e.id);return {...e,onlineGrid:descriptors.onlineGrid,recovery:descriptors.recovery};})});
  if(parts!==1336||anchors!==2507500)throw Error('Metadata rebind incomplete physical certificate coverage');
  const inventory={schemaVersion:1,sourceInventoryHash:hash(await readFile(resolve(release,'offline-world-inventory.json'))),worldSetRevision:nextWorld.revision,routes:nextBase.routes.map(r=>r.id),metadataRebind:{contract:'preserve-source-resident-budget-v1',oldWorldRevision:oldWorld.revision,newWorldRevision:nextWorld.revision,oldOverlayInventoryHash:hash(await readFile(resolve(oldOut,'offline-online-inventory.json'))),oldSourceInventoryHash:oldInventory.sourceInventoryHash,cells:keys.length,parts,anchors},files:files.sort((a,b)=>a.path.localeCompare(b.path))};
  await writeFile(resolve(candidate,'offline-online-inventory.json'),JSON.stringify(inventory));
  await verifyOnlineOverlay({release,out:candidate});await mkdir(dirname(out),{recursive:true});await rename(candidate,out);published=true;
  log(JSON.stringify({phase:'rebind-complete',out,worldSetRevision:nextWorld.revision,cells:keys.length,parts,anchors,files:files.length}));return inventory;
 }finally{if(published)await rm(temp,{recursive:true,force:true});else log(JSON.stringify({phase:'retained-rebind',path:temp,message:'Previous base and overlay preserved; owned candidate retained for diagnosis.'}));}
}
export async function verifyReboundRecovery({release=resolve('.desktop/world-release-repaired-next'),out=resolve('.desktop/online-release-next'),log=console.log}={}){
 await verifyOnlineOverlay({release,out});
 const c=await json(resolve(out,'catalogue.json')),r=c.routeRoads[0],world=c.recoveryWorld;
 const root=await validateRecoveryManifest(r.body,{expectedHash:r.hash,worldSetRevision:world.worldSetRevision,sourceHashes:world.sourceHashes}),sources=new Map(world.sourceHashes);
 let parts=0,anchors=0,bytes=0,maxDecoded=0;
 for(const key of Object.keys(root.cells)){
  const descriptor=recoveryCellDescriptor(root,key);if(descriptor.empty)continue;
  for(const hash of descriptor.parts||[descriptor.hash]){
   const raw=await readFile(resolve(out,`world/recovery/${key}.${hash}.json`));
   const admitted=await admitRecoverySidecar(raw,{expectedHash:hash,worldSetRevision:world.worldSetRevision});
   if(admitted.body.sourceHashes.some(([key,hash])=>sources.get(key)!==hash)||!admitted.body.sourceHashes.some(([cell,hash])=>cell===key&&hash===sources.get(key)))throw Error('Rebound artifact source registry drift');
   parts++;anchors+=admitted.body.anchors.length;bytes+=raw.length;maxDecoded=Math.max(maxDecoded,admitted.metrics.decodedBytes);
   if(parts%200===0)log(JSON.stringify({phase:'final-readmission',parts,anchors}));
  }
 }
 if(parts!==1336||anchors!==2507500||Object.keys(root.cells).length!==1748)throw Error('Incomplete rebound recovery dataset');
 const result={worldSetRevision:world.worldSetRevision,cells:1748,parts,anchors,rawBytes:bytes,maxDecodedBytes:maxDecoded,rootHash:r.hash};log(JSON.stringify({phase:'final-readmission-complete',...result}));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)rebindOnlineRelease().catch(e=>{console.error(e);process.exitCode=1;});
