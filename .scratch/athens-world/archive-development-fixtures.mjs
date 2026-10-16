// Persist tiny inactive fixtures so deleting /tmp cannot lose integration work.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {validateWorldManifest} from '../../src/world-tile-format.js';
import {validateDirectory} from '../../tools/validate-world-tiles.mjs';
const cache='/tmp/athens-world-cache',root='.scratch/athens-world/development-world';
const original=JSON.parse(readFileSync(cache+'/athens-development-oriented/manifest.json'));
const glyfada=root+'/glyfada';mkdirSync(glyfada,{recursive:true});
for(const e of Object.values(original.tiles))copyFileSync(resolve(cache+'/athens-development-oriented',e.url),resolve(glyfada,e.url));
writeFileSync(glyfada+'/manifest.json',JSON.stringify(original,null,2)+'\n');
const input=readFileSync(cache+'/emitter-check.ndjson','utf8').trim().split('\n').map(JSON.parse).find(t=>t.metadata.cell.join(',')==='8,36');
const entries=JSON.parse(readFileSync(cache+'/emitter-check/entries.json')).tiles;
const riviera=root+'/riviera';mkdirSync(riviera,{recursive:true});
const e={...entries['8,36'],dependencies:[]},m=input.metadata,t=input.tables;
let row=0;for(let i=0;i<t.anchors.length;i+=5)if(m.ids[t.anchors[i+2]].startsWith('osm:way:459160388:')){row=i;break;}
if(!t.anchors.length)throw Error('Missing generated anchor');
const manifest={...original,world:m.world,revision:m.revision,palette:m.palette,spawn:{cell:m.cell,anchor:m.ids[t.anchors[row]]},tiles:{'8,36':e},coverage:{cells:['8,36'],excludedBuildingOwnerCells:input.dependencies},notes:['One-cell inactive Riviera geometry fixture. NOT stage A; no connection to the separate Glyfada fixture.','Coast/sea, structures, signs and complete physical conformance remain unimplemented or unvalidated.','Manifest spawn is generated from the emitted contact surface, never from legacy Riviera height.']};
validateWorldManifest(manifest);copyFileSync(resolve(cache+'/emitter-check',e.url),resolve(riviera,e.url));writeFileSync(riviera+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const results={};for(const [name,dir]of [['glyfada',glyfada],['riviera',riviera]])results[name]=await validateDirectory(resolve(dir+'/manifest.json'));
results.rivieraSpawn={id:manifest.spawn.anchor,local:t.anchorTransforms.slice(t.anchors[row+1]*4,t.anchors[row+1]*4+4)};
writeFileSync('.scratch/athens-world/development-fixture-validation.json',JSON.stringify(results,null,2)+'\n');console.log(results);
