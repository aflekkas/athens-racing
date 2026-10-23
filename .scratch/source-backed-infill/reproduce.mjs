// Run only with an allocated CPU slot: node reproduce.mjs CONFIG OUTPUT.
// Source/cells are read-only. OUTPUT must be a fresh directory in the task temp.
import fs from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {decodePinnedSourceCell,makeInfillRepairPlan,repairPlanSha256,applyReviewedInfillRepair,repairedSpool,auditRepairedPacket} from '../../tools/world-gen/repair-infill.mjs';
import {packTiles} from '../../tools/world-gen/pack.mjs';
const [configPath,out]=process.argv.slice(2);if(!out)throw Error('Expected CONFIG OUTPUT');
const config=JSON.parse(await fs.readFile(configPath)),hash=b=>createHash('sha256').update(b).digest('hex');
try{await fs.stat(out);throw Error('Output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const manifestBytes=await fs.readFile(config.baseManifest);if(hash(manifestBytes)!==config.baseManifestSha256)throw Error('Manifest source hash mismatch');
const m=JSON.parse(manifestBytes),fixture=JSON.parse(await fs.readFile(resolve(dirname(configPath),config.fixtureHashes)));
if(fixture.rows.length!==39)throw Error('Expected reviewed 39-cell fixture');
for(const row of fixture.rows){const e=m.tiles[row.cell],b=await fs.readFile(join(config.cellCache,row.sha256+'.bin.gz'));if(e.sha256!==row.sha256||b.length!==row.bytes||hash(b)!==row.sha256)throw Error('Fixture hash mismatch '+row.cell);}
const wires=new Map(),plans=[],removed=new Map();
for(const[key,target]of Object.entries(config.cells)){
 const entry=m.tiles[key];if(!m.sourceIdentities.some(id=>id.world===entry.source.world&&id.revision===entry.source.revision&&id.regionId===entry.source.regionId))throw Error('Unbound entry source identity '+key);
 const bytes=await fs.readFile(join(config.cellCache,entry.sha256+'.bin.gz'));
 // Unified world identity differs from the immutable native cell identity.
 const p=decodePinnedSourceCell(bytes,entry,{world:entry.source.world,revision:entry.source.revision,cell:key.split(',').map(Number)});
 let wire=p;if(target.ids.length){const plan=await makeInfillRepairPlan(p,{sourcePath:config.sourceSnapshot,expectedSourceSha256:config.sourceSha256,sourceCellSha256:entry.sha256,ids:target.ids,python:config.python});if(repairPlanSha256(plan)!==target.reviewedPlanSha256)throw Error('Reviewed source plan mismatch '+key);({pack:wire}=await applyReviewedInfillRepair(p,plan,{reviewedPlanSha256:target.reviewedPlanSha256,sourcePath:config.sourceSnapshot,sourceCellSha256:entry.sha256}));plans.push(plan);}
 wires.set(key,wire);removed.set(key,target.ids);
}
const revision=hash(Buffer.from(JSON.stringify({base:m.revision,plans:plans.map(repairPlanSha256)})));for(const p of wires.values())p.metadata.revision=revision;
const audits=[],entries=await packTiles(Readable.from([...wires.values()].map(p=>JSON.stringify(repairedSpool(p))+'\n')),out,{onTile:({key,entry,packet,physical,bridges,roads,bores})=>{audits.push({key,entry,physical,bridges,roads,bores,packet:auditRepairedPacket(wires.get(key),packet,removed.get(key))});}});
for(const e of Object.values(entries)){const old=join(out,e.url.slice(2)),name=e.sha256+'.bin.gz';await fs.rename(old,join(out,name));e.url='./'+name;await fs.chmod(join(out,name),0o444);}
await fs.writeFile(join(out,'entries.json'),JSON.stringify({identity:[...wires.values()][0].metadata.world+':'+revision,tiles:entries},null,2));
await fs.writeFile(join(out,'reproduction.json'),JSON.stringify({revision,fixtureCells:39,entries,audits,releaseReady:false,gameProof:false},null,2));
console.log(JSON.stringify({revision,cells:Object.keys(entries).length,fixtureCells:39,releaseReady:false}));
