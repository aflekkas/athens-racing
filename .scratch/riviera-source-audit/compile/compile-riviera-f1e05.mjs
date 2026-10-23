// PROPOSAL ONLY: run solely after an explicit bounded CPU grant. No networking.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='/home/dev/.cogenly/worktrees/athens-racing/t3-41c48689';
const pin='f1e05e1d9b06123685c7b2d2ebea80e2a5a36624',out='/tmp/athens-kifissia.O7Mn/built';
const world='/tmp/athens-kifissia.O7Mn/world.json',worldSHA='762bcff49ca15103bbdbe0e3b8f8d95e66fe96e4cb19cb7bfb6177777b7fb7b7';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function sourceCheck(){
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==pin)throw Error('Source HEAD changed; require a new explicit source pin');
 const rows=execFileSync('git',['ls-tree','-r',pin,'src','tools','data/routes'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 for(const row of rows){const[meta,path]=row.split('\t');const b=await readFile(resolve(root,path));const blob=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');if(blob!==meta.split(' ')[2])throw Error('Working source mismatch '+path);}
}
await sourceCheck();const worldBytes=await readFile(world);if(digest(worldBytes)!==worldSHA)throw Error('Original immutable manifest SHA mismatch');
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {readRouteInputs,readRouteClosures}=await load('tools/route-input.mjs');
const {compileRoute,routeGeometryHash}=await load('src/route-compile.js');
const {canonicalJSON}=await load('src/route-definition.js');
const {attachRivalPlans,checkRivalPlan}=await load('tools/build-rival-plans.mjs');
const started=performance.now(),input=await readRouteInputs({world,graph:resolve(root,'data/routes/validation/athens.inputs.json')});
const definition=JSON.parse(await readFile(resolve(root,'data/routes/riviera-coast.route.json')));
const raw=await compileRoute(definition,input.graph,input.contacts,{closures:await readRouteClosures(resolve(root,'data/routes'),definition)});
const geometryHash=await routeGeometryHash(raw);if(geometryHash!=='f6769329091422b4f6e7cebb34bf06e31a032ac13801982cb7b091544f0f8a6a'||raw.geometryHash!==geometryHash)throw Error('Current compile geometry differs; do not relabel or mutate it');
const geometryMs=performance.now()-started,[artifact]=await attachRivalPlans([raw]);await checkRivalPlan(artifact);await sourceCheck();
const body=canonicalJSON(artifact);if(Buffer.byteLength(body)>2*1024**2)throw Error('Candidate artifact exceeds existing2MiB cap');
async function immutableWrite(file,body){try{await writeFile(file,body,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(await readFile(file,'utf8')!==body)throw Error('Existing immutable output differs: '+file);}}
const file=resolve(out,artifact.id+'.'+artifact.routeHash+'.json');await immutableWrite(file,body);
const first=artifact.grid[0],edge=input.graph.edges.get(first.edgeId)?.value;if(!edge)throw Error('Emitted grid edge missing');
const receipt={status:'current local compiled candidate; native browser admission NOT tested',sourceCommit:pin,worldManifestSha256:worldSHA,worldSetRevision:artifact.worldSetRevision,routeId:artifact.id,revision:artifact.revision,routeHash:artifact.routeHash,geometryHash:artifact.geometryHash,graphDigest:artifact.graphDigest,rivalPlanHash:artifact.rivalPlan.hash,rivalSourceHash:artifact.rivalPlan.sourceHash,releasedRouteHash:'722e429c68c9a9bad90210ab7c4d7d132c30f7f6c237874b0c48540c95b02635',matchesOldReleasedRouteHash:artifact.routeHash==='722e429c68c9a9bad90210ab7c4d7d132c30f7f6c237874b0c48540c95b02635',artifactPath:file,artifactBytes:Buffer.byteLength(body),artifactSha256:digest(body),grid0:first,grid0Edge:{id:edge.id,from:edge.from,to:edge.to,layer:edge.layer,surface:edge.surface,flags:edge.flags},compileProofBinding:'existing immutable emitted graph/contact/width/safe query proofs; no authored-start inference; native Quick ground/loader readiness remains pending',geometryMs,totalMs:performance.now()-started,rssBytes:process.memoryUsage().rss};
await immutableWrite(resolve(out,'riviera-current-candidate-receipt.'+pin+'.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
