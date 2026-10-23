// Replay the reviewed OSM street sequence against authenticated emitted cells.
// Never invent connectors, snap to a parallel carriageway, rebake or publish.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readEmittedRouteWorld} from './emitted-route-world.mjs';
import {compileRoute} from '../src/route-compile.js';
import {captureRouteInputs} from './capture-route-inputs.mjs';

export async function authorKifissiaRoute({world,cells,out}) {
  if(!world||!cells||!out)throw Error('Explicit world, cells and output paths required');
  const definition=JSON.parse(await readFile(new URL('../data/routes/kifissia-kefalari.route.json',import.meta.url)));
  const keys=new Set();
  for(const id of definition.path.edges){
    const match=id.match(/:(-?\d+):(-?\d+)$/);if(!match)throw Error('Expected emitted clipped OSM edge');
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)keys.add(`${+match[1]+dx},${+match[2]+dz}`);
  }
  const input=await readEmittedRouteWorld({world,cells,keys});
  const compiled=await compileRoute(definition,input.roads.graph,input.contacts);
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,definition.id+'.route.json'),JSON.stringify(definition,null,2)+'\n');
  const capture=await captureRouteInputs({world,cells,routes:out,keys,out:resolve(out,'kifissia.inputs.json')});
  return {id:compiled.id,lengthM:compiled.lengthM,edges:definition.path.edges.length,occurrences:compiled.occurrences.length,grid:compiled.grid,cells:compiled.cells,capture:capture.report};
}
if(process.argv[1]===import.meta.filename){const [world,cells,out]=process.argv.slice(2);console.log(JSON.stringify(await authorKifissiaRoute({world,cells,out}),null,2));}
