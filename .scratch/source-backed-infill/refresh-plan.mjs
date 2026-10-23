// Read-only source-plan refresh. Never imports repair mutation or the packer.
// Usage: node refresh-plan.mjs HISTORICAL_CONFIG HISTORICAL_PLAN OUTPUT_PLAN OUTPUT_CONTRACT
import fs from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {decodePinnedSourceCell,makeInfillRepairPlan,repairPlanSha256} from '../../tools/world-gen/repair-infill.mjs';
const [configPath,oldPlanPath,outPlanPath,outContractPath]=process.argv.slice(2);
if(!outContractPath)throw Error('Expected HISTORICAL_CONFIG HISTORICAL_PLAN OUTPUT_PLAN OUTPUT_CONTRACT');
const digest=b=>createHash('sha256').update(b).digest('hex');
const config=JSON.parse(await fs.readFile(configPath)),old=JSON.parse(await fs.readFile(oldPlanPath));
const manifestBytes=await fs.readFile(config.baseManifest);
if(digest(manifestBytes)!==config.baseManifestSha256)throw Error('Original manifest identity mismatch');
const m=JSON.parse(manifestBytes),fixture=JSON.parse(await fs.readFile(resolve(dirname(configPath),config.fixtureHashes)));
if(fixture.rows.length!==39||new Set(fixture.rows.map(r=>r.cell)).size!==39)throw Error('Expected exact unique original 39-cell fixture');
let sourceBytes=0;
for(const row of fixture.rows){const entry=m.tiles[row.cell],bytes=await fs.readFile(join(config.cellCache,row.sha256+'.bin.gz'));if(entry.sha256!==row.sha256||bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('Original fixture identity mismatch '+row.cell);sourceBytes+=bytes.length;}
const key=old.cell.join(','),target=config.cells[key],entry=m.tiles[key];
if(!target||target.ids.length!==10||!isDeepStrictEqual(target.ids,old.remove.map(r=>r.id)))throw Error('Exact historical ten-ID scope mismatch');
if(!m.sourceIdentities.some(s=>isDeepStrictEqual(s,entry.source)))throw Error('Native source identity not authenticated by original manifest');
const bytes=await fs.readFile(join(config.cellCache,entry.sha256+'.bin.gz'));
const pack=decodePinnedSourceCell(bytes,entry,{world:entry.source.world,revision:entry.source.revision,cell:old.cell});
const fresh=await makeInfillRepairPlan(pack,{sourcePath:config.sourceSnapshot,expectedSourceSha256:config.sourceSha256,sourceCellSha256:entry.sha256,ids:target.ids,python:config.python});
if(fresh.code['repair-infill.mjs']!=='979aa0f38999a0b1d3e1250351d157af3371f4d00812ad35a3946fcc3ffcd635')throw Error('Refresh requires the independently approved 1cf helper code');
if(!isDeepStrictEqual(fresh.remove,old.remove))throw Error('Source decisions or expected row identities changed');
const withoutCode=({code,...rest})=>rest;
if(!isDeepStrictEqual(withoutCode(fresh),withoutCode(old)))throw Error('Original source/pack contract changed');
const changedCode=Object.keys(fresh.code).filter(k=>fresh.code[k]!==old.code[k]);
if(!isDeepStrictEqual(changedCode,['repair-infill.mjs']))throw Error('Unexpected policy/recipe code changes '+changedCode);
const contract={schema:1,status:'fresh-plan-candidate',generatedBy:'actual makeInfillRepairPlan under approved 1cf3eb8d code',sourceManifestSha256:config.baseManifestSha256,fixtureCells:39,fixtureBytes:sourceBytes,fixtureHashesPassed:true,historicalPlanSha256:repairPlanSha256(old),freshPlanSha256:repairPlanSha256(fresh),sourceCellSha256:entry.sha256,sourceSnapshotSha256:fresh.sourceSha256,sourceRecordSha256:fresh.sourceRecordSha256,packSha256:fresh.packSha256,nativeIdentity:{world:fresh.world,revision:fresh.revision,cell:fresh.cell},changedCode,repairCodeSha256:fresh.code['repair-infill.mjs'],comparedRows:fresh.remove.length,exactIdsRowsAndDecisionsMatch:true,allOtherPlanFieldsMatch:true,physicalMutation:false,packing:false,browser:false,fullGates:false,requiredOrder:'Apply this exact original-cell infill plan BEFORE terrain mutation; terrain changes invalidate the original pack fingerprint. Scenery follows the final physical base.',historicalArtifactsUnchanged:true,mappedRoofHeightRepair:false};
await fs.writeFile(outPlanPath,JSON.stringify(fresh,null,2)+'\n',{flag:'wx'});
await fs.writeFile(outContractPath,JSON.stringify(contract,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(contract,null,2));
