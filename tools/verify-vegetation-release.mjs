// Bounded verification of the scenery-only publication and the actual composed
// stream reservation (including every attached region's background assets).
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyVegetationRelease(directory){
 const dir=resolve(directory),root=resolve(import.meta.dirname,'..'),read=async n=>JSON.parse(await readFile(resolve(dir,n))),report=await read('vegetation-audit.json'),manifest=await read('world.json'),publication=await read('publication.json');
 if(!report.passed||report.revision!==manifest.revision||publication.definition.revision!==manifest.revision)throw Error('Incomplete vegetation bake');
 for(const [file,sha]of Object.entries(report.sourceHashes))if(hash(await readFile(resolve(root,file)))!==sha)throw Error('Stale vegetation source: '+file);
 const receipts=new Map(report.physical.map(p=>[p.cell,p]));if(receipts.size!==Object.keys(manifest.tiles).length)throw Error('Incomplete physical equivalence');
 for(const [key,entry]of Object.entries(manifest.tiles)){const p=receipts.get(key);if(!p||p.afterSHA!==entry.sha256||!/^[a-f0-9]{64}$/.test(p.physicalSHA))throw Error('Missing contact/road/rail identity: '+key);}
 let publicationBytes=0;const seen=new Set();for(const o of publication.objects){if(seen.has(o.key))throw Error('Duplicate publication key');seen.add(o.key);const body=await readFile(o.file);if(body.length!==o.size||!o.key.includes(hash(body)))throw Error('Changed immutable output: '+o.key);publicationBytes+=body.length;}
 const worstByRegion={};let worst=0,worstCell;
 for(const key of Object.keys(manifest.tiles)){const[x,z]=key.split(',').map(Number);for(const dx of[-1,0])for(const dz of[-1,0]){let bytes=manifest.regionResidentBytes||0;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const e=manifest.tiles[[x+dx+a,z+dz+b].join(',')];bytes+=e?.residentBytes??e?.decodedBytes??0;}const region=receipts.get(key).region;worstByRegion[region]=Math.max(worstByRegion[region]||0,bytes);if(bytes>worst){worst=bytes;worstCell=[x+dx,z+dz];}}}
 if(64*1024**2-worst<4*1024**2)throw Error('Composed 2x2 has less than 4 MiB headroom: '+worst);
 const proof={passed:true,revision:manifest.revision,cells:receipts.size,physicalArraysIdentical:true,sourceHashesVerified:true,publicationObjects:seen.size,publicationBytes,regionalResidentBytes:manifest.regionResidentBytes,worst2x2Bytes:worst,worstCell,headroomBytes:64*1024**2-worst,worstByRegion,worldBytes:report.worldBytes};
 await writeFile(resolve(dir,'release-verification.json'),JSON.stringify(proof,null,2)+'\n');return proof;
}
if(process.argv[1]===import.meta.filename)console.log(JSON.stringify(await verifyVegetationRelease(process.argv[2]),null,2));
