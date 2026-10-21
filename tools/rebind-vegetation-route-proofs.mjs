// A scenery-only cell rewrite may retain route proofs only with a complete,
// source-hash-verified physical equivalence report from the vegetation rebake.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {rebindRouteShard} from './route-release.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function rebindVegetationProofs(root,bake){
 const report=JSON.parse(await readFile(resolve(bake,'vegetation-audit.json'))),manifest=JSON.parse(await readFile(resolve(bake,'world.json')));
 if(!report.passed||report.revision!==manifest.revision)throw Error('Vegetation acceptance required');
 for(const [file,expected]of Object.entries(report.sourceHashes))if(hash(await readFile(resolve(root,file)))!==expected)throw Error('Stale vegetation source: '+file);
 const proofs=new Map(report.physical.map(p=>[p.cell,p]));if(proofs.size!==Object.keys(manifest.tiles).length||[...proofs.values()].some(p=>!/^[a-f0-9]{64}$/.test(p.physicalSHA)))throw Error('Incomplete physical equivalence proof');
 const primary=JSON.parse(await readFile(resolve(root,'data/routes/validation/athens.inputs.json'))),names=['athens.inputs.json',...(primary.shards||[])],result=[];
 for(const name of new Set(names)){
  const file=resolve(root,'data/routes/validation',name),shard=JSON.parse(await readFile(file)),oldHashes=new Map(shard.sourceHashes);
  for(const [key,prior]of Object.entries(shard.cells)){const active=manifest.tiles[key],proof=proofs.get(key);
   if(!active||!proof||prior.sha256!==proof.beforeSHA||oldHashes.get(key)!==proof.beforeSHA||active.sha256!==proof.afterSHA||prior.triangles!==active.triangles)throw Error('Route physical source mismatch: '+key);
   const {url,...entry}=active;shard.cells[key]=entry;
  }
  shard.sourceHashes=shard.sourceHashes.map(([k])=>[k,manifest.tiles[k].sha256]);shard.worldSetRevision=manifest.revision;
  rebindRouteShard(shard,manifest);await writeFile(file,JSON.stringify(shard)+'\n');result.push({file:name,cells:Object.keys(shard.cells).length,contactProofs:Object.keys(shard.proofs.contact).length});
 }
 return result;
}
if(process.argv[1]===import.meta.filename)console.log(JSON.stringify(await rebindVegetationProofs(resolve(import.meta.dirname,'..'),resolve(process.argv[2])),null,2));
