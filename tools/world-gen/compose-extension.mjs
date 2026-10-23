// A local dev-only overlay; never certifies a boundary or publishes a release.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {canonicalWorldJSON} from '../../src/world-manifest.js';
import {validateWorldManifest} from '../../src/world-tile-format.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function composeExtension(base,extension,{regionId='basin',extensionURL=e=>e.url,preservePacketSources=false,regionalManifest}={}){
 base=validateWorldManifest(base);extension=validateWorldManifest(extension);
 for(const field of ['lat0','lon0','mlat','mlon'])if(base.projection[field]!==extension.projection[field])throw Error('Extension projection mismatch');
 if(base.tileMetres!==extension.tileMetres||!Object.values(base.tiles).some(e=>e.source?.regionId===regionId))throw Error('Unknown extension region/frame');
 const identity={regionId,world:extension.world,revision:extension.revision},tiles={...base.tiles};
 const sameSource=(a,b)=>a?.regionId===b?.regionId&&a?.world===b?.world&&a?.revision===b?.revision;
 const packetSources=[];let regions=base.regions;
 if(preservePacketSources){
  if(!regionalManifest?.bytes||!/^([a-f0-9]{64})$/.test(regionalManifest.sha256||'')||typeof regionalManifest.url!=='string'||!regionalManifest.url||sha(regionalManifest.bytes)!==regionalManifest.sha256||canonicalWorldJSON(JSON.parse(regionalManifest.bytes))!==canonicalWorldJSON(extension))throw Error('Regional manifest byte binding mismatch');
  if(!base.regions?.some(r=>r.id===regionId))throw Error('Missing original regional descriptor');
  regions=base.regions.map(r=>r.id===regionId?{...r,sourceWorld:extension.world,sourceRevision:extension.revision,manifestUrl:regionalManifest.url,manifestSha256:regionalManifest.sha256}:r);
 }
 for(const[key,e]of Object.entries(extension.tiles)){
  if(preservePacketSources){
   // A repair manifest can retain old packets alongside genuinely new ones.
   // Never relabel those immutable packets with the manifest revision.
   if(!e.source||e.source.regionId!==regionId||!extension.sourceIdentities?.some(i=>sameSource(i,e.source)))throw Error('Undeclared regional packet source');
   const prior=base.tiles[key];if(!prior||prior.source?.regionId!==regionId)throw Error('Regional repair outside original region');
   if(prior.sha256===e.sha256){if(!sameSource(prior.source,e.source)||prior.bytes!==e.bytes||prior.triangles!==e.triangles)throw Error('Unchanged packet source mismatch');tiles[key]=prior;}
   else tiles[key]={...e,url:extensionURL(e),source:{...e.source}};
   packetSources.push(e.source);
  }else{
   if(e.source&&(e.source.world!==identity.world||e.source.revision!==identity.revision))throw Error('Extension packet identity mismatch');
   tiles[key]={...e,url:extensionURL(e),source:identity};
  }
 }
 const identities=new Map((base.sourceIdentities||[]).map(i=>[JSON.stringify(i),i]));if(preservePacketSources){for(const source of packetSources)if(![...identities.values()].some(i=>sameSource(i,source)))identities.set(JSON.stringify(source),source);}else identities.set(JSON.stringify(identity),identity);
 const lineage={schema:preservePacketSources?'athens-region-repair-overlay-1':'athens-extension-overlay-1',baseRevision:base.revision,extensionRevision:extension.revision,regionId,...(preservePacketSources?{regionalManifestSHA256:regionalManifest.sha256,regionalManifestURL:regionalManifest.url}:{}),cells:Object.entries(tiles).sort(([a],[b])=>a.localeCompare(b)).map(([key,e])=>[key,e.sha256,e.source])};
 const revision=sha(canonicalWorldJSON(lineage));
 return {manifest:validateWorldManifest({...base,world:'athens',revision,tiles,...(preservePacketSources?{regions}:{}),sourceIdentities:[...identities.values()],developmentOnly:true,releaseReady:false,acceptance:{passed:false,reason:'Provisional extension; complete halo, common boundary and final world/route acceptance required'}}),lineage};
}
if(process.argv[1]===import.meta.filename){
 const[baseFile,baseSHA,extensionFile,extensionSHA,output]=process.argv.slice(2);if(!output)throw Error('Expected base SHA extension SHA output');
 const b=await fs.readFile(baseFile),e=await fs.readFile(extensionFile);if(sha(b)!==baseSHA||sha(e)!==extensionSHA)throw Error('Overlay manifest integrity');
 const out=resolve(output),result=composeExtension(JSON.parse(b),JSON.parse(e),{extensionURL:entry=>entry.url.startsWith('./')?'./'+relative(dirname(out),join(dirname(resolve(extensionFile)),entry.url)).replaceAll('\\','/'):entry.url});
 await fs.writeFile(out,JSON.stringify(result.manifest));await fs.writeFile(out+'.source.json',JSON.stringify({...result.lineage,baseSHA,extensionSHA,manifestSHA:sha(await fs.readFile(out))},null,2));console.log(JSON.stringify({revision:result.manifest.revision,cells:Object.keys(result.manifest.tiles).length,regionId:'basin',acceptance:false}));
}
