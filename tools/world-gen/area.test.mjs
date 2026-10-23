// Area definitions (coast + Piraeus/Faliro as one world), building clipping at cell borders, and the low bridge guardrail.
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const python=process.env.WORLD_GEN_PYTHON||'python3',shapely=spawnSync(python,['-c','import shapely']).status===0;
test('areas share one world, buildings clip to cells, the bridge guardrail is a low post-and-beam rail',{skip:!shapely&&'shapely is not installed for '+python+' (set WORLD_GEN_PYTHON to the world-gen venv)'},()=>{
  const r=spawnSync(python,[fileURLToPath(new URL('./area_test.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});

test('mapped rock bores preserve source/layer, reject unsupported crossings and clip walls at cell borders',{skip:!shapely&&'shapely is not installed'},()=>{const r=spawnSync(python,[fileURLToPath(new URL('./rock_bores_test.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);});

test('bounded official OSM sources retain node order, close restrictions and reject incomplete roads',()=>{const r=spawnSync(python,[fileURLToPath(new URL('./fetch_osm_area_test.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);});
