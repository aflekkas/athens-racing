// Real-data physical gate. Opt in with ATHENS_WORLD_SPOOL pointing to a fresh
// multi-cell NDJSON bake; normal npm test always runs the compact regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {auditWorldSurface} from '../world-surface-audit.mjs';
import {auditRoadSections} from '../world-roads-audit.mjs';
import {encodeTile} from './pack.mjs';
import {validateTileSeam} from '../../src/world-tile-format.js';
const input=process.env.ATHENS_WORLD_SPOOL;
test('Athens real cells: asphalt slope, six-metre ground shoulders / explicit guarded bridge exception, exact contacts and neighbour seams',{skip:!input},async t=>{
  const packs=new Map();
  for await(const line of createInterface({input:createReadStream(input),crlfDelay:Infinity})){
    if(!line.trim())continue;
    const tile=JSON.parse(line),{checked,decoded}=encodeTile(tile);
    const result=auditWorldSurface(checked.tables,checked.metadata);t.diagnostic(JSON.stringify({cell:tile.metadata.cell,...result}));
    assert.ok(result.asphaltTriangles>0,'real regression cell must include asphalt');
    assert.ok(result.shoulderSamples>0,'real regression cell must include shoulder boundaries');
    assert.equal(result.passed,true,'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing. '+JSON.stringify(result));
    const roads=auditRoadSections(checked.metadata);t.diagnostic(JSON.stringify({cell:tile.metadata.cell,roads:roads.roads,sidewalkRoads:roads.sidewalkRoads,byClass:roads.byClass}));
    assert.equal(roads.passed,true,'generated road cross-sections must stay inside their class band: '+JSON.stringify(roads.problems));
    assert.ok(roads.roads>0&&roads.sidewalkRoads>0,'real cells have roads with sidewalks');
    packs.set(tile.metadata.cell.join(','),decoded);
  }
  for(const key of ['4,25','5,25','8,36'])assert.ok(packs.has(key),'Required regression cell missing: '+key);
  for(const [key,pack]of packs){const [x,z]=key.split(',').map(Number);for(const n of [`${x+1},${z}`,`${x},${z+1}`])if(packs.has(n))validateTileSeam(pack,packs.get(n));}
});
