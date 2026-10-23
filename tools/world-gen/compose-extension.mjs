// A local dev-only overlay; never certifies a boundary or publishes a release.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {canonicalWorldJSON} from '../../src/world-manifest.js';
import {validateWorldManifest} from '../../src/world-tile-format.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function composeExtension(base,extension,{regionId='basin',extensionURL=e=>e.url}={}){
 base=validateWorldManifest(base);extension=validateWorldManifest(extension);
 for(const field of ['lat0','lon0','mlat','mlon'])if(base.projection[field]!==extension.projection[field])throw Error('Extension projection mismatch');
 if(base.tileMetres!==extension.tileMetres||!Object.values(base.tiles).some(e=>e.source?.regionId===regionId))throw Error('Unknown extension region/frame');
 const identity={regionId,world:extension.world,revision:extension.revision},tiles={...base.tiles};
 for(const[key,e]of Object.entries(extension.tiles)){
  if(e.source&&(e.source.world!==identity.world||e.source.revision!==identity.revision))throw Error('Extension packet identity mismatch');
  tiles[key]={...e,url:extensionURL(e),source:identity};
 }
 const identities=new Map((base.sourceIdentities||[]).map(i=>[JSON.stringify(i),i]));identities.set(JSON.stringify(identity),identity);
 const lineage={schema:'athens-extension-overlay-1',baseRevision:base.revision,extensionRevision:extension.revision,regionId,cells:Object.entries(tiles).sort(([a],[b])=>a.localeCompare(b)).map(([key,e])=>[key,e.sha256,e.source])};
 const revision=sha(canonicalWorldJSON(lineage));
 return {manifest:validateWorldManifest({...base,world:'athens',revision,tiles,sourceIdentities:[...identities.values()],developmentOnly:true,releaseReady:false,acceptance:{passed:false,reason:'Provisional extension; complete halo, common boundary and final world/route acceptance required'}}),lineage};
}
if(process.argv[1]===import.meta.filename){
 const[baseFile,baseSHA,extensionFile,extensionSHA,output]=process.argv.slice(2);if(!output)throw Error('Expected base SHA extension SHA output');
 const b=await fs.readFile(baseFile),e=await fs.readFile(extensionFile);if(sha(b)!==baseSHA||sha(e)!==extensionSHA)throw Error('Overlay manifest integrity');
 const out=resolve(output),result=composeExtension(JSON.parse(b),JSON.parse(e),{extensionURL:entry=>entry.url.startsWith('./')?'./'+relative(dirname(out),join(dirname(resolve(extensionFile)),entry.url)).replaceAll('\\','/'):entry.url});
 await fs.writeFile(out,JSON.stringify(result.manifest));await fs.writeFile(out+'.source.json',JSON.stringify({...result.lineage,baseSHA,extensionSHA,manifestSHA:sha(await fs.readFile(out))},null,2));console.log(JSON.stringify({revision:result.manifest.revision,cells:Object.keys(result.manifest.tiles).length,regionId:'basin',acceptance:false}));
}
