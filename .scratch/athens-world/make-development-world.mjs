// A bounded integration fixture, never the stage-A release manifest.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodeTile} from '../../tools/world-gen/pack.mjs';
import {validateWorldManifest,validateTileSeam} from '../../src/world-tile-format.js';
import {WorldRoadGraph} from '../../src/world-tile-graph.js';
const cache='/tmp/athens-world-cache',out=process.env.WORLD_DEVELOPMENT_OUT||cache+'/athens-development';mkdirSync(out,{recursive:true});
const sources=['contact-probe'+(process.env.WORLD_SOURCE_SUFFIX||'')+'.ndjson','contact-neighbour'+(process.env.WORLD_SOURCE_SUFFIX||'')+'.ndjson'].map(f=>readFileSync(cache+'/'+f));
const digest=v=>createHash('sha256').update(v).digest('hex');
const revision=digest(Buffer.concat(sources)),world='athens-development-glyfada',keys=new Set(['4,25','5,25']);
const entries={},packs=[],omitted=new Set();let spawn,spawnTransform,spawnRoad;
for(const bytes of sources){
 const input=JSON.parse(bytes);input.metadata.world=world;input.metadata.revision=revision;
 input.metadata.developmentOnly=true;input.metadata.releaseReady=false;
 const dependencies=input.dependencies.filter(k=>keys.has(k));for(const k of input.dependencies)if(!keys.has(k))omitted.add(k);
 const {bytes:wire,checked,decoded}=encodeTile(input),m=checked.metadata,key=m.cell.join(','),sha256=digest(wire),name=m.cell.join('-')+'-'+sha256+'.bin.gz';
 writeFileSync(out+'/'+name,wire);
 entries[key]={url:'./'+name,sha256,bytes:wire.length,decodedBytes:wire.length+checked.bytes*5+JSON.stringify(m).length*4+65536,dependencies,triangles:checked.triangles};packs.push(decoded);
 if(!spawn){const t=checked.tables;let row=0;for(let i=0;i<t.anchors.length;i+=5)if(m.ids[t.anchors[i+2]].startsWith('osm:way:24826358:')){row=i;break;}
  if(!t.anchors.length)throw Error('No validated anchor');spawn={cell:m.cell,anchor:m.ids[t.anchors[row]]};spawnTransform=[...t.anchorTransforms.slice(t.anchors[row+1]*4,t.anchors[row+1]*4+4)];spawnRoad=m.strings[t.anchors[row+4]];
 }
}
validateTileSeam(...packs);const graph=new WorldRoadGraph();for(const p of packs)graph.install(p.metadata.cell.join(','),p);
const origin=packs[0].metadata.origin;const nearest=graph.nearest(origin[0]+spawnTransform[0],origin[2]+spawnTransform[2],{referenceY:spawnTransform[1],layer:0});if(!nearest)throw Error('Spawn has no public graph projection');
const manifest={tileVersion:1,world,revision,tileMetres:512,projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87745.27512677578},elevation:{datum:'EGM2008',source:'Copernicus GLO-30 DSM, road-conformed; not surveyed road levels',sha256:digest(['0c6e0c971f28d4a8965af835239adc87fc205a379a09356b0814488c4329f799','593ed89479962af1ac6836d669518d5175b81b04f7fae1acbc8e70dfec3052d4'].join(':'))},defaults:{speedKph:50},palette:packs[0].metadata.palette,spawn,tiles:entries,developmentOnly:true,releaseReady:false,coverage:{cells:[...keys],excludedBuildingOwnerCells:[...omitted].sort()},notes:['Two-cell integration fixture; NOT stage A. Buildings owned outside this bounded fixture are omitted.','Float32 render layout remains experimental. Production quantization, structure/coast/sign emission and full coverage remain pending.','Unknown/conditional turn rules fail closed; supported via-way prohibitions conservatively forbid entry.']};
validateWorldManifest(manifest);writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const report={manifest:out+'/manifest.json',revision,spawn,spawnRoad,spawnLocal:spawnTransform,spawnWorld:[origin[0]+spawnTransform[0],spawnTransform[1],origin[2]+spawnTransform[2]],nearest,graphNodes:graph.nodes.size,graphEdges:graph.edges.size,graphTurns:graph.turns.size,bytes:Object.values(entries).reduce((n,e)=>n+e.bytes,0),releaseReady:false};
writeFileSync('.scratch/athens-world/development-manifest.json',JSON.stringify(report,null,2)+'\n');console.log(report);graph.dispose();
