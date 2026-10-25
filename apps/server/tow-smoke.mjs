import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateRecoveryManifest,createStreamedRoadAuthority,admitRecoverySidecar,RECOVERY_MEMORY} from '../../server/route-road-stream.mjs';
import {recoveryCellDescriptor} from '../../server/recovery-manifest-wire.mjs';
import {routeRoadAuthority} from '../../server/route-roads.mjs';
import {canonicalJSON} from '../../src/route-definition.js';
import {planWorldTow} from '../../src/tow-placement.js';
const root=resolve('.desktop/game'),catalogue=JSON.parse(await readFile(resolve(root,'catalogue.json'))),roads=catalogue.routeRoads[0];
const manifest=await validateRecoveryManifest(roads.body,{expectedHash:roads.hash,worldSetRevision:catalogue.recoveryWorld.worldSetRevision,sourceHashes:catalogue.recoveryWorld.sourceHashes});
for(const key of ['-1,-16','-1,-14','-63,-2']){
 const descriptor=recoveryCellDescriptor(manifest,key),hash=descriptor.parts?.[0]||descriptor.hash;
 const raw=await readFile(resolve(root,`world/recovery/${key}.${hash}.json`));
 const anchor=(await admitRecoverySidecar(raw,{expectedHash:hash,worldSetRevision:manifest.worldSetRevision})).body.anchors[0];
 const pose={x:anchor.x,y:anchor.y,z:anchor.z,yaw:anchor.yaw,layer:anchor.layer,surfaceId:anchor.surfaceId};
 let loads=0;const originals=[];const authority=createStreamedRoadAuthority(manifest,async url=>{loads++;const raw=await readFile(resolve(root,'.'+url));originals.push((await admitRecoverySidecar(raw,{expectedHash:url.match(/\.([a-f0-9]{64})\.json$/)[1],worldSetRevision:manifest.worldSetRevision})).body);return raw;});
 const start=Date.now();let context;
 try{context=await authority.prepare(pose,{halfWidth:.932,halfLength:2.162});const unique=new Map(),edges=new Map();for(const body of originals){for(const a of routeRoadAuthority(body).candidates(pose,{halfWidth:.932,halfLength:2.162})){const id=canonicalJSON([a.edgeId,a.offsetM,a.x,a.z]);if(!unique.has(id))unique.set(id,a);}for(const e of body.edges)if(!edges.has(e.id))edges.set(e.id,e);}
 assert.deepEqual([...context.candidates],[...unique.values()]);assert.deepEqual([...context.edges],[...edges.values()]);
 const memory={}; console.log(JSON.stringify({key,candidates:context.candidates.length,edges:context.edges.length,contextBytes:context.bytes,contextPeak:context.peakBytes}));
 const target=planWorldTow({pose,roadCandidates:context.candidates,footprint:{halfWidth:.932,halfLength:2.162},maxBytes:RECOVERY_MEMORY.context-context.bytes,memory});
 assert.ok(target);assert.ok(context.peakBytes<=RECOVERY_MEMORY.context);assert.ok(context.bytes+memory.peakBytes<=RECOVERY_MEMORY.context);
 console.log(JSON.stringify({proof:'full authenticated root cold Tow',key,loads,elapsedMs:Date.now()-start,candidates:context.candidates.length,edges:context.edges.length,contextBytes:context.bytes,contextPeak:context.peakBytes,planner:memory,target:{x:target.x,y:target.y,z:target.z,edgeId:target.edgeId},stats:authority.stats()}));
 }finally{context?.release();assert.equal(authority.stats().leases,0);}
}
