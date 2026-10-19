// Road cross-section model: tag->section mapping (pure Python) and the street surface regions (shapely).
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const python=process.env.WORLD_GEN_PYTHON||'python3',script=name=>fileURLToPath(new URL('./'+name,import.meta.url));
const shapely=spawnSync(python,['-c','import shapely,numpy']).status===0;
test('road sections: tag combinations, missing tags, class bands, sidewalks, markings, surfaces',()=>{
  const r=spawnSync(python,[script('road_section_test.py')],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});
test('street regions: disjoint kerb/sidewalk/ramp, rounded junctions without gaps, dropped kerbs, markings, lift gradient < 30 degrees',{skip:!shapely&&'shapely is not installed for '+python+' (set WORLD_GEN_PYTHON to the world-gen venv)'},()=>{
  const r=spawnSync(python,[script('street_regions_test.py')],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});
