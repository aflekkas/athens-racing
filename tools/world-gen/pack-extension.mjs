// Authoritative bounded extension packer. Emits only a dev-only source manifest;
// common-boundary/whole-world assembly and release proofs are still required.
// Usage: node pack-extension.mjs OUTPUT PYTHON [build-extension.py arguments...]
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packTiles} from './pack.mjs';
import {validateWorldManifest,tileTables} from '../../src/world-tile-format.js';
import {tileRenderVariants} from '../../src/world-tile-gpu.js';
const [out,python,...args]=process.argv.slice(2);if(!out||!python)throw Error('Expected OUTPUT PYTHON generator-arguments');
const output=resolve(out),cells=join(output,'cells');await fs.mkdir(cells,{recursive:true});
const stats=await fs.statfs('/');if((stats.blocks-stats.bfree)/(stats.blocks-stats.bfree+stats.bavail)>=.83)throw Error('Shared disk hard stop83%');
const generator=spawn(python,[fileURLToPath(new URL('./build-extension.py',import.meta.url)),...args],{stdio:['ignore','pipe','pipe'],env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
// A bounded CPU-window supervisor signals this process. Stop our recorded
// generator child as well, so no Python bake survives the packer terminal.
const stopGenerator=()=>{if(generator.exitCode===null)generator.kill('SIGTERM');};
process.once('SIGTERM',stopGenerator);process.once('SIGINT',stopGenerator);
const completed=new Promise((resolve,reject)=>{generator.once('error',reject);generator.once('exit',code=>code===0?resolve():reject(Error('Extension generator exit '+code)));});
// Attach the rejection immediately even if packing fails first.
completed.catch(()=>{});generator.stderr.pipe(process.stderr);
let identity,validatedSpawn;const audits=[],variants=new Map();
try{
 const entries=await packTiles(generator.stdout,cells,{onTile:({key,decoded,physical,bridges,bores,roads,entry})=>{
  const m=decoded.metadata,next=m.world+':'+m.revision;if(identity&&identity!==next)throw Error('Mixed extension source identity');identity=next;
  const tables=tileTables(decoded);if(!validatedSpawn&&tables.anchors.length)validatedSpawn={cell:m.cell,anchor:m.ids[tables.anchors[0]]};
  for(const v of tileRenderVariants(decoded))variants.set(v.key,v);
  audits.push({key,physical,bridges,bores,roads,triangles:entry.triangles,residentBytes:entry.residentBytes,bytes:entry.bytes});
 }});await completed;
 const source=JSON.parse(await fs.readFile(join(cells,'entries.json'),'utf8')),split=identity.lastIndexOf(':'),world=identity.slice(0,split),revision=identity.slice(split+1);
 for(const[key,e]of Object.entries(entries)){const old=join(cells,e.url.slice(2)),name=e.sha256+'.bin.gz';await fs.rename(old,join(cells,name));e.url='./cells/'+name;e.dependencies=[];e.contactEligible=true;}
 // Metadata and accounting come from packTiles, not from handwritten budgets.
 if(!Object.keys(entries).length||!validatedSpawn)throw Error('No extension cells with a validated source anchor');
 const manifest=validateWorldManifest({tileVersion:1,tileMetres:512,world,revision,projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87745.27512677578},elevation:{source:'Copernicus GLO-30 DSM',datum:'EGM2008',verticalOffset:0},spawn:validatedSpawn,tiles:entries,renderVariants:[...variants.values()],developmentOnly:true,releaseReady:false,acceptance:{passed:false,reason:'Local source extension; common boundary, connectivity, route and game proof required'}});
 await fs.writeFile(join(output,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(join(output,'physical-audit.json'),JSON.stringify({world,revision,cells:audits.length,audits},null,2));
 await fs.writeFile(join(cells,'entries.json'),JSON.stringify({...source,tiles:entries}));console.log(JSON.stringify({world,revision,cells:audits.length,compressedBytes:Object.values(entries).reduce((n,e)=>n+e.bytes,0),acceptance:false}));
}catch(error){if(generator.exitCode===null)generator.kill('SIGTERM');await completed.catch(()=>{});throw error;}finally{process.removeListener('SIGTERM',stopGenerator);process.removeListener('SIGINT',stopGenerator);}
